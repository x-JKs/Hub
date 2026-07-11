import { describe, expect, it } from "vitest"
import { normalizeRuns } from "../normalize"
import type { ActivityHistoryEntry } from "../../bungie/types"
import dungeonSeed from "../../manifest/dungeonSeed.json"
import raidSeed from "../../manifest/raidSeed.json"
import { parseDungeonName } from "../../manifest/dungeons"

// Real hashes from the bundled seed tables, so the tests exercise the same
// mapping the app uses.
const DUNGEON = dungeonSeed.dungeons[0]
const RAID_HASH = raidSeed.hashes[0]
const RAID_ACTIVITY = raidSeed.activities.find(a => a.id === RAID_HASH.activityId)!

function entry(
    hash: number,
    overrides: Partial<Record<string, number>> = {},
    period = "2026-07-08T18:00:00Z"
): ActivityHistoryEntry {
    const values: ActivityHistoryEntry["values"] = {}
    const nums: Record<string, number> = {
        completed: 1,
        completionReason: 0,
        activityDurationSeconds: 1800,
        playerCount: 3,
        kills: 100,
        deaths: 2,
        assists: 10,
        ...overrides,
    }
    for (const [k, v] of Object.entries(nums)) {
        values[k] = { basic: { value: v, displayValue: String(v) } }
    }
    return {
        period,
        activityDetails: {
            instanceId: String(Math.floor(Math.random() * 1e9)),
            referenceId: hash,
            mode: 82,
            modes: [82],
        },
        values,
    } as ActivityHistoryEntry
}

describe("normalizeRuns", () => {
    it("maps a known dungeon hash to its family group", () => {
        const runs = normalizeRuns([entry(DUNGEON.hash)], false)
        expect(runs).toHaveLength(1)
        const expected = parseDungeonName(DUNGEON.name)
        expect(runs[0].category).toBe("dungeon")
        expect(runs[0].groupKey).toBe(`dungeon:${expected.base}`)
        expect(runs[0].versionName).toBe(expected.version)
        expect(runs[0].completed).toBe(true)
    })

    it("drops unmapped hashes so they can't pollute stats", () => {
        expect(normalizeRuns([entry(123456789)], false)).toHaveLength(0)
        expect(normalizeRuns([entry(123456789)], true)).toHaveLength(0)
    })

    it("treats a nonzero completionReason as not completed", () => {
        const runs = normalizeRuns([entry(DUNGEON.hash, { completionReason: 2 })], false)
        expect(runs[0].completed).toBe(false)
    })

    it("trusts the completed flag when completionReason is missing", () => {
        const e = entry(DUNGEON.hash)
        delete e.values.completionReason
        expect(normalizeRuns([e], false)[0].completed).toBe(true)
    })

    it("maps a known raid hash in raid mode", () => {
        const runs = normalizeRuns([entry(RAID_HASH.hash)], true)
        expect(runs).toHaveLength(1)
        expect(runs[0].category).toBe("raid")
        expect(runs[0].groupKey).toBe(`raid:${RAID_ACTIVITY.id}`)
        expect(runs[0].groupName).toBe(RAID_ACTIVITY.name)
    })

    it("flags day-one only for completed contest-window clears", () => {
        const contested = raidSeed.hashes
            .map(h => ({
                h,
                a: raidSeed.activities.find(a => a.id === h.activityId)!,
            }))
            .find(x => x.a.contestEnd)
        if (!contested) return // seed has no contest raids — nothing to test

        const inside = new Date(new Date(contested.a.contestEnd!).getTime() - 60_000).toISOString()
        const after = new Date(new Date(contested.a.contestEnd!).getTime() + 60_000).toISOString()

        expect(normalizeRuns([entry(contested.h.hash, {}, inside)], true)[0].isDayOne).toBe(true)
        expect(normalizeRuns([entry(contested.h.hash, {}, after)], true)[0].isDayOne).toBe(false)
        expect(
            normalizeRuns([entry(contested.h.hash, { completed: 0 }, inside)], true)[0].isDayOne
        ).toBe(false)
    })
})
