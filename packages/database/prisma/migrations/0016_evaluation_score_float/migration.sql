-- AlterTable
-- Widening only: every existing 1..5 rating survives unchanged. A score
-- component carries a raw exam mark, which is routinely a half point.
ALTER TABLE "evaluation_scores" ALTER COLUMN "rating" SET DATA TYPE DOUBLE PRECISION;
