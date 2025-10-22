import { logger } from './logger';

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  context?: Record<string, unknown>,
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | null = null;
  let delay = cfg.initialDelay;

  for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === cfg.maxRetries) {
        logger.error(
          {
            ...context,
            attempt,
            maxRetries: cfg.maxRetries,
            err: lastError,
          },
          'retry_exhausted',
        );
        throw lastError;
      }

      logger.warn(
        {
          ...context,
          attempt,
          maxRetries: cfg.maxRetries,
          nextDelayMs: delay,
          err: lastError,
        },
        'retry_attempt',
      );

      await sleep(delay);
      delay = Math.min(delay * cfg.backoffMultiplier, cfg.maxDelay);
    }
  }

  throw lastError;
}
