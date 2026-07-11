import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TitleBar } from "./components/TitleBar.tsx"
import App from "./App.tsx"
import { Overlay } from "./components/Overlay.tsx"
import { ErrorBoundary } from "./components/ErrorBoundary.tsx"
import { setAppIcon } from "./lib/setAppIcon.ts"
import "./index.css"
import "./motion/motion.css"

// Forward uncaught renderer errors to the main-process log file (hub.log in
// userData) so crashes in the packaged app leave a trace.
window.addEventListener("error", e => {
    window.electronLog?.error(`uncaught: ${e.message} @ ${e.filename}:${e.lineno}`)
})
window.addEventListener("unhandledrejection", e => {
    const r = e.reason
    window.electronLog?.error(`unhandled rejection: ${r instanceof Error ? r.stack ?? r.message : String(r)}`)
})

const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "true"

if (isOverlay) {
    document.body.classList.add("overlay-mode")
    createRoot(document.getElementById("root")!).render(<Overlay />)
} else {
    setAppIcon()
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <TitleBar />
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
        </StrictMode>
    )
}
