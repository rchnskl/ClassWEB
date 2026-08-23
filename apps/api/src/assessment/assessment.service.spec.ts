import { AssessmentService } from './assessment.service';

/**
 * Unit tests for the pure scoring/grading math. These two private methods
 * are the core of the whole gradebook — a silent bug here means wrong
 * grades, so they get direct coverage independent of the database.
 */
describe('AssessmentService (pure scoring logic)', () => {
  // scoreRubric/gradeFor are private; tests call them via a typed cast,
  // same technique used elsewhere in this codebase for direct verification.
  const service = new AssessmentService({} as any, {} as any) as any;

  function rubric(sections: { weightPercent: number; items: { id: string; weightPercent: number; maxRating: number; isCritical?: boolean }[] }[]) {
    return { sections };
  }
  const noPass = new Map<string, boolean>();

  describe('resolveWeights', () => {
    const dto = (sections: { items: { maxRating?: number }[] }[]) => ({
      sections: sections.map((s, i) => ({ nameEn: `S${i}`, items: s.items.map((it, j) => ({ textEn: `I${j}`, ...it })) })),
    });

    it('keeps a weight that was entered, whatever the full marks say', () => {
      // A 50-mark midterm worth 15%: the marks scale the score, the 15% caps
      // what it can contribute — the two numbers are set independently.
      const [s] = service.resolveWeights({
        sections: [{ nameEn: 'Midterm', weightPercent: 15, items: [{ textEn: 'Paper', maxRating: 50, weightPercent: 100 }] }],
      });
      expect(s.weightPercent).toBe(15);
      expect(s.items[0].weightPercent).toBe(100);
    });

    it('falls back to the marks split only where no weight was given', () => {
      const out = service.resolveWeights({
        sections: [
          { nameEn: 'Given', weightPercent: 15, items: [{ textEn: 'a', maxRating: 50 }] },
          { nameEn: 'Derived', items: [{ textEn: 'b', maxRating: 10 }, { textEn: 'c', maxRating: 30 }] },
        ],
      });
      expect(out[0].weightPercent).toBe(15);
      // 40 of the 90 total marks
      expect(out[1].weightPercent).toBeCloseTo((40 / 90) * 100, 10);
      expect(out[1].items.map((i: { weightPercent: number }) => i.weightPercent)).toEqual([25, 75]);
    });

    it('splits a section by each item\'s full mark', () => {
      const [s] = service.resolveWeights(dto([{ items: [{ maxRating: 30 }, { maxRating: 10 }] }]));
      expect(s.weightPercent).toBe(100);
      expect(s.items.map((i: { weightPercent: number }) => i.weightPercent)).toEqual([75, 25]);
    });

    it('weights sections by their share of the total full marks', () => {
      const out = service.resolveWeights(dto([
        { items: [{ maxRating: 60 }] },
        { items: [{ maxRating: 20 }, { maxRating: 20 }] },
      ]));
      expect(out.map((s: { weightPercent: number }) => s.weightPercent)).toEqual([60, 40]);
    });

    it('defaults a missing full mark to 5', () => {
      const [s] = service.resolveWeights(dto([{ items: [{}, { maxRating: 15 }] }]));
      expect(s.items.map((i: { weightPercent: number }) => i.weightPercent)).toEqual([25, 75]);
    });

    it('always totals 100% across sections', () => {
      const out = service.resolveWeights(dto([
        { items: [{ maxRating: 7 }, { maxRating: 3 }] },
        { items: [{ maxRating: 11 }] },
        { items: [{ maxRating: 2 }] },
      ]));
      expect(out.reduce((a: number, s: { weightPercent: number }) => a + s.weightPercent, 0)).toBeCloseTo(100, 10);
    });

    it('caps a section at its own weight however many marks it holds', () => {
      // 15% section (50 marks) + 85% section (5 marks). Full marks on the
      // midterm alone must contribute 15, not the 50/55 its marks suggest.
      const r = {
        sections: [
          { weightPercent: 15, items: [{ id: 'mid', weightPercent: 100, maxRating: 50, isCritical: false }] },
          { weightPercent: 85, items: [{ id: 'other', weightPercent: 100, maxRating: 5, isCritical: false }] },
        ],
      };
      const both = service.scoreRubric(r, new Map([['mid', 50], ['other', 0]]), noPass);
      expect(both.scorePercent).toBe(15);
    });

    it('makes the rubric score equal marks earned out of total full marks when weights follow the marks', () => {
      // 10 + 20 + 20 = 50 marks available; the student takes 5 + 20 + 10 = 35.
      const sections = service.resolveWeights(dto([
        { items: [{ maxRating: 10 }, { maxRating: 20 }] },
        { items: [{ maxRating: 20 }] },
      ]));
      const withIds = {
        sections: sections.map((s: any, si: number) => ({
          ...s,
          items: s.items.map((it: any, ii: number) => ({ ...it, id: `${si}-${ii}`, isCritical: false })),
        })),
      };
      const ratings = new Map([['0-0', 5], ['0-1', 20], ['1-0', 10]]);
      expect(service.scoreRubric(withIds, ratings, noPass).scorePercent).toBe(70); // 35/50
    });
  });

  describe('scoreRubric', () => {
    it('gives full marks (100) when every item is rated at its max', () => {
      const r = rubric([
        { weightPercent: 60, items: [{ id: 'a', weightPercent: 100, maxRating: 5 }] },
        { weightPercent: 40, items: [{ id: 'b', weightPercent: 100, maxRating: 5 }] },
      ]);
      const ratings = new Map([['a', 5], ['b', 5]]);
      expect(service.scoreRubric(r, ratings, noPass)).toEqual({ scorePercent: 100, criticalFailed: false });
    });

    it('scales proportionally to rating/maxRating within an item', () => {
      const r = rubric([{ weightPercent: 100, items: [{ id: 'a', weightPercent: 100, maxRating: 5 }] }]);
      // 3/5 of max -> 60% of the section's weight
      expect(service.scoreRubric(r, new Map([['a', 3]]), noPass).scorePercent).toBe(60);
    });

    it('combines multiple weighted items within a section correctly', () => {
      const r = rubric([
        { weightPercent: 100, items: [
          { id: 'a', weightPercent: 50, maxRating: 5 },
          { id: 'b', weightPercent: 50, maxRating: 5 },
        ] },
      ]);
      // a: 5/5 -> 50 pts, b: 0/5 -> 0 pts => 50 total
      expect(service.scoreRubric(r, new Map([['a', 5], ['b', 0]]), noPass).scorePercent).toBe(50);
    });

    // Deliberate reversal of the original rule ("an unrated item scores 0").
    // The lab exam is sat two ways — every procedure, or one drawn at random —
    // and one checklist has to serve both. Under the old rule a student who
    // drew a single procedure and performed it perfectly was capped at that
    // procedure's share of the form. An unrated item is therefore "not
    // examined" and leaves the denominator; the cost is that forgetting to
    // grade an item no longer shows up as a low score, which is instead
    // surfaced by the isComplete / gradedWeight signals on the summary.
    it('excludes an unrated item from the denominator rather than scoring it 0', () => {
      const r = rubric([{ weightPercent: 100, items: [
        { id: 'a', weightPercent: 50, maxRating: 5 },
        { id: 'b', weightPercent: 50, maxRating: 5 },
      ] }]);
      // only "a" rated, and rated at max -> full marks for what was examined
      expect(service.scoreRubric(r, new Map([['a', 5]]), noPass).scorePercent).toBe(100);
    });

    it('applies section weight as a fraction of 100, not additively', () => {
      const r = rubric([
        { weightPercent: 30, items: [{ id: 'a', weightPercent: 100, maxRating: 5 }] },
        { weightPercent: 70, items: [{ id: 'b', weightPercent: 100, maxRating: 5 }] },
      ]);
      // both sections examined: 0.3*100 + 0.7*60 = 72
      expect(service.scoreRubric(r, new Map([['a', 5], ['b', 3]]), noPass).scorePercent).toBe(72);
    });

    it('scores only the examined section when the other is skipped entirely', () => {
      const r = rubric([
        { weightPercent: 30, items: [{ id: 'a', weightPercent: 100, maxRating: 5 }] },
        { weightPercent: 70, items: [{ id: 'b', weightPercent: 100, maxRating: 5 }] },
      ]);
      // the 70% section was never drawn, so the 30% one carries the whole score
      expect(service.scoreRubric(r, new Map([['a', 4]]), noPass).scorePercent).toBe(80);
    });

    it('returns 0 for a rubric with no ratings at all', () => {
      const r = rubric([{ weightPercent: 100, items: [{ id: 'a', weightPercent: 100, maxRating: 5 }] }]);
      expect(service.scoreRubric(r, new Map(), noPass).scorePercent).toBe(0);
    });

    it('scores a rubric whose weights were left at 0, using the full marks', () => {
      // What the lecturer hit: a rubric saved with blank percentages scored
      // every student 0, and the sheet showed it as if it were a real mark.
      const r = rubric([{ weightPercent: 0, items: [
        { id: 'a', weightPercent: 0, maxRating: 30 },
        { id: 'b', weightPercent: 0, maxRating: 10 },
      ] }]);
      // 27/30 and 5/10 → 32 of 40 marks.
      expect(service.scoreRubric(r, new Map([['a', 27], ['b', 5]]), noPass).scorePercent).toBe(80);
    });

    it('scores across several zero-weight sections', () => {
      const r = rubric([
        { weightPercent: 0, items: [{ id: 'a', weightPercent: 0, maxRating: 10 }] },
        { weightPercent: 0, items: [{ id: 'b', weightPercent: 0, maxRating: 10 }] },
      ]);
      expect(service.scoreRubric(r, new Map([['a', 10], ['b', 5]]), noPass).scorePercent).toBe(75);
    });

    it('still prefers real weights over the full marks when they are set', () => {
      const r = rubric([{ weightPercent: 100, items: [
        { id: 'a', weightPercent: 90, maxRating: 10 },
        { id: 'b', weightPercent: 10, maxRating: 50 },
      ] }]);
      // Full marks on the lightly weighted item, nothing on the heavy one.
      expect(service.scoreRubric(r, new Map([['a', 0], ['b', 50]]), noPass).scorePercent).toBe(10);
    });

    it('supports non-5 maxRating scales', () => {
      const r = rubric([{ weightPercent: 100, items: [{ id: 'a', weightPercent: 100, maxRating: 10 }] }]);
      expect(service.scoreRubric(r, new Map([['a', 7]]), noPass).scorePercent).toBe(70);
    });

    // An explicit 0 is a real mark, unlike a missing one: the student was
    // examined on this step and scored nothing. It therefore stays in the
    // denominator and drags the score down, where an unrated sibling would
    // simply be skipped.
    it('counts an explicit 0 as a scored item, not as unrated', () => {
      const r = rubric([{ weightPercent: 100, items: [
        { id: 'a', weightPercent: 50, maxRating: 5 },
        { id: 'b', weightPercent: 50, maxRating: 5 },
      ] }]);
      expect(service.scoreRubric(r, new Map([['a', 5], ['b', 0]]), noPass).scorePercent).toBe(50);
      // …whereas leaving 'b' unrated scores only what was examined.
      expect(service.scoreRubric(r, new Map([['a', 5]]), noPass).scorePercent).toBe(100);
    });

    // ---- OSCE-style critical failure -----------------------------------

    it('forces the score to 0 when a critical item is marked not-passed, even with perfect ratings elsewhere', () => {
      const r = rubric([
        { weightPercent: 100, items: [
          { id: 'critical', weightPercent: 20, maxRating: 5, isCritical: true },
          { id: 'normal', weightPercent: 80, maxRating: 5 },
        ] },
      ]);
      const ratings = new Map([['critical', 5], ['normal', 5]]);
      const passed = new Map([['critical', false]]);
      expect(service.scoreRubric(r, ratings, passed)).toEqual({ scorePercent: 0, criticalFailed: true });
    });

    it('does not fail when a critical item is explicitly marked passed', () => {
      const r = rubric([{ weightPercent: 100, items: [{ id: 'critical', weightPercent: 100, maxRating: 5, isCritical: true }] }]);
      const ratings = new Map([['critical', 5]]);
      const passed = new Map([['critical', true]]);
      expect(service.scoreRubric(r, ratings, passed)).toEqual({ scorePercent: 100, criticalFailed: false });
    });

    it('does not fail when a critical item has no explicit passed value (undefined is not false)', () => {
      const r = rubric([{ weightPercent: 100, items: [{ id: 'critical', weightPercent: 100, maxRating: 5, isCritical: true }] }]);
      expect(service.scoreRubric(r, new Map([['critical', 4]]), noPass).criticalFailed).toBe(false);
    });

    it('ignores a not-passed mark on a non-critical item', () => {
      const r = rubric([{ weightPercent: 100, items: [{ id: 'a', weightPercent: 100, maxRating: 5, isCritical: false }] }]);
      const passed = new Map([['a', false]]);
      expect(service.scoreRubric(r, new Map([['a', 5]]), passed)).toEqual({ scorePercent: 100, criticalFailed: false });
    });

    it('one failed critical item among several fails the whole rubric', () => {
      const r = rubric([
        { weightPercent: 50, items: [{ id: 'c1', weightPercent: 100, maxRating: 5, isCritical: true }] },
        { weightPercent: 50, items: [{ id: 'c2', weightPercent: 100, maxRating: 5, isCritical: true }] },
      ]);
      const ratings = new Map([['c1', 5], ['c2', 5]]);
      const passed = new Map([['c1', true], ['c2', false]]);
      expect(service.scoreRubric(r, ratings, passed).criticalFailed).toBe(true);
    });
  });

  describe('gradeFor', () => {
    // Mirrors the faculty's real A–F scale from the seed data.
    const bands = [
      { grade: 'A', gpa: 4.0, label: 'Excellent', minScore: 80 },
      { grade: 'B+', gpa: 3.25, label: 'Very Good', minScore: 75 },
      { grade: 'B', gpa: 3.0, label: 'Good', minScore: 70 },
      { grade: 'C', gpa: 2.0, label: 'Satisfactory', minScore: 60 },
      { grade: 'F', gpa: 0.0, label: 'Failure', minScore: 0 },
    ];

    it('picks the highest band the score clears', () => {
      expect(service.gradeFor(85, bands).grade).toBe('A');
      expect(service.gradeFor(80, bands).grade).toBe('A');
    });

    it('is inclusive at the exact cutoff (>=, not >)', () => {
      expect(service.gradeFor(75, bands).grade).toBe('B+');
      expect(service.gradeFor(74.99, bands).grade).toBe('B');
    });

    it('falls through to the lowest band for a score below every cutoff', () => {
      expect(service.gradeFor(0, bands).grade).toBe('F');
    });

    it('is unaffected by the input order of the bands array', () => {
      const shuffled = [bands[2], bands[0], bands[4], bands[1], bands[3]];
      expect(service.gradeFor(72, shuffled).grade).toBe('B');
    });

    it('never returns null when at least one band exists', () => {
      expect(service.gradeFor(-100, bands)).not.toBeNull();
    });
  });
});
