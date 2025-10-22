import { JsonRpcProvider, Contract, Interface, formatUnits, parseUnits, type FunctionFragment } from 'ethers';
import { env } from '../../config/env';
import { withRetry } from '../../lib/retry';

const POOL_ABI = [
  'function balances(uint256) view returns (uint256)',
  'function coins(uint256) view returns (address)',
  'function totalSupply() view returns (uint256)',
];

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
];

const GET_DY_SIGNATURES = [
  'function get_dy(int128,int128,uint256) view returns (uint256)',
  'function get_dy(int256,int256,uint256) view returns (uint256)',
  'function get_dy_underlying(int128,int128,uint256) view returns (uint256)',
];

export interface PoolSample {
  ts: Date;
  blockNumber: number;
  reserveBase: number;
  reserveQuote: number;
  totalSupply: number;
  price: number;
  rBps: number;
  lossQuoteBps: number;
  twapBps: number;
}

export class CurveIndexer {
  private provider = new JsonRpcProvider(env.RPC_URL);
  private pool = new Contract(env.POOL_ADDRESS, POOL_ABI, this.provider);
  private sampleBuffer: Array<{ ts: number; price: number }> = [];
  private maxSamples = 180 * 6; // store last 3 hours @ 1min

  async fetchSample(): Promise<PoolSample> {
    const blockNumber = await withRetry(
      () => this.provider.getBlockNumber(),
      {},
      { operation: 'getBlockNumber' },
    );

    const block = await withRetry(
      () => this.provider.getBlock(blockNumber),
      {},
      { operation: 'getBlock', blockNumber },
    );

    if (!block) {
      throw new Error('block_not_found');
    }

    const coinsFn = this.pool.getFunction('coins');
    const balancesFn = this.pool.getFunction('balances');
    const totalSupplyFn = this.pool.getFunction('totalSupply');

    const [coin0, coin1] = await Promise.all([coinsFn(0), coinsFn(1)]);

    const [dec0, dec1] = await Promise.all([
      this.getTokenDecimals(coin0),
      this.getTokenDecimals(coin1),
    ]);

    const [raw0, raw1, totalSupplyRaw] = await Promise.all([
      balancesFn(0),
      balancesFn(1),
      totalSupplyFn(),
    ]);

    const reserve0 = Number(formatUnits(raw0, dec0));
    const reserve1 = Number(formatUnits(raw1, dec1));
    const totalSupply = Number(formatUnits(totalSupplyRaw, dec0));

    // Calculate price using get_dy for accurate pricing
    const price = await this.getExchangeRate(dec0, dec1);
    const rRatio = reserve0 + reserve1 === 0 ? 0 : reserve0 / (reserve0 + reserve1);
    const rBps = Math.round(rRatio * 10_000);

    this.sampleBuffer.push({ ts: block.timestamp, price });
    while (this.sampleBuffer.length > this.maxSamples) {
      this.sampleBuffer.shift();
    }

    const twapBps = this.computeTwap(block.timestamp);
    const lossQuoteBps = await this.estimateLoss(dec0, dec1);

    return {
      ts: new Date(block.timestamp * 1000),
      blockNumber,
      reserveBase: reserve0,
      reserveQuote: reserve1,
      totalSupply,
      price,
      rBps,
      lossQuoteBps,
      twapBps,
    };
  }

  private async getTokenDecimals(address: string) {
    const token = new Contract(address, ERC20_ABI, this.provider);
    try {
      const decimalsFn = token.getFunction('decimals');
      const decimals = await decimalsFn();
      return Number(decimals);
    } catch (error) {
      return env.BASE_TOKEN_DECIMALS;
    }
  }

  private computeTwap(currentTs: number) {
    const horizon = currentTs - 30 * 60; // 30 minutes
    const window = this.sampleBuffer.filter((sample) => sample.ts >= horizon);
    if (window.length === 0) {
      return 10_000; // 1.0
    }
    const avg = window.reduce((acc, sample) => acc + sample.price, 0) / window.length;
    return Math.round(avg * 10_000);
  }

  private async getExchangeRate(dec0: number, dec1: number): Promise<number> {
    // Get price: how much coin1 (QUOTE/USDC) for 1 unit of coin0 (BASE/USDF)
    const oneUnit = parseUnits('1', dec0);

    for (const signature of GET_DY_SIGNATURES) {
      const iface = new Interface([signature]);
      const fragment = iface.fragments[0] as FunctionFragment;
      try {
        // get_dy(i, j, dx): swap coin i -> coin j
        // We want: coin0 -> coin1 (BASE -> QUOTE, USDF -> USDC)
        const data = iface.encodeFunctionData(fragment, [0, 1, oneUnit]);
        const raw = await this.provider.call({ to: env.POOL_ADDRESS, data });
        const [amountOut] = iface.decodeFunctionResult(fragment, raw);
        // This gives us how much coin1 we get for 1 coin0
        return Number(formatUnits(amountOut, dec1));
      } catch (error) {
        continue;
      }
    }

    // Fallback to simple ratio if get_dy doesn't work
    return 1.0;
  }

  private async estimateLoss(decBase: number, decQuote: number) {
    const qBase = parseUnits(env.Q_BASE_AMOUNT, decQuote);

    for (const signature of GET_DY_SIGNATURES) {
      const iface = new Interface([signature]);
      const fragment = iface.fragments[0] as FunctionFragment;
      try {
        const data = iface.encodeFunctionData(fragment, [1, 0, qBase]);
        const raw = await this.provider.call({ to: env.POOL_ADDRESS, data });
        const [amountOut] = iface.decodeFunctionResult(fragment, raw);
        const amountOutHuman = Number(formatUnits(amountOut, decBase));
        const amountInHuman = Number(formatUnits(qBase, decQuote));
        if (amountInHuman === 0) return 0;
        const loss = amountInHuman - amountOutHuman;
        return Math.max(Math.round((loss / amountInHuman) * 10_000), 0);
      } catch (error) {
        continue;
      }
    }

    return 0;
  }
}
