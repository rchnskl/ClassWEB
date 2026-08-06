import { AttendanceService } from './attendance.service';

/**
 * Unit tests for the attendance rule engine (evaluate/sessionStart) — the
 * logic that decides PRESENT vs LATE vs ABSENT. Constructor deps aren't
 * touched by these pure methods, so stub them out entirely.
 */
describe('AttendanceService (rule engine)', () => {
  const service = new AttendanceService({} as any, {} as any, {} as any) as any;
  const rule = { lateAfterMinutes: 15, autoAbsentAfterMinutes: 60 };

  describe('evaluate', () => {
    it('marks on-time check-in as PRESENT with 0 minutes late', () => {
      const start = new Date('2026-07-10T09:00:00+07:00');
      const result = service.evaluate(rule, start, start);
      expect(result).toEqual({ status: 'PRESENT', minutesLate: 0 });
    });

    it('marks a check-in before the session start as PRESENT (never negative minutes)', () => {
      const start = new Date('2026-07-10T09:00:00+07:00');
      const early = new Date('2026-07-10T08:50:00+07:00');
      const result = service.evaluate(rule, start, early);
      expect(result).toEqual({ status: 'PRESENT', minutesLate: 0 });
    });

    it('is PRESENT exactly at the late threshold (boundary is exclusive of LATE)', () => {
      const start = new Date('2026-07-10T09:00:00+07:00');
      const at = new Date(start.getTime() + 15 * 60000);
      expect(service.evaluate(rule, start, at).status).toBe('PRESENT');
    });

    it('becomes LATE one minute past the threshold', () => {
      const start = new Date('2026-07-10T09:00:00+07:00');
      const at = new Date(start.getTime() + 16 * 60000);
      const result = service.evaluate(rule, start, at);
      expect(result).toEqual({ status: 'LATE', minutesLate: 16 });
    });

    it('stays LATE right up to the auto-absent threshold', () => {
      const start = new Date('2026-07-10T09:00:00+07:00');
      const at = new Date(start.getTime() + 60 * 60000);
      expect(service.evaluate(rule, start, at).status).toBe('LATE');
    });

    it('becomes ABSENT one minute past the auto-absent threshold', () => {
      const start = new Date('2026-07-10T09:00:00+07:00');
      const at = new Date(start.getTime() + 61 * 60000);
      const result = service.evaluate(rule, start, at);
      expect(result).toEqual({ status: 'ABSENT', minutesLate: 61 });
    });

    it('respects a custom (stricter) rule configuration', () => {
      const strict = { lateAfterMinutes: 5, autoAbsentAfterMinutes: 10 };
      const start = new Date('2026-07-10T09:00:00+07:00');
      const at = new Date(start.getTime() + 6 * 60000);
      expect(service.evaluate(strict, start, at).status).toBe('LATE');
    });
  });

  describe('sessionStart', () => {
    it('composes the session date + time into a campus-local (UTC+7) instant', () => {
      const sessionDate = new Date('2026-07-10T00:00:00Z');
      const start = service.sessionStart(sessionDate, '09:00');
      // 09:00 +07:00 == 02:00 UTC
      expect(start.toISOString()).toBe('2026-07-10T02:00:00.000Z');
    });

    it('pads single-digit hours/minutes correctly via the composed date string', () => {
      const sessionDate = new Date('2026-01-05T00:00:00Z');
      const start = service.sessionStart(sessionDate, '08:05');
      expect(start.toISOString()).toBe('2026-01-05T01:05:00.000Z');
    });
  });
});
