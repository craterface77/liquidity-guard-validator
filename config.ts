import dotenv from "dotenv";
dotenv.config();

export const RPC = process.env.RPC_URL || "";
export const POOL_ADDRESS = (process.env.POOL_ADDRESS || "").toLowerCase();
export const CH_HOST = process.env.CH_HOST || "http://localhost:8123";
export const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 10000);
export const Q_BASE = process.env.Q_BASE || "100000000000000000000000";
export const R_MIN = Number(process.env.R_MIN || 0.25);
export const L_MAX = Number(process.env.L_MAX || 0.005);
export const GRACE_WINDOW_S = Number(process.env.GRACE_WINDOW_S || 600);
