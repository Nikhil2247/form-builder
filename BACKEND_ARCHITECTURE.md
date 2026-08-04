# FormBuilder — High-Scale NestJS Backend Architecture

**Stack:** NestJS · Prisma ORM · PostgreSQL 16 · Redis 7 · MinIO · BullMQ · Docker

> This document is the single source of truth for all backend architecture and implementation decisions.  
> The full database schema with inline documentation lives in [`prisma/schema.prisma`](file:///d:/chrome%20download/vibha%20website/form-builder/prisma/schema.prisma).

---

## Table of Contents

1. [Goals & Design Philosophy](#1-goals--design-philosophy)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Technology Stack & Rationale](#3-technology-stack--rationale)
4. [Project Structure](#4-nestjs-project-structure)
5. [Database Schema Design Decisions](#5-database-schema-design-decisions)
6. [Submission Ingestion Pipeline (Async Queue)](#6-submission-ingestion-pipeline)
7. [File Upload Architecture (MinIO + Optional S3)](#7-file-upload-architecture)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Multi-Tenancy & Quota Enforcement](#9-multi-tenancy--quota-enforcement)
10. [Caching Strategy (Redis)](#10-caching-strategy)
11. [Rate Limiting & Anti-Spam](#11-rate-limiting--anti-spam)
12. [Webhooks & Event-Driven Integrations](#12-webhooks--event-driven-integrations)
13. [Analytics & Observability](#13-analytics--observability)
14. [API Design & Versioning](#14-api-design--versioning)
15. [Security Best Practices](#15-security-best-practices)
16. [Scalability & Infrastructure](#16-scalability--infrastructure)
17. [Docker & Local Development Setup](#17-docker--local-development-setup)
18. [Environment Variables Reference](#18-environment-variables-reference)

---

## 1. Goals & Design Philosophy

| Goal | Approach |
|---|---|
| Handle millions of submissions | Async queue ingestion; API never writes to DB synchronously on hot path |
| Zero-RAM file uploads | Presigned MinIO/S3 PUT URLs; files bypass NestJS memory entirely |
| Historical answer accuracy | Immutable `FormVersion` snapshots; submissions never lose schema context |
| Multi-tenant isolation | Organization-scoped data; all queries include `organizationId` guard |
| Developer velocity | One schema file drives DB + TypeScript types + migrations |
| Cost-effective self-hosting | MinIO as primary storage (free, S3-compatible); AWS S3 is optional |

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            CLIENT TIER                                  │
│   Browser (Next.js Frontend)  ─── Mobile Apps  ─── API Integrations    │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │ HTTPS
┌─────────────────────▼───────────────────────────────────────────────────┐
│                      REVERSE PROXY / CDN                                │
│          Nginx / Cloudflare (WAF, DDoS, Rate Limit at Edge)             │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │
          ┌───────────┴──────────────────────────────┐
          │                                          │
┌─────────▼──────────────┐              ┌────────────▼──────────────┐
│  NestJS API Cluster     │              │  MinIO Object Storage     │
│  (Stateless, K8s/ECS)  │◄────────────►│  (Primary File Storage)   │
│  • Form CRUD endpoints  │  Presigned   │  • Form file uploads      │
│  • Submission ingestor  │  PUT URLs    │  • Cover images / logos   │
│  • Storage URL signer   │              │  • Signature images       │
│  • Auth & Webhooks API  │              └────────────┬──────────────┘
└─────────┬──────────────┘                           │ (Optional)
          │ Enqueue                     ┌─────────────▼──────────────┐
          │                             │  AWS S3 (Optional Fallback) │
┌─────────▼──────────────┐              │  Enabled by STORAGE_PROVIDER│
│  Redis Cluster          │              │  =s3 env variable           │
│  • BullMQ job queues    │              └────────────────────────────┘
│  • In-memory form cache │
│  • Session/token store  │
│  • Rate-limiter counters│
└─────────┬──────────────┘
          │ Consume
┌─────────▼──────────────┐
│  NestJS Worker Cluster  │
│  • SubmissionProcessor  │
│  • FileVerifier         │
│  • WebhookDispatcher    │
│  • AnalyticsAggregator  │
└─────────┬──────────────┘
          │ Write (batched)
┌─────────▼──────────────────────────────────────────────────────────────┐
│                     PostgreSQL 16 via PgBouncer                        │
│  Primary (writes)                    Read Replicas (reads/analytics)   │
│  ┌──────────────────────────────┐   ┌──────────────────────────────┐  │
│  │ form_submissions (JSONB)     │   │ form_submissions (replica)   │  │
│  │ form_versions (JSONB)        │   │ form_analytics               │  │
│  │ users, organizations         │   │ forms, form_versions         │  │
│  └──────────────────────────────┘   └──────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack & Rationale

| Component | Choice | Why |
|---|---|---|
| Runtime | **NestJS 10 + Node.js 22 LTS** | TypeScript-first, modular, DI container, decorator-based |
| ORM | **Prisma 5** | Type-safe queries, migration engine, schema-driven development |
| Database | **PostgreSQL 16** | JSONB native, partitioning, streaming replication, LISTEN/NOTIFY |
| Queue | **BullMQ (Redis)** | Reliable job queues, retries, rate limiting, delayed jobs |
| Cache | **Redis 7** | Fast in-memory cache, pub/sub, sliding-window rate limiter |
| File Storage (Primary) | **MinIO** | S3-compatible self-hosted; zero egress costs; Docker-friendly |
| File Storage (Optional) | **AWS S3** | Managed, globally durable, CDN via CloudFront |
| Auth | **JWT + argon2id** | Short-lived access tokens + rotated refresh tokens |
| Validation | **class-validator + Zod** | DTO validation at controller level + schema validation in workers |
| Connection Pool | **PgBouncer** | Prevents connection exhaustion at scale |

---

## 4. NestJS Project Structure

```
backend/
├── prisma/
│   ├── schema.prisma              ← Schema with full inline docs
│   ├── migrations/                ← Prisma migration files
│   └── sql/
│       ├── add_gin_index.sql      ← GIN index on answers JSONB (run after first migration)
│       └── add_partitioning.sql   ← Table partitioning SQL (run at scale)
│
├── src/
│   ├── main.ts                    ← Bootstrap (Helmet, CORS, GlobalPipe, Swagger)
│   ├── app.module.ts              ← Root module (imports all feature modules)
│   │
│   ├── common/                    ← Shared infrastructure
│   │   ├── prisma/
│   │   │   └── prisma.service.ts  ← PrismaClient singleton with lifecycle hooks
│   │   ├── redis/
│   │   │   └── redis.service.ts   ← ioredis cluster connection
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts  ← Validates Bearer JWT on protected routes
│   │   │   ├── api-key.guard.ts   ← Validates fbk_ prefixed API keys
│   │   │   └── org-member.guard.ts← Verifies org membership and role
│   │   ├── interceptors/
│   │   │   ├── response.interceptor.ts  ← Wraps all responses in { data, meta }
│   │   │   └── logging.interceptor.ts   ← Pino structured logging per request
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts ← Global error normalizer
│   │   └── decorators/
│   │       ├── current-user.decorator.ts
│   │       └── org-id.decorator.ts
│   │
│   ├── config/
│   │   ├── configuration.ts       ← Typed env config (Joi validation at startup)
│   │   ├── storage.config.ts      ← MinIO vs S3 client factory
│   │   └── bullmq.config.ts       ← Queue connection configuration
│   │
│   └── modules/
│       ├── auth/
│       │   ├── auth.controller.ts   ← POST /auth/register|login|refresh|logout
│       │   ├── auth.service.ts
│       │   ├── strategies/
│       │   │   └── jwt.strategy.ts  ← Passport JWT strategy
│       │   └── dto/
│       │       ├── register.dto.ts
│       │       └── login.dto.ts
│       │
│       ├── organizations/
│       │   ├── organizations.controller.ts
│       │   ├── organizations.service.ts
│       │   └── dto/
│       │
│       ├── forms/
│       │   ├── forms.controller.ts  ← CRUD for form creators (auth required)
│       │   ├── forms.service.ts
│       │   ├── public-forms.controller.ts ← GET /public/:slug (no auth, cached)
│       │   └── dto/
│       │       ├── create-form.dto.ts
│       │       └── update-form.dto.ts
│       │
│       ├── submissions/
│       │   ├── submissions.controller.ts  ← POST /forms/:id/submit (public)
│       │   ├── submissions.service.ts
│       │   ├── queues/
│       │   │   ├── submission.producer.ts  ← Enqueues payload into BullMQ
│       │   │   └── submission.processor.ts ← Worker: validate, score, persist
│       │   └── dto/
│       │       └── submit-form.dto.ts
│       │
│       ├── storage/
│       │   ├── storage.controller.ts  ← POST /storage/presigned-url
│       │   ├── storage.service.ts     ← MinIO/S3 URL signer
│       │   └── storage-verifier.processor.ts ← Worker: verify object exists
│       │
│       ├── analytics/
│       │   ├── analytics.controller.ts  ← GET /forms/:id/analytics (auth required)
│       │   └── analytics.service.ts
│       │
│       └── webhooks/
│           ├── webhooks.controller.ts
│           ├── webhooks.processor.ts   ← Worker: dispatch + log delivery attempt
│           └── webhooks.service.ts
│
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── package.json
```

---

## 5. Database Schema Design Decisions

### 5.1 Form Versioning (Immutable Snapshots)

**Problem:** Creators edit live forms after thousands of submissions already exist. Storing submissions against a mutable form structure makes old submissions unreadable when questions are deleted or reordered.

**Solution:** Every form publish creates an immutable `FormVersion` JSONB snapshot. Submissions reference `formVersionId` — they are forever interpretable regardless of future form edits.

```
forms (1) ──── (N) form_versions (1) ──── (N) form_submissions
               [immutable JSONB snapshots]    [answers + formVersionId FK]
```

### 5.2 JSONB Answers with GIN Index

Answers are stored as dynamic JSONB (`{ questionId: value }`) rather than a relational `submission_answers` table. This avoids N×M rows and slow multi-join queries.

**Run after first migration:**
```sql
-- sql/add_gin_index.sql
CREATE INDEX idx_form_submissions_answers_gin
ON form_submissions USING GIN (answers jsonb_path_ops);
```

**Example query — find all submissions where "email" field contains "@gmail.com":**
```sql
SELECT id, answers->>'question_email_1' AS email
FROM form_submissions
WHERE form_id = $1
  AND answers @> '{"question_email_1": "@gmail.com"}'::jsonb;
```

### 5.3 Table Partitioning (at 5M+ rows)

Run `sql/add_partitioning.sql` when `form_submissions` exceeds 5 million rows:

```sql
-- sql/add_partitioning.sql
-- Step 1: Rename existing table
ALTER TABLE form_submissions RENAME TO form_submissions_default;

-- Step 2: Create new partitioned parent table
CREATE TABLE form_submissions (
    id UUID NOT NULL,
    form_id UUID NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- ... all other columns ...
    PRIMARY KEY (id, submitted_at)  -- partition key must be in PK
) PARTITION BY RANGE (submitted_at);

-- Step 3: Attach default partition for existing data
ALTER TABLE form_submissions
ATTACH PARTITION form_submissions_default DEFAULT;

-- Step 4: Create monthly partitions going forward
CREATE TABLE form_submissions_y2026m08 PARTITION OF form_submissions
FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- Step 5: Automate new partition creation with pg_partman extension
SELECT partman.create_parent(
    p_parent_table := 'public.form_submissions',
    p_control := 'submitted_at',
    p_interval := '1 month'
);
```

### 5.4 Read/Write Splitting with Prisma

```typescript
// src/common/prisma/prisma.service.ts

import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService implements OnModuleInit {
  // Primary — all writes
  readonly writer: PrismaClient;
  // Replica — all reads (analytics, admin dashboards, exports)
  readonly reader: PrismaClient;

  constructor() {
    this.writer = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL,
    });
    this.reader = new PrismaClient({
      datasourceUrl: process.env.DATABASE_REPLICA_URL ?? process.env.DATABASE_URL,
    });
  }

  async onModuleInit() {
    await this.writer.$connect();
    await this.reader.$connect();
  }
}
```

---

## 6. Submission Ingestion Pipeline

The key design principle: **API nodes never block on DB writes during form submission.**

```
Respondent Browser
       │
       │  POST /v1/forms/{slug}/submit
       │  { answers: {...}, completionTimeMs: 4200, captchaToken: "..." }
       ▼
NestJS SubmissionsController
  1. Validate captcha token (Turnstile/hCaptcha) — fast, in-memory
  2. Load form config from Redis cache (or DB fallback)
  3. Basic payload type-check (class-validator DTO)
  4. Generate submissionId = crypto.randomUUID()
  5. Enqueue job to BullMQ submissions_queue
  6. ──► HTTP 202 Accepted { submissionId } (total: ~15ms)
       │
       │ BullMQ Redis Queue
       ▼
NestJS SubmissionProcessor (Worker Node)
  1. Zod-validate all answers against FormVersion.questionsJson schema
  2. Spam detection (honeypot field check, velocity check via Redis)
  3. Quiz auto-grading: iterate questions with points > 0, compare answers
  4. GeoIP lookup for respondentIp → country code (MaxMind mmdb)
  5. Hash respondentIp with daily salt for GDPR-safe duplicate detection
  6. prisma.formSubmission.create({ ... })
  7. Increment FormAnalytics counter (UPSERT)
  8. Enqueue file verification jobs for any FILE_UPLOAD answer keys
  9. Enqueue webhook dispatch job if active webhooks exist for form
```

### Implementation

```typescript
// src/modules/submissions/queues/submission.processor.ts

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';

@Processor('submissions_queue', {
  concurrency: 20,       // Process 20 jobs in parallel per worker instance
  limiter: {
    max: 500,            // Max 500 jobs per second across all workers
    duration: 1000,
  },
})
export class SubmissionProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<SubmissionPayload>) {
    const { submissionId, formId, answers, completionTimeMs, ip, submittedAt } = job.data;

    // 1. Load the active form version (cached)
    const form = await this.prisma.reader.form.findUniqueOrThrow({
      where: { id: formId },
      select: { currentVersion: true, isQuizMode: true, formVersionId: true },
    });

    // 2. Validate answers against the version's questionsJson schema
    // (Zod schema is built dynamically from questionsJson at runtime)

    // 3. Auto-grade quiz if enabled
    let quizScore = null, maxQuizScore = null;
    if (form.isQuizMode) {
      ({ quizScore, maxQuizScore } = this.gradeQuiz(answers, form.questionsJson));
    }

    // 4. Persist submission
    await this.prisma.writer.formSubmission.create({
      data: {
        id: submissionId,
        formId,
        formVersionId: form.formVersionId,
        answers,
        completionTimeMs,
        respondentIpHash: this.hashIp(ip),
        quizScore,
        maxQuizScore,
        submittedAt: new Date(submittedAt),
        processedAt: new Date(),
        status: 'SUBMITTED',
      },
    });

    // 5. Increment daily analytics counter
    await this.prisma.writer.$executeRaw`
      INSERT INTO form_analytics (id, form_id, date, submissions, avg_completion_ms)
      VALUES (gen_random_uuid(), ${formId}, NOW()::date, 1, ${completionTimeMs})
      ON CONFLICT (form_id, date) DO UPDATE
      SET submissions = form_analytics.submissions + 1,
          avg_completion_ms = (form_analytics.avg_completion_ms + ${completionTimeMs}) / 2
    `;
  }
}
```

---

## 7. File Upload Architecture

### 7.1 Storage Provider Abstraction

A single `StorageService` abstracts MinIO and S3 behind a common interface. The active provider is selected at startup from the `STORAGE_PROVIDER` environment variable.

```typescript
// src/config/storage.config.ts

import * as Minio from 'minio';
import { S3Client } from '@aws-sdk/client-s3';

export type StorageClient = { type: 'minio'; client: Minio.Client } 
                          | { type: 's3'; client: S3Client };

export function createStorageClient(): StorageClient {
  const provider = process.env.STORAGE_PROVIDER ?? 'minio';

  if (provider === 's3') {
    return {
      type: 's3',
      client: new S3Client({
        region: process.env.AWS_REGION!,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      }),
    };
  }

  // Default: MinIO
  return {
    type: 'minio',
    client: new Minio.Client({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: parseInt(process.env.MINIO_PORT ?? '9000'),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY!,
      secretKey: process.env.MINIO_SECRET_KEY!,
    }),
  };
}
```

### 7.2 MinIO Presigned Upload Flow (Primary — Self-Hosted)

```
Frontend                 NestJS StorageService          MinIO Server
    │                           │                            │
    │  POST /v1/storage/presigned-url                        │
    │  { formId, questionId,    │                            │
    │    fileName, mimeType,    │                            │
    │    sizeBytes }            │                            │
    │──────────────────────────►│                            │
    │                           │  1. Validate MIME/size     │
    │                           │  2. Check org storage quota│
    │                           │  3. Generate objectKey     │
    │                           │     = uploads/{orgId}/{formId}/{uuid}-{fileName}
    │                           │  4. Generate presigned PUT │
    │                           │──────────────────────────►│
    │                           │◄──────────────────────────│
    │                           │  5. Create FileUploadRecord│
    │                           │     status=PENDING_UPLOAD  │
    │◄──────────────────────────│                            │
    │  { uploadUrl, objectKey,  │                            │
    │    fileId, expiresAt }    │                            │
    │                           │                            │
    │  PUT binary file directly to uploadUrl                 │
    │────────────────────────────────────────────────────────►
    │◄────────────────────────────────────────────────────────
    │  HTTP 200 OK (ETag header = MD5 of uploaded bytes)     │
    │                           │                            │
    │  POST /v1/forms/{slug}/submit                          │
    │  { answers: { "q_file_1": "fileId-abc123" } }         │
    │──────────────────────────►│                            │
    │◄──────────────────────────│                            │
    │  HTTP 202 Accepted        │                            │
    │                           │                            │
    │                    [Background Worker: FileVerifier]   │
    │                           │  statObject(objectKey)     │
    │                           │──────────────────────────►│
    │                           │◄──────────────────────────│
    │                           │  size, etag, lastModified  │
    │                           │  UPDATE file status=VERIFIED
    │                           │  UPDATE org storageUsedBytes
```

### 7.3 StorageService Implementation

```typescript
// src/modules/storage/storage.service.ts

import { BadRequestException, Injectable } from '@nestjs/common';
import * as Minio from 'minio';
import { PrismaService } from '../../common/prisma/prisma.service';
import { createStorageClient } from '../../config/storage.config';

// Allowed MIME types for file upload questions.
// Override per-question using validation.allowedTypes from the form schema.
const DEFAULT_ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'video/mp4', 'video/webm',
  'audio/mpeg', 'audio/wav',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  // xlsx
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'text/plain', 'text/csv',
]);

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB default

@Injectable()
export class StorageService {
  private readonly storage = createStorageClient();

  constructor(private readonly prisma: PrismaService) {}

  async generatePresignedUploadUrl(params: {
    orgId: string;
    formId: string;
    questionId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    allowedMimes?: string[];
    maxSizeBytes?: number;
  }) {
    const { orgId, formId, questionId, fileName, mimeType, sizeBytes } = params;
    const allowedMimes = params.allowedMimes
      ? new Set(params.allowedMimes)
      : DEFAULT_ALLOWED_MIMES;
    const maxSize = params.maxSizeBytes ?? MAX_FILE_SIZE_BYTES;

    // ── Security Validation ─────────────────────────────────────────────────
    if (!allowedMimes.has(mimeType)) {
      throw new BadRequestException(`File type "${mimeType}" is not permitted.`);
    }
    if (sizeBytes > maxSize) {
      throw new BadRequestException(
        `File size ${sizeBytes} bytes exceeds maximum of ${maxSize} bytes.`,
      );
    }

    // ── Org Storage Quota Check ─────────────────────────────────────────────
    const org = await this.prisma.reader.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { storageQuotaBytes: true, storageUsedBytes: true, minioBucket: true, s3Bucket: true, defaultStorageProvider: true },
    });

    const projectedUsage = BigInt(org.storageUsedBytes) + BigInt(sizeBytes);
    if (projectedUsage > BigInt(org.storageQuotaBytes)) {
      throw new BadRequestException('Organization storage quota exceeded.');
    }

    // ── Object Key & Bucket Selection ───────────────────────────────────────
    const fileId = crypto.randomUUID();
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectKey = `uploads/${orgId}/${formId}/${fileId}/${sanitizedName}`;
    const bucket = org.minioBucket ?? process.env.MINIO_DEFAULT_BUCKET!;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // ── Generate Presigned URL (MinIO or S3) ────────────────────────────────
    let uploadUrl: string;

    if (this.storage.type === 'minio') {
      uploadUrl = await (this.storage.client as Minio.Client).presignedPutObject(
        bucket,
        objectKey,
        15 * 60, // TTL in seconds
      );
    } else {
      // AWS S3 presigned PUT
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      const command = new PutObjectCommand({
        Bucket: org.s3Bucket ?? process.env.AWS_S3_BUCKET!,
        Key: objectKey,
        ContentType: mimeType,
        ContentLength: sizeBytes,
      });
      uploadUrl = await getSignedUrl(this.storage.client as any, command, {
        expiresIn: 900,
      });
    }

    // ── Persist File Record (PENDING_UPLOAD state) ──────────────────────────
    const provider = this.storage.type === 'minio' ? 'MINIO' : 'S3';
    await this.prisma.writer.formSubmissionFile.create({
      data: {
        id: fileId,
        // NOTE: submissionId is NULL until the submission is actually created.
        // The submission processor links files by fileId after submission creation.
        submissionId: 'PENDING', // Placeholder — updated by submission worker
        questionId,
        provider,
        bucket,
        objectKey,
        originalName: sanitizedName,
        mimeType,
        sizeBytes: BigInt(sizeBytes),
        status: 'PENDING_UPLOAD',
        expiresAt,
      },
    });

    return { uploadUrl, objectKey, fileId, expiresAt };
  }

  async verifyUpload(fileId: string): Promise<void> {
    const file = await this.prisma.reader.formSubmissionFile.findUniqueOrThrow({
      where: { id: fileId },
    });

    try {
      if (this.storage.type === 'minio') {
        const stat = await (this.storage.client as Minio.Client).statObject(
          file.bucket,
          file.objectKey,
        );
        await this.prisma.writer.formSubmissionFile.update({
          where: { id: fileId },
          data: {
            status: 'VERIFIED',
            sizeBytes: BigInt(stat.size),
            verifiedAt: new Date(),
          },
        });
      }
      // AWS S3 HeadObject equivalent for S3 backend (add similarly)
    } catch {
      await this.prisma.writer.formSubmissionFile.update({
        where: { id: fileId },
        data: { status: 'DELETED' },
      });
    }
  }
}
```

### 7.4 MinIO Bucket Setup Best Practices

```bash
# Create org-scoped bucket (run via mc CLI or MinIO Console)
mc mb myminio/formbuilder-org-{orgId}

# Set bucket lifecycle: delete PENDING_UPLOAD files older than 30 minutes
mc ilm add myminio/formbuilder-org-{orgId} \
  --expiry-days 1 \
  --tags "status=PENDING_UPLOAD"

# Enable server-side encryption
mc encrypt set sse-s3 myminio/formbuilder-org-{orgId}

# Set event notification (webhook) for object creation → triggers FileVerifier worker
mc event add myminio/formbuilder-org-{orgId} \
  arn:minio:sqs::1:webhook \
  --event put
```

---

## 8. Authentication & Authorization

### 8.1 JWT + Refresh Token Rotation

```
POST /auth/login
  → Access Token (JWT, 15 min TTL, signed RS256)
  → Refresh Token (opaque 32-byte random, 7 days, stored hashed in refresh_tokens table)
  → Refresh Token set in HttpOnly, Secure, SameSite=Strict cookie

POST /auth/refresh
  → Validate cookie refresh token hash
  → Revoke old token (revokedAt = NOW())
  → Issue new access + refresh token pair (rotation)
  → Return new access token in response body

POST /auth/logout
  → Revoke refresh token (revokedAt = NOW())
  → Clear cookie
```

### 8.2 Authorization Guards Chain

Every protected route passes through this guard stack in order:

```
Request
  ├── JwtAuthGuard        ← Validates Bearer JWT signature and expiry
  ├── OrgMemberGuard      ← Checks user has membership in target org
  └── RoleGuard           ← Checks user's role meets minimum required role
```

```typescript
// Usage in controller
@Get(':orgId/forms')
@UseGuards(JwtAuthGuard, OrgMemberGuard)
@RequiredRole(UserRole.VIEWER)
async listForms(@OrgId() orgId: string) {
  // ...
}
```

---

## 9. Multi-Tenancy & Quota Enforcement

All database queries include `organizationId` in the WHERE clause via a service-level wrapper:

```typescript
// src/modules/forms/forms.service.ts

async createForm(orgId: string, dto: CreateFormDto, userId: string) {
  // Enforce quota before write
  const org = await this.prisma.reader.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { maxForms: true, _count: { select: { forms: true } } },
  });

  if (org._count.forms >= org.maxForms) {
    throw new ForbiddenException('Organization form quota reached. Upgrade your plan.');
  }

  return this.prisma.writer.form.create({
    data: {
      organizationId: orgId,   // ALWAYS set from JWT, never from request body
      createdById: userId,
      ...dto,
    },
  });
}
```

---

## 10. Caching Strategy

| Data | Cache Key | TTL | Invalidation |
|---|---|---|---|
| Public form config (for respondents) | `form:config:{slug}` | 5 min | On form publish/update |
| Organization quota | `org:quota:{orgId}` | 1 min | On submission accept |
| Rate limit counters | `rl:{formId}:{ipHash}` | 60 s | Natural TTL expiry |
| User session JWT sub | `session:{userId}` | 15 min | On logout |

```typescript
// Cache-Aside pattern for public form config
async getPublicFormConfig(slug: string) {
  const cacheKey = `form:config:${slug}`;
  const cached = await this.redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const form = await this.prisma.reader.form.findUnique({
    where: { slug, status: 'PUBLISHED' },
    include: {
      versions: {
        where: { version: form.currentVersion },
        take: 1,
      },
    },
  });

  await this.redis.set(cacheKey, JSON.stringify(form), 'EX', 300); // 5 min TTL
  return form;
}
```

---

## 11. Rate Limiting & Anti-Spam

### 11.1 Redis Sliding-Window Rate Limiter

```typescript
// src/common/guards/rate-limiter.guard.ts

// Submission rate limits per IP per form
const SUBMISSION_LIMIT = 10;   // max 10 submissions
const WINDOW_SECONDS  = 60;    // per 60 seconds

async function checkSubmissionRateLimit(formId: string, ipHash: string): Promise<void> {
  const key = `rl:submit:${formId}:${ipHash}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, WINDOW_SECONDS);
  if (count > SUBMISSION_LIMIT) {
    throw new TooManyRequestsException('Submission rate limit exceeded. Try again shortly.');
  }
}
```

### 11.2 Anti-Spam Layers

| Layer | Mechanism | Where |
|---|---|---|
| CAPTCHA | Cloudflare Turnstile token verification | API controller (before enqueue) |
| Honeypot | Hidden field `_gotcha` must be empty | Client-side + worker validation |
| Velocity | Redis sliding-window per IP per form | Rate limiter guard |
| Duplicate | IP hash comparison within 1 minute window | Worker processor |
| Bot Pattern | `userAgent` blocklist regex | Worker processor |

---

## 12. Webhooks & Event-Driven Integrations

```typescript
// src/modules/webhooks/webhooks.processor.ts

@Processor('webhooks_queue')
export class WebhookProcessor extends WorkerHost {
  async process(job: Job<WebhookJob>) {
    const { webhookId, submissionId, payload } = job.data;
    const webhook = await this.prisma.reader.formWebhook.findUniqueOrThrow({
      where: { id: webhookId, isActive: true },
    });

    // HMAC-SHA256 signature (recipient verifies using stored secret)
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(JSON.stringify(payload))
      .digest('hex');

    const startTime = Date.now();
    let statusCode = 0, responseBody = '', success = false;

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-FormBuilder-Signature': `sha256=${signature}`,
          'X-FormBuilder-Event': 'form.submission',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000), // 10 second timeout
      });
      statusCode = response.status;
      responseBody = (await response.text()).slice(0, 2000);
      success = response.ok;
    } catch (err) {
      responseBody = err.message;
    }

    // Log delivery attempt (for owner inspection in UI)
    await this.prisma.writer.webhookDelivery.create({
      data: {
        webhookId,
        submissionId,
        statusCode,
        responseBody,
        attempt: job.attemptsMade + 1,
        success,
      },
    });

    if (!success) throw new Error(`Webhook delivery failed: HTTP ${statusCode}`);
  }
}
```

**BullMQ retry config** (in `bullmq.config.ts`):
```typescript
defaultJobOptions: {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1000 }, // 1s, 2s, 4s, 8s, 16s
  removeOnComplete: { count: 1000 },
  removeOnFail: false, // Keep failed jobs in DLQ for inspection
},
```

---

## 13. Analytics & Observability

### 13.1 Structured Logging with Pino

```typescript
// main.ts
const app = await NestFactory.create(AppModule, {
  logger: new Logger(),
  bufferLogs: true,
});
app.useLogger(app.get(Logger));

// Every request log includes:
// { level, time, reqId, method, url, statusCode, responseTimeMs, userId, orgId }
```

### 13.2 Metrics (Prometheus + Grafana)

Expose `/metrics` via `@willsoto/nestjs-prometheus`:

| Metric | Type | Description |
|---|---|---|
| `formbuilder_submissions_total` | Counter | Total submissions processed |
| `formbuilder_queue_depth` | Gauge | BullMQ submissions queue depth |
| `formbuilder_submission_latency_ms` | Histogram | End-to-end processing time |
| `formbuilder_file_uploads_total` | Counter | Files uploaded by provider |
| `formbuilder_webhook_failures_total` | Counter | Failed webhook deliveries |
| `formbuilder_db_query_latency_ms` | Histogram | PostgreSQL query latency |

### 13.3 Health Checks

```typescript
// GET /health → used by K8s liveness/readiness probes
@Controller('health')
export class HealthController {
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('postgresql'),
      () => this.redis.checkHealth('redis'),
      () => this.minio.checkHealth('minio'),
    ]);
  }
}
```

---

## 14. API Design & Versioning

All routes are versioned under `/v1/` prefix. Versioning policy: **URI versioning** (not header-based, for CDN cache-friendliness).

### Public Endpoints (No Auth Required)

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/public/forms/:slug` | Fetch published form config for respondents |
| `POST` | `/v1/public/forms/:slug/submit` | Submit form answers (accepts CaptchaToken header) |
| `POST` | `/v1/storage/presigned-url` | Request a file upload URL (requires formId + questionId) |

### Authenticated Endpoints (JWT Required)

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/auth/register` | Create user account |
| `POST` | `/v1/auth/login` | Login |
| `POST` | `/v1/auth/refresh` | Rotate refresh token |
| `GET` | `/v1/orgs/:orgId/forms` | List forms |
| `POST` | `/v1/orgs/:orgId/forms` | Create form |
| `GET` | `/v1/orgs/:orgId/forms/:formId` | Get form detail |
| `PATCH` | `/v1/orgs/:orgId/forms/:formId` | Update form (creates new version if published) |
| `POST` | `/v1/orgs/:orgId/forms/:formId/publish` | Publish form (snapshots new version) |
| `GET` | `/v1/orgs/:orgId/forms/:formId/submissions` | List submissions (paginated, filterable) |
| `GET` | `/v1/orgs/:orgId/forms/:formId/analytics` | Aggregated analytics |
| `GET` | `/v1/orgs/:orgId/forms/:formId/export` | Export submissions as CSV/JSON |
| `POST` | `/v1/orgs/:orgId/forms/:formId/webhooks` | Add webhook |

**Standard Response Envelope:**
```json
{
  "data": { ... },
  "meta": {
    "requestId": "uuid",
    "timestamp": "2026-07-27T10:00:00Z",
    "pagination": { "page": 1, "limit": 50, "total": 12450 }
  }
}
```

---

## 15. Security Best Practices

| Area | Implementation |
|---|---|
| **Passwords** | `argon2id` (time=3, memory=64MB, parallelism=4) |
| **JWT signing** | RS256 asymmetric key pair (private key never leaves server) |
| **Refresh tokens** | SHA-256 hashed before storage; rotated on every use |
| **API keys** | `fbk_` prefix + 32-byte random; SHA-256 hash stored |
| **CORS** | Strict allowlist of frontend origins |
| **Helmet** | Enabled on all routes (CSP, HSTS, X-Frame-Options) |
| **SQL Injection** | Prisma parameterized queries everywhere; zero raw concatenation |
| **File uploads** | MIME type allowlist; magic byte inspection in worker; ClamAV scan |
| **JSONB safety** | Never `JSON.parse(userInput)` directly — always use class-validator DTO first |
| **IP privacy** | Daily-salted SHA-256 hash of IP stored (never raw IP) |
| **Secrets** | All secrets in env vars; rotated via Vault/AWS Secrets Manager |
| **Rate limiting** | Redis sliding window on submissions + Redis token bucket on login |
| **CAPTCHA** | Cloudflare Turnstile on all public form submission endpoints |

---

## 16. Scalability & Infrastructure

### 16.1 Horizontal Scaling

```
API Pods:       6–20 replicas (CPU-based HPA — stateless, no shared memory needed)
Worker Pods:    4–10 replicas (Queue-depth-based HPA — scale on BullMQ queue size)
PostgreSQL:     1 Primary + 2 Read Replicas (streaming replication, synchronous_commit=off on replicas)
Redis:          Redis Cluster (3 masters, 3 replicas) or ElastiCache Cluster Mode
MinIO:          MinIO Distributed Mode (4+ nodes, erasure coding) or Managed Object Store
```

### 16.2 Kubernetes HPA for Workers

```yaml
# hpa-worker.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: submission-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: submission-worker
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: External
    external:
      metric:
        name: bullmq_queue_depth
        selector:
          matchLabels:
            queue: submissions_queue
      target:
        type: AverageValue
        averageValue: "100"  # Scale up when average queue depth > 100 per worker pod
```

---

## 17. Docker & Local Development Setup

```yaml
# docker-compose.yml
version: '3.9'

services:
  api:
    build: .
    ports: ['3000:3000']
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://formbuilder:secret@postgres:5432/formbuilder
      - REDIS_URL=redis://redis:6379
      - STORAGE_PROVIDER=minio
      - MINIO_ENDPOINT=minio
      - MINIO_PORT=9000
      - MINIO_ACCESS_KEY=minioadmin
      - MINIO_SECRET_KEY=minioadmin
      - MINIO_DEFAULT_BUCKET=formbuilder-uploads
      - JWT_PRIVATE_KEY_PATH=/run/secrets/jwt_private_key
      - JWT_PUBLIC_KEY_PATH=/run/secrets/jwt_public_key
    depends_on: [postgres, redis, minio]

  worker:
    build: .
    command: node dist/worker.js   # Separate entrypoint for worker cluster
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://formbuilder:secret@postgres:5432/formbuilder
      - REDIS_URL=redis://redis:6379
      - STORAGE_PROVIDER=minio
      - MINIO_ENDPOINT=minio
    depends_on: [postgres, redis, minio]

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: formbuilder
      POSTGRES_USER: formbuilder
      POSTGRES_PASSWORD: secret
    volumes:
      - pg_data:/var/lib/postgresql/data
    ports: ['5432:5432']

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    ports: ['6379:6379']

  # MinIO: Primary self-hosted S3-compatible object storage
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - minio_data:/data
    ports:
      - '9000:9000'   # S3 API
      - '9001:9001'   # MinIO Web Console (open http://localhost:9001)

  # MinIO bucket init (runs once to create the default bucket)
  minio-init:
    image: minio/mc
    depends_on: [minio]
    entrypoint: >
      /bin/sh -c "
      mc alias set myminio http://minio:9000 minioadmin minioadmin;
      mc mb myminio/formbuilder-uploads --ignore-existing;
      mc anonymous set none myminio/formbuilder-uploads;
      mc encrypt set sse-s3 myminio/formbuilder-uploads;
      exit 0;
      "

volumes:
  pg_data:
  redis_data:
  minio_data:
```

**First-time setup:**
```bash
# 1. Start all services
docker-compose up -d

# 2. Run database migrations
npx prisma migrate dev --name init_formbuilder_schema

# 3. Add GIN index on answers JSONB (run after migration)
psql postgresql://formbuilder:secret@localhost:5432/formbuilder \
  -f prisma/sql/add_gin_index.sql

# 4. Open MinIO console
open http://localhost:9001  # Login: minioadmin / minioadmin

# 5. Start API dev server
npm run start:dev
```

---

## 18. Environment Variables Reference

```env
# ── Database ─────────────────────────────────────────────────────────
DATABASE_URL=postgresql://formbuilder:password@pgbouncer:5432/formbuilder?pgbouncer=true&connection_limit=5
DATABASE_REPLICA_URL=postgresql://formbuilder:password@pg-replica:5432/formbuilder

# ── Redis ────────────────────────────────────────────────────────────
REDIS_URL=redis://redis-cluster:6379

# ── Auth ─────────────────────────────────────────────────────────────
JWT_PRIVATE_KEY_PATH=/secrets/jwt.key         # RS256 private key path
JWT_PUBLIC_KEY_PATH=/secrets/jwt.key.pub      # RS256 public key path
JWT_ACCESS_TTL_SECONDS=900                    # 15 minutes
JWT_REFRESH_TTL_DAYS=7

# ── Storage (Primary: MinIO) ──────────────────────────────────────────
STORAGE_PROVIDER=minio                        # "minio" (default) or "s3"
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_DEFAULT_BUCKET=formbuilder-uploads

# ── Storage (Optional: AWS S3) ────────────────────────────────────────
# Uncomment and set STORAGE_PROVIDER=s3 to use AWS S3 instead of MinIO
# AWS_REGION=ap-south-1
# AWS_ACCESS_KEY_ID=AKIA...
# AWS_SECRET_ACCESS_KEY=...
# AWS_S3_BUCKET=formbuilder-prod-uploads

# ── CAPTCHA ───────────────────────────────────────────────────────────
CLOUDFLARE_TURNSTILE_SECRET=0x4AAAAAAA...     # Cloudflare Turnstile secret

# ── File Upload Limits ────────────────────────────────────────────────
MAX_FILE_SIZE_MB=25                           # Global default max file size
PRESIGNED_URL_TTL_SECONDS=900                 # 15 minutes

# ── App Config ────────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
API_PREFIX=v1
CORS_ORIGINS=https://your-frontend.com,https://your-admin.com
```

---

> **Related Files:**
> - Database Schema: [`prisma/schema.prisma`](file:///d:/chrome%20download/vibha%20website/form-builder/prisma/schema.prisma)
> - Frontend Types: [`src/types/form.ts`](file:///d:/chrome%20download/vibha%20website/form-builder/src/types/form.ts)
