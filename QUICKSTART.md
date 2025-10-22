# 🚀 QuickStart Guide - LiquidityGuard Validator

Get up and running in 5 minutes!

---

## ✅ Prerequisites

- Docker & Docker Compose
- Node.js 20+ (for local development)
- Ethereum RPC endpoint (Alchemy, Infura, or Chainstack)

---

## 🎯 Step-by-Step Setup

### 1. Configure Environment

```bash
# Copy example config
cp .env.example .env

# Edit .env and set your RPC URL:
# RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Already configured for you:
# - Pool: Curve USDC/USDf (0x72310daaed61321b02b08a547150c07522c6a976)
# - Threshold: 33% (R_MIN_BPS=3300)
# - Grace Period: 15 minutes (900 seconds)
```

### 2. Start Services

```bash
docker compose up --build
```

Wait for:
- ✅ ClickHouse to be healthy
- ✅ Migrations to complete
- ✅ API to start on port 3002
- ✅ Indexer to begin polling

### 3. Verify Health

```bash
# Check system status
curl http://localhost:3002/health | jq

# Expected response:
# {
#   "status": "healthy" or "stale",
#   "latestSample": { ... },
#   "activeEvents": [],
#   "statistics": { ... }
# }
```

### 4. Wait for First Sample

The indexer polls every 60 seconds. After 1-2 minutes, you should see:

```bash
curl http://localhost:3002/validator/api/v1/metrics?limit=1 | jq
```

---

## 🎪 Run Showcase Demo

```bash
# Install dependencies (if not using Docker)
npm install

# Run showcase
npm run showcase
```

This will display:
- ✅ System health
- 📊 Pool metrics
- 🎯 Detected risks
- 💰 Payout calculation demo

---

## 🔬 Run Historical Simulation

Analyze past blocks to find depeg events:

```bash
# Example: Recent 500 blocks (adjust to your needs)
npm run simulate -- --from=21200000 --to=21200500 --step=50

# What it does:
# - Fetches historical pool reserves
# - Runs depeg detector
# - Stores samples in ClickHouse
# - Creates IPFS snapshots
```

**Finding interesting blocks:**
1. Visit [Etherscan](https://etherscan.io/address/0x72310daaed61321b02b08a547150c07522c6a976)
2. Look for large swap transactions
3. Note the block number
4. Simulate around that block ± 500 blocks

---

## 📊 API Endpoints

### Health Check
```bash
GET http://localhost:3002/health
```

### List Risks
```bash
GET http://localhost:3002/validator/api/v1/risk?limit=25
```

### Risk Details
```bash
GET http://localhost:3002/validator/api/v1/risk/:riskId
```

### Pool Metrics (for graphs)
```bash
GET http://localhost:3002/validator/api/v1/metrics?limit=1000
GET http://localhost:3002/validator/api/v1/metrics/chart?limit=1000
```

### Claim Preview (requires HMAC auth)
```bash
POST http://localhost:3002/validator/api/v1/claims/preview
Headers:
  x-lg-signature: <hmac>
  x-lg-timestamp: <unix>
Body: { policy: {...}, claimMode: "PREVIEW" }
```

### Claim Signing (requires HMAC auth)
```bash
POST http://localhost:3002/validator/api/v1/claims/sign
# Same as preview, but returns EIP-712 signature
```

---

## 🐛 Troubleshooting

### No samples appearing?

**Check indexer logs:**
```bash
docker compose logs -f validator-indexer
```

**Common issues:**
- Invalid RPC URL → Check `.env` RPC_URL
- RPC rate limiting → Use paid tier (Alchemy/Infura)
- Wrong pool address → Verify POOL_ADDRESS in `.env`

### ClickHouse connection failed?

```bash
# Check ClickHouse is running
docker compose ps

# Reset database
docker compose down -v
docker compose up --build
```

### API not responding?

```bash
# Check API logs
docker compose logs validator-api

# Verify port
curl http://localhost:3002/
# Should return: {"ok":true}
```

### RPC errors (429 / rate limit)?

Update `.env`:
```bash
# Increase poll interval (default: 60 seconds)
POLL_INTERVAL_MS=120000  # 2 minutes
```

---

## 🎯 Understanding Depeg Detection

### How it works:

1. **Indexer polls** Curve pool every 60 seconds
2. **Calculates r_bps** = USDC / (USDC + USDf) * 10000
3. **If r_bps < 3300** (33%) for 15+ minutes → **Depeg Start**
4. **When r_bps >= 3300** again → **Depeg End**
5. **IPFS snapshots** created at start/end
6. **Webhooks sent** to backend (if configured)

### Example Scenario:

```
Time: 10:00 AM - rBps = 4500 (45%) ✅ NORMAL
Time: 10:15 AM - rBps = 3100 (31%) ⚠️ BREACH (start grace period)
Time: 10:30 AM - rBps = 2800 (28%) 🚨 DEPEG START (grace period expired)
Time: 10:45 AM - rBps = 2500 (25%) 🚨 DEPEG CONTINUES
Time: 11:00 AM - rBps = 3500 (35%) ✅ DEPEG END (recovered)
```

**Result:**
- Depeg window: 10:30 AM → 11:00 AM (30 minutes)
- Severity: Max loss observed during window
- Snapshots: 2 (one at start, one at end)

---

## 📚 Next Steps

1. **Read full showcase:** [SHOWCASE.md](./SHOWCASE.md)
2. **Check API spec:** [VALIDATOR_API.md](./VALIDATOR_API.md)
3. **Understand architecture:** [README.md](./README.md)
4. **Run tests:** `npm test`

---

## 🎬 Demo for Stakeholders

```bash
# 1. Start system
docker compose up -d

# 2. Wait 2 minutes for samples
sleep 120

# 3. Run showcase
npm run showcase

# Shows:
# - ✅ System is healthy and monitoring
# - 📊 Real-time pool metrics
# - 🎯 Any detected depeg events
# - 💰 How payouts would be calculated
```

Perfect for:
- Investor presentations
- Technical demos
- Integration testing
- Proof of concept

---

## 🔐 Security Notes

**⚠️ BEFORE PRODUCTION:**

1. **Change SIGNER_PRIVATE_KEY** in `.env` (current key is for testing only!)
2. **Set VALIDATOR_API_SECRET** for HMAC authentication
3. **Configure WEBHOOK_SECRET** if using backend webhooks
4. **Remove .env from git** (already in .gitignore)
5. **Use environment variables** in production (not .env file)

---

## 💡 Tips & Tricks

### Faster simulation:
```bash
# Use larger step for faster processing
npm run simulate -- --from=X --to=Y --step=200  # ~40 min intervals
```

### Monitor live:
```bash
# Watch indexer detect samples in real-time
docker compose logs -f validator-indexer | grep -E "(depeg|sample)"
```

### Reset everything:
```bash
# Complete fresh start
docker compose down -v
rm -rf clickhouse-data data
docker compose up --build
```

### Export metrics:
```bash
# Get JSON data for analysis
curl http://localhost:3002/validator/api/v1/metrics?limit=10000 > metrics.json
```

---

## ✨ Success Indicators

Your system is working when:

- ✅ Health endpoint shows `"status": "healthy"`
- ✅ New samples appear every 60 seconds
- ✅ Metrics endpoint returns data
- ✅ No errors in `docker compose logs`
- ✅ ClickHouse has data: `SELECT count() FROM liquidityguard.pool_samples`

---

## 🆘 Need Help?

1. Check logs: `docker compose logs --tail=100 validator-api validator-indexer`
2. Verify .env configuration
3. Test RPC: `curl -X POST $RPC_URL -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`
4. Check database: `curl http://localhost:8123/ping`

---

**Ready to go? Let's start!** 🚀

```bash
docker compose up --build
```
