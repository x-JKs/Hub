import { useEffect, useState } from "react"
import { getApiKey, hasBuiltinApiKey, setApiKey } from "../bungie/client"
import { getDefaultPlayer, setDefaultPlayer } from "../hooks/useLiveActivity"
import {
    isLoggedIn,
    getStoredDestinyMembership,
    startLogin,
    clearTokens,
    selectMembership,
    PLATFORM_NAMES,
    type DestinyMembership,
} from "../bungie/oauth"

interface Props {
    intro?: boolean
    onSaved: () => void
    onClose?: () => void
    onLogin?: (membership: DestinyMembership) => void
}

export function ApiKeySettings({ intro, onSaved, onClose, onLogin }: Props) {
    const [apiKey, setApiKeyVal] = useState(getApiKey() ?? "")
    const [defaultPlayer, setDefaultVal] = useState(getDefaultPlayer())
    const [loggedIn, setLoggedIn] = useState(isLoggedIn)
    const [loggingIn, setLoggingIn] = useState(false)
    const [loginError, setLoginError] = useState<string | null>(null)
    const [allMemberships, setAllMemberships] = useState<DestinyMembership[] | null>(null)
    const [activeMembership, setActiveMembership] = useState<DestinyMembership | null>(
        () => (isLoggedIn() ? getStoredDestinyMembership() : null)
    )
    const [overlayOn, setOverlayOn] = useState(() => localStorage.getItem("overlay-enabled") === "true")
    const [overlayMode, setOverlayMode] = useState(() => localStorage.getItem("overlay-mode") ?? "both")
    const [overlayPeriod, setOverlayPeriod] = useState(() => localStorage.getItem("overlay-period") ?? "weekly")
    const [overlayPos, setOverlayPos] = useState(() => localStorage.getItem("overlay-position") ?? "top-left")
    const [overlayOpacity, setOverlayOpacity] = useState(() => localStorage.getItem("overlay-opacity") ?? "1")
    const [overlayTimer, setOverlayTimer] = useState(() => localStorage.getItem("overlay-show-timer") !== "false")
    const [presenceOn, setPresenceOn] = useState(() => localStorage.getItem("discord-presence-enabled") !== "false")
    const [trayOn, setTrayOn] = useState(() => localStorage.getItem("minimize-to-tray") !== "false")
    const [startupOn, setStartupOn] = useState(false)

    // Reflect the actual Windows login-item state.
    useEffect(() => {
        window.electronWindow?.getLaunchOnStartup().then(setStartupOn).catch(() => {})
    }, [])

    // Persist one overlay option and push the full settings object to the
    // overlay window (which also lets the main process reposition it).
    const pushOverlay = (patch: Partial<{ mode: string; period: string; position: string; opacity: string; showTimer: boolean }>) => {
        const next = {
            mode: patch.mode ?? overlayMode,
            period: patch.period ?? overlayPeriod,
            position: patch.position ?? overlayPos,
            opacity: Number(patch.opacity ?? overlayOpacity) || 1,
            showTimer: patch.showTimer ?? overlayTimer,
        }
        window.electronWindow?.sendOverlaySettings(next)
    }

    function save() {
        if (!hasBuiltinApiKey()) setApiKey(apiKey)
        setDefaultPlayer(defaultPlayer)
        onSaved()
    }

    async function handleLogin() {
        setLoggingIn(true)
        setLoginError(null)
        try {
            const result = await startLogin()
            setLoggedIn(true)
            setActiveMembership(result.picked)
            if (result.memberships.length > 1) {
                setAllMemberships(result.memberships)
            } else {
                onLogin?.(result.picked)
            }
        } catch (err: any) {
            setLoginError(err.message ?? "Login failed")
        } finally {
            setLoggingIn(false)
        }
    }

    function handlePickMembership(m: DestinyMembership) {
        selectMembership(m)
        setActiveMembership(m)
        setAllMemberships(null)
        onLogin?.(m)
    }

    function handleLogout() {
        clearTokens()
        setLoggedIn(false)
        setActiveMembership(null)
        setAllMemberships(null)
    }

    return (
        <div className="keypanel">
            {intro && <h2>Connect to Bungie</h2>}

            {!hasBuiltinApiKey() && (
                <div className="keypanel-section">
                    <p className="keypanel-hint">
                        Paste your Bungie API key. Create one at{" "}
                        <a href="https://www.bungie.net/en/Application" target="_blank" rel="noreferrer">
                            bungie.net/en/Application
                        </a>
                        . It&rsquo;s stored only on this device.
                    </p>
                    <div className="keypanel-row">
                        <input
                            type="password"
                            value={apiKey}
                            placeholder="Bungie API key"
                            onChange={e => setApiKeyVal(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && save()}
                        />
                    </div>
                </div>
            )}

            <div className="keypanel-section">
                <p className="keypanel-hint">
                    <strong>Bungie Account</strong> &mdash; Log in with your Bungie account to
                    automatically load your profile on startup.
                </p>

                {allMemberships && allMemberships.length > 1 ? (
                    <div className="keypanel-platform-picker">
                        <p className="keypanel-picker-label">Multiple platforms found &mdash; select which account to use:</p>
                        {allMemberships.map(m => (
                            <button
                                key={m.membershipId}
                                className={`keypanel-platform-btn${activeMembership?.membershipId === m.membershipId ? " active" : ""}`}
                                onClick={() => handlePickMembership(m)}
                            >
                                <span className="keypanel-platform-name">{PLATFORM_NAMES[m.membershipType] ?? `Type ${m.membershipType}`}</span>
                                <span className="keypanel-platform-display">{m.displayName}</span>
                                <span className="keypanel-platform-id">{m.membershipId}</span>
                            </button>
                        ))}
                    </div>
                ) : loggedIn && activeMembership ? (
                    <div className="keypanel-auth-status">
                        <div className="keypanel-auth-info">
                            <span className="keypanel-auth-name">{activeMembership.displayName}</span>
                            <span className="keypanel-auth-platform">{PLATFORM_NAMES[activeMembership.membershipType] ?? "Unknown"}</span>
                        </div>
                        <button className="ghost small" onClick={handleLogout}>
                            Log out
                        </button>
                    </div>
                ) : (
                    <div className="keypanel-row">
                        <button
                            className="primary"
                            onClick={handleLogin}
                            disabled={loggingIn || !apiKey.trim()}
                        >
                            {loggingIn ? "Waiting for Bungie…" : "Login with Bungie"}
                        </button>
                    </div>
                )}
                {loginError && <p className="keypanel-error">{loginError}</p>}
            </div>

            <div className="keypanel-section">
                <p className="keypanel-hint">
                    <strong>Default Player</strong> &mdash; Enter a Bungie name (e.g.{" "}
                    <code>Guardian#1234</code>) or membership ID to auto-load on startup.
                    {loggedIn && " Overrides your logged-in account if set."}
                    {!loggedIn && " Or log in above to skip this."}
                </p>
                <div className="keypanel-row">
                    <input
                        type="text"
                        value={defaultPlayer}
                        placeholder="Bungie name or membership ID (optional)"
                        onChange={e => setDefaultVal(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && save()}
                    />
                </div>
            </div>

            <div className="keypanel-section">
                <p className="keypanel-hint">
                    <strong>Game Overlay</strong> &mdash; Show raid/dungeon clear counts on top of the game.
                </p>
                <label className="keypanel-toggle">
                    <input
                        type="checkbox"
                        checked={overlayOn}
                        onChange={e => {
                            const on = e.target.checked
                            setOverlayOn(on)
                            localStorage.setItem("overlay-enabled", String(on))
                            if (on) window.electronWindow?.showOverlay()
                            else window.electronWindow?.hideOverlay()
                        }}
                    />
                    Enable overlay
                </label>
                {overlayOn && (
                    <label className="keypanel-toggle">
                        <input
                            type="checkbox"
                            checked={overlayTimer}
                            onChange={e => {
                                const on = e.target.checked
                                setOverlayTimer(on)
                                localStorage.setItem("overlay-show-timer", String(on))
                                pushOverlay({ showTimer: on })
                            }}
                        />
                        Show activity timer
                    </label>
                )}
                {overlayOn && (
                    <div className="keypanel-overlay-opts">
                        <div className="keypanel-row">
                            <select
                                value={overlayMode}
                                onChange={e => {
                                    const v = e.target.value
                                    setOverlayMode(v)
                                    localStorage.setItem("overlay-mode", v)
                                    pushOverlay({ mode: v })
                                }}
                            >
                                <option value="both">Raids &amp; Dungeons</option>
                                <option value="raids">Raids only</option>
                                <option value="dungeons">Dungeons only</option>
                            </select>
                        </div>
                        <div className="keypanel-row">
                            <select
                                value={overlayPeriod}
                                onChange={e => {
                                    const v = e.target.value
                                    setOverlayPeriod(v)
                                    localStorage.setItem("overlay-period", v)
                                    pushOverlay({ period: v })
                                }}
                            >
                                <option value="weekly">Weekly reset</option>
                                <option value="daily">Daily reset</option>
                            </select>
                        </div>
                        <div className="keypanel-row">
                            <select
                                value={overlayPos}
                                onChange={e => {
                                    const v = e.target.value
                                    setOverlayPos(v)
                                    localStorage.setItem("overlay-position", v)
                                    pushOverlay({ position: v })
                                }}
                            >
                                <option value="top-left">Top left</option>
                                <option value="top-right">Top right</option>
                                <option value="bottom-left">Bottom left</option>
                                <option value="bottom-right">Bottom right</option>
                            </select>
                        </div>
                        <div className="keypanel-row">
                            <select
                                value={overlayOpacity}
                                onChange={e => {
                                    const v = e.target.value
                                    setOverlayOpacity(v)
                                    localStorage.setItem("overlay-opacity", v)
                                    pushOverlay({ opacity: v })
                                }}
                            >
                                <option value="1">Opacity 100%</option>
                                <option value="0.85">Opacity 85%</option>
                                <option value="0.7">Opacity 70%</option>
                                <option value="0.55">Opacity 55%</option>
                            </select>
                        </div>
                    </div>
                )}
            </div>

            <div className="keypanel-section">
                <p className="keypanel-hint">
                    <strong>App</strong>
                </p>
                <label className="keypanel-toggle">
                    <input
                        type="checkbox"
                        checked={presenceOn}
                        onChange={e => {
                            const on = e.target.checked
                            setPresenceOn(on)
                            localStorage.setItem("discord-presence-enabled", String(on))
                            if (!on) window.electronWindow?.setDiscordPresence(null)
                        }}
                    />
                    Discord Rich Presence &mdash; show your current activity on Discord
                </label>
                <label className="keypanel-toggle">
                    <input
                        type="checkbox"
                        checked={trayOn}
                        onChange={e => {
                            const on = e.target.checked
                            setTrayOn(on)
                            localStorage.setItem("minimize-to-tray", String(on))
                            window.electronWindow?.setMinimizeToTray(on)
                        }}
                    />
                    Minimize to system tray
                </label>
                <label className="keypanel-toggle">
                    <input
                        type="checkbox"
                        checked={startupOn}
                        onChange={e => {
                            const on = e.target.checked
                            setStartupOn(on)
                            window.electronWindow?.setLaunchOnStartup(on)
                        }}
                    />
                    Launch Hub when Windows starts
                </label>
            </div>

            <div className="keypanel-row keypanel-actions">
                <button className="primary" onClick={save} disabled={!apiKey.trim()}>
                    Save
                </button>
                {onClose && (
                    <button className="ghost" onClick={onClose}>
                        Cancel
                    </button>
                )}
            </div>
        </div>
    )
}
