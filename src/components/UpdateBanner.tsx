import { useEffect, useState } from "react"

type Status =
    | { state: "available"; version?: string }
    | { state: "progress"; percent?: number }
    | { state: "ready"; version?: string }
    | { state: "error" }

/**
 * In-app auto-update prompt — fully opt-in. The main process (electron-updater)
 * only CHECKS for a new release and reports it here; nothing downloads or installs
 * unless the user clicks. Flow: "available" → user clicks Update → "progress" →
 * "ready" → user clicks Restart & install. A dismiss (✕) lets them ignore it.
 */
export function UpdateBanner() {
    const [status, setStatus] = useState<Status | null>(null)
    const [dismissed, setDismissed] = useState(false)

    useEffect(() => {
        const unsub = window.electronWindow?.onUpdateStatus(s => {
            setStatus(s)
            setDismissed(false)
        })
        return () => unsub?.()
    }, [])

    if (!status || status.state === "error" || dismissed) return null

    if (status.state === "ready") {
        return (
            <div className="update-banner ready">
                <span>Update{status.version ? ` v${status.version}` : ""} downloaded and ready.</span>
                <button className="update-btn" onClick={() => window.electronWindow?.installUpdate()}>
                    Restart &amp; install
                </button>
                <button className="update-dismiss" title="Later" onClick={() => setDismissed(true)}>✕</button>
            </div>
        )
    }

    if (status.state === "progress") {
        return (
            <div className="update-banner">
                <span>Downloading update… {status.percent ?? 0}%</span>
            </div>
        )
    }

    // available — offer the choice; nothing has downloaded yet.
    return (
        <div className="update-banner">
            <span>A new version{status.version ? ` (v${status.version})` : ""} is available.</span>
            <button className="update-btn" onClick={() => window.electronWindow?.downloadUpdate()}>
                Update
            </button>
            <button className="update-dismiss" title="Later" onClick={() => setDismissed(true)}>✕</button>
        </div>
    )
}
