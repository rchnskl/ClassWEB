import { AssessmentService } from './assessment.service';

/**
 * Unit tests for the pure scoring/grading math. These two private methods
 * are the core of the whole gradebook — a silent bug here means wrong
 * grades, so they get direct coverage independent of the database.
 */
describe('AssessmentService (pure scoring logic)', () => {
  // scoreRubric/gradeFor are private; tests call them via a typed cast,
  // same technique used elsewhere in this codebase for direct verification.
  const service = new AssessmentService({} as any) as any;

  function rubric(sections: { weightPercent: number; items: { id: string; weightPercent: number; maxRating: number; isCritical?: boolean }[] }[]) {
    return { sections };
  }
  const noPass = new Map<string, boolean>();

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

    it('treats an unrated item as zero, not as excluded from the denominator', () => {
      const r = rubric([{ weightPercent: 100, items: [
        { id: 'a', weightPercent: 50, maxRating: 5 },
        { id: 'b', weightPercent: 50, maxRating: 5 },
      ] }]);
      // only "a" rated; "b" contributes nothing (not re-normalised to 100%)
      expect(service.scoreRubric(r, new Map([['a', 5]]), noPass).scorePercent).toBe(50);
    });

    it('applies section weight as a fraction of 100, not additively', () => {
      const r = rubric([
        { weightPercent: 30, items: [{ id: 'a', weightPercent: 100, maxRating: 5 }] },
        { weightPercent: 70, items: [{ id: 'b', weightPercent: 100, maxRating: 5 }] },
      ]);
      // only section a fully scored: 30% of 100 = 30
      expect(service.scoreRubric(r, new Map([['a', 5]]), noPass).scorePercent).toBe(30);
    });

    it('returns 0 for a rubric with no ratings at all', () => {
      const r = rubric([{ weightPercent: 100, items: [{ id: 'a', weightPercent: 100, maxRating: 5 }] }]);
      expect(service.scoreRubric(r, new Map(), noPass).scorePercent).toBe(0);
    });

    it('supports non-5 maxRating scales', () => {
      const r = rubric([{ weightPercent: 100, items: [{ id: 'a', weightPercent: 100, maxRating: 10 }] }]);
      expect(service.scoreRubric(r, new Map([['a', 7]]), noPass).scorePercent).toBe(70);
    });

    it('ignores a rating of 0 (falsy) the same as unrated', () => {
      const r = rubric([{ weightPercent: 100, items: [{ id: 'a', weightPercent: 100, maxRating: 5 }] }]);
      expect(service.scoreRubric(r, new Map([['a', 0]]), noPass).scorePercent).toBe(0);
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
