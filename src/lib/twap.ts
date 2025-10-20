import { Contract, JsonRpcProvider, formatUnits } from "ethers";

const UNI_V3_POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
];

const CHAINLINK_AGG_ABI = [
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function getRoundData(uint80 _roundId) view returns (uint80, int256, uint256, uint256, uint80)",
];

const CURVE_POOL_ABI = [
  "function coins(uint256) view returns (address)",
  "function balances(uint256) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
];

type TwapSource =
  | "uni_v3_observe"
  | "chainlink_latest"
  | "curve_virtual_moving_avg";

interface GetTwapParams {
  provider: JsonRpcProvider;
  horizonSeconds: number;
  uniV3PoolAddress?: string;
  chainlinkAggregatorAddress?: string;
  curvePoolAddress?: string;
}

interface TwapResult {
  twap: number;
  source: TwapSource;
  windowStart: number;
  windowEnd: number;
}

const tickToPrice = (tick: number) => Math.pow(1.0001, tick);

export const getTWAP = async ({
  provider,
  horizonSeconds,
  uniV3PoolAddress,
  chainlinkAggregatorAddress,
  curvePoolAddress,
}: GetTwapParams): Promise<TwapResult> => {
  if (uniV3PoolAddress) {
    try {
      const pool = new Contract(uniV3PoolAddress, UNI_V3_POOL_ABI, provider);
      const secondsAgos = [horizonSeconds, 0];
      const observeFn = pool.getFunction("observe");
      const result = (await observeFn(secondsAgos)) as [bigint[], bigint[]];
      const tickCum0 = Number(result[0][0]);
      const tickCum1 = Number(result[0][1]);
      const avgTick = (tickCum1 - tickCum0) / horizonSeconds;
      const twap = tickToPrice(avgTick);
      const now = Math.floor(Date.now() / 1000);
      return {
        twap,
        source: "uni_v3_observe",
        windowStart: now - horizonSeconds,
        windowEnd: now,
      };
    } catch (error) {
      // fall through to other sources
    }
  }

  if (chainlinkAggregatorAddress) {
    try {
      const aggregator = new Contract(
        chainlinkAggregatorAddress,
        CHAINLINK_AGG_ABI,
        provider
      );
      const latestRoundData = aggregator.getFunction("latestRoundData");
      const [, answer, , updatedAt] = (await latestRoundData()) as [
        bigint,
        bigint,
        bigint,
        bigint,
        bigint
      ];
      const twap = Number(answer) / 1e8;
      return {
        twap,
        source: "chainlink_latest",
        windowStart: Number(updatedAt) - horizonSeconds,
        windowEnd: Number(updatedAt),
      };
    } catch (error) {
      // fall through
    }
  }

  if (curvePoolAddress) {
    const pool = new Contract(curvePoolAddress, CURVE_POOL_ABI, provider);
    const latestBlock = await provider.getBlock("latest");
    if (!latestBlock) {
      throw new Error("Unable to fetch latest block for Curve TWAP");
    }
    const now = Number(latestBlock.timestamp);
    const samples = Math.min(60, Math.max(6, Math.floor(horizonSeconds / 60)));
    const twapSeries: number[] = [];

    for (let i = 0; i < samples; i += 1) {
      const blockTag = latestBlock.number - i;
      const balancesFn = pool.getFunction("balances");
      const coinsFn = pool.getFunction("coins");
      const balances = await Promise.all([
        balancesFn(0, { blockTag }),
        balancesFn(1, { blockTag }),
      ]).catch(async () => {
        const [token0, token1] = await Promise.all([coinsFn(0), coinsFn(1)]);
        const ERC20 = ["function balanceOf(address) view returns (uint256)"];
        const t0 = new Contract(token0, ERC20, provider);
        const t1 = new Contract(token1, ERC20, provider);
        const balanceOf0 = t0.getFunction("balanceOf");
        const balanceOf1 = t1.getFunction("balanceOf");
        return Promise.all([
          balanceOf0(curvePoolAddress, { blockTag }),
          balanceOf1(curvePoolAddress, { blockTag }),
        ]);
      });

      const totalSupplyFn = pool.getFunction("totalSupply");
      const totalSupply = await totalSupplyFn({ blockTag });
      const r0 = Number(formatUnits(balances[0], 6));
      const r1 = Number(formatUnits(balances[1], 6));
      const lpSupply = Number(formatUnits(totalSupply, 18));
      const pricePerLP = lpSupply === 0 ? 0 : (r0 + r1) / lpSupply;
      twapSeries.push(pricePerLP);
    }

    if (!twapSeries.length) {
      throw new Error("Unable to gather Curve TWAP samples");
    }

    const twap =
      twapSeries.reduce((acc, sample) => acc + sample, 0) / twapSeries.length;
    const windowEnd = now;
    const windowStart = now - horizonSeconds;

    return {
      twap,
      source: "curve_virtual_moving_avg",
      windowStart,
      windowEnd,
    };
  }

  throw new Error("No oracle source available for TWAP calculation");
};
