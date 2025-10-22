CREATE DATABASE IF NOT EXISTS liquidityguard;

CREATE TABLE IF NOT EXISTS liquidityguard.pool_samples
(
    pool_id String,
    chain_id UInt32,
    ts DateTime64(3),
    block_number UInt64,
    reserve_base Float64,
    reserve_quote Float64,
    total_lp_supply Float64,
    price Float64,
    r_bps UInt32,
    loss_quote_bps UInt32,
    twap_bps UInt32,
    sample_source LowCardinality(String),
    tags Array(String),
    inserted_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (pool_id, ts, block_number)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS liquidityguard.risk_events
(
    risk_id String,
    pool_id String,
    chain_id UInt32,
    risk_type LowCardinality(String),
    risk_state LowCardinality(String),
    window_start DateTime64(3),
    window_end Nullable(DateTime64(3)),
    severity_bps UInt32,
    twap_bps UInt32,
    r_bps UInt32,
    attested_at DateTime64(3),
    attestor String,
    snapshot_cid String,
    meta JSON,
    version UInt32,
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(window_start)
ORDER BY (risk_id, version)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS liquidityguard.snapshots
(
    snapshot_id String,
    risk_id String,
    pool_id String,
    cid String,
    label String,
    note String,
    uploaded_at DateTime64(3),
    meta JSON
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(uploaded_at)
ORDER BY (risk_id, snapshot_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS liquidityguard.attestations
(
    attestation_id String,
    risk_id String,
    signer String,
    signature String,
    payload JSON,
    submitted_at DateTime64(3),
    onchain_tx String
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(submitted_at)
ORDER BY (risk_id, attestation_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS liquidityguard.claims
(
    claim_id String,
    policy_id String,
    risk_id String,
    mode LowCardinality(String),
    preview JSON,
    signed_payload JSON,
    signature String,
    payout_amount UInt64,
    deductible_bps UInt32,
    coverage_cap UInt64,
    nonce UInt64,
    state LowCardinality(String),
    created_at DateTime DEFAULT now(),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (claim_id)
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS liquidityguard.claim_nonces
(
    policy_id String,
    risk_id String,
    nonce UInt64,
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (policy_id, risk_id)
SETTINGS index_granularity = 8192;
