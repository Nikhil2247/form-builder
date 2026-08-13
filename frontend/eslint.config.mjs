import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
  {
    rules: {
      // ── `any`: WARN here, and OFF in the backend config ────────────────────
      //
      // 57 hits, almost all on API response shapes and Prisma-derived payloads
      // crossing the network boundary, where the honest type genuinely is
      // "whatever the server sent" until it is narrowed. The backend turns this
      // rule off entirely for the same reason; a warning is the stricter of the
      // two settings and keeps the count visible.
      //
      // This is the difference between a lint gate that blocks a real defect and
      // one that blocks a merge over a response type. Burn it down by typing the
      // API surface, not by silencing it.
      '@typescript-eslint/no-explicit-any': 'warn',

      // ── React Compiler findings: WARN, and they are REAL ───────────────────
      //
      // `reactCompiler: true` is on in next.config.ts, and these rules are the
      // compiler telling us where it cannot safely optimise — or where a pattern
      // is genuinely unsound. 17 hits remain, and they are NOT dismissed:
      //
      //   react-hooks/set-state-in-effect (11) — setState during an effect
      //     causes a second render pass. Several are the legitimate
      //     "subscribe to matchMedia / sync from a prop" shape (use-mobile.ts,
      //     carousel.tsx); others in the dashboard pages look like state that
      //     should be derived during render instead.
      //   react-hooks/preserve-manual-memoization (3) — EnterpriseFieldCard's
      //     hand-written memoization is opting that component out of compiler
      //     optimisation, which matters: it is the component rendered once per
      //     field in the builder.
      //   react-hooks/rules-of-hooks (1), purity (1), refs (1) — one each,
      //     individually worth reading.
      //
      // They are warnings rather than errors because each needs a real
      // per-component decision, not a mechanical edit, and gating every merge on
      // 17 open refactors is how a team learns to pass `--no-verify`. Tracked as
      // follow-up work; the `--max-warnings` ratchet in CI stops the count
      // growing while they are worked through.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
]);

export default eslintConfig;
