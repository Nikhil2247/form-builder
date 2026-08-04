-- Run once after initial Prisma migration:
-- bunx prisma db execute --file prisma/sql/add_gin_index.sql --schema prisma/schema.prisma
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_form_submissions_answers_gin
ON form_submissions
USING GIN (answers jsonb_path_ops);
