import { describe, it, beforeEach } from 'mocha'
import assert from 'node:assert'
import { Fireproof } from '../src/fireproof.js'
import { DbIndex } from '../src/db-index.js'
// import { Valet } from '../src/valet.js'
import { resetTestDataDir } from './helpers.js'

describe('Hydrator', () => {
  let database, index
  beforeEach(async () => {
    database = Fireproof.storage()
    const docs = [
      { _id: 'a1s3b32a-3c3a-4b5e-9c1c-8c5c0c5c0c5c', name: 'alice', age: 40 },
      { _id: 'b2s3b32a-3c3a-4b5e-9c1c-8c5c0c5c0c5c', name: 'bob', age: 40 },
      { _id: 'c3s3b32a-3c3a-4b5e-9c1c-8c5c0c5c0c5c', name: 'carol', age: 43 },
      { _id: 'd4s3b32a-3c3a-4b5e-9c1c-8c5c0c5c0c5c', name: 'dave', age: 48 },
      { _id: 'e4s3b32a-3c3a-4b5e-9c1c-8c5c0c5c0c5c', name: 'emily', age: 4 },
      { _id: 'f4s3b32a-3c3a-4b5e-9c1c-8c5c0c5c0c5c', name: 'frank', age: 7 }
    ]
    for (const doc of docs) {
      const id = doc._id
      const response = await database.put(doc)
      assert(response)
      assert(response.id, 'should have id')
      assert.equal(response.id, id)
    }
    index = new DbIndex(database, 'names_by_age', function (doc, map) {
      map(doc.age, doc.name)
    })
  })
  it('serialize database with index', async () => {
    await database.put({ _id: 'rehy', name: 'drate', age: 1 })
    assert.equal((await database.changesSince()).rows.length, 7)
    const result = await index.query({ range: [0, 54] })
    assert.equal(result.rows[0].value, 'drate')
    const serialized = database.toJSON()
    // console.log('serialized', serialized)
    assert.equal(serialized.name, undefined)
    assert.equal(serialized.key, null)
    assert.equal(serialized.clock.length, 1)
    assert.equal(serialized.clock[0].constructor.name, 'String')
    assert.equal(serialized.indexes.length, 1)
    assert.equal(serialized.indexes[0].code, `function (doc, map) {
      map(doc.age, doc.name)
    }`)
    assert.equal(serialized.indexes[0].name, 'names_by_age')

    assert.equal(serialized.indexes[0].clock.byId.constructor.name, 'String')
    assert.equal(serialized.indexes[0].clock.byKey.constructor.name, 'String')
    assert.equal(serialized.indexes[0].clock.db[0].constructor.name, 'String')
  })
  it('rehydrate database', async () => {
    await database.put({ _id: 'rehy', name: 'drate', age: 1 })
    assert.equal((await database.changesSince()).rows.length, 7)
    const result = await index.query({ range: [0, 54] })
    assert.equal(result.rows[0].value, 'drate')

    const serialized = JSON.parse(JSON.stringify(database))
    // console.log('serialized', JSON.stringify(serialized))
    // connect it to the same blockstore for testing
    const newDb = Fireproof.fromJSON(serialized, null, database)
    assert.equal(newDb.name, undefined)
    assert.equal(newDb.clock.length, 1)
    assert.equal((await newDb.changesSince()).rows.length, 7)
    const newIndex = [...newDb.indexes.values()][0]
    assert.equal(newIndex.mapFn, `function (doc, map) {
      map(doc.age, doc.name)
    }`)
    assert.match(newIndex.indexById.cid.toString(), /bafyr/)
    // assert.equal(newIndex.indexById.root, null)
    assert.match(newIndex.indexByKey.cid.toString(), /bafyr/)
    // assert.equal(newIndex.indexByKey.root, null)

    assert.equal(newIndex.name, 'names_by_age')

    const newResult = await newIndex.query({ range: [0, 54] })
    assert.equal(newResult.rows[0].value, 'drate')
  })
  it('rehydrate with validation function')
})

describe('hydrator query with dbname', () => {
  let database, index
  beforeEach(async () => {
    resetTestDataDir()

    database = Fireproof.storage('fptest-ix-name')
    const docs = [
      { _id: 'a1s3b32a-3c3a-4b5e-9c1c-8c5c0c5c0c5c', name: 'alice', age: 40 },
      { _id: 'b2s3b32a-3c3a-4b5e-9c1c-8c5c0c5c0c5c', name: 'bob', age: 40 },
      { _id: 'c3s3b32a-3c3a-4b5e-9c1c-8c5c0c5c0c5c', name: 'carol', age: 43 },
      { _id: 'd4s3b32a-3c3a-4b5e-9c1c-8c5c0c5c0c5c', name: 'dave', age: 48 },
      { _id: 'e4s3b32a-3c3a-4b5e-9c1c-8c5c0c5c0c5c', name: 'emily', age: 4 },
      { _id: 'f4s3b32a-3c3a-4b5e-9c1c-8c5c0c5c0c5c', name: 'frank', age: 7 }
    ]
    for (const doc of docs) {
      const id = doc._id
      const response = await database.put(doc)
      assert(response)
      assert(response.id, 'should have id')
      assert.equal(response.id, id)
    }
    index = new DbIndex(database, 'names_by_age', function (doc, map) {
      map(doc.age, doc.name)
    }, null)
  })
  it('serialize database with index and name', async () => {
    await database.put({ _id: 'rehy', name: 'drate', age: 1 })
    assert.equal((await database.changesSince()).rows.length, 7)
    const result = await index.query({ range: [0, 54] })
    assert.equal(result.rows[0].value, 'drate')
    const serialized = database.toJSON()
    // console.log('serialized', serialized)
    assert.equal(serialized.name, 'fptest-ix-name')
    // if (database.blocks.valet.keyId !== 'null') {
    //   assert.equal(serialized.key.length, 64)
    // }
    assert.equal(serialized.clock.length, 1)
    assert.equal(serialized.clock[0].constructor.name, 'String')
    assert.equal(serialized.indexes.length, 1)
    assert.equal(serialized.indexes[0].code, `function (doc, map) {
      map(doc.age, doc.name)
    }`)
    assert.equal(serialized.indexes[0].name, 'names_by_age')

    assert.equal(serialized.indexes[0].clock.byId.constructor.name, 'String')
    assert.equal(serialized.indexes[0].clock.byKey.constructor.name, 'String')
    assert.equal(serialized.indexes[0].clock.db[0].constructor.name, 'String')
  })
  it('rehydrate database twoo', async () => {
    await database.put({ _id: 'rehy', name: 'drate', age: 1 })
    assert.equal((await database.changesSince()).rows.length, 7)
    const result = await index.query({ range: [0, 54] })
    assert.equal(result.rows[0].value, 'drate')

    const serialized = JSON.parse(JSON.stringify(database))
    // console.log('serialized', JSON.stringify(serialized))
    // connect it to the same blockstore for testing
    const newDb = Fireproof.fromJSON(serialized, null, database)
    assert.equal(newDb.name, 'fptest-ix-name')
    assert.equal(newDb.clock.length, 1)
    assert.equal((await newDb.changesSince()).rows.length, 7)
    const newIndex = [...newDb.indexes.values()][0]
    assert.equal(newIndex.mapFn, `function (doc, map) {
      map(doc.age, doc.name)
    }`)
    assert.match(newIndex.indexById.cid.toString(), /bafyr/)
    // assert.equal(newIndex.indexById.root, null)
    assert.match(newIndex.indexByKey.cid.toString(), /bafyr/)

    // assert.equal(newIndex.indexByKey.root, null)

    assert.equal(newIndex.name, 'names_by_age')

    const newResult = await newIndex.query({ range: [0, 54] })
    assert.equal(newResult.rows[0].value, 'drate')
  })
})
