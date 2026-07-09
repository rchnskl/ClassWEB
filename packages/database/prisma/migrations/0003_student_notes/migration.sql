-- CreateEnum
CREATE TYPE "StudentNoteCategory" AS ENUM ('BEHAVIOR', 'INCIDENT', 'ACADEMIC', 'HEALTH', 'GENERAL');

-- CreateTable
CREATE TABLE "student_notes" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "category" "StudentNoteCategory" NOT NULL DEFAULT 'BEHAVIOR',
    "content" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorName" TEXT NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "student_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_notes_studentId_createdAt_idx" ON "student_notes"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "student_notes_universityId_idx" ON "student_notes"("universityId");

-- AddForeignKey
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

