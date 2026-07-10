-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateTable
CREATE TABLE "rubrics" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "weightPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "rubrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubric_sections" (
    "id" TEXT NOT NULL,
    "rubricId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weightPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rubric_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rubric_items" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "weightPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxRating" INTEGER NOT NULL DEFAULT 5,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rubric_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "rubricId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sectionId" TEXT,
    "evaluatorId" TEXT,
    "evaluatorName" TEXT,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'DRAFT',
    "scorePercent" DOUBLE PRECISION,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_scores" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "rubricItemId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,

    CONSTRAINT "evaluation_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_schemes" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default',
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grade_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_bands" (
    "id" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "gpa" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "minScore" DOUBLE PRECISION NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "grade_bands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rubrics_universityId_idx" ON "rubrics"("universityId");

-- CreateIndex
CREATE INDEX "rubric_sections_rubricId_idx" ON "rubric_sections"("rubricId");

-- CreateIndex
CREATE INDEX "rubric_items_sectionId_idx" ON "rubric_items"("sectionId");

-- CreateIndex
CREATE INDEX "evaluations_universityId_idx" ON "evaluations"("universityId");

-- CreateIndex
CREATE INDEX "evaluations_studentId_idx" ON "evaluations"("studentId");

-- CreateIndex
CREATE INDEX "evaluations_sectionId_idx" ON "evaluations"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_rubricId_studentId_sectionId_key" ON "evaluations"("rubricId", "studentId", "sectionId");

-- CreateIndex
CREATE INDEX "evaluation_scores_rubricItemId_idx" ON "evaluation_scores"("rubricItemId");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_scores_evaluationId_rubricItemId_key" ON "evaluation_scores"("evaluationId", "rubricItemId");

-- CreateIndex
CREATE INDEX "grade_schemes_universityId_idx" ON "grade_schemes"("universityId");

-- CreateIndex
CREATE INDEX "grade_bands_schemeId_idx" ON "grade_bands"("schemeId");

-- AddForeignKey
ALTER TABLE "rubrics" ADD CONSTRAINT "rubrics_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubric_sections" ADD CONSTRAINT "rubric_sections_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "rubrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubric_items" ADD CONSTRAINT "rubric_items_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "rubric_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "rubrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_scores" ADD CONSTRAINT "evaluation_scores_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_scores" ADD CONSTRAINT "evaluation_scores_rubricItemId_fkey" FOREIGN KEY ("rubricItemId") REFERENCES "rubric_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_schemes" ADD CONSTRAINT "grade_schemes_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "grade_schemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

