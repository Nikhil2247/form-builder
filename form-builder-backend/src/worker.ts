// MUST be first — see the note in main.ts. The worker is entirely queue-driven,
// so a Redis URL resolved before .env loads breaks it completely.
import './config/env';

// Before AppModule, for the same reason as main.ts: Sentry instruments modules
// at require time. Tagged 'worker' so a failure in code shared with the API is
// attributable to the deployment it actually happened on.
import { initSentry } from './config/sentry';
initSentry('worker');

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WinstonNestAdapter } from './common/logger/winston-nest.adapter';

// Patch BigInt to be serializable by JSON.stringify (mirrors main.ts).
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

/**
 * Worker entrypoint — queue consumers only, no HTTP server.
 *
 * WHY THIS EXISTS:
 *  Running BullMQ processors inside the API process means a burst of queued
 *  submissions competes with HTTP request handling for the same event loop, and
 *  ingest capacity cannot be scaled independently of API capacity. Deploy this
 *  as a separate Deployment with its own HPA keyed on queue depth.
 *
 * USAGE:
 *  PROCESS_ROLE=worker node dist/worker.js
 *  (and PROCESS_ROLE=api on the API deployment)
 */
async function bootstrapWorker() {
  process.env.PROCESS_ROLE = 'worker';

  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(WinstonNestAdapter));

  // enableShutdownHooks wires SIGTERM/SIGINT to onModuleDestroy, which is what
  // lets BullMQ finish in-flight jobs instead of dropping them mid-processing.
  app.enableShutdownHooks();

  console.log('🛠️  Worker started — consuming queues (no HTTP listener).');

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, draining active jobs...`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// Same reasoning as main.ts: a worker that cannot reach Redis must exit
// non-zero so the orchestrator restarts it, rather than dying to an unhandled
// rejection and leaving the queue quietly unconsumed.
bootstrapWorker().catch((err) => {
  console.error('Fatal: worker failed to start.', err);
  process.exit(1);
});
