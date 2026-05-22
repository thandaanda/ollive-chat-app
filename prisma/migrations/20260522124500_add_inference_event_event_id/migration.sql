ALTER TABLE "InferenceEvent" ADD COLUMN IF NOT EXISTS "eventId" TEXT;

UPDATE "InferenceEvent"
SET "eventId" = "id"
WHERE "eventId" IS NULL;

ALTER TABLE "InferenceEvent" ALTER COLUMN "eventId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "InferenceEvent_eventId_key" ON "InferenceEvent"("eventId");
