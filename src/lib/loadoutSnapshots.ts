// Loadout snapshots — capture what the tracked player had equipped when an
// activity started, so a PGCR can later show "what was I running?". Ported
// from Yute's D2CharacterTracker.LoadoutSnapshot: snapshots are keyed by the
// activity START time (the live endpoints expose no instance id — only the
// PGCR does, after the fact) and matched within a few minutes.

export interface LoadoutSnapshot {
    /** ISO time the activity started (Bungie dateActivityStarted). */
    startedAt: string
    membershipId: string
    characterClass: string
    itemHashes: number[]
}

const KEY = "loadout-snapshots"
const MAX_SNAPSHOTS = 300
/** Max distance between snapshot start and PGCR period to count as a match. */
const MATCH_WINDOW_MS = 6 * 60 * 1000

function load(): LoadoutSnapshot[] {
    try {
        const raw = localStorage.getItem(KEY)
        if (!raw) return []
        const list = JSON.parse(raw)
        return Array.isArray(list) ? list : []
    } catch {
        return []
    }
}

function save(list: LoadoutSnapshot[]) {
    try {
        const trimmed = [...list]
            .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
            .slice(0, MAX_SNAPSHOTS)
        localStorage.setItem(KEY, JSON.stringify(trimmed))
    } catch { /* storage full/unavailable — snapshots are best-effort */ }
}

/** Record a snapshot once per activity start (repeat calls are ignored). */
export function captureSnapshot(snap: LoadoutSnapshot) {
    if (!snap.startedAt || snap.itemHashes.length === 0) return
    const list = load()
    if (list.some(s => s.startedAt === snap.startedAt && s.membershipId === snap.membershipId)) return
    list.push(snap)
    save(list)
}

/** The snapshot captured closest to (and within a few minutes of) the given
 *  activity period, or null if the app wasn't running when it started. */
export function findSnapshot(periodIso: string): LoadoutSnapshot | null {
    const t = new Date(periodIso).getTime()
    if (!Number.isFinite(t)) return null
    let best: LoadoutSnapshot | null = null
    let bestDiff = MATCH_WINDOW_MS
    for (const s of load()) {
        const diff = Math.abs(new Date(s.startedAt).getTime() - t)
        if (diff < bestDiff) {
            bestDiff = diff
            best = s
        }
    }
    return best
}
