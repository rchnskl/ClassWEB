-- A section can open check-in a set time before class (a lecture opening at
-- 14:00 for a 14:15 start). NULL keeps the all-day window used for clinical
-- practice.
ALTER TABLE "attendance_rules" ADD COLUMN "opensBeforeMinutes" INTEGER;
