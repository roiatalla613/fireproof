import { describe, it, beforeEach } from 'mocha'
import assert from 'node:assert'
import Fireproof from '../src/fireproof.js'
import DbIndex from '../src/db-index.js'

let database

describe('IPLD encode error', () => {
  beforeEach(async () => {
    database = Fireproof.storage()
    defineIndexes(database)
  })

  it('reproduce', async () => {
    await loadFixtures(database)
    assert(true)
  })
})

const defineIndexes = (database) => {
  database.allLists = new DbIndex(database, function (doc, map) {
    if (doc.type === 'list') map(doc.type, doc)
  })
  database.todosByList = new DbIndex(database, function (doc, map) {
    if (doc.type === 'todo' && doc.listId) {
      map([doc.listId, doc.createdAt], doc)
    }
  })
  return database
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(1) // determinstic fixtures

async function loadFixtures(database) {
  const nextId = (prefix = '') => prefix + rand().toString(32).slice(2)
  const listTitles = ['Building Apps']
  const todoTitles = [['In the browser']]
  let ok
  for (let j = 0; j < 3; j++) {
    ok = await database.put({ title: listTitles[j], type: 'list', _id: nextId('' + j) })
    for (let i = 0; i < todoTitles[j].length; i++) {
      await database.put({
        _id: nextId(),
        title: todoTitles[j][i],
        listId: ok.id,
        completed: rand() > 0.75,
        type: 'todo',
        createdAt: '2' + i,
      })
    }
  }
  await reproduceBug(database)
}

const reproduceBug = async (database) => {
  const id = '02pkji8'
  const doc = await database.get(id)
  // (await database.put({ completed: !completed, ...doc }))
  const ok = await database.put(doc)
  await database.todosByList.query()

  console.log('ok', ok)
}
