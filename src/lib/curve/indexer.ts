import {
  Contract,
  Interface,
  JsonRpcProvider,
  formatUnits,
  type BlockTag,
} from "ethers";

const POOL_ABI = [
  "function balances(uint256) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
];

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
];

const GET_DY_SIGNATURES = [
  "function get_dy(int128,int128,uint256) view returns (uint256)",
  "function get_dy(int256,int256,uint256) view returns (uint256)",
  "function get_dy_underlying(int128,int128,uint256) view returns (uint256)",
];

export class CurveIndexer {
  readonly provider: JsonRpcProvider;
  private readonly pool: Contract;
  private readonly fallbackCoins: string[];
  private cachedCoinAddresses: string[] | null = null;

  constructor(
    rpcUrl: string,
    poolAddress: string,
    fallbackCoins?: string[]
  ) {
    this.provider = new JsonRpcProvider(rpcUrl);
    this.pool = new Contract(poolAddress, POOL_ABI, this.provider);
    this.fallbackCoins = fallbackCoins ?? [];
  }

  private async callWithFallback<T>(
    signatures: string[],
    params: unknown[],
    blockTag?: BlockTag
  ): Promise<T | null> {
    for (const signature of signatures) {
      let iface: Interface;
      try {
        iface = new Interface([signature]);
      } catch {
        continue;
      }
      const fragment = iface.getFunction(signature);
      if (!fragment) continue;

      const normalized = fragment.inputs.map((input, idx) => {
        const value = params[idx];
        if (
          typeof value === "number" &&
          (input.baseType.startsWith("uint") || input.baseType.startsWith("int"))
        ) {
          return BigInt(value);
        }
        return value;
      });

      try {
        const request: { to: string; data: string; blockTag?: BlockTag } = {
          to: this.pool.target as string,
          data: iface.encodeFunctionData(fragment, normalized),
        };
        if (blockTag !== undefined) {
          request.blockTag = blockTag;
        }
        const result = await this.provider.call(request);
        const [decoded] = iface.decodeFunctionResult(fragment, result);
        return decoded as T;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async getCoinCount(): Promise<number> {
    const count = await this.callWithFallback<bigint>(
      ["function N_COINS() view returns (uint256)"],
      []
    );
    if (count !== null) return Number(count);
    if (this.fallbackCoins.length) return this.fallbackCoins.length;
    return 2;
  }

  async getCoinAddresses(): Promise<[string, string]> {
    if (this.cachedCoinAddresses) {
      return [
        this.cachedCoinAddresses[0]!,
        this.cachedCoinAddresses[1]!,
      ];
    }

    const coinCount = await this.getCoinCount();
    const coinSignatures = [
      "function coins(uint256) view returns (address)",
      "function coins(int128) view returns (address)",
      "function underlying_coins(uint256) view returns (address)",
      "function underlying_coins(int128) view returns (address)",
    ];

    const coins: string[] = [];
    for (let i = 0; i < coinCount; i += 1) {
      const coin = await this.callWithFallback<string>(coinSignatures, [i]);
      if (coin) {
        coins.push(coin);
        continue;
      }
      const fallback = this.fallbackCoins[i];
      if (fallback && typeof fallback === "string" && fallback.startsWith("0x")) {
        coins.push(fallback);
      } else {
        break;
      }
    }

    if (coins.length < 2) {
      if (
        this.fallbackCoins.length &&
        this.fallbackCoins.every(
          (addr) => typeof addr === "string" && addr.startsWith("0x")
        )
      ) {
        this.cachedCoinAddresses = [...this.fallbackCoins];
        return [this.fallbackCoins[0]!, this.fallbackCoins[1]!];
      }
      throw new Error(
        "Unable to read coin addresses for Curve pool (ensure RPC supports Curve NG immutables or set CURVE_POOL.coinAddresses)."
      );
    }

    this.cachedCoinAddresses = coins;
    return [coins[0]!, coins[1]!];
  }

  async getTokenDecimals(tokenAddress: string): Promise<number> {
    try {
      const token = new Contract(tokenAddress, ERC20_ABI, this.provider);
      const decimalsFn = token.getFunction("decimals");
      const decimalsRaw = await decimalsFn();
      return Number(decimalsRaw);
    } catch (error) {
      return 18;
    }
  }

  async balancesAt(blockTag: BlockTag) {
    const balanceSignatures = [
      "function balances(uint256) view returns (uint256)",
      "function balances(int128) view returns (uint256)",
      "function underlying_balances(uint256) view returns (uint256)",
      "function underlying_balances(int128) view returns (uint256)",
    ];

    const b0 = await this.callWithFallback<bigint>(balanceSignatures, [0], blockTag);
    const b1 = await this.callWithFallback<bigint>(balanceSignatures, [1], blockTag);

    if (b0 !== null && b1 !== null) {
      return { b0, b1 };
    }

    const [coin0, coin1] = await this.getCoinAddresses();
    const token0 = new Contract(coin0, ERC20_ABI, this.provider);
    const token1 = new Contract(coin1, ERC20_ABI, this.provider);
    const balanceOf0 = token0.getFunction("balanceOf");
    const balanceOf1 = token1.getFunction("balanceOf");
    const [fallbackB0, fallbackB1] = await Promise.all([
      balanceOf0(this.pool.target as string, { blockTag }),
      balanceOf1(this.pool.target as string, { blockTag }),
    ]);
    return { b0: fallbackB0, b1: fallbackB1 };
  }

  async balancesHuman(
    blockTag: BlockTag,
    decimals0: number,
    decimals1: number
  ) {
    const balances = await this.balancesAt(blockTag);
    return {
      b0: Number(formatUnits(balances.b0, decimals0)),
      b1: Number(formatUnits(balances.b1, decimals1)),
    };
  }

  async totalSupply(blockTag: BlockTag) {
    const totalSupplyFn = this.pool.getFunction("totalSupply");
    return totalSupplyFn({ blockTag });
  }

  async tryGetDy(i: number, j: number, dxRaw: string, blockTag?: BlockTag) {
    for (const signature of GET_DY_SIGNATURES) {
      const iface = new Interface([signature]);
      const data = iface.encodeFunctionData(signature, [i, j, BigInt(dxRaw)]);
      try {
        const callRequest: {
          to: string;
          data: string;
          blockTag?: BlockTag;
        } = {
          to: this.pool.target as string,
          data,
        };
        if (blockTag !== undefined) callRequest.blockTag = blockTag;
        const result = await this.provider.call(callRequest);
        const decoded = iface.decodeFunctionResult(signature, result);
        const amountOutRaw = decoded[0] as bigint;
        return amountOutRaw;
      } catch {
        // try next signature
      }
    }
    return null;
  }
}
