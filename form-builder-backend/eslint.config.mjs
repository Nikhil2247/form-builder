// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],

      // ── The `no-unsafe-*` family: WARN, not ERROR ──────────────────────────
      //
      // These five rules account for ~950 of this codebase's ~1,000 remaining
      // lint findings, and almost all of them trace to two sources that are not
      // careless typing:
      //
      //   1. Prisma's JSONB columns. `Form.questionsJson`, `FormVersion.*Json`,
      //      `FormSubmission.answers` and `ChoiceItem.metadata` are typed
      //      `Prisma.JsonValue`, which is `any`-adjacent by construction. Their
      //      shapes are genuinely dynamic — they are user-authored form
      //      definitions — and the codebase validates them at the boundary
      //      (normalizeFormStructure, AnswerValidatorService, compileRules)
      //      rather than pretending a static type describes them.
      //   2. Prisma's interactive-transaction callbacks, typed `(tx: any)`.
      //
      // Turning these into errors would gate the build on ~950 findings whose
      // honest fix is a cast that adds no safety. That is how a lint gate stops
      // being read: the rule fires constantly, the team learns the file is noisy,
      // and the genuine finding in the middle of it is never seen.
      //
      // They stay ON as warnings — visible in the job log, greppable, and
      // available to burn down incrementally — while everything below is an
      // error and blocks the build. That is the distinction that makes
      // `--max-warnings` a meaningful dial rather than a rubber stamp.
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',

      // ── Promoted to ERROR: these catch real defects ────────────────────────
      //
      // An unhandled rejection terminates the process on Node 15+, so a floating
      // promise is a latent crash rather than a style opinion. This was 'warn'
      // and had 48 hits; 46 of them came from a single `async` keyword on
      // AuditService.log() that awaited nothing (see the docblock there). With
      // that signature corrected the count is low enough to hold at zero.
      '@typescript-eslint/no-floating-promises': 'error',

      // Destructuring-with-rest is how this codebase strips fields a caller must
      // not see — `const { passwordHash, questionsJson, ...rest } = form` in
      // FormsService is the pattern, and it is a good one: the omission is
      // visible at the point of use and cannot drift from a separate `select`.
      // The named bindings are unused BY DESIGN; that is the entire mechanism.
      // Without `ignoreRestSiblings` the rule flags every field being stripped,
      // which reads as "delete these" — precisely the wrong action.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          ignoreRestSiblings: true,
          // Conventional opt-out for a binding that must exist positionally but
          // is not read — an unused first parameter, a caught error that is
          // deliberately swallowed.
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Specs assert on mock shapes and deliberately construct malformed input,
    // so unused bindings and unbound method references are the normal idiom
    // there rather than a smell.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
);
