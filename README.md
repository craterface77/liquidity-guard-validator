# LiquidityGuard Validator

DeFi insurance validator that monitors protocols in real-time and signs payouts for depeg and liquidation protection.

## What it does

This service watches Curve pools and Aave lending markets. When things go wrong (stablecoins depeg, users get liquidated), it detects the event, calculates losses, and provides cryptographic proof for insurance claims.

Two products are supported:

- **DEPEG_LP** - Protects liquidity providers when Curve pools depeg
- **AAVE_DLP** - Protects borrowers from liquidations caused by PYUSD depeg

## How it works

### Curve Pool Protection

The system polls Curve pools every minute and calculates the reserve ratio. When USDC drops below 33% of total reserves for more than 15 minutes, a depeg window opens. It captures the pool state, uploads it to IPFS, and tracks the severity until conditions normalize.

For payout calculations, it uses TWAP (time-weighted average price) over the depeg period to determine how much the LP position lost value. Deductibles and coverage caps are applied according to the policy terms.

### Aave Liquidation Protection

For PYUSD borrowers on Aave, the validator monitors Chainlink price feeds. If PYUSD depegs by more than 2%, it starts watching for liquidation events. When a user gets liquidated within an hour of the depeg, the system correlates the two events and emits a DEPEG_LIQ webhook with proof.

Pyth Network serves as a backup oracle. If Chainlink fails, Pyth automatically takes over with 400ms latency data from its Hermes API.

## Getting started

Prerequisites:

- Docker and Docker Compose
- Node.js 20 or higher
- Ethereum RPC endpoint (Alchemy works well)

Setup:

```bash
# Copy config
cp .env.example .env

# Add your RPC URL to .env
# RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY

# Start everything
docker compose up --build
```

Wait for the services to initialize. ClickHouse needs to start, migrations run, then the API and indexer launch. Check health:

```bash
curl http://localhost:3002/health | jq
```

After a minute or two, the indexer will have fetched some samples and you'll see pool metrics.

## Configuration

Pool monitoring is configured via environment variables. The default setup watches the Curve USDC/USDf pool at `0x72310daaed61321b02b08a547150c07522c6a976`.

Key thresholds:

- `R_MIN_BPS=3300` - Depeg triggers when USDC < 33% of reserves
- `GRACE_PERIOD_SECONDS=900` - Must be sustained for 15 minutes
- `POLL_INTERVAL_MS=60000` - Check every 60 seconds

For Aave monitoring:

```bash
ENABLE_AAVE_MONITORING=true
AAVE_LENDING_POOL_ADDRESS=0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2
AAVE_COLLATERAL_ASSET=0x6c3ea9036406852006290770BEdFcAbA0e23A0e8
AAVE_PRICE_FEED=0x8f1dF6D7F2db73eECE86a18b4381F4707b918FB1
AAVE_DEPEG_THRESHOLD=0.02
```

Pyth Network fallback is enabled by default. Set `ENABLE_PYTH_FALLBACK=true` and provide `PYTH_PRICE_FEED_ID` for the asset.

## API Reference

### Health Check

`GET /health`

Returns system status, latest sample, and active depeg events.

### List Risks

`GET /validator/api/v1/risk?limit=25&cursor=<base64>`

Paginated list of detected risks with state, time windows, TWAP metrics, and liquidity levels.

### Risk Details

`GET /validator/api/v1/risk/:riskId`

Full telemetry for a specific risk including block-by-block samples, IPFS snapshots, and attestations.

### Metrics

`GET /validator/api/v1/metrics?limit=1000&from=<unix>&to=<unix>`

Time-series data for graphing reserve ratios, prices, loss estimates, and TWAP values.

### Chart Data

`GET /validator/api/v1/metrics/chart?limit=1000`

Pre-formatted data ready for Chart.js or similar libraries, includes thresholds.

### Claim Preview

`POST /validator/api/v1/claims/preview`

Calculate payout for a policy without signing. Requires HMAC authentication with `x-lg-signature` and `x-lg-timestamp` headers when `VALIDATOR_API_SECRET` is set.

Request body:

```json
{
  "policy": {
    "policyId": "1",
    "product": "DEPEG_LP",
    "riskId": "curve-usdc-usdf|1720425600",
    "owner": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "insuredAmount": "1000000000000000000000000",
    "coverageCap": "800000000000000000000000",
    "deductibleBps": 500,
    "kBps": 5000,
    "startAt": 1720339200,
    "activeAt": 1720425600,
    "endAt": 1720512000,
    "claimedUpTo": 0,
    "metadata": { "poolId": "curve-usdc-usdf" }
  },
  "claimMode": "PREVIEW"
}
```

### Claim Signing

`POST /validator/api/v1/claims/sign`

Same as preview but returns EIP-712 typed data and signature for on-chain submission. Stores the claim record with a nonce for replay protection.

## Webhooks

If `WEBHOOK_BASE_URL` is configured, the validator sends signed JSON payloads to the backend:

- `DEPEG_START` / `DEPEG_END` → `/internal/validator/anchors`
- `DEPEG_LIQ` → `/internal/validator/liquidations`

HMAC-SHA256 signatures are included in `x-lg-signature` headers when `WEBHOOK_SECRET` is set.

## Historical Analysis

To backtest on past blocks:

```bash
npm run simulate -- --from=21200000 --to=21200500 --step=50
```

This fetches historical reserves, runs the depeg detector, creates IPFS snapshots, and stores everything to ClickHouse with a 'simulation' tag.

## Data Storage

ClickHouse stores all time-series data:

- `pool_samples` - Reserve ratios, prices, TWAP, block numbers
- `risk_events` - Depeg windows with versioning
- `snapshots` - IPFS CID references
- `attestations` - Validator signatures
- `claims` - Payout calculations and EIP-712 messages
- `liquidations` - Aave liquidation events with health factors
- `claim_nonces` - Replay protection

The database grows about 1MB per day with 60-second polling.

## Event Indexing

An Envio HyperIndex instance provides real-time event indexing for the frontend. It watches smart contracts, stores events in PostgreSQL, and exposes a GraphQL API with sub-second latency.

Configuration is in `envio-indexer/config.yaml`, schema in `schema.graphql`, and handlers in `src/handlers/`.

## Security Notes

Before production:

1. Change `SIGNER_PRIVATE_KEY` - the example key is public and only for testing
2. Set `VALIDATOR_API_SECRET` to enforce HMAC auth on claim endpoints
3. Configure `WEBHOOK_SECRET` for backend communication
4. Use environment variables, not the .env file
5. Enable SSL/TLS for the API
6. Set up monitoring and alerts
7. Backup the ClickHouse data directory
8. Test disaster recovery procedures

## Payout Mechanics

Payouts are calculated using the maximum loss observed during the depeg window:

```
severity = max(lossQuoteBps - deductibleBps, 0)
payout = (coverageCap × kBps × severity) / 100,000,000
payout = min(payout, coverageCap)
```

For Aave liquidations, the loss is based on the collateral value drop caused by the depeg. If a user had 10,000 PYUSD worth $10,000 and PYUSD depegs to $0.90, their collateral is now worth $9,000. With an 80% coverage ratio and 2% deductible on an 10% loss, the payout would be $640.

Deductibles filter out small fluctuations. Coverage caps limit maximum liability. The coverage ratio (kBps) determines what percentage of the loss is covered.

## Testing

```bash
npm test
```

Tests run with mocked ClickHouse and assert route behavior. For integration tests, start the system with Docker Compose and hit the API endpoints.

To test Pyth fallback, temporarily set an invalid Chainlink address and check the logs for `price_fetched_from_pyth_fallback`.

## Project Structure

```
liquidity-guard/
├─ clickhouse/
│  └─ migrations/           # SQL schema
├─ envio-indexer/           # Event indexing with GraphQL
│  ├─ config.yaml
│  ├─ schema.graphql
│  └─ src/handlers/
├─ scripts/                 # CLI tools (migrate, seed, simulate, showcase)
├─ src/
│  ├─ app.ts                # Fastify factory
│  ├─ server.ts             # API entry
│  ├─ config/env.ts         # Environment config
│  ├─ db/clickhouse.ts      # Database helpers
│  ├─ routes/               # API endpoints
│  ├─ services/
│  │  ├─ indexer/           # Curve and Aave monitoring
│  │  ├─ oracles/           # Chainlink and Pyth price feeds
│  │  ├─ claimService.ts    # EIP-712 signing
│  │  ├─ riskService.ts     # Risk state management
│  │  └─ webhookService.ts  # Backend notifications
│  ├─ workers/
│  │  └─ indexer.ts         # Main monitoring loop
│  └─ lib/                  # Utilities (IPFS, retry, signing, time)
└─ tests/                   # Jest integration tests
```

## Showcase Demo

```bash
npm run showcase
```

Displays system health, pool metrics, detected risks, and demonstrates payout calculations. Useful for demos and presentations.

## Technology Demo

To demonstrate Envio HyperIndex and Pyth Network integration:

```bash
npm run demo
```

## Troubleshooting

**No samples appearing?**
Check the indexer logs: `docker compose logs -f validator-indexer`
Verify RPC connectivity and rate limits.

**Depeg not triggering?**
The current ratio must drop below R_MIN_BPS (3300 = 33%) and stay there for the grace period.

**ClickHouse errors?**
Reset the database: `docker compose down -v && docker compose up --build`

**RPC rate limiting?**
Increase `POLL_INTERVAL_MS` or upgrade to a paid RPC tier.

## Oracle Integration

The validator uses Chainlink as the primary price oracle with Pyth Network as an automatic fallback. When Chainlink fails to return a price, Pyth's Hermes API is queried with 400ms latency.

Pyth supports 100+ chains with the same price feed ID. No gas is required for off-chain queries. Price freshness is checked (60 second maximum age) and confidence intervals are validated.

For on-chain price updates, Pyth uses a pull model where update data is fetched off-chain and submitted with transactions. The validator currently uses off-chain prices only.

## Deployment

Use Docker Compose for production:

```bash
docker compose up -d
```

Services:

- `clickhouse` - Data storage
- `migrate` - Runs schema migrations
- `validator-api` - REST API on port 3002
- `validator-indexer` - Background monitoring

Volumes:

- `./clickhouse-data` - Persistent storage

## Contributing

Run the build before committing:

```bash
npm run build
npm test
```

The project uses TypeScript with strict mode and Prettier for formatting.

## License

Proprietary
