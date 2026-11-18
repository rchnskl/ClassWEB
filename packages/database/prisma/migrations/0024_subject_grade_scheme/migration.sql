-- A subject can have grading criteria of its own (NUS3206: A from 80, C-
-- below 50) instead of the university-wide default scheme.
ALTER TABLE "grade_schemes" ADD COLUMN "subjectId" TEXT;
CREATE UNIQUE INDEX "grade_schemes_subjectId_key" ON "grade_schemes"("subjectId");
ALTER TABLE "grade_schemes" ADD CONSTRAINT "grade_schemes_subjectId_fkey"
  FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
