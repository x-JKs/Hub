// Dungeon grouping + art, from the bundled Bungie-derived dungeon table.
// Mirrors raids.ts: maps a raw Bungie activity hash to a dungeon "family"
// (grouping Master/Normal variants) plus its splash art.

import { bungieAsset } from "../bungie/client"
import dungeonSeed from "./dungeonSeed.json"

export interface DungeonHashInfo {
    /** Family name, e.g. "Spire of the Watcher" (suffix stripped). */
    name: string
    versionName: string
    splashUrl: string | null
}

const SUFFIX = /\s*[:(]?\s*(Grandmaster|Master|Legendary|Legend|Normal|Standard|Expert|Contest|Explorer|Eternity|Ultimatum)\)?$/i

/** Split a Bungie dungeon activity name into its family + difficulty. */
export function parseDungeonName(raw: string): { base: string; version: string } {
    const m = raw.match(SUFFIX)
    if (!m) return { base: raw.trim(), version: "Standard" }
    const v = m[1].toLowerCase()
    const version =
        v === "normal" || v === "standard"
            ? "Standard"
            : m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()
    return { base: raw.replace(SUFFIX, "").trim(), version }
}

const dungeonByHashMap = new Map<number, DungeonHashInfo>()
for (const d of dungeonSeed.dungeons) {
    const { base, version } = parseDungeonName(d.name)
    dungeonByHashMap.set(d.hash, {
        name: base,
        versionName: version,
        splashUrl: bungieAsset(d.pgcrImage)
    })
}

export function dungeonByHash(hash: number): DungeonHashInfo | undefined {
    return dungeonByHashMap.get(hash)
}

const DUNGEON_RELEASE: Record<string, string> = {
    "The Shattered Throne": "2018-09-25",
    "Pit of Heresy": "2019-10-29",
    "Prophecy": "2020-06-09",
    "Grasp of Avarice": "2021-12-07",
    "Duality": "2022-05-27",
    "Spire of the Watcher": "2022-12-09",
    "Ghosts of the Deep": "2023-05-26",
    "Warlord's Ruin": "2023-12-01",
    "Vesper's Host": "2024-10-11",
    "Sundered Doctrine": "2025-02-14",
    "Equilibrium": "2025-10-07"
}

export function dungeonReleaseTime(groupKey: string): number {
    const name = groupKey.replace(/^dungeon:/, "")
    const date = DUNGEON_RELEASE[name]
    return date ? new Date(date).getTime() : 0
}

export interface DungeonFamily {
    groupKey: string
    name: string
    splashUrl: string | null
}

const allDungeonFamilies: DungeonFamily[] = []
const seenNames = new Set<string>()
for (const d of dungeonSeed.dungeons) {
    const { base } = parseDungeonName(d.name)
    if (seenNames.has(base)) continue
    seenNames.add(base)
    allDungeonFamilies.push({
        groupKey: `dungeon:${base}`,
        name: base,
        splashUrl: bungieAsset(d.pgcrImage)
    })
}

export function getAllDungeonFamilies(): DungeonFamily[] {
    return allDungeonFamilies
}
