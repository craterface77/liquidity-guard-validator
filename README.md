# liquidity-guard

🛡️**LiquidityGuard** is a next‑generation DeFi insurance layer designed to protect users, protocols, and institutional capital from _unintended capital loss_ caused by liquidity crises, oracle glitches, and short‑term depeg events.

## **🚨 The Problem**

DeFi has matured — yields are real, TVL is massive, and stablecoins dominate the ecosystem. Yet the biggest risks are no longer smart‑contract bugs; they are **systemic and invisible**

- Liquidity pools drain within minutes, trapping capital (as with Falcon USDf)
- Oracles misreport, causing unfair liquidations
- Stablecoins briefly lose peg but recover — yet users are liquidated or suffer impermanent loss before that
  Existing insurance protocols (Nexus Mutual, InsurAce, Sherlock) cover **hacks and code exploits**, not **economic anomalies**. In 2025, liquidity and oracle faults have become the new black swans.

## **👤 Who It’s For**

|**DeFi Yield Farmers**|Want to farm stable yields safely without sudden lockups|Coverage auto‑pays if exit cost > threshold|

|**Institutions & DAOs**|Allocate 6–8‑figure positions into DeFi pools|Capital protection & audit‑grade transparency|

|**DeFi Protocols (Aave, Pendle, Curve)**|Want user confidence & stickier TVL|Integrate LiquidityGuard as “opt‑in protection” button|

|**Stablecoin Issuers**|Need market‑trust layer|Co‑sponsor insurance pool to prove resilience|

|**AA Wallet Users**|Expect plug‑and‑play safety|Add protection via hook or paymaster automatically|

## **⚙️ Core Design Pillars**

1. **Parametric Coverage** — triggers based on objective on‑chain data, not governance votes.
2. **Instant Payouts** — deterministic, verifiable, and bounded.
3. **Liquidity‑Aware Models** — coverage driven by real pool metrics (reserves, depth, swap quotes).
4. **Composability** — EVM contracts + off‑chain attestation infra.
5. **Transparency** — full data traceability; open Grafana dashboards.

## **💡 Strategic Goal**

LiquidityGuard aims to:

- Reduce DeFi’s systemic fragility.
- Enable institutional on‑chain participation with verifiable protection.
- Create a standardized data layer for liquidity risk pricing.

## **🎯 Objectives & Success Criteria (MVP)**

- **Demonstrate automatic parametric payout** on a reproduced USDf event (mainnet‑fork) for a Curve pool.
- **Ship a minimal partner‑ready stack**: on‑chain contracts + off‑chain Risk Engine + Attestation + Keeper + Dashboard.
- **Provide a plug‑and‑play integration path** for Curve (widget + SDK + API + PartnerRegistry contract).
- **Time‑box:** 2–3 weeks focused build (solo dev feasible).

## **🧱 Architecture (PoC/MVP)**

```
User / Protocol UI ─┐             ┌─ Grafana Dashboards
Curve / dApp Widget ├─ SDK/API ───┤
                    │             └─ Alerts (PagerDuty/Telegram)
                    ▼
             CoverageManager (Solidity)
               ├─ PolicyNFT (ERC‑721)
               ├─ InsurancePool (USDC vault)
               └─ PartnerRegistry (Curve pool listing, budgets)
                    ▲
                    │ EIP‑712 Attestation
                    ▼
             AttestationVerifier (on‑chain)
                    ▲
                    │ signed payloads
                    ▼
        Risk Engine + Indexer (TS/Node + ClickHouse)
          ├─ Curve reserves, UniV3 TWAP, swap simulation
          ├─ Severity S, thresholds + grace window
          └─ Keeper (Gelato/Defender/cron) → `settle()`
```

## **🧰 Tech Stack**

- **Solidity & Tests:** Foundry (forge/anvil), OpenZeppelin, Viem (scripts)
- **Node/TS:** viem, ethers, clickhouse, zod, fastify.
- **Data:** ClickHouse, Docker Compose, optional Redis for queues.
- **Dashboards:** Grafana (Docker), alerting to PagerDuty/Telegram.
- **Infra:** Chainstack/Alchemy RPC; Defender/Gelato for keepers.
- **Keys:** multisig (Safe) for attestor in MVP; rotateable EOA for PoC.

## Development Setup

1. Update `src/config/constants.ts` with the Curve pool metadata. If your RPC cannot read immutable coin arrays on Curve NG pools, list both coin addresses in `CURVE_POOL.coinAddresses`.
2. Copy `.env.example` to `.env` and set at least `RPC_URL` (archive-capable). Optional variables:
   - `SIGNER_PRIVATE_KEY` when you need to sign claim attestations.
   - `FORK_BLOCK` to pin the fork-test script to a historical block.
3. Install dependencies: `npm install`
4. Build the project (optional in dev mode): `npm run build`
5. Local scripts (run in separate terminals):
   - `npm run dev:indexer` — Curve poller (must be running for any downstream services).
   - `npm run dev:api` — `/health` endpoint that reads the latest sample produced by the indexer.
   - `npm run dev:fork-test` — replay detector logic against a forked block range.
     Start the indexer first so it creates `data/<pool>.ndjson`, then the API.
6. Run `docker compose up clickhouse grafana` if you only need the data stack without the validator services.

## Docker Compose Stack

1. Fill `.env` with at least `RPC_URL` and optional overrides such as `PORT` / `POLL_INTERVAL_MS`.
2. Build and launch the full stack (indexer + API + data services):

   ```bash
   docker compose up --build
   ```

3. Services:
   - `validator-indexer` uses the compiled build to stream samples into the shared `validator-data` volume.
   - `validator-api` serves `/health` on `${PORT:-3000}` using the same volume (depends on the indexer).
   - `clickhouse` + `grafana` provide optional storage/visualisation, sharing data via the volume mount.
4. Stop everything with `docker compose down`. To rebuild after code changes, rerun `docker compose up --build`.
