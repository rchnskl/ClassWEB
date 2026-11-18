import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { displayNameOf } from '../users/display-name';
import { RubricItemInputDto, RubricSectionInputDto, SaveEvaluationDto, SaveRubricDto, UpdateGradeBandsDto, UpdateRubricWeightsDto, UpdateSubjectRubricsDto } from './dto/assessment.dto';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';

/** A rubric item/section with its weight resolved (entered, or split by full marks). */
type WeightedItem = RubricItemInputDto & { weightPercent: number };
type WeightedSection = Omit<RubricSectionInputDto, 'items'> & { weightPercent: number; items: WeightedItem[] };

interface GradeBand { grade: string; gpa: number; label: string; minScore: number; isActive: boolean }

@Injectable()
export class AssessmentService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lecturerScope: LecturerScopeService,
  ) {}

  private readonly logger = new Logger(AssessmentService.name);

  /** Brings stored daily component scores in line with the current formula (cheap: one row per student per daily rubric). */
  async onApplicationBootstrap() {
    try {
      const n = await this.refreshAllDailyComponents();
      if (n > 0) this.logger.log(`Recomputed ${n} daily component score(s)`);
    } catch (err) {
      this.logger.warn(`Could not recompute daily component scores: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

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
    const criticalFailed = rubric.sections.some((s) => s.items.some((it) => it.isCritical && passed.get(it.id) === false));
    const sectionScores = rubric.sections
      .map((section) => ({ section, percent: AssessmentService.sectionPercent(section, ratings) }))
      .filter((x): x is { section: typeof x.section; percent: number } => x.percent != null); // unexamined sections are skipped

    for (const { section, percent } of sectionScores) {
      weightedSum += section.weightPercent * percent;
      attemptedSectionWeight += section.weightPercent;
    }

    // Same fallback one level up: sections all weighted 0 would otherwise wipe
    // out a fully marked rubric. Their examined items are already averaged, so
    // an equal split across the examined sections is the honest reading.
    if (attemptedSectionWeight === 0 && sectionScores.length > 0) {
      weightedSum = sectionScores.reduce((a, x) => a + x.percent, 0);
      attemptedSectionWeight = sectionScores.length;
    }

    const rubricScore = attemptedSectionWeight > 0 ? weightedSum / attemptedSectionWeight : 0;
    const scorePercent = criticalFailed ? 0 : Math.round(rubricScore * 100) / 100;
    return { scorePercent, criticalFailed };
  }

  /**
   * One rubric section's score (0–100) over the items actually rated in it,
   * or null when none were. A rubric saved with its weights left at 0 used to
   * score every student 0, silently; where a weight carries no information,
   * fall back to the full marks — which is what "out of 50" already means —
   * so marks entered always produce a score.
   */
  static sectionPercent(
    section: { items: Array<{ id: string; weightPercent: number; maxRating: number }> },
    ratings: Map<string, number>,
  ): number | null {
    const examined = section.items.filter((it) => ratings.get(it.id) != null);
    if (examined.length === 0) return null;
    const weightless = examined.every((it) => it.weightPercent === 0);
    const w = (it: { weightPercent: number; maxRating: number }) => (weightless ? it.maxRating : it.weightPercent);
    const total = examined.reduce((a, it) => a + w(it), 0);
    if (total === 0) return null;
    return (examined.reduce((a, it) => a + w(it) * ((ratings.get(it.id) ?? 0) / it.maxRating), 0) / total) * 100;
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

  /**
   * The grade scheme for a subject: its own when it has one (grading criteria
   * set in its course outline), else the university-wide default. `own` says
   * which.
   */
  async gradeScheme(universityId: string, subjectId?: string) {
    if (subjectId) {
      const own = await this.prisma.gradeScheme.findFirst({
        where: { universityId, subjectId },
        include: { bands: { orderBy: { order: 'asc' } } },
      });
      if (own) return { ...own, own: true };
    }
    const scheme = await this.prisma.gradeScheme.findFirst({
      where: { universityId, isDefault: true, subjectId: null },
      include: { bands: { orderBy: { order: 'asc' } } },
    });
    if (!scheme) throw new NotFoundException('Grade scheme not found');
    return { ...scheme, own: false };
  }

  /**
   * Edit grade bands. With a subject, the edit applies to that subject only:
   * the first edit gives it its own copy of the default scheme, so other
   * subjects keep theirs.
   */
  async updateBands(universityId: string, dto: UpdateGradeBandsDto, subjectId?: string) {
    let scheme = await this.gradeScheme(universityId, subjectId);
    let sentBands = dto.bands;
    if (subjectId && !scheme.own) {
      const subject = await this.prisma.subject.findFirst({ where: { id: subjectId, program: { faculty: { universityId } } }, select: { id: true, code: true } });
      if (!subject) throw new NotFoundException('Subject not found');
      const gradeOf = new Map(scheme.bands.map((b) => [b.id, b.grade]));
      const copy = await this.prisma.gradeScheme.create({
        data: {
          universityId, subjectId, isDefault: false, name: `${subject.code} grading`,
          bands: { create: scheme.bands.map(({ grade, gpa, label, minScore, order, isActive }) => ({ grade, gpa, label, minScore, order, isActive })) },
        },
        include: { bands: { orderBy: { order: 'asc' } } },
      });
      // The edit was made against the default's band ids: carry it over by grade.
      const idOfGrade = new Map(copy.bands.map((b) => [b.grade, b.id]));
      sentBands = dto.bands.map((b) => ({ ...b, id: idOfGrade.get(gradeOf.get(b.id) ?? '') ?? b.id }));
      scheme = { ...copy, own: true };
    }
    const valid = new Set(scheme.bands.map((b) => b.id));
    const sent = new Map(sentBands.filter((b) => valid.has(b.id)).map((b) => [b.id, b]));
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
    return this.gradeScheme(universityId, subjectId);
  }

  private gradeFor(total: number, bands: GradeBand[]): GradeBand | null {
    const sorted = bands.filter((b) => b.isActive).sort((a, b) => b.minScore - a.minScore);
    return sorted.find((b) => total >= b.minScore) ?? sorted[sorted.length - 1] ?? null;
  }

  /**
   * A provisional grade for students still part-way through the term — an
   * ESTIMATE, never the grade itself (that stays withheld until every
   * component is assessed; see sectionSummary). It assumes the student keeps
   * performing at their level so far:
   *   estimate = Σ(weight × score) ÷ Σ(weight) over the components assessed,
   * where a daily (per-session) component counts at the AVERAGE of the days
   * assessed so far, not its running total (which is low early on only
   * because most days haven't happened yet). Components not yet assessed are
   * left out of the basis, and `basisWeight` says how much of the grade the
   * estimate rests on so a reader can judge how firm it is.
   */
  private async estimateGrades(universityId: string, sectionId: string, subjectId: string) {
    const [resolved, scheme] = await Promise.all([this.resolveSubjectRubrics(universityId, subjectId), this.gradeScheme(universityId, subjectId)]);
    const ids = resolved.map((r) => r.rubric.id);
    const [termEvals, dayEvals] = await Promise.all([
      this.prisma.evaluation.findMany({
        where: { universityId, sectionId, classSessionId: null, rubricId: { in: ids }, scorePercent: { not: null } },
        select: { studentId: true, rubricId: true, scorePercent: true },
      }),
      this.prisma.evaluation.findMany({
        where: { universityId, sectionId, classSessionId: { not: null }, rubricId: { in: ids }, scorePercent: { not: null }, classSession: { status: { not: 'CANCELLED' }, dailyAssessment: true } },
        select: { studentId: true, rubricId: true, scorePercent: true },
      }),
    ]);
    const daily = new Set(resolved.filter((r) => r.rubric.perSession).map((r) => r.rubric.id));
    const totalWeight = resolved.reduce((a, r) => a + r.weightPercent, 0);
    const weight = new Map(resolved.map((r) => [r.rubric.id, r.weightPercent]));
    // studentId → rubricId → score used for the estimate
    const scores = new Map<string, Map<string, number>>();
    const put = (st: string, rb: string, v: number) => { if (!scores.has(st)) scores.set(st, new Map()); scores.get(st)!.set(rb, v); };
    for (const e of termEvals) if (!daily.has(e.rubricId)) put(e.studentId, e.rubricId, e.scorePercent!);
    const dayAcc = new Map<string, { sum: number; n: number; st: string; rb: string }>();
    for (const e of dayEvals) {
      if (!daily.has(e.rubricId)) continue;
      const key = `${e.studentId}|${e.rubricId}`;
      const cur = dayAcc.get(key) ?? { sum: 0, n: 0, st: e.studentId, rb: e.rubricId };
      cur.sum += e.scorePercent!; cur.n++; dayAcc.set(key, cur);
    }
    for (const a of dayAcc.values()) put(a.st, a.rb, a.sum / a.n);

    const out = new Map<string, { estimate: number; grade: string | null; gpa: number | null; basisWeight: number; totalWeight: number }>();
    for (const [studentId, m] of scores) {
      let ws = 0, w = 0;
      for (const [rb, v] of m) { const wt = weight.get(rb) ?? 0; ws += wt * v; w += wt; }
      if (w <= 0) continue;
      const estimate = Math.round((ws / w) * 100) / 100;
      const band = this.gradeFor(estimate, scheme.bands);
      out.set(studentId, { estimate, grade: band?.grade ?? null, gpa: band?.gpa ?? null, basisWeight: Math.round(w * 100) / 100, totalWeight: Math.round(totalWeight * 100) / 100 });
    }
    return out;
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
   * Re-derive a daily (per-session) rubric's component score and write it to
   * the row with classSessionId = null — the row every summary and report
   * reads.
   *
   * The component is split evenly across the section's practice days and
   * builds up day by day: each day is worth (component weight ÷ days), so
   * the score is the SUM of the day scores divided by the number of days
   * that count — after 1 of 6 days at 51.8% the component stands at 8.63%,
   * i.e. 6.04 of 70 points, and reaches its full value only once every day
   * is assessed. A day the student was absent or on leave does not count
   * (unless it was assessed anyway), so missing a day neither earns nor
   * costs points; a day they attended but that hasn't been assessed yet is
   * simply not earned yet.
   */
  async refreshDailyComponent(universityId: string, rubricId: string, studentId: string, sectionId: string, actor?: { id: string; name: string }) {
    const [sessions, dayEvals, absences, existing] = await Promise.all([
      this.prisma.classSession.findMany({
        where: { sectionId, status: { not: 'CANCELLED' }, dailyAssessment: true },
        select: { id: true },
      }),
      this.prisma.evaluation.findMany({
        where: { universityId, rubricId, studentId, sectionId, classSessionId: { not: null }, scorePercent: { not: null } },
        select: { classSessionId: true, scorePercent: true, criticalFailed: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { studentId, classSession: { sectionId }, status: { in: ['ABSENT', 'LEAVE', 'EXCUSED'] } },
        select: { classSessionId: true },
      }),
      this.prisma.evaluation.findFirst({
        where: { universityId, rubricId, studentId, sectionId, classSessionId: null },
        select: { id: true },
      }),
    ]);
    const dayIds = new Set(sessions.map((x) => x.id));
    const days = dayEvals.filter((d) => d.classSessionId && dayIds.has(d.classSessionId));
    const assessed = new Set(days.map((d) => d.classSessionId));
    const missed = new Set(absences.map((a) => a.classSessionId).filter((id) => !assessed.has(id)));
    const countedDays = sessions.filter((x) => !missed.has(x.id)).length;

    if (days.length === 0 || countedDays === 0) {
      if (existing) await this.prisma.evaluation.delete({ where: { id: existing.id } });
      return null;
    }
    const scorePercent = Math.round((days.reduce((a, d) => a + (d.scorePercent ?? 0), 0) / countedDays) * 100) / 100;
    const data = {
      ...(actor && { evaluatorId: actor.id, evaluatorName: actor.name }),
      status: 'SUBMITTED' as const, scorePercent,
      criticalFailed: days.some((d) => d.criticalFailed), rawScore: null, rawMax: null,
      note: `${days.length} of ${countedDays} practice days assessed`,
    };
    if (existing) await this.prisma.evaluation.update({ where: { id: existing.id }, data });
    else await this.prisma.evaluation.create({ data: { universityId, rubricId, studentId, sectionId, ...data } });
    return { scorePercent, sessions: days.length, countedDays };
  }

  /**
   * Recompute every daily component in a section (or for one student in it)
   * — after something that changes how many days count: a day taken in or
   * out of daily assessment, or attendance marked absent/present.
   */
  async refreshDailyComponentsForSection(universityId: string, sectionId: string, studentId?: string) {
    const pairs = await this.prisma.evaluation.findMany({
      where: { universityId, sectionId, classSessionId: { not: null }, ...(studentId && { studentId }), rubric: { perSession: true } },
      select: { rubricId: true, studentId: true },
      distinct: ['rubricId', 'studentId'],
    });
    for (const p of pairs) await this.refreshDailyComponent(universityId, p.rubricId, p.studentId, sectionId);
    return pairs.length;
  }

  /** Recompute every daily component everywhere — run once at startup so a change of formula reaches existing scores. */
  async refreshAllDailyComponents() {
    const pairs = await this.prisma.evaluation.findMany({
      where: { classSessionId: { not: null }, sectionId: { not: null }, rubric: { perSession: true } },
      select: { universityId: true, rubricId: true, studentId: true, sectionId: true },
      distinct: ['universityId', 'rubricId', 'studentId', 'sectionId'],
    });
    for (const p of pairs) await this.refreshDailyComponent(p.universityId, p.rubricId, p.studentId, p.sectionId!);
    return pairs.length;
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
      ? await this.refreshDailyComponent(universityId, dto.rubricId, dto.studentId, dto.sectionId, { id: userId, name: userName })
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

  /**
   * How far each student is through a section's daily (per-session) rubrics:
   * days assessed vs. days that count — every practice day of the section,
   * past or upcoming, less any the student missed (absent/leave) and wasn't
   * assessed on anyway. Same rule as refreshDailyComponent. A daily
   * component is only finished once assessed >= counted; until then its
   * stored score is a running total and the term grade must stay withheld.
   * Keyed `${studentId}|${rubricId}`.
   */
  private async dailyProgress(universityId: string, sectionId: string, rubricIds: string[], studentId?: string) {
    const out = new Map<string, { assessed: number; counted: number }>();
    if (rubricIds.length === 0) return out;
    const sessions = await this.prisma.classSession.findMany({
      where: { sectionId, status: { not: 'CANCELLED' }, dailyAssessment: true },
      select: { id: true },
    });
    const ids = sessions.map((x) => x.id);
    const [dayEvals, absences, enrolled] = await Promise.all([
      this.prisma.evaluation.findMany({
        where: { universityId, sectionId, rubricId: { in: rubricIds }, classSessionId: { in: ids }, scorePercent: { not: null }, ...(studentId && { studentId }) },
        select: { studentId: true, rubricId: true, classSessionId: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { classSessionId: { in: ids }, status: { in: ['ABSENT', 'LEAVE', 'EXCUSED'] }, ...(studentId && { studentId }) },
        select: { studentId: true, classSessionId: true },
      }),
      studentId ? Promise.resolve([{ studentId }]) : this.prisma.enrollment.findMany({ where: { sectionId, status: 'ENROLLED' }, select: { studentId: true } }),
    ]);
    const assessed = new Set(dayEvals.map((e) => `${e.studentId}|${e.rubricId}|${e.classSessionId}`));
    for (const { studentId: st } of enrolled) {
      const missed = new Set(absences.filter((a) => a.studentId === st).map((a) => a.classSessionId));
      for (const rb of rubricIds) {
        const done = ids.filter((id) => assessed.has(`${st}|${rb}|${id}`)).length;
        const counted = ids.filter((id) => !missed.has(id) || assessed.has(`${st}|${rb}|${id}`)).length;
        out.set(`${st}|${rb}`, { assessed: done, counted });
      }
    }
    return out;
  }

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
    let subjectId: string | undefined;
    if (sectionId) {
      const section = await this.prisma.section.findFirst({ where: { id: sectionId, universityId, deletedAt: null }, select: { subjectId: true } });
      subjectId = section?.subjectId;
      resolved = section ? await this.resolveSubjectRubrics(universityId, section.subjectId) : [];
    } else {
      resolved = (await this.listRubrics(universityId)).map((r) => ({ rubric: r, weightPercent: r.weightPercent }));
    }

    const dailyIds = resolved.filter((r) => r.rubric.perSession).map((r) => r.rubric.id);
    const [evaluations, scheme, progress] = await Promise.all([
      this.prisma.evaluation.findMany({ where: { universityId, studentId, sectionId: sectionId ?? null, classSessionId: null }, select: { rubricId: true, scorePercent: true, criticalFailed: true } }),
      this.gradeScheme(universityId, subjectId),
      sectionId ? this.dailyProgress(universityId, sectionId, dailyIds, studentId) : Promise.resolve(new Map<string, { assessed: number; counted: number }>()),
    ]);
    const evalByRubric = new Map(evaluations.map((e) => [e.rubricId, e]));

    const rows = resolved.map(({ rubric: r, weightPercent }) => {
      const ev = evalByRubric.get(r.id);
      const scorePercent = ev?.scorePercent ?? null;
      const days = r.perSession ? progress.get(`${studentId}|${r.id}`) ?? null : null;
      return {
        rubricId: r.id, nameEn: r.nameEn, nameTh: r.nameTh, weightPercent,
        scorePercent, graded: scorePercent != null, criticalFailed: ev?.criticalFailed ?? false,
        contribution: scorePercent != null ? Math.round((weightPercent / 100) * scorePercent * 100) / 100 : 0,
        // A daily component is finished only once every practice day that counts is assessed.
        days, complete: scorePercent != null && (!days || days.assessed >= days.counted),
      };
    });
    const total = Math.round(rows.reduce((a, r) => a + r.contribution, 0) * 100) / 100;
    const gradedWeight = rows.filter((r) => r.graded).reduce((a, r) => a + r.weightPercent, 0);
    // Only assign a letter grade once every applicable rubric is finished — see sectionSummary.
    const isComplete = rows.length > 0 && rows.every((r) => r.complete);
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

    const dailyIds = resolved.filter((r) => r.rubric.perSession).map((r) => r.rubric.id);
    const [enrollments, evaluations, scheme, estimates, progress] = await Promise.all([
      this.prisma.enrollment.findMany({ where: { sectionId, status: 'ENROLLED' }, select: { studentId: true, student: { select: { studentCode: true, nameEn: true, nameTh: true } } }, orderBy: { student: { studentCode: 'asc' } } }),
      this.prisma.evaluation.findMany({ where: { universityId, sectionId, classSessionId: null }, select: { studentId: true, rubricId: true, scorePercent: true, criticalFailed: true } }),
      this.gradeScheme(universityId, section.subjectId),
      this.estimateGrades(universityId, sectionId, section.subjectId),
      this.dailyProgress(universityId, sectionId, dailyIds),
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
      // A daily component has a score from its first day on, but it is a running
      // total until every practice day that counts is assessed — it isn't finished
      // (and doesn't count towards gradedCount) before then.
      const days = dailyIds.map((rb) => progress.get(`${en.studentId}|${rb}`)).filter((p): p is { assessed: number; counted: number } => !!p);
      const dayDone = (rubricId: string) => {
        const p = progress.get(`${en.studentId}|${rubricId}`);
        return !p || p.assessed >= p.counted;
      };
      const finished = evs.filter((e) => e.scorePercent != null && dayDone(e.rubricId)).length;
      const isComplete = resolved.length > 0 && finished >= resolved.length;
      const band = isComplete ? this.gradeFor(total, scheme.bands) : null;
      return {
        studentId: en.studentId, studentCode: en.student.studentCode, nameEn: en.student.nameEn, nameTh: en.student.nameTh,
        total, gradedWeight, gradedCount: finished, hasCriticalFail: evs.some((e) => e.criticalFailed),
        // Practice days assessed / counted, summed over the daily components — what "in progress" is waiting on.
        days: days.length ? { assessed: days.reduce((a, p) => a + p.assessed, 0), counted: days.reduce((a, p) => a + p.counted, 0) } : null,
        isComplete, grade: band?.grade ?? null, gpa: band?.gpa ?? null,
        // Only while the grade is still withheld — an estimate, labelled as such.
        estimate: isComplete ? null : estimates.get(en.studentId) ?? null,
      };
    });

    return { section, rubricCount: resolved.length, students };
  }

  /**
   * Daily ward-assessment report of a section, for one per-session rubric
   * (e.g. Nursing performance): every practice day with how many students
   * were assessed and the spread of scores, and a student × day grid with
   * each day's score, its breakdown by rubric section, who assessed it and
   * when — plus each student's running component score as the gradebook
   * holds it. `rubricId` picks among several daily rubrics; the first by
   * order is used otherwise.
   */
  async dailyReport(user: AuthenticatedUser, sectionId: string, rubricId?: string) {
    const universityId = user.universityId;
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, universityId, deletedAt: null },
      select: {
        id: true, sectionNo: true, subjectId: true,
        subject: { select: { code: true, nameEn: true, nameTh: true } },
        semester: { select: { nameEn: true, nameTh: true } },
        lecturer: { select: { nameEn: true, nameTh: true } },
        room: { select: { roomNumber: true } },
      },
    });
    if (!section) throw new NotFoundException('Section not found');
    await this.lecturerScope.assertTeachesOrManages(user, sectionId);
    const { subjectId, ...sectionOut } = section;

    const daily = (await this.resolveSubjectRubrics(universityId, subjectId)).filter((r) => r.rubric.perSession);
    const rubrics = daily.map(({ rubric, weightPercent }) => ({ id: rubric.id, nameEn: rubric.nameEn, nameTh: rubric.nameTh, weightPercent }));
    const chosen = daily.find((r) => r.rubric.id === rubricId) ?? daily[0];
    if (!chosen) return { section: sectionOut, rubrics, rubric: null, days: [], students: [], totals: null };
    const { rubric: r, weightPercent } = chosen;

    const [sessions, enrollments, estimates] = await Promise.all([
      this.prisma.classSession.findMany({
        where: { sectionId, status: { not: 'CANCELLED' }, dailyAssessment: true },
        select: { id: true, sessionDate: true, startTime: true, endTime: true, topic: true },
        orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.enrollment.findMany({
        where: { sectionId, status: 'ENROLLED' },
        select: { student: { select: { id: true, studentCode: true, nameEn: true, nameTh: true } } },
        orderBy: { student: { studentCode: 'asc' } },
      }),
      this.estimateGrades(universityId, sectionId, subjectId),
    ]);
    const sessionIds = sessions.map((x) => x.id);
    const studentIds = enrollments.map((e) => e.student.id);
    const [dayEvals, components, attendance] = await Promise.all([
      this.prisma.evaluation.findMany({
        where: { universityId, rubricId: r.id, sectionId, classSessionId: { in: sessionIds }, studentId: { in: studentIds } },
        select: {
          studentId: true, classSessionId: true, scorePercent: true, criticalFailed: true, note: true,
          rawScore: true, rawMax: true, evaluatorId: true, evaluatorName: true, updatedAt: true,
          scores: { select: { rubricItemId: true, rating: true, passed: true } },
        },
      }),
      this.prisma.evaluation.findMany({
        where: { universityId, rubricId: r.id, sectionId, classSessionId: null, studentId: { in: studentIds } },
        select: { studentId: true, scorePercent: true },
      }),
      this.prisma.attendanceRecord.findMany({
        where: { classSessionId: { in: sessionIds }, studentId: { in: studentIds } },
        select: { studentId: true, classSessionId: true, status: true },
      }),
    ]);

    // Who assessed: the lecturer's name, else the login's display name, else its email.
    const evaluatorIds = [...new Set(dayEvals.map((e) => e.evaluatorId).filter((x): x is string => !!x))];
    const users = evaluatorIds.length === 0 ? [] : await this.prisma.user.findMany({
      where: { id: { in: evaluatorIds }, universityId },
      select: { id: true, email: true, metadata: true, lecturer: { select: { nameEn: true, nameTh: true } } },
    });
    const people = new Map(users.map((u) => {
      const dn = displayNameOf(u.metadata);
      return [u.id, { email: u.email, nameEn: u.lecturer?.nameEn ?? dn, nameTh: u.lecturer?.nameTh ?? (u.lecturer ? null : dn) }];
    }));
    type Evaluator = { key: string; email: string | null; nameEn: string | null; nameTh: string | null };
    const evaluatorOf = (e: { evaluatorId: string | null; evaluatorName: string | null }): Evaluator => {
      const p = e.evaluatorId ? people.get(e.evaluatorId) : undefined;
      const email = p?.email ?? (e.evaluatorName?.includes('@') ? e.evaluatorName : null);
      return { key: e.evaluatorId ?? e.evaluatorName ?? '?', email, nameEn: p?.nameEn ?? (email ? null : e.evaluatorName), nameTh: p?.nameTh ?? null };
    };

    const k = (studentId: string, sessionId: string) => `${studentId}|${sessionId}`;
    const evalBy = new Map(dayEvals.map((e) => [k(e.studentId, e.classSessionId!), e]));
    const attBy = new Map(attendance.map((a) => [k(a.studentId, a.classSessionId), a.status]));
    const compBy = new Map(components.map((c) => [c.studentId, c.scorePercent]));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const mean = (xs: number[]) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

    type CellStatus = 'SCORED' | 'ABSENT' | 'LEAVE' | 'PENDING' | 'UPCOMING';
    const days0 = sessions.map((s) => ({ s, date: s.sessionDate.toISOString().slice(0, 10) }));
    const students = enrollments.map(({ student }) => {
      const cells = days0.map(({ s, date }) => {
        const e = evalBy.get(k(student.id, s.id));
        const att = attBy.get(k(student.id, s.id));
        if (e && e.scorePercent != null) {
          const ratings = new Map(e.scores.map((x) => [x.rubricItemId, x.rating]));
          // A day marked item by item breaks down by category; one entered as a single
          // overall score (a raw mark or a percentage) has nothing to break down.
          const itemized = ratings.size > 0;
          return {
            status: 'SCORED' as CellStatus, scorePercent: e.scorePercent, criticalFailed: e.criticalFailed, note: e.note,
            rawScore: e.rawScore, rawMax: e.rawMax, itemized,
            sectionScores: itemized ? r.sections.map((sec) => { const p = AssessmentService.sectionPercent(sec, ratings); return p == null ? null : r1(p); }) : null,
            ratings: Object.fromEntries(ratings),
            failedCritical: e.scores.filter((x) => x.passed === false).map((x) => x.rubricItemId),
            evaluator: evaluatorOf(e), at: e.updatedAt.toISOString(), attendance: att ?? null,
          };
        }
        const status: CellStatus = att === 'ABSENT' ? 'ABSENT' : att === 'LEAVE' || att === 'EXCUSED' ? 'LEAVE' : date > today ? 'UPCOMING' : 'PENDING';
        return { status, scorePercent: null, criticalFailed: false, note: null, rawScore: null, rawMax: null, itemized: false, sectionScores: null, ratings: null, failedCritical: [], evaluator: null, at: null, attendance: att ?? null };
      });
      const scored = cells.filter((c) => c.status === 'SCORED').map((c) => c.scorePercent!);
      // Same rule as refreshDailyComponent: a day missed (absent/leave) and not assessed doesn't count.
      const countedDays = cells.filter((c) => c.status !== 'ABSENT' && c.status !== 'LEAVE').length;
      const component = compBy.get(student.id) ?? null;
      return {
        studentId: student.id, studentCode: student.studentCode, nameEn: student.nameEn, nameTh: student.nameTh,
        cells, assessedDays: scored.length, countedDays,
        pendingDays: cells.filter((c) => c.status === 'PENDING').length,
        missedDays: cells.filter((c) => c.status === 'ABSENT' || c.status === 'LEAVE').length,
        dayAverage: mean(scored),
        // The category averages rest only on the itemised days — say how many.
        itemizedDays: cells.filter((c) => c.itemized).length,
        sectionAverages: r.sections.map((_, si) => mean(cells.map((c) => c.sectionScores?.[si]).filter((x): x is number => x != null))),
        component, points: component != null ? r2((component * weightPercent) / 100) : null,
        criticalFailed: cells.some((c) => c.criticalFailed),
        estimate: estimates.get(student.id) ?? null,
      };
    });

    const days = days0.map(({ s, date }, di) => {
      const col = students.map((st) => st.cells[di]);
      const scores = col.filter((c) => c.status === 'SCORED').map((c) => c.scorePercent!);
      const tally = new Map<string, Evaluator & { count: number }>();
      for (const c of col) {
        if (!c.evaluator) continue;
        const cur = tally.get(c.evaluator.key);
        if (cur) cur.count++; else tally.set(c.evaluator.key, { ...c.evaluator, count: 1 });
      }
      return {
        sessionId: s.id, date, startTime: s.startTime, endTime: s.endTime, topic: s.topic, upcoming: date > today,
        enrolled: students.length, assessed: scores.length,
        absent: col.filter((c) => c.status === 'ABSENT').length,
        leave: col.filter((c) => c.status === 'LEAVE').length,
        pending: col.filter((c) => c.status === 'PENDING').length,
        average: mean(scores),
        min: scores.length ? r1(Math.min(...scores)) : null,
        max: scores.length ? r1(Math.max(...scores)) : null,
        criticalFails: col.filter((c) => c.criticalFailed).length,
        itemized: col.filter((c) => c.itemized).length,
        sectionAverages: r.sections.map((_, si) => mean(col.map((c) => c.sectionScores?.[si]).filter((x): x is number => x != null))),
        evaluators: [...tally.values()].sort((a, b) => b.count - a.count),
      };
    });

    const allScores = students.flatMap((st) => st.cells.filter((c) => c.status === 'SCORED').map((c) => c.scorePercent!));
    const totals = {
      practiceDays: days.length,
      daysAssessed: days.filter((d) => d.assessed > 0).length,
      assessments: allScores.length,
      itemizedAssessments: students.reduce((a, st) => a + st.itemizedDays, 0),
      pending: days.reduce((a, d) => a + d.pending, 0),
      average: mean(allScores),
      threshold: 70,
      studentsBelow: students.filter((st) => st.dayAverage != null && st.dayAverage < 70).length,
    };
    return {
      section: sectionOut, rubrics,
      rubric: {
        id: r.id, nameEn: r.nameEn, nameTh: r.nameTh, weightPercent,
        sections: r.sections.map((sec) => ({
          id: sec.id, nameEn: sec.nameEn, nameTh: sec.nameTh, weightPercent: sec.weightPercent,
          items: sec.items.map((it) => ({ id: it.id, textEn: it.textEn, textTh: it.textTh, maxRating: it.maxRating, isCritical: it.isCritical })),
        })),
      },
      days, students, totals,
    };
  }

  /** The daily ward-assessment report as an Excel workbook — summary, grid, category averages and every item mark. */
  async dailyReportXlsx(user: AuthenticatedUser, sectionId: string, rubricId?: string): Promise<{ buffer: Buffer; filename: string }> {
    const d = await this.dailyReport(user, sectionId, rubricId);
    const wb = new ExcelJS.Workbook();
    const head = (row: ExcelJS.Row) => {
      row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7C7B' } }; });
    };
    const nm = (x: { nameEn: string | null; nameTh: string | null }) => x.nameTh ?? x.nameEn ?? '';
    const sname = (s: { nameEn: string; nameTh: string | null }) => (s.nameTh ? `${s.nameTh} (${s.nameEn})` : s.nameEn);
    const who = (e: { email: string | null; nameEn: string | null; nameTh: string | null } | null) => (e ? nm(e) || e.email || '' : '');
    const at = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(iso)) : '');
    const title = `${d.section.subject.code} ${d.section.subject.nameEn} · Sec ${d.section.sectionNo}`;
    const filename = `daily-assessment-${d.section.subject.code}-sec${d.section.sectionNo}.xlsx`;
    const summary = wb.addWorksheet('Daily summary');
    summary.addRow([title]); summary.getRow(1).font = { bold: true, size: 13 };
    if (!d.rubric || !d.totals) {
      summary.addRow(['This subject has no daily (per-session) assessment component.']);
      return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename };
    }
    const rb = d.rubric;
    summary.addRow([`${nm(rb)} — ${rb.weightPercent}% of the grade · average daily score ${d.totals.average ?? '-'}% · ${d.totals.assessments} assessment(s) over ${d.totals.daysAssessed} of ${d.totals.practiceDays} practice days · ${d.totals.studentsBelow} student(s) averaging below ${d.totals.threshold}%`]);
    summary.addRow([]);
    head(summary.addRow(['Date', 'Time', 'Topic', 'Enrolled', 'Assessed', 'Absent', 'Leave', 'Pending', 'Average %', 'Min %', 'Max %', 'Critical fails', ...rb.sections.map((s) => `${nm(s)} %`), 'Assessed by']));
    for (const x of d.days) {
      summary.addRow([x.date, `${x.startTime}-${x.endTime}`, x.topic ?? '', x.enrolled, x.assessed, x.absent, x.leave, x.upcoming ? 'upcoming' : x.pending,
        x.average ?? '', x.min ?? '', x.max ?? '', x.criticalFails, ...x.sectionAverages.map((v) => v ?? ''),
        x.evaluators.map((e) => `${who(e)} (${e.count})`).join('; ')]);
    }
    [12, 12, 24, 9, 9, 8, 8, 9, 10, 8, 8, 10, ...rb.sections.map(() => 14), 40].forEach((w, i) => { summary.getColumn(i + 1).width = w; });

    const sym: Record<string, string> = { ABSENT: 'Absent', LEAVE: 'Leave', PENDING: '', UPCOMING: '' };
    const grid = wb.addWorksheet('Students x days');
    head(grid.addRow(['No.', 'Student ID', 'Name', ...d.days.map((x) => x.date.slice(5)), 'Days assessed', 'Daily average %', `Component % (${rb.weightPercent})`, `Points / ${rb.weightPercent}`, 'Estimated total % (provisional)', 'Estimated grade (provisional)', 'Estimate based on % of grade']));
    d.students.forEach((s, i) => {
      const row = grid.addRow([i + 1, s.studentCode, sname(s), ...s.cells.map((c) => (c.status === 'SCORED' ? c.scorePercent : sym[c.status])),
        `${s.assessedDays}/${s.countedDays}`, s.dayAverage ?? '', s.component ?? '', s.points ?? '',
        s.estimate?.estimate ?? '', s.estimate?.grade ?? '', s.estimate ? `${s.estimate.basisWeight}/${s.estimate.totalWeight}` : '']);
      s.cells.forEach((c, ci) => {
        if (c.status === 'SCORED' && c.scorePercent! < d.totals!.threshold) row.getCell(4 + ci).font = { bold: true, color: { argb: 'FFC0392B' } };
      });
    });
    grid.addRow([]);
    grid.addRow(['', '', 'Daily average = mean of the days assessed. Component = sum of day scores ÷ days that count (absent/leave days excluded), as in the gradebook. Estimated grade = PROVISIONAL: the level so far (daily component at its daily average) applied to the whole grade, over the components assessed so far — not the final grade.']);
    grid.getColumn(1).width = 5; grid.getColumn(2).width = 11; grid.getColumn(3).width = 36;
    for (let i = 0; i < d.days.length; i++) grid.getColumn(4 + i).width = 8;
    grid.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];

    const cat = wb.addWorksheet('Category averages');
    head(cat.addRow(['No.', 'Student ID', 'Name', ...rb.sections.map((s) => `${nm(s)} (${Math.round(s.weightPercent * 100) / 100}%)`), 'Based on itemised days', 'Daily average % (all days)']));
    d.students.forEach((s, i) => cat.addRow([i + 1, s.studentCode, sname(s), ...s.sectionAverages.map((v) => v ?? ''), `${s.itemizedDays}/${s.assessedDays}`, s.dayAverage ?? '']));
    cat.addRow([]);
    cat.addRow(['', '', 'Category averages use only the days scored item by item; a day entered as one overall score has no category breakdown.']);
    cat.getColumn(1).width = 5; cat.getColumn(2).width = 11; cat.getColumn(3).width = 36;
    rb.sections.forEach((_, i) => { cat.getColumn(4 + i).width = 18; });
    cat.getColumn(4 + rb.sections.length).width = 14;

    const detail = wb.addWorksheet('Daily detail');
    head(detail.addRow(['Date', 'Student ID', 'Name', 'Attendance', 'Score %', 'Entered as', ...rb.sections.map((s) => `${nm(s)} %`), 'Critical fail', 'Assessed by', 'Login email', 'Saved at', 'Note']));
    d.days.forEach((x, di) => {
      for (const s of d.students) {
        const c = s.cells[di];
        if (c.status === 'PENDING' || c.status === 'UPCOMING') continue;
        detail.addRow([x.date, s.studentCode, s.nameTh ?? s.nameEn, c.attendance ?? '', c.scorePercent ?? (c.status === 'ABSENT' ? 'Absent' : 'Leave'),
          c.status !== 'SCORED' ? '' : c.itemized ? 'Item by item' : c.rawScore != null ? `Overall score ${c.rawScore}/${c.rawMax}` : 'Overall score',
          ...rb.sections.map((_, si) => c.sectionScores?.[si] ?? ''), c.criticalFailed ? 'YES' : '', who(c.evaluator), c.evaluator?.email ?? '', at(c.at), c.note ?? '']);
      }
    });
    [12, 11, 30, 11, 9, 20, ...rb.sections.map(() => 14), 10, 26, 28, 16, 40].forEach((w, i) => { detail.getColumn(i + 1).width = w; });
    detail.views = [{ state: 'frozen', ySplit: 1 }];

    const items = wb.addWorksheet('Item marks');
    head(items.addRow(['Date', 'Student ID', 'Name', 'Category', 'Item', 'Mark', 'Out of', 'Critical']));
    d.days.forEach((x, di) => {
      for (const s of d.students) {
        const c = s.cells[di];
        if (!c.ratings) continue;
        for (const sec of rb.sections) {
          for (const it of sec.items) {
            const v = c.ratings[it.id];
            if (v == null) continue;
            items.addRow([x.date, s.studentCode, s.nameTh ?? s.nameEn, nm(sec), it.textTh ?? it.textEn, v, it.maxRating,
              it.isCritical ? (c.failedCritical.includes(it.id) ? 'NOT PASSED' : 'passed') : '']);
          }
        }
      }
    });
    [12, 11, 28, 24, 60, 7, 7, 11].forEach((w, i) => { items.getColumn(i + 1).width = w; });
    items.views = [{ state: 'frozen', ySplit: 1 }];
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename };
  }
}
