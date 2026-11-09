-- Not every class session is a practice day: a case-presentation day should
-- not be offered for daily (per-session) assessment.
ALTER TABLE "class_sessions" ADD COLUMN "dailyAssessment" BOOLEAN NOT NULL DEFAULT true;
