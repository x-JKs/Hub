import { useCallback, useEffect, useRef, useState } from "react"
import { getCurrentActivity, getLiveProfile, searchPlayers } from "../bungie/api"
import type { LiveCharacter, LivePartyMember } from "../bungie/api"
import { bungieAsset } from "../bungie/client"
import { resolveActivityInfo, resolveActivityName, resolveItems } from "../bungie/manifest"
import type { ManifestItemDef } from "../bungie/types"
import { raidByHash, raidSplashUrl } from "../manifest/raids"
import { dungeonByHash } from "../manifest/dungeons"
import { captureSnapshot } from "../lib/loadoutSnapshots"
import type { SelectedPlayer } from "./useActivities"

export interface LiveMember {
    membershipId: string
    membershipType: number
    displayName: string
    emblemUrl: string | null
    emblemBgUrl: string | null
    className: string
    light: number
    currentActivityName: string | null
    equippedItems: Map<number, ManifestItemDef>
}

export interface LiveActivityState {
    character: LiveCharacter | null
    emblemUrl: string | null
    emblemBgUrl: string | null
    activityName: string | null
    activityStarted: string | null
    /** Short mode label for the current activity ("Raid", "Dungeon", …). */
    activityModeLabel: string | null
    /** Splash/pgcr artwork URL for the current activity (Discord presence art). */
    activityImageUrl: string | null
    isOnline: boolean
    fireteam: LiveMember[]
    allCharacters: LiveCharacter[]
    loading: boolean
    error: string | null
}

const EMPTY: LiveActivityState = {
    character: null,
    emblemUrl: null,
    emblemBgUrl: null,
    activityName: null,
    activityStarted: null,
    activityModeLabel: null,
    activityImageUrl: null,
    isOnline: false,
    fireteam: [],
    allCharacters: [],
    loading: false,
    error: null,
}

const ORBIT_PATTERN = /\borbit\b/i

function quickActivityName(hash: number): string | null {
    if (!hash || hash === 0) return null
    const raid = raidByHash(hash)
    if (raid) return raid.name
    const dungeon = dungeonByHash(hash)
    if (dungeon) return dungeon.name
    return null
}

/** Curated splash art for the current activity (raids/dungeons), if known. */
function quickActivityImage(hash: number): string | null {
    if (!hash || hash === 0) return null
    const raid = raidByHash(hash)
    if (raid) return raidSplashUrl(raid.splashSlug)
    const dungeon = dungeonByHash(hash)
    if (dungeon) return dungeon.splashUrl
    return null
}

// Bungie DestinyActivityModeType → short human label (Yute's FormatModeLabel).
const MODE_LABELS: Record<number, string> = {
    2: "Story Mission",
    3: "Strike",
    4: "Raid",
    5: "Crucible",
    6: "Patrol",
    10: "Control",
    12: "Clash",
    16: "Nightfall",
    19: "Iron Banner",
    37: "Survival",
    40: "Social",
    46: "Nightfall",
    48: "Rumble",
    63: "Gambit",
    82: "Dungeon",
    84: "Trials of Osiris",
}

function isRecentlyOnline(dateStr: string): boolean {
    if (!dateStr) return false
    const diff = Date.now() - new Date(dateStr).getTime()
    return diff < 15 * 60 * 1000
}

export function useLiveActivity(player: SelectedPlayer | null, pollMs = 30_000): LiveActivityState {
    const [state, setState] = useState<LiveActivityState>(EMPTY)
    const timerRef = useRef<ReturnType<typeof setInterval>>()
    const abortRef = useRef(0)

    // Current activity start (owned by the fast poll) — the slow poll pairs it
    // with the equipment it just fetched to capture a loadout snapshot.
    const activityStartedRef = useRef<string | null>(null)

    const fetch = useCallback(async () => {
        if (!player) { setState(EMPTY); return }

        const id = ++abortRef.current
        try {
            const profile = await getLiveProfile(player.membershipType, player.membershipId)
            if (abortRef.current !== id) return

            const most = profile.characters[0] ?? null
            // Online = transitory data present (authoritative), with recency
            // fallbacks for privacy-hidden transitory: a fresh dateLastPlayed or a
            // freshly-started activity both prove a live session.
            const online = profile.isOnline
                || isRecentlyOnline(most?.dateLastPlayed ?? "")
                || isRecentlyOnline(most?.dateActivityStarted ?? "")

            // Loadout snapshot: what's equipped right now, keyed by the current
            // activity's start time (Yute's TryCaptureLoadoutSnapshot). Captured
            // once per activity start; lets PGCRs answer "what was I running?".
            if (online && activityStartedRef.current && most && most.equippedItems.length > 0) {
                captureSnapshot({
                    startedAt: activityStartedRef.current,
                    membershipId: player.membershipId,
                    characterClass: most.className,
                    itemHashes: most.equippedItems,
                })
            }

            // Resolve fireteam members (the heavy part — kept on the slow poll)
            const fireteam = await resolveFireteam(profile.partyMembers)
            if (abortRef.current !== id) return

            // activityName/activityStarted are owned by the fast current-activity
            // poll below (so the timer + activity update quickly); preserve them here.
            setState(s => ({
                ...s,
                character: most,
                emblemUrl: most ? bungieAsset(most.emblemPath) : null,
                emblemBgUrl: most ? bungieAsset(most.emblemBgPath) : null,
                isOnline: online,
                fireteam,
                allCharacters: profile.characters,
                loading: false,
                error: null,
            }))
        } catch (err) {
            if (abortRef.current !== id) return
            setState(s => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }))
        }
    }, [player?.membershipId, player?.membershipType])

    useEffect(() => {
        if (!player) { setState(EMPTY); return }
        setState(s => ({ ...s, loading: true, error: null }))
        fetch()
        if (pollMs > 0) {
            timerRef.current = setInterval(fetch, pollMs)
        }
        return () => { clearInterval(timerRef.current); abortRef.current++ }
    }, [fetch, pollMs])

    // Fast current-activity poll — drives the activity name + timer start so they
    // update within ~2s instead of waiting on the heavy 30s profile/fireteam poll.
    // Uses the light component-204 endpoint (most-recently-started character).
    useEffect(() => {
        if (!player) return
        let cancelled = false

        const poll = async () => {
            try {
                const cur = await getCurrentActivity(player.membershipType, player.membershipId)
                if (cancelled) return

                let activityName: string | null = null
                let activityImage: string | null = null
                if (cur && cur.activityHash !== 0 && cur.startDate) {
                    activityName = quickActivityName(cur.activityHash)
                    activityImage = quickActivityImage(cur.activityHash)
                    if (!activityName) {
                        // Manifest fallback resolves name AND pgcr artwork together.
                        const info = await resolveActivityInfo(cur.activityHash)
                        if (cancelled) return
                        if (info.name && !ORBIT_PATTERN.test(info.name)) {
                            activityName = info.name
                            activityImage = info.image
                        }
                    }
                }
                const modeLabel = cur ? MODE_LABELS[cur.modeType] ?? null : null
                const activityStarted = activityName ? (cur?.startDate ?? null) : null

                setState(s => {
                    // Bungie PERSISTS currentActivityHash + dateActivityStarted
                    // after logoff (until that character next logs in), so a bare
                    // hash is NOT proof of a live activity. Show it only when the
                    // slow poll says the player is online, or the activity started
                    // recently (a fresh start is itself proof of a live session).
                    const startedRecently = activityStarted
                        ? Date.now() - new Date(activityStarted).getTime() < 10 * 60 * 1000
                        : false
                    const live = !!activityName && (s.isOnline || startedRecently)
                    activityStartedRef.current = live ? activityStarted : null
                    return {
                        ...s,
                        activityName: live ? activityName : null,
                        activityStarted: live ? activityStarted : null,
                        activityModeLabel: live ? modeLabel : null,
                        activityImageUrl: live ? activityImage : null,
                        isOnline: live ? true : s.isOnline,
                    }
                })
            } catch { /* non-critical */ }
        }

        poll()
        const iv = setInterval(poll, 2_000)
        return () => { cancelled = true; clearInterval(iv) }
    }, [player?.membershipId, player?.membershipType])

    return state
}

async function resolveFireteam(members: LivePartyMember[]): Promise<LiveMember[]> {
    if (members.length === 0) return []

    const results: LiveMember[] = []
    const settled = await Promise.allSettled(
        members.map(async m => {
            let membershipType = m.membershipType
            let profile: Awaited<ReturnType<typeof getLiveProfile>> | null = null

            if (membershipType) {
                try { profile = await getLiveProfile(membershipType, m.membershipId) } catch {}
            }

            if (!profile) {
                const cards = await searchPlayers(m.membershipId)
                if (cards.length > 0) {
                    membershipType = cards[0].membershipType
                    try { profile = await getLiveProfile(membershipType!, m.membershipId) } catch {}
                }
            }

            const char = profile?.characters[0] ?? null
            const hash = char?.currentActivityHash ?? 0
            let actName: string | null = null
            if (hash !== 0) {
                actName = quickActivityName(hash)
                if (!actName) {
                    const resolved = await resolveActivityName(hash)
                    if (resolved && !ORBIT_PATTERN.test(resolved)) actName = resolved
                }
            }

            let equipped = new Map<number, ManifestItemDef>()
            if (char) {
                equipped = await resolveItems(char.equippedItems)
            }

            return {
                membershipId: m.membershipId,
                membershipType: membershipType ?? 0,
                displayName: profile?.displayName || m.displayName,
                emblemUrl: char ? bungieAsset(char.emblemPath) : null,
                emblemBgUrl: char ? bungieAsset(char.emblemBgPath) : null,
                className: char?.className ?? "",
                light: char?.light ?? 0,
                currentActivityName: actName,
                equippedItems: equipped,
            }
        })
    )

    for (const r of settled) {
        if (r.status === "fulfilled") results.push(r.value)
    }
    return results
}

// ---------------------------------------------------------------------------
// Default player persistence
// ---------------------------------------------------------------------------

const DEFAULT_KEY = "default-player"

export function getDefaultPlayer(): string {
    return localStorage.getItem(DEFAULT_KEY)?.trim() ?? ""
}

export function setDefaultPlayer(value: string) {
    const v = value.trim()
    if (v) localStorage.setItem(DEFAULT_KEY, v)
    else localStorage.removeItem(DEFAULT_KEY)
}
