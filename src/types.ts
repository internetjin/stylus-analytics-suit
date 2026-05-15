export type AbiInput = {
  name: string;
  type: string;
  components?: AbiInput[];
  indexed?: boolean;
};

export type AbiOutput = AbiInput;

export type AbiFunction = {
  type: "function" | "constructor" | "fallback" | "receive";
  name?: string;
  inputs?: AbiInput[];
  outputs?: AbiOutput[];
  stateMutability?: "pure" | "view" | "nonpayable" | "payable";
};

export type AbiEvent = {
  type: "event";
  name: string;
  inputs: AbiInput[];
  anonymous?: boolean;
};

export type AbiError = {
  type: "error";
  name: string;
  inputs: AbiInput[];
};

export type AbiEntry = AbiFunction | AbiEvent | AbiError;

export type Abi = AbiEntry[];
