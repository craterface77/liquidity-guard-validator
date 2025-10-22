import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { env } from '../config/env';
import { logger } from '../lib/logger';

type QueryArgs = {
  query: string;
  params?: Record<string, unknown>;
};

type InsertArgs = {
  table: string;
  values: Record<string, unknown>[];
  format?: 'JSONEachRow';
};

let client: ClickHouseClient | null = null;

function getClient() {
  if (client) return client;
  client = createClient({
    url: env.CLICKHOUSE_URL,
    database: 'liquidityguard',
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    clickhouse_settings: {
      allow_experimental_object_type: 1,
    },
  });
  return client;
}

export async function clickhouseQuery<T = Record<string, unknown>>({
  query,
  params,
}: QueryArgs): Promise<T[]> {
  const c = getClient();
  const queryConfig: any = {
    query,
    format: 'JSONEachRow',
  };
  if (params) {
    queryConfig.query_params = params;
  }
  const result = await c.query(queryConfig);
  const json = await result.json<T>();
  return json as unknown as T[];
}

export async function clickhouseInsert({ table, values, format = 'JSONEachRow' }: InsertArgs): Promise<void> {
  const c = getClient();
  await c.insert({
    table,
    values,
    format,
  });
}

export async function closeClickhouse() {
  if (!client) return;
  try {
    await client.close();
  } catch (error) {
    logger.warn({ err: error }, 'Failed to close ClickHouse client');
  } finally {
    client = null;
  }
}
