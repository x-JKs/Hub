import { Granularity, isCurrentPeriod, Period } from "../stats/period"

interface Props {
    period: Period
    onGranularity: (g: Granularity) => void
    onShift: (delta: number) => void
    onReset: () => void
}

export function PeriodSelector({ period, onGranularity, onShift, onReset }: Props) {
    const atCurrent = isCurrentPeriod(period)
    return (
        <div className="period">
            <div className="toggle">
                <button
                    className={period.granularity === "week" ? "active" : ""}
                    onClick={() => onGranularity("week")}
                >
                    Week
                </button>
                <button
                    className={period.granularity === "month" ? "active" : ""}
                    onClick={() => onGranularity("month")}
                >
                    Month
                </button>
            </div>

            <div className="period-center">
                <button className="nav" onClick={() => onShift(-1)} aria-label="Previous">
                    ‹
                </button>
                <div className="period-label">
                    <div className="main">{period.label}</div>
                    <div className="sub">{period.sublabel}</div>
                </div>
                <button
                    className="nav"
                    onClick={() => onShift(1)}
                    disabled={atCurrent}
                    aria-label="Next"
                >
                    ›
                </button>
            </div>

            <button
                className="current"
                onClick={onReset}
                style={{ background: "none", border: "none", cursor: "pointer" }}
            >
                {atCurrent ? "Current" : "Go to current"}
            </button>
        </div>
    )
}
