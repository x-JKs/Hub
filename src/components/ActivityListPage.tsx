import { useCallback, useMemo, useState } from "react"
import { AggregateHashStat } from "../bungie/types"
import { ActivityBreakdown, buildLifetimeBreakdowns, sumTotals } from "../stats/activityBreakdown"
import { ActivityRun, Category } from "../stats/compute"
import { FreshFastest, FreshFlawless } from "../stats/freshFastest"
import { formatTotalDuration } from "../stats/format"
import { ActivityDetailCard, ActivityDetailSkeleton } from "./ActivityDetailCard"
import { PgcrOverlay } from "./PgcrOverlay"
import { parallaxHandlers, useStaggeredEntrance } from "../motion/hooks"
import { STAGGER } from "../motion/tokens"

interface Props {
    runs: ActivityRun[]
    aggregate: AggregateHashStat[]
    freshFastest: Map<string, FreshFastest>
    freshFlawless: Map<string, FreshFlawless>
    freshLoading: boolean
    category: Category
}

const NOUN: Record<Category, string> = { raid: "raid", dungeon: "dungeon", pantheon: "Pantheon" }

type OverlayState =
    | null
    | { type: "clears"; groupKey: string; activityName: string; splashUrl: string | null }
    | { type: "pgcr"; instanceId: string; fromActivity: string }

type SortKey = "default" | "clears" | "fastest" | "recent"

const SORTS: { id: SortKey; label: string }[] = [
    { id: "default", label: "Default" },
    { id: "clears", label: "Clears" },
    { id: "fastest", label: "Fastest" },
    { id: "recent", label: "Recent" },
]

export function ActivityListPage({ runs, aggregate, freshFastest, freshFlawless, freshLoading, category }: Props) {
    const breakdowns = useMemo(
        () => buildLifetimeBreakdowns(aggregate, runs, category, freshFastest, freshFlawless),
        [aggregate, runs, category, freshFastest, freshFlawless]
    )
    const totals = useMemo(() => sumTotals(breakdowns), [breakdowns])
    const noun = NOUN[category]

    const [sort, setSort] = useState<SortKey>("default")
    const sorted = useMemo(() => {
        if (sort === "default") return breakdowns
        const arr = [...breakdowns]
        if (sort === "clears") arr.sort((a, b) => b.clears - a.clears)
        else if (sort === "fastest")
            arr.sort((a, b) => (a.fastestSeconds ?? Infinity) - (b.fastestSeconds ?? Infinity))
        else arr.sort((a, b) => (b.lastPlayed?.getTime() ?? 0) - (a.lastPlayed?.getTime() ?? 0))
        return arr
    }, [breakdowns, sort])

    const [overlay, setOverlay] = useState<OverlayState>(null)
    const { getStyle } = useStaggeredEntrance(4, STAGGER.normal)

    const openClears = useCallback((b: ActivityBreakdown) => {
        setOverlay({ type: "clears", groupKey: b.groupKey, activityName: b.name, splashUrl: b.splashUrl })
    }, [])

    // Open a specific clear's PGCR directly by instance id.
    const openInstance = useCallback((instanceId: string, label: string) => {
        setOverlay({ type: "pgcr", instanceId, fromActivity: label })
    }, [])

    // Open the run that earned a badge (lowman / flawless / day one).
    const openBadge = useCallback((b: ActivityBreakdown, badge: string) => {
        const group = runs.filter(r => r.groupKey === b.groupKey && r.completed)
        const tier = badge.startsWith("Solo") ? 1 : badge.startsWith("Duo") ? 2 : badge.startsWith("Trio") ? 3 : 0
        const flawless = badge === "Flawless" || badge.endsWith("Flawless")

        let matches = group
        if (badge === "Day One") matches = group.filter(r => r.isDayOne)
        else if (flawless && tier > 0) matches = group.filter(r => r.playerCount === tier && r.deaths === 0)
        else if (flawless) matches = group.filter(r => r.playerCount > 3 && r.deaths === 0)
        else if (tier > 0) matches = group.filter(r => r.playerCount === tier)

        // Prefer the fastest qualifying run.
        const target = matches
            .filter(r => r.durationSeconds > 0)
            .sort((a, c) => a.durationSeconds - c.durationSeconds)[0] ?? matches[0]
        if (target) {
            setOverlay({ type: "pgcr", instanceId: target.instanceId, fromActivity: `${b.name} · ${badge}` })
        }
    }, [runs])

    if (breakdowns.length === 0) {
        return <div className="state">No {noun} history found for this Guardian.</div>
    }

    return (
        <>
            <div className="stat-bar stat-bar--page" {...parallaxHandlers()}>
                <div className="stat-cell stat-cell--primary" style={getStyle(0)}>
                    <span className="stat-val">{totals.clears.toLocaleString()}</span>
                    <span className="stat-key">{noun} clears</span>
                </div>
                <div className="stat-cell" style={getStyle(1)}>
                    <span className="stat-val">{totals.kills.toLocaleString()}</span>
                    <span className="stat-key">Kills</span>
                </div>
                <div className="stat-cell" style={getStyle(2)}>
                    <span className="stat-val">{formatTotalDuration(totals.totalTimeSeconds)}</span>
                    <span className="stat-key">Time</span>
                </div>
                <div className="stat-cell" style={getStyle(3)}>
                    <span className="stat-val">{totals.clearsThisWeek.toLocaleString()}</span>
                    <span className="stat-key">This week</span>
                </div>
            </div>

            <div className="list-controls">
                <span className="list-controls-label">Sort</span>
                <div className="toggle">
                    {SORTS.map(s => (
                        <button
                            key={s.id}
                            className={sort === s.id ? "active" : ""}
                            onClick={() => setSort(s.id)}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="detail-list">
                {sorted.map(b => (
                    <div key={b.groupKey} className="activity-detail-wrap">
                        <ActivityDetailCard
                            data={b}
                            freshLoading={freshLoading}
                            onClick={() => openClears(b)}
                            onOpenInstance={openInstance}
                            onBadgeClick={badge => openBadge(b, badge)}
                        />
                    </div>
                ))}
            </div>

            <p className="footnote">
                Lifetime totals from Bungie, across all characters (including deleted).{" "}
                {freshLoading
                    ? "Verifying fastest full clears via post-game reports…"
                    : "Fastest is the fastest fresh full clear (checkpoint runs excluded), PGCR-verified like raid.report."}
            </p>

            {overlay && (
                <PgcrOverlay
                    runs={runs}
                    initialView={overlay}
                    onClose={() => setOverlay(null)}
                />
            )}
        </>
    )
}

export function ActivityListSkeleton() {
    return (
        <>
            <div className="stat-bar stat-bar--page">
                {[0, 1, 2, 3].map(i => (
                    <div className="stat-cell" key={i}>
                        <div className="skeleton-line" style={{ width: "50%", height: 18 }} />
                        <div className="skeleton-line" style={{ width: "70%", height: 10, marginTop: 6 }} />
                    </div>
                ))}
            </div>
            <div className="detail-list">
                {[0, 1, 2, 3, 4].map(i => (
                    <ActivityDetailSkeleton key={i} />
                ))}
            </div>
        </>
    )
}
