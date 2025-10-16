// src/indexer.ts
import { ethers } from "ethers";
import { RPC, POOL_ADDRESS, POLL_INTERVAL_MS, Q_BASE_RAW } from "./config";
import fs from "fs";
import path from "path";

const provider = new ethers.JsonRpcProvider(RPC);

// Minimal ABIs we will use
const POOL_ABI = [
  "function balances(uint256) view returns (uint256)",
  "function coins(uint256) view returns (address)",
  "function totalSupply() view returns (uint256)"
  // don't include get_dy here because we'll try different encodings
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, provider);

// simple storage of last N price samples for TWAP
const SAMPLE_BUFFER: { ts: number; price: number }[] = [];
const MAX_SAMPLES = 180 * 3; // large cap (we will only use last ~180 samples for 30min @10s)

function humanFromRaw(raw: ethers.BigNumberish, decimals: number) {
  // returns Number but careful: if huge values you may lose precision
  const bn = ethers.BigInt(raw);
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = bn / scale;
  const rem = bn % scale;
  const frac = Number(rem) / Number(scale);
  return Number(whole) + frac;
}

// helper: try several get_dy signatures via low-level calls (return human amountOut or null)
async function tryGetDy(i: number, j: number, dxRaw: string, decimalsOut: number) {
  const ifaceCandidates = [
    // common signature (int128,int128,uint256)
    new ethers.Interface(["function get_dy(int128,int128,uint256) view returns (uint256)"]),
    // some pools use int256
    new ethers.Interface(["function get_dy(int256,int256,uint256) view returns (uint256)"]),
    // older variants
    new ethers.Interface(["function get_dy_underlying(int128,int128,uint256) view returns (uint256)"])
  ];

  for (const iface of ifaceCandidates) {
    try {
      const data = iface.encodeFunctionData(iface.fragments[0].name, [i, j, BigInt(dxRaw)]);
      // low level eth_call
      const result = await provider.call({ to: POOL_ADDRESS, data });
      // decode
      const [amountOutRaw] = iface.decodeFunctionResult(iface.fragments[0].name, result);
      return humanFromRaw(amountOutRaw.toString(), decimalsOut);
    } catch (err) {
      // try next
    }
  }
  return null;
}

async function getTokenDecimals(addr: string) {
  try {
    const t = new ethers.Contract(addr, ERC20_ABI, provider);
    const dec = await t.decimals();
    return Number(dec);
  } catch (err) {
    console.warn("Couldn't read decimals for", addr, "assuming 18");
    return 18;
  }
}

async function pollOnce() {
  const blockNumber = await provider.getBlockNumber();
  const block = await provider.getBlock(blockNumber);
  const ts = block.timestamp; // block timestamp

  // read coins (token addresses) and balances (raw)
  const coin0 = await pool.coins(0);
  const coin1 = await pool.coins(1);

  const dec0 = await getTokenDecimals(coin0);
  const dec1 = await getTokenDecimals(coin1);

  const raw0 = await pool.balances(0);
  const raw1 = await pool.balances(1);

  const reserve0 = humanFromRaw(raw0.toString(), dec0);
  const reserve1 = humanFromRaw(raw1.toString(), dec1);

  const rRatio = reserve0 / (reserve0 + reserve1);
  const price = reserve0 / reserve1; // price of token1 in token0 units

  // TWAP handling: keep a buffer of price samples (timestamp + price)
  SAMPLE_BUFFER.push({ ts: Number(ts), price });
  // keep buffer reasonably sized
  while (SAMPLE_BUFFER.length > MAX_SAMPLES) SAMPLE_BUFFER.shift();

  // compute 30-minute TWAP approximation using simple avg of last 30min samples
  const now = Number(ts);
  const min30 = now - 30 * 60;
  const last30 = SAMPLE_BUFFER.filter(s => s.ts >= min30);
  const twap30 = last30.length ? last30.reduce((a,b) => a + b.price, 0) / last30.length : price;

  // simulate a swap: assume we want to swap Q_BASE_RAW of token1 -> token0
  // get human amountOut using tryGetDy; decimalsOut = dec0 (USDC decimals)
  let amountOut = null;
  try {
    amountOut = await tryGetDy(1, 0, Q_BASE_RAW, dec0);
  } catch (err) {
    amountOut = null;
  }
  // compute lossPct vs ideal 1: assume Q_base is denominated in token1 human units:
  // convert Q_BASE_RAW to human for token1
  const qBaseHuman = Number(BigInt(Q_BASE_RAW) / (BigInt(10) ** BigInt(dec1)));
  let lossPct = null;
  if (amountOut !== null) {
    lossPct = (qBaseHuman - amountOut) / qBaseHuman;
  }

  const row = {
    pool: POOL_ADDRESS,
    ts: new Date(Number(ts) * 1000).toISOString(),
    block: blockNumber,
    coin0: coin0,
    coin1: coin1,
    reserve0,
    reserve1,
    rRatio,
    price,
    twap30,
    qBaseHuman,
    amountOut,
    lossPct
  };

  // write to a local file for now (append JSON line) for debugging/demo
  const outPath = path.join(process.cwd(), "data", `${POOL_ADDRESS}.ndjson`);
  fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  fs.appendFileSync(outPath, JSON.stringify(row) + "\n");

  console.log(new Date().toISOString(), "block", blockNumber, "R=", rRatio.toFixed(4), "TWAP30=", twap30.toFixed(6), "lossPct=", lossPct === null ? "n/a" : (lossPct*100).toFixed(4)+"%");

  // optionally: here you would insert into ClickHouse or your DB
}

export async function startPolling() {
  console.log("Starting poller for", POOL_ADDRESS, "every", POLL_INTERVAL_MS, "ms");
  // warm sample so TWAP has some data
  await pollOnce();
  setInterval(async () => {
    try {
      await pollOnce();
    } catch (err) {
      console.error("poll error:", err);
    }
  }, POLL_INTERVAL_MS);
}

// if run directly
if (require.main === module) {
  startPolling().catch(e => {
    console.error("fatal", e);
    process.exit(1);
  });
}
