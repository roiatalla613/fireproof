import { describe, it } from 'mocha'
import assert from 'node:assert'
import { advance, EventBlock, vis, since, findCommonAncestorWithSortedEvents, findUnknownSortedEvents, decodeEventBlock } from '../clock.js'
import { Blockstore, seqEventData, setSeq } from './helpers.js'

async function visHead (blocks, head) {
  const values = head.map(async (cid) => {
    const block = await blocks.get(cid)
    return (await decodeEventBlock(block.bytes)).value?.data?.value
  })
  console.log('visHead', head, await Promise.all(values))
}

describe('Clock', () => {
  it('create a new clock', async () => {
    const blocks = new Blockstore()
    const event = await EventBlock.create({})

    await blocks.put(event.cid, event.bytes)
    const head = await advance(blocks, [], event.cid)

    // for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 1)
    assert.equal(head[0].toString(), event.cid.toString())
  })

  it('add an event', async () => {
    const blocks = new Blockstore()
    const root = await EventBlock.create(await seqEventData())
    await blocks.put(root.cid, root.bytes)

    /** @type {import('../clock').EventLink<any>[]} */
    let head = [root.cid]

    const event = await EventBlock.create(await seqEventData(), head)
    await blocks.put(event.cid, event.bytes)

    head = await advance(blocks, head, event.cid)

    // for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 1)
    assert.equal(head[0].toString(), event.cid.toString())
  })

  it('add two events with shared parents', async () => {
    const blocks = new Blockstore()
    const root = await EventBlock.create(await seqEventData())
    await blocks.put(root.cid, root.bytes)

    /** @type {import('../clock').EventLink<any>[]} */
    let head = [root.cid]
    const parents = head

    const event0 = await EventBlock.create(await seqEventData(), parents)
    await blocks.put(event0.cid, event0.bytes)
    head = await advance(blocks, parents, event0.cid)

    const event1 = await EventBlock.create(await seqEventData(), parents)
    await blocks.put(event1.cid, event1.bytes)
    head = await advance(blocks, head, event1.cid)

    // for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 2)
    assert.equal(head[0].toString(), event0.cid.toString())
    assert.equal(head[1].toString(), event1.cid.toString())
  })

  it('add two events with some shared parents', async () => {
    const blocks = new Blockstore()
    const root = await EventBlock.create(await seqEventData())
    await blocks.put(root.cid, root.bytes)

    /** @type {import('../clock').EventLink<any>[]} */
    let head = [root.cid]
    const parents0 = head

    const event0 = await EventBlock.create(await seqEventData(), parents0)
    await blocks.put(event0.cid, event0.bytes)
    head = await advance(blocks, head, event0.cid)

    const event1 = await EventBlock.create(await seqEventData(), parents0)
    await blocks.put(event1.cid, event1.bytes)
    head = await advance(blocks, head, event1.cid)

    const event2 = await EventBlock.create(await seqEventData(), parents0)
    await blocks.put(event2.cid, event2.bytes)
    head = await advance(blocks, head, event2.cid)

    const event3 = await EventBlock.create(await seqEventData(), [event0.cid, event1.cid])
    await blocks.put(event3.cid, event3.bytes)
    head = await advance(blocks, head, event3.cid)
    const parentz = head

    const event4 = await EventBlock.create(await seqEventData(), [event2.cid])
    await blocks.put(event4.cid, event4.bytes)
    head = await advance(blocks, head, event4.cid)

    console.log('add two events with some shared parents')
    for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 2)
    assert.equal(head[0].toString(), event3.cid.toString())
    assert.equal(head[1].toString(), event4.cid.toString())
    console.log('since', parentz)
    for await (const block of since(blocks, parentz)) {
      if (block?.value) console.log(block.value.data)
    }
    const { ancestor, sorted } = await findCommonAncestorWithSortedEvents(blocks, parentz)
    console.log('findCommonAncestorWithSortedEvents', ancestor, sorted.map(b => b.value.data))
  })

  it('converge when multi-root', async () => {
    setSeq(-1)
    const blocks = new Blockstore()
    const root = await EventBlock.create(await seqEventData())
    await blocks.put(root.cid, root.bytes)

    /** @type {import('../clock').EventLink<any>[]} */
    let head = [root.cid]
    const parents0 = head

    const event0 = await EventBlock.create(await seqEventData(), parents0)
    await blocks.put(event0.cid, event0.bytes)
    head = await advance(blocks, head, event0.cid)

    const event1 = await EventBlock.create(await seqEventData(), parents0)
    await blocks.put(event1.cid, event1.bytes)
    head = await advance(blocks, head, event1.cid)

    const event1head = head

    const event2 = await EventBlock.create(await seqEventData(), event1head)
    await blocks.put(event2.cid, event2.bytes)
    head = await advance(blocks, head, event2.cid)

    const event3 = await EventBlock.create(await seqEventData(), event1head)
    await blocks.put(event3.cid, event3.bytes)
    head = await advance(blocks, head, event3.cid)

    const event3head = head

    const event4 = await EventBlock.create(await seqEventData(), event1head)
    await blocks.put(event4.cid, event4.bytes)
    head = await advance(blocks, head, event4.cid)
    const event4head = head
    console.log('event4', event4.cid)
    await visHead(blocks, event4head)

    const event5 = await EventBlock.create(await seqEventData(), event3head)
    await blocks.put(event5.cid, event5.bytes)
    head = await advance(blocks, head, event5.cid)
    const event5head = head
    console.log('event5', event5.cid)
    await visHead(blocks, event5head)

    const event6 = await EventBlock.create(await seqEventData(), event5head)
    await blocks.put(event6.cid, event6.bytes)
    head = await advance(blocks, head, event6.cid)
    const event6head = head
    console.log('event6', event6.cid)
    await visHead(blocks, event6head)

    const event7 = await EventBlock.create(await seqEventData(), event6head)
    await blocks.put(event7.cid, event7.bytes)
    head = await advance(blocks, head, event7.cid)
    const event7head = head
    console.log('event7', event7.cid)
    await visHead(blocks, event7head)

    const event8 = await EventBlock.create(await seqEventData(), event7head)
    await blocks.put(event8.cid, event8.bytes)
    head = await advance(blocks, head, event8.cid)
    const event8head = head
    console.log('event8', event8.cid)
    await visHead(blocks, event8head)

    const event9 = await EventBlock.create(await seqEventData(), event7head)
    await blocks.put(event9.cid, event9.bytes)
    head = await advance(blocks, head, event9.cid)
    const event9head = head
    console.log('event9', event9.cid)
    await visHead(blocks, event9head)

    const event10 = await EventBlock.create(await seqEventData(), event9head)
    await blocks.put(event10.cid, event10.bytes)
    head = await advance(blocks, head, event10.cid)
    const event10head = head
    console.log('event10', event10.cid)
    await visHead(blocks, event10head)

    console.log('converge when multi-root')
    for await (const line of vis(blocks, event10head)) console.log(line)

    assert.equal(event10head.length, 1)
    assert.equal(event10head[0].toString(), event10.cid.toString())

    const { ancestor, sorted } = await findCommonAncestorWithSortedEvents(blocks, [event5.cid, event2.cid])
    const unknownSorted = await findUnknownSortedEvents(blocks, [event5.cid, event2.cid], { ancestor, sorted })
    console.log('unknownSorted', unknownSorted.map(({ cid, value }) => ({ cid, seq: value.data.value })))

    // console.log('ancestor', ancestor)
    // const ancestorBlock = await blocks.get(ancestor)
    // const ancestorDecoded = await decodeEventBlock(ancestorBlock.bytes)
    // console.log('findCommonAncestorWithSortedEvents', ancestor, ancestorDecoded.value.data)
    // console.log('sorted', sorted.map(({ cid, value }) => ({ cid, seq: value.data.value })))
  })

  it('add an old event', async () => {
    const blocks = new Blockstore()
    const root = await EventBlock.create(await seqEventData())
    await blocks.put(root.cid, root.bytes)

    /** @type {import('../clock').EventLink<any>[]} */
    let head = [root.cid]
    const parents0 = head

    const event0 = await EventBlock.create(await seqEventData(), parents0)
    await blocks.put(event0.cid, event0.bytes)
    head = await advance(blocks, head, event0.cid)

    const event1 = await EventBlock.create(await seqEventData(), parents0)
    await blocks.put(event1.cid, event1.bytes)
    head = await advance(blocks, head, event1.cid)

    const event1head = head

    const event2 = await EventBlock.create(await seqEventData(), event1head)
    await blocks.put(event2.cid, event2.bytes)
    head = await advance(blocks, head, event2.cid)

    const event3 = await EventBlock.create(await seqEventData(), event1head)
    await blocks.put(event3.cid, event3.bytes)
    head = await advance(blocks, head, event3.cid)

    const event4 = await EventBlock.create(await seqEventData(), event1head)
    await blocks.put(event4.cid, event4.bytes)
    head = await advance(blocks, head, event4.cid)

    const parents2 = head

    const event5 = await EventBlock.create(await seqEventData(), parents2)
    await blocks.put(event5.cid, event5.bytes)
    head = await advance(blocks, head, event5.cid)

    // now very old one
    const event6 = await EventBlock.create(await seqEventData(), parents0)
    await blocks.put(event6.cid, event6.bytes)
    head = await advance(blocks, head, event6.cid)

    // for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 2)
    assert.equal(head[0].toString(), event5.cid.toString())
    assert.equal(head[1].toString(), event6.cid.toString())
  })

  it('add an event with missing parents', async () => {
    const blocks = new Blockstore()
    const root = await EventBlock.create(await seqEventData())
    await blocks.put(root.cid, root.bytes)

    /** @type {import('../clock').EventLink<any>[]} */
    let head = [root.cid]

    const event0 = await EventBlock.create(await seqEventData(), head)
    await blocks.put(event0.cid, event0.bytes)

    const event1 = await EventBlock.create(await seqEventData(), [event0.cid])
    await blocks.put(event1.cid, event1.bytes)

    head = await advance(blocks, head, event1.cid)

    // for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 1)
    assert.equal(head[0].toString(), event1.cid.toString())
  })
})
