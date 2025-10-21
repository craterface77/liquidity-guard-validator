## What is included
- `server.ts` — Fastify server and route handlers (GET list + GET detail)
- `package.json` — deps + scripts
- `tsconfig.json` — TypeScript config
- `clickhouse/migrations/001_create_tables.sql` — ClickHouse schema for `pool_samples` and `risk_events`
- `docker-compose.yml` — ClickHouse + API service (dev)
- `scripts/seed_samples.ts` — small script to insert demo samples and a risk_event
- `tests/api.test.ts` — jest + supertest integration tests (connects to ClickHouse)
- `.env.example` — environment var template

## Quick start (dev)
1. Copy files into a new folder.
2. Create a `.env` based on `.env.example` and update `CLICKHOUSE_URL` if needed.
3. Start ClickHouse (via docker-compose):
   ```bash
   docker-compose up -d clickhouse
   ```
4. Run ClickHouse migrations (use clickhouse client or HTTP insert):
   ```bash
   docker exec -it <clickhouse-container> bash
   clickhouse-client --multiquery < /migrations/001_create_tables.sql
   ```
5. Install deps & start the API:
   ```bash
   npm install
   npm run dev
   ```
6. Seed demo data:
   ```bash
   npm run seed
   ```
7. Test endpoints:
   - `GET http://localhost:3000/validator/api/v1/risk`
   - `GET http://localhost:3000/validator/api/v1/risk/<risk_id>`
