import { describe, expect, it } from "vitest"
import { computeStats, type ActivityRun } from "../compute"
import type { Period } from "../period"

const JULY: Period = {
    granularity: "month",
    start: new Date(2026, 6, 1),
    end: new Date(2026, 7, 1),
    label: "July 2026",
    sublabel: "Calendar Month",
}

let nextId = 1

function run(overrides: Partial<ActivityRun> = {}): ActivityRun {
    return {
        instanceId: String(nextId++),
        date: new Date(2026, 6, 10),
        durationSeconds: 1800,
        completed: true,
        category: "raid",
        groupKey: "raid:1",
        groupName: "Last Wish",
        splashUrl: null,
        versionName: "Standard",
        playerCount: 6,
        kills: 100,
        deaths: 3,
        assists: 20,
        isDayOne: false,
        ...overrides,
    }
}

describe("computeStats", () => {
    it("returns zeros and null most-played for no runs", () => {
        const s = computeStats([], JULY)
        expect(s.totalRuns).toBe(0)
        expect(s.successPct).toBe(0)
        expect(s.avgDurationSeconds).toBe(0)
        expect(s.mostPlayedRaid).toBeNull()
        expect(s.mostPlayedDungeon).toBeNull()
    })

    it("only counts runs inside the period window (start inclusive, end exclusive)", () => {
        const s = computeStats(
            [
                run({ date: new Date(2026, 6, 1) }), // first ms of July — in
                run({ date: new Date(2026, 5, 30) }), // June — out
                run({ date: new Date(2026, 7, 1) }), // first ms of August — out
            ],
            JULY
        )
        expect(s.totalRuns).toBe(1)
    })

    it("splits raid vs dungeon counts and completion", () => {
        const s = computeStats(
            [
                run(),
                run({ completed: false }),
                run({ category: "dungeon", groupKey: "dungeon:Duality", groupName: "Duality" }),
            ],
            JULY
        )
        expect(s.raidRuns).toBe(2)
        expect(s.raidCompleted).toBe(1)
        expect(s.dungeonRuns).toBe(1)
        expect(s.dungeonCompleted).toBe(1)
        expect(s.successPct).toBe(67) // 2/3 rounded
    })

    it("averages duration over all runs, rounded", () => {
        const s = computeStats([run({ durationSeconds: 100 }), run({ durationSeconds: 101 })], JULY)
        expect(s.timeInvestedSeconds).toBe(201)
        expect(s.avgDurationSeconds).toBe(101) // 100.5 rounds up
    })

    it("most played picks the group with the most runs, with its own success rate", () => {
        const s = computeStats(
            [
                run({ groupKey: "raid:1", groupName: "Last Wish" }),
                run({ groupKey: "raid:2", groupName: "King's Fall" }),
                run({ groupKey: "raid:2", groupName: "King's Fall", completed: false }),
            ],
            JULY
        )
        expect(s.mostPlayedRaid?.name).toBe("King's Fall")
        expect(s.mostPlayedRaid?.total).toBe(2)
        expect(s.mostPlayedRaid?.successPct).toBe(50)
    })
})
