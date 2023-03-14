import { Block, encode, decode } from 'multiformats/block'
import { sha256 } from 'multiformats/hashes/sha2'
import * as cbor from '@ipld/dag-cbor'
import { CIDCounter } from 'prolly-trees/utils'

/**
 * @template T
 * @typedef {{ parents: EventLink<T>[], data: T }} EventView
 */

/**
 * @template T
 * @typedef {import('multiformats').BlockView<EventView<T>>} EventBlockView
 */

/**
 * @template T
 * @typedef {import('multiformats').Link<EventView<T>>} EventLink
 */

/**
 * Advance the clock by adding an event.
 *
 * @template T
 * @param {import('./block').BlockFetcher} blocks Block storage.
 * @param {EventLink<T>[]} head The head of the clock.
 * @param {EventLink<T>} event The event to add.
 * @returns {Promise<EventLink<T>[]>} The new head of the clock.
 */
export async function advance (blocks, head, event) {
  /** @type {EventFetcher<T>} */
  const events = new EventFetcher(blocks)
  const headmap = new Map(head.map((cid) => [cid.toString(), cid]))

  // Check if the headmap already includes the event, return head if it does
  if (headmap.has(event.toString())) return { head }

  // Does event contain the clock?
  let changed = false
  for (const cid of head) {
    if (await contains(events, event, cid)) {
      headmap.delete(cid.toString())
      headmap.set(event.toString(), event)
      changed = true
    }
  }

  // If the headmap has been changed, return the new headmap values
  if (changed) {
    return { head: [...headmap.values()] }
  }

  // Does clock contain the event?
  for (const p of head) {
    if (await contains(events, p, event)) {
      return { head }
    }
  }

  // Return the head concatenated with the new event if it passes both checks
  return { head: head.concat(event) }
}

/**
 * @template T
 * @implements {EventBlockView<T>}
 */
export class EventBlock extends Block {
  /**
   * @param {object} config
   * @param {EventLink<T>} config.cid
   * @param {Event} config.value
   * @param {Uint8Array} config.bytes
   */
  constructor ({ cid, value, bytes }) {
    // @ts-expect-error
    super({ cid, value, bytes })
  }

  /**
   * @template T
   * @param {T} data
   * @param {EventLink<T>[]} [parents]
   */
  static create (data, parents) {
    return encodeEventBlock({ data, parents: parents ?? [] })
  }
}

/** @template T */
export class EventFetcher {
  /** @param {import('./block').BlockFetcher} blocks */
  constructor (blocks) {
    /** @private */
    this._blocks = blocks
    this._cids = new CIDCounter()
  }

  /**
   * @param {EventLink<T>} link
   * @returns {Promise<EventBlockView<T>>}
   */
  async get (link) {
    const block = await this._blocks.get(link)
    this._cids.add({ address: link })
    if (!block) throw new Error(`missing block: ${link}`)
    return decodeEventBlock(block.bytes)
  }

  async all () {
    await Promise.all([...this._cids])
    return this._cids
  }
}

/**
 * @template T
 * @param {EventView<T>} value
 * @returns {Promise<EventBlockView<T>>}
 */
export async function encodeEventBlock (value) {
  // TODO: sort parents
  const { cid, bytes } = await encode({ value, codec: cbor, hasher: sha256 })
  // @ts-expect-error
  return new Block({ cid, value, bytes })
}

/**
 * @template T
 * @param {Uint8Array} bytes
 * @returns {Promise<EventBlockView<T>>}
 */
export async function decodeEventBlock (bytes) {
  const { cid, value } = await decode({ bytes, codec: cbor, hasher: sha256 })
  // @ts-expect-error
  return new Block({ cid, value, bytes })
}

/**
 * Returns true if event "a" contains event "b". Breadth first search.
 * @template T
 * @param {EventFetcher} events
 * @param {EventLink<T>} a
 * @param {EventLink<T>} b
 */
async function contains (events, a, b) {
  if (a.toString() === b.toString()) return true
  const [{ value: aevent }, { value: bevent }] = await Promise.all([events.get(a), events.get(b)])
  const links = [...aevent.parents]
  while (links.length) {
    const link = links.shift()
    if (!link) break
    if (link.toString() === b.toString()) return true
    // if any of b's parents are this link, then b cannot exist in any of the
    // tree below, since that would create a cycle.
    if (bevent.parents.some((p) => link.toString() === p.toString())) continue
    const { value: event } = await events.get(link)
    links.push(...event.parents)
  }
  return false
}

/**
 * @template T
 * @param {import('./block').BlockFetcher} blocks Block storage.
 * @param {EventLink<T>[]} head
 * @param {object} [options]
 * @param {(b: EventBlockView<T>) => string} [options.renderNodeLabel]
 */
export async function * vis (blocks, head, options = {}) {
  const renderNodeLabel = options.renderNodeLabel ?? ((b) => b.value.data.value)
  const events = new EventFetcher(blocks)
  yield 'digraph clock {'
  yield '  node [shape=point fontname="Courier"]; head;'
  const hevents = await Promise.all(head.map((link) => events.get(link)))
  const links = []
  const nodes = new Set()
  for (const e of hevents) {
    nodes.add(e.cid.toString())
    yield `  node [shape=oval fontname="Courier"]; ${e.cid} [label="${renderNodeLabel(e)}"];`
    yield `  head -> ${e.cid};`
    for (const p of e.value.parents) {
      yield `  ${e.cid} -> ${p};`
    }
    links.push(...e.value.parents)
  }
  while (links.length) {
    const link = links.shift()
    if (!link) break
    if (nodes.has(link.toString())) continue
    nodes.add(link.toString())
    const block = await events.get(link)
    yield `  node [shape=oval]; ${link} [label="${renderNodeLabel(block)}" fontname="Courier"];`
    for (const p of block.value.parents) {
      yield `  ${link} -> ${p};`
    }
    links.push(...block.value.parents)
  }
  yield '}'
}

export async function findEventsToSync (blocks, head) {
  const events = new EventFetcher(blocks)
  const { ancestor, sorted } = await findCommonAncestorWithSortedEvents(events, head)
  const toSync = await asyncFilter(sorted, async (uks) => !(await contains(events, ancestor, uks.cid)))
  return { cids: events.cids, events: toSync }
}

const asyncFilter = async (arr, predicate) =>
  Promise.all(arr.map(predicate)).then((results) => arr.filter((_v, index) => results[index]))

export async function findCommonAncestorWithSortedEvents (events, children) {
  const ancestor = await findCommonAncestor(events, children)
  if (!ancestor) {
    throw new Error('failed to find common ancestor event')
  }
  // Sort the events by their sequence number
  const sorted = await findSortedEvents(events, children, ancestor)
  return { ancestor, sorted }
}

/**
 * Find the common ancestor event of the passed children. A common ancestor is
 * the first single event in the DAG that _all_ paths from children lead to.
 *
 * @param {import('./clock').EventFetcher} events
 * @param  {import('./clock').EventLink<EventData>[]} children
 */
async function findCommonAncestor (events, children) {
  if (!children.length) return
  const candidates = children.map((c) => [c])
  while (true) {
    let changed = false
    for (const c of candidates) {
      const candidate = await findAncestorCandidate(events, c[c.length - 1])
      if (!candidate) continue
      changed = true
      c.push(candidate)
      const ancestor = findCommonString(candidates)
      if (ancestor) return ancestor
    }
    if (!changed) return
  }
}

/**
 * @param {import('./clock').EventFetcher} events
 * @param {import('./clock').EventLink<EventData>} root
 */
async function findAncestorCandidate (events, root) {
  const { value: event } = await events.get(root)
  if (!event.parents.length) return root
  return event.parents.length === 1 ? event.parents[0] : findCommonAncestor(events, event.parents)
}

/**
 * @template {{ toString: () => string }} T
 * @param  {Array<T[]>} arrays
 */
function findCommonString (arrays) {
  arrays = arrays.map((a) => [...a])
  for (const arr of arrays) {
    for (const item of arr) {
      let matched = true
      for (const other of arrays) {
        if (arr === other) continue
        matched = other.some((i) => String(i) === String(item))
        if (!matched) break
      }
      if (matched) return item
    }
  }
}

/**
 * Find and sort events between the head(s) and the tail.
 * @param {import('./clock').EventFetcher} events
 * @param {import('./clock').EventLink<EventData>[]} head
 * @param {import('./clock').EventLink<EventData>} tail
 */
async function findSortedEvents (events, head, tail) {
  // get weighted events - heavier events happened first
  /** @type {Map<string, { event: import('./clock').EventBlockView<EventData>, weight: number }>} */
  const weights = new Map()
  const all = await Promise.all(head.map((h) => findEvents(events, h, tail)))
  for (const arr of all) {
    for (const { event, depth } of arr) {
      const info = weights.get(event.cid.toString())
      if (info) {
        info.weight += depth
      } else {
        weights.set(event.cid.toString(), { event, weight: depth })
      }
    }
  }

  // group events into buckets by weight
  /** @type {Map<number, import('./clock').EventBlockView<EventData>[]>} */
  const buckets = new Map()
  for (const { event, weight } of weights.values()) {
    const bucket = buckets.get(weight)
    if (bucket) {
      bucket.push(event)
    } else {
      buckets.set(weight, [event])
    }
  }

  // sort by weight, and by CID within weight
  const sorted = Array.from(buckets)
    .sort((a, b) => b[0] - a[0])
    .flatMap(([, es]) => es.sort((a, b) => (String(a.cid) < String(b.cid) ? -1 : 1)))
  // console.log('sorted', sorted.map(s => s.value.data.value))
  return sorted
}

/**
 * @param {import('./clock').EventFetcher} events
 * @param {import('./clock').EventLink<EventData>} start
 * @param {import('./clock').EventLink<EventData>} end
 * @returns {Promise<Array<{ event: import('./clock').EventBlockView<EventData>, depth: number }>>}
 */
async function findEvents (events, start, end, depth = 0) {
  const event = await events.get(start)
  const acc = [{ event, depth }]
  const { parents } = event.value
  if (parents.length === 1 && String(parents[0]) === String(end)) return acc
  const rest = await Promise.all(parents.map((p) => findEvents(events, p, end, depth + 1)))
  return acc.concat(...rest)
}
