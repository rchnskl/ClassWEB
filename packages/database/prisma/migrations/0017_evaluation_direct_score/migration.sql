-- AlterTable
-- Direct entry: some components (a written exam, a case study marked off the
-- app) are handed over as one raw mark, not an item-by-item checklist. Storing
-- the mark and what it was out of keeps "42/50" printable on the report
-- instead of only the 84% it works out to. Both stay NULL for a rubric graded
-- item by item, where the marks are recoverable from evaluation_scores.
ALTER TABLE "evaluations" ADD COLUMN "rawScore" DOUBLE PRECISION;
ALTER TABLE "evaluations" ADD COLUMN "rawMax" DOUBLE PRECISION;
