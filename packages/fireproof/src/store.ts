import { format, parse, ToString } from '@ipld/dag-json'
import { AnyBlock, AnyLink, CommitOpts, DbMeta } from './types'

import { PACKAGE_VERSION } from './version'
import type { Loader } from './loader'
// import { RemoteDataStore, RemoteMetaStore } from './store-remote'
const match = PACKAGE_VERSION.match(/^([^.]*\.[^.]*)/)
if (!match) throw new Error('invalid version: ' + PACKAGE_VERSION)
export const STORAGE_VERSION = match[0]

// const mockStore = new Map<string, ToString<WALState>>()

abstract class VersionedStore {
  STORAGE_VERSION: string = STORAGE_VERSION
  name: string
  constructor(name: string) {
    this.name = name
  }
}

export abstract class MetaStore extends VersionedStore {
  tag: string = 'header-base'

  makeHeader({ car, key }: DbMeta): ToString<DbMeta> {
    const encoded = format({ car, key } as DbMeta)
    return encoded
  }

  parseHeader(headerData: ToString<DbMeta>): DbMeta {
    const got = parse<DbMeta>(headerData)
    return got
  }

  abstract load(branch?: string): Promise<DbMeta[] | null>
  abstract save(dbMeta: DbMeta, branch?: string): Promise<DbMeta[] | null>
}

export type WALState = {
  operations: DbMeta[]
}

export abstract class RemoteWAL {
  tag: string = 'rwal-base'

  STORAGE_VERSION: string = STORAGE_VERSION
  loader: Loader
  ready: Promise<void>

  operations: DbMeta[] = []
  processing: Promise<void> | undefined = undefined

  constructor(loader: Loader) {
    this.loader = loader
    this.ready = (async () => {
      const walState = await this.load()
      this.operations = walState?.operations || []
    })()
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async enqueue(dbMeta: DbMeta, opts: CommitOpts) {
    await this.ready
    this.operations.push(dbMeta)
    await this.save({ operations: this.operations })
    if (!opts.noLoader) { void this._process() }
  }

  async _process() {
    await this.ready
    if (!this.loader.remoteCarStore) return
    if (this.processing) return this.processing
    const p = (async () => {
      await this._int_process()
    })()
    this.processing = p
    await p
    this.processing = undefined

    if (this.operations.length) setTimeout(() => void this._process(), 0)
  }

  async _int_process() {
    // const callId = Math.random().toString(36).slice(2)
    if (!this.loader.remoteCarStore) return
    const rmlp = (async () => {
      const operations = [...this.operations]
      if (!operations.length) return
      const uploads: Promise<void|AnyLink>[] = []
      for (const dbMeta of operations) {
        const uploadP = (async () => {
          // console.log('wal process', callId, dbMeta.car.toString())
          const car = await this.loader.carStore!.load(dbMeta.car)
          if (!car) throw new Error(`missing car ${dbMeta.car.toString()}`)
          return await this.loader.remoteCarStore!.save(car)
        })()
        uploads.push(uploadP)
      }
      const done = await Promise.all(uploads)
      // clear operations, leaving any new ones that came in while we were uploading
      await this.loader.remoteMetaStore?.save(operations[operations.length - 1])
      this.operations.splice(0, operations.length)
      await this.save({ operations: this.operations })
      // console.log('done uploading', callId, uploads.length, done.length, done.map(d => JSON.stringify(d)))
      // console.log('remainging ops', callId, this.operations.length, this.operations.map(o => o.car.toString()))
    })()
    this.loader.remoteMetaLoading = rmlp
    await rmlp
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  // async load(branch = 'main'): Promise<WALState | null> {
  //   const got = mockStore.get(branch)
  //   if (!got) return null
  //   return parse<WALState>(got)
  // }

  // eslint-disable-next-line @typescript-eslint/require-await
  // async save(state: WALState, branch = 'main'): Promise<null> {
  //   const encoded: ToString<WALState> = format(state)
  //   mockStore.set(branch, encoded)
  //   return null
  // }

  abstract load(branch?: string): Promise<WALState | null>
  abstract save(state: WALState, branch?: string): Promise<void>
}

export abstract class DataStore {
  tag: string = 'car-base'

  STORAGE_VERSION: string = STORAGE_VERSION
  loader: Loader
  constructor(loader: Loader) {
    this.loader = loader
  }

  abstract load(cid: AnyLink): Promise<AnyBlock>
  abstract save(car: AnyBlock): Promise<void|AnyLink>
  abstract remove(cid: AnyLink): Promise<void>
}
