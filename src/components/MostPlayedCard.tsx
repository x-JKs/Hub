import { MostPlayed } from "../stats/compute"
import { parallaxHandlers } from "../motion/hooks"

interface Props {
    kind: "raid" | "dungeon"
    periodLabel: string
    data: MostPlayed | null
    /** When provided (and there is data), the card opens that activity's clears. */
    onOpen?: (data: MostPlayed) => void
}

export function MostPlayedCard({ kind, periodLabel, data, onOpen }: Props) {
    const title = kind === "raid" ? "Most Played Raid" : "Most Played Dungeon"
    const clickable = !!data && !!onOpen

    return (
        <div
            className={`most ${kind}${clickable ? " most-clickable" : ""}`}
            onClick={clickable ? () => onOpen!(data!) : undefined}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen!(data!) } } : undefined}
            title={clickable ? `View ${data!.name} clears` : undefined}
            {...parallaxHandlers()}
        >
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
