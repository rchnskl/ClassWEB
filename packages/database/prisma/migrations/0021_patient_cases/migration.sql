-- Daily clinical practice: each day students (usually pairs) are assigned a
-- patient case, and lecturers keep notes on each student for that day.

ALTER TABLE "student_notes" ADD COLUMN "classSessionId" TEXT;
ALTER TABLE "student_notes" ADD CONSTRAINT "student_notes_classSessionId_fkey"
  FOREIGN KEY ("classSessionId") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "student_notes_classSessionId_idx" ON "student_notes"("classSessionId");

CREATE TABLE "patient_cases" (
    "id" TEXT NOT NULL,
    "universityId" TEXT NOT NULL,
    "classSessionId" TEXT NOT NULL,
    "bed" TEXT,
    "hn" TEXT,
    "patientName" TEXT,
    "patientAge" TEXT,
    "diagnosis" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "patient_cases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "patient_cases_classSessionId_idx" ON "patient_cases"("classSessionId");
CREATE INDEX "patient_cases_universityId_idx" ON "patient_cases"("universityId");
ALTER TABLE "patient_cases" ADD CONSTRAINT "patient_cases_classSessionId_fkey"
  FOREIGN KEY ("classSessionId") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "patient_case_students" (
    "caseId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    CONSTRAINT "patient_case_students_pkey" PRIMARY KEY ("caseId", "studentId")
);
CREATE INDEX "patient_case_students_studentId_idx" ON "patient_case_students"("studentId");
ALTER TABLE "patient_case_students" ADD CONSTRAINT "patient_case_students_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "patient_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "patient_case_students" ADD CONSTRAINT "patient_case_students_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
