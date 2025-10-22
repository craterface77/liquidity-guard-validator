# LiquidityGuard Validator

Node.js implementation of the LiquidityGuard off-chain validator for **Curve USDC/USDf pool**. The service monitors pool reserves in real-time, detects depeg events, stores telemetry in ClickHouse, and exposes REST API with EIP-712 signing for payout claims.

## 🚀 Quick Links

- **[QUICKSTART.md](./QUICKSTART.md)** - Get running in 5 minutes
- **[SHOWCASE.md](./SHOWCASE.md)** - Complete demo guide with visualization
- **[VALIDATOR_API.md](./VALIDATOR_API.md)** - Full API specification
- **[payout_general_idea.md](./payout_general_idea.md)** - Payout mechanics

## 🎯 What This Does

Monitors the Curve USDC/USDf pool (0x72310daaed61321b02b08a547150c07522c6a976) and:

1. ✅ **Detects depeg events** when USDC drops below 33% of pool reserves for 15+ minutes
2. 📸 **Creates IPFS snapshots** of pool state at depeg start/end
3. 💰 **Calculates payouts** for insurance policies based on severity
4. 🔐 **Signs EIP-712 messages** for on-chain claim verification
5. 📡 **Sends webhooks** to backend when depeg windows open/close

Based on the methodology from [this article](https://x.com/basedmarkets/status/1873418797033476324).

## Components

- **Fastify API (`src/routes`)** – `/validator/api/v1/risk` list/detail plus `/validator/api/v1/claims/preview|sign` with optional shared-secret auth.
- **Indexer worker (`src/workers/indexer.ts`)** – polls on-chain reserves via ethers, writes `pool_samples`, maintains active risk events, triggers webhooks.
- **ClickHouse storage (`clickhouse/migrations`)** – schema for samples, risk events, snapshots, attestations, claims, and nonce tracking.
- **Claims engine (`src/services/claimService.ts`)** – payout math, typed-data signing (EIP-712), and persistence of signed claims.
- **Webhook emitter (`src/services/webhookService.ts`)** – optional HMAC-signed POSTs to backend endpoints.
- **Tests (`tests/`)** – Jest + Supertest covering risk and claim routes.

## Directory layout

```
├─ clickhouse/                # SQL migrations executed at container start
├─ scripts/                   # CLI helpers (migrate, seed)
├─ src/
│  ├─ app.ts                  # Fastify factory
│  ├─ server.ts               # API entrypoint
│  ├─ config/env.ts           # zod-parsed environment config
│  ├─ db/clickhouse.ts        # ClickHouse helpers
│  ├─ routes/                 # Fastify route plugins
│  ├─ services/               # Risk, claims, indexer, webhook modules
│  ├─ workers/                # Indexer runtime
│  └─ lib/                    # Logger, payout math, signing, time utils
└─ tests/                     # Jest integration tests
```

## Prerequisites

- Node.js 20+
- ClickHouse 23+
- An Ethereum RPC endpoint with archive access for the target Curve pool

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # edit .env with RPC_URL, POOL_ADDRESS, secrets, etc.
   ```

3. **Provision ClickHouse schema**
   ```bash
   npm run migrate
   ```

4. **(Optional) seed demo data**
   ```bash
   npm run seed
   ```

5. **Run locally**
   - API: `npm run dev`
   - Indexer worker: `npm run dev:indexer`

   The indexer should be running before you hit the API so `/validator/api/v1/risk` has data.

6. **Docker Compose**
   ```bash
   docker compose up --build
   ```
   - `clickhouse` stores data under `./clickhouse-data`
   - `migrate` runs migrations once and exits
   - `validator-api` exposes `/validator/api/...` on `${PORT:-3000}`
   - `validator-indexer` streams live samples

   The containers automatically use `CLICKHOUSE_URL=http://clickhouse:8123`, so ensure the `.env` you provide does not override it with `localhost`.

## Testing

```bash
npm test
```

Tests run with mocked ClickHouse interactions and assert route behaviour.

## API summary

- `GET /validator/api/v1/risk` – cursor-paginated risk list matching `VALIDATOR_API.md` (`product`, `state`, `metrics`, `latestWindow`).
- `GET /validator/api/v1/risk/:riskId` – detailed telemetry, snapshots, and attestations for a single risk.
- `POST /validator/api/v1/claims/preview` – calculates payout inputs (`Lstar`, `payout`, `inputs`). Requires HMAC headers when `VALIDATOR_API_SECRET` is set.
- `POST /validator/api/v1/claims/sign` – replays preview, mints a `ClaimPayload` EIP-712 message, signs with `SIGNER_PRIVATE_KEY`, stores claim + nonce, and returns typed data + signature.

## Webhooks

`src/services/webhookService.ts` posts signed JSON bodies to `WEBHOOK_BASE_URL` if configured. Current events:

- `DEPEG_START` / `DEPEG_END` → `/internal/validator/anchors`
- `POOL_STATE` (reserved) → `/internal/validator/pool-state`

`WEBHOOK_SECRET` enables HMAC-SHA256 signing via `x-lg-signature` headers.

## Security notes

- Set `VALIDATOR_API_SECRET` to enforce HMAC auth on claim endpoints.
- Provide a dedicated `SIGNER_PRIVATE_KEY`; the service derives the attestor address for risk events and claim signing.
- Rotate RPC/API secrets via environment variables – nothing sensitive is checked into the repo.

## Further work

- Expand webhook retries / persistence queue.
- Plug in multi-pool support & richer policy metadata.
- Extend tests to exercise full ClickHouse integration.
