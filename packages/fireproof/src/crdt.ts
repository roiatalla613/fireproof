import { TransactionBlockstore, IndexBlockstore } from './transaction'
import { clockChangesSince, applyBulkUpdateToCrdt, getValueFromCrdt, doCompact, readFiles, getAllEntries, clockVis } from './crdt-helpers'
import type { DocUpdate, BulkResult, ClockHead, FireproofOptions, ChangesOptions, AnyLink } from './types'
import type { Index } from './index'
import { CRDTClock } from './crdt-clock'
import { DbLoader } from './loaders'

export class CRDT {
  name: string | null
  opts: FireproofOptions = {}
  ready: Promise<void>
  blocks: TransactionBlockstore
  indexBlocks: IndexBlockstore

  indexers: Map<string, Index> = new Map()

  clock: CRDTClock = new CRDTClock()
  // isCompacting = false
  // compacting : Promise<AnyLink|void> = Promise.resolve()
  // writing: Promise<BulkResult|void> = Promise.resolve()

  constructor(name?: string, opts?: FireproofOptions) {
    this.name = name || null
    this.opts = opts || this.opts
    this.blocks = new TransactionBlockstore(this.name, this.clock, this.opts)
    this.clock.blocks = this.blocks
    this.indexBlocks = new IndexBlockstore(
      this.opts.persistIndexes && this.name ? this.name + '.idx' : null,
      this,
      this.opts
    )
    this.ready = Promise.all([this.blocks.ready, this.indexBlocks.ready]).then(() => {})
    this.clock.onZoom(() => {
      for (const idx of this.indexers.values()) {
        idx._resetIndex()
      }
    })
    this.clock.onTock(async () => {
      if (this.blocks.loader && this.blocks.loader.carLog.length < 100) return
      await this.compact()
    })
  }

  async bulk(updates: DocUpdate[], options?: object): Promise<BulkResult> {
    await this.ready
    const loader = this.blocks.loader as DbLoader

    await loader?.compacting
    const prevHead = [...this.clock.head]

    const writing = (async () => {
      const { head } = await this.blocks.transaction(async (tblocks): Promise<BulkResult> => {
        const { head } = await applyBulkUpdateToCrdt(tblocks, this.clock.head, updates, options)
        console.log('bulk head', this.blocks.loader?.carLog.length, head.toString())
        updates = updates.map(({ key, value, del }) => {
          readFiles(this.blocks, { doc: value })
          return { key, value, del }
        })
        return { head }
      })
      await this.clock.applyHead(null, head, prevHead, updates)
      return { head }
    })()
    if (loader) {
      const wr = loader.writing
      loader.writing = wr.then(async () => {
        await writing
        wr
      })
    }
    return (await writing)!
  }

  async allDocs() {
    await this.ready
    const result: DocUpdate[] = []
    for await (const entry of getAllEntries(this.blocks, this.clock.head)) {
      result.push(entry)
    }
    return { result, head: this.clock.head }
  }

  async vis() {
    await this.ready
    const txt = []
    for await (const line of clockVis(this.blocks, this.clock.head)) {
      txt.push(line)
    }
    return txt.join('\n')
  }

  async get(key: string) {
    await this.ready
    const result = await getValueFromCrdt(this.blocks, this.clock.head, key)
    if (result.del) return null
    return result
  }

  async changes(since: ClockHead = [], opts: ChangesOptions = {}) {
    await this.ready
    return await clockChangesSince(this.blocks, this.clock.head, since, opts)
  }

  async compact() {
    await this.ready
    if (this.blocks.loader) {
      await (this.blocks.loader as DbLoader).compact(this.blocks)
    }
  }
}
