import { ClickHouse } from "clickhouse";
import { CH_HOST } from "./config";

const clickhouse = new ClickHouse({
  url: CH_HOST,
  format: "json",
  config: {
    session_id: "lg_session"
  }
});

export async function insertMetric(row: any) {
  const sql = `INSERT INTO lg.pool_metrics FORMAT JSONEachRow`;
  await clickhouse.query(sql).toPromise({data: JSON.stringify(row)});
}

export async function query(sql: string) {
  return clickhouse.query(sql).toPromise();
}
