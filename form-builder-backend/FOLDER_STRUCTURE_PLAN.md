# Backend Folder Structure Reorganization Plan

## Current state

The backend already follows a reasonable NestJS convention (`modules/*` with
controller/module/service/dto), so this isn't a from-scratch redesign. Three
areas have grown messy enough to fix:

1. **`src/common/`** — a flat bag of 16 subfolders with no grouping by
   concern (auth guards, observability, infra, HTTP pipeline concerns all
   sit as siblings).
2. **`src/modules/assistant/`** — 18 loose files at its module root (chat,
   prompts, quota, insights all mixed together), the module most likely to
   keep growing.
3. **Several other `modules/*`** have accumulated secondary controllers,
   secondary services, and standalone logic/policy files loose at their
   root alongside the primary controller/module/service trio. See
   "Module-by-module reorganization" below for the full audit.

`config/` and `prisma/` are already clean and untouched by this plan.

## Proposed structure

```
src/
├── common/
│   ├── auth/                 # guards + decorators (auth/authz concerns)
│   │   ├── api-key.guard.ts
│   │   ├── api-key-or-jwt.guard.ts
│   │   ├── api-key-policy.ts (+.spec)
│   │   ├── jwt-auth.guard.ts
│   │   ├── optional-jwt-auth.guard.ts
│   │   ├── org-member.guard.ts
│   │   ├── role.guard.ts
│   │   ├── super-admin.guard.ts
│   │   ├── current-user.decorator.ts
│   │   ├── org-id.decorator.ts
│   │   ├── public.decorator.ts
│   │   ├── roles.decorator.ts
│   │   └── scopes.decorator.ts
│   ├── http/                 # request/response pipeline concerns
│   │   ├── http-exception.filter.ts
│   │   ├── logging.interceptor.ts
│   │   ├── response.interceptor.ts
│   │   ├── cache-control.interceptor.ts (+.spec)
│   │   └── pagination/ (audit-query.dto, pagination.ts, pagination-query.dto)
│   ├── observability/         # logging, metrics, health checks
│   │   ├── logger/
│   │   ├── metrics/
│   │   └── health/
│   ├── infra/                 # external systems
│   │   ├── prisma/
│   │   ├── redis/
│   │   ├── session/
│   │   ├── queues/ (observed-queues.module.ts)
│   │   ├── crypto/
│   │   └── net/ (url-guard.ts)
│   ├── tenancy/                # unchanged
│   ├── rules/                  # unchanged (rules engine)
│   └── legacy-logic.ts (+.spec) # stays put -- see note below
│
├── config/                     # unchanged, already clean
│
└── modules/
    ├── assistant/
    │   ├── assistant.controller.ts        # entrypoints stay at root
    │   ├── platform-assistant.controller.ts
    │   ├── assistant.module.ts
    │   ├── dto/
    │   ├── chat/                # assistant-chat.service, session.service, org-chat.ts
    │   ├── prompts/             # system-prompts.ts, help-content/
    │   ├── quota/               # quota.service.ts, usage.service.ts
    │   ├── insights/            # platform-insights.service.ts (+.spec)
    │   ├── core/                # agent-loop.service, claude-client.service, idea.service, faq-cache.service (+.spec)
    │   └── tools/                # unchanged, already its own folder
    └── ...all other modules unchanged
```

## Module-internal organization rules

Applied consistently to every module under `src/modules/`:

- `<module>.controller.ts`, `<module>.module.ts`, `<module>.service.ts` (the
  Nest-generated trio) always stay at the module root — that's the first
  thing anyone should see when opening the folder.
- `dto/`, `queues/`, `guards/`, `strategies/` are already established
  conventions in this codebase (used by `auth/`, `notifications/`,
  `exports/`, `storage/`, `submissions/`, `webhooks/`) — kept as-is,
  extended to any module that needs them.
- **New: `controllers/`** for secondary controllers (`public-*`,
  `platform-*`, sub-resource controllers) once a module has **3 or more
  controllers total**. Below that (2 controllers), leave them at root —
  e.g. `assistant/` and `forms/` each have exactly 2 and stay flat.
- **New: `services/`** for secondary injectable services beyond the
  primary `<module>.service.ts`.
- **New: `logic/`** for standalone, non-injectable helper/policy modules
  (and their `.spec.ts`) — pure logic that doesn't depend on Nest DI.
- A spec file that imports from `<module>.service.ts` (i.e. it tests the
  service itself, not a standalone helper) stays next to the service even
  if its filename suggests a narrower concept. Verified by checking actual
  imports, not guessed from filenames:
  - `forms/export-filters.spec.ts` and `forms/export-stream.spec.ts` both
    import from `./forms.service` → stay at `forms/` root.
  - `exports/export-jobs.spec.ts` imports both `./exports.service` and
    `./export-progress` → stays at `exports/` root even after
    `export-progress.ts` moves into `exports/logic/` (update the one
    import path).

### Modules that change

**`admin/`** — two secondary services, bucket them:
```
admin/
├── admin.controller.ts
├── admin.module.ts
├── admin.service.ts
├── dto/
└── services/
    ├── admin-users.service.ts
    └── system.service.ts
```

**`auth/`** — one standalone logic pair, bucketed for consistency with the
existing `strategies/` folder:
```
auth/
├── auth.controller.ts
├── auth.module.ts
├── auth.service.ts
├── dto/
├── strategies/            # unchanged
│   └── jwt.strategy.ts
└── logic/
    ├── refresh-token-family.ts
    └── refresh-token-family.spec.ts
```

**`choice-lists/`** — 3 controllers total → bucket the two secondary ones;
one logic pair bucketed too:
```
choice-lists/
├── choice-lists.controller.ts
├── choice-lists.module.ts
├── choice-lists.service.ts
├── dto/
├── controllers/
│   ├── platform-choice-lists.controller.ts
│   └── public-choice-items.controller.ts
└── logic/
    ├── csv.ts
    └── csv.spec.ts
```

**`exports/`** — 4 standalone logic files:
```
exports/
├── exports.controller.ts
├── exports.module.ts
├── exports.service.ts
├── export-jobs.spec.ts     # stays — tests exports.service directly
├── dto/
├── queues/                 # unchanged
└── logic/
    ├── export-filters.ts
    ├── export-policy.ts
    ├── export-progress.ts
    └── export-uploader.ts
```

**`form-apps/`** — the second-most sprawling module after `assistant/`: 4
controllers, a secondary service, and 3 logic pairs:
```
form-apps/
├── form-apps.controller.ts
├── form-apps.module.ts
├── form-apps.service.ts
├── controllers/
│   ├── form-app-steps.controller.ts
│   ├── public-apps.controller.ts
│   └── subject-entries.controller.ts
├── services/
│   └── form-app-sessions.service.ts
└── logic/
    ├── period-cadence.ts (+.spec)
    ├── step-schedule.ts (+.spec)
    └── step-scope.ts (+.spec)
```

**`forms/`** — only 2 controllers total (stays flat, per the rule above);
just the one standalone logic pair moves:
```
forms/
├── forms.controller.ts
├── forms.module.ts
├── forms.service.ts
├── public-forms.controller.ts   # stays — only 2 controllers total
├── export-filters.spec.ts       # stays — tests forms.service
├── export-stream.spec.ts        # stays — tests forms.service
├── dto/
└── logic/
    ├── form-structure.ts
    └── form-structure.spec.ts
```

**`notifications/`** — one standalone logic pair:
```
notifications/
├── notifications.controller.ts
├── notifications.module.ts
├── notifications.service.ts
├── notification-stream.service.ts
├── sse-ticket.service.ts
├── dto/
├── guards/                 # unchanged
└── logic/
    ├── notification-recipients.ts
    └── notification-recipients.spec.ts
```

**`submissions/`** — one secondary service, one standalone policy pair:
```
submissions/
├── submissions.controller.ts
├── submissions.module.ts
├── submissions.service.ts
├── dto/
├── queues/                 # unchanged
├── services/
│   ├── answer-validator.service.ts
│   └── answer-validator.service.spec.ts
└── logic/
    ├── submission-review.policy.ts
    └── submission-review.policy.spec.ts
```

### Modules with no change

Already minimal (controller/module/service ± a small `dto/`), no clutter
to fix: `analytics/`, `api-keys/`, `audit/`, `feature-flags/`, `lookup/`,
`mail/`, `organizations/`, `storage/`, `subjects/`, `templates/`,
`webhooks/`.

## Note on `common/legacy-logic.ts`

This file explicitly documents itself as mirrored byte-for-byte with
`frontend/src/lib/legacy-logic.ts` and is required to import nothing (pure
TS over plain objects, so the same code runs in the browser). It is left in
place at `common/` root rather than folded into `rules/` -- moving it risks
someone missing the frontend-mirror requirement, and its whole point is
being a standalone, easy-to-find file. Do not relocate without updating the
mirrored frontend copy in the same change.

## What this buys us

- `common/` currently forces scanning 16 sibling folders to find "where do
  auth guards live"; grouped, it's 6 top-level concerns.
- `assistant/` and `form-apps/` stop being flat lists of 13-18 files each
  that are hard to onboard someone into.
- Every module now follows the same predictable shape: primary trio at
  root, then `dto/` / `queues/` / `guards/` / `strategies/` /
  `controllers/` / `services/` / `logic/` as needed — so knowing the rule
  once tells you where to look in any module, not just the ones that got
  reorganized.

## Cost / risk

This is a mechanical but wide-reaching refactor across `common/` and 9
modules (`assistant`, `admin`, `auth`, `choice-lists`, `exports`,
`form-apps`, `forms`, `notifications`, `submissions`) — roughly 60+ files
move in total, and every import path referencing them needs updating.
Plan is to use barrel `index.ts` files per new folder where sensible, to
limit import churn to one line per consumer rather than per file, and to
do the move module-by-module (running `tsc`/tests after each) rather than
as one giant commit, so a mistake is easy to isolate. Fully reversible via
git, but the full diff across all modules will be large to review —
recommend reviewing it one module/commit at a time.

## Decision

Scope selected: **full reorg** — `common/` regrouping, `assistant/` split,
and the module-by-module changes above.

## Status: implemented

Done across 4 commits (moves via `git mv`, then a small Node codemod to
recompute every relative import path, plus hand fixes for the handful of
tests that read source by string path instead of `import`):

1. `refactor(backend): regroup src/common by concern`
2. `refactor(backend): split modules/assistant into chat/core/prompts/quota/insights`
3. `refactor(backend): tidy secondary controllers/services/logic in 8 modules`
4. `fix(backend): update e2e test imports for common/ reorg`

Verified after each stage: `tsc --noEmit` clean, and the full Jest suite
(616 tests) passes.
