import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
    currentPeriod,
    getDailyReset,
    getWeeklyReset,
    isCurrentPeriod,
    shiftPeriod,
} from "../period"

describe("Destiny resets (UTC)", () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it("daily reset is today 17:00 UTC once past it", () => {
        vi.setSystemTime(new Date("2026-07-08T18:30:00Z"))
        expect(getDailyReset().toISOString()).toBe("2026-07-08T17:00:00.000Z")
    })

    it("daily reset is yesterday 17:00 UTC before it", () => {
        vi.setSystemTime(new Date("2026-07-08T09:00:00Z"))
        expect(getDailyReset().toISOString()).toBe("2026-07-07T17:00:00.000Z")
    })

    it("weekly reset is the most recent Tuesday 17:00 UTC", () => {
        // Wednesday → the day before
        vi.setSystemTime(new Date("2026-07-08T12:00:00Z"))
        expect(getWeeklyReset().toISOString()).toBe("2026-07-07T17:00:00.000Z")
    })

    it("weekly reset on a Tuesday before 17:00 is the PREVIOUS week", () => {
        vi.setSystemTime(new Date("2026-07-07T10:00:00Z")) // Tue, pre-reset
        expect(getWeeklyReset().toISOString()).toBe("2026-06-30T17:00:00.000Z")
    })

    it("weekly reset on a Tuesday after 17:00 is that same day", () => {
        vi.setSystemTime(new Date("2026-07-07T17:00:01Z"))
        expect(getWeeklyReset().toISOString()).toBe("2026-07-07T17:00:00.000Z")
    })

    it("weekly reset on a Monday goes back six days", () => {
        vi.setSystemTime(new Date("2026-07-13T20:00:00Z")) // Mon, post-daily-reset
        expect(getWeeklyReset().toISOString()).toBe("2026-07-07T17:00:00.000Z")
    })
})

describe("period math (local calendar)", () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it("month period covers the 1st to the 1st, exclusive", () => {
        vi.setSystemTime(new Date(2026, 6, 15)) // July 15, local
        const p = currentPeriod("month")
        expect(p.start.getTime()).toBe(new Date(2026, 6, 1).getTime())
        expect(p.end.getTime()).toBe(new Date(2026, 7, 1).getTime())
        expect(p.label).toBe("July 2026")
    })

    it("shifting a January month back lands in December of the previous year", () => {
        vi.setSystemTime(new Date(2026, 0, 10))
        const prev = shiftPeriod(currentPeriod("month"), -1)
        expect(prev.start.getTime()).toBe(new Date(2025, 11, 1).getTime())
        expect(prev.label).toBe("December 2025")
    })

    it("week period starts on Monday and spans exactly 7 days", () => {
        vi.setSystemTime(new Date(2026, 6, 9)) // Thursday July 9
        const p = currentPeriod("week")
        expect(p.start.getDay()).toBe(1) // Monday
        expect(p.start.getTime()).toBe(new Date(2026, 6, 6).getTime())
        expect(p.end.getTime() - p.start.getTime()).toBe(7 * 86_400_000)
    })

    it("shiftPeriod is symmetric", () => {
        vi.setSystemTime(new Date(2026, 6, 9))
        const p = currentPeriod("week")
        const back = shiftPeriod(shiftPeriod(p, -3), 3)
        expect(back.start.getTime()).toBe(p.start.getTime())
    })

    it("isCurrentPeriod is true only for the live period", () => {
        vi.setSystemTime(new Date(2026, 6, 9))
        const p = currentPeriod("month")
        expect(isCurrentPeriod(p)).toBe(true)
        expect(isCurrentPeriod(shiftPeriod(p, -1))).toBe(false)
    })
})
