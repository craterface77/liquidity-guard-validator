import "dotenv/config";

export const PLACEHOLDER_PREFIX = "<SET_";
export const PLACEHOLDER_SUFFIX = ">";

const makePlaceholder = (name: string) =>
  `${PLACEHOLDER_PREFIX}${name.toUpperCase()}${PLACEHOLDER_SUFFIX}`;

const readString = (name: string, fallback?: string) => {
  const value = process.env[name];
  if (value && value.trim().length > 0) return value.trim();
  if (fallback !== undefined) return fallback;
  return makePlaceholder(name);
};

const readNumber = (name: string, fallback: number) => {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const envConfig = {
  rpcUrl: readString("RPC_URL"),
  httpPort: readNumber("PORT", 3000),
  pollIntervalMs: readNumber("POLL_INTERVAL_MS", 10_000),
  clickhouseUrl: readString("CLICKHOUSE_HTTP_URL", "http://localhost:8123"),
  signerPrivateKey: process.env.SIGNER_PRIVATE_KEY?.trim() ?? null,
  forkBlock: (() => {
    const value = process.env.FORK_BLOCK;
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  })(),
};

export const unresolvedConfigKeys = Object.entries(envConfig)
  .filter(
    ([, value]) =>
      typeof value === "string" && value.startsWith(PLACEHOLDER_PREFIX)
  )
  .map(([key]) => key as keyof typeof envConfig);
