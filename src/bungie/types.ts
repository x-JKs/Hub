// Minimal typings for the slices of the Bungie API responses we consume.

export interface UserInfoCard {
    membershipId: string
    membershipType: number
    displayName: string
    bungieGlobalDisplayName?: string
    bungieGlobalDisplayNameCode?: number
    iconPath?: string
    crossSaveOverride: number
    applicableMembershipTypes: number[]
}

/** GET /Destiny2/{type}/Profile/{id}/?components=100 (Profiles) */
export interface DestinyProfileResponse {
    profile: {
        data?: {
            userInfo: UserInfoCard
            characterIds: string[]
            dateLastPlayed: string
        }
    }
}

/** A single stat value in the Bungie "values" bag. */
interface ActivityStatValue {
    basic: { value: number; displayValue: string }
}

export interface ActivityHistoryEntry {
    period: string // ISO date the activity was played
    activityDetails: {
        referenceId: number
        directorActivityHash: number
        instanceId: string
        mode: number
        modes: number[]
        isPrivate: boolean
    }
    values: Record<string, ActivityStatValue>
}

export interface ActivityHistoryResponse {
    activities?: ActivityHistoryEntry[]
}

/** GET /Destiny2/Manifest/DestinyActivityDefinition/{hash}/ */
export interface DestinyActivityDefinition {
    displayProperties: { name: string; description: string; icon?: string }
    pgcrImage?: string
    activityTypeHash: number
    hash: number
}

/** GET /Destiny2/{type}/Account/{id}/Stats/ — includes deleted characters.
 *  This is how we discover deleted character IDs so their lifetime clears (which
 *  the profile endpoint omits) can be folded into the aggregate totals. */
export interface HistoricalStatsAccountResponse {
    characters?: { characterId: string; deleted: boolean }[]
}

/** GET /Destiny2/{type}/Account/{id}/Character/{cid}/Stats/AggregateActivityStats/ */
export interface AggregateActivityStatsResponse {
    activities?: {
        activityHash: number
        values: Record<string, { basic: { value: number } }>
    }[]
}

/** Per-activity-hash lifetime totals, summed across a player's characters. */
export interface AggregateHashStat {
    hash: number
    clears: number
    kills: number
    deaths: number
    assists: number
    timeSeconds: number
    fastestSeconds: number | null
}

/** Bungie activity mode enum values we care about. */
export const ActivityMode = {
    Raid: 4,
    Dungeon: 82
} as const

/** Full Post Game Carnage Report */
export interface PgcrResponse {
    period: string
    activityDetails: {
        referenceId: number
        directorActivityHash: number
        instanceId: string
        mode: number
        modes: number[]
        isPrivate: boolean
    }
    startingPhaseIndex: number
    activityWasStartedFromBeginning?: boolean
    entries: PgcrEntry[]
}

export interface PgcrEntry {
    standing: number
    player: {
        destinyUserInfo: {
            membershipType: number
            membershipId: string
            displayName: string
            bungieGlobalDisplayName?: string
            bungieGlobalDisplayNameCode?: number
            iconPath?: string
        }
        characterClass: string
        classHash: number
        lightLevel: number
        emblemHash: number
    }
    characterId: string
    values: Record<string, { basic: { value: number; displayValue: string } }>
    extended?: {
        values?: Record<string, { basic: { value: number; displayValue: string } }>
        weapons?: PgcrWeapon[]
    }
}

export interface PgcrWeapon {
    referenceId: number
    values: Record<string, { basic: { value: number; displayValue: string } }>
}

/** Resolved item definition from the manifest */
export interface ManifestItemDef {
    hash: number
    name: string
    icon: string | null
    itemTypeDisplayName: string
    equipmentSlot: "Kinetic" | "Energy" | "Power" | "Unknown"
}
