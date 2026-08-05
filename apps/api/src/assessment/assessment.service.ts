import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SaveEvaluationDto, SaveRubricDto, UpdateGradeBandsDto, UpdateRubricWeightsDto, UpdateSubjectRubricsDto } from './dto/assessment.dto';

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

  // ---- rubrics (global catalogue) ----------------------------------------

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

  /** Shared weight-sum validation for the rubric builder (create + replace). */
  private validateRubricStructure(dto: SaveRubricDto) {
    const sectionSum = dto.sections.reduce((a, s) => a + s.weightPercent, 0);
    if (sectionSum > 100.001) throw new BadRequestException('Section weights must not exceed 100%');
    for (const section of dto.sections) {
      const itemSum = section.items.reduce((a, i) => a + i.weightPercent, 0);
      if (itemSum > 100.001) throw new BadRequestException(`Item weights within section "${section.nameEn}" must not exceed 100%`);
    }
  }

  async createRubric(universityId: string, dto: SaveRubricDto) {
    this.validateRubricStructure(dto);
    const maxOrder = await this.prisma.rubric.aggregate({ where: { universityId, deletedAt: null }, _max: { order: true } });
    const rubric = await this.prisma.rubric.create({
      data: {
        universityId,
        code: dto.code,
        nameEn: dto.nameEn,
        nameTh: dto.nameTh,
        description: dto.description,
        weightPercent: dto.weightPercent ?? 0,
        order: (maxOrder._max.order ?? 0) + 1,
        sections: {
          create: dto.sections.map((s, si) => ({
            nameEn: s.nameEn,
            nameTh: s.nameTh,
            weightPercent: s.weightPercent,
            order: si,
            items: {
              create: s.items.map((it, ii) => ({
                textEn: it.textEn,
                textTh: it.textTh,
                weightPercent: it.weightPercent,
                maxRating: it.maxRating ?? 5,
                isCritical: it.isCritical ?? false,
                order: ii,
              })),
            },
          })),
        },
      },
      include: this.rubricInclude,
    });
    return rubric;
  }

  /** Fully replaces a rubric's sections/items (existing children are dropped and recreated). */
  async updateRubricStructure(universityId: string, id: string, dto: SaveRubricDto) {
    await this.getRubric(universityId, id); // ensures existence + tenant ownership
    this.validateRubricStructure(dto);

    await this.prisma.$transaction(async (tx) => {
      await tx.rubric.update({
        where: { id },
        data: {
          code: dto.code,
          nameEn: dto.nameEn,
          nameTh: dto.nameTh,
          description: dto.description,
          ...(dto.weightPercent !== undefined && { weightPercent: dto.weightPercent }),
        },
      });
      // onDelete: Cascade on RubricSection→RubricItem takes items with it.
      await tx.rubricSection.deleteMany({ where: { rubricId: id } });
      for (const [si, s] of dto.sections.entries()) {
        await tx.rubricSection.create({
          data: {
            rubricId: id,
            nameEn: s.nameEn,
            nameTh: s.nameTh,
            weightPercent: s.weightPercent,
            order: si,
            items: {
              create: s.items.map((it, ii) => ({
                textEn: it.textEn,
                textTh: it.textTh,
                weightPercent: it.weightPercent,
                maxRating: it.maxRating ?? 5,
                isCritical: it.isCritical ?? false,
                order: ii,
              })),
            },
          },
        });
      }
    });
    return this.getRubric(universityId, id);
  }

  async removeRubric(universityId: string, id: string) {
    await this.getRubric(universityId, id);
    const evalCount = await this.prisma.evaluation.count({ where: { rubricId: id } });
    if (evalCount > 0) {
      throw new ConflictException(`This rubric has ${evalCount} recorded evaluation(s) and cannot be deleted. Deactivate its subject assignments instead.`);
    }
    await this.prisma.rubric.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { id, deleted: true };
  }

  /**
   * Pure scoring: rubric (0–100) from a map of itemId→rating, plus an
   * OSCE-style critical-failure check. If any isCritical item is explicitly
   * marked not-passed, the whole rubric score is forced to 0 — a missed
   * safety-critical step (e.g. "did not verify patient identity") fails the
   * station regardless of how well the rest was performed.
   */
  private scoreRubric(
    rubric: Awaited<ReturnType<AssessmentService['getRubric']>>,
    ratings: Map<string, number>,
    passed: Map<string, boolean>,
  ): { scorePercent: number; criticalFailed: boolean } {
    let rubricScore = 0;
    let criticalFailed = false;
    for (const section of rubric.sections) {
      let sectionScore = 0; // 0..100
      for (const item of section.items) {
        const rating = ratings.get(item.id);
        if (rating != null && rating > 0) sectionScore += item.weightPercent * (rating / item.maxRating);
        if (item.isCritical && passed.get(item.id) === false) criticalFailed = true;
      }
      rubricScore += (section.weightPercent / 100) * sectionScore;
    }
    const scorePercent = criticalFailed ? 0 : Math.round(rubricScore * 100) / 100;
    return { scorePercent, criticalFailed };
  }

  // ---- per-subject rubric selection ---------------------------------------
  // Not every subject uses every rubric. If a subject has no SubjectRubric
  // rows at all, it implicitly uses every rubric at that rubric's global
  // default weight (keeps unconfigured subjects working out of the box).
  // Once a subject is explicitly configured, only its active selections —
  // at their subject-specific weights — apply.

  private async assertSubjectInTenant(universityId: string, subjectId: string) {
    const subject = await this.prisma.subject.findFirst({
      where: { id: subjectId, deletedAt: null, program: { faculty: { universityId } } },
      select: { id: true },
    });
    if (!subject) throw new NotFoundException('Subject not found in this tenant');
  }

  /** Lightweight config view: all 5 rubrics with this subject's active/weight state — for the settings UI. */
  async subjectRubricConfig(universityId: string, subjectId: string) {
    await this.assertSubjectInTenant(universityId, subjectId);
    const [rubrics, configured] = await Promise.all([
      this.prisma.rubric.findMany({
        where: { universityId, deletedAt: null, isActive: true },
        orderBy: { order: 'asc' },
        select: { id: true, code: true, nameEn: true, nameTh: true, weightPercent: true },
      }),
      this.prisma.subjectRubric.findMany({ where: { subjectId }, select: { rubricId: true, weightPercent: true, isActive: true } }),
    ]);
    const hasConfig = configured.length > 0;
    const map = new Map(configured.map((c) => [c.rubricId, c]));
    return rubrics.map((r) => {
      const c = map.get(r.id);
      return {
        rubricId: r.id, code: r.code, nameEn: r.nameEn, nameTh: r.nameTh,
        weightPercent: c ? c.weightPercent : hasConfig ? 0 : r.weightPercent,
        isActive: c ? c.isActive : !hasConfig,
      };
    });
  }

  async updateSubjectRubrics(universityId: string, subjectId: string, dto: UpdateSubjectRubricsDto) {
    await this.assertSubjectInTenant(universityId, subjectId);
    const validIds = new Set((await this.prisma.rubric.findMany({ where: { universityId, deletedAt: null }, select: { id: true } })).map((r) => r.id));
    const activeSum = dto.rubrics.filter((r) => r.isActive && validIds.has(r.rubricId)).reduce((a, r) => a + r.weightPercent, 0);
    if (activeSum > 100.001) throw new BadRequestException('Active rubric weights for this subject must not exceed 100%');

    await this.prisma.$transaction(
      dto.rubrics.filter((r) => validIds.has(r.rubricId)).map((r) =>
        this.prisma.subjectRubric.upsert({
          where: { subjectId_rubricId: { subjectId, rubricId: r.rubricId } },
          update: { weightPercent: r.weightPercent, isActive: r.isActive },
          create: { subjectId, rubricId: r.rubricId, weightPercent: r.weightPercent, isActive: r.isActive },
        }),
      ),
    );
    return this.subjectRubricConfig(universityId, subjectId);
  }

  /** Resolved (rubric, effective weight) pairs actually used for grading this subject. */
  private async resolveSubjectRubrics(universityId: string, subjectId: string) {
    const [allRubrics, configured] = await Promise.all([
      this.listRubrics(universityId),
      this.prisma.subjectRubric.findMany({ where: { subjectId }, select: { rubricId: true, weightPercent: true, isActive: true } }),
    ]);
    if (configured.length === 0) {
      return allRubrics.map((r) => ({ rubric: r, weightPercent: r.weightPercent }));
    }
    const activeMap = new Map(configured.filter((c) => c.isActive).map((c) => [c.rubricId, c.weightPercent]));
    return allRubrics.filter((r) => activeMap.has(r.id)).map((r) => ({ rubric: r, weightPercent: activeMap.get(r.id)! }));
  }

  /** Full rubric objects (sections+items, bilingual) for the rubrics this subject actually uses — for the grading UI. */
  async activeRubricsForSubject(universityId: string, subjectId: string) {
    await this.assertSubjectInTenant(universityId, subjectId);
    const resolved = await this.resolveSubjectRubrics(universityId, subjectId);
    return resolved.map(({ rubric, weightPercent }) => ({ ...rubric, weightPercent }));
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
        ? { id: evaluation.id, status: evaluation.status, scorePercent: evaluation.scorePercent, criticalFailed: evaluation.criticalFailed, note: evaluation.note,
            scores: Object.fromEntries(evaluation.scores.map((s) => [s.rubricItemId, s.rating])),
            passed: Object.fromEntries(evaluation.scores.filter((s) => s.passed !== null).map((s) => [s.rubricItemId, s.passed])) }
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
    const passed = new Map<string, boolean>();
    for (const s of dto.scores) {
      if (!validItems.has(s.rubricItemId)) continue;
      ratings.set(s.rubricItemId, s.rating);
      if (s.passed !== undefined) passed.set(s.rubricItemId, s.passed);
    }
    const { scorePercent, criticalFailed } = this.scoreRubric(rubric, ratings, passed);

    const existing = await this.prisma.evaluation.findFirst({
      where: { universityId, rubricId: dto.rubricId, studentId: dto.studentId, sectionId: dto.sectionId ?? null },
      select: { id: true },
    });
    const evaluation = existing
      ? await this.prisma.evaluation.update({
          where: { id: existing.id },
          data: { evaluatorId: userId, evaluatorName: userName, status: 'SUBMITTED', scorePercent, criticalFailed, note: dto.note },
        })
      : await this.prisma.evaluation.create({
          data: {
            university: { connect: { id: universityId } },
            rubric: { connect: { id: dto.rubricId } },
            student: { connect: { id: dto.studentId } },
            ...(dto.sectionId ? { section: { connect: { id: dto.sectionId } } } : {}),
            evaluatorId: userId, evaluatorName: userName, status: 'SUBMITTED', scorePercent, criticalFailed, note: dto.note,
          },
        });

    // Replace scores.
    await this.prisma.$transaction([
      this.prisma.evaluationScore.deleteMany({ where: { evaluationId: evaluation.id } }),
      this.prisma.evaluationScore.createMany({
        data: [...ratings.entries()].map(([rubricItemId, rating]) => ({
          evaluationId: evaluation.id, rubricItemId, rating, passed: passed.get(rubricItemId) ?? null,
        })),
      }),
    ]);
    await this.prisma.auditLog.create({
      data: { universityId, userId, action: AuditAction.UPDATE, entityType: 'Evaluation', entityId: evaluation.id, metadata: { rubricId: dto.rubricId, studentId: dto.studentId, scorePercent, criticalFailed } },
    });
    return { id: evaluation.id, scorePercent, criticalFailed };
  }

  // ---- reports ----------------------------------------------------------

  /** Per-student breakdown across the rubrics that apply to this section's subject + weighted total + grade. */
  async studentSummary(universityId: string, studentId: string, sectionId?: string) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, universityId, deletedAt: null },
      select: { studentCode: true, nameEn: true, nameTh: true, program: { select: { code: true } } },
    });
    if (!student) throw new NotFoundException('Student not found');

    let resolved: { rubric: Awaited<ReturnType<AssessmentService['listRubrics']>>[number]; weightPercent: number }[];
    if (sectionId) {
      const section = await this.prisma.section.findFirst({ where: { id: sectionId, universityId, deletedAt: null }, select: { subjectId: true } });
      resolved = section ? await this.resolveSubjectRubrics(universityId, section.subjectId) : [];
    } else {
      resolved = (await this.listRubrics(universityId)).map((r) => ({ rubric: r, weightPercent: r.weightPercent }));
    }

    const [evaluations, scheme] = await Promise.all([
      this.prisma.evaluation.findMany({ where: { universityId, studentId, sectionId: sectionId ?? null }, select: { rubricId: true, scorePercent: true, criticalFailed: true } }),
      this.gradeScheme(universityId),
    ]);
    const evalByRubric = new Map(evaluations.map((e) => [e.rubricId, e]));

    const rows = resolved.map(({ rubric: r, weightPercent }) => {
      const ev = evalByRubric.get(r.id);
      const scorePercent = ev?.scorePercent ?? null;
      return {
        rubricId: r.id, nameEn: r.nameEn, nameTh: r.nameTh, weightPercent,
        scorePercent, graded: scorePercent != null, criticalFailed: ev?.criticalFailed ?? false,
        contribution: scorePercent != null ? Math.round((weightPercent / 100) * scorePercent * 100) / 100 : 0,
      };
    });
    const total = Math.round(rows.reduce((a, r) => a + r.contribution, 0) * 100) / 100;
    const gradedWeight = rows.filter((r) => r.graded).reduce((a, r) => a + r.weightPercent, 0);
    // Only assign a letter grade once every applicable rubric is graded — see sectionSummary.
    const isComplete = rows.length > 0 && rows.every((r) => r.graded);
    const band = isComplete ? this.gradeFor(total, scheme.bands) : null;

    return {
      student, sectionId: sectionId ?? null,
      rubrics: rows, total, gradedWeight, isComplete,
      grade: band ? { grade: band.grade, gpa: band.gpa, label: band.label } : null,
    };
  }

  /** Per-section table: every enrolled student with total + grade, using the section's subject rubric config. */
  async sectionSummary(universityId: string, sectionId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, universityId, deletedAt: null },
      select: { subjectId: true, sectionNo: true, subject: { select: { code: true, nameEn: true, nameTh: true } } },
    });
    if (!section) throw new NotFoundException('Section not found');

    const resolved = await this.resolveSubjectRubrics(universityId, section.subjectId);
    const weightByRubric = new Map(resolved.map(({ rubric, weightPercent }) => [rubric.id, weightPercent]));

    const [enrollments, evaluations, scheme] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { sectionId, status: 'ENROLLED' }, select: { studentId: true, student: { select: { studentCode: true, nameEn: true, nameTh: true } } }, orderBy: { student: { studentCode: 'asc' } } }),
      this.prisma.evaluation.findMany({ where: { universityId, sectionId }, select: { studentId: true, rubricId: true, scorePercent: true, criticalFailed: true } }),
      this.gradeScheme(universityId),
    ]);

    const students = enrollments.map((en) => {
      const evs = evaluations.filter((e) => e.studentId === en.studentId && weightByRubric.has(e.rubricId));
      let total = 0, gradedWeight = 0;
      for (const e of evs) {
        const w = weightByRubric.get(e.rubricId) ?? 0;
        if (e.scorePercent != null) { total += (w / 100) * e.scorePercent; gradedWeight += w; }
      }
      total = Math.round(total * 100) / 100;
      // A letter grade is only meaningful once every rubric that applies to this
      // subject has been evaluated. Until then, `total` is a running score (ungraded
      // rubrics count as 0), so mapping it to a band would show a misleadingly low
      // grade (e.g. a strong 2/5-graded student as "F"). Withhold the grade until complete.
      const isComplete = resolved.length > 0 && evs.length >= resolved.length;
      const band = isComplete ? this.gradeFor(total, scheme.bands) : null;
      return {
        studentId: en.studentId, studentCode: en.student.studentCode, nameEn: en.student.nameEn, nameTh: en.student.nameTh,
        total, gradedWeight, gradedCount: evs.length, hasCriticalFail: evs.some((e) => e.criticalFailed),
        isComplete, grade: band?.grade ?? null, gpa: band?.gpa ?? null,
      };
    });

    return { section, rubricCount: resolved.length, students };
  }
}
