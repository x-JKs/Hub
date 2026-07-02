// Raid grouping + art, sourced from RaidHub's bundled definitions seed.
//
// Bungie's activity history gives us a raw `referenceId` (activity hash). A
// single raid has many hashes (normal / master / contest / each rotator week),
// so to group "all my Garden of Salvation runs" we map every hash to RaidHub's
// curated activityId, which represents the raid as a whole.

import seed from "./raidSeed.json"

export interface RaidHashInfo {
    activityId: number
    name: string
    splashSlug: string
    isSunset: boolean
    versionName: string
    /** Contest end date, used to flag Day One clears. */
    contestEnd: Date | null
}

type SplashSize = "tiny" | "small" | "medium" | "large" | "full"

const SPLASH_BASE = "https://cdn.raidhub.io/content/splash"

interface SeedActivity {
    id: number
    name: string
    isRaid: boolean
    isSunset: boolean
    splash: string
    contestEnd: string | null
}

const activityById = new Map<number, SeedActivity>(
    (seed.activities as SeedActivity[]).map(a => [a.id, a])
)
const versionNameById = new Map<number, string>(seed.versions.map(v => [v.id, v.name]))

const raidByHashMap = new Map<number, RaidHashInfo>()
for (const { hash, activityId, versionId } of seed.hashes) {
    const activity = activityById.get(activityId)
    if (activity?.isRaid) {
        raidByHashMap.set(hash, {
            activityId: activity.id,
            name: activity.name,
            splashSlug: activity.splash,
            isSunset: activity.isSunset,
            versionName: versionNameById.get(versionId) ?? "Standard",
            contestEnd: activity.contestEnd ? new Date(activity.contestEnd) : null
        })
    }
}

/** Look up the raid a Bungie activity hash belongs to, if it is a known raid. */
export function raidByHash(hash: number): RaidHashInfo | undefined {
    return raidByHashMap.get(hash)
}

/** Build a RaidHub CDN splash image URL for a slug. Only tiny.jpg and small.jpg
 *  exist for every raid (large/medium/full 404 on many), so default to small. */
export function raidSplashUrl(slug: string, size: SplashSize = "small"): string {
    return `${SPLASH_BASE}/${slug}/${size}.jpg`
}

const raidReleaseOrder = new Map<string, number>()
for (const a of seed.activities as (SeedActivity & { releaseDate?: string })[]) {
    if (a.isRaid && a.releaseDate) {
        raidReleaseOrder.set(`raid:${a.id}`, new Date(a.releaseDate).getTime())
    }
}

export function raidReleaseTime(groupKey: string): number {
    return raidReleaseOrder.get(groupKey) ?? 0
}

export interface RaidFamily {
    groupKey: string
    name: string
    splashUrl: string
    isSunset: boolean
}

const allRaidFamilies: RaidFamily[] = (seed.activities as SeedActivity[])
    .filter(a => a.isRaid)
    .map(a => ({
        groupKey: `raid:${a.id}`,
        name: a.name,
        splashUrl: raidSplashUrl(a.splash),
        isSunset: a.isSunset
    }))

export function getAllRaidFamilies(): RaidFamily[] {
    return allRaidFamilies
}
