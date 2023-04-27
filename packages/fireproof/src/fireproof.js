import randomBytes from 'randombytes'
import { Database, parseCID } from './database.js'
import { Listener } from './listener.js'
import { DbIndex as Index } from './db-index.js'
import { TransactionBlockstore } from './blockstore.js'
import { localGet } from './utils.js'
import { Sync } from './sync.js'

export { Index, Listener, Database, Sync }

export class Fireproof {
  /**
   * @function storage
   * @memberof Fireproof
   * Creates a new Fireproof instance with default storage settings
   * Most apps should use this and not worry about the details.
   * @static
   * @returns {Database} - a new Fireproof instance
   */
  static storage = (name = null, opts = {}) => {
    if (name) {
      opts.name = name
      const existing = localGet('fp.' + name)
      if (existing) {
        const existingConfig = JSON.parse(existing)
        const fp = new Database(new TransactionBlockstore(name, existingConfig.key), [], opts)
        return this.fromJSON(existingConfig, fp)
      } else {
        const instanceKey = randomBytes(32).toString('hex') // pass null to disable encryption
        return new Database(new TransactionBlockstore(name, instanceKey), [], opts)
      }
    } else {
      return new Database(new TransactionBlockstore(), [], opts)
    }
  }

  static fromJSON (json, database) {
    database.hydrate({ clock: json.clock.map(c => parseCID(c)), name: json.name, key: json.key })
    if (json.indexes) {
      for (const {
        name,
        code,
        clock: { byId, byKey, db }
      } of json.indexes) {
        Index.fromJSON(database, {
          clock: {
            byId: byId ? parseCID(byId) : null,
            byKey: byKey ? parseCID(byKey) : null,
            db: (db && db.length > 0) ? db.map(c => parseCID(c)) : null
          },
          code,
          name
        })
      }
    }
    return database
  }

  static snapshot (database, clock) {
    const definition = database.toJSON()
    const withBlocks = new Database(database.blocks)
    if (clock) {
      definition.clock = clock.map(c => parseCID(c))
      definition.indexes.forEach(index => {
        index.clock.byId = null
        index.clock.byKey = null
        index.clock.db = null
      })
    }
    const snappedDb = this.fromJSON(definition, withBlocks)
    ;[...database.indexes.values()].forEach(index => {
      snappedDb.indexes.get(index.mapFnString).mapFn = index.mapFn
    })
    return snappedDb
  }

  static async zoom (database, clock) {
    ;[...database.indexes.values()].forEach(index => {
      index.indexById = { root: null, cid: null }
      index.indexByKey = { root: null, cid: null }
      index.dbHead = null
    })
    database.clock = clock.map(c => parseCID(c))
    await database.notifyReset() // hmm... indexes should listen to this? might be more complex than worth it. so far this is the only caller
    return database
  }
}
