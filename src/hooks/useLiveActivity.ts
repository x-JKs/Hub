import { useCallback, useEffect, useRef, useState } from "react"
import { getCurrentActivity, getLiveProfile, searchPlayers } from "../bungie/api"
import type { LiveCharacter, LivePartyMember } from "../bungie/api"
import { bungieAsset } from "../bungie/client"
import { resolveActivityName, resolveItems } from "../bungie/manifest"
import type { ManifestItemDef } from "../bungie/types"
import { raidByHash } from "../manifest/raids"
import { dungeonByHash } from "../manifest/dungeons"
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

function isRecentlyOnline(dateStr: string): boolean {
    if (!dateStr) return false
    const diff = Date.now() - new Date(dateStr).getTime()
    return diff < 15 * 60 * 1000
}

export function useLiveActivity(player: SelectedPlayer | null, pollMs = 30_000): LiveActivityState {
    const [state, setState] = useState<LiveActivityState>(EMPTY)
    const timerRef = useRef<ReturnType<typeof setInterval>>()
    const abortRef = useRef(0)

    const fetch = useCallback(async () => {
        if (!player) { setState(EMPTY); return }

        const id = ++abortRef.current
        try {
            const profile = await getLiveProfile(player.membershipType, player.membershipId)
            if (abortRef.current !== id) return

            const most = profile.characters[0] ?? null
            const online = profile.isOnline || isRecentlyOnline(most?.dateLastPlayed ?? "")

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
                if (cur && cur.activityHash !== 0 && cur.startDate) {
                    activityName = quickActivityName(cur.activityHash)
                    if (!activityName) {
                        const resolved = await resolveActivityName(cur.activityHash)
                        if (cancelled) return
                        if (resolved && !ORBIT_PATTERN.test(resolved)) activityName = resolved
                    }
                }
                const activityStarted = activityName ? (cur?.startDate ?? null) : null

                setState(s => ({
                    ...s,
                    activityName,
                    activityStarted,
                    // In an activity ⇒ definitely online; otherwise keep the slow
                    // poll's online/offline determination.
                    isOnline: activityName ? true : s.isOnline,
                }))
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
