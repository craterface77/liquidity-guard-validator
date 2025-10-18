import { ethers } from 'ethers';

export function buildDepegAttPayload(domain: any, values: any) {
  return {
    domain,
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' }
      ],
      DepegAtt: [
        { name: 'poolId', type: 'bytes32' },
        { name: 'windowStart', type: 'uint48' },
        { name: 'windowEnd', type: 'uint48' },
        { name: 'lossQuoteBps', type: 'uint32' },
        { name: 'twapBps', type: 'uint32' },
        { name: 'rBps', type: 'uint32' },
        { name: 'chainId', type: 'uint256' },
        { name: 'nonce', type: 'uint256' }
      ]
    },
    value: values
  }
}

export async function signDepegAtt(wallet: ethers.Wallet, domain: any, payloadValues: any) {
  const data = buildDepegAttPayload(domain, payloadValues);
  // ethers v6 style signTypedData
  const signature = await wallet._signTypedData(domain, { DepegAtt: data.types.DepegAtt }, data.value);
  return signature;
}
