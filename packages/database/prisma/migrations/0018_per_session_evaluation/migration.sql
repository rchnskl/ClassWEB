-- Per-session assessment: some components are marked every practice day
-- (clinical "Nursing performance") and the term score is the average of the
-- days. A day's marks live on an evaluation row tied to that class session;
-- the averaged component score stays on the row with classSessionId NULL, so
-- every summary and report that already reads that row needs no change.

ALTER TABLE "rubrics" ADD COLUMN "perSession" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "evaluations" ADD COLUMN "classSessionId" TEXT;
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_classSessionId_fkey"
  FOREIGN KEY ("classSessionId") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "evaluations_classSessionId_idx" ON "evaluations"("classSessionId");

DROP INDEX "evaluations_rubricId_studentId_sectionId_key";
CREATE UNIQUE INDEX "evaluations_rubricId_studentId_sectionId_classSessionId_key"
  ON "evaluations"("rubricId", "studentId", "sectionId", "classSessionId");
-- NULLs never collide in a plain unique index, so the component-score row
-- (classSessionId NULL) needs its own guard: one per rubric/student/section.
CREATE UNIQUE INDEX "evaluations_component_row_key"
  ON "evaluations"("rubricId", "studentId", COALESCE("sectionId", ''))
  WHERE "classSessionId" IS NULL;
