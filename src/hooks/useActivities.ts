import { useCallback, useEffect, useRef, useState } from "react"
import { getActivityHistory, getAggregateActivityStats, getCharacters } from "../bungie/api"
import { ActivityMode, AggregateHashStat } from "../bungie/types"
import { ActivityRun } from "../stats/compute"
import { computeFreshFastest, computeFreshFlawless, FreshFastest, FreshFlawless } from "../stats/freshFastest"
import { normalizeRuns } from "../stats/normalize"

export interface SelectedPlayer {
    membershipId: string
    membershipType: number
    displayName: string
}

interface LoadState {
    runs: ActivityRun[]
    aggregate: AggregateHashStat[]
    /** Fastest fresh full-clear per groupKey; fills in progressively. */
    freshFastest: Map<string, FreshFastest>
    /** PGCR-verified flawless (fresh full clear, 0 deaths) per groupKey. */
    freshFlawless: Map<string, FreshFlawless>
    loading: boolean
    /** True while the PGCR-based fastest-full-clear pass is still running. */
    freshLoading: boolean
    error: string | null
}

const EMPTY: LoadState = {
    runs: [],
    aggregate: [],
    freshFastest: new Map(),
    freshFlawless: new Map(),
    loading: false,
    freshLoading: false,
    error: null
}

// Initial load pulls all-time (every instance, for lifetime counts + fastest).
const ALL_TIME = new Date(0)
// Background refresh only needs recent activity to catch new completions; it's
// merged into the all-time set so old data is preserved.
const REFRESH_MS = 60_000
const REFRESH_LOOKBACK_DAYS = 30

/** Fetch a player's full raid/dungeon history, lifetime aggregate, and (in a
 *  second pass) the fastest fresh full clear per activity — then keep it fresh
 *  with a light background refresh so new completions show without a restart. */
export function useActivities(player: SelectedPlayer | null): LoadState & { refresh: () => void } {
    const [state, setState] = useState<LoadState>(EMPTY)
    const reqId = useRef(0)
    const allRunsRef = useRef<ActivityRun[]>([])
    const charsRef = useRef<{ all: string[]; current: string[] } | null>(null)
    // Points at the current effect's refresh fn so the manual button can call it.
    const refreshRef = useRef<() => void>()
    const refresh = useCallback(() => refreshRef.current?.(), [])

    useEffect(() => {
        if (!player) {
            setState(EMPTY)
            allRunsRef.current = []
            charsRef.current = null
            return
        }

        const myReq = ++reqId.current
        allRunsRef.current = []
        charsRef.current = null
        setState({ ...EMPTY, loading: true })

        // Pull raid + dungeon history (since `notBefore`) plus the lifetime
        // aggregate, normalized. Characters are cached across refreshes.
        const fetchData = async (notBefore: Date) => {
            const characters =
                charsRef.current ??
                (await getCharacters(player.membershipType, player.membershipId))
            charsRef.current = characters

            const [historyResults, aggregate] = await Promise.all([
                Promise.all(
                    characters.all.flatMap(characterId =>
                        [ActivityMode.Raid, ActivityMode.Dungeon].map(async mode => ({
                            mode,
                            entries: await getActivityHistory(
                                player.membershipType,
                                player.membershipId,
                                characterId,
                                mode,
                                notBefore
                            )
                        }))
                    )
                ),
                getAggregateActivityStats(player.membershipType, player.membershipId, characters.all)
            ])

            const seen = new Set<string>()
            const newRuns: ActivityRun[] = []
            for (const { mode, entries } of historyResults) {
                const deduped = entries.filter(e => {
                    const id = e.activityDetails.instanceId
                    if (seen.has(id)) return false
                    seen.add(id)
                    return true
                })
                newRuns.push(...normalizeRuns(deduped, mode === ActivityMode.Raid))
            }
            return { newRuns, aggregate }
        }

        // Merge freshly-fetched runs into the accumulated all-time set (dedupe by
        // instance id), newest first. Returns whether anything new was added.
        const mergeRuns = (newRuns: ActivityRun[]) => {
            const known = new Set(allRunsRef.current.map(r => r.instanceId))
            const added = newRuns.some(r => !known.has(r.instanceId))
            const byId = new Map<string, ActivityRun>()
            for (const r of allRunsRef.current) byId.set(r.instanceId, r)
            for (const r of newRuns) byId.set(r.instanceId, r)
            allRunsRef.current = [...byId.values()].sort((a, b) => b.date.getTime() - a.date.getTime())
            return added
        }

        // PGCR-verify fastest fresh clears + flawless (cached lookups are instant).
        const runFreshPasses = async (runs: ActivityRun[]) => {
            const fresh = new Map<string, FreshFastest>()
            const flaw = new Map<string, FreshFlawless>()
            await Promise.all([
                computeFreshFastest(runs, (groupKey, result) => {
                    if (myReq !== reqId.current) return
                    fresh.set(groupKey, result)
                    setState(s => ({ ...s, freshFastest: new Map(fresh) }))
                }),
                computeFreshFlawless(runs, (groupKey, result) => {
                    if (myReq !== reqId.current) return
                    flaw.set(groupKey, result)
                    setState(s => ({ ...s, freshFlawless: new Map(flaw) }))
                })
            ])
            if (myReq !== reqId.current) return
            setState(s => ({ ...s, freshLoading: false }))
        }

        // Initial all-time load.
        ;(async () => {
            try {
                const { newRuns, aggregate } = await fetchData(ALL_TIME)
                if (myReq !== reqId.current) return
                mergeRuns(newRuns)
                setState({
                    runs: allRunsRef.current,
                    aggregate,
                    freshFastest: new Map(),
                    freshFlawless: new Map(),
                    loading: false,
                    freshLoading: true,
                    error: null
                })
                await runFreshPasses(allRunsRef.current)
            } catch (err) {
                if (myReq !== reqId.current) return
                setState({ ...EMPTY, error: err instanceof Error ? err.message : String(err) })
            }
        })()

        // Light background refresh: recent history + aggregate, merged in. Updates
        // counts immediately; only re-runs the fastest/flawless pass when a genuinely
        // new instance appears (so existing values don't flicker).
        const doRefresh = async () => {
            if (document.visibilityState === "hidden") return
            try {
                const notBefore = new Date(Date.now() - REFRESH_LOOKBACK_DAYS * 86_400_000)
                const { newRuns, aggregate } = await fetchData(notBefore)
                if (myReq !== reqId.current) return
                const added = mergeRuns(newRuns)
                setState(s => ({ ...s, runs: allRunsRef.current, aggregate }))
                if (added) runFreshPasses(allRunsRef.current)
            } catch {
                /* refresh failures are non-fatal — keep showing current data */
            }
        }
        refreshRef.current = doRefresh

        const interval = setInterval(doRefresh, REFRESH_MS)
        // Refresh as soon as the window regains focus (e.g. you tab back after a run).
        const onVisible = () => {
            if (document.visibilityState === "visible") doRefresh()
        }
        document.addEventListener("visibilitychange", onVisible)
        window.addEventListener("focus", doRefresh)

        return () => {
            clearInterval(interval)
            document.removeEventListener("visibilitychange", onVisible)
            window.removeEventListener("focus", doRefresh)
            reqId.current++
        }
    }, [player?.membershipId, player?.membershipType])

    return { ...state, refresh }
}
