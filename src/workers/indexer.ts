import { env } from '../config/env';
import { logger } from '../lib/logger';
import { IndexerService } from '../services/indexer/indexerService';
import { emitWebhook } from '../services/webhookService';

const service = new IndexerService(emitWebhook);

async function loop() {
  try {
    await service.poll();
  } catch (error) {
    logger.error({ err: error }, 'indexer_poll_failed');
  } finally {
    setTimeout(loop, env.POLL_INTERVAL_MS);
  }
}

loop();
