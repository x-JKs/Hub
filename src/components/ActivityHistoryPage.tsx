import { useEffect, useState } from "react"
import { getActivityHistory, getCharacters } from "../bungie/api"
import type { ActivityHistoryEntry } from "../bungie/types"
import { resolveActivityInfo, type ActivityInfo } from "../bungie/manifest"
import { raidByHash, raidSplashUrl } from "../manifest/raids"
import { dungeonByHash } from "../manifest/dungeons"
import { formatAvgDuration } from "../stats/format"
import { getWeeklyReset } from "../stats/period"
import type { SelectedPlayer } from "../hooks/useActivities"
import { PgcrOverlay } from "./PgcrOverlay"

const PAGE = 20

const num = (e: ActivityHistoryEntry, k: string) => e.values[k]?.basic.value ?? 0

function isCompleted(e: ActivityHistoryEntry): boolean {
    const done = num(e, "completed") === 1
    const reason = e.values.completionReason?.basic.value
    return done && (reason === undefined || reason === 0)
}

// Curated raid/dungeon name + splash art (nicer than the generic manifest image).
function quickInfo(hash: number): ActivityInfo | null {
    const raid = raidByHash(hash)
    if (raid) return { name: raid.name, image: raidSplashUrl(raid.splashSlug) }
    const dungeon = dungeonByHash(hash)
    if (dungeon) return { name: dungeon.name, image: dungeon.splashUrl }
    return null
}

// Cache the whole weekly fetch per player so reopening the tab is instant (and we
// refresh silently in the background rather than showing a spinner every time).
type CacheEntry = { reset: number; entries: ActivityHistoryEntry[]; infos: Map<number, ActivityInfo> }
const historyCache = new Map<string, CacheEntry>()

/**
 * All of the player's activities since the last weekly reset (Tue 17:00 UTC),
 * newest first, 20 at a time with Load more. Re-scopes to the new week on reset.
 */
export function ActivityHistoryPage({ player }: { player: SelectedPlayer }) {
    const [entries, setEntries] = useState<ActivityHistoryEntry[]>([])
    const [infos, setInfos] = useState<Map<number, ActivityInfo>>(new Map())
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [shown, setShown] = useState(PAGE)
    const [pgcr, setPgcr] = useState<{ instanceId: string; name: string } | null>(null)

    useEffect(() => {
        let cancelled = false
        const reset = getWeeklyReset()
        const cached = historyCache.get(player.membershipId)
        const hasCache = !!cached && cached.reset === reset.getTime()

        if (hasCache) {
            // Show cached data instantly; refresh silently below (no spinner).
            setEntries(cached!.entries)
            setInfos(new Map(cached!.infos))
            setLoading(false)
            setError(null)
        } else {
            setLoading(true)
            setError(null)
            setEntries([])
        }

        ;(async () => {
            try {
                const chars = await getCharacters(player.membershipType, player.membershipId)
                const pages = await Promise.all(
                    chars.current.map(cid =>
                        getActivityHistory(player.membershipType, player.membershipId, cid, 0, reset)
                    )
                )
                if (cancelled) return

                const seen = new Set<string>()
                const merged: ActivityHistoryEntry[] = []
                for (const list of pages) {
                    for (const e of list) {
                        if (new Date(e.period) < reset) continue
                        const id = e.activityDetails.instanceId
                        if (seen.has(id)) continue
                        seen.add(id)
                        merged.push(e)
                    }
                }
                merged.sort((a, b) => new Date(b.period).getTime() - new Date(a.period).getTime())
                setEntries(merged)
                setLoading(false)

                // Resolve name + banner art — curated raid/dungeon tables first,
                // then the live manifest for everything else. Fill in progressively.
                const distinct = [...new Set(merged.map(e => e.activityDetails.referenceId))]
                const map = new Map<number, ActivityInfo>()
                for (const hash of distinct) {
                    const q = quickInfo(hash)
                    if (q) map.set(hash, q)
                }
                setInfos(new Map(map))
                historyCache.set(player.membershipId, { reset: reset.getTime(), entries: merged, infos: map })

                for (const hash of distinct) {
                    if (map.has(hash)) continue
                    const info = await resolveActivityInfo(hash)
                    if (cancelled) return
                    map.set(hash, { name: info.name || "Unknown Activity", image: info.image })
                    setInfos(new Map(map))
                }
            } catch (err) {
                if (!cancelled && !hasCache) {
                    setError(err instanceof Error ? err.message : String(err))
                    setLoading(false)
                }
            }
        })()

        return () => { cancelled = true }
    }, [player.membershipType, player.membershipId])

    if (loading)
        return (
            <div className="state">
                <div className="spinner" />
                Loading activity history&hellip;
            </div>
        )
    if (error) return <div className="state error">{error}</div>
    if (entries.length === 0)
        return <div className="state">No activities since the weekly reset.</div>

    const visible = entries.slice(0, shown)

    return (
        <div className="history-page">
            <div className="history-sub">
                <b>{entries.length}</b> {entries.length === 1 ? "activity" : "activities"} since weekly reset
            </div>
            <div className="history-list">
                <div className="history-head">
                    <span>Activity</span>
                    <span>Date</span>
                    <span>Duration</span>
                    <span>Players</span>
                    <span>K / D</span>
                    <span>Status</span>
                </div>
                {visible.map(e => {
                    const d = e.activityDetails
                    const date = new Date(e.period)
                    const completed = isCompleted(e)
                    const info = infos.get(d.referenceId)
                    const name = info?.name ?? "…"
                    return (
                        <button
                            key={d.instanceId}
                            className={`history-row ${completed ? "clear" : "dnf"}`}
                            onClick={() => setPgcr({ instanceId: d.instanceId, name })}
                        >
                            {info?.image && (
                                <span className="h-bg" style={{ backgroundImage: `url(${info.image})` }} />
                            )}
                            <span className="h-name">{name}</span>
                            <span className="h-date">
                                {date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                <small>{date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</small>
                            </span>
                            <span className="h-dur">{formatAvgDuration(num(e, "activityDurationSeconds"))}</span>
                            <span className="h-pc">{num(e, "playerCount") || "—"}</span>
                            <span className="h-kd">
                                {num(e, "kills")} / {num(e, "deaths")}
                            </span>
                            <span className={`h-status ${completed ? "ok" : "bad"}`}>
                                {completed ? "Clear" : "DNF"}
                            </span>
                        </button>
                    )
                })}
            </div>
            {shown < entries.length && (
                <button className="history-more" onClick={() => setShown(s => s + PAGE)}>
                    Load more ({entries.length - shown} remaining)
                </button>
            )}

            {pgcr && (
                <PgcrOverlay
                    runs={[]}
                    initialView={{ type: "pgcr", instanceId: pgcr.instanceId, fromActivity: pgcr.name }}
                    onClose={() => setPgcr(null)}
                />
            )}
        </div>
    )
}
