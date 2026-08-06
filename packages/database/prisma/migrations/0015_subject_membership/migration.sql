-- CreateEnum
CREATE TYPE "SubjectMemberRole" AS ENUM ('COURSE_MANAGER', 'TEAM_MEMBER');

-- CreateTable
CREATE TABLE "subject_memberships" (
    "id" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "lecturerId" TEXT NOT NULL,
    "role" "SubjectMemberRole" NOT NULL,
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subject_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subject_memberships_lecturerId_idx" ON "subject_memberships"("lecturerId");

-- CreateIndex
CREATE UNIQUE INDEX "subject_memberships_subjectId_lecturerId_key" ON "subject_memberships"("subjectId", "lecturerId");

-- AddForeignKey
ALTER TABLE "subject_memberships" ADD CONSTRAINT "subject_memberships_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_memberships" ADD CONSTRAINT "subject_memberships_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "lecturers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subject_memberships" ADD CONSTRAINT "subject_memberships_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "lecturers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
