import { useEffect, useMemo, useState } from "react"
import { ActivityListPage, ActivityListSkeleton } from "./components/ActivityListPage"
import { ApiKeySettings } from "./components/ApiKeySettings"
import { Dashboard } from "./components/Dashboard"
import { LiveActivity } from "./components/LiveActivity"
import { PeriodSelector } from "./components/PeriodSelector"
import { PlayerSearch } from "./components/PlayerSearch"
import { hasApiKey } from "./bungie/client"
import { searchPlayers } from "./bungie/api"
import { SelectedPlayer, useActivities } from "./hooks/useActivities"
import { useLiveActivity, getDefaultPlayer } from "./hooks/useLiveActivity"
import { isLoggedIn, getStoredDestinyMembership, type DestinyMembership } from "./bungie/oauth"
import { computeStats } from "./stats/compute"
import { currentPeriod, Granularity, Period, shiftPeriod } from "./stats/period"
import { TabTransition } from "./motion/components"

type Tab = "overview" | "raids" | "dungeons" | "pantheon"

const TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "raids", label: "Raids" },
    { id: "dungeons", label: "Dungeons" },
    { id: "pantheon", label: "Pantheon" },
]

export default function App() {
    const [player, setPlayer] = useState<SelectedPlayer | null>(null)
    const [tab, setTab] = useState<Tab>("overview")
    const [period, setPeriod] = useState<Period>(() => currentPeriod("month"))
    const [keyVersion, setKeyVersion] = useState(0)
    const [showSettings, setShowSettings] = useState(false)
    const [refreshing, setRefreshing] = useState(false)

    const keyPresent = useMemo(() => hasApiKey(), [keyVersion])

    const { runs, aggregate, freshFastest, freshFlawless, freshLoading, loading, error, refresh } =
        useActivities(keyPresent ? player : null)
    const stats = useMemo(() => computeStats(runs, period), [runs, period])
    const liveActivity = useLiveActivity(keyPresent ? player : null)

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
        if (loading) {
            if (tab === "raids" || tab === "dungeons" || tab === "pantheon") return <ActivityListSkeleton />
            return (
                <div className="state">
                    <div className="spinner" />
                    Loading {player!.displayName}&rsquo;s history&hellip;
                </div>
            )
        }
        if (error) return <div className="state error">{error}</div>

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
                <Dashboard stats={stats} period={period} />
                <LiveActivity state={liveActivity} player={player} />
            </>
        )
    }

    return (
        <div className="app">
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
                    <div className="tabs">
                        {TABS.map(t => (
                            <button
                                key={t.id}
                                className={tab === t.id ? "active" : ""}
                                onClick={() => setTab(t.id)}
                            >
                                {t.label}
                            </button>
                        ))}
                        {player && <div className="tabs-player">{player.displayName}</div>}
                    </div>

                    {!player ? (
                        <div className="state">Search for a Guardian above to see their stats.</div>
                    ) : (
                        <TabTransition tabKey={tab}>
                            {renderContent()}
                        </TabTransition>
                    )}
                </>
            )}
        </div>
    )
}
