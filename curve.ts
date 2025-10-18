import { ethers } from 'ethers';
import { POOL } from '../config.js';

// Minimal ABI fragments used
const POOL_ABI = [
  'function balances(uint256) view returns (uint256)', // not always present
  'function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)',
  'function coins(uint256) view returns (address)',
  'function totalSupply() view returns (uint256)'
];

export class CurveIndexer {
  provider: ethers.providers.JsonRpcProvider;
  pool: ethers.Contract;

  constructor(providerUrl: string) {
    this.provider = new ethers.providers.JsonRpcProvider(providerUrl);
    this.pool = new ethers.Contract(POOL.address, POOL_ABI, this.provider);
  }

  async balancesAt(blockTag: ethers.providers.BlockTag) {
    // Many Curve pools expose different ABIs; try both balances(i) and old 'get_balances'
    try {
      const b0 = await this.pool.balances(0, { blockTag });
      const b1 = await this.pool.balances(1, { blockTag });
      return { b0: b0.toString(), b1: b1.toString() };
    } catch (err) {
      // fallback: read token contract balances
      const [t0, t1] = await Promise.all([this.pool.coins(0), this.pool.coins(1)]);
      const tokenAbi = ['function balanceOf(address) view returns (uint256)'];
      const t0c = new ethers.Contract(t0, tokenAbi, this.provider);
      const t1c = new ethers.Contract(t1, tokenAbi, this.provider);
      const [b0, b1] = await Promise.all([t0c.balanceOf(POOL.address, { blockTag }), t1c.balanceOf(POOL.address, { blockTag })]);
      return { b0: b0.toString(), b1: b1.toString() };
    }
  }

  async getDy(i:number,j:number,dx:string, blockTag: ethers.providers.BlockTag) {
    // returns USDC out for dx of USDf (or vice versa)
    try {
      const out = await this.pool.get_dy(i,j,dx, { blockTag });
      return out.toString();
    } catch (err:any) {
      throw new Error('get_dy not available for this pool ABI: ' + err.message);
    }
  }

  async totalSupply(blockTag: ethers.providers.BlockTag) {
    return (await this.pool.totalSupply({ blockTag })).toString();
  }
}
