import { describe, expect, it } from "vitest"
import { formatAvgDuration, formatTotalDuration } from "../format"

describe("formatTotalDuration", () => {
    it("drops the hours segment when zero", () => {
        expect(formatTotalDuration(59 * 60)).toBe("59m")
    })
    it("shows hours and minutes", () => {
        expect(formatTotalDuration(3600 * 229 + 57 * 60 + 30)).toBe("229h 57m")
    })
})

describe("formatAvgDuration", () => {
    it("uses minutes and seconds under an hour", () => {
        expect(formatAvgDuration(32 * 60 + 37)).toBe("32m 37s")
    })
    it("switches to hours and minutes at an hour", () => {
        expect(formatAvgDuration(3600 + 90)).toBe("1h 1m")
    })
    it("handles zero", () => {
        expect(formatAvgDuration(0)).toBe("0m 0s")
    })
})
