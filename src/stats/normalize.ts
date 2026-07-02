// Turn raw Bungie activity-history entries into normalized ActivityRun objects.

import { ActivityHistoryEntry } from "../bungie/types"
import { dungeonByHash } from "../manifest/dungeons"
import { raidByHash, raidSplashUrl } from "../manifest/raids"
import { pantheonByHash } from "../manifest/pantheons"
import { ActivityRun } from "./compute"

function isCompleted(entry: ActivityHistoryEntry): boolean {
    const completedFlag = entry.values.completed?.basic.value === 1
    const reason = entry.values.completionReason?.basic.value
    // completionReason 0 = objective complete. Missing reason → trust the flag.
    return completedFlag && (reason === undefined || reason === 0)
}

const num = (entry: ActivityHistoryEntry, key: string) => entry.values[key]?.basic.value ?? 0

/**
 * @param isRaidMode whether these entries came from the Raid mode query.
 * Raids group/label via the RaidHub seed; dungeons via the bundled dungeon
 * table. Both use the same hash→family mapping as the lifetime aggregate, so
 * the recent-history and all-time data join cleanly by groupKey.
 */
export function normalizeRuns(entries: ActivityHistoryEntry[], isRaidMode: boolean): ActivityRun[] {
    const runs: ActivityRun[] = []
    for (const entry of entries) {
        const hash = entry.activityDetails.referenceId
        const date = new Date(entry.period)
        const completed = isCompleted(entry)
        const common = {
            instanceId: entry.activityDetails.instanceId,
            date,
            durationSeconds: num(entry, "activityDurationSeconds"),
            completed,
            playerCount: num(entry, "playerCount") || 0,
            kills: num(entry, "kills"),
            deaths: num(entry, "deaths"),
            assists: num(entry, "assists")
        }

        if (isRaidMode) {
            // Bungie's raid-mode history contains raids AND Pantheon. Classify
            // each; skip anything unmapped (exotic missions, etc.) so it can't
            // pollute raid stats. Mirrors the aggregate path.
            const raid = raidByHash(hash)
            if (raid) {
                runs.push({
                    ...common,
                    category: "raid",
                    groupKey: `raid:${raid.activityId}`,
                    groupName: raid.name,
                    splashUrl: raidSplashUrl(raid.splashSlug),
                    versionName: raid.versionName,
                    isDayOne: completed && !!raid.contestEnd && date <= raid.contestEnd
                })
                continue
            }
            const pantheon = pantheonByHash(hash)
            if (pantheon) {
                runs.push({
                    ...common,
                    category: "pantheon",
                    groupKey: `pantheon:${pantheon.activityId}`,
                    groupName: pantheon.name,
                    splashUrl: raidSplashUrl(pantheon.splashSlug),
                    versionName: pantheon.versionName,
                    isDayOne: false
                })
            }
            continue
        }

        const dungeon = dungeonByHash(hash)
        if (!dungeon) continue
        runs.push({
            ...common,
            category: "dungeon",
            groupKey: `dungeon:${dungeon.name}`,
            groupName: dungeon.name,
            splashUrl: dungeon.splashUrl,
            versionName: dungeon.versionName,
            isDayOne: false
        })
    }
    return runs
}
