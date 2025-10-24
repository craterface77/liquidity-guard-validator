import { Wallet, TypedDataDomain, TypedDataField } from "ethers";

export interface ClaimMessage {
  policyId: bigint;
  riskId: string;
  S: bigint;
  E: bigint;
  Lstar: bigint;
  refValue: bigint;
  curValue: bigint;
  payout: bigint;
  nonce: bigint;
  deadline: bigint;
}

const CLAIM_PAYLOAD_FIELDS: TypedDataField[] = [
  { name: "policyId", type: "uint256" },
  { name: "riskId", type: "bytes32" },
  { name: "S", type: "uint64" },
  { name: "E", type: "uint64" },
  { name: "Lstar", type: "uint256" },
  { name: "refValue", type: "uint256" },
  { name: "curValue", type: "uint256" },
  { name: "payout", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
];

export interface ClaimTypedData {
  domain: TypedDataDomain;
  types: Record<string, TypedDataField[]>;
  message: ClaimMessage;
}

export function buildClaimTypedData(
  domain: TypedDataDomain,
  message: ClaimMessage
): ClaimTypedData {
  return {
    domain,
    types: {
      ClaimPayload: CLAIM_PAYLOAD_FIELDS,
    },
    message,
  };
}

export async function signClaimTypedData(
  privateKey: string,
  typedData: ClaimTypedData
) {
  const wallet = new Wallet(privateKey);
  const signature = await wallet.signTypedData(
    typedData.domain,
    typedData.types,
    typedData.message
  );
  return signature;
}
