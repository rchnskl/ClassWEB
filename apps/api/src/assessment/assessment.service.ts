import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveEvaluationDto, UpdateGradeBandsDto, UpdateRubricWeightsDto } from './dto/assessment.dto';

interface GradeBand { grade: string; gpa: number; label: string; minScore: number }

@Injectable()
export class AssessmentService {
  constructor(private readonly prisma: PrismaService) {}

  private rubricInclude = {
    sections: {
      orderBy: { order: 'asc' as const },
      include: { items: { orderBy: { order: 'asc' as const } } },
    },
  };

  // ---- rubrics ----------------------------------------------------------

  listRubrics(universityId: string) {
    return this.prisma.rubric.findMany({
      where: { universityId, deletedAt: null, isActive: true },
      include: this.rubricInclude,
      orderBy: { order: 'asc' },
    });
  }

  async getRubric(universityId: string, id: string) {
    const rubric = await this.prisma.rubric.findFirst({
      where: { id, universityId, deletedAt: null },
      include: this.rubricInclude,
    });
    if (!rubric) throw new NotFoundException('Rubric not found');
    return rubric;
  }

  async updateWeights(universityId: string, id: string, dto: UpdateRubricWeightsDto) {
    const rubric = await this.getRubric(universityId, id);

    // Validate: section weights ≤ 100; item weights ≤ 100 within each section.
    if (dto.sections) {
      const sum = dto.sections.reduce((a, s) => a + s.weightPercent, 0);
      if (sum > 100.001) throw new BadRequestException('Section weights must not exceed 100%');
    }
    if (dto.items) {
      const bySection = new Map<string, number>();
      const itemToSection = new Map(rubric.sections.flatMap((s) => s.items.map((i) => [i.id, s.id])));
      for (const it of dto.items) {
        const sid = itemToSection.get(it.id);
        if (sid) bySection.set(sid, (bySection.get(sid) ?? 0) + it.weightPercent);
      }
      for (const [, sum] of bySection) {
        if (sum > 100.001) throw new BadRequestException('Item weights within a section must not exceed 100%');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.weightPercent !== undefined) {
        await tx.rubric.update({ where: { id }, data: { weightPercent: dto.weightPercent } });
      }
      for (const s of dto.sections ?? []) {
        await tx.rubricSection.update({ where: { id: s.id }, data: { weightPercent: s.weightPercent } });
      }
      for (const it of dto.items ?? []) {
        await tx.rubricItem.update({ where: { id: it.id }, data: { weightPercent: it.weightPercent } });
      }
    });
    return this.getRubric(universityId, id);
  }

  /** Pure scoring: rubric (0–100) from a map of itemId→rating. */
  private scoreRubric(rubric: Awaited<ReturnType<AssessmentService['getRubric']>>, ratings: Map<string, number>): number {
    let rubricScore = 0;
    for (const section of rubric.sections) {
      let sectionScore = 0; // 0..100
      for (const item of section.items) {
        const rating = ratings.get(item.id);
        if (rating != null && rating > 0) sectionScore += item.weightPercent * (rating / item.maxRating);
      }
      rubricScore += (section.weightPercent / 100) * sectionScore;
    }
    return Math.round(rubricScore * 100) / 100;
  }

  // ---- grade scheme -----------------------------------------------------

  async gradeScheme(universityId: string) {
    const scheme = await this.prisma.gradeScheme.findFirst({
      where: { universityId, isDefault: true },
      include: { bands: { orderBy: { order: 'asc' } } },
    });
    if (!scheme) throw new NotFoundException('Grade scheme not found');
    return scheme;
  }

  async updateBands(universityId: string, dto: UpdateGradeBandsDto) {
    const scheme = await this.gradeScheme(universityId);
    const valid = new Set(scheme.bands.map((b) => b.id));
    await this.prisma.$transaction(
      dto.bands.filter((b) => valid.has(b.id)).map((b) =>
        this.prisma.gradeBand.update({ where: { id: b.id }, data: { minScore: b.minScore } }),
      ),
    );
    return this.gradeScheme(universityId);
  }

  private gradeFor(total: number, bands: GradeBand[]): GradeBand | null {
    const sorted = [...bands].sort((a, b) => b.minScore - a.minScore);
    return sorted.find((b) => total >= b.minScore) ?? sorted[sorted.length - 1] ?? null;
  }

  // ---- evaluations ------------------------------------------------------

  async getEvaluation(universityId: string, rubricId: string, studentId: string, sectionId?: string) {
    const evaluation = await this.prisma.evaluation.findFirst({
      where: { universityId, rubricId, studentId, sectionId: sectionId ?? null },
      include: { scores: true },
    });
    return {
      rubric: await this.getRubric(universityId, rubricId),
      evaluation: evaluation
        ? { id: evaluation.id, status: evaluation.status, scorePercent: evaluation.scorePercent, note: evaluation.note,
            scores: Object.fromEntries(evaluation.scores.map((s) => [s.rubricItemId, s.rating])) }
        : null,
    };
  }

  async save(universityId: string, userId: string, userName: string, dto: SaveEvaluationDto) {
    const rubric = await this.getRubric(universityId, dto.rubricId);
    const student = await this.prisma.student.findFirst({ where: { id: dto.studentId, universityId, deletedAt: null }, select: { id: true } });
    if (!student) throw new BadRequestException('Student does not exist in this tenant');
    if (dto.sectionId) {
      const section = await this.prisma.section.findFirst({ where: { id: dto.sectionId, universityId, deletedAt: null }, select: { id: true } });
      if (!section) throw new BadRequestException('Section does not exist in this tenant');
    }

    const validItems = new Set(rubric.sections.flatMap((s) => s.items.map((i) => i.id)));
    const ratings = new Map<string, number>();
    for (const s of dto.scores) if (validItems.has(s.rubricItemId)) ratings.set(s.rubricItemId, s.rating);
    const scorePercent = this.scoreRubric(rubric, ratings);

    const existing = await this.prisma.evaluation.findFirst({
      where: { universityId, rubricId: dto.rubricId, studentId: dto.studentId, sectionId: dto.sectionId ?? null },
      select: { id: true },
    });
    const evaluation = existing
      ? await this.prisma.evaluation.update({
          where: { id: existing.id },
          data: { evaluatorId: userId, evaluatorName: userName, status: 'SUBMITTED', scorePercent, note: dto.note },
        })
      : await this.prisma.evaluation.create({
          data: {
            university: { connect: { id: universityId } },
            rubric: { connect: { id: dto.rubricId } },
            student: { connect: { id: dto.studentId } },
            ...(dto.sectionId ? { section: { connect: { id: dto.sectionId } } } : {}),
            evaluatorId: userId, evaluatorName: userName, status: 'SUBMITTED', scorePercent, note: dto.note,
          },
        });

    // Replace scores.
    await this.prisma.$transaction([
      this.prisma.evaluationScore.deleteMany({ where: { evaluationId: evaluation.id } }),
      this.prisma.evaluationScore.createMany({
        data: [...ratings.entries()].map(([rubricItemId, rating]) => ({ evaluationId: evaluation.id, rubricItemId, rating })),
      }),
    ]);
    await this.prisma.auditLog.create({
      data: { universityId, userId, action: AuditAction.UPDATE, entityType: 'Evaluation', entityId: evaluation.id, metadata: { rubricId: dto.rubricId, studentId: dto.studentId, scorePercent } },
    });
    return { id: evaluation.id, scorePercent };
  }

  // ---- reports ----------------------------------------------------------

  /** Per-student breakdown across all rubrics + weighted total + grade. */
  async studentSummary(universityId: string, studentId: string, sectionId?: string) {
    const [student, rubrics, evaluations, scheme] = await Promise.all([
      this.prisma.student.findFirst({ where: { id: studentId, universityId, deletedAt: null }, select: { studentCode: true, nameEn: true, nameTh: true, program: { select: { code: true } } } }),
      this.listRubrics(universityId),
      this.prisma.evaluation.findMany({ where: { universityId, studentId, sectionId: sectionId ?? null }, select: { rubricId: true, scorePercent: true, status: true } }),
      this.gradeScheme(universityId),
    ]);
    if (!student) throw new NotFoundException('Student not found');

    const evalByRubric = new Map(evaluations.map((e) => [e.rubricId, e]));
    const rows = rubrics.map((r) => {
      const ev = evalByRubric.get(r.id);
      const scorePercent = ev?.scorePercent ?? null;
      return {
        rubricId: r.id, name: r.name, weightPercent: r.weightPercent,
        scorePercent, graded: scorePercent != null,
        contribution: scorePercent != null ? Math.round((r.weightPercent / 100) * scorePercent * 100) / 100 : 0,
      };
    });
    const total = Math.round(rows.reduce((a, r) => a + r.contribution, 0) * 100) / 100;
    const gradedWeight = rows.filter((r) => r.graded).reduce((a, r) => a + r.weightPercent, 0);
    const band = this.gradeFor(total, scheme.bands);

    return {
      student, sectionId: sectionId ?? null,
      rubrics: rows, total, gradedWeight,
      grade: band ? { grade: band.grade, gpa: band.gpa, label: band.label } : null,
    };
  }

  /** Per-section table: every enrolled student with total + grade. */
  async sectionSummary(universityId: string, sectionId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, universityId, deletedAt: null },
      select: { sectionNo: true, subject: { select: { code: true, nameEn: true } } },
    });
    if (!section) throw new NotFoundException('Section not found');

    const [enrollments, rubrics, evaluations, scheme] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { sectionId, status: 'ENROLLED' }, select: { studentId: true, student: { select: { studentCode: true, nameEn: true, nameTh: true } } }, orderBy: { student: { studentCode: 'asc' } } }),
      this.listRubrics(universityId),
      this.prisma.evaluation.findMany({ where: { universityId, sectionId }, select: { studentId: true, rubricId: true, scorePercent: true } }),
      this.gradeScheme(universityId),
    ]);
    const weightByRubric = new Map(rubrics.map((r) => [r.id, r.weightPercent]));

    const students = enrollments.map((en) => {
      const evs = evaluations.filter((e) => e.studentId === en.studentId);
      let total = 0, gradedWeight = 0;
      for (const e of evs) {
        const w = weightByRubric.get(e.rubricId) ?? 0;
        if (e.scorePercent != null) { total += (w / 100) * e.scorePercent; gradedWeight += w; }
      }
      total = Math.round(total * 100) / 100;
      const band = this.gradeFor(total, scheme.bands);
      return {
        studentId: en.studentId, studentCode: en.student.studentCode, nameEn: en.student.nameEn, nameTh: en.student.nameTh,
        total, gradedWeight, gradedCount: evs.length,
        grade: band?.grade ?? null, gpa: band?.gpa ?? null,
      };
    });

    return { section, rubricCount: rubrics.length, students };
  }
}
