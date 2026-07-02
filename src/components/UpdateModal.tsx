import { useEffect, useState } from "react"

type Status =
    | { state: "available"; version?: string }
    | { state: "progress"; percent?: number }
    | { state: "ready"; version?: string }
    | { state: "error" }

/**
 * On-launch update prompt. When the main process (electron-updater) reports that
 * a newer release exists, this blurs the whole app behind a centered modal asking
 * the user to update. Fully opt-in — nothing downloads or installs until they
 * click. Flow: available → Update now → downloading → ready → Restart & install.
 * "Later" dismisses so they can keep using the app.
 */
export function UpdateModal() {
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

    let body
    if (status.state === "ready") {
        body = (
            <>
                <h2 className="update-modal-title">Update ready</h2>
                <p className="update-modal-text">
                    Version {status.version ? `v${status.version} ` : ""}has been downloaded.
                    Restart Hub to finish installing.
                </p>
                <div className="update-modal-actions">
                    <button className="update-btn" onClick={() => window.electronWindow?.installUpdate()}>
                        Restart &amp; install
                    </button>
                    <button className="update-later" onClick={() => setDismissed(true)}>Later</button>
                </div>
            </>
        )
    } else if (status.state === "progress") {
        const pct = status.percent ?? 0
        body = (
            <>
                <h2 className="update-modal-title">Downloading update…</h2>
                <div className="update-progress">
                    <div className="update-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <p className="update-modal-text">{pct}%</p>
            </>
        )
    } else {
        body = (
            <>
                <h2 className="update-modal-title">Update available</h2>
                <p className="update-modal-text">
                    A new version{status.version ? ` (v${status.version})` : ""} of Hub is available.
                    Update now to get the latest features and fixes.
                </p>
                <div className="update-modal-actions">
                    <button className="update-btn" onClick={() => window.electronWindow?.downloadUpdate()}>
                        Update now
                    </button>
                    <button className="update-later" onClick={() => setDismissed(true)}>Later</button>
                </div>
            </>
        )
    }

    return (
        <div className="update-modal-backdrop">
            <div className="update-modal">{body}</div>
        </div>
    )
}
