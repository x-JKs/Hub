import { bungieGet, bungieGetFresh, bungiePost, bungieStatsGet } from "./client"
import {
    ActivityHistoryEntry,
    ActivityHistoryResponse,
    AggregateActivityStatsResponse,
    AggregateHashStat,
    HistoricalStatsAccountResponse,
    UserInfoCard
} from "./types"

// ---------------------------------------------------------------------------
// Player search
// ---------------------------------------------------------------------------

/**
 * Search for players. Supports three input forms:
 * - "Name#1234"   → exact Bungie-name lookup
 * - "4611686..."  → direct membership ID lookup (all-digit string, 15+ chars)
 * - "partial"     → prefix search over global display names
 */
export async function searchPlayers(query: string): Promise<UserInfoCard[]> {
    const trimmed = query.trim()
    if (!trimmed) return []

    // Direct membership ID lookup
    if (/^\d{15,}$/.test(trimmed)) {
        return searchByMembershipId(trimmed)
    }

    const hashIndex = trimmed.lastIndexOf("#")
    if (hashIndex > 0 && hashIndex < trimmed.length - 1) {
        const name = trimmed.slice(0, hashIndex)
        const code = Number(trimmed.slice(hashIndex + 1))
        if (Number.isInteger(code)) {
            // Query BOTH endpoints: the exact-name Destiny search can miss whole
            // accounts (a legacy platform profile can own the name pair while the
            // player's real Epic/Steam account only surfaces elsewhere — see
            // KNOWN_ACCOUNT_LINKS). Then expand every hit through its linked
            // memberships and list each platform as its OWN row, like
            // raid.report's "Select player" picker — they are separate accounts
            // with separate stats.
            const [exactRes, prefixRes] = await Promise.allSettled([
                bungiePost<UserInfoCard[]>(
                    "/Destiny2/SearchDestinyPlayerByBungieName/-1/",
                    { displayName: name, displayNameCode: code }
                ),
                bungiePost<{
                    searchResults: {
                        bungieGlobalDisplayName: string
                        bungieGlobalDisplayNameCode: number
                        destinyMemberships: UserInfoCard[]
                    }[]
                }>("/User/Search/GlobalName/0/", { displayNamePrefix: name }),
            ])

            const pool: UserInfoCard[] = []
            if (exactRes.status === "fulfilled") pool.push(...(exactRes.value ?? []))
            if (prefixRes.status === "fulfilled") {
                for (const r of prefixRes.value.searchResults ?? []) {
                    if (
                        r.bungieGlobalDisplayName?.toLowerCase() === name.toLowerCase() &&
                        r.bungieGlobalDisplayNameCode === code
                    ) {
                        pool.push(...(r.destinyMemberships ?? []))
                    }
                }
            }
            if (pool.length > 0) {
                const byId = new Map<string, UserInfoCard>()
                for (const c of dedupe(pool)) byId.set(c.membershipId, c)
                const expansions = await Promise.allSettled(
                    [...byId.values()].map(c => getLinkedMemberships(c.membershipType, c.membershipId))
                )
                for (const r of expansions) {
                    if (r.status !== "fulfilled") continue
                    for (const m of r.value) {
                        if (!byId.has(m.membershipId)) {
                            byId.set(m.membershipId, {
                                membershipId: m.membershipId,
                                membershipType: m.membershipType,
                                displayName: name,
                                bungieGlobalDisplayName: name,
                                bungieGlobalDisplayNameCode: code,
                                crossSaveOverride: 0,
                                applicableMembershipTypes: [m.membershipType],
                            })
                        }
                    }
                }
                return [...byId.values()]
            }
        }
    }

    // Prefix search across all Bungie names.
    const res = await bungiePost<{
        searchResults: {
            bungieGlobalDisplayName: string
            bungieGlobalDisplayNameCode: number
            destinyMemberships: UserInfoCard[]
        }[]
    }>("/User/Search/GlobalName/0/", { displayNamePrefix: trimmed })

    return dedupe(
        res.searchResults
            .map(r => primaryMembership(r.destinyMemberships))
            .filter((c): c is UserInfoCard => Boolean(c))
    )
}

/** Look up a player by Destiny membership ID, trying all platform types. */
async function searchByMembershipId(id: string): Promise<UserInfoCard[]> {
    const types = [3, 6, 2, 1, 5] // Steam, Epic, PS, Xbox, Stadia
    const results = await Promise.allSettled(
        types.map(type =>
            bungieGet<{
                profile: { data: { userInfo: UserInfoCard } }
            }>(`/Destiny2/${type}/Profile/${id}/?components=100`)
        )
    )
    const cards: UserInfoCard[] = []
    for (const r of results) {
        if (r.status === "fulfilled" && r.value?.profile?.data?.userInfo) {
            cards.push(r.value.profile.data.userInfo)
        }
    }
    return dedupe(cards)
}

/** De-duplicate membership cards by membershipId, preserving order. */
function dedupe(cards: UserInfoCard[]): UserInfoCard[] {
    const seen = new Set<string>()
    return cards.filter(c => {
        if (!c || seen.has(c.membershipId)) return false
        seen.add(c.membershipId)
        return true
    })
}

/** Pick the cross-save primary membership from a set of platform memberships. */
function primaryMembership(card: UserInfoCard | UserInfoCard[]): UserInfoCard {
    const cards = Array.isArray(card) ? card : [card]
    return (
        cards.find(c => c.crossSaveOverride === 0 || c.crossSaveOverride === c.membershipType) ??
        cards[0]
    )
}

// ---------------------------------------------------------------------------
// Linked memberships — split-platform accounts (Yute-style aggregation)
// ---------------------------------------------------------------------------

export interface DestinyMembershipRef {
    membershipType: number
    membershipId: string
}

const linkedCache = new Map<string, DestinyMembershipRef[]>()

// Known same-player bridges that Bungie's data CANNOT express: the dev's Xbox
// profile lives on a separate Bungie.net account that happens to carry the same
// dump#4706 name, and Bungie's search index only knows the Xbox one — so no
// name lookup can discover the real (Epic+Steam) account from it. Yute solves
// this with a hardcoded membership id; this is the same escape hatch. Seeds are
// expanded through GetMembershipsById like any other membership.
const KNOWN_ACCOUNT_LINKS: Record<string, DestinyMembershipRef[]> = {
    // Xbox-only account → the real Epic+Steam account
    "4611686018556262084": [{ membershipType: 6, membershipId: "4611686018557225333" }],
    // and the reverse, so either entry point unions the full set
    "4611686018557225333": [{ membershipType: 1, membershipId: "4611686018556262084" }],
    "4611686018557199320": [{ membershipType: 1, membershipId: "4611686018556262084" }],
}

/**
 * Every Destiny membership belonging to the same player. Two layers:
 *
 * 1. GetMembershipsById — platforms linked to the same Bungie account. A split
 *    account WITHOUT cross-save keeps separate stats per platform, so a
 *    single-membership view can wildly undercount (Yute merges these too).
 * 2. Same-name expansion — a player can ALSO own a legacy platform profile on a
 *    separate Bungie account carrying the same name#code (e.g. an old Xbox
 *    profile). The exact-name and global-name searches surface those; every
 *    membership with the identical name#code is unioned in.
 *
 * The requested membership comes first; on failure this degrades gracefully
 * (worst case: just the requested membership).
 */
export async function getLinkedMemberships(
    membershipType: number,
    membershipId: string
): Promise<DestinyMembershipRef[]> {
    const cached = linkedCache.get(membershipId)
    if (cached) return cached

    const found = new Map<string, DestinyMembershipRef>()
    const add = (t: number | undefined, id: string | undefined) => {
        if (t != null && id) found.set(id, { membershipType: t, membershipId: id })
    }
    add(membershipType, membershipId)

    let name: string | null = null
    let code: number | null = null
    // The requested membership plus any known-bridge seeds, each expanded
    // through GetMembershipsById to pull in their whole Bungie account.
    const roots: DestinyMembershipRef[] = [
        { membershipType, membershipId },
        ...(KNOWN_ACCOUNT_LINKS[membershipId] ?? []),
    ]
    for (const root of roots) {
        try {
            const res = await bungieGet<{
                destinyMemberships?: Array<{
                    membershipType: number
                    membershipId: string
                    bungieGlobalDisplayName?: string
                    bungieGlobalDisplayNameCode?: number
                }>
            }>(`/User/GetMembershipsById/${root.membershipId}/${root.membershipType}/`)
            for (const m of res.destinyMemberships ?? []) {
                add(m.membershipType, m.membershipId)
                if (!name && m.bungieGlobalDisplayName && m.bungieGlobalDisplayNameCode != null) {
                    name = m.bungieGlobalDisplayName
                    code = m.bungieGlobalDisplayNameCode
                }
            }
        } catch { /* fall through with what we have */ }
    }

    if (name && code != null) {
        const [exactRes, prefixRes] = await Promise.allSettled([
            bungiePost<UserInfoCard[]>(
                "/Destiny2/SearchDestinyPlayerByBungieName/-1/",
                { displayName: name, displayNameCode: code }
            ),
            bungiePost<{
                searchResults: {
                    bungieGlobalDisplayName: string
                    bungieGlobalDisplayNameCode: number
                    destinyMemberships: UserInfoCard[]
                }[]
            }>("/User/Search/GlobalName/0/", { displayNamePrefix: name }),
        ])
        if (exactRes.status === "fulfilled") {
            for (const c of exactRes.value ?? []) add(c.membershipType, c.membershipId)
        }
        if (prefixRes.status === "fulfilled") {
            for (const r of prefixRes.value.searchResults ?? []) {
                if (
                    r.bungieGlobalDisplayName?.toLowerCase() === name.toLowerCase() &&
                    r.bungieGlobalDisplayNameCode === code
                ) {
                    for (const c of r.destinyMemberships ?? []) add(c.membershipType, c.membershipId)
                }
            }
        }
    }

    const self = found.get(membershipId)!
    const list = [self, ...[...found.values()].filter(m => m.membershipId !== membershipId)]
    linkedCache.set(membershipId, list)
    return list
}

/** Merge per-platform aggregate stats: totals sum, fastest takes the minimum. */
export function mergeAggregates(lists: AggregateHashStat[][]): AggregateHashStat[] {
    const byHash = new Map<number, AggregateHashStat>()
    for (const list of lists) {
        for (const a of list) {
            const cur = byHash.get(a.hash)
            if (!cur) {
                byHash.set(a.hash, { ...a })
                continue
            }
            cur.clears += a.clears
            cur.kills += a.kills
            cur.deaths += a.deaths
            cur.assists += a.assists
            cur.timeSeconds += a.timeSeconds
            if (a.fastestSeconds !== null) {
                cur.fastestSeconds = cur.fastestSeconds === null
                    ? a.fastestSeconds
                    : Math.min(cur.fastestSeconds, a.fastestSeconds)
            }
        }
    }
    return [...byHash.values()]
}

// ---------------------------------------------------------------------------
// Live profile (current activity, characters, equipment) — API key only
// ---------------------------------------------------------------------------

export interface LiveCharacter {
    characterId: string
    classType: number
    className: string
    light: number
    emblemPath: string
    emblemBgPath: string
    dateLastPlayed: string
    currentActivityHash: number
    dateActivityStarted: string
    equippedItems: number[]
}

export interface LivePartyMember {
    membershipId: string
    membershipType?: number
    displayName: string
    emblemHash: number
    status: number
}

export interface LiveProfile {
    displayName: string
    dateLastPlayed: string
    characters: LiveCharacter[]
    partyMembers: LivePartyMember[]
    isOnline: boolean
}

const CLASS_NAMES: Record<number, string> = { 0: "Titan", 1: "Hunter", 2: "Warlock" }

export async function getLiveProfile(
    membershipType: number,
    membershipId: string
): Promise<LiveProfile> {
    const res = await bungieGetFresh<{
        profile: { data: { dateLastPlayed: string; userInfo?: { displayName?: string; bungieGlobalDisplayName?: string; bungieGlobalDisplayNameCode?: number } } }
        characters: {
            data: Record<string, {
                characterId: string
                classType: number
                light: number
                emblemPath: string
                emblemBackgroundPath: string
                dateLastPlayed: string
            }>
        }
        characterActivities?: {
            data: Record<string, {
                currentActivityHash: number
                dateActivityStarted: string
            }>
        }
        characterEquipment?: {
            data: Record<string, {
                items: Array<{ itemHash: number; bucketHash: number }>
            }>
        }
        profileTransitoryData?: {
            data: {
                partyMembers: Array<{
                    membershipId: string
                    membershipType?: number
                    emblemHash: number
                    displayName: string
                    status: number
                }>
            }
        }
    }>(`/Destiny2/${membershipType}/Profile/${membershipId}/?components=100,200,204,205,1000`)

    const chars = Object.values(res.characters?.data ?? {})
        .sort((a, b) => new Date(b.dateLastPlayed).getTime() - new Date(a.dateLastPlayed).getTime())

    const activities = res.characterActivities?.data ?? {}
    const equipment = res.characterEquipment?.data ?? {}
    const transitory = res.profileTransitoryData?.data

    const characters: LiveCharacter[] = chars.map(c => ({
        characterId: c.characterId,
        classType: c.classType,
        className: CLASS_NAMES[c.classType] ?? "Unknown",
        light: c.light,
        emblemPath: c.emblemPath,
        emblemBgPath: c.emblemBackgroundPath,
        dateLastPlayed: c.dateLastPlayed,
        currentActivityHash: activities[c.characterId]?.currentActivityHash ?? 0,
        dateActivityStarted: activities[c.characterId]?.dateActivityStarted ?? "",
        equippedItems: (equipment[c.characterId]?.items ?? []).map(i => i.itemHash),
    }))

    // Online = transitory data present. Bungie only returns component 1000 while
    // the player is actually in a session; currentActivityHash is NOT a valid
    // online signal — it persists with its dateActivityStarted after logoff until
    // that character next logs in (which made finished activities show for hours).
    // The hook layers a dateLastPlayed-recency fallback on top for players whose
    // privacy settings hide transitory data.
    const isOnline = transitory != null

    const ui = res.profile?.data?.userInfo
    const globalName = ui?.bungieGlobalDisplayName && ui.bungieGlobalDisplayNameCode != null
        ? `${ui.bungieGlobalDisplayName}#${String(ui.bungieGlobalDisplayNameCode).padStart(4, "0")}`
        : null

    return {
        displayName: globalName ?? ui?.displayName ?? "",
        dateLastPlayed: res.profile?.data?.dateLastPlayed ?? "",
        characters,
        partyMembers: (transitory?.partyMembers ?? []).filter(p => p.membershipId !== membershipId),
        isOnline,
    }
}

// ---------------------------------------------------------------------------
// Detailed character loadout (equipment + sockets/mods)
// ---------------------------------------------------------------------------

export interface EquippedItem {
    itemHash: number
    itemInstanceId: string
    bucketHash: number
    sockets: number[]
}

export interface CharacterLoadout {
    characterId: string
    className: string
    light: number
    emblemPath: string
    items: EquippedItem[]
}

export async function getCharacterLoadout(
    membershipType: number,
    membershipId: string,
    characterId?: string
): Promise<CharacterLoadout> {
    const res = await bungieGet<{
        characters: {
            data: Record<string, {
                characterId: string
                classType: number
                light: number
                emblemPath: string
                dateLastPlayed: string
            }>
        }
        characterEquipment: {
            data: Record<string, {
                items: Array<{ itemHash: number; itemInstanceId: string; bucketHash: number }>
            }>
        }
        itemComponents?: {
            sockets?: {
                data?: Record<string, {
                    sockets: Array<{ plugHash?: number; isEnabled?: boolean; isVisible?: boolean }>
                }>
            }
        }
    }>(`/Destiny2/${membershipType}/Profile/${membershipId}/?components=200,205,305`)

    const chars = Object.values(res.characters?.data ?? {})
        .sort((a, b) => new Date(b.dateLastPlayed).getTime() - new Date(a.dateLastPlayed).getTime())

    const target = characterId
        ? chars.find(c => c.characterId === characterId) ?? chars[0]
        : chars[0]

    if (!target) throw new Error("No characters found")

    const rawItems = res.characterEquipment?.data?.[target.characterId]?.items ?? []
    const socketData = res.itemComponents?.sockets?.data ?? {}

    const items: EquippedItem[] = rawItems.map(i => {
        const sockets = (socketData[i.itemInstanceId]?.sockets ?? [])
            .filter(s => s.plugHash && s.plugHash !== 0 && s.isEnabled !== false && s.isVisible !== false)
            .map(s => s.plugHash!)
        return {
            itemHash: i.itemHash,
            itemInstanceId: i.itemInstanceId,
            bucketHash: i.bucketHash,
            sockets,
        }
    })

    return {
        characterId: target.characterId,
        className: CLASS_NAMES[target.classType] ?? "Unknown",
        light: target.light,
        emblemPath: target.emblemPath,
        items,
    }
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export interface PlayerCharacters {
    /** Every character the account has ever had, including deleted ones. */
    all: string[]
    /** Currently-existing characters (deleted ones excluded). */
    current: string[]
}

/**
 * Resolve a player's character IDs. The account stats endpoint (unlike the
 * profile) lists DELETED characters too — querying their AggregateActivityStats
 * recovers lifetime clears the profile omits, matching raid.report's totals.
 */
export async function getCharacters(
    membershipType: number,
    membershipId: string
): Promise<PlayerCharacters> {
    const res = await bungieGet<HistoricalStatsAccountResponse>(
        `/Destiny2/${membershipType}/Account/${membershipId}/Stats/?groups=General`
    )
    const characters = res.characters ?? []
    if (characters.length === 0) {
        throw new Error("This profile is private or has no characters.")
    }
    return {
        all: characters.map(c => c.characterId),
        current: characters.filter(c => !c.deleted).map(c => c.characterId)
    }
}

// ---------------------------------------------------------------------------
// Activity history
// ---------------------------------------------------------------------------

const PAGE_SIZE = 250

/**
 * Fetch a character's activity history for a given mode, walking pages until we
 * reach activities older than `notBefore` (or run out). Newest first.
 */
export async function getActivityHistory(
    membershipType: number,
    membershipId: string,
    characterId: string,
    mode: number,
    notBefore: Date
): Promise<ActivityHistoryEntry[]> {
    const all: ActivityHistoryEntry[] = []
    for (let page = 0; ; page++) {
        const res = await bungieGetFresh<ActivityHistoryResponse>(
            `/Destiny2/${membershipType}/Account/${membershipId}/Character/${characterId}/Stats/Activities/` +
                `?mode=${mode}&count=${PAGE_SIZE}&page=${page}`
        )
        const activities = res.activities ?? []
        if (activities.length === 0) break

        all.push(...activities)

        const oldest = activities[activities.length - 1]
        if (new Date(oldest.period) < notBefore) break // past the window
        if (activities.length < PAGE_SIZE) break // last page
    }
    return all
}

/**
 * Current activity across the player's characters, picked by the most recent
 * `dateActivityStarted` (component 204 only — light and near real-time). Returns
 * activityHash 0 when the player is in orbit / no activity.
 */
export interface CurrentActivity {
    activityHash: number
    startDate: string
    /** Bungie DestinyActivityModeType. 0/None (or absent) = orbit / not in an activity. */
    modeType: number
}

export async function getCurrentActivity(
    membershipType: number,
    membershipId: string
): Promise<CurrentActivity | null> {
    const res = await bungieGetFresh<{
        characterActivities?: {
            data?: Record<string, {
                currentActivityHash: number
                dateActivityStarted: string
                currentActivityModeType?: number
            }>
        }
    }>(`/Destiny2/${membershipType}/Profile/${membershipId}/?components=204`)

    const data = res.characterActivities?.data
    if (!data) return null

    // Matches Yute's UpdateCurrent: among characters, the one actually IN an
    // activity (valid non-zero hash) wins over one sitting in orbit; ties break on
    // the most-recently-started. If every character is in orbit we still return the
    // newest (hash 0) so the caller treats it as orbit.
    let best: { currentActivityHash: number; dateActivityStarted: string; currentActivityModeType?: number } | null = null
    for (const a of Object.values(data)) {
        if (!best) { best = a; continue }
        const aValid = (a.currentActivityHash ?? 0) !== 0
        const bValid = (best.currentActivityHash ?? 0) !== 0
        if (aValid !== bValid) { if (aValid) best = a; continue }
        if (new Date(a.dateActivityStarted) > new Date(best.dateActivityStarted)) best = a
    }
    if (!best) return null
    return {
        activityHash: best.currentActivityHash,
        startDate: best.dateActivityStarted,
        modeType: best.currentActivityModeType ?? 0,
    }
}

export interface RecentActivity {
    instanceId: string
    referenceId: number
    period: string
    completed: boolean
    durationSeconds: number
    durationDisplay: string
    modes: number[]
}

/**
 * The single most recent COMPLETED activity, across the player's characters.
 * Used by the overlay to detect a fresh completion and toast it. Queries mode=7
 * (AllPvE — raids, dungeons, strikes, story, etc.), first page only.
 */
export async function getLatestCompletedActivity(
    membershipType: number,
    membershipId: string,
    characterIds: string[]
): Promise<RecentActivity | null> {
    const perChar = await Promise.all(
        characterIds.map(cid =>
            bungieGetFresh<ActivityHistoryResponse>(
                `/Destiny2/${membershipType}/Account/${membershipId}/Character/${cid}/Stats/Activities/` +
                    `?mode=7&count=25&page=0`
            ).catch(() => ({ activities: [] as ActivityHistoryEntry[] }))
        )
    )

    let best: RecentActivity | null = null
    for (const res of perChar) {
        for (const a of res.activities ?? []) {
            const completedFlag = a.values.completed?.basic.value === 1
            const reason = a.values.completionReason?.basic.value
            const completed = completedFlag && (reason === undefined || reason === 0)
            if (!completed) continue
            const rec: RecentActivity = {
                instanceId: a.activityDetails.instanceId,
                referenceId: a.activityDetails.referenceId,
                period: a.period,
                completed: true,
                durationSeconds: a.values.activityDurationSeconds?.basic.value ?? 0,
                durationDisplay: a.values.activityDurationSeconds?.basic.displayValue ?? "",
                modes: a.activityDetails.modes ?? [],
            }
            if (!best || new Date(rec.period) > new Date(best.period)) best = rec
        }
    }
    return best
}

// ---------------------------------------------------------------------------
// Aggregate (lifetime) activity stats
// ---------------------------------------------------------------------------

/**
 * Lifetime per-activity totals (clears, kills, time, fastest, …), summed across
 * all of a player's characters. This is the accurate all-time source — the
 * activity history above only retains a recent rolling window.
 */
export async function getAggregateActivityStats(
    membershipType: number,
    membershipId: string,
    characterIds: string[]
): Promise<AggregateHashStat[]> {
    const perChar = await Promise.all(
        characterIds.map(cid =>
            bungieGet<AggregateActivityStatsResponse>(
                `/Destiny2/${membershipType}/Account/${membershipId}/Character/${cid}/Stats/AggregateActivityStats/`
            )
        )
    )

    const byHash = new Map<number, AggregateHashStat>()
    for (const res of perChar) {
        for (const a of res.activities ?? []) {
            const v = a.values
            const clears = v.activityCompletions?.basic.value ?? 0
            const cur = byHash.get(a.activityHash) ?? {
                hash: a.activityHash,
                clears: 0,
                kills: 0,
                deaths: 0,
                assists: 0,
                timeSeconds: 0,
                fastestSeconds: null
            }
            cur.clears += clears
            cur.kills += v.activityKills?.basic.value ?? 0
            cur.deaths += v.activityDeaths?.basic.value ?? 0
            cur.assists += v.activityAssists?.basic.value ?? 0
            cur.timeSeconds += v.activitySecondsPlayed?.basic.value ?? 0
            const fastMs = v.fastestCompletionMsForActivity?.basic.value ?? 0
            if (fastMs > 0 && clears > 0) {
                const sec = fastMs / 1000
                cur.fastestSeconds = cur.fastestSeconds === null ? sec : Math.min(cur.fastestSeconds, sec)
            }
            byHash.set(a.activityHash, cur)
        }
    }
    return [...byHash.values()]
}

// ---------------------------------------------------------------------------
// PGCR freshness (fresh full clear vs checkpoint)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Linked profiles (cross-save / platform accounts)
// ---------------------------------------------------------------------------

export async function getLinkedProfiles(
    membershipType: number,
    membershipId: string
): Promise<UserInfoCard[]> {
    const res = await bungieGet<{
        profiles: Array<{
            membershipType: number
            membershipId: string
            displayName: string
            bungieGlobalDisplayName?: string
            bungieGlobalDisplayNameCode?: number
            iconPath?: string
            crossSaveOverride: number
            applicableMembershipTypes: number[]
            isCrossSavePrimary: boolean
            isPublic: boolean
            dateLastPlayed?: string
        }>
    }>(`/Destiny2/${membershipType}/Profile/${membershipId}/LinkedProfiles/?getAllMemberships=true`)

    return (res.profiles ?? [])
        .filter(p => p.isPublic)
        .map(p => ({
            membershipId: p.membershipId,
            membershipType: p.membershipType,
            displayName: p.displayName,
            bungieGlobalDisplayName: p.bungieGlobalDisplayName,
            bungieGlobalDisplayNameCode: p.bungieGlobalDisplayNameCode,
            iconPath: p.iconPath,
            crossSaveOverride: p.crossSaveOverride ?? 0,
            applicableMembershipTypes: p.applicableMembershipTypes ?? [],
        }))
}

// ---------------------------------------------------------------------------
// Full PGCR
// ---------------------------------------------------------------------------

import type { PgcrResponse } from "./types"

export async function getFullPgcr(instanceId: string): Promise<PgcrResponse> {
    return bungieStatsGet<PgcrResponse>(
        `/Destiny2/Stats/PostGameCarnageReport/${instanceId}/`
    )
}

// PGCRs are immutable, so cache freshness by instanceId across sessions.
const PGCR_CACHE_KEY = "pgcr-fresh-v3"
const pgcrCache: Record<string, boolean> = (() => {
    try {
        return JSON.parse(localStorage.getItem(PGCR_CACHE_KEY) ?? "{}")
    } catch {
        return {}
    }
})()
let pgcrDirty = false

/** Persist the PGCR freshness cache (call after a batch of lookups). */
export function flushPgcrCache() {
    if (!pgcrDirty) return
    try {
        localStorage.setItem(PGCR_CACHE_KEY, JSON.stringify(pgcrCache))
        pgcrDirty = false
    } catch {
        /* storage full / unavailable */
    }
}

/**
 * Whether an instance was started from the beginning (a fresh full clear) vs a
 * checkpoint. Reads the PGCR's `activityWasStartedFromBeginning` flag.
 * Returns null if it can't be determined.
 */
export async function getPgcrFresh(instanceId: string): Promise<boolean | null> {
    if (instanceId in pgcrCache) return pgcrCache[instanceId]
    try {
        const res = await bungieStatsGet<{ activityWasStartedFromBeginning?: boolean }>(
            `/Destiny2/Stats/PostGameCarnageReport/${instanceId}/`
        )
        const fresh = res.activityWasStartedFromBeginning
        if (typeof fresh === "boolean") {
            pgcrCache[instanceId] = fresh
            pgcrDirty = true
            return fresh
        }
        return null
    } catch {
        return null
    }
}

// Flawless is a fresh full clear where the ENTIRE fireteam had zero deaths — not
// just the inspected player. Cached separately from freshness.
const FLAWLESS_CACHE_KEY = "pgcr-flawless-v1"
const flawlessCache: Record<string, boolean> = (() => {
    try {
        return JSON.parse(localStorage.getItem(FLAWLESS_CACHE_KEY) ?? "{}")
    } catch {
        return {}
    }
})()
let flawlessDirty = false

export function flushFlawlessCache() {
    if (!flawlessDirty) return
    try {
        localStorage.setItem(FLAWLESS_CACHE_KEY, JSON.stringify(flawlessCache))
        flawlessDirty = false
    } catch {
        /* storage full / unavailable */
    }
}

/**
 * True only if the instance is a fresh full clear AND every fireteam member
 * finished with 0 deaths (a real flawless). Returns null when freshness can't be
 * determined (old PGCRs missing the flag).
 */
export async function getPgcrFlawless(instanceId: string): Promise<boolean | null> {
    if (instanceId in flawlessCache) return flawlessCache[instanceId]
    try {
        const res = await bungieStatsGet<{
            activityWasStartedFromBeginning?: boolean
            entries?: { values?: Record<string, { basic?: { value?: number } }> }[]
        }>(`/Destiny2/Stats/PostGameCarnageReport/${instanceId}/`)

        const fresh = res.activityWasStartedFromBeginning
        if (typeof fresh !== "boolean") return null // can't confirm freshness

        const teamDeaths = (res.entries ?? []).reduce(
            (sum, e) => sum + (e.values?.deaths?.basic?.value ?? 0),
            0
        )
        const flawless = fresh && teamDeaths === 0
        flawlessCache[instanceId] = flawless
        flawlessDirty = true
        return flawless
    } catch {
        return null
    }
}
