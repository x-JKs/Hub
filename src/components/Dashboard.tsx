import { MostPlayed, Stats } from "../stats/compute"
import { formatAvgDuration, formatTotalDuration } from "../stats/format"
import { Period } from "../stats/period"
import { MostPlayedCard } from "./MostPlayedCard"
import { parallaxHandlers, useCountUp, useFadeIn, useStaggeredEntrance } from "../motion/hooks"
import { STAGGER } from "../motion/tokens"

interface Props {
    stats: Stats
    period: Period
    /** Opens the clears list for a most-played activity. */
    onMostPlayedOpen?: (data: MostPlayed) => void
}

export function Dashboard({ stats, period, onMostPlayedOpen }: Props) {
    const totalRuns = useCountUp(stats.totalRuns)
    const completedRuns = useCountUp(stats.completedRuns)
    const failedRuns = useCountUp(stats.failedRuns)
    const raidRuns = useCountUp(stats.raidRuns)
    const raidCompleted = useCountUp(stats.raidCompleted)
    const dungeonRuns = useCountUp(stats.dungeonRuns)
    const dungeonCompleted = useCountUp(stats.dungeonCompleted)
    const successPct = useCountUp(stats.successPct)

    const { getStyle } = useStaggeredEntrance(5, STAGGER.normal)
    const { style: gridStyle } = useFadeIn(200)

    return (
        <>
            <div className="stat-bar" {...parallaxHandlers()}>
                <div className="stat-cell stat-cell--primary" style={getStyle(0)}>
                    <span className="stat-val">{totalRuns}</span>
                    <span className="stat-key">Runs</span>
                    <span className="stat-sub">
                        <span className="ok">{completedRuns}</span>
                        {" / "}
                        <span className="bad">{failedRuns}</span>
                    </span>
                </div>
                <div className="stat-cell" style={getStyle(1)}>
                    <span className="stat-val">{raidRuns}</span>
                    <span className="stat-key">Raids</span>
                    <span className="stat-sub"><span className="ok">{raidCompleted}</span> clear{raidCompleted !== 1 ? "s" : ""}</span>
                </div>
                <div className="stat-cell" style={getStyle(2)}>
                    <span className="stat-val">{dungeonRuns}</span>
                    <span className="stat-key">Dungeons</span>
                    <span className="stat-sub"><span className="ok">{dungeonCompleted}</span> clear{dungeonCompleted !== 1 ? "s" : ""}</span>
                </div>
                <div className="stat-cell" style={getStyle(3)}>
                    <span className="stat-val">{formatTotalDuration(stats.timeInvestedSeconds)}</span>
                    <span className="stat-key">Time</span>
                    <span className="stat-sub">avg {formatAvgDuration(stats.avgDurationSeconds)}</span>
                </div>
                <div
                    className="stat-cell"
                    style={getStyle(4)}
                    title="Completed runs ÷ total runs in the selected period"
                >
                    <span className="stat-val">{successPct}<small>%</small></span>
                    <span className="stat-key">Success</span>
                    <span className="stat-sub">{stats.completedRuns}/{stats.totalRuns}</span>
                </div>
            </div>

            <div className="most-grid" style={gridStyle}>
                <MostPlayedCard kind="raid" periodLabel={period.label} data={stats.mostPlayedRaid} onOpen={onMostPlayedOpen} />
                <MostPlayedCard
                    kind="dungeon"
                    periodLabel={period.label}
                    data={stats.mostPlayedDungeon}
                    onOpen={onMostPlayedOpen}
                />
            </div>
        </>
    )
}

/** Shimmer placeholder shown while the overview's first load is in flight. */
export function OverviewSkeleton() {
    return (
        <>
            <div className="stat-bar">
                {[0, 1, 2, 3, 4].map(i => (
                    <div className="stat-cell" key={i}>
                        <div className="skeleton-line" style={{ width: "50%", height: 20 }} />
                        <div className="skeleton-line" style={{ width: "65%", height: 10, marginTop: 6 }} />
                    </div>
                ))}
            </div>
            <div className="most-grid">
                {[0, 1].map(i => (
                    <div className="most" key={i}>
                        <div className="empty">
                            <div className="skeleton-line" style={{ width: 90, height: 10 }} />
                            <div className="skeleton-line" style={{ width: 180, height: 18, marginTop: 10 }} />
                            <div className="skeleton-line" style={{ width: 120, height: 12, marginTop: 8 }} />
                        </div>
                    </div>
                ))}
            </div>
        </>
    )
}
