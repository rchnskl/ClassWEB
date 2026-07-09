-- CreateEnum
CREATE TYPE "AttendanceCheckInStatus" AS ENUM ('PENDING', 'MATCHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttendanceResolutionReason" AS ENUM ('MAKEUP_OTHER_SECTION', 'WRONG_CODE', 'LATE_REGISTRATION', 'OTHER');

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "openedById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT true,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_checkins" (
    "id" TEXT NOT NULL,
    "attendanceSessionId" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "enteredCode" TEXT NOT NULL,
    "status" "AttendanceCheckInStatus" NOT NULL DEFAULT 'PENDING',
    "matchedStudentId" TEXT,
    "matchedEnrollmentId" TEXT,
    "attendanceStatus" "AttendanceStatus",
    "minutesLate" INTEGER,
    "reason" "AttendanceResolutionReason",
    "reasonNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_token_key" ON "attendance_sessions"("token");

-- CreateIndex
CREATE INDEX "attendance_sessions_classSessionId_idx" ON "attendance_sessions"("classSessionId");

-- CreateIndex
CREATE INDEX "attendance_checkins_classSessionId_status_idx" ON "attendance_checkins"("classSessionId", "status");

-- CreateIndex
CREATE INDEX "attendance_checkins_attendanceSessionId_idx" ON "attendance_checkins"("attendanceSessionId");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_checkins" ADD CONSTRAINT "attendance_checkins_attendanceSessionId_fkey" FOREIGN KEY ("attendanceSessionId") REFERENCES "attendance_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

