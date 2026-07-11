import { useMemo, useState } from "react"
import type { ActivityRun } from "../stats/compute"
import { useFadeIn } from "../motion/hooks"

// Trends — two figures built from the tracked run history:
//  · a 6-month calendar heatmap of runs per day (sequential amber ramp)
//  · weekly clears for the last 12 weeks (single-series bar chart)
// Both are plain SVG with a shared custom tooltip; single-hue amber = the
// app's data accent, text always in text tokens.

const DAY = 86_400_000
const HEAT_WEEKS = 26
const TREND_WEEKS = 12

// Sequential ramp (dark surface): bg-3 zero cell, then amber mixed in at
// increasing strength — one hue, dark → bright, monotonic lightness.
const HEAT_COLORS = ["#17171d", "#493d27", "#735e31", "#a8863d", "#e8b84c"]
const heatBin = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4)

const AC = "#e8b84c"
const GRID = "#22222c"
const TEXT_MUTED = "#555564"

/** Local midnight of the most recent Tuesday on/before d (Destiny week start). */
function weekStart(d: Date): Date {
    const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const offset = (out.getDay() - 2 + 7) % 7 // 2 = Tuesday
    out.setDate(out.getDate() - offset)
    return out
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

interface Tip {
    card: "heat" | "trend"
    x: number
    y: number
    title: string
    value: string
}

/** Rect with only the top corners rounded, anchored on the baseline. */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
    const rr = Math.min(r, h, w / 2)
    return (
        `M${x},${y + h} v${-(h - rr)} q0,${-rr} ${rr},${-rr} h${w - 2 * rr} ` +
        `q${rr},0 ${rr},${rr} v${h - rr} z`
    )
}

export function TrendsPanel({ runs }: { runs: ActivityRun[] }) {
    const { style } = useFadeIn(250)
    const [tip, setTip] = useState<Tip | null>(null)

    const heat = useMemo(() => {
        const perDay = new Map<string, number>()
        const cutoff = Date.now() - HEAT_WEEKS * 7 * DAY
        for (const r of runs) {
            if (r.date.getTime() < cutoff) continue
            const k = dayKey(r.date)
            perDay.set(k, (perDay.get(k) ?? 0) + 1)
        }
        // Columns: HEAT_WEEKS Tuesday-start weeks ending in the current week.
        const thisWeek = weekStart(new Date())
        const weeks: { days: { date: Date; count: number }[] }[] = []
        for (let w = HEAT_WEEKS - 1; w >= 0; w--) {
            const start = new Date(thisWeek.getTime() - w * 7 * DAY)
            const days = []
            for (let d = 0; d < 7; d++) {
                const date = new Date(start.getTime() + d * DAY)
                days.push({ date, count: perDay.get(dayKey(date)) ?? 0 })
            }
            weeks.push({ days })
        }
        return weeks
    }, [runs])

    const trend = useMemo(() => {
        const thisWeek = weekStart(new Date()).getTime()
        const buckets = new Array<number>(TREND_WEEKS).fill(0)
        for (const r of runs) {
            if (!r.completed) continue
            const weeksAgo = Math.floor((thisWeek + 7 * DAY - 1 - r.date.getTime()) / (7 * DAY))
            const idx = TREND_WEEKS - 1 - weeksAgo
            if (idx >= 0 && idx < TREND_WEEKS) buckets[idx]++
        }
        const starts = buckets.map(
            (_, i) => new Date(thisWeek - (TREND_WEEKS - 1 - i) * 7 * DAY)
        )
        return { buckets, starts }
    }, [runs])

    if (runs.length === 0) return null

    const fmtDate = (d: Date) =>
        d.toLocaleDateString(undefined, { month: "short", day: "numeric" })

    // ---- heatmap geometry ----
    const CELL = 11
    const GAP = 3
    const STEP = CELL + GAP
    const HX = 26 // room for day labels
    const HY = 16 // room for month labels
    const heatW = HX + HEAT_WEEKS * STEP
    const heatH = HY + 7 * STEP

    // Month label at each column where the month changes.
    const monthLabels: { x: number; label: string }[] = []
    let lastMonth = -1
    heat.forEach((week, i) => {
        const m = week.days[0].date.getMonth()
        if (m !== lastMonth) {
            monthLabels.push({
                x: HX + i * STEP,
                label: week.days[0].date.toLocaleDateString(undefined, { month: "short" }),
            })
            lastMonth = m
        }
    })

    // ---- trend geometry ----
    const TW = 480
    const TH = 170
    const M = { top: 16, right: 8, bottom: 22, left: 30 }
    const plotW = TW - M.left - M.right
    const plotH = TH - M.top - M.bottom
    const maxClears = Math.max(...trend.buckets, 1)
    // Nice tick ceiling: 1/2/5×10^n above the max.
    const niceMax = (() => {
        const pow = Math.pow(10, Math.floor(Math.log10(maxClears)))
        for (const m of [1, 2, 5, 10]) if (m * pow >= maxClears) return m * pow
        return 10 * pow
    })()
    const barStep = plotW / TREND_WEEKS
    const barW = Math.min(barStep - 4, 30)
    const barX = (i: number) => M.left + i * barStep + (barStep - barW) / 2
    const barH = (v: number) => (v / niceMax) * plotH
    const maxIdx = trend.buckets.indexOf(Math.max(...trend.buckets))

    const showTip = (card: Tip["card"]) => (e: React.MouseEvent, title: string, value: string) => {
        const host = (e.currentTarget as SVGElement).closest(".trend-card")
        if (!host) return
        const r = host.getBoundingClientRect()
        setTip({
            card,
            x: Math.min(e.clientX - r.left + 12, r.width - 130),
            y: e.clientY - r.top - 34,
            title,
            value,
        })
    }
    const showHeatTip = showTip("heat")
    const showTrendTip = showTip("trend")
    const hideTip = () => setTip(null)

    return (
        <div className="trends-row" style={style}>
            <div className="trend-card" onMouseLeave={hideTip}>
                <div className="trend-title">Activity</div>
                <div className="trend-sub">Raid &amp; dungeon runs per day, last 6 months</div>
                <div className="trend-scroll">
                    <svg
                        viewBox={`0 0 ${heatW} ${heatH}`}
                        width={heatW}
                        height={heatH}
                        role="img"
                        aria-label="Calendar heatmap of runs per day over the last 6 months"
                    >
                        {monthLabels.map(m => (
                            <text key={m.x} x={m.x} y={10} fontSize={9} fill={TEXT_MUTED}>
                                {m.label}
                            </text>
                        ))}
                        {["Tue", "Thu", "Sat"].map((label, i) => (
                            <text
                                key={label}
                                x={0}
                                y={HY + i * 2 * STEP + CELL - 2}
                                fontSize={9}
                                fill={TEXT_MUTED}
                            >
                                {label}
                            </text>
                        ))}
                        {heat.map((week, wi) =>
                            week.days.map((day, di) => {
                                if (day.date.getTime() > Date.now()) return null
                                return (
                                    <rect
                                        key={`${wi}-${di}`}
                                        x={HX + wi * STEP}
                                        y={HY + di * STEP}
                                        width={CELL}
                                        height={CELL}
                                        rx={2.5}
                                        fill={HEAT_COLORS[heatBin(day.count)]}
                                        onMouseMove={e =>
                                            showHeatTip(
                                                e,
                                                fmtDate(day.date),
                                                `${day.count} ${day.count === 1 ? "run" : "runs"}`
                                            )
                                        }
                                        onMouseLeave={hideTip}
                                    />
                                )
                            })
                        )}
                    </svg>
                </div>
                <div className="trend-legend">
                    <span>Less</span>
                    {HEAT_COLORS.map(c => (
                        <i key={c} style={{ background: c }} />
                    ))}
                    <span>More</span>
                </div>
                {tip?.card === "heat" && (
                    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
                        <b>{tip.value}</b> {tip.title}
                    </div>
                )}
            </div>

            <div className="trend-card" onMouseLeave={hideTip}>
                <div className="trend-title">Clears</div>
                <div className="trend-sub">Completed runs per week, last 12 weeks</div>
                <svg
                    viewBox={`0 0 ${TW} ${TH}`}
                    className="trend-chart"
                    role="img"
                    aria-label="Bar chart of completed runs per week over the last 12 weeks"
                >
                    {[0, 0.5, 1].map(f => {
                        const y = M.top + plotH - f * plotH
                        return (
                            <g key={f}>
                                <line
                                    x1={M.left}
                                    x2={TW - M.right}
                                    y1={y}
                                    y2={y}
                                    stroke={GRID}
                                    strokeWidth={1}
                                />
                                <text
                                    x={M.left - 6}
                                    y={y + 3}
                                    fontSize={9}
                                    fill={TEXT_MUTED}
                                    textAnchor="end"
                                >
                                    {Math.round(f * niceMax)}
                                </text>
                            </g>
                        )
                    })}
                    {trend.buckets.map((v, i) => {
                        const h = barH(v)
                        const week = trend.starts[i]
                        return (
                            <g key={i}>
                                {/* generous invisible hit target behind the thin bar */}
                                <rect
                                    x={M.left + i * barStep}
                                    y={M.top}
                                    width={barStep}
                                    height={plotH}
                                    fill="transparent"
                                    onMouseMove={e =>
                                        showTrendTip(
                                            e,
                                            `week of ${fmtDate(week)}`,
                                            `${v} ${v === 1 ? "clear" : "clears"}`
                                        )
                                    }
                                    onMouseLeave={hideTip}
                                />
                                {v > 0 && (
                                    <path
                                        d={topRoundedRect(barX(i), M.top + plotH - h, barW, h, 4)}
                                        fill={AC}
                                        pointerEvents="none"
                                    />
                                )}
                                {/* selective labels: peak week + current week only */}
                                {v > 0 && (i === maxIdx || i === TREND_WEEKS - 1) && (
                                    <text
                                        x={barX(i) + barW / 2}
                                        y={M.top + plotH - h - 5}
                                        fontSize={10}
                                        fontWeight={600}
                                        fill="#8a8a98"
                                        textAnchor="middle"
                                        pointerEvents="none"
                                    >
                                        {v}
                                    </text>
                                )}
                                {i % 2 === 1 && (
                                    <text
                                        x={M.left + i * barStep + barStep / 2}
                                        y={TH - 8}
                                        fontSize={9}
                                        fill={TEXT_MUTED}
                                        textAnchor="middle"
                                        pointerEvents="none"
                                    >
                                        {fmtDate(week)}
                                    </text>
                                )}
                            </g>
                        )
                    })}
                </svg>
                {tip?.card === "trend" && (
                    <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>
                        <b>{tip.value}</b> {tip.title}
                    </div>
                )}
            </div>
        </div>
    )
}
