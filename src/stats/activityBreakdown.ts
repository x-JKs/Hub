// Build per-activity breakdowns for the Raids / Dungeons pages.
//
// All-time totals (clears, kills, deaths, assists, time, per-version, fastest)
// come from Bungie's AggregateActivityStats. Recent-window data (this week /
// month counts, the recent-runs dots, and lowman/flawless badges) comes from
// the activity history, joined by groupKey.

import { AggregateHashStat } from "../bungie/types"
import { dungeonByHash, dungeonReleaseTime, getAllDungeonFamilies } from "../manifest/dungeons"
import { raidByHash, raidReleaseTime, raidSplashUrl, getAllRaidFamilies } from "../manifest/raids"
import { pantheonByHash, pantheonReleaseTime, getAllPantheonFamilies } from "../manifest/pantheons"
import { ActivityRun, Category } from "./compute"
import { FreshFastest, FreshFlawless } from "./freshFastest"
import { currentPeriod } from "./period"

export interface VersionStat {
    name: string
    clears: number
    fastestSeconds: number | null
    fastestInstanceId: string | null
}

export interface RecentRun {
    date: Date
    completed: boolean
    durationSeconds: number
    /** Completed with fewer than a full team (Solo/Duo/Trio for raids, Solo/Duo
     *  for dungeons) — flagged so the dots can mark it with a star. */
    lowman: boolean
}

export interface ActivityBreakdown {
    groupKey: string
    name: string
    splashUrl: string | null
    category: Category
    clears: number
    kills: number
    deaths: number
    assists: number
    kd: number
    totalTimeSeconds: number
    /** Fastest fresh full clear (PGCR-verified); null = not yet computed / none. */
    fastestSeconds: number | null
    /** Instance of that fastest clear, for opening its PGCR. */
    fastestInstanceId: string | null
    clearsThisWeek: number
    clearsThisMonth: number
    lastPlayed: Date | null
    lowman: "Solo" | "Duo" | "Trio" | null
    /** Lowest-player-count flawless clear (e.g. "Solo Flawless"); null if no flawless lowman. */
    lowmanFlawless: "Solo Flawless" | "Duo Flawless" | "Trio Flawless" | null
    /** True if any full-team (4+) clear had 0 deaths. */
    fullTeamFlawless: boolean
    dayOne: boolean
    /** Completed attempts among the tracked history runs (for a success rate). */
    trackedCompleted: number
    trackedTotal: number
    /** PGCR-verified fresh full clears among the tracked runs (vs checkpoint clears). */
    fullClears: number
    versions: VersionStat[]
    recent: RecentRun[]
}

const RECENT_COUNT = 16

interface Classified {
    groupKey: string
    name: string
    splashUrl: string | null
    versionName: string
}

/** Map a raw aggregate hash to its family for the given category, or null. */
function classify(hash: number, category: Category): Classified | null {
    if (category === "raid") {
        const raid = raidByHash(hash)
        if (!raid) return null
        return {
            groupKey: `raid:${raid.activityId}`,
            name: raid.name,
            splashUrl: raidSplashUrl(raid.splashSlug),
            versionName: raid.versionName
        }
    }
    if (category === "pantheon") {
        const pantheon = pantheonByHash(hash)
        if (!pantheon) return null
        return {
            groupKey: `pantheon:${pantheon.activityId}`,
            name: pantheon.name,
            splashUrl: raidSplashUrl(pantheon.splashSlug),
            versionName: pantheon.versionName
        }
    }
    const dungeon = dungeonByHash(hash)
    if (!dungeon) return null
    return {
        groupKey: `dungeon:${dungeon.name}`,
        name: dungeon.name,
        splashUrl: dungeon.splashUrl,
        versionName: dungeon.versionName
    }
}

interface RecentAgg {
    thisWeek: number
    thisMonth: number
    lastPlayed: Date
    lowman: number
    flawlessLowman: number
    fullTeamFlawless: boolean
    dayOne: boolean
    trackedCompleted: number
    trackedTotal: number
    recent: RecentRun[]
}

// Dungeons are 3-player, so Duo/Trio aren't lowman feats there — only Solo is.
// (Duo/Trio tags are suppressed for dungeons; see computeActivityBreakdown for
// how a duo/trio dungeon FLAWLESS collapses to a plain "Flawless".)
function lowmanLabel(n: number, category: Category): ActivityBreakdown["lowman"] {
    if (n === 1) return "Solo"
    if (category === "dungeon") return null
    if (n === 2) return "Duo"
    if (n === 3) return "Trio"
    return null
}

function lowmanFlawlessLabel(n: number, category: Category): ActivityBreakdown["lowmanFlawless"] {
    if (n === 1) return "Solo Flawless"
    if (category === "dungeon") return null
    if (n === 2) return "Duo Flawless"
    if (n === 3) return "Trio Flawless"
    return null
}

/** Summarize recent-history runs (one entry per groupKey). */
function recentByGroup(runs: ActivityRun[], category: Category): Map<string, RecentAgg> {
    const week = currentPeriod("week")
    const month = currentPeriod("month")
    const map = new Map<string, RecentAgg>()
    for (const run of runs) {
        if (run.category !== category) continue
        const agg = map.get(run.groupKey) ?? {
            thisWeek: 0,
            thisMonth: 0,
            lastPlayed: run.date,
            lowman: Infinity,
            flawlessLowman: Infinity,
            fullTeamFlawless: false,
            dayOne: false,
            trackedCompleted: 0,
            trackedTotal: 0,
            recent: []
        }
        agg.trackedTotal++
        if (run.completed) {
            agg.trackedCompleted++
            if (run.date >= week.start && run.date < week.end) agg.thisWeek++
            if (run.date >= month.start && run.date < month.end) agg.thisMonth++
            if (run.playerCount > 0) agg.lowman = Math.min(agg.lowman, run.playerCount)
            if (run.deaths === 0) {
                if (run.playerCount > 0 && run.playerCount <= 3) {
                    agg.flawlessLowman = Math.min(agg.flawlessLowman, run.playerCount)
                } else if (run.playerCount > 3) {
                    agg.fullTeamFlawless = true
                }
            }
            if (run.isDayOne) agg.dayOne = true
        }
        if (run.date > agg.lastPlayed) agg.lastPlayed = run.date
        if (agg.recent.length < RECENT_COUNT) {
            // Lowman: raids (6-player) star Solo/Duo/Trio (1–3); dungeons
            // (3-player) only star Solo (Duo/Trio aren't lowman feats there).
            const lowmanCap = category === "dungeon" ? 1 : 3
            agg.recent.push({
                date: run.date,
                completed: run.completed,
                durationSeconds: run.durationSeconds,
                lowman: run.completed && run.playerCount > 0 && run.playerCount <= lowmanCap
            })
        }
        map.set(run.groupKey, agg)
    }
    return map
}

const familiesFor = (category: Category) =>
    category === "raid" ? getAllRaidFamilies()
        : category === "pantheon" ? getAllPantheonFamilies()
        : getAllDungeonFamilies()

const releaseTimeFor = (category: Category) =>
    category === "raid" ? raidReleaseTime
        : category === "pantheon" ? pantheonReleaseTime
        : dungeonReleaseTime

export function buildLifetimeBreakdowns(
    aggregate: AggregateHashStat[],
    runs: ActivityRun[],
    category: Category,
    freshFastest?: Map<string, FreshFastest>,
    freshFlawless?: Map<string, FreshFlawless>
): ActivityBreakdown[] {
    const recent = recentByGroup(runs, category)
    const families = familiesFor(category)
    const sunsetKeys = new Set(
        families.filter(f => "isSunset" in f && f.isSunset).map(f => f.groupKey)
    )

    interface VersionStatAcc extends VersionStat {
        _aggFastest: number | null
    }
    interface Acc extends ActivityBreakdown {
        _versions: Map<string, VersionStatAcc>
        _aggFastest: number | null
    }
    const groups = new Map<string, Acc>()

    for (const stat of aggregate) {
        const c = classify(stat.hash, category)
        if (!c) continue

        let g = groups.get(c.groupKey)
        if (!g) {
            g = {
                groupKey: c.groupKey,
                name: c.name,
                splashUrl: c.splashUrl,
                category,
                clears: 0,
                kills: 0,
                deaths: 0,
                assists: 0,
                kd: 0,
                totalTimeSeconds: 0,
                fastestSeconds: null,
                fastestInstanceId: null,
                clearsThisWeek: 0,
                clearsThisMonth: 0,
                lastPlayed: null,
                lowman: null,
                lowmanFlawless: null,
                fullTeamFlawless: false,
                dayOne: false,
                trackedCompleted: 0,
                trackedTotal: 0,
                fullClears: 0,
                versions: [],
                recent: [],
                _versions: new Map(),
                _aggFastest: null
            }
            groups.set(c.groupKey, g)
        }

        g.clears += stat.clears
        g.kills += stat.kills
        g.deaths += stat.deaths
        g.assists += stat.assists
        g.totalTimeSeconds += stat.timeSeconds

        if (stat.fastestSeconds !== null) {
            g._aggFastest = g._aggFastest === null
                ? stat.fastestSeconds
                : Math.min(g._aggFastest, stat.fastestSeconds)
        }

        const v = g._versions.get(c.versionName) ?? {
            name: c.versionName,
            clears: 0,
            fastestSeconds: null,
            fastestInstanceId: null,
            _aggFastest: null as number | null
        }
        v.clears += stat.clears
        if (stat.fastestSeconds !== null) {
            v._aggFastest = v._aggFastest === null
                ? stat.fastestSeconds
                : Math.min(v._aggFastest, stat.fastestSeconds)
        }
        g._versions.set(c.versionName, v)
    }

    for (const f of families) {
        if (!groups.has(f.groupKey)) {
            groups.set(f.groupKey, {
                groupKey: f.groupKey,
                name: f.name,
                splashUrl: f.splashUrl,
                category,
                clears: 0,
                kills: 0,
                deaths: 0,
                assists: 0,
                kd: 0,
                totalTimeSeconds: 0,
                fastestSeconds: null,
                fastestInstanceId: null,
                clearsThisWeek: 0,
                clearsThisMonth: 0,
                lastPlayed: null,
                lowman: null,
                lowmanFlawless: null,
                fullTeamFlawless: false,
                dayOne: false,
                trackedCompleted: 0,
                trackedTotal: 0,
                fullClears: 0,
                versions: [],
                recent: [],
                _versions: new Map(),
                _aggFastest: null
            })
        }
    }

    const result: ActivityBreakdown[] = []
    for (const g of groups.values()) {
        const r = recent.get(g.groupKey)
        const fresh = freshFastest?.get(g.groupKey)
        // Flawless requires a PGCR-verified fresh full clear (not a checkpoint).
        const flaw = freshFlawless?.get(g.groupKey)
        let lowmanFlawlessN = flaw?.lowmanFlawless ?? null
        let fullTeamFlawless = flaw?.fullTeamFlawless ?? false
        // Dungeons: a Duo/Trio flawless isn't a "lowman" tag — collapse it to a
        // plain "Flawless" so no Duo/Trio label ever shows on a dungeon.
        if (category === "dungeon" && lowmanFlawlessN !== null && lowmanFlawlessN >= 2) {
            fullTeamFlawless = true
            lowmanFlawlessN = null
        }
        g.lowmanFlawless = lowmanFlawlessLabel(lowmanFlawlessN ?? Infinity, category)
        g.fullTeamFlawless = fullTeamFlawless
        g.kd = g.deaths > 0 ? g.kills / g.deaths : g.kills
        const sunsetFallback = sunsetKeys.has(g.groupKey) && fresh?.overallSeconds === null
        g.fastestSeconds = fresh?.overallSeconds
            ?? (sunsetFallback ? (fresh?.durationFallbackSeconds ?? g._aggFastest) : null)
        g.fastestInstanceId = fresh?.overallInstanceId
            ?? (sunsetFallback ? (fresh?.durationFallbackInstanceId ?? null) : null)
        g.fullClears = fresh?.fullClears ?? 0
        g.versions = [...g._versions.values()]
            .filter(v => v.clears > 0)
            .map(v => ({
                name: v.name,
                clears: v.clears,
                fastestSeconds: fresh?.versions.get(v.name)
                    ?? (sunsetFallback ? (fresh?.durationFallbackVersions.get(v.name) ?? v._aggFastest) : null),
                fastestInstanceId: fresh?.versionInstanceIds.get(v.name)
                    ?? (sunsetFallback ? (fresh?.durationFallbackVersionInstanceIds.get(v.name) ?? null) : null)
            }))
            .sort((a, b) => b.clears - a.clears)
        if (r) {
            g.clearsThisWeek = r.thisWeek
            g.clearsThisMonth = r.thisMonth
            g.lastPlayed = r.lastPlayed
            g.lowman = lowmanLabel(r.lowman, category)
            g.dayOne = r.dayOne
            g.trackedCompleted = r.trackedCompleted
            g.trackedTotal = r.trackedTotal
            g.recent = r.recent
        }
        const { _versions, _aggFastest, ...clean } = g
        void _versions; void _aggFastest
        result.push(clean)
    }

    const releaseTime = releaseTimeFor(category)
    return result.sort((a, b) => releaseTime(b.groupKey) - releaseTime(a.groupKey))
}

export interface BreakdownTotals {
    clears: number
    kills: number
    totalTimeSeconds: number
    clearsThisWeek: number
}

export function sumTotals(breakdowns: ActivityBreakdown[]): BreakdownTotals {
    return breakdowns.reduce(
        (acc, b) => ({
            clears: acc.clears + b.clears,
            kills: acc.kills + b.kills,
            totalTimeSeconds: acc.totalTimeSeconds + b.totalTimeSeconds,
            clearsThisWeek: acc.clearsThisWeek + b.clearsThisWeek
        }),
        { clears: 0, kills: 0, totalTimeSeconds: 0, clearsThisWeek: 0 }
    )
}
