import { Stats } from "../stats/compute"
import { formatAvgDuration, formatTotalDuration } from "../stats/format"
import { Period } from "../stats/period"
import { MostPlayedCard } from "./MostPlayedCard"
import { useCountUp, useFadeIn } from "../motion/hooks"

interface Props {
    stats: Stats
    period: Period
}

export function Dashboard({ stats, period }: Props) {
    const totalRuns = useCountUp(stats.totalRuns)
    const completedRuns = useCountUp(stats.completedRuns)
    const failedRuns = useCountUp(stats.failedRuns)
    const raidRuns = useCountUp(stats.raidRuns)
    const raidCompleted = useCountUp(stats.raidCompleted)
    const dungeonRuns = useCountUp(stats.dungeonRuns)
    const dungeonCompleted = useCountUp(stats.dungeonCompleted)
    const successPct = useCountUp(stats.successPct)

    const { style } = useFadeIn()

    return (
        <>
            <div className="stat-bar" style={style}>
                <div className="stat-cell stat-cell--primary">
                    <span className="stat-val">{totalRuns}</span>
                    <span className="stat-key">Runs</span>
                    <span className="stat-sub">
                        <span className="ok">{completedRuns}</span>
                        {" / "}
                        <span className="bad">{failedRuns}</span>
                    </span>
                </div>
                <div className="stat-cell">
                    <span className="stat-val">{raidRuns}</span>
                    <span className="stat-key">Raids</span>
                    <span className="stat-sub"><span className="ok">{raidCompleted}</span> clear{raidCompleted !== 1 ? "s" : ""}</span>
                </div>
                <div className="stat-cell">
                    <span className="stat-val">{dungeonRuns}</span>
                    <span className="stat-key">Dungeons</span>
                    <span className="stat-sub"><span className="ok">{dungeonCompleted}</span> clear{dungeonCompleted !== 1 ? "s" : ""}</span>
                </div>
                <div className="stat-cell">
                    <span className="stat-val">{formatTotalDuration(stats.timeInvestedSeconds)}</span>
                    <span className="stat-key">Time</span>
                    <span className="stat-sub">avg {formatAvgDuration(stats.avgDurationSeconds)}</span>
                </div>
                <div className="stat-cell">
                    <span className="stat-val">{successPct}<small>%</small></span>
                    <span className="stat-key">Success</span>
                    <span className="stat-sub">{stats.completedRuns}/{stats.totalRuns}</span>
                </div>
            </div>

            <div className="most-grid" style={style}>
                <MostPlayedCard kind="raid" periodLabel={period.label} data={stats.mostPlayedRaid} />
                <MostPlayedCard
                    kind="dungeon"
                    periodLabel={period.label}
                    data={stats.mostPlayedDungeon}
                />
            </div>
        </>
    )
}
