-- AlterTable
ALTER TABLE "rubric_items" ADD COLUMN     "isCritical" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "evaluation_scores" ADD COLUMN     "passed" BOOLEAN;

-- AlterTable
ALTER TABLE "evaluations" ADD COLUMN     "criticalFailed" BOOLEAN NOT NULL DEFAULT false;
