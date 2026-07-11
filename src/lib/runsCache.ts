// Persist a player's full normalized run history + lifetime aggregate between
// launches, so startup renders instantly and only activities NEWER than the
// cache need refetching (instead of walking the entire all-time history).

import { idbGet, idbSet } from "./idb"
import type { ActivityRun } from "../stats/compute"
import type { AggregateHashStat } from "../bungie/types"

// Bump when ActivityRun's shape (or normalization rules) change — stale-shaped
// caches are discarded and rebuilt from a full fetch.
const VERSION = 1

type StoredRun = Omit<ActivityRun, "date"> & { date: string }

interface StoredCache {
    version: number
    savedAt: string
    runs: StoredRun[]
    aggregate: AggregateHashStat[]
}

export interface RunsCache {
    runs: ActivityRun[]
    aggregate: AggregateHashStat[]
}

const key = (membershipId: string) => `runs:${membershipId}`

export async function loadRunsCache(membershipId: string): Promise<RunsCache | null> {
    const stored = await idbGet<StoredCache>(key(membershipId))
    if (!stored || stored.version !== VERSION || !Array.isArray(stored.runs)) return null
    return {
        runs: stored.runs.map(r => ({ ...r, date: new Date(r.date) })),
        aggregate: Array.isArray(stored.aggregate) ? stored.aggregate : [],
    }
}

export function saveRunsCache(
    membershipId: string,
    runs: ActivityRun[],
    aggregate: AggregateHashStat[]
): Promise<void> {
    const stored: StoredCache = {
        version: VERSION,
        savedAt: new Date().toISOString(),
        runs: runs.map(r => ({ ...r, date: r.date.toISOString() })),
        aggregate,
    }
    return idbSet(key(membershipId), stored)
}
