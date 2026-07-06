import './infrastructure/bigint-json';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Worker entrypoint — same codebase as the API, different process.
 * Runs BullMQ processors (outbox relay, contest lock, result fetching,
 * scoring, prize distribution, notifications) without an HTTP listener,
 * so API pods and worker pods scale independently.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  // Processors self-register via their modules; keep the context alive.
  // eslint-disable-next-line no-console
  console.log('[worker] Football IQ worker started');
}

void bootstrap();
