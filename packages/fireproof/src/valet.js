import { sha256 } from 'multiformats/hashes/sha2'
import * as CBW from '@ipld/car/buffer-writer'
import * as raw from 'multiformats/codecs/raw'
import * as Block from 'multiformats/block'
import { Loader } from './loader.js'
// @ts-ignore
import { bf } from 'prolly-trees/utils'
// @ts-ignore
import { nocache as cache } from 'prolly-trees/cache'
import { encrypt, decrypt } from './crypto.js'
import { Buffer } from 'buffer'

const chunker = bf(30)

export class Valet {
  idb = null
  name = null
  uploadQueue = null
  alreadyEnqueued = new Set()

  instanceId = Math.random().toString(36).slice(2)

  constructor (name = 'default', config = {}) {
    this.name = name
    // console.log('new Valet', name, config.primary)
    this.primary = Loader.appropriate(name, config.primary)
    this.secondary = config.secondary ? Loader.appropriate(name, config.secondary) : null
    // set up a promise listener that applies all the headers to the clock
    // when they resolve
    const readyP = [this.primary.ready]
    if (this.secondary) readyP.push(this.secondary.ready)

    this.ready = Promise.all(readyP).then((blocksReady) => {
      // console.log('blocksReady valet', this.name, blocksReady)
      return blocksReady
    })
  }

  async saveHeader (header) {
    // each storage needs to add its own carCidMapCarCid to the header
    if (this.secondary) { this.secondary.saveHeader(header) } // todo: await?
    return await this.primary.saveHeader(header)
  }

  /**
   * Group the blocks into a car and write it to the valet.
   * @param {import('./blockstore.js').InnerBlockstore} innerBlockstore
   * @param {Set<string>} cids
   * @returns {Promise<void>}
   * @memberof Valet
   */
  async writeTransaction (innerBlockstore, cids) {
    if (innerBlockstore.lastCid) {
      await parkCar(this.primary, innerBlockstore, cids)
      if (this.secondary) await parkCar(this.secondary, innerBlockstore, cids)
    } else {
      throw new Error('missing lastCid for car header')
    }
  }

  // async compact() {
  //   const carCids = []
  //   // for await (const { cid } of this.valet.cids()) {
  //   //   yield { cid }
  //   // }
  //   // create a blockstore with all data
  //   {
  //     entries: () => syncCIDs.map(cid => ({ cid })),
  //     get: async cid => await blocks.get(cid)
  //   }
  //   // park it
  // }

  /**
   * Iterate over all blocks in the store.
   *
   * @yields {{cid: string, value: Uint8Array}}
   * @returns {AsyncGenerator<any, any, any>}
   */
  async * cids () {
    // console.log('valet cids')
    // todo use cidMap
    // while (cursor) {
    // yield { cid: cursor.key, car: cursor.value.car }
    // cursor = await cursor.continue()
    // }
  }

  remoteBlockFunction = null

  async getValetBlock (dataCID) {
    // console.log('getValetBlock primary', dataCID)
    try {
      const { block } = await this.primary.getLoaderBlock(dataCID)
      return block
    } catch (e) {
      // console.log('getValetBlock error', e)
      if (this.secondary) {
        // console.log('getValetBlock secondary', dataCID)
        try {
          const { block, reader } = await this.secondary.getLoaderBlock(dataCID)
          const cids = new Set()
          for await (const { cid } of reader.entries()) {
            // console.log(cid, bytes)
            cids.add(cid.toString())
          }
          reader.get = reader.gat // some consumers prefer get
          // console.log('replicating', reader.root)
          reader.lastCid = reader.root.cid
          await parkCar(this.primary, reader, [...cids])
          return block
        } catch (e) {
          // console.log('getValetBlock secondary error', e)
        }
      }
    }
  }
}

async function parkCar (storage, innerBlockstore, cids) {
  // console.log('parkCar', this.instanceId, this.name, carCid, cids)
  if (storage.readonly) return
  let newCar
  if (storage.keyMaterial) {
    // console.log('encrypting car', innerBlockstore.label)
    newCar = await blocksToEncryptedCarBlock(innerBlockstore.lastCid, innerBlockstore, storage.keyMaterial)
  } else {
    // todo should we pass cids in instead of iterating innerBlockstore?
    newCar = await blocksToCarBlock(innerBlockstore.lastCid, innerBlockstore)
  }
  // console.log('new car', newCar.cid.toString())
  return await storage.saveCar(newCar.cid.toString(), newCar.bytes, cids)
}

export const blocksToCarBlock = async (rootCids, blocks) => {
  // console.log('blocksToCarBlock', rootCids, blocks.constructor.name)
  let size = 0
  if (!Array.isArray(rootCids)) {
    rootCids = [rootCids]
  }
  const headerSize = CBW.headerLength({ roots: rootCids })
  size += headerSize
  if (!Array.isArray(blocks)) {
    blocks = Array.from(blocks.entries())
  }
  for (const { cid, bytes } of blocks) {
    // console.log(cid, bytes)
    size += CBW.blockLength({ cid, bytes })
  }
  const buffer = new Uint8Array(size)
  const writer = await CBW.createWriter(buffer, { headerSize })

  for (const cid of rootCids) {
    writer.addRoot(cid)
  }

  for (const { cid, bytes } of blocks) {
    writer.write({ cid, bytes })
  }
  await writer.close()
  return await Block.encode({ value: writer.bytes, hasher: sha256, codec: raw })
}

export const blocksToEncryptedCarBlock = async (innerBlockStoreClockRootCid, blocks, keyMaterial) => {
  const encryptionKey = Buffer.from(keyMaterial, 'hex')
  const encryptedBlocks = []
  const theCids = []
  // console.trace('blocksToEncryptedCarBlock', blocks)
  for (const { cid } of blocks.entries()) {
    theCids.push(cid.toString())
  }
  // console.log('encrypting', theCids.length, 'blocks', theCids.includes(innerBlockStoreClockRootCid.toString()), keyMaterial)
  // console.log('cids', theCids, innerBlockStoreClockRootCid.toString())
  let last
  for await (const block of encrypt({
    cids: theCids,
    get: async cid => blocks.get(cid), // maybe we can just use blocks.get
    key: encryptionKey,
    hasher: sha256,
    chunker,
    cache,
    // codec: dagcbor, // should be crypto?
    root: innerBlockStoreClockRootCid
  })) {
    encryptedBlocks.push(block)
    last = block
  }
  // console.log('last', last.cid.toString(), 'for clock', innerBlockStoreClockRootCid.toString())
  const encryptedCar = await blocksToCarBlock(last.cid, encryptedBlocks)
  return encryptedCar
}
// { root, get, key, cache, chunker, hasher }

const memoizeDecryptedCarBlocks = new Map()
export const blocksFromEncryptedCarBlock = async (cid, get, keyMaterial) => {
  if (memoizeDecryptedCarBlocks.has(cid.toString())) {
    return memoizeDecryptedCarBlocks.get(cid.toString())
  } else {
    const blocksPromise = (async () => {
      const decryptionKey = Buffer.from(keyMaterial, 'hex')
      // console.log('decrypting', keyMaterial, cid.toString())
      const cids = new Set()
      const decryptedBlocks = []
      for await (const block of decrypt({
        root: cid,
        get,
        key: decryptionKey,
        chunker,
        hasher: sha256,
        cache
        // codec: dagcbor
      })) {
        decryptedBlocks.push(block)
        cids.add(block.cid.toString())
      }
      return { blocks: decryptedBlocks, cids }
    })()
    memoizeDecryptedCarBlocks.set(cid.toString(), blocksPromise)
    return blocksPromise
  }
}
