// Aggregate a player's runs into the dashboard stat cards.

import { Period } from "./period"

/** Which tracked activity family an instance belongs to. */
export type Category = "raid" | "dungeon" | "pantheon"

/** A single raid, dungeon, or Pantheon attempt, normalized from the Bungie shape. */
export interface ActivityRun {
    instanceId: string
    date: Date
    durationSeconds: number
    completed: boolean
    category: Category
    /** Stable key used to group variants of the same activity together. */
    groupKey: string
    groupName: string
    splashUrl: string | null
    // Detail fields used by the per-activity Raid/Dungeon pages.
    versionName: string
    playerCount: number
    kills: number
    deaths: number
    assists: number
    isDayOne: boolean
}

export interface MostPlayed {
    name: string
    splashUrl: string | null
    total: number
    completed: number
    successPct: number
}

export interface Stats {
    totalRuns: number
    completedRuns: number
    failedRuns: number
    raidRuns: number
    raidCompleted: number
    dungeonRuns: number
    dungeonCompleted: number
    timeInvestedSeconds: number
    avgDurationSeconds: number
    successPct: number
    mostPlayedRaid: MostPlayed | null
    mostPlayedDungeon: MostPlayed | null
}

const pct = (num: number, denom: number) => (denom === 0 ? 0 : Math.round((num / denom) * 100))

function mostPlayed(runs: ActivityRun[]): MostPlayed | null {
    if (runs.length === 0) return null

    const groups = new Map<string, { name: string; splashUrl: string | null; total: number; completed: number }>()
    for (const run of runs) {
        const g = groups.get(run.groupKey) ?? {
            name: run.groupName,
            splashUrl: run.splashUrl,
            total: 0,
            completed: 0
        }
        g.total++
        if (run.completed) g.completed++
        if (!g.splashUrl && run.splashUrl) g.splashUrl = run.splashUrl
        groups.set(run.groupKey, g)
    }

    let best = null as null | { name: string; splashUrl: string | null; total: number; completed: number }
    for (const g of groups.values()) {
        if (!best || g.total > best.total) best = g
    }
    if (!best) return null
    return { ...best, successPct: pct(best.completed, best.total) }
}

/** Filter to the period window and compute every card's numbers. */
export function computeStats(allRuns: ActivityRun[], period: Period): Stats {
    const runs = allRuns.filter(r => r.date >= period.start && r.date < period.end)

    const raids = runs.filter(r => r.category === "raid")
    const dungeons = runs.filter(r => r.category === "dungeon")
    const completedRuns = runs.filter(r => r.completed).length
    const timeInvestedSeconds = runs.reduce((sum, r) => sum + r.durationSeconds, 0)

    return {
        totalRuns: runs.length,
        completedRuns,
        failedRuns: runs.length - completedRuns,
        raidRuns: raids.length,
        raidCompleted: raids.filter(r => r.completed).length,
        dungeonRuns: dungeons.length,
        dungeonCompleted: dungeons.filter(r => r.completed).length,
        timeInvestedSeconds,
        avgDurationSeconds: runs.length ? Math.round(timeInvestedSeconds / runs.length) : 0,
        successPct: pct(completedRuns, runs.length),
        mostPlayedRaid: mostPlayed(raids),
        mostPlayedDungeon: mostPlayed(dungeons)
    }
}
