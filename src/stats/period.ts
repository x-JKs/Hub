// Calendar week / month period math for the period selector.

export type Granularity = "week" | "month"

export interface Period {
    granularity: Granularity
    start: Date // inclusive
    end: Date // exclusive
    label: string // e.g. "November 2025"
    sublabel: string // e.g. "Calendar Month"
}

/** Most recent Destiny daily reset (17:00 UTC). */
export function getDailyReset(): Date {
    const now = new Date()
    const today17 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17, 0, 0))
    return now >= today17 ? today17 : new Date(today17.getTime() - 86400000)
}

/** Most recent Destiny weekly reset (Tuesday 17:00 UTC). */
export function getWeeklyReset(): Date {
    const daily = getDailyReset()
    const diff = (daily.getUTCDay() + 5) % 7 // days since Tuesday
    return new Date(daily.getTime() - diff * 86400000)
}

function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Monday-based start of the week containing `d`. */
function startOfWeek(d: Date): Date {
    const day = startOfDay(d)
    const dow = (day.getDay() + 6) % 7 // 0 = Monday
    day.setDate(day.getDate() - dow)
    return day
}

const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
]

function makeMonth(anchor: Date): Period {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)
    return {
        granularity: "month",
        start,
        end,
        label: `${MONTHS[start.getMonth()]} ${start.getFullYear()}`,
        sublabel: "Calendar Month"
    }
}

function makeWeek(anchor: Date): Period {
    const start = startOfWeek(anchor)
    const end = new Date(start)
    end.setDate(end.getDate() + 7)
    const fmt = (d: Date) => `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
    const last = new Date(end)
    last.setDate(last.getDate() - 1)
    return {
        granularity: "week",
        start,
        end,
        label: `${fmt(start)} – ${fmt(last)}`,
        sublabel: "Calendar Week"
    }
}

export function currentPeriod(granularity: Granularity): Period {
    const now = new Date()
    return granularity === "month" ? makeMonth(now) : makeWeek(now)
}

/** Shift a period by `delta` units (negative = older). */
export function shiftPeriod(period: Period, delta: number): Period {
    if (period.granularity === "month") {
        return makeMonth(new Date(period.start.getFullYear(), period.start.getMonth() + delta, 1))
    }
    const anchor = new Date(period.start)
    anchor.setDate(anchor.getDate() + delta * 7)
    return makeWeek(anchor)
}

export function isCurrentPeriod(period: Period): boolean {
    const cur = currentPeriod(period.granularity)
    return cur.start.getTime() === period.start.getTime()
}
