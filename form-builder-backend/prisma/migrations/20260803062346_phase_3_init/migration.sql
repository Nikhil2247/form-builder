-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'EMAIL', 'PHONE', 'URL', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN', 'STAR_RATING', 'NPS', 'SLIDER', 'DATE', 'FILE_UPLOAD', 'SIGNATURE', 'MATRIX', 'SECTION_HEADER');

-- CreateEnum
CREATE TYPE "LogicOperator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'CONTAINS', 'GREATER_THAN', 'LESS_THAN', 'IS_FILLED');

-- CreateEnum
CREATE TYPE "LogicAction" AS ENUM ('SHOW', 'HIDE', 'JUMP_TO_PAGE');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'FLAGGED_SPAM', 'REJECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "FileUploadStatus" AS ENUM ('PENDING_UPLOAD', 'VERIFIED', 'QUARANTINED', 'DELETED');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('MINIO', 'S3');

-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('USER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "logo_url" TEXT,
    "max_forms" INTEGER NOT NULL DEFAULT 100,
    "max_submissions_month" INTEGER NOT NULL DEFAULT 10000,
    "max_members" INTEGER NOT NULL DEFAULT 50,
    "storage_quota_bytes" BIGINT NOT NULL DEFAULT 5368709120,
    "storage_used_bytes" BIGINT NOT NULL DEFAULT 0,
    "minio_bucket" VARCHAR(100),
    "s3_bucket" VARCHAR(100),
    "default_storage_provider" "StorageProvider" NOT NULL DEFAULT 'MINIO',
    "settings" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "suspended_at" TIMESTAMP(3),
    "suspend_reason" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'VIEWER',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invited_by_id" UUID,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'VIEWER',
    "token" VARCHAR(64) NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "avatar_url" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "system_role" "SystemRole" NOT NULL DEFAULT 'USER',
    "preferred_storage" "StorageProvider",
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "mfa_secret" VARCHAR(255),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "user_agent" TEXT,
    "ip_address" VARCHAR(45),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "key_hash" VARCHAR(64) NOT NULL,
    "scopes" VARCHAR(500) NOT NULL DEFAULT 'forms:read,submissions:read',
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forms" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
    "layout_mode" VARCHAR(50) NOT NULL DEFAULT 'DOCUMENT',
    "is_quiz_mode" BOOLEAN NOT NULL DEFAULT false,
    "is_password_protected" BOOLEAN NOT NULL DEFAULT false,
    "password_hash" VARCHAR(255),
    "require_auth" BOOLEAN NOT NULL DEFAULT false,
    "allow_multiple" BOOLEAN NOT NULL DEFAULT true,
    "max_submissions" INTEGER,
    "expires_at" TIMESTAMP(3),
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "theme_config" JSONB NOT NULL,
    "pages_json" JSONB,
    "questions_json" JSONB,
    "logic_json" JSONB,
    "notify_emails" JSONB,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_versions" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "pages_json" JSONB NOT NULL,
    "questions_json" JSONB NOT NULL,
    "logic_json" JSONB NOT NULL,
    "theme_json" JSONB NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "form_version_id" UUID NOT NULL,
    "respondent_id" UUID,
    "respondent_ip_hash" VARCHAR(64),
    "user_agent" TEXT,
    "country" VARCHAR(2),
    "completion_time_ms" INTEGER NOT NULL DEFAULT 0,
    "quiz_score" DOUBLE PRECISION,
    "max_quiz_score" DOUBLE PRECISION,
    "is_passed" BOOLEAN,
    "answers" JSONB NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submission_files" (
    "id" UUID NOT NULL,
    "submission_id" UUID,
    "question_id" VARCHAR(100) NOT NULL,
    "provider" "StorageProvider" NOT NULL DEFAULT 'MINIO',
    "bucket" VARCHAR(100) NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256_hash" VARCHAR(64),
    "status" "FileUploadStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "quarantine_reason" TEXT,

    CONSTRAINT "form_submission_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(50) NOT NULL,
    "thumbnail" TEXT,
    "formData" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_analytics" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "starts" INTEGER NOT NULL DEFAULT 0,
    "submissions" INTEGER NOT NULL DEFAULT 0,
    "avg_completion_ms" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "form_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_webhooks" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret" VARCHAR(255) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "webhook_id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "status_code" INTEGER,
    "response_body" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "delivered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(50) NOT NULL,
    "resource_id" VARCHAR(100),
    "metadata" JSONB,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_comments" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "parent_id" UUID,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT,
    "metadata" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_configs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "form_id" UUID,
    "provider" VARCHAR(50) NOT NULL,
    "credentials" JSONB NOT NULL,
    "syncRules" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_drafts" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "fingerprint" VARCHAR(128) NOT NULL,
    "answers" JSONB NOT NULL,
    "last_field_id" VARCHAR(100),
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_slug_idx" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_is_active_idx" ON "organizations"("is_active");

-- CreateIndex
CREATE INDEX "organization_members_organization_id_idx" ON "organization_members"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_user_id_key" ON "organization_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_token_key" ON "organization_invitations"("token");

-- CreateIndex
CREATE INDEX "organization_invitations_organization_id_idx" ON "organization_invitations"("organization_id");

-- CreateIndex
CREATE INDEX "organization_invitations_token_idx" ON "organization_invitations"("token");

-- CreateIndex
CREATE INDEX "organization_invitations_email_idx" ON "organization_invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "email_verification_tokens_token_hash_idx" ON "email_verification_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");

-- CreateIndex
CREATE INDEX "api_keys_organization_id_idx" ON "api_keys"("organization_id");

-- CreateIndex
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "forms_slug_key" ON "forms"("slug");

-- CreateIndex
CREATE INDEX "forms_organization_id_status_idx" ON "forms"("organization_id", "status");

-- CreateIndex
CREATE INDEX "forms_slug_idx" ON "forms"("slug");

-- CreateIndex
CREATE INDEX "forms_created_by_id_idx" ON "forms"("created_by_id");

-- CreateIndex
CREATE INDEX "form_versions_form_id_idx" ON "form_versions"("form_id");

-- CreateIndex
CREATE UNIQUE INDEX "form_versions_form_id_version_key" ON "form_versions"("form_id", "version");

-- CreateIndex
CREATE INDEX "form_submissions_form_id_submitted_at_idx" ON "form_submissions"("form_id", "submitted_at" DESC);

-- CreateIndex
CREATE INDEX "form_submissions_form_id_status_idx" ON "form_submissions"("form_id", "status");

-- CreateIndex
CREATE INDEX "form_submissions_form_version_id_idx" ON "form_submissions"("form_version_id");

-- CreateIndex
CREATE INDEX "form_submissions_respondent_id_idx" ON "form_submissions"("respondent_id");

-- CreateIndex
CREATE UNIQUE INDEX "form_submission_files_object_key_key" ON "form_submission_files"("object_key");

-- CreateIndex
CREATE INDEX "form_submission_files_submission_id_idx" ON "form_submission_files"("submission_id");

-- CreateIndex
CREATE INDEX "form_submission_files_question_id_idx" ON "form_submission_files"("question_id");

-- CreateIndex
CREATE INDEX "form_submission_files_status_idx" ON "form_submission_files"("status");

-- CreateIndex
CREATE INDEX "form_analytics_form_id_date_idx" ON "form_analytics"("form_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "form_analytics_form_id_date_key" ON "form_analytics"("form_id", "date");

-- CreateIndex
CREATE INDEX "form_webhooks_form_id_is_active_idx" ON "form_webhooks"("form_id", "is_active");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_idx" ON "webhook_deliveries"("webhook_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_submission_id_idx" ON "webhook_deliveries"("submission_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "form_comments_form_id_idx" ON "form_comments"("form_id");

-- CreateIndex
CREATE INDEX "form_comments_user_id_idx" ON "form_comments"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_is_read_idx" ON "notifications"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "integration_configs_organization_id_idx" ON "integration_configs"("organization_id");

-- CreateIndex
CREATE INDEX "integration_configs_form_id_idx" ON "integration_configs"("form_id");

-- CreateIndex
CREATE INDEX "form_drafts_form_id_updated_at_idx" ON "form_drafts"("form_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "form_drafts_form_id_fingerprint_key" ON "form_drafts"("form_id", "fingerprint");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_version_id_fkey" FOREIGN KEY ("form_version_id") REFERENCES "form_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_respondent_id_fkey" FOREIGN KEY ("respondent_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submission_files" ADD CONSTRAINT "form_submission_files_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "form_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_analytics" ADD CONSTRAINT "form_analytics_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_webhooks" ADD CONSTRAINT "form_webhooks_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "form_webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_comments" ADD CONSTRAINT "form_comments_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_comments" ADD CONSTRAINT "form_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_comments" ADD CONSTRAINT "form_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "form_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_configs" ADD CONSTRAINT "integration_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_configs" ADD CONSTRAINT "integration_configs_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_drafts" ADD CONSTRAINT "form_drafts_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
