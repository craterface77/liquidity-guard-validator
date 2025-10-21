CREATE DATABASE IF NOT EXISTS liquidityguard

CREATE TABLE IF NOT EXISTS liquidityguard.pool_samples
(
    ts                DateTime64(3),
    pool_id           String,
    chain_id          UInt64,
    reserve_usdc      UInt64,
    reserve_partner   UInt64,
    total_lp_supply   UInt128,
    twap_bps          UInt32,
    loss_quote_bps    UInt32,
    r_bps             UInt32,
    sample_source     String,
    tags              Array(String)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (pool_id, ts)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS liquidityguard.risk_events
(
    risk_id         String,
    pool_id         String,
    chain_id        UInt64,
    window_start    DateTime64(3),
    window_end      DateTime64(3),
    risk_state      String,
    severity_bps    UInt32,
    twap_bps        UInt32,
    r_bps           UInt32,
    attested_at     DateTime64(3),
    attestor        String,
    snapshot_cid    String,
    meta            String
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(window_start)
ORDER BY (pool_id, window_start)
SETTINGS index_granularity = 8192
