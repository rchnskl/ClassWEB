import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RubricItemInputDto, RubricSectionInputDto, SaveEvaluationDto, SaveRubricDto, UpdateGradeBandsDto, UpdateRubricWeightsDto, UpdateSubjectRubricsDto } from './dto/assessment.dto';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';

/** A rubric item/section with its weight resolved (entered, or split by full marks). */
type WeightedItem = RubricItemInputDto & { weightPercent: number };
type WeightedSection = Omit<RubricSectionInputDto, 'items'> & { weightPercent: number; items: WeightedItem[] };

interface GradeBand { grade: string; gpa: number; label: string; minScore: number; isActive: boolean }

@Injectable()
export class AssessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lecturerScope: LecturerScopeService,
  ) {}

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

  /** Direct weight edit (rubric / sections / items) without touching the structure. */
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

  /**
   * Resolves the weights to store. A weight is what the marks are *worth*
   * toward the grade and is set independently of the full marks: a 50-mark
   * midterm section can be worth 15%, and 15% is then all it can ever
   * contribute, however many marks it holds. Only when a weight is left
   * unset does it fall back to the marks split (full mark over the total),
   * which is the sensible default for a plain checklist.
   */
  private resolveWeights(dto: SaveRubricDto): WeightedSection[] {
    const fullMark = (it: RubricItemInputDto) => it.maxRating ?? 5;
    const sectionTotals = dto.sections.map((s) => s.items.reduce((a, it) => a + fullMark(it), 0));
    const grandTotal = sectionTotals.reduce((a, n) => a + n, 0);

    return dto.sections.map((s, si) => ({
      ...s,
      weightPercent: s.weightPercent ?? (grandTotal > 0 ? (sectionTotals[si] / grandTotal) * 100 : 0),
      items: s.items.map((it) => ({
        ...it,
        weightPercent: it.weightPercent ?? (sectionTotals[si] > 0 ? (fullMark(it) / sectionTotals[si]) * 100 : 0),
      })),
    }));
  }

  /** Weights are shares of 100 — neither level may claim more than the whole. */
  private validateWeights(sections: WeightedSection[]) {
    const sectionSum = sections.reduce((a, s) => a + s.weightPercent, 0);
    if (sectionSum > 100.001) throw new BadRequestException('Section weights must not exceed 100%');
    for (const section of sections) {
      const itemSum = section.items.reduce((a, i) => a + i.weightPercent, 0);
      if (itemSum > 100.001) throw new BadRequestException(`Item weights within section "${section.nameEn}" must not exceed 100%`);
    }
  }

  async createRubric(universityId: string, dto: SaveRubricDto) {
    const sections = this.resolveWeights(dto);
    this.validateWeights(sections);
    const maxOrder = await this.prisma.rubric.aggregate({ where: { universityId, deletedAt: null }, _max: { order: true } });
    const rubric = await this.prisma.rubric.create({
      data: {
        universityId,
        code: dto.code,
        nameEn: dto.nameEn,
        nameTh: dto.nameTh,
        description: dto.description,
        weightPercent: dto.weightPercent ?? 0,
        perSession: dto.perSession ?? false,
        order: (maxOrder._max.order ?? 0) + 1,
        sections: {
          create: sections.map((s, si) => ({
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

  /**
   * Applies an edited rubric structure. Sections/items that came back with
   * their id are updated in place — dropping and recreating them would break
   * the EvaluationScore rows that point at the old rubric items (a restricted
   * FK, so it fails outright once anything has been graded, and would lose the
   * marks even where it didn't). Only genuinely removed rows are deleted, and
   * only when nothing has been scored against them.
   */
  async updateRubricStructure(universityId: string, id: string, dto: SaveRubricDto) {
    const existing = await this.getRubric(universityId, id); // ensures existence + tenant ownership
    const sections = this.resolveWeights(dto);
    this.validateWeights(sections);

    const existingSections = new Map(existing.sections.map((s) => [s.id, s]));
    const existingItems = new Map(existing.sections.flatMap((s) => s.items.map((it) => [it.id, it])));

    // An id the client sent that this rubric doesn't own is treated as "new".
    const keptSectionIds = new Set(sections.map((s) => s.id).filter((sid): sid is string => !!sid && existingSections.has(sid)));
    const keptItemIds = new Set(
      sections.flatMap((s) => s.items.map((it) => it.id)).filter((iid): iid is string => !!iid && existingItems.has(iid)),
    );

    const removedSectionIds = existing.sections.filter((s) => !keptSectionIds.has(s.id)).map((s) => s.id);
    const removedItemIds = existing.sections
      .flatMap((s) => s.items)
      .filter((it) => !keptItemIds.has(it.id))
      .map((it) => it.id);

    if (removedItemIds.length > 0) {
      const scored = await this.prisma.evaluationScore.count({ where: { rubricItemId: { in: removedItemIds } } });
      if (scored > 0) {
        throw new ConflictException(
          `Cannot remove rubric item(s) that already have ${scored} recorded score(s). Edit their wording or weight instead, or delete the evaluations first.`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rubric.update({
        where: { id },
        data: {
          code: dto.code,
          nameEn: dto.nameEn,
          nameTh: dto.nameTh,
          description: dto.description,
          ...(dto.weightPercent !== undefined && { weightPercent: dto.weightPercent }),
          ...(dto.perSession !== undefined && { perSession: dto.perSession }),
        },
      });

      if (removedItemIds.length > 0) await tx.rubricItem.deleteMany({ where: { id: { in: removedItemIds } } });
      // onDelete: Cascade on RubricSection→RubricItem takes any leftovers with it.
      if (removedSectionIds.length > 0) await tx.rubricSection.deleteMany({ where: { id: { in: removedSectionIds } } });

      for (const [si, s] of sections.entries()) {
        const sectionData = { nameEn: s.nameEn, nameTh: s.nameTh, weightPercent: s.weightPercent, order: si };
        const itemData = (it: WeightedItem, ii: number) => ({
          textEn: it.textEn,
          textTh: it.textTh,
          weightPercent: it.weightPercent,
          maxRating: it.maxRating ?? 5,
          isCritical: it.isCritical ?? false,
          order: ii,
        });

        if (s.id && keptSectionIds.has(s.id)) {
          const sectionId = s.id;
          await tx.rubricSection.update({ where: { id: sectionId }, data: sectionData });
          for (const [ii, it] of s.items.entries()) {
            if (it.id && keptItemIds.has(it.id)) {
              await tx.rubricItem.update({ where: { id: it.id }, data: itemData(it, ii) });
            } else {
              await tx.rubricItem.create({ data: { sectionId, ...itemData(it, ii) } });
            }
          }
        } else {
          await tx.rubricSection.create({
            data: { rubricId: id, ...sectionData, items: { create: s.items.map(itemData) } },
          });
        }
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
    // Scored over what was actually examined, not over everything on the
    // form. A lab exam is sat both ways: sometimes the student performs every
    // procedure, sometimes they draw one. Treating the procedures they never
    // drew as zeros would cap them at their one section's weight — so an
    // unscored item is "not applicable" here, not "scored nothing".
    //
    // An explicit 0 is a real mark and does count against the student; only a
    // missing rating is skipped. When every item is scored this reduces to a
    // plain weighted average, so grading a whole form is unchanged.
    let weightedSum = 0;
    let attemptedSectionWeight = 0;
    let criticalFailed = false;

    for (const section of rubric.sections) {
      // A rubric saved with its weights left at 0 used to score every student
      // 0, silently: the weighted sum was 0 over a 0 total, and the sheet just
      // showed a zero that looked like a real mark. Where a weight carries no
      // information, fall back to the full marks — which is what "out of 50"
      // already means — so marks entered always produce a score.
      const examined = section.items.filter((it) => ratings.get(it.id) != null);
      const weightless = examined.length > 0 && examined.every((it) => it.weightPercent === 0);
      const itemWeight = (it: { weightPercent: number; maxRating: number }) => (weightless ? it.maxRating : it.weightPercent);

      let scored = 0;
      let attemptedItemWeight = 0;
      for (const item of section.items) {
        if (item.isCritical && passed.get(item.id) === false) criticalFailed = true;
        const rating = ratings.get(item.id);
        if (rating == null) continue;
        attemptedItemWeight += itemWeight(item);
        scored += itemWeight(item) * (rating / item.maxRating);
      }
      if (attemptedItemWeight === 0) continue; // section not examined
      weightedSum += section.weightPercent * ((scored / attemptedItemWeight) * 100);
      attemptedSectionWeight += section.weightPercent;
    }

    // Same fallback one level up: sections all weighted 0 would otherwise wipe
    // out a fully marked rubric. Their examined items are already averaged, so
    // an equal split across the examined sections is the honest reading.
    if (attemptedSectionWeight === 0) {
      const examinedSections = rubric.sections.filter((sec) => sec.items.some((it) => ratings.get(it.id) != null));
      if (examinedSections.length > 0) {
        weightedSum = 0;
        for (const section of examinedSections) {
          const examined = section.items.filter((it) => ratings.get(it.id) != null);
          const useMarks = examined.every((it) => it.weightPercent === 0);
          const w = (it: { weightPercent: number; maxRating: number }) => (useMarks ? it.maxRating : it.weightPercent);
          const total = examined.reduce((a, it) => a + w(it), 0);
          const got = examined.reduce((a, it) => a + w(it) * ((ratings.get(it.id) ?? 0) / it.maxRating), 0);
          if (total > 0) { weightedSum += (got / total) * 100; attemptedSectionWeight += 1; }
        }
      }
    }

    const rubricScore = attemptedSectionWeight > 0 ? weightedSum / attemptedSectionWeight : 0;
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
    const sent = new Map(dto.bands.filter((b) => valid.has(b.id)).map((b) => [b.id, b]));
    // A scheme must still award something, and something that every score
    // reaches — otherwise a low total would end up with no grade at all.
    const after = scheme.bands.map((b) => ({ minScore: sent.get(b.id)?.minScore ?? b.minScore, isActive: sent.get(b.id)?.isActive ?? b.isActive }));
    const active = after.filter((b) => b.isActive);
    if (active.length === 0) throw new BadRequestException('Keep at least one grade switched on');
    if (Math.min(...active.map((b) => b.minScore)) > 0) {
      throw new BadRequestException('The lowest grade switched on must start at 0, so every score gets a grade');
    }
    await this.prisma.$transaction(
      [...sent.values()].map((b) =>
        this.prisma.gradeBand.update({
          where: { id: b.id },
          data: { minScore: b.minScore, ...(b.isActive !== undefined && { isActive: b.isActive }) },
        }),
      ),
    );
    return this.gradeScheme(universityId);
  }

  private gradeFor(total: number, bands: GradeBand[]): GradeBand | null {
    const sorted = bands.filter((b) => b.isActive).sort((a, b) => b.minScore - a.minScore);
    return sorted.find((b) => total >= b.minScore) ?? sorted[sorted.length - 1] ?? null;
  }

  // ---- evaluations ------------------------------------------------------

  /**
   * Non-admins must grade within a section they teach, or a section under a
   * subject they manage as Course Manager — no section, no cross-lecturer
   * peeking.
   */
  private async assertGradingScope(user: AuthenticatedUser, sectionId?: string) {
    if (this.lecturerScope.isAdmin(user)) return;
    if (!sectionId) throw new ForbiddenException('A sectionId is required');
    await this.lecturerScope.assertTeachesOrManages(user, sectionId);
  }

  /** Turns a direct entry into the 0–100 the gradebook stores, keeping the raw mark. */
  private resolveDirectScore(direct: { rawScore?: number; rawMax?: number; scorePercent?: number }) {
    const { rawScore, rawMax, scorePercent } = direct;
    if (rawScore != null || rawMax != null) {
      if (rawScore == null || rawMax == null) throw new BadRequestException('Both the raw mark and what it is out of are required');
      if (rawMax <= 0) throw new BadRequestException('The full mark must be greater than 0');
      if (rawScore > rawMax) throw new BadRequestException(`Mark ${rawScore} exceeds the full mark of ${rawMax}`);
      return { rawScore, rawMax, scorePercent: Math.round((rawScore / rawMax) * 10000) / 100 };
    }
    if (scorePercent == null) throw new BadRequestException('Give either a raw mark out of a full mark, or a percentage');
    return { rawScore: null, rawMax: null, scorePercent };
  }

  async getEvaluation(user: AuthenticatedUser, rubricId: string, studentId: string, sectionId?: string, classSessionId?: string) {
    const universityId = user.universityId;
    await this.assertGradingScope(user, sectionId);
    const rubric = await this.getRubric(universityId, rubricId);
    const evaluation = await this.prisma.evaluation.findFirst({
      where: { universityId, rubricId, studentId, sectionId: sectionId ?? null, classSessionId: classSessionId ?? null },
      include: { scores: true },
    });
    // A per-session rubric also lists the section's sessions with each day's
    // score, so the form can offer the days and show the running average.
    const sessions = rubric.perSession && sectionId
      ? await this.sessionScores(universityId, rubricId, studentId, sectionId)
      : undefined;
    return {
      rubric,
      sessions,
      evaluation: evaluation
        ? { id: evaluation.id, status: evaluation.status, scorePercent: evaluation.scorePercent, criticalFailed: evaluation.criticalFailed, note: evaluation.note,
            rawScore: evaluation.rawScore, rawMax: evaluation.rawMax,
            scores: Object.fromEntries(evaluation.scores.map((s) => [s.rubricItemId, s.rating])),
            passed: Object.fromEntries(evaluation.scores.filter((s) => s.passed !== null).map((s) => [s.rubricItemId, s.passed])) }
        : null,
    };
  }

  /** Every session of the section, with this student's score on that day (null if not yet assessed). */
  private async sessionScores(universityId: string, rubricId: string, studentId: string, sectionId: string) {
    const [sessions, days] = await Promise.all([
      this.prisma.classSession.findMany({
        where: { sectionId, status: { not: 'CANCELLED' }, dailyAssessment: true },
        select: { id: true, sessionDate: true, startTime: true, endTime: true, topic: true },
        orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.evaluation.findMany({
        where: { universityId, rubricId, studentId, sectionId, classSessionId: { not: null } },
        select: { classSessionId: true, scorePercent: true },
      }),
    ]);
    const byDay = new Map(days.map((d) => [d.classSessionId, d.scorePercent]));
    return sessions.map((s) => ({ ...s, scorePercent: byDay.get(s.id) ?? null }));
  }

  /**
   * Re-derive a per-session rubric's component score: the average of the days
   * assessed so far, written to the row with classSessionId = null — the row
   * every summary and report reads.
   */
  private async refreshSessionAverage(universityId: string, rubricId: string, studentId: string, sectionId: string, userId: string, userName: string) {
    const days = await this.prisma.evaluation.findMany({
      where: { universityId, rubricId, studentId, sectionId, classSessionId: { not: null }, scorePercent: { not: null } },
      select: { scorePercent: true, criticalFailed: true },
    });
    const existing = await this.prisma.evaluation.findFirst({
      where: { universityId, rubricId, studentId, sectionId, classSessionId: null },
      select: { id: true },
    });
    if (days.length === 0) {
      if (existing) await this.prisma.evaluation.delete({ where: { id: existing.id } });
      return null;
    }
    const scorePercent = Math.round((days.reduce((a, d) => a + (d.scorePercent ?? 0), 0) / days.length) * 100) / 100;
    const data = {
      evaluatorId: userId, evaluatorName: userName, status: 'SUBMITTED' as const, scorePercent,
      criticalFailed: days.some((d) => d.criticalFailed), rawScore: null, rawMax: null,
      note: `Average of ${days.length} session${days.length === 1 ? '' : 's'}`,
    };
    if (existing) await this.prisma.evaluation.update({ where: { id: existing.id }, data });
    else await this.prisma.evaluation.create({ data: { universityId, rubricId, studentId, sectionId, ...data } });
    return { scorePercent, sessions: days.length };
  }

  async save(user: AuthenticatedUser, userName: string, dto: SaveEvaluationDto) {
    const universityId = user.universityId;
    const userId = user.id;
    await this.assertGradingScope(user, dto.sectionId);
    const rubric = await this.getRubric(universityId, dto.rubricId);
    // A per-session rubric is marked per day; its term score is derived, never typed.
    if (rubric.perSession && !dto.classSessionId) {
      throw new BadRequestException('This component is assessed per session — choose the day being assessed');
    }
    if (!rubric.perSession && dto.classSessionId) {
      throw new BadRequestException('This component is assessed once for the term, not per session');
    }
    if (dto.classSessionId) {
      if (!dto.sectionId) throw new BadRequestException('A sectionId is required with a classSessionId');
      const session = await this.prisma.classSession.findFirst({ where: { id: dto.classSessionId, sectionId: dto.sectionId }, select: { id: true, dailyAssessment: true } });
      if (!session) throw new BadRequestException("That session doesn't belong to this section");
      if (!session.dailyAssessment) throw new BadRequestException('That day is not a day for daily assessment');
    }
    const student = await this.prisma.student.findFirst({ where: { id: dto.studentId, universityId, deletedAt: null }, select: { id: true } });
    if (!student) throw new BadRequestException('Student does not exist in this tenant');
    if (dto.sectionId) {
      const section = await this.prisma.section.findFirst({ where: { id: dto.sectionId, universityId, deletedAt: null }, select: { id: true } });
      if (!section) throw new BadRequestException('Section does not exist in this tenant');
    }

    // Each item carries its own scale, so the upper bound is per-item rather
    // than a fixed 5: an observation item tops out at 5, a 25-mark midterm at
    // 25. Enforced here because the DTO cannot know the item it refers to —
    // without this an out-of-range rating would sail through and inflate the
    // score past 100% (rating/maxRating is used unclamped when scoring).
    const maxByItem = new Map(rubric.sections.flatMap((s) => s.items.map((i) => [i.id, i.maxRating] as const)));
    const ratings = new Map<string, number>();
    const passed = new Map<string, boolean>();
    for (const s of dto.scores) {
      const max = maxByItem.get(s.rubricItemId);
      if (max === undefined) continue;
      if (s.rating > max) {
        throw new BadRequestException(`Score ${s.rating} exceeds the maximum of ${max} for this item`);
      }
      ratings.set(s.rubricItemId, s.rating);
      if (s.passed !== undefined) passed.set(s.rubricItemId, s.passed);
    }

    // Direct entry wins over the checklist: a component marked outside the app
    // arrives as one number, and inventing per-item marks to carry it would be
    // a fiction on the grade sheet. The raw mark is kept as given so the report
    // can print "42/50", not just the percentage it works out to.
    const direct = dto.direct ? this.resolveDirectScore(dto.direct) : null;
    const { scorePercent, criticalFailed } = direct
      ? { scorePercent: direct.scorePercent, criticalFailed: false }
      : this.scoreRubric(rubric, ratings, passed);
    if (direct) { ratings.clear(); passed.clear(); }

    const existing = await this.prisma.evaluation.findFirst({
      where: { universityId, rubricId: dto.rubricId, studentId: dto.studentId, sectionId: dto.sectionId ?? null, classSessionId: dto.classSessionId ?? null },
      select: { id: true },
    });
    const evaluation = existing
      ? await this.prisma.evaluation.update({
          where: { id: existing.id },
          data: {
            evaluatorId: userId, evaluatorName: userName, status: 'SUBMITTED', scorePercent, criticalFailed, note: dto.note,
            rawScore: direct?.rawScore ?? null, rawMax: direct?.rawMax ?? null,
          },
        })
      : await this.prisma.evaluation.create({
          data: {
            university: { connect: { id: universityId } },
            rubric: { connect: { id: dto.rubricId } },
            student: { connect: { id: dto.studentId } },
            ...(dto.sectionId ? { section: { connect: { id: dto.sectionId } } } : {}),
            ...(dto.classSessionId ? { classSession: { connect: { id: dto.classSessionId } } } : {}),
            evaluatorId: userId, evaluatorName: userName, status: 'SUBMITTED', scorePercent, criticalFailed, note: dto.note,
            rawScore: direct?.rawScore ?? null, rawMax: direct?.rawMax ?? null,
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
    if (dto.sectionId) {
      await this.notifyIfCrossSectionEdit(user, userName, dto.sectionId, dto.studentId, evaluation.id, scorePercent);
    }
    const sessionAverage = dto.classSessionId && dto.sectionId
      ? await this.refreshSessionAverage(universityId, dto.rubricId, dto.studentId, dto.sectionId, userId, userName)
      : undefined;
    return { id: evaluation.id, scorePercent, criticalFailed, sessionAverage };
  }

  /**
   * A Course Manager can grade any section under a subject they manage, not
   * just sections they personally teach. When that happens — someone
   * touching a grade sheet that isn't "theirs" — the section's own
   * lecturer(s) must be told, and it gets a distinct audit trail entry from
   * an ordinary self-grading save.
   */
  private async notifyIfCrossSectionEdit(
    user: AuthenticatedUser, userName: string, sectionId: string, studentId: string, evaluationId: string, scorePercent: number,
  ) {
    if (this.lecturerScope.isAdmin(user)) return;
    const me = await this.lecturerScope.myLecturerId(user);
    if (!me || (await this.lecturerScope.teachesSection(me, sectionId))) return; // grading their own section — nothing to flag

    const section = await this.prisma.section.findFirst({
      where: { id: sectionId },
      select: {
        subject: { select: { code: true, nameEn: true } },
        lecturer: { select: { userId: true } },
        coLecturers: { select: { lecturer: { select: { userId: true } } } },
      },
    });
    if (!section) return;

    const recipientUserIds = [
      section.lecturer?.userId,
      ...section.coLecturers.map((c) => c.lecturer.userId),
    ].filter((id): id is string => Boolean(id) && id !== user.id);
    if (recipientUserIds.length === 0) return;

    await this.prisma.notification.createMany({
      data: recipientUserIds.map((recipientUserId) => ({
        universityId: user.universityId,
        userId: recipientUserId,
        type: 'GRADE_EDITED_BY_MANAGER',
        title: `${userName} แก้ไขเกรดในกลุ่มเรียนของคุณ`,
        body: `วิชา ${section.subject.code} — คะแนนถูกปรับเป็น ${scorePercent}%`,
        refType: 'Evaluation',
        refId: evaluationId,
      })),
    });
    await this.prisma.auditLog.create({
      data: {
        universityId: user.universityId, userId: user.id, action: AuditAction.UPDATE,
        entityType: 'Evaluation', entityId: evaluationId,
        metadata: { action: 'crossSectionGradeEdit', sectionId, studentId, byManagerLecturerId: me, scorePercent },
      },
    });
  }

  // ---- reports ----------------------------------------------------------

  /** Per-student breakdown across the rubrics that apply to this section's subject + weighted total + grade. */
  async studentSummary(user: AuthenticatedUser, studentId: string, sectionId?: string) {
    const universityId = user.universityId;
    await this.assertGradingScope(user, sectionId);
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
      this.prisma.evaluation.findMany({ where: { universityId, studentId, sectionId: sectionId ?? null, classSessionId: null }, select: { rubricId: true, scorePercent: true, criticalFailed: true } }),
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
  async sectionSummary(user: AuthenticatedUser, sectionId: string) {
    const universityId = user.universityId;
    await this.lecturerScope.assertTeachesOrManages(user, sectionId);
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, universityId, deletedAt: null },
      select: { subjectId: true, sectionNo: true, subject: { select: { code: true, nameEn: true, nameTh: true } } },
    });
    if (!section) throw new NotFoundException('Section not found');

    const resolved = await this.resolveSubjectRubrics(universityId, section.subjectId);
    const weightByRubric = new Map(resolved.map(({ rubric, weightPercent }) => [rubric.id, weightPercent]));

    const [enrollments, evaluations, scheme] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { sectionId, status: 'ENROLLED' }, select: { studentId: true, student: { select: { studentCode: true, nameEn: true, nameTh: true } } }, orderBy: { student: { studentCode: 'asc' } } }),
      this.prisma.evaluation.findMany({ where: { universityId, sectionId, classSessionId: null }, select: { studentId: true, rubricId: true, scorePercent: true, criticalFailed: true } }),
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
