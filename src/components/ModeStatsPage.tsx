import { useEffect, useState } from "react"
import { getActivityHistory, getCharacters } from "../bungie/api"
import type { ActivityHistoryEntry } from "../bungie/types"
import { resolveActivityInfo } from "../bungie/manifest"
import { formatAvgDuration, formatTotalDuration } from "../stats/format"
import type { SelectedPlayer } from "../hooks/useActivities"
import { parallaxHandlers, useStaggeredEntrance } from "../motion/hooks"
import { STAGGER } from "../motion/tokens"

// Per-activity stats for a Bungie mode (Nightfalls, Trials) over a recent
// window. These modes have huge all-time histories, so unlike raids/dungeons
// we deliberately scope to the last N days instead of walking every page.

const WINDOW_DAYS = 180

const num = (e: ActivityHistoryEntry, k: string) => e.values[k]?.basic.value ?? 0

function isCompleted(e: ActivityHistoryEntry): boolean {
    const done = num(e, "completed") === 1
    const reason = e.values.completionReason?.basic.value
    return done && (reason === undefined || reason === 0)
}

interface ModeRow {
    name: string
    image: string | null
    attempts: number
    clears: number
    kills: number
    deaths: number
    fastestSeconds: number | null
    timeSeconds: number
    lastPlayed: Date
}

interface ModeData {
    rows: ModeRow[]
    totals: { attempts: number; clears: number; kills: number; timeSeconds: number }
}

// Session cache per player+mode so tab switches don't refetch.
const modeCache = new Map<string, ModeData>()

async function fetchModeData(player: SelectedPlayer, mode: number): Promise<ModeData> {
    const notBefore = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    const chars = await getCharacters(player.membershipType, player.membershipId)
    const pages = await Promise.all(
        chars.current.map(cid =>
            getActivityHistory(player.membershipType, player.membershipId, cid, mode, notBefore)
        )
    )

    const seen = new Set<string>()
    const byHash = new Map<number, ActivityHistoryEntry[]>()
    for (const list of pages) {
        for (const e of list) {
            if (new Date(e.period) < notBefore) continue
            const id = e.activityDetails.instanceId
            if (seen.has(id)) continue
            seen.add(id)
            const hash = e.activityDetails.referenceId
            const bucket = byHash.get(hash)
            if (bucket) bucket.push(e)
            else byHash.set(hash, [e])
        }
    }

    // Resolve hashes → names, then merge difficulty tiers / rotations that share
    // a name (e.g. the same strike at Hero and Grandmaster).
    const infos = await Promise.all(
        [...byHash.keys()].map(async hash => ({ hash, info: await resolveActivityInfo(hash) }))
    )
    const infoByHash = new Map(infos.map(i => [i.hash, i.info]))

    const byName = new Map<string, ModeRow>()
    for (const [hash, entries] of byHash) {
        const info = infoByHash.get(hash)
        const name = info?.name || "Unknown Activity"
        const row = byName.get(name) ?? {
            name,
            image: info?.image ?? null,
            attempts: 0,
            clears: 0,
            kills: 0,
            deaths: 0,
            fastestSeconds: null,
            timeSeconds: 0,
            lastPlayed: new Date(0),
        }
        row.image ??= info?.image ?? null
        for (const e of entries) {
            row.attempts++
            row.kills += num(e, "kills")
            row.deaths += num(e, "deaths")
            row.timeSeconds += num(e, "activityDurationSeconds")
            const when = new Date(e.period)
            if (when > row.lastPlayed) row.lastPlayed = when
            if (isCompleted(e)) {
                row.clears++
                const dur = num(e, "activityDurationSeconds")
                if (dur > 0) {
                    row.fastestSeconds =
                        row.fastestSeconds === null ? dur : Math.min(row.fastestSeconds, dur)
                }
            }
        }
        byName.set(name, row)
    }

    const rows = [...byName.values()].sort((a, b) => b.clears - a.clears || b.attempts - a.attempts)
    return {
        rows,
        totals: {
            attempts: rows.reduce((s, r) => s + r.attempts, 0),
            clears: rows.reduce((s, r) => s + r.clears, 0),
            kills: rows.reduce((s, r) => s + r.kills, 0),
            timeSeconds: rows.reduce((s, r) => s + r.timeSeconds, 0),
        },
    }
}

export function ModeStatsPage({
    player,
    mode,
    noun,
}: {
    player: SelectedPlayer
    mode: number
    noun: string
}) {
    const cacheKey = `${player.membershipId}:${mode}`
    const [data, setData] = useState<ModeData | null>(modeCache.get(cacheKey) ?? null)
    const [error, setError] = useState<string | null>(null)
    const [retryNonce, setRetryNonce] = useState(0)
    const { getStyle } = useStaggeredEntrance(4, STAGGER.normal)

    useEffect(() => {
        let cancelled = false
        const cached = modeCache.get(cacheKey)
        setData(cached ?? null)
        setError(null)
        ;(async () => {
            try {
                const fresh = await fetchModeData(player, mode)
                if (cancelled) return
                modeCache.set(cacheKey, fresh)
                setData(fresh)
            } catch (err) {
                if (cancelled || cached) return // keep showing cached data
                setError(err instanceof Error ? err.message : String(err))
            }
        })()
        return () => {
            cancelled = true
        }
    }, [cacheKey, retryNonce])

    if (error)
        return (
            <div className="state error">
                {error}
                <button className="state-retry" onClick={() => setRetryNonce(n => n + 1)}>
                    Retry
                </button>
            </div>
        )
    if (!data)
        return (
            <div className="state">
                <div className="spinner" />
                Loading {noun.toLowerCase()} history&hellip;
            </div>
        )
    if (data.rows.length === 0)
        return (
            <div className="state">
                No {noun.toLowerCase()} activity in the last {Math.round(WINDOW_DAYS / 30)} months.
            </div>
        )

    const kd = (r: { kills: number; deaths: number }) =>
        r.deaths > 0 ? (r.kills / r.deaths).toFixed(2) : r.kills.toFixed(0)

    return (
        <div className="history-page">
            <div className="stat-bar stat-bar--page" {...parallaxHandlers()}>
                <div className="stat-cell stat-cell--primary" style={getStyle(0)}>
                    <span className="stat-val">{data.totals.clears.toLocaleString()}</span>
                    <span className="stat-key">{noun} clears</span>
                </div>
                <div className="stat-cell" style={getStyle(1)}>
                    <span className="stat-val">{data.totals.attempts.toLocaleString()}</span>
                    <span className="stat-key">Attempts</span>
                </div>
                <div className="stat-cell" style={getStyle(2)}>
                    <span className="stat-val">{data.totals.kills.toLocaleString()}</span>
                    <span className="stat-key">Kills</span>
                </div>
                <div className="stat-cell" style={getStyle(3)}>
                    <span className="stat-val">{formatTotalDuration(data.totals.timeSeconds)}</span>
                    <span className="stat-key">Time</span>
                </div>
            </div>

            <div className="history-sub">
                Last {Math.round(WINDOW_DAYS / 30)} months, grouped by activity. Bungie only keeps a
                rolling window of {noun.toLowerCase()} history, so lifetime totals aren&rsquo;t available here.
            </div>

            <div className="history-list">
                <div className="history-head mode-row">
                    <span>Activity</span>
                    <span>Clears</span>
                    <span>Attempts</span>
                    <span>Fastest</span>
                    <span>K / D</span>
                    <span>Last played</span>
                </div>
                {data.rows.map((r, i) => (
                    <div
                        key={r.name}
                        className="history-row mode-row clear"
                        style={{ animationDelay: `${Math.min(i, 10) * 30}ms`, cursor: "default" }}
                        {...parallaxHandlers()}
                    >
                        {r.image && (
                            <span className="h-bg" style={{ backgroundImage: `url(${r.image})` }} />
                        )}
                        <span className="h-name">{r.name}</span>
                        <span className="h-pc">{r.clears.toLocaleString()}</span>
                        <span className="h-pc">{r.attempts.toLocaleString()}</span>
                        <span className="h-dur">
                            {r.fastestSeconds !== null ? formatAvgDuration(r.fastestSeconds) : "—"}
                        </span>
                        <span className="h-kd">{kd(r)}</span>
                        <span className="h-date">
                            {r.lastPlayed.toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                            })}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}
