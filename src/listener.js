/**
 * A Fireproof database Listener allows you to react to events in the database.
 *
 * @class
 * @classdesc An listener can be notified of events as they happen or on reconection
 *
 * @param {import('./fireproof').Fireproof} database - The Fireproof database instance to index.
 * @param {Function} eventFun - The map function to apply to each entry in the database.
 *
 */
export default class Listener {
  #subcribers = new Map()

  // todo code review if there is a better way that doesn't create a circular reference
  // because otherwise we need to document that the user must call stopListening
  // or else the listener will never be garbage collected
  // maybe we can use WeakRef on the db side
  // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/WeakRef
  #doStopListening = null

  /**
   * Creates a new index with the given map function and database.
   * @param {import('./fireproof').Fireproof} database - The Fireproof database instance to index.
   * @param {Function} eventFun - The event function to apply to each current change to the database.
   */
  constructor (database, eventFun) {
    /** eventFun
     * The database instance to index.
     * @type {import('./fireproof').Fireproof}
     */
    this.database = database
    this.#doStopListening = database.registerListener((changes) => this.#onChanges(changes))
    /**
     * The map function to apply to each entry in the database.
     * @type {Function}
     */
    this.eventFun = eventFun || function (_, emit) { emit('*') }
    this.dbHead = null
  }

  /**
   * Subscribe to a topic emitted by the event function.
   * @param {string} topic - The topic to subscribe to.
   * @param {Function} subscriber - The function to call when the topic is emitted.
   * @returns {Function} A function to unsubscribe from the topic.
   */
  on (topic, subscriber, since) {
    const listOfTopicSubscribers = getTopicList(this.#subcribers, topic)
    listOfTopicSubscribers.push(subscriber)
    if (typeof since !== 'undefined') {
      this.database.changesSince(since).then(({ rows: changes }) => {
        const keys = topicsForChanges(changes, this.eventFun).get(topic)
        if (keys) keys.forEach((key) => subscriber(key))
      })
    }
    return () => {
      const index = listOfTopicSubscribers.indexOf(subscriber)
      if (index > -1) listOfTopicSubscribers.splice(index, 1)
    }
  }

  #onChanges (changes) {
    if (Array.isArray(changes)) {
      const seenTopics = topicsForChanges(changes, this.eventFun)
      for (const [topic, keys] of seenTopics) {
        const listOfTopicSubscribers = getTopicList(this.#subcribers, topic)
        listOfTopicSubscribers.forEach((subscriber) => keys.forEach((key) => subscriber(key)))
      }
    } else {
      // reset event
      if (changes.reset) {
        for (const [, listOfTopicSubscribers] of this.#subcribers) {
          listOfTopicSubscribers.forEach((subscriber) => subscriber(changes))
        }
      }
    }
    // if changes is special, notify all listeners?
    // first make the example app use listeners
  }
}

function getTopicList (subscribersMap, name) {
  let topicList = subscribersMap.get(name)
  if (!topicList) {
    topicList = []
    subscribersMap.set(name, topicList)
  }
  return topicList
}

// copied from src/db-index.js
const makeDoc = ({ key, value }) => ({ _id: key, ...value })

/**
 * Transforms a set of changes to events using an emitter function.
 *
 * @param {Array<{ key: string, value: import('./link').AnyLink, del?: boolean }>} changes
 * @param {Function} eventFun
 * @returns {Array<string>} The topics emmitted by the event function.
 */
const topicsForChanges = (changes, eventFun) => {
  const seenTopics = new Map()
  changes.forEach(({ key, value, del }) => {
    if (del || !value) value = { _deleted: true }
    eventFun(makeDoc({ key, value }), (t) => {
      const topicList = getTopicList(seenTopics, t)
      topicList.push(key)
    })
  })
  return seenTopics
}
