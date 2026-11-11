-- A patient is usually cared for over several practice days: a case can be
-- carried on from the previous day (continuedFromId), and marked discharged
-- when the patient goes home so the students can take a new case.
ALTER TABLE "patient_cases" ADD COLUMN "continuedFromId" TEXT;
ALTER TABLE "patient_cases" ADD COLUMN "dischargedAt" TIMESTAMP(3);
CREATE INDEX "patient_cases_continuedFromId_idx" ON "patient_cases"("continuedFromId");
ALTER TABLE "patient_cases" ADD CONSTRAINT "patient_cases_continuedFromId_fkey"
  FOREIGN KEY ("continuedFromId") REFERENCES "patient_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
