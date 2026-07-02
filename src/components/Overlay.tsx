import { useCallback, useEffect, useRef, useState } from "react"
import {
    getActivityHistory,
    getCharacters,
    getCurrentActivity,
    getLatestCompletedActivity,
    searchPlayers,
} from "../bungie/api"
import { ActivityMode } from "../bungie/types"
import { normalizeRuns } from "../stats/normalize"
import { resolveActivityName } from "../bungie/manifest"
import { raidByHash } from "../manifest/raids"
import { dungeonByHash } from "../manifest/dungeons"
import { getStoredDestinyMembership, isLoggedIn } from "../bungie/oauth"
import { getDefaultPlayer } from "../hooks/useLiveActivity"
import { hasApiKey } from "../bungie/client"

type OvMode = "raids" | "dungeons" | "both"
type OvPeriod = "daily" | "weekly"

interface OvSettings {
    mode: OvMode
    period: OvPeriod
}

interface Notif {
    name: string
    time: string
}

function getDailyReset(): Date {
    const now = new Date()
    const today17 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17, 0, 0))
    return now >= today17 ? today17 : new Date(today17.getTime() - 86400000)
}

function getWeeklyReset(): Date {
    const daily = getDailyReset()
    const day = daily.getUTCDay()
    const diff = (day + 5) % 7
    return new Date(daily.getTime() - diff * 86400000)
}

function readSettings(): OvSettings {
    return {
        mode: (localStorage.getItem("overlay-mode") ?? "both") as OvMode,
        period: (localStorage.getItem("overlay-period") ?? "weekly") as OvPeriod,
    }
}

function formatTimer(ms: number): string {
    const sec = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    const pad = (n: number) => String(n).padStart(2, "0")
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}


const ORBIT_HASH = 82913930      // orbit's activity hash (empty manifest name)
const NOTIF_DURATION = 8000      // how long the completion toast stays up before fading
const NOTIF_FADE = 400           // fade-out duration (must match the .ov opacity transition)
const CURRENT_POLL = 1_000       // current-activity poll (drives show/hide + API resync); aggressive for fast activity-change detection
const HISTORY_POLL = 12_000      // history poll (clear-completion detection)
const CLEARS_POLL = 5 * 60_000   // clear-count refresh

export function Overlay() {
    const [actStart, setActStart] = useState<string | null>(null)
    const [packet, setPacket] = useState<{ available: boolean; active: boolean; startedAt: number | null; confident: boolean }>(
        { available: false, active: false, startedAt: null, confident: false }
    )
    const [elapsed, setElapsed] = useState(0)
    const [raidClears, setRaidClears] = useState(0)
    const [dungeonClears, setDungeonClears] = useState(0)
    const [settings, setSettings] = useState<OvSettings>(readSettings)
    const [ready, setReady] = useState(false)
    const [notif, setNotif] = useState<Notif | null>(null)
    // Fade control: notifShown toggles the notification's opacity; shown fades the
    // whole overlay out when the game loses focus / hides.
    const [notifShown, setNotifShown] = useState(false)
    const [shown, setShown] = useState(true)

    const tickRef = useRef<ReturnType<typeof setInterval>>()
    const settingsRef = useRef(settings)
    const charIdsRef = useRef<string[] | null>(null)
    const nameCacheRef = useRef<Map<number, string | null>>(new Map())
    const lastCompletedIdRef = useRef<string | null>(null)
    const doneInitialRef = useRef(false)
    const notifTimerRef = useRef<ReturnType<typeof setTimeout>>()
    const notifFadeRef = useRef<ReturnType<typeof setTimeout>>()
    const fetchCurrentRef = useRef<(() => void) | undefined>(undefined)

    useEffect(() => { settingsRef.current = settings }, [settings])

    // Settings pushed from the main window
    useEffect(() => {
        const unsub = window.electronWindow?.onOverlaySettings((s: { mode: string; period: string }) => {
            setSettings({
                mode: (s.mode as OvMode) ?? "both",
                period: (s.period as OvPeriod) ?? "weekly",
            })
        })
        return () => { unsub?.() }
    }, [])

    // Game-focus signal — only used to refresh the timer immediately when the
    // game regains focus. The data poll runs continuously (like threepole) so the
    // timer never freezes; the main process hides the window when not focused.
    useEffect(() => {
        const unsub = window.electronWindow?.onOverlayForeground((fg: boolean) => {
            setShown(fg) // fade the overlay in/out with game focus
            if (fg) fetchCurrentRef.current?.()
        })
        return () => { unsub?.() }
    }, [])

    // Packet-based instance timer (WinDivert). When available it's authoritative
    // — instant on/off like Yute. The Bungie-API timer is the fallback.
    useEffect(() => {
        const unsub = window.electronWindow?.onOverlayPacket(setPacket)
        return () => { unsub?.() }
    }, [])

    // ---- Yute timer hand-off (ported from XboxProvider + D2CharacterTracker) ----
    // `instanceStart` is the timer's start time. The packet capture sets it
    // INSTANTLY on load-in (a >10s gap in UDP 3074 = a new instance), so the timer
    // starts without waiting on Bungie. Then, once the API reflects the current
    // activity, we SWAP it to the API's `dateActivityStarted` (authoritative — it's
    // exact and survives reloads), but only when that API time isn't stale, i.e.
    // newer than our most recent recorded activity (Yute's `savedTime > apiTime`
    // guard, which skips a still-lagging API showing the PREVIOUS activity). The
    // timer hides when packets stop for >10s (orbit).
    const [instanceStart, setInstanceStart] = useState<number | null>(null)
    const [savedMs, setSavedMs] = useState(0)
    const usedApiStartsRef = useRef<Set<number>>(new Set())

    // Packet detected a new instance → count immediately from that moment.
    useEffect(() => {
        if (packet.startedAt != null) setInstanceStart(packet.startedAt)
    }, [packet.startedAt])

    // API caught up → swap to its authoritative start, once per start, and only if
    // it isn't stale (older than our latest recorded activity = a previous one).
    const apiStart = actStart ? new Date(actStart).getTime() : null
    useEffect(() => {
        if (apiStart == null) return
        const inInstanceNow = packet.available ? packet.active : true
        if (!inInstanceNow || apiStart < savedMs) return
        if (usedApiStartsRef.current.has(apiStart)) return
        usedApiStartsRef.current.add(apiStart)
        setInstanceStart(apiStart)
    }, [apiStart, savedMs, packet.available, packet.active])

    // Count from instanceStart, but only while actually in an instance: with packet
    // capture that's "a packet in the last 10s"; without it (non-admin) we rely on
    // the API reporting a current activity.
    const inInstance = packet.available ? packet.active : apiStart != null
    const startMs = inInstance ? instanceStart : null

    // Timer tick — counts up from the activity start.
    useEffect(() => {
        if (startMs == null) { setElapsed(0); return }
        setElapsed(Date.now() - startMs)
        tickRef.current = setInterval(() => setElapsed(Date.now() - startMs), 1000)
        return () => clearInterval(tickRef.current)
    }, [startMs])

    // Resolve the player to track for the overlay. Like Yute's TryLoadFromConfig,
    // this does NOT require an OAuth login: it prefers a logged-in membership if
    // present, otherwise resolves the configured default player by Bungie name /
    // membership id (searchPlayers). Cached once resolved so we don't re-search.
    const resolvedMemberRef = useRef<{ membershipType: number; membershipId: string } | null>(null)
    const membership = useCallback(async (): Promise<{ membershipType: number; membershipId: string } | null> => {
        if (!hasApiKey()) return null
        if (resolvedMemberRef.current) return resolvedMemberRef.current

        // 1. Prefer an OAuth-logged-in membership if one exists.
        if (isLoggedIn()) {
            const stored = getStoredDestinyMembership()
            if (stored) {
                resolvedMemberRef.current = { membershipType: stored.membershipType, membershipId: stored.membershipId }
                return resolvedMemberRef.current
            }
        }

        // 2. Otherwise resolve the default player by name / id — no login needed.
        const dp = getDefaultPlayer()
        if (!dp) return null
        try {
            const cards = await searchPlayers(dp)
            if (cards.length > 0) {
                resolvedMemberRef.current = { membershipType: cards[0].membershipType, membershipId: cards[0].membershipId }
                return resolvedMemberRef.current
            }
        } catch { /* resolution failed — leave uncached so we retry next poll */ }
        return null
    }, [])

    const charIds = useCallback(async (mType: number, mId: string): Promise<string[]> => {
        if (charIdsRef.current) return charIdsRef.current
        const c = await getCharacters(mType, mId)
        charIdsRef.current = c.current
        return c.current
    }, [])

    const activityName = useCallback(async (hash: number): Promise<string | null> => {
        if (nameCacheRef.current.has(hash)) return nameCacheRef.current.get(hash) ?? null
        const name = await resolveActivityName(hash)
        nameCacheRef.current.set(hash, name)
        return name
    }, [])

    // Current activity → timer. Picks the most-recently-started character.
    // Polls continuously (like threepole) so the timer data never freezes.
    const fetchCurrent = useCallback(async () => {
        const m = await membership()
        if (!m) return
        try {
            const cur = await getCurrentActivity(m.membershipType, m.membershipId)
            // Only orbit hides the timer. hash 0 = no activity; 82913930 = orbit
            // (empty manifest name). Everything else — incl. the Tower and social
            // spaces — counts as an activity and shows a timer, like Yute.
            if (!cur || cur.activityHash === 0 || cur.activityHash === ORBIT_HASH || !cur.startDate) {
                setActStart(null)
                return
            }
            setActStart(cur.startDate)
        } catch { /* non-critical */ }
    }, [membership])

    // Keep the ref pointed at the latest fetchCurrent for the foreground
    // listener (which mounts once).
    useEffect(() => { fetchCurrentRef.current = fetchCurrent }, [fetchCurrent])

    // Raid/dungeon clear counts for the active period.
    const fetchClears = useCallback(async () => {
        const m = await membership()
        if (!m) return
        const { period } = settingsRef.current
        const reset = period === "daily" ? getDailyReset() : getWeeklyReset()
        try {
            const ids = await charIds(m.membershipType, m.membershipId)
            const [raidPages, dungeonPages] = await Promise.all([
                Promise.all(ids.map(cid =>
                    getActivityHistory(m.membershipType, m.membershipId, cid, ActivityMode.Raid, reset)
                )),
                Promise.all(ids.map(cid =>
                    getActivityHistory(m.membershipType, m.membershipId, cid, ActivityMode.Dungeon, reset)
                )),
            ])
            const seen = new Set<string>()
            let r = 0, d = 0
            for (const entries of raidPages) {
                for (const run of normalizeRuns(entries, true)) {
                    if (run.completed && run.date >= reset && !seen.has(run.instanceId)) { seen.add(run.instanceId); r++ }
                }
            }
            for (const entries of dungeonPages) {
                for (const run of normalizeRuns(entries, false)) {
                    if (run.completed && run.date >= reset && !seen.has(run.instanceId)) { seen.add(run.instanceId); d++ }
                }
            }
            setRaidClears(r)
            setDungeonClears(d)
            setReady(true)
        } catch { /* non-critical */ }
    }, [membership, charIds])

    const showNotification = useCallback((n: Notif) => {
        clearTimeout(notifTimerRef.current)
        clearTimeout(notifFadeRef.current)
        setNotif(n)
        setNotifShown(false) // mount hidden, then fade in next frame
        // Surface the overlay above everything — even if alt-tabbed out of game.
        window.electronWindow?.surfaceOverlay()
        requestAnimationFrame(() => requestAnimationFrame(() => setNotifShown(true)))

        notifTimerRef.current = setTimeout(() => {
            setNotifShown(false) // fade out, then unmount after the transition
            notifFadeRef.current = setTimeout(() => {
                setNotif(null)
                window.electronWindow?.unsurfaceOverlay()
            }, NOTIF_FADE)
        }, NOTIF_DURATION)
    }, [])

    // Poll history for a freshly completed activity (any PvE type). When the top
    // completed instance changes, toast its name + API time.
    const checkCompletion = useCallback(async () => {
        const m = await membership()
        if (!m) return
        try {
            const ids = await charIds(m.membershipType, m.membershipId)
            const latest = await getLatestCompletedActivity(m.membershipType, m.membershipId, ids)
            if (!latest) return

            // Staleness floor for the API swap: the API's current-activity start
            // must be newer than our most recent recorded activity (+5s), else it's
            // a lagging read still showing the previous activity (Yute's savedTime).
            setSavedMs(new Date(latest.period).getTime() + 5000)

            if (!doneInitialRef.current) {
                // Baseline on first sighting — never toast for an old clear.
                lastCompletedIdRef.current = latest.instanceId
                doneInitialRef.current = true
                return
            }
            if (latest.instanceId !== lastCompletedIdRef.current) {
                lastCompletedIdRef.current = latest.instanceId
                // Curated raid/dungeon tables first (always accurate), then the
                // live manifest, then a generic fallback.
                const name = raidByHash(latest.referenceId)?.name
                    ?? dungeonByHash(latest.referenceId)?.name
                    ?? (await activityName(latest.referenceId))
                    ?? "Activity"
                const time = latest.durationDisplay || formatTimer(latest.durationSeconds * 1000)
                showNotification({ name, time })
                fetchClears()
            }
        } catch { /* non-critical */ }
    }, [membership, charIds, activityName, showNotification, fetchClears])

    // Re-fetch clears when settings change
    useEffect(() => { fetchClears() }, [settings.mode, settings.period, fetchClears])

    useEffect(() => {
        fetchCurrent()
        fetchClears()
        checkCompletion()
        const a = setInterval(fetchCurrent, CURRENT_POLL)
        const b = setInterval(checkCompletion, HISTORY_POLL)
        const c = setInterval(fetchClears, CLEARS_POLL)
        return () => {
            clearInterval(a)
            clearInterval(b)
            clearInterval(c)
            clearTimeout(notifTimerRef.current)
        }
    }, [fetchCurrent, checkCompletion, fetchClears])

    const { mode } = settings
    const count = mode === "raids" ? raidClears
        : mode === "dungeons" ? dungeonClears
        : raidClears + dungeonClears

    if (notif) {
        return (
            <div className={`ov ov-notif${notifShown ? " ov--in" : ""}`}>
                <div className="ov-notif-title">{notif.name}</div>
                <div className="ov-notif-time">
                    <span className="ov-notif-dot" />
                    {notif.time}
                </div>
            </div>
        )
    }

    return (
        <div className={`ov${ready && shown ? " ov--in" : ""}`}>
            {startMs != null && <span className="ov-timer">{formatTimer(elapsed)}</span>}
            <div className="ov-clears">
                <span className="ov-dot" />
                <span className="ov-count">{count}</span>
            </div>
        </div>
    )
}
