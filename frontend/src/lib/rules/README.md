# Rules engine — mirror, do not edit here

Every `.ts` file in this directory is a **byte-for-byte copy** of
`form-builder-backend/src/common/rules/`.

The browser must evaluate rules with exactly the same code the server does. If
the two ever diverge, a respondent sees one calculated value and the server
stores another — and because the server's value is the one that counts, the
disagreement is silent.

## Changing the engine

Edit the backend copy, then re-sync:

```bash
cp form-builder-backend/src/common/rules/*.ts frontend/src/lib/rules/
```

CI fails if the directories differ — see the "rules engine mirror" step in
`.github/workflows/ci.yml`.

## Why a copy instead of a shared package

The repo is two independent apps with separate lockfiles and no monorepo
tooling. Introducing npm workspaces to share seven dependency-free files would
restructure installs and CI for both. A copy plus an enforced equality check
gets the same guarantee at a fraction of the disruption, and turning it into a
real package later is a file move.

## What runs where

| | Browser (this copy) | Server (backend copy) |
|---|---|---|
| Purpose | Live UX — show calculated values, hide questions | Authority |
| Trusted | **No** | **Yes** |

The server recomputes every calculated value and discards whatever the client
sent. Client-side evaluation exists purely so the form feels responsive.
