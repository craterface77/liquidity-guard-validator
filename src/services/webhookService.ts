import axios from 'axios';
import crypto from 'crypto';
import { env } from '../config/env';
import { logger } from '../lib/logger';

const WEBHOOK_PATHS: Record<string, string> = {
  DEPEG_START: '/internal/validator/anchors',
  DEPEG_END: '/internal/validator/anchors',
  POOL_STATE: '/internal/validator/pool-state',
};

export async function emitWebhook(event: { kind: string; payload: unknown }) {
  if (!env.WEBHOOK_BASE_URL) {
    return;
  }

  const path = WEBHOOK_PATHS[event.kind];
  if (!path) {
    logger.warn({ kind: event.kind }, 'unknown_webhook_kind');
    return;
  }

  const url = new URL(path, env.WEBHOOK_BASE_URL).toString();

  try {
    const body = JSON.stringify(event.payload ?? {});
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (env.WEBHOOK_SECRET) {
      headers['x-lg-signature'] = createSignature(body);
    }
    await axios.post(url, body, { headers, timeout: 10_000 });
  } catch (error) {
    logger.error({ err: error, kind: event.kind }, 'webhook_delivery_failed');
  }
}

function createSignature(body: string) {
  return crypto.createHmac('sha256', env.WEBHOOK_SECRET!).update(body).digest('hex');
}
