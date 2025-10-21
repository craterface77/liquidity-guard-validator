-- 1) risk_samples (merge tree)
CREATE TABLE IF NOT EXISTS risk_samples
(
  poolId String,
  chainId UInt64,
  ts DateTime64(3),
  blockNumber UInt64,
  r_bps UInt32,
  lossQuoteBps UInt32,
  twap30mBps UInt32,
  extra JSON DEFAULT '{}'
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (poolId, ts, blockNumber);

-- 2) risks
CREATE TABLE IF NOT EXISTS risks
(
  riskId String,
  poolId String,
  chainId UInt64,
  type String,
  state String,
  window_start DateTime64(3),
  window_end DateTime64(3),
  firstSeenBlock UInt64,
  lastUpdatedAt DateTime64(3),
  meta JSON DEFAULT '{}'
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(window_start)
ORDER BY (riskId, poolId, window_start);

-- 3) snapshots
CREATE TABLE IF NOT EXISTS snapshots
(
  id String,
  poolId String,
  cid String,
  ts DateTime64(3),
  blockNumber UInt64,
  meta JSON DEFAULT '{}'
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (id, poolId, ts);

-- 4) attestations
CREATE TABLE IF NOT EXISTS attestations
(
  attId String,
  riskId String,
  signer String,
  signature String,
  payload JSON,
  submittedAt DateTime64(3),
  onchainTx String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(submittedAt)
ORDER BY (attId, riskId, submittedAt);

-- 5) webhook_events
CREATE TABLE IF NOT EXISTS webhook_events
(
  eventId String,
  kind String,
  payload JSON,
  idempotencyKey String,
  targetUrl String,
  status String,
  httpStatus UInt32,
  responseText String,
  triedAt DateTime64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(triedAt)
ORDER BY (eventId, triedAt);

-- 6) claims
CREATE TABLE IF NOT EXISTS claims
(
  claimId String,
  policyId String,
  wallet String,
  previewPayload JSON,
  signedPayload JSON,
  payoutAmount UInt64,
  deductibleBps UInt32,
  coverageCap UInt64,
  state String,
  createdAt DateTime64(3),
  signedAt DateTime64(3),
  processedAt DateTime64(3)
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(createdAt)
ORDER BY (claimId, policyId, createdAt);

-- 7) policies
CREATE TABLE IF NOT EXISTS policies
(
  policyId String,
  wallet String,
  poolId String,
  startAt DateTime64(3),
  activeAt DateTime64(3),
  endAt DateTime64(3),
  coverage UInt64,
  dedBps UInt32,
  kBps UInt32,
  createdAt DateTime64(3),
  metadata JSON
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(createdAt)
ORDER BY (policyId, wallet, createdAt);
