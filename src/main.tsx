import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { TitleBar } from "./components/TitleBar.tsx"
import App from "./App.tsx"
import { Overlay } from "./components/Overlay.tsx"
import { setAppIcon } from "./lib/setAppIcon.ts"
import "./index.css"
import "./motion/motion.css"

const isOverlay = new URLSearchParams(window.location.search).get("overlay") === "true"

if (isOverlay) {
    document.body.classList.add("overlay-mode")
    createRoot(document.getElementById("root")!).render(<Overlay />)
} else {
    setAppIcon()
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <TitleBar />
            <App />
        </StrictMode>
    )
}
