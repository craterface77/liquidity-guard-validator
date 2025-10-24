-- Migration: Add liquidations table for AAVE_DLP product
-- This table stores liquidation events detected during depeg windows

CREATE TABLE IF NOT EXISTS liquidityguard.liquidations
(
    liquidation_id String,
    risk_id String,
    pool_id String,
    user_address String,
    collateral_asset String,
    debt_asset String,
    liquidated_collateral_amount String,
    debt_covered String,
    liquidator String,
    timestamp UInt64,
    block_number UInt64,
    tx_hash String,
    health_factor_before Nullable(String),
    health_factor_after Nullable(String),
    price_at_liquidation Nullable(Float64),
    deviation_bps Nullable(UInt32),
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(toDateTime(timestamp))
ORDER BY (pool_id, timestamp, liquidation_id)
SETTINGS index_granularity = 8192;

-- Create index for efficient user lookups
CREATE INDEX IF NOT EXISTS idx_user_address ON liquidityguard.liquidations (user_address) TYPE bloom_filter GRANULARITY 1;

-- Create index for efficient risk_id lookups
CREATE INDEX IF NOT EXISTS idx_risk_id ON liquidityguard.liquidations (risk_id) TYPE bloom_filter GRANULARITY 1;
