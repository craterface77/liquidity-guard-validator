import * as dotenv from "dotenv";
import { z } from "zod";
import * as path from "path";

// Load .env from project root, even in production
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().min(1).default(3000),
  HOST: z.string().min(1).default("0.0.0.0"),
  CORS_ORIGIN: z.string().default("*"),
  RATE_LIMIT_MAX: z.coerce.number().min(1).default(300),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),

  CLICKHOUSE_URL: z.string().url().default("http://localhost:8123"),
  CLICKHOUSE_USER: z.string().min(1).default("default"),
  CLICKHOUSE_PASSWORD: z.string().default(""),

  RPC_URL: z.string().min(1, "RPC_URL is required"),
  CHAIN_ID: z.coerce.number().min(1).default(1),
  POOL_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "POOL_ADDRESS must be a valid 0x address"),
  POOL_ID: z.string().default("curve:pool"),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  SAMPLE_SOURCE: z.string().default("validator-indexer"),

  Q_BASE_AMOUNT: z.string().default("100000000"), // 100k units with 6 decimals
  BASE_TOKEN_DECIMALS: z.coerce.number().int().min(0).max(18).default(6),
  QUOTE_TOKEN_DECIMALS: z.coerce.number().int().min(0).max(18).default(6),

  R_MIN_BPS: z.coerce.number().int().min(0).max(10_000).default(9_500),
  GRACE_PERIOD_SECONDS: z.coerce.number().int().min(0).default(60),

  SIGNER_PRIVATE_KEY: z.string().optional(),
  PAYOUT_VERIFIER_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "PAYOUT_VERIFIER_ADDRESS must be 0x address")
    .optional(),

  VALIDATOR_API_SECRET: z.string().optional(),

  WEBHOOK_BASE_URL: z.string().url().or(z.literal("")).optional(),
  WEBHOOK_SECRET: z.string().optional(),

  IPFS_API_TOKEN: z.string().or(z.literal("")).optional(),

  DATA_DIR: z.string().default("data"),

  // Aave DLP configuration (optional)
  AAVE_LENDING_POOL_ADDRESS: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{40}$/,
      "AAVE_LENDING_POOL_ADDRESS must be 0x address"
    )
    .optional(),
  AAVE_COLLATERAL_ASSET: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "AAVE_COLLATERAL_ASSET must be 0x address")
    .optional(),
  AAVE_PRICE_FEED: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "AAVE_PRICE_FEED must be 0x address")
    .optional(),
  AAVE_DEPEG_THRESHOLD: z.coerce.number().min(0).max(1).default(0.02), // 2%
  AAVE_POOL_ID: z.string().default("aave-pyusd"),
  ENABLE_AAVE_MONITORING: z
    .string()
    .transform((val) => val === "true")
    .pipe(z.boolean())
    .default("false"),

  // Pyth Network configuration (optional - used as fallback oracle)
  PYTH_PRICE_FEED_ID: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{64}$/,
      "PYTH_PRICE_FEED_ID must be 0x followed by 64 hex chars"
    )
    .optional(),
  ENABLE_PYTH_FALLBACK: z
    .string()
    .transform((val) => val === "true")
    .pipe(z.boolean())
    .default("true"), // Enabled by default for redundancy
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
