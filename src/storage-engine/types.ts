import type { Link } from "multiformats";
import { DataStore, MetaStore } from "./store";
import { RemoteWAL } from "./remote-wal";
import type { Loader } from "./loader";
import { F } from "vite/dist/node/types.d-aGj9QkWt";
import { CRDTMeta, ClockHead } from "../types";

export type AnyLink = Link<any, number, number, 1 | 0>;
export type CarGroup = AnyLink[];
export type CarLog = CarGroup[];
export type AnyAnyLink = Link<any, any, any, any>;
export interface AnyBlock { cid: AnyLink; bytes: Uint8Array }
export interface AnyAnyBlock { cid: AnyAnyLink; bytes: Uint8Array }
export interface AnyDecodedBlock { cid: AnyLink; bytes: Uint8Array; value: any }

export interface CarMakeable {
  entries(): Iterable<AnyBlock>;
  get(cid: AnyLink): Promise<AnyBlock | undefined>;
}

export interface CarHeader {
  readonly cars: CarLog;
  readonly compact: CarLog;
  readonly meta: CRDTMeta;
}

type NestedData =
  | Uint8Array
  | string
  | number
  | boolean
  | undefined
  | null
  | AnyLink
  | NestedData[]
  | { [key: string]: NestedData };

// // Record<string, NestedData>;
export type TransactionMeta = CRDTMeta & {
  readonly cars?: CarGroup;
  readonly files?: AnyLink[]
}
// export type TransactionMeta = {
//   readonly head: ClockHead;
// };

export interface CryptoOpts {
  readonly crypto: any;
  randomBytes(size: number): Uint8Array;
}

export interface StoreOpts {
  makeMetaStore(loader: Loader): MetaStore;
  makeDataStore(name: string): DataStore;
  makeRemoteWAL(loader: Loader): RemoteWAL;
}
export interface CommitOpts {
  readonly noLoader?: boolean;
  readonly compact?: boolean;
  readonly public?: boolean;
}

export interface DbMeta {
  readonly cars: CarGroup;
  readonly key?: string;
}

export interface UploadMetaFnParams {
  readonly name: string;
  readonly branch: string;
}

export type FnParamTypes = "data" | "file";

export interface UploadDataFnParams {
  readonly type: FnParamTypes;
  readonly name: string;
  readonly car: string;
  readonly size: string;
}

export interface DownloadDataFnParams {
  readonly type: FnParamTypes;
  readonly name: string;
  readonly car: string;
}

export interface DownloadMetaFnParams {
  readonly name: string;
  readonly branch: string;
}
