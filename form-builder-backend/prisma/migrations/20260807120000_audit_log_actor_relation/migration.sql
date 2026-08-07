-- Audit log actor relation.
--
-- `audit_logs.user_id` already existed and was already indexed; it simply had
-- no foreign key, so Prisma could not join it and every audit entry was
-- rendered without an actor.
--
-- This adds only the constraint. No column is created, dropped, or rewritten,
-- so the table is not rewritten either.
--
-- ON DELETE SET NULL is deliberate: removing a user must never delete the
-- record of what that user did. The entry survives with a null actor.
--
-- NOT VALID + a separate VALIDATE keeps the exclusive lock short: adding a
-- validated FK scans the whole table while holding a lock that blocks writes to
-- audit_logs, which is on the write path of every mutating request.

-- Existing rows may reference users that were hard-deleted before this
-- constraint existed. Null them first, or the validation below fails.
UPDATE "audit_logs" a
SET "user_id" = NULL
WHERE a."user_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = a."user_id");

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE "audit_logs" VALIDATE CONSTRAINT "audit_logs_user_id_fkey";
