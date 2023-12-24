import pLimit from 'p-limit'
import { CarReader } from '@ipld/car'
import { encodeCarFile, encodeCarHeader, parseCarFile } from './loader-helpers'
import { decodeEncryptedCar, encryptedEncodeCarFile } from './encrypt-helpers'
import { getCrypto, randomBytes } from './crypto-web'

import { DataStore, MetaStore, RemoteWAL } from './store-browser'
import { DataStore as AbstractDataStore, MetaStore as AbstractMetaStore } from './store'

import { CID } from 'multiformats'
import type { Transaction } from './transaction'
import type {
  AnyBlock, AnyCarHeader, AnyLink, BulkResult,
  CarLoaderHeader,
  CommitOpts,
  DbCarHeader,
  DbMeta, FileCarHeader, FileResult, FireproofOptions
} from './types'
// import type { Connection } from './connection'
import { isFileResult, type DbLoader, type IndexerResult } from './loaders'
import { CommitQueue } from './commit-queue'




// ts-unused-exports:disable-next-line
export function cidListIncludes(list: AnyLink[], cid: AnyLink) {
  return list.some(c => c.equals(cid))
}
export function uniqueCids(list: AnyLink[], remove: Set<string> = new Set()): AnyLink[] {
  const byString = new Map<string, AnyLink>()
  for (const cid of list) {
    if (remove.has(cid.toString())) continue
    byString.set(cid.toString(), cid)
  }
  return [...byString.values()]
}

// ts-unused-exports:disable-next-line
export function toHexString(byteArray: Uint8Array) {
  return Array.from(byteArray)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

abstract class AbstractRemoteMetaStore extends AbstractMetaStore {
  abstract handleByteHeads(byteHeads: Uint8Array[], branch?: string): Promise<DbMeta[]>
}

export abstract class Loader {
  name: string
  opts: FireproofOptions = {}
  commitQueue = new CommitQueue<AnyLink>()
  isCompacting = false
  isWriting = false

  remoteMetaLoading: Promise<void> | undefined
  remoteMetaStore: AbstractRemoteMetaStore | undefined
  remoteCarStore: AbstractDataStore | undefined
  remoteWAL: RemoteWAL
  metaStore: MetaStore
  carStore: DataStore
  carLog: AnyLink[] = []
  carReaders: Map<string, Promise<CarReader>> = new Map()
  ready: Promise<void>
  key: string | undefined
  keyId: string | undefined
  seenCompacted: Set<string> = new Set()

  private getBlockCache: Map<string, AnyBlock> = new Map()
  private seenMeta: Set<string> = new Set()

  static defaultHeader: AnyCarHeader
  abstract defaultHeader: AnyCarHeader

  constructor(name: string, opts?: FireproofOptions) {
    this.name = name
    this.opts = opts || this.opts
    this.metaStore = new MetaStore(this.name)
    this.carStore = new DataStore(this.name)
    this.remoteWAL = new RemoteWAL(this)
    this.ready = Promise.resolve().then(async () => {
      if (!this.metaStore || !this.carStore || !this.remoteWAL)
        throw new Error('stores not initialized')
      const metas = this.opts.meta ? [this.opts.meta] : await this.metaStore.load('main')
      if (metas) {
        await this.handleDbMetasFromStore(metas)
      }
    })
  }

  async snapToCar(carCid: AnyLink | string) {
    await this.ready
    if (typeof carCid === 'string') {
      carCid = CID.parse(carCid)
    }
    const carHeader = await this.loadCarHeaderFromMeta({ car: carCid, key: this.key || null })
    this.carLog = [carCid, ...carHeader.cars]
    await this.getMoreReaders(carHeader.cars)
    await this._applyCarHeader(carHeader, true)
  }

  async _readyForMerge() {}
  async _setWaitForWrite(_writing: () => Promise<void>) {}

  async handleDbMetasFromStore(metas: DbMeta[]): Promise<void> {    
    for (const meta of metas) {
      const writingFn = async () => {
        this.isWriting = true
        await this.mergeDbMetaIntoClock(meta)
        this.isWriting = false
      }
      this._setWaitForWrite(writingFn)
      await writingFn()
    }
  }

  async mergeDbMetaIntoClock(meta: DbMeta): Promise<void> {
    const ld = this as unknown as DbLoader
    await ld.compacting
    if (this.isCompacting) {
      throw new Error('cannot merge while compacting')
    }
    if (this.seenMeta.has(meta.car.toString())) return
    this.seenMeta.add(meta.car.toString())

    if (meta.key) {
      await this.setKey(meta.key)
    }
    if (cidListIncludes(this.carLog, meta.car)) {
      return
    }
    const carHeader = (await this.loadCarHeaderFromMeta(meta)) as DbCarHeader
    // fetch other cars down the compact log?
    // todo we should use a CID set for the compacted cids (how to expire?)
    // console.log('merge carHeader', carHeader.head.length, carHeader.head.toString(), meta.car.toString())
    carHeader.compact.map(c => c.toString()).forEach(this.seenCompacted.add, this.seenCompacted)
    await this.getMoreReaders(carHeader.cars)
    this.carLog = [...uniqueCids([meta.car, ...this.carLog, ...carHeader.cars], this.seenCompacted)]
    await this._applyCarHeader(carHeader)
  }

  protected async ingestKeyFromMeta(meta: DbMeta): Promise<void> {
    const { key } = meta
    if (key) {
      await this.setKey(key)
    }
  }

  async loadCarHeaderFromMeta({ car: cid }: DbMeta): Promise<CarLoaderHeader> {
    const reader = await this.loadCar(cid)
    return (await parseCarFile(reader)) as CarLoaderHeader
  }

  protected abstract _applyCarHeader(_carHeader: CarLoaderHeader, snap?: boolean): Promise<void>

  // eslint-disable-next-line @typescript-eslint/require-await
  async _getKey() {
    if (this.key) return this.key
    // generate a random key
    if (!this.opts.public) {
      if (getCrypto()) {
        await this.setKey(toHexString(randomBytes(32)))
      } else {
        console.warn('missing crypto module, using public mode')
      }
    }
    return this.key
  }

  async commit(
    t: Transaction,
    done: IndexerResult | BulkResult | FileResult,
    opts: CommitOpts = { noLoader: false, compact: false }
  ): Promise<AnyLink> {
    return this.commitQueue.enqueue(() => this._commitInternal(t, done, opts))
  }

  async _commitInternal(
    t: Transaction,
    done: IndexerResult | BulkResult | FileResult,
    opts: CommitOpts = { noLoader: false, compact: false }
  ): Promise<AnyLink> {
    await this.ready
    const fp = this.makeCarHeader(done, this.carLog, !!opts.compact)
    let roots: AnyLink[] = []
    // @ts-ignore
    if (fp.files) {
      // @ts-ignore
      roots = fp.files as AnyLink[]
    } else {
      const header = await encodeCarHeader(fp)
      await t.put(header.cid, header.bytes)
      roots = [header.cid]
      // const got = await t.get(header.cid)
      // if (!got) throw new Error('missing header block: '+header.cid.toString())
    }

    const theKey = opts.public ? null : await this._getKey()
    const { cid, bytes } = theKey
      ? await encryptedEncodeCarFile(theKey, roots[0], t)
      : await encodeCarFile(roots, t)

    if (isFileResult(done)) {
      // move to the db loader?
      const dbLoader = this as unknown as DbLoader
      await dbLoader.fileStore!.save({ cid, bytes })
      await this.remoteWAL!.enqueueFile(cid, opts.public)
      return cid
    }
    // console.log('saving car', cid.toString())
    await this.carStore!.save({ cid, bytes })

    const newDbMeta = { car: cid, key: theKey || null } as DbMeta
    await this.remoteWAL!.enqueue(newDbMeta, opts)

    await this.metaStore!.save(newDbMeta)

    if (opts.compact) {
      const fpCar = fp as CarLoaderHeader
      fpCar.compact.map(c => c.toString()).forEach(this.seenCompacted.add, this.seenCompacted)
      this.carLog = [...uniqueCids([cid, ...this.carLog], this.seenCompacted)]
      setTimeout(async () => {
        if (this.remoteMetaLoading) await this.remoteMetaLoading
        for (const cid of fpCar.compact) {
          await this.carStore!.remove(cid)
        } // todo instead we should have no delay, but delete previous compaction's old files
      }, 5000)
    } else {
      this.carLog.unshift(cid)
    }
    return cid
  }

  async flushCars() {
    await this.ready
    // for each cid in car log, make a dbMeta
    for (const cid of this.carLog) {
      const dbMeta = { car: cid, key: this.key || null } as DbMeta
      await this.remoteWAL!.enqueue(dbMeta, { public: false })
    }
  }

  async *entries(): AsyncIterableIterator<AnyBlock> {
    await this.ready
    for (const cid of this.carLog) {
      const reader = await this.loadCar(cid)
      if (!reader) throw new Error(`missing car reader ${cid.toString()}`)
      for await (const block of reader.blocks()) {
        yield block
      }
    }
  }

  async getBlock(cid: AnyLink): Promise<AnyBlock | undefined> {
    await this.ready
    const sCid = cid.toString()
    if (this.getBlockCache.has(sCid)) return this.getBlockCache.get(sCid)
    const got = await Promise.any(
      this.carLog.map(async carCid => {
        const reader = await this.loadCar(carCid)
        if (!reader) {
          throw new Error(`missing car reader ${carCid.toString()}`)
        }
        const block = await reader.get(cid as CID)
        if (block) {
          return block
        }
        throw new Error(`block not in reader: ${cid.toString()}`)
      })
    ).catch(() => undefined)
    if (got) {
      this.getBlockCache.set(sCid, got)
    }
    return got
  }

  protected abstract makeCarHeader(
    _result: BulkResult | IndexerResult | FileResult,
    _cars: AnyLink[],
    _compact: boolean
  ): AnyCarHeader | FileCarHeader

  protected async loadCar(cid: AnyLink): Promise<CarReader> {
    if (!this.carStore) throw new Error('car store not initialized')
    return await this.storesLoadCar(cid, this.carStore, this.remoteCarStore)
  }

  protected async storesLoadCar(
    cid: AnyLink,
    local: AbstractDataStore,
    remote?: AbstractDataStore,
    publicFiles?: boolean
  ): Promise<CarReader> {
    const cidString = cid.toString()
    if (!this.carReaders.has(cidString)) {
      this.carReaders.set(
        cidString,
        (async () => {
          let loadedCar: AnyBlock | null = null
          try {
            loadedCar = await local.load(cid)
          } catch (e) {
            if (remote) {
              const remoteCar = await remote.load(cid)
              if (remoteCar) {
                // todo test for this
                await local.save(remoteCar)
                loadedCar = remoteCar
              }
            }
          }
          if (!loadedCar) throw new Error(`missing car file ${cidString}`)
          const rawReader = await CarReader.fromBytes(loadedCar.bytes)
          const readerP = publicFiles
            ? Promise.resolve(rawReader)
            : this.ensureDecryptedReader(rawReader)
          this.carReaders.set(cidString, readerP)
          return readerP
        })().catch(e => {
          this.carReaders.delete(cidString)
          throw e
        })
      )
    }
    return this.carReaders.get(cidString) as Promise<CarReader>
  }

  protected async ensureDecryptedReader(reader: CarReader) {
    const theKey = await this._getKey()
    if (!theKey) return reader
    const { blocks, root } = await decodeEncryptedCar(theKey, reader)
    return {
      getRoots: () => [root],
      get: blocks.get.bind(blocks),
      blocks: blocks.entries.bind(blocks)
    } as unknown as CarReader
  }

  protected async setKey(key: string) {
    if (this.key && this.key !== key) throw new Error('key mismatch')
    this.key = key
    const crypto = getCrypto()
    if (!crypto) throw new Error('missing crypto module')
    const subtle = crypto.subtle
    const encoder = new TextEncoder()
    const data = encoder.encode(key)
    const hashBuffer = await subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    this.keyId = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }

  protected async getMoreReaders(cids: AnyLink[]) {
    const limit = pLimit(5)
    const missing = cids.filter(cid => !this.carReaders.has(cid.toString()))
    await Promise.all(missing.map(cid => limit(() => this.loadCar(cid))))
  }
}

export interface Connection {
  loader: Loader
  loaded: Promise<void>
}


