-- CreateEnum
CREATE TYPE "StudentGroupScope" AS ENUM ('CENTRAL', 'SECTION');

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "yearLevel" INTEGER;

-- CreateTable
CREATE TABLE "student_groups" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "scope" "StudentGroupScope" NOT NULL DEFAULT 'CENTRAL',
    "programId" TEXT,
    "yearLevel" INTEGER,
    "sectionId" TEXT,
    "code" TEXT,
    "nameEn" TEXT NOT NULL,
    "nameTh" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "student_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_group_members" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_groups_universityId_idx" ON "student_groups"("universityId");

-- CreateIndex
CREATE INDEX "student_groups_universityId_programId_yearLevel_idx" ON "student_groups"("universityId", "programId", "yearLevel");

-- CreateIndex
CREATE INDEX "student_groups_sectionId_idx" ON "student_groups"("sectionId");

-- CreateIndex
CREATE INDEX "student_group_members_studentId_idx" ON "student_group_members"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "student_group_members_groupId_studentId_key" ON "student_group_members"("groupId", "studentId");

-- CreateIndex
CREATE INDEX "students_universityId_yearLevel_idx" ON "students"("universityId", "yearLevel");

-- AddForeignKey
ALTER TABLE "student_groups" ADD CONSTRAINT "student_groups_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_groups" ADD CONSTRAINT "student_groups_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_groups" ADD CONSTRAINT "student_groups_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_group_members" ADD CONSTRAINT "student_group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "student_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_group_members" ADD CONSTRAINT "student_group_members_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
