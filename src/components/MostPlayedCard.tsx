import { MostPlayed } from "../stats/compute"

interface Props {
    kind: "raid" | "dungeon"
    periodLabel: string
    data: MostPlayed | null
}

export function MostPlayedCard({ kind, periodLabel, data }: Props) {
    const title = kind === "raid" ? "Most Played Raid" : "Most Played Dungeon"

    return (
        <div className={`most ${kind}`}>
            {data?.splashUrl && (
                <div className="bg" style={{ backgroundImage: `url(${data.splashUrl})` }} />
            )}
            <div className="scrim" />
            <div className="head">
                <span className="star">{kind === "raid" ? "★" : "✦"}</span>
                <span>{title}</span>
                <span className="when">· {periodLabel}</span>
            </div>

            {data ? (
                <div className="body">
                    <div className="name">{data.name}</div>
                    <div className="completed">
                        Completed <b>{data.completed}</b>{" "}
                        <span className="muted">/ {data.total} runs</span>
                    </div>
                    <span className="badge">Success: {data.successPct}%</span>
                </div>
            ) : (
                <div className="empty">No {kind} runs this period</div>
            )}
        </div>
    )
}
