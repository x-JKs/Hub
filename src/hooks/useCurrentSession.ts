import { useCallback, useEffect, useRef, useState } from "react"
import { bungieAuthGet, getStoredDestinyMembership, isLoggedIn } from "../bungie/oauth"
import { bungieAsset } from "../bungie/client"
import { raidByHash } from "../manifest/raids"
import { dungeonByHash } from "../manifest/dungeons"

export interface FireteamMember {
    membershipId: string
    displayName: string
    emblemHash: number
}

export interface SessionInfo {
    displayName: string
    emblemUrl: string | null
    emblemBgUrl: string | null
    lastPlayed: string | null
    currentActivityName: string | null
    isOnline: boolean
    fireteam: FireteamMember[]
    lightLevel: number
    characterClass: string | null
}

const CLASS_NAMES: Record<number, string> = { 0: "Titan", 1: "Hunter", 2: "Warlock" }

function activityNameFromHash(hash: number): string | null {
    if (!hash || hash === 0) return null
    const raid = raidByHash(hash)
    if (raid) return raid.name
    const dungeon = dungeonByHash(hash)
    if (dungeon) return dungeon.name
    return "In Activity"
}

export function useCurrentSession(pollIntervalMs = 30_000) {
    const [session, setSession] = useState<SessionInfo | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout>>()

    const fetchSession = useCallback(async () => {
        if (!isLoggedIn()) {
            setSession(null)
            return
        }
        const membership = getStoredDestinyMembership()
        if (!membership) {
            setSession(null)
            return
        }

        try {
            setLoading(true)
            setError(null)

            const profile = await bungieAuthGet<{
                profile: { data: { dateLastPlayed: string } }
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
                profileTransitoryData?: {
                    data: {
                        partyMembers: Array<{
                            membershipId: string
                            emblemHash: number
                            displayName: string
                            status: number
                        }>
                        currentActivity: {
                            startTime: string
                            endTime: string | null
                            numberOfPlayers: number
                        }
                    }
                }
            }>(
                `/Destiny2/${membership.membershipType}/Profile/${membership.membershipId}/?components=100,200,204,1000`
            )

            // Find the most recently played character
            const chars = Object.values(profile.characters?.data ?? {})
            const mostRecent = chars.sort(
                (a, b) => new Date(b.dateLastPlayed).getTime() - new Date(a.dateLastPlayed).getTime()
            )[0]

            // Determine current activity from the most recent character
            let currentActivityName: string | null = null
            let isOnline = false

            if (mostRecent && profile.characterActivities?.data) {
                const charActivity = profile.characterActivities.data[mostRecent.characterId]
                if (charActivity?.currentActivityHash) {
                    currentActivityName = activityNameFromHash(charActivity.currentActivityHash)
                    isOnline = true
                }
            }

            // Transitory data (fireteam) — only present when the player is online
            const transitory = profile.profileTransitoryData?.data
            const fireteam: FireteamMember[] = (transitory?.partyMembers ?? [])
                .filter(p => p.membershipId !== membership.membershipId)
                .map(p => ({
                    membershipId: p.membershipId,
                    displayName: p.displayName,
                    emblemHash: p.emblemHash,
                }))

            if (transitory) isOnline = true

            setSession({
                displayName: membership.displayName,
                emblemUrl: mostRecent ? bungieAsset(mostRecent.emblemPath) : null,
                emblemBgUrl: mostRecent ? bungieAsset(mostRecent.emblemBackgroundPath) : null,
                lastPlayed: profile.profile?.data?.dateLastPlayed ?? null,
                currentActivityName,
                isOnline,
                fireteam,
                lightLevel: mostRecent?.light ?? 0,
                characterClass: mostRecent ? (CLASS_NAMES[mostRecent.classType] ?? null) : null,
            })
        } catch (err: any) {
            setError(err.message ?? "Failed to load session")
            setSession(null)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        if (!pollIntervalMs) return
        fetchSession()
        timerRef.current = setInterval(fetchSession, pollIntervalMs)
        return () => clearInterval(timerRef.current)
    }, [fetchSession, pollIntervalMs])

    return { session, loading, error, refresh: fetchSession }
}
