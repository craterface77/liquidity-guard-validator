import { Wallet, type TypedDataDomain, type TypedDataField } from "ethers";

type DepegAttValues = {
  poolId: string;
  windowStart: number;
  windowEnd: number;
  lossQuoteBps: number;
  twapBps: number;
  rBps: number;
  chainId: number;
  nonce: number;
};

const DEPEG_ATT_FIELDS: TypedDataField[] = [
  { name: "poolId", type: "bytes32" },
  { name: "windowStart", type: "uint48" },
  { name: "windowEnd", type: "uint48" },
  { name: "lossQuoteBps", type: "uint32" },
  { name: "twapBps", type: "uint32" },
  { name: "rBps", type: "uint32" },
  { name: "chainId", type: "uint256" },
  { name: "nonce", type: "uint256" },
];

export const buildDepegAttPayload = (
  domain: TypedDataDomain,
  values: DepegAttValues
) => ({
  domain,
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    DepegAtt: DEPEG_ATT_FIELDS,
  },
  value: values,
});

export const signDepegAtt = async (
  wallet: Wallet,
  domain: TypedDataDomain,
  payloadValues: DepegAttValues
) => {
  const payload = buildDepegAttPayload(domain, payloadValues);
  const signature = await wallet.signTypedData(
    payload.domain,
    { DepegAtt: payload.types.DepegAtt },
    payload.value
  );
  return signature;
};
