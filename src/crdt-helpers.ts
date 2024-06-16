import { encode, decode, Block } from "multiformats/block";
import { parse } from "multiformats/link";
import { sha256 as hasher } from "multiformats/hashes/sha2";
import * as codec from "@ipld/dag-cbor";
import { put, get, entries, root } from "@web3-storage/pail/crdt";
import { Operation, PutOperation } from "@web3-storage/pail/crdt/api";
import { EventFetcher, vis } from "@web3-storage/pail/clock";
import * as Batch from "@web3-storage/pail/crdt/batch";
import { type EncryptedBlockstore, type CompactionFetcher, CarTransaction, TransactionMeta, BlockFetcher } from "./storage-engine";
import type { IndexKeyType, DocUpdate, ClockHead, AnyLink, DocValue, CRDTMeta, ChangesOptions, DocFileMeta, DocFiles, DocSet } from "./types";
import { decodeFile, encodeFile } from "./files";
import { Result } from "@web3-storage/pail/crdt/api";
import { IndexKey } from "idb";

function time(tag: string) {
  // console.time(tag)
}

function timeEnd(tag: string) {
  // console.timeEnd(tag)
}

function toString<K extends IndexKeyType>(key: K): string {
  switch (typeof key) {
    case "string":
    case "number":
      return key.toString();
    default:
      throw new Error("Invalid key type");
  }
}

export async function applyBulkUpdateToCrdt<T, K extends IndexKeyType>(tblocks: CarTransaction, head: ClockHead, updates: DocUpdate<T, K>[]): Promise<CRDTMeta> {
  let result: Result | null = null;
  if (updates.length > 1) {
    const batch = await Batch.create(tblocks, head);
    for (const update of updates) {
      const link = await writeDocContent(tblocks, update);
      await batch.put(toString(update.key), link);
    }
    result = await batch.commit();
  } else if (updates.length === 1) {
    const link = await writeDocContent(tblocks, updates[0]);
    result = await put(tblocks, head, toString(updates[0].key), link);
  }
  if (!result) throw new Error("Missing result, updates: " + updates.length);

  if (result.event) {
    for (const { cid, bytes } of [
      ...result.additions,
      // ...result.removals,
      result.event,
    ]) {
      tblocks.putSync(cid, bytes);
    }
  }
  return { head: result.head } as CRDTMeta;
}

// this whole thing can get pulled outside of the write queue
async function writeDocContent<T, K extends IndexKeyType>(blocks: CarTransaction, update: DocUpdate<T, K>): Promise<AnyLink> {
  let value: Partial<DocValue<T>>;
  if (update.del) {
    value = { del: true };
  } else {
    if (!update.value) throw new Error("Missing value");
    await processFiles(blocks, update.value);
    value = { doc: update.value };
  }
  const block = await encode({ value, hasher, codec });
  blocks.putSync(block.cid, block.bytes);
  return block.cid;
}

async function processFiles<T>(blocks: CarTransaction, doc: DocSet<T>) {
  if (doc._files) {
    await processFileset(blocks, doc._files);
  }
  if (doc._publicFiles) {
    await processFileset(blocks, doc._publicFiles, true);
  }
}

async function processFileset(blocks: CarTransaction, files: DocFiles, publicFiles = false) {
  const dbBlockstore = blocks.parent;
  const t = new CarTransaction(dbBlockstore); // maybe this should move to encrypted-blockstore
  const didPut = [];
  // let totalSize = 0
  for (const filename in files) {
    if (File === files[filename].constructor) {
      const file = files[filename] as File;

      // totalSize += file.size
      const { cid, blocks: fileBlocks } = await encodeFile(file);
      didPut.push(filename);
      for (const block of fileBlocks) {
        t.putSync(block.cid, block.bytes);
      }
      files[filename] = { cid, type: file.type, size: file.size } as DocFileMeta;
    } else {
      const { cid, type, size, car } = files[filename] as DocFileMeta;
      if (cid && type && size && car) {
        files[filename] = { cid, type, size, car };
      }
    }
  }

  if (didPut.length) {
    const car = await dbBlockstore.loader?.commitFiles(t, { files } as unknown as TransactionMeta, {
      public: publicFiles,
    });
    if (car) {
      for (const name of didPut) {
        files[name] = { car, ...files[name] } as DocFileMeta;
      }
    }
  }
}

export async function getValueFromCrdt<T>(blocks: EncryptedBlockstore, head: ClockHead, key: string): Promise<DocValue<T>> {
  if (!head.length) throw new Error("Getting from an empty database");
  const link = await get(blocks, head, key);
  if (!link) throw new Error(`Missing key ${key}`);
  return await getValueFromLink(blocks, link);
}

export function readFiles<T>(blocks: EncryptedBlockstore, { doc }: Partial<DocValue<T>>) {
  if (!doc) return;
  if (doc._files) {
    readFileset(blocks, doc._files);
  }
  if (doc._publicFiles) {
    readFileset(blocks, doc._publicFiles, true);
  }
}

function readFileset(blocks: EncryptedBlockstore, files: DocFiles, isPublic = false) {
  for (const filename in files) {
    const fileMeta = files[filename] as DocFileMeta;
    if (fileMeta.cid) {
      if (isPublic) {
        fileMeta.url = `https://${fileMeta.cid.toString()}.ipfs.w3s.link/`;
      }
      if (fileMeta.car) {
        fileMeta.file = async () =>
          await decodeFile(
            {
              get: async (cid: AnyLink) => {
                return await blocks.getFile(fileMeta.car!, cid, isPublic);
              },
            },
            fileMeta.cid,
            fileMeta,
          );
      }
    }
    files[filename] = fileMeta;
  }
}

async function getValueFromLink<T>(blocks: BlockFetcher, link: AnyLink): Promise<DocValue<T>> {
  const block = await blocks.get(link);
  if (!block) throw new Error(`Missing linked block ${link.toString()}`);
  const { value } = (await decode({ bytes: block.bytes, hasher, codec })) as { value: DocValue<T> };
  const cvalue = {
    ...value,
    cid: link
  }

  readFiles(blocks as EncryptedBlockstore, cvalue);
  return cvalue;
}

class DirtyEventFetcher<T> extends EventFetcher<T> {
  // @ts-ignore
  async get(link) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return await super.get(link);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      console.error("missing event", link.toString(), e);
      return { value: null };
    }
  }
}

export async function clockChangesSince<T, K extends IndexKeyType>(
  blocks: BlockFetcher,
  head: ClockHead,
  since: ClockHead,
  opts: ChangesOptions,
): Promise<{ result: DocUpdate<T, K>[]; head: ClockHead }> {
  const eventsFetcher = (
    opts.dirty ? new DirtyEventFetcher<Operation>(blocks) : new EventFetcher<Operation>(blocks)
  ) as EventFetcher<Operation>;
  const keys: Set<string> = new Set();
  const updates = await gatherUpdates<T, K>(blocks, eventsFetcher, head, since, [], keys, new Set<string>(), opts.limit || Infinity);
  return { result: updates.reverse(), head };
}

async function gatherUpdates<T, K extends IndexKeyType>(
  blocks: BlockFetcher,
  eventsFetcher: EventFetcher<Operation>,
  head: ClockHead,
  since: ClockHead,
  updates: DocUpdate<T, K>[] = [],
  keys: Set<string>,
  didLinks: Set<string>,
  limit: number,
): Promise<DocUpdate<T, K>[]> {
  if (limit <= 0) return updates;
  // if (Math.random() < 0.001) console.log('gatherUpdates', head.length, since.length, updates.length)
  const sHead = head.map((l) => l.toString());
  for (const link of since) {
    if (sHead.includes(link.toString())) {
      return updates;
    }
  }
  for (const link of head) {
    if (didLinks.has(link.toString())) continue;
    didLinks.add(link.toString());
    const { value: event } = await eventsFetcher.get(link);
    if (!event) continue;
    const { type } = event.data;
    let ops = [] as PutOperation[];
    if (type === "batch") {
      ops = event.data.ops as PutOperation[];
    } else if (type === "put") {
      ops = [event.data] as PutOperation[];
    }
    for (let i = ops.length - 1; i >= 0; i--) {
      const { key, value } = ops[i];
      if (!keys.has(key)) {
        // todo option to see all updates
        const docValue = await getValueFromLink(blocks, value);
        updates.push({ key: key as K, value: docValue.doc, del: docValue.del, clock: link });
        limit--;
        keys.add(key);
      }
    }
    if (event.parents) {
      updates = await gatherUpdates(blocks, eventsFetcher, event.parents, since, updates, keys, didLinks, limit);
    }
  }
  return updates;
}

export async function* getAllEntries<T, K extends IndexKeyType>(blocks: BlockFetcher, head: ClockHead) {
  // return entries(blocks, head)
  for await (const [key, link] of entries(blocks, head)) {
    const docValue = await getValueFromLink(blocks, link);
    yield { key, value: docValue.doc, del: docValue.del } as DocUpdate<T, K>;
  }
}

export async function* clockVis(blocks: EncryptedBlockstore, head: ClockHead) {
  for await (const line of vis(blocks, head)) {
    yield line;
  }
}

let isCompacting = false;
export async function doCompact(blockLog: CompactionFetcher, head: ClockHead) {
  if (isCompacting) {
    // console.log('already compacting')
    return;
  }
  isCompacting = true;

  time("compact head");
  for (const cid of head) {
    const bl = await blockLog.get(cid);
    if (!bl) throw new Error("Missing head block: " + cid.toString());
  }
  timeEnd("compact head");

  // for await (const blk of  blocks.entries()) {
  //   const bl = await blockLog.get(blk.cid)
  //   if (!bl) throw new Error('Missing tblock: ' + blk.cid.toString())
  // }

  // todo maybe remove
  // for await (const blk of blocks.loader!.entries()) {
  //   const bl = await blockLog.get(blk.cid)
  //   if (!bl) throw new Error('Missing db block: ' + blk.cid.toString())
  // }

  time("compact all entries");
  for await (const _entry of getAllEntries(blockLog, head)) {
    // result.push(entry)
    void 1;
  }
  timeEnd("compact all entries");

  // time("compact crdt entries")
  // for await (const [, link] of entries(blockLog, head)) {
  //   const bl = await blockLog.get(link)
  //   if (!bl) throw new Error('Missing entry block: ' + link.toString())
  // }
  // timeEnd("compact crdt entries")

  time("compact clock vis");
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _line of vis(blockLog, head)) {
    void 1;
  }
  timeEnd("compact clock vis");

  time("compact root");
  const result = await root(blockLog, head);
  timeEnd("compact root");

  time("compact root blocks");
  for (const { cid, bytes } of [...result.additions, ...result.removals]) {
    blockLog.loggedBlocks.putSync(cid, bytes);
  }
  timeEnd("compact root blocks");

  time("compact changes");
  await clockChangesSince(blockLog, head, [], {});
  timeEnd("compact changes");

  isCompacting = false;
}

export async function getBlock(blocks: BlockFetcher, cidString: string) {
  const block = await blocks.get(parse(cidString));
  if (!block) throw new Error(`Missing block ${cidString}`);
  const { cid, value } = await decode({ bytes: block.bytes, codec, hasher });
  return new Block({ cid, value, bytes: block.bytes });
}
