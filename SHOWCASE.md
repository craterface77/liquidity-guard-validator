# 🎯 LiquidityGuard Validator Showcase

Complete guide to demonstrating the Curve USDC/USDf depeg detection system.

---

## 🚀 Quick Start

### 1. Start the System

```bash
# Build and start all services
docker compose up --build

# Wait for migration to complete and services to start
# You should see logs from:
# - clickhouse (database)
# - migrate (schema setup)
# - validator-api (REST API)
# - validator-indexer (live monitoring)
```

### 2. Verify Health

```bash
curl http://localhost:3002/health | jq
```

Expected response:
```json
{
  "status": "healthy",
  "latestSample": {
    "timestamp": "2025-...",
    "block": 21234567,
    "rBps": 4500,
    "price": 0.998
  },
  "activeEvents": [],
  "statistics": {
    "totalSamples": 42
  }
}
```

### 3. Run Showcase Demo

```bash
npm run showcase
```

This will:
- ✅ Check system health
- 📊 Display pool metrics
- 🔍 Show detected risks
- 💰 Demonstrate payout calculation

---

## 📖 Core Concepts

### Depeg Detection

The system monitors the **reserve ratio** (`r_bps`) of the Curve USDC/USDf pool:

```
r_bps = (reserve_base / (reserve_base + reserve_quote)) * 10000
```

**Example:**
- Pool has **1M USDC** and **11M USDf**
- `r_bps = 1M / (1M + 11M) * 10000 = 833`
- **8.33% USDC** vs **91.67% USDf** → **DEPEG DETECTED** ⚠️

### Thresholds (from .env)

```bash
R_MIN_BPS=3300              # 33% = 2:1 ratio (depeg threshold)
GRACE_PERIOD_SECONDS=900    # 15 minutes (sustained breach required)
```

**Interpretation:**
- If USDC drops below 33% of total reserves for 15+ minutes → **Depeg Start**
- When USDC recovers above 33% → **Depeg End**

---

## 🔬 Simulation Mode

### Historical Analysis

Replay past blocks to detect historical depeg events:

```bash
# Example: Analyze July 8, 2025 depeg (if it happened)
npm run simulate -- \
  --from=20295000 \
  --to=20295500 \
  --step=50
```

**Parameters:**
- `--from`: Starting block number
- `--to`: Ending block number
- `--step`: Block increment (50 = ~10 min on Ethereum)

**What it does:**
1. Fetches reserves from each block
2. Calculates `r_bps`, price, loss estimates
3. Runs depeg detector logic
4. Stores samples & risk events to ClickHouse
5. Creates IPFS snapshots at depeg start/end

**Output:**
```
✅ simulation_started fromBlock=20295000 toBlock=20295500 totalBlocks=500
⚠️  depeg_detected riskId=curve-usdc-usdf|1720425600 block=20295100 rBps=2800
✅ depeg_resolved riskId=curve-usdc-usdf|1720425600 block=20295400 duration=3600
✅ simulation_completed processed=10 detectedRisks=1
```

---

## 📊 API Endpoints

### 1. Health Check

```bash
GET /health
```

Returns system status, latest sample, and active depeg events.

### 2. List Risks

```bash
GET /validator/api/v1/risk?limit=25&cursor=<base64>
```

Returns paginated list of detected risks with:
- Risk ID and state (OPEN/RESOLVED)
- Time window (start/end)
- TWAP metrics
- Liquidity levels

**Example:**
```bash
curl http://localhost:3002/validator/api/v1/risk | jq
```

### 3. Risk Detail

```bash
GET /validator/api/v1/risk/:riskId
```

Returns detailed telemetry for a specific risk:
- Full sample timeline (block-by-block)
- IPFS snapshots (start/end)
- Attestations
- Metrics summary

### 4. Pool Metrics

```bash
GET /validator/api/v1/metrics?limit=1000&from=<unix>&to=<unix>
```

Returns time-series data for graphing:
- Reserve ratios
- Price evolution
- Loss estimates
- TWAP values

**Example:**
```bash
# Last 1000 samples
curl http://localhost:3002/validator/api/v1/metrics?limit=1000 | jq
```

### 5. Chart Data

```bash
GET /validator/api/v1/metrics/chart?limit=1000
```

Returns formatted data ready for charting libraries (Chart.js, D3, etc.):
```json
{
  "thresholds": {
    "rMinBps": 3300
  },
  "data": {
    "timestamps": ["2025-...", "2025-..."],
    "rBps": [4500, 4400, 3100, 2800, ...],
    "lossQuoteBps": [50, 100, 500, 1200, ...],
    "price": [0.998, 0.995, 0.97, 0.92, ...]
  }
}
```

### 6. Claim Preview

```bash
POST /validator/api/v1/claims/preview
Headers: x-lg-signature, x-lg-timestamp
```

Calculates payout for a policy:
- Reads risk metrics from depeg window
- Applies deductible and coverage cap
- Returns Lstar, payout, snapshots

**Example Payload:**
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

### 7. Claim Signing

```bash
POST /validator/api/v1/claims/sign
Headers: x-lg-signature, x-lg-timestamp
```

Same as preview, but also:
- Creates EIP-712 typed data
- Signs with `SIGNER_PRIVATE_KEY`
- Returns signature for on-chain submission
- Stores claim record

---

## 🎨 Visualization Example

### Using the API with Chart.js

```javascript
// Fetch chart data
const response = await fetch('http://localhost:3002/validator/api/v1/metrics/chart?limit=500');
const data = await response.json();

// Plot with Chart.js
new Chart(ctx, {
  type: 'line',
  data: {
    labels: data.data.timestamps,
    datasets: [
      {
        label: 'R Ratio (bps)',
        data: data.data.rBps,
        borderColor: 'rgb(75, 192, 192)',
      },
      {
        label: 'Depeg Threshold',
        data: Array(data.data.rBps.length).fill(data.thresholds.rMinBps),
        borderColor: 'rgb(255, 99, 132)',
        borderDash: [5, 5],
      }
    ]
  }
});
```

---

## 🔍 Troubleshooting

### No samples appearing?

```bash
# Check indexer logs
docker compose logs -f validator-indexer

# Check RPC connectivity
curl -X POST https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Depeg not triggering?

Check threshold:
```bash
# Current ratio must drop below R_MIN_BPS (3300 = 33%)
# For USDf/USDC pool, this means USDC < 33% of total reserves
```

### ClickHouse errors?

```bash
# Reset database
docker compose down -v
docker compose up --build
```

---

## 📝 Example Workflows

### Workflow 1: Live Monitoring

```bash
# Terminal 1: Start services
docker compose up --build

# Terminal 2: Watch logs
docker compose logs -f validator-indexer

# Terminal 3: Monitor health
watch -n 10 'curl -s http://localhost:3002/health | jq ".latestSample"'
```

### Workflow 2: Historical Analysis

```bash
# 1. Start system
docker compose up -d

# 2. Run simulation (2 hours of blocks)
npm run simulate -- --from=20000000 --to=20000600 --step=50

# 3. View results
curl http://localhost:3002/validator/api/v1/risk | jq

# 4. Get detailed risk
curl http://localhost:3002/validator/api/v1/risk/<RISK_ID> | jq
```

### Workflow 3: Integration Testing

```bash
# 1. Start system
docker compose up -d

# 2. Wait for samples
sleep 120

# 3. Get latest sample
LATEST=$(curl -s http://localhost:3002/health | jq -r '.latestSample.block')

# 4. Check metrics
curl -s "http://localhost:3002/validator/api/v1/metrics?limit=10" | jq '.samples[0]'
```

---

## 🎓 Understanding the Output

### Sample Data

```json
{
  "timestamp": "2025-10-22T10:30:00.000Z",
  "block": 21234567,
  "reserves": {
    "base": 12500000,    // USDf
    "quote": 8500000,    // USDC
    "totalSupply": 20900000
  },
  "price": 0.68,         // USDC per USDf (⚠️ severe depeg!)
  "rBps": 4047,          // 40.47% USDC ratio
  "lossQuoteBps": 3200,  // 32% loss if swapping
  "twapBps": 9850        // 98.5% TWAP (30-min average)
}
```

**Interpretation:**
- `rBps = 4047` → 40.47% USDC, 59.53% USDf (✅ above 33% threshold)
- `lossQuoteBps = 3200` → Swapping 500K USDf would lose 32%
- `price = 0.68` → 1 USDf = 0.68 USDC (severe depeg from 1.0)

---

## 🚀 Production Checklist

- [ ] Configure real `SIGNER_PRIVATE_KEY` (not test key)
- [ ] Set `VALIDATOR_API_SECRET` for HMAC auth
- [ ] Configure `WEBHOOK_BASE_URL` to backend
- [ ] Set up monitoring (Grafana + Prometheus)
- [ ] Configure alerts (PagerDuty, email, etc.)
- [ ] Backup ClickHouse data (`./clickhouse-data`)
- [ ] Use archive RPC node (for historical queries)
- [ ] Rate limit RPC calls to avoid provider bans
- [ ] Set up IPFS pinning service (Pinata, Web3.Storage)
- [ ] Test disaster recovery procedures

---

## 📚 Further Reading

- [VALIDATOR_API.md](./VALIDATOR_API.md) - Full API specification
- [README.md](./README.md) - Architecture overview
- [payout_general_idea.md](./payout_general_idea.md) - Payout mechanics
- [Curve Finance Docs](https://docs.curve.fi/) - Pool mechanics
- [ClickHouse Docs](https://clickhouse.com/docs) - Database reference

---

## 🤝 Support

Questions? Issues?
1. Check logs: `docker compose logs validator-api validator-indexer`
2. Verify .env configuration
3. Test RPC connectivity
4. Check ClickHouse: `curl http://localhost:8123/ping`

Happy monitoring! 🛡️
