-- AlterTable
ALTER TABLE "rubrics" DROP COLUMN "name",
ADD COLUMN     "nameEn" TEXT NOT NULL,
ADD COLUMN     "nameTh" TEXT;

-- AlterTable
ALTER TABLE "rubric_sections" DROP COLUMN "name",
ADD COLUMN     "nameEn" TEXT NOT NULL,
ADD COLUMN     "nameTh" TEXT;

-- AlterTable
ALTER TABLE "rubric_items" DROP COLUMN "text",
ADD COLUMN     "textEn" TEXT NOT NULL,
ADD COLUMN     "textTh" TEXT;

-- CreateTable
CREATE TABLE "subject_rubrics" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "rubricId" TEXT NOT NULL,
    "weightPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "subject_rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subject_rubrics_subjectId_idx" ON "subject_rubrics"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "subject_rubrics_subjectId_rubricId_key" ON "subject_rubrics"("subjectId", "rubricId");

-- AddForeignKey
ALTER TABLE "subject_rubrics" ADD CONSTRAINT "subject_rubrics_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_rubrics" ADD CONSTRAINT "subject_rubrics_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "rubrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

