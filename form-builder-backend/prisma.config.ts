import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * Prisma 7 replaced the plain-object export used in v5/v6 with defineConfig(),
 * moved the seed command out of package.json's "prisma" key, and requires the
 * datasource URL to be resolved here rather than only in the schema.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
