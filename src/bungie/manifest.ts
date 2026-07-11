import { bungieGet } from "./client"
import type { ManifestItemDef } from "./types"

const SLOT_MAP: Record<number, ManifestItemDef["equipmentSlot"]> = {
    1498876634: "Kinetic",
    2465295065: "Energy",
    953998645: "Power",
}

const CACHE_KEY = "manifest-items-v1"
const memCache = new Map<number, ManifestItemDef>()

try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}")
    for (const [k, v] of Object.entries(stored)) memCache.set(Number(k), v as ManifestItemDef)
} catch { /* ignore */ }

let dirty = false

function persist() {
    if (!dirty) return
    try {
        const obj: Record<number, ManifestItemDef> = {}
        for (const [k, v] of memCache) obj[k] = v
        localStorage.setItem(CACHE_KEY, JSON.stringify(obj))
        dirty = false
    } catch { /* full */ }
}

export async function resolveItem(hash: number): Promise<ManifestItemDef> {
    const cached = memCache.get(hash)
    if (cached) return cached

    try {
        const def = await bungieGet<{
            displayProperties: { name: string; icon?: string }
            itemTypeDisplayName?: string
            equippingBlock?: { equipmentSlotTypeHash: number }
        }>(`/Destiny2/Manifest/DestinyInventoryItemDefinition/${hash}/`)

        const slot = def.equippingBlock?.equipmentSlotTypeHash
        const item: ManifestItemDef = {
            hash,
            name: def.displayProperties.name || `Item ${hash}`,
            icon: def.displayProperties.icon
                ? `https://www.bungie.net${def.displayProperties.icon}`
                : null,
            itemTypeDisplayName: def.itemTypeDisplayName ?? "",
            equipmentSlot: slot ? (SLOT_MAP[slot] ?? "Unknown") : "Unknown",
        }
        memCache.set(hash, item)
        dirty = true
        return item
    } catch {
        const fallback: ManifestItemDef = {
            hash,
            name: `Unknown Weapon`,
            icon: null,
            itemTypeDisplayName: "",
            equipmentSlot: "Unknown",
        }
        return fallback
    }
}

export async function resolveItems(hashes: number[]): Promise<Map<number, ManifestItemDef>> {
    const unique = [...new Set(hashes)]
    const results = await Promise.allSettled(unique.map(h => resolveItem(h)))
    const map = new Map<number, ManifestItemDef>()
    for (let i = 0; i < unique.length; i++) {
        const r = results[i]
        if (r.status === "fulfilled") map.set(unique[i], r.value)
    }
    persist()
    return map
}

// ---------------------------------------------------------------------------
// Class icons — fetched once from the manifest and cached forever
// ---------------------------------------------------------------------------

const CLASS_HASHES: Record<string, number> = {
    Titan: 3655393761,
    Hunter: 671679327,
    Warlock: 2271682572,
}

const CLASS_ICON_CACHE_KEY = "manifest-class-icons-v1"
let classIconCache: Record<string, string> = {}
try {
    classIconCache = JSON.parse(localStorage.getItem(CLASS_ICON_CACHE_KEY) ?? "{}")
} catch { /* ignore */ }

export function getCachedClassIcon(className: string): string | null {
    return classIconCache[className] ?? null
}

export async function resolveClassIcons(): Promise<Record<string, string>> {
    if (Object.keys(classIconCache).length >= 3) return classIconCache

    const entries = Object.entries(CLASS_HASHES)
    const results = await Promise.allSettled(
        entries.map(([, hash]) =>
            bungieGet<{ displayProperties: { icon?: string } }>(
                `/Destiny2/Manifest/DestinyClassDefinition/${hash}/`
            )
        )
    )
    for (let i = 0; i < entries.length; i++) {
        const r = results[i]
        if (r.status === "fulfilled" && r.value.displayProperties.icon) {
            classIconCache[entries[i][0]] = `https://www.bungie.net${r.value.displayProperties.icon}`
        }
    }
    try {
        localStorage.setItem(CLASS_ICON_CACHE_KEY, JSON.stringify(classIconCache))
    } catch { /* full */ }
    return classIconCache
}

export async function resolveActivityName(hash: number): Promise<string | null> {
    return (await resolveActivityInfo(hash)).name
}

export interface ActivityInfo {
    name: string | null
    /** Full URL of the activity's wide pgcr banner image, or null. */
    image: string | null
}

// Activity name/banner lookups persist across sessions (definitions are
// effectively immutable per hash), so history rows label instantly on relaunch.
const ACTIVITY_INFO_CACHE_KEY = "manifest-activity-info-v1"
const activityInfoCache = new Map<number, ActivityInfo>()

try {
    const stored = JSON.parse(localStorage.getItem(ACTIVITY_INFO_CACHE_KEY) ?? "{}")
    for (const [k, v] of Object.entries(stored)) activityInfoCache.set(Number(k), v as ActivityInfo)
} catch { /* ignore */ }

let activityInfoFlush: ReturnType<typeof setTimeout> | null = null

function scheduleActivityInfoPersist() {
    if (activityInfoFlush) return
    activityInfoFlush = setTimeout(() => {
        activityInfoFlush = null
        try {
            const obj: Record<number, ActivityInfo> = {}
            for (const [k, v] of activityInfoCache) obj[k] = v
            localStorage.setItem(ACTIVITY_INFO_CACHE_KEY, JSON.stringify(obj))
        } catch { /* full */ }
    }, 1000)
}

/** Name + banner image for an activity hash (DestinyActivityDefinition). Cached. */
export async function resolveActivityInfo(hash: number): Promise<ActivityInfo> {
    const cached = activityInfoCache.get(hash)
    if (cached) return cached
    try {
        const def = await bungieGet<{
            displayProperties: { name: string }
            pgcrImage?: string
        }>(`/Destiny2/Manifest/DestinyActivityDefinition/${hash}/`)
        const info: ActivityInfo = {
            name: def.displayProperties.name || null,
            image: def.pgcrImage ? "https://www.bungie.net" + def.pgcrImage : null,
        }
        activityInfoCache.set(hash, info)
        scheduleActivityInfoPersist()
        return info
    } catch {
        return { name: null, image: null }
    }
}
