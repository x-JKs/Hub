// Pantheon grouping + art. Pantheon activities live in the same seed as raids
// (raidSeed.json) but are flagged isRaid:false; their "versions" are the boss
// encounters (e.g. Atraks Sovereign). Mirrors raids.ts so the Pantheon tab can
// reuse the same breakdown pipeline.

import seed from "./raidSeed.json"
import { raidSplashUrl } from "./raids"

export interface PantheonHashInfo {
    activityId: number
    name: string
    splashSlug: string
    isSunset: boolean
    /** Boss-encounter (or difficulty) label for this hash. */
    versionName: string
}

interface SeedActivity {
    id: number
    name: string
    isRaid: boolean
    isSunset: boolean
    splash: string
    releaseDate?: string
}

const isPantheon = (a: { name: string }) => /^pantheon/i.test(a.name)

const activityById = new Map<number, SeedActivity>(
    (seed.activities as SeedActivity[]).map(a => [a.id, a])
)
const versionNameById = new Map<number, string>(seed.versions.map(v => [v.id, v.name]))

const pantheonByHashMap = new Map<number, PantheonHashInfo>()
for (const { hash, activityId, versionId } of seed.hashes) {
    const activity = activityById.get(activityId)
    if (activity && isPantheon(activity)) {
        pantheonByHashMap.set(hash, {
            activityId: activity.id,
            name: activity.name,
            splashSlug: activity.splash,
            isSunset: activity.isSunset,
            versionName: versionNameById.get(versionId) ?? "Standard"
        })
    }
}

/** Look up the Pantheon a Bungie activity hash belongs to, if any. */
export function pantheonByHash(hash: number): PantheonHashInfo | undefined {
    return pantheonByHashMap.get(hash)
}

export interface PantheonFamily {
    groupKey: string
    name: string
    splashUrl: string
    isSunset: boolean
}

const allPantheonFamilies: PantheonFamily[] = (seed.activities as SeedActivity[])
    .filter(isPantheon)
    .map(a => ({
        groupKey: `pantheon:${a.id}`,
        name: a.name,
        splashUrl: raidSplashUrl(a.splash),
        isSunset: a.isSunset
    }))

export function getAllPantheonFamilies(): PantheonFamily[] {
    return allPantheonFamilies
}

const pantheonReleaseOrder = new Map<string, number>()
for (const a of seed.activities as SeedActivity[]) {
    if (isPantheon(a) && a.releaseDate) {
        pantheonReleaseOrder.set(`pantheon:${a.id}`, new Date(a.releaseDate).getTime())
    }
}

export function pantheonReleaseTime(groupKey: string): number {
    return pantheonReleaseOrder.get(groupKey) ?? 0
}
