import { ActivityBreakdown } from "../stats/activityBreakdown"
import { formatAvgDuration, formatTotalDuration } from "../stats/format"

const fmtNum = (n: number) => Math.round(n).toLocaleString()

const fmtFastest = (s: number | null, loading: boolean) =>
    s !== null ? formatAvgDuration(s) : loading ? "…" : "—"

// Tags: Solo/Duo/Trio + their Flawless variants (incl. full-team "Flawless") +
// Day One. The flawless category shows only its best (lowest player count) tier —
// Solo > Duo > Trio > full-team Flawless. The non-flawless lowman shows alongside
// a flawless only when it's a LOWER count (so Solo Flawless => nothing else;
// Duo Flawless keeps a Solo; plain Flawless keeps any Solo/Duo/Trio). Day One is
// independent and always shown when earned.
const tierRank = (t: string) =>
    t.startsWith("Solo") ? 1 : t.startsWith("Duo") ? 2 : t.startsWith("Trio") ? 3 : 4

function Badges({ data, onBadgeClick }: { data: ActivityBreakdown; onBadgeClick?: (badge: string) => void }) {
    const badges: string[] = []

    // Best flawless tier: a lowman flawless (1–3) always outranks full-team.
    const bestFlawless = data.lowmanFlawless ?? (data.fullTeamFlawless ? "Flawless" : null)

    if (bestFlawless) {
        badges.push(bestFlawless)
        if (data.lowman && tierRank(data.lowman) < tierRank(bestFlawless)) {
            badges.push(data.lowman)
        }
    } else if (data.lowman) {
        badges.push(data.lowman)
    }

    if (data.dayOne) badges.push("Day One")
    if (badges.length === 0) return null
    return (
        <div className="detail-badges">
            {badges.map(b => (
                <span
                    key={b}
                    className={`tag tag-${b.toLowerCase().replace(/\s+/g, "")}${onBadgeClick ? " tag-clickable" : ""}`}
                    title={onBadgeClick ? `View ${b} clear` : undefined}
                    onClick={onBadgeClick ? e => { e.stopPropagation(); onBadgeClick(b) } : undefined}
                >
                    {b}
                </span>
            ))}
        </div>
    )
}

export function ActivityDetailCard({
    data,
    freshLoading,
    onClick,
    onOpenInstance,
    onBadgeClick,
}: {
    data: ActivityBreakdown
    freshLoading: boolean
    onClick?: () => void
    onOpenInstance?: (instanceId: string, label: string) => void
    onBadgeClick?: (badge: string) => void
}) {
    return (
        <div className={`detail ${onClick ? "detail-clickable" : ""}`} onClick={onClick}>
            <div className="detail-head">
                {data.splashUrl && (
                    <div className="bg" style={{ backgroundImage: `url(${data.splashUrl})` }} />
                )}
                <div className="scrim" />
                <div className="detail-title">{data.name}</div>
                <Badges data={data} onBadgeClick={onBadgeClick} />
            </div>

            <div className="detail-body">
                <div className="detail-clears">
                    <div className="big big-clears">
                        {fmtNum(data.clears)}
                        {data.trackedTotal > 0 && (
                            <span className="clears-pop">
                                <span className="clears-pop-row">
                                    <b>{Math.round((data.trackedCompleted / data.trackedTotal) * 100)}%</b>
                                    <span>Completion</span>
                                </span>
                                <span className="clears-pop-row">
                                    <b>{fmtNum(data.trackedCompleted)}</b>
                                    <span>Tracked clears</span>
                                </span>
                                <span className="clears-pop-row">
                                    <b>{freshLoading ? "…" : fmtNum(data.fullClears)}</b>
                                    <span>Full clears</span>
                                </span>
                            </span>
                        )}
                    </div>
                    <div className="caption">Clears</div>
                    <div className="weekly">
                        <b>{data.clearsThisWeek}</b> this week &middot;{" "}
                        <b>{data.clearsThisMonth}</b> this month
                    </div>
                    {data.recent.length > 0 && (
                        <div className="dots" title="Recent runs — oldest (left) to newest (right)">
                            {data.recent.slice().reverse().map((r, i) =>
                                r.completed && r.lowman ? (
                                    <span
                                        key={i}
                                        className="dot star"
                                        title={`${r.date.toLocaleDateString()} — Lowman clear`}
                                    >
                                        ★
                                    </span>
                                ) : (
                                    <span
                                        key={i}
                                        className={`dot ${r.completed ? "ok" : "bad"}`}
                                        title={`${r.date.toLocaleDateString()} — ${
                                            r.completed ? "Clear" : "Incomplete"
                                        }`}
                                    />
                                )
                            )}
                        </div>
                    )}
                </div>

                <div className="detail-mini">
                    <div>
                        <span className="k" title="Fastest fresh full clear (checkpoints excluded)">
                            Fastest clear
                        </span>
                        <span
                            className={`v ${data.fastestSeconds !== null ? "accent" : ""}${
                                data.fastestInstanceId && onOpenInstance ? " vfast-clickable" : ""
                            }`}
                            title={data.fastestInstanceId && onOpenInstance ? "View this fastest clear" : undefined}
                            onClick={
                                data.fastestInstanceId && onOpenInstance
                                    ? e => {
                                          e.stopPropagation()
                                          onOpenInstance(data.fastestInstanceId!, data.name)
                                      }
                                    : undefined
                            }
                        >
                            {fmtFastest(data.fastestSeconds, freshLoading)}
                        </span>
                    </div>
                    <div>
                        <span className="k">Time played</span>
                        <span className="v">{formatTotalDuration(data.totalTimeSeconds)}</span>
                    </div>
                    <div>
                        <span className="k">K/D</span>
                        <span className="v">{data.kd.toFixed(2)}</span>
                    </div>
                </div>

                <div className="detail-versions">
                    <div className="vrow vhead">
                        <span>Version</span>
                        <span>Clears</span>
                        <span>Fastest</span>
                    </div>
                    {data.versions.map(v => {
                        const clickable = !!v.fastestInstanceId && !!onOpenInstance
                        return (
                            <div className="vrow" key={v.name}>
                                <span>{v.name}</span>
                                <span>{fmtNum(v.clears)}</span>
                                <span
                                    className={`${v.fastestSeconds !== null ? "accent" : ""}${clickable ? " vfast-clickable" : ""}`}
                                    title={clickable ? "View this fastest clear" : undefined}
                                    onClick={clickable ? e => { e.stopPropagation(); onOpenInstance!(v.fastestInstanceId!, `${data.name} · ${v.name}`) } : undefined}
                                >
                                    {fmtFastest(v.fastestSeconds, freshLoading)}
                                </span>
                            </div>
                        )
                    })}
                </div>

                <div className="detail-kda">
                    <div>
                        <span className="k">Kills</span>
                        <span className="v">{fmtNum(data.kills)}</span>
                    </div>
                    <div>
                        <span className="k">Deaths</span>
                        <span className="v">{fmtNum(data.deaths)}</span>
                    </div>
                    <div>
                        <span className="k">Assists</span>
                        <span className="v">{fmtNum(data.assists)}</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

export function ActivityDetailSkeleton() {
    return (
        <div className="detail-skeleton">
            <div className="skel-head">
                <div className="skeleton-line" />
            </div>
            <div className="skel-body">
                <div className="skel-col">
                    <div className="skeleton-line" />
                    <div className="skeleton-line" style={{ width: "40%" }} />
                </div>
                <div className="skel-col">
                    <div className="skeleton-line" style={{ width: "80%" }} />
                    <div className="skeleton-line" style={{ width: "60%" }} />
                    <div className="skeleton-line" style={{ width: "50%" }} />
                </div>
                <div className="skel-col">
                    <div className="skeleton-line" style={{ width: "70%" }} />
                    <div className="skeleton-line" style={{ width: "90%" }} />
                </div>
                <div className="skel-col">
                    <div className="skeleton-line" style={{ width: "60%" }} />
                    <div className="skeleton-line" style={{ width: "75%" }} />
                    <div className="skeleton-line" style={{ width: "65%" }} />
                </div>
            </div>
        </div>
    )
}
