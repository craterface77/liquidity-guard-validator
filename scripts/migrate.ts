import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";
import { createClient } from "@clickhouse/client";
import * as dotenv from "dotenv";

dotenv.config();

async function migrate() {
  const url = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
  const username = process.env.CLICKHOUSE_USER ?? "default";
  const password = process.env.CLICKHOUSE_PASSWORD ?? "";

  const client = createClient({
    url,
    username,
    password,
    session_id: "migration_session",
    clickhouse_settings: {
      allow_experimental_object_type: 1,
    },
  });

  try {
    const migrationsDir = resolve(process.cwd(), "clickhouse/migrations");
    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort(); // Ensure migrations run in order

    console.log(`Found ${migrationFiles.length} migration file(s)`);

    for (const file of migrationFiles) {
      console.log(`Running migration: ${file}`);
      const migrationPath = join(migrationsDir, file);
      const sql = readFileSync(migrationPath, "utf8");
      const statements = sql
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean);

      for (const statement of statements) {
        await client.command({ query: statement });
      }

      console.log(`${file} completed`);
    }

    console.log("\nAll migrations applied successfully.");
  } finally {
    await client.close();
  }
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
