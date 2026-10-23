let database: Promise<IDBDatabase> | undefined

export function openDatabase(): Promise<IDBDatabase> {
  if (database) return database
  const request = indexedDB.open('ai-on-the-clocktower', 1)
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>()
  database = promise
  request.onupgradeneeded = () => {
    const db = request.result
    db.createObjectStore('providers', { keyPath: 'id', autoIncrement: true })
    const presets = db.createObjectStore('presets', { keyPath: 'id', autoIncrement: true })
    presets.createIndex('providerId', 'providerId')
    db.createObjectStore('games', { keyPath: 'id' })
    db.createObjectStore('gameEvents', { keyPath: ['gameId', 'seq'] })
  }
  request.onsuccess = () => {
    const db = request.result
    db.onversionchange = () => {
      db.close()
      database = undefined
    }
    resolve(db)
  }
  request.onerror = () => {
    database = undefined
    reject(request.error)
  }
  return promise
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  request.onsuccess = () => {
    resolve(request.result)
  }
  request.onerror = () => {
    reject(request.error)
  }
  return promise
}

export async function inTransaction<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openDatabase()
  const transaction = db.transaction(stores, mode)
  const { promise: completed, resolve, reject } = Promise.withResolvers<undefined>()
  transaction.oncomplete = () => {
    resolve(undefined)
  }
  transaction.onabort = () => {
    reject(transaction.error ?? new Error('Transaction aborted'))
  }
  transaction.onerror = () => {
    reject(transaction.error)
  }
  const result = run(transaction).catch((error: unknown) => {
    try {
      transaction.abort()
    } catch {
      // A failed IndexedDB request may already have aborted the transaction.
    }
    throw error
  })
  return (await Promise.all([result, completed]))[0]
}
