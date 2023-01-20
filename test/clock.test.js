import { describe, it } from 'mocha'
import assert from 'node:assert'
import { advance, EventBlock, vis } from '../clock.js'
import { Blockstore, randomCID } from './helpers.js'

describe('clock', () => {
  it('create a new clock', async () => {
    const blocks = new Blockstore()
    const dataCID = await randomCID(32)
    const event = await EventBlock.create(dataCID)

    await blocks.put(event.cid, event.bytes)
    const head = await advance(blocks, [], event.cid)

    for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 1)
    assert.equal(head[0].toString(), event.cid.toString())
  })

  it('add an event', async () => {
    const blocks = new Blockstore()
    const root = await EventBlock.create(await randomCID(32))
    await blocks.put(root.cid, root.bytes)

    /** @type {import('../clock').EventLink<any>[]} */
    let head = [root.cid]

    const event = await EventBlock.create(await randomCID(32), head)
    await blocks.put(event.cid, event.bytes)

    head = await advance(blocks, head, event.cid)

    for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 1)
    assert.equal(head[0].toString(), event.cid.toString())
  })

  it('add two events with shared parents', async () => {
    const blocks = new Blockstore()
    const root = await EventBlock.create(await randomCID(32))
    await blocks.put(root.cid, root.bytes)

    /** @type {import('../clock').EventLink<any>[]} */
    let head = [root.cid]
    const parents = head

    const event0 = await EventBlock.create(await randomCID(32), parents)
    await blocks.put(event0.cid, event0.bytes)
    head = await advance(blocks, parents, event0.cid)

    const event1 = await EventBlock.create(await randomCID(32), parents)
    await blocks.put(event1.cid, event1.bytes)
    head = await advance(blocks, head, event1.cid)

    for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 2)
    assert.equal(head[0].toString(), event0.cid.toString())
    assert.equal(head[1].toString(), event1.cid.toString())
  })

  it('add two events with some shared parents', async () => {
    const blocks = new Blockstore()
    const root = await EventBlock.create(await randomCID(32))
    await blocks.put(root.cid, root.bytes)

    /** @type {import('../clock').EventLink<any>[]} */
    let head = [root.cid]
    const parents0 = head

    const event0 = await EventBlock.create(await randomCID(32), parents0)
    await blocks.put(event0.cid, event0.bytes)
    head = await advance(blocks, head, event0.cid)

    const event1 = await EventBlock.create(await randomCID(32), parents0)
    await blocks.put(event1.cid, event1.bytes)
    head = await advance(blocks, head, event1.cid)

    const event2 = await EventBlock.create(await randomCID(32), parents0)
    await blocks.put(event2.cid, event2.bytes)
    head = await advance(blocks, head, event2.cid)

    const event3 = await EventBlock.create(await randomCID(32), [event0.cid, event1.cid])
    await blocks.put(event3.cid, event3.bytes)
    head = await advance(blocks, head, event3.cid)

    const event4 = await EventBlock.create(await randomCID(32), [event2.cid])
    await blocks.put(event4.cid, event4.bytes)
    head = await advance(blocks, head, event4.cid)

    for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 2)
    assert.equal(head[0].toString(), event3.cid.toString())
    assert.equal(head[1].toString(), event4.cid.toString())
  })

  it('converge when multi-root', async () => {
    const blocks = new Blockstore()
    const root = await EventBlock.create(await randomCID(32))
    await blocks.put(root.cid, root.bytes)

    /** @type {import('../clock').EventLink<any>[]} */
    let head = [root.cid]
    const parents0 = head

    const event0 = await EventBlock.create(await randomCID(32), parents0)
    await blocks.put(event0.cid, event0.bytes)
    head = await advance(blocks, head, event0.cid)

    const event1 = await EventBlock.create(await randomCID(32), parents0)
    await blocks.put(event1.cid, event1.bytes)
    head = await advance(blocks, head, event1.cid)

    const parents1 = head

    const event2 = await EventBlock.create(await randomCID(32), parents1)
    await blocks.put(event2.cid, event2.bytes)
    head = await advance(blocks, head, event2.cid)

    const event3 = await EventBlock.create(await randomCID(32), parents1)
    await blocks.put(event3.cid, event3.bytes)
    head = await advance(blocks, head, event3.cid)

    const event4 = await EventBlock.create(await randomCID(32), parents1)
    await blocks.put(event4.cid, event4.bytes)
    head = await advance(blocks, head, event4.cid)

    const parents2 = head

    const event5 = await EventBlock.create(await randomCID(32), parents2)
    await blocks.put(event5.cid, event5.bytes)
    head = await advance(blocks, head, event5.cid)

    for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 1)
    assert.equal(head[0].toString(), event5.cid.toString())
  })

  it('add an old event', async () => {
    const blocks = new Blockstore()
    const root = await EventBlock.create(await randomCID(32))
    await blocks.put(root.cid, root.bytes)

    /** @type {import('../clock').EventLink<any>[]} */
    let head = [root.cid]
    const parents0 = head

    const event0 = await EventBlock.create(await randomCID(32), parents0)
    await blocks.put(event0.cid, event0.bytes)
    head = await advance(blocks, head, event0.cid)

    const event1 = await EventBlock.create(await randomCID(32), parents0)
    await blocks.put(event1.cid, event1.bytes)
    head = await advance(blocks, head, event1.cid)

    const parents1 = head

    const event2 = await EventBlock.create(await randomCID(32), parents1)
    await blocks.put(event2.cid, event2.bytes)
    head = await advance(blocks, head, event2.cid)

    const event3 = await EventBlock.create(await randomCID(32), parents1)
    await blocks.put(event3.cid, event3.bytes)
    head = await advance(blocks, head, event3.cid)

    const event4 = await EventBlock.create(await randomCID(32), parents1)
    await blocks.put(event4.cid, event4.bytes)
    head = await advance(blocks, head, event4.cid)

    const parents2 = head

    const event5 = await EventBlock.create(await randomCID(32), parents2)
    await blocks.put(event5.cid, event5.bytes)
    head = await advance(blocks, head, event5.cid)

    // now very old one
    const event6 = await EventBlock.create(await randomCID(32), parents0)
    await blocks.put(event6.cid, event6.bytes)
    head = await advance(blocks, head, event6.cid)

    for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 2)
    assert.equal(head[0].toString(), event5.cid.toString())
    assert.equal(head[1].toString(), event6.cid.toString())
  })

  it('add an event with missing parents', async () => {
    const blocks = new Blockstore()
    const root = await EventBlock.create(await randomCID(32))
    await blocks.put(root.cid, root.bytes)

    /** @type {import('../clock').EventLink<any>[]} */
    let head = [root.cid]

    const event0 = await EventBlock.create(await randomCID(32), head)
    await blocks.put(event0.cid, event0.bytes)

    const event1 = await EventBlock.create(await randomCID(32), [event0.cid])
    await blocks.put(event1.cid, event1.bytes)

    head = await advance(blocks, head, event1.cid)

    for await (const line of vis(blocks, head)) console.log(line)
    assert.equal(head.length, 1)
    assert.equal(head[0].toString(), event1.cid.toString())
  })
})
