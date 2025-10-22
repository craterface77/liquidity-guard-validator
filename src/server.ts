import { buildApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';

async function start() {
  const app = await buildApp();
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info({ port: env.PORT }, 'API listening');
}

start().catch((error) => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
