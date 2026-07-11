// Minimal promise wrapper over IndexedDB, used for caches too large for
// localStorage (e.g. a veteran account's full run history). All failures are
// swallowed — a broken cache must never break the app, just slow it down.

const DB_NAME = "hub-cache"
const STORE = "kv"

let dbPromise: Promise<IDBDatabase> | null = null

function getDb(): Promise<IDBDatabase> {
    dbPromise ??= new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => {
            req.result.createObjectStore(STORE)
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
    return dbPromise
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
    try {
        const db = await getDb()
        return await new Promise<T | undefined>((resolve, reject) => {
            const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key)
            req.onsuccess = () => resolve(req.result as T | undefined)
            req.onerror = () => reject(req.error)
        })
    } catch {
        return undefined
    }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
    try {
        const db = await getDb()
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite")
            tx.objectStore(STORE).put(value, key)
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
        })
    } catch {
        /* cache write failures are non-fatal */
    }
}
