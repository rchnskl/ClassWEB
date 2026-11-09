-- A scheme may not award every grade it lists (the NUS3303 scheme stops at
-- C-): such a band is switched off and is then never assigned.
ALTER TABLE "grade_bands" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
