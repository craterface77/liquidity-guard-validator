import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config();

async function migrate() {
  const url = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123';
  const username = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';

  const client = createClient({
    url,
    username,
    password,
    session_id: 'migration_session',
    clickhouse_settings: {
      allow_experimental_object_type: 1
    }
  });

  try {
    const migrationPath = resolve(process.cwd(), 'clickhouse/migrations/001_create_tables.sql');
    const sql = readFileSync(migrationPath, 'utf8');
    const statements = sql
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await client.command({ query: statement });
    }

    console.log('Migrations applied successfully.');
  } finally {
    await client.close();
  }
}

migrate().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
