// Compute the fastest *fresh full clear* per activity (raid.report parity).
//
// Bungie's aggregate "fastest" includes checkpoint runs. To find the real
// fastest full clear we sort an activity's completed runs cheapest-first and
// PGCR-check each (`activityWasStartedFromBeginning`) until we hit a fresh
// one. PGCRs are cached in localStorage so this is only slow on the first
// load for each player.
//
// Very old PGCRs (pre-Shadowkeep) lack the freshness field entirely. When
// every checked PGCR returns null we flag `pgcrUnavailable` so the caller
// can fall back to the aggregate fastest (which is reliable for old content
// that was never checkpoint-farmed).

import { flushFlawlessCache, flushPgcrCache, getPgcrFlawless, getPgcrFresh } from "../bungie/api"
import { ActivityRun } from "./compute"

export interface FreshFastest {
    overallSeconds: number | null
    overallInstanceId: string | null
    /** Count of PGCR-verified fresh full clears among the checked (tracked) runs. */
    fullClears: number
    versions: Map<string, number | null>
    versionInstanceIds: Map<string, string | null>
    /** True when PGCRs for this activity lack the freshness field entirely. */
    pgcrUnavailable: boolean
    /** Fastest run above 33% of average duration (filters out checkpoints by length). */
    durationFallbackSeconds: number | null
    durationFallbackInstanceId: string | null
    durationFallbackVersions: Map<string, number | null>
    durationFallbackVersionInstanceIds: Map<string, string | null>
}

const MAX_CHECKS_PER_GROUP = 400
const CONCURRENCY = 14

/** Minimal promise-concurrency limiter. */
function createLimiter(max: number) {
    let active = 0
    const queue: (() => void)[] = []
    const pump = () => {
        if (active >= max || queue.length === 0) return
        active++
        queue.shift()!()
    }
    return <T>(fn: () => Promise<T>): Promise<T> =>
        new Promise<T>((resolve, reject) => {
            queue.push(() =>
                fn()
                    .then(resolve, reject)
                    .finally(() => {
                        active--
                        pump()
                    })
            )
            pump()
        })
}

/**
 * @param onGroup called as each activity's fastest-fresh is resolved, so the UI
 * can fill cards in progressively.
 */
export async function computeFreshFastest(
    runs: ActivityRun[],
    onGroup?: (groupKey: string, result: FreshFastest) => void
): Promise<Map<string, FreshFastest>> {
    const limit = createLimiter(CONCURRENCY)
    const result = new Map<string, FreshFastest>()

    const byGroup = new Map<string, ActivityRun[]>()
    for (const run of runs) {
        if (!run.completed || run.durationSeconds <= 0) continue
        const list = byGroup.get(run.groupKey)
        if (list) list.push(run)
        else byGroup.set(run.groupKey, [run])
    }

    await Promise.all(
        [...byGroup.entries()].map(async ([groupKey, clears]) => {
            clears.sort((a, b) => a.durationSeconds - b.durationSeconds)
            const versionsPresent = new Set(clears.map(c => c.versionName))
            const versions = new Map<string, number | null>()
            const versionIds = new Map<string, string | null>()
            let overall: number | null = null
            let overallId: string | null = null
            let anyBooleanResult = false
            let freshCount = 0

            // Duration-based fallback: fastest run above 33% of average
            // (filters checkpoint clears which are much shorter than full runs)
            const avgDur = clears.reduce((s, c) => s + c.durationSeconds, 0) / clears.length
            const threshold = avgDur * 0.33
            const aboveThreshold = clears.filter(c => c.durationSeconds >= threshold)
            const durFallback = aboveThreshold.length > 0 ? aboveThreshold[0].durationSeconds : null
            const durFallbackId = aboveThreshold.length > 0 ? aboveThreshold[0].instanceId : null
            const durFallbackVersions = new Map<string, number | null>()
            const durFallbackVersionIds = new Map<string, string | null>()
            for (const v of versionsPresent) {
                const vRun = aboveThreshold.find(c => c.versionName === v)
                durFallbackVersions.set(v, vRun?.durationSeconds ?? null)
                durFallbackVersionIds.set(v, vRun?.instanceId ?? null)
            }

            const emit = () => {
                const r: FreshFastest = {
                    overallSeconds: overall,
                    overallInstanceId: overallId,
                    fullClears: freshCount,
                    versions: new Map(versions),
                    versionInstanceIds: new Map(versionIds),
                    pgcrUnavailable: !anyBooleanResult,
                    durationFallbackSeconds: durFallback,
                    durationFallbackInstanceId: durFallbackId,
                    durationFallbackVersions: durFallbackVersions,
                    durationFallbackVersionInstanceIds: durFallbackVersionIds
                }
                result.set(groupKey, r)
                onGroup?.(groupKey, r)
            }

            // Check every completed run (cheapest-first): the FIRST fresh one is
            // the fastest fresh clear, and we tally all of them for the full-clear
            // count. (No early-break now that we need the total — bounded by
            // MAX_CHECKS_PER_GROUP and cached in localStorage after the first pass.)
            for (let i = 0; i < clears.length && i < MAX_CHECKS_PER_GROUP; i++) {
                const run = clears[i]
                const fresh = await limit(() => getPgcrFresh(run.instanceId))
                if (fresh !== null) anyBooleanResult = true
                if (fresh !== true) continue

                freshCount++
                let changed = true // freshCount changed → refresh the card's count
                if (overall === null) {
                    overall = run.durationSeconds
                    overallId = run.instanceId
                }
                if (!versions.has(run.versionName)) {
                    versions.set(run.versionName, run.durationSeconds)
                    versionIds.set(run.versionName, run.instanceId)
                }
                if (changed) emit()
            }

            for (const v of versionsPresent) {
                if (!versions.has(v)) { versions.set(v, null); versionIds.set(v, null) }
            }
            emit()
        })
    )

    flushPgcrCache()
    return result
}

// ---------------------------------------------------------------------------
// Flawless (fresh full clear, zero deaths) per activity
// ---------------------------------------------------------------------------

export interface FreshFlawless {
    /** Lowest player count (1–3) of a PGCR-verified fresh full clear with 0 deaths. */
    lowmanFlawless: number | null
    /** Any fresh full clear with 0 deaths and a full team (4+). */
    fullTeamFlawless: boolean
}

const MAX_FLAWLESS_CHECKS = 200

/**
 * A clear only counts as flawless if it's a *fresh full clear* (not a checkpoint).
 * Bungie's history flags 0 deaths, but a checkpoint run with no deaths isn't a
 * flawless — so PGCR-verify each zero-death candidate. Cheapest first by player
 * count so the lowest lowman flawless surfaces immediately.
 */
export async function computeFreshFlawless(
    runs: ActivityRun[],
    onGroup?: (groupKey: string, result: FreshFlawless) => void
): Promise<Map<string, FreshFlawless>> {
    const limit = createLimiter(CONCURRENCY)
    const result = new Map<string, FreshFlawless>()

    const byGroup = new Map<string, ActivityRun[]>()
    for (const run of runs) {
        if (!run.completed || run.deaths !== 0 || run.playerCount < 1 || run.durationSeconds <= 0) continue
        const list = byGroup.get(run.groupKey)
        if (list) list.push(run)
        else byGroup.set(run.groupKey, [run])
    }

    await Promise.all(
        [...byGroup.entries()].map(async ([groupKey, cands]) => {
            cands.sort((a, b) => a.playerCount - b.playerCount)
            let lowmanFlawless: number | null = null
            let fullTeamFlawless = false
            let checks = 0

            const emit = () => {
                const r: FreshFlawless = { lowmanFlawless, fullTeamFlawless }
                result.set(groupKey, r)
                onGroup?.(groupKey, r)
            }
            emit() // clear any stale flawless on the card while we verify

            let i = 0
            // Lowman region (1–3): ascending, so the first flawless is the best tier.
            for (; i < cands.length && cands[i].playerCount <= 3 && checks < MAX_FLAWLESS_CHECKS; i++) {
                checks++
                if ((await limit(() => getPgcrFlawless(cands[i].instanceId))) === true) {
                    lowmanFlawless = cands[i].playerCount
                    emit()
                    break
                }
            }
            while (i < cands.length && cands[i].playerCount <= 3) i++ // skip rest of lowman region
            // Full-team region (4+): any fresh, whole-team-flawless clear qualifies.
            for (; i < cands.length && checks < MAX_FLAWLESS_CHECKS; i++) {
                checks++
                if ((await limit(() => getPgcrFlawless(cands[i].instanceId))) === true) {
                    fullTeamFlawless = true
                    emit()
                    break
                }
            }
            emit()
        })
    )

    flushFlawlessCache()
    return result
}
