-- CreateEnum
CREATE TYPE "CalendarEntryType" AS ENUM ('CLASS', 'PERSONAL', 'ACTIVITY', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "CalendarVisibility" AS ENUM ('PRIVATE', 'FACULTY', 'PUBLIC');

-- CreateTable
CREATE TABLE "calendar_entries" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "type" "CalendarEntryType" NOT NULL DEFAULT 'PERSONAL',
    "visibility" "CalendarVisibility" NOT NULL DEFAULT 'PRIVATE',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "roomId" TEXT,
    "lecturerId" TEXT,
    "createdById" TEXT,
    "color" TEXT,
    "googleEventId" TEXT,
    "googleCalendarId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "calendar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_calendar_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEmail" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "calendarId" TEXT DEFAULT 'primary',
    "syncToken" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_entries_universityId_startAt_idx" ON "calendar_entries"("universityId", "startAt");

-- CreateIndex
CREATE INDEX "calendar_entries_lecturerId_idx" ON "calendar_entries"("lecturerId");

-- CreateIndex
CREATE INDEX "calendar_entries_type_idx" ON "calendar_entries"("type");

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_connections_userId_key" ON "google_calendar_connections"("userId");

-- AddForeignKey
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_universityId_fkey" FOREIGN KEY ("universityId") REFERENCES "universities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_lecturerId_fkey" FOREIGN KEY ("lecturerId") REFERENCES "lecturers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

