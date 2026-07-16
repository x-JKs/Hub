import { useEffect, useMemo, useRef, useState } from "react"
import { motion } from "framer-motion"
import { ActivityListPage, ActivityListSkeleton } from "./components/ActivityListPage"
import { ApiKeySettings } from "./components/ApiKeySettings"
import { Dashboard, OverviewSkeleton } from "./components/Dashboard"
import { LiveActivity } from "./components/LiveActivity"
import { PeriodSelector } from "./components/PeriodSelector"
import { PlayerSearch } from "./components/PlayerSearch"
import { ActivityHistoryPage } from "./components/ActivityHistoryPage"
import { UpdateModal } from "./components/UpdateModal"
import { PgcrOverlay } from "./components/PgcrOverlay"
import { hasApiKey } from "./bungie/client"
import { searchPlayers } from "./bungie/api"
import { SelectedPlayer, useActivities } from "./hooks/useActivities"
import { useLiveActivity, getDefaultPlayer } from "./hooks/useLiveActivity"
import { isLoggedIn, getStoredDestinyMembership, type DestinyMembership } from "./bungie/oauth"
import { computeStats } from "./stats/compute"
import { currentPeriod, Granularity, Period, shiftPeriod } from "./stats/period"
import { TabTransition } from "./motion/components"

type Tab = "overview" | "raids" | "dungeons" | "pantheon" | "history"

const TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "raids", label: "Raids" },
    { id: "dungeons", label: "Dungeons" },
    { id: "pantheon", label: "Pantheon" },
    { id: "history", label: "History" },
]

export default function App() {
    const [player, setPlayer] = useState<SelectedPlayer | null>(null)
    const [tab, setTab] = useState<Tab>("overview")
    // Which way the tab content should slide: toward the tab you clicked.
    const tabDirection = useRef(0)
    const switchTab = (next: Tab) => {
        const from = TABS.findIndex(t => t.id === tab)
        const to = TABS.findIndex(t => t.id === next)
        tabDirection.current = to === from ? 0 : to > from ? 1 : -1
        setTab(next)
    }
    // Arrow keys move between tabs when the tab bar has focus.
    const onTabKeyDown = (e: React.KeyboardEvent) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
        e.preventDefault()
        const from = TABS.findIndex(t => t.id === tab)
        const to = (from + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length
        switchTab(TABS[to].id)
        const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("button")
        buttons[to]?.focus()
    }
    const [period, setPeriod] = useState<Period>(() => currentPeriod("month"))
    // Clears overlay opened from a most-played card on the Overview.
    const [mostPlayedClears, setMostPlayedClears] = useState<{
        groupKey: string
        activityName: string
        splashUrl: string | null
    } | null>(null)
    const [keyVersion, setKeyVersion] = useState(0)
    const [showSettings, setShowSettings] = useState(false)
    const [refreshing, setRefreshing] = useState(false)

    const keyPresent = useMemo(() => hasApiKey(), [keyVersion])

    const { runs, aggregate, freshFastest, freshFlawless, freshLoading, loading, error, refresh, retry: retryLoad } =
        useActivities(keyPresent ? player : null)
    const stats = useMemo(() => computeStats(runs, period), [runs, period])
    const liveActivity = useLiveActivity(keyPresent ? player : null)

    // Discord Rich Presence mirrors the (stale-gated) live activity state:
    // in an activity → name + elapsed; online in orbit → "In Orbit"; offline
    // or presence disabled → cleared. Yute's DiscordPresenceService, ported.
    useEffect(() => {
        const send = window.electronWindow?.setDiscordPresence
        if (!send) return
        if (localStorage.getItem("discord-presence-enabled") === "false") {
            send(null)
            return
        }
        if (liveActivity.activityName && liveActivity.isOnline) {
            send({
                details: liveActivity.activityName,
                state: liveActivity.activityModeLabel ?? "Playing Destiny 2",
                startMs: liveActivity.activityStarted
                    ? new Date(liveActivity.activityStarted).getTime()
                    : undefined,
                imageUrl: liveActivity.activityImageUrl ?? undefined,
                imageText: liveActivity.activityName,
            })
        } else if (liveActivity.isOnline) {
            send({ details: "In Orbit" })
        } else {
            send(null)
        }
    }, [
        liveActivity.activityName,
        liveActivity.activityStarted,
        liveActivity.activityModeLabel,
        liveActivity.activityImageUrl,
        liveActivity.isOnline,
    ])

    const setGranularity = (g: Granularity) => setPeriod(currentPeriod(g))
    const onKeySaved = () => {
        setKeyVersion(v => v + 1)
        setShowSettings(false)
    }

    function applyMembership(m: DestinyMembership) {
        setPlayer({
            membershipType: m.membershipType,
            membershipId: m.membershipId,
            displayName: m.displayName,
        })
    }

    // Auto-show overlay on startup if enabled
    useEffect(() => {
        if (localStorage.getItem("overlay-enabled") === "true") {
            window.electronWindow?.showOverlay()
        }
        // Tell the main process how minimize should behave (tray vs taskbar).
        window.electronWindow?.setMinimizeToTray(
            localStorage.getItem("minimize-to-tray") !== "false"
        )
    }, [])

    // Auto-load player on startup: OAuth membership first, then defaultPlayer fallback
    useEffect(() => {
        if (!keyPresent || player) return

        // 1. If logged in via OAuth, use that membership directly
        if (isLoggedIn()) {
            const m = getStoredDestinyMembership()
            if (m) {
                applyMembership(m)
                return
            }
        }

        // 2. Fallback: search by default player name
        const def = getDefaultPlayer()
        if (!def) return

        searchPlayers(def).then(cards => {
            if (cards.length > 0) {
                const c = cards[0]
                const display = c.bungieGlobalDisplayName && c.bungieGlobalDisplayNameCode
                    ? `${c.bungieGlobalDisplayName}#${String(c.bungieGlobalDisplayNameCode).padStart(4, "0")}`
                    : c.displayName
                setPlayer({
                    membershipType: c.membershipType,
                    membershipId: c.membershipId,
                    displayName: display,
                })
            }
        }).catch(() => {})
    }, [keyPresent])

    function renderContent() {
        // History loads its own (weekly) data independently of the main stats load.
        if (tab === "history") return <ActivityHistoryPage player={player!} />

        if (loading) {
            if (tab === "raids" || tab === "dungeons" || tab === "pantheon") return <ActivityListSkeleton />
            return <OverviewSkeleton />
        }
        if (error)
            return (
                <div className="state error">
                    {error}
                    <button className="state-retry" onClick={retryLoad}>
                        Retry
                    </button>
                </div>
            )

        if (tab === "raids" || tab === "dungeons" || tab === "pantheon")
            return (
                <ActivityListPage
                    runs={runs}
                    aggregate={aggregate}
                    freshFastest={freshFastest}
                    freshFlawless={freshFlawless}
                    freshLoading={freshLoading}
                    category={tab === "raids" ? "raid" : tab === "dungeons" ? "dungeon" : "pantheon"}
                />
            )

        return (
            <>
                <PeriodSelector
                    period={period}
                    onGranularity={setGranularity}
                    onShift={delta => setPeriod(p => shiftPeriod(p, delta))}
                    onReset={() => setPeriod(currentPeriod(period.granularity))}
                />
                <Dashboard
                    stats={stats}
                    period={period}
                    onMostPlayedOpen={mp => setMostPlayedClears({
                        groupKey: mp.groupKey,
                        activityName: mp.name,
                        splashUrl: mp.splashUrl,
                    })}
                />
                <div className="overview-live-row">
                    <LiveActivity state={liveActivity} player={player} />
                </div>
                {mostPlayedClears && (
                    <PgcrOverlay
                        runs={runs}
                        initialView={{ type: "clears", ...mostPlayedClears }}
                        onClose={() => setMostPlayedClears(null)}
                    />
                )}
            </>
        )
    }

    return (
        <div className="app">
            <UpdateModal />
            <div className="topbar">
                <h1>
                    Hub <span>&middot; Destiny 2</span>
                </h1>
                <div className="topbar-right">
                    <PlayerSearch onSelect={setPlayer} />
                    {keyPresent && player && (
                        <button
                            className={`icon-btn${refreshing ? " spinning" : ""}`}
                            title="Refresh stats"
                            aria-label="Refresh stats"
                            onClick={() => {
                                setRefreshing(true)
                                refresh()
                                setTimeout(() => setRefreshing(false), 800)
                            }}
                        >
                            &#8635;
                        </button>
                    )}
                    {keyPresent && (
                        <button
                            className="icon-btn"
                            title="Settings"
                            aria-label="Settings"
                            onClick={() => setShowSettings(s => !s)}
                        >
                            &#9881;
                        </button>
                    )}
                </div>
            </div>

            {!keyPresent ? (
                <ApiKeySettings intro onSaved={onKeySaved} onLogin={applyMembership} />
            ) : showSettings ? (
                <ApiKeySettings onSaved={onKeySaved} onClose={() => setShowSettings(false)} onLogin={m => { applyMembership(m); setShowSettings(false) }} />
            ) : (
                <>
                    <div className="tabs" role="tablist" onKeyDown={onTabKeyDown}>
                        {TABS.map(t => (
                            <button
                                key={t.id}
                                role="tab"
                                aria-selected={tab === t.id}
                                className={tab === t.id ? "active" : ""}
                                onClick={() => switchTab(t.id)}
                            >
                                {t.label}
                                {tab === t.id && (
                                    <motion.span
                                        className="mo-tab-underline"
                                        layoutId="tab-underline"
                                        transition={{ type: "spring", stiffness: 500, damping: 38 }}
                                    />
                                )}
                            </button>
                        ))}
                        {player && <div className="tabs-player">{player.displayName}</div>}
                    </div>

                    {!player ? (
                        <div className="state">Search for a Guardian above to see their stats.</div>
                    ) : (
                        <TabTransition tabKey={tab} direction={tabDirection.current}>
                            {renderContent()}
                        </TabTransition>
                    )}
                </>
            )}
        </div>
    )
}
