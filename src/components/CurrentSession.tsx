import { SessionInfo } from "../hooks/useCurrentSession"

export function CurrentSession({
    session,
    loading,
    onViewStats,
}: {
    session: SessionInfo | null
    loading: boolean
    onViewStats?: () => void
}) {
    if (loading && !session) {
        return (
            <div className="session">
                <div className="session-card">
                    <div className="session-emblem skeleton-pulse" />
                    <div className="session-info">
                        <div className="skeleton-line" style={{ width: "60%" }} />
                        <div className="skeleton-line" style={{ width: "40%" }} />
                    </div>
                </div>
            </div>
        )
    }

    if (!session) return null

    return (
        <div className="session">
            <div className="session-card">
                {session.emblemBgUrl ? (
                    <img
                        className="session-emblem-bg"
                        src={session.emblemBgUrl}
                        alt=""
                    />
                ) : (
                    <div className="session-emblem-bg session-emblem-placeholder" />
                )}
                <div className="session-overlay">
                    <div className="session-identity">
                        <div className="session-name">{session.displayName}</div>
                        <div className="session-meta">
                            {session.characterClass && (
                                <span className="session-class">{session.characterClass}</span>
                            )}
                            {session.lightLevel > 0 && (
                                <span className="session-light">{session.lightLevel}</span>
                            )}
                        </div>
                    </div>
                    <div className={`session-status ${session.isOnline ? "online" : "offline"}`}>
                        <span className="status-dot" />
                        {session.isOnline
                            ? session.currentActivityName ?? "Online"
                            : "Offline"}
                    </div>
                </div>
            </div>

            {session.fireteam.length > 0 && (
                <div className="session-fireteam">
                    <div className="fireteam-label">Fireteam</div>
                    <div className="fireteam-list">
                        {session.fireteam.map(m => (
                            <div className="fireteam-member" key={m.membershipId}>
                                <span className="fireteam-name">{m.displayName}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {onViewStats && (
                <button className="session-view-btn" onClick={onViewStats}>
                    View My Stats
                </button>
            )}
        </div>
    )
}
