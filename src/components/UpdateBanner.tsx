import { useEffect, useState } from "react"

type Status =
    | { state: "available"; version?: string }
    | { state: "progress"; percent?: number }
    | { state: "ready"; version?: string }
    | { state: "error" }

/**
 * In-app auto-update prompt. The main process (electron-updater) pushes status
 * over the "update:status" channel: a new release is found → downloaded in the
 * background → "ready", at which point we show a Restart button that installs it.
 */
export function UpdateBanner() {
    const [status, setStatus] = useState<Status | null>(null)

    useEffect(() => {
        const unsub = window.electronWindow?.onUpdateStatus(setStatus)
        return () => unsub?.()
    }, [])

    if (!status || status.state === "error") return null

    if (status.state === "ready") {
        return (
            <div className="update-banner ready">
                <span>
                    Update{status.version ? ` v${status.version}` : ""} ready to install.
                </span>
                <button className="update-btn" onClick={() => window.electronWindow?.installUpdate()}>
                    Restart &amp; update
                </button>
            </div>
        )
    }

    const label =
        status.state === "progress" && typeof status.percent === "number"
            ? `Downloading update… ${status.percent}%`
            : "A new version is available — downloading…"

    return (
        <div className="update-banner">
            <span>{label}</span>
        </div>
    )
}
