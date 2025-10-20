import { ClickHouse } from "clickhouse";
import { runtimeConfig } from "../config/index.js";

const client = new ClickHouse({
  url: runtimeConfig.clickhouseUrl,
  format: "json",
  config: {
    session_id: "liquidity_guard_session",
  },
});

export const insertMetric = async (row: Record<string, unknown>) => {
  const sql = "INSERT INTO lg.pool_metrics FORMAT JSONEachRow";
  await client.insert(sql, row).toPromise();
};

export const query = async (sql: string): Promise<unknown[]> => {
  return client.query(sql).toPromise();
};
