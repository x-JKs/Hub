import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { parallaxHandlers } from "./hooks"

// Last pointer-down position (viewport coords) — overlays spring out from the
// click that opened them. Captured globally so no prop-drilling is needed.
let lastPointer: { x: number; y: number } | null = null
if (typeof window !== "undefined") {
    window.addEventListener(
        "pointerdown",
        e => { lastPointer = { x: e.clientX, y: e.clientY } },
        { capture: true, passive: true }
    )
}

export function AnimatedOverlay({
    children,
    onClose,
    className = "pgcr-overlay",
}: {
    children: ReactNode
    onClose: () => void
    className?: string
}) {
    const [exiting, setExiting] = useState(false)
    // Snapshot the click origin once — the pointer moves while the overlay is open.
    const origin = useRef(lastPointer).current

    const handleClose = () => {
        if (exiting) return
        setExiting(true)
        setTimeout(onClose, 260)
    }

    // Escape plays the exit animation too (consumers don't need their own handler).
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose() }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [exiting])

    const dx = origin ? origin.x - window.innerWidth / 2 : 0
    const dy = origin ? origin.y - window.innerHeight / 2 : 0

    // Portal to <body>: the tab-transition wrapper carries transform/filter
    // styles, which would otherwise become the containing block for this
    // fixed-position overlay (sizing it against the tab content, not the
    // viewport).
    return createPortal(
        <div
            className={`${className} mo-overlay${exiting ? " mo-overlay--exit" : ""}`}
            onClick={handleClose}
        >
            <motion.div
                className="mo-overlay-panel"
                initial={{ opacity: 0, scale: 0.82, x: dx * 0.22, y: dy * 0.22 }}
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.9 }}
                {...parallaxHandlers()}
            >
                {children}
            </motion.div>
        </div>,
        document.body
    )
}

export function TabTransition({
    tabKey,
    direction = 0,
    children,
}: {
    tabKey: string
    /** -1 = moving to an earlier tab, 1 = later, 0 = no slide (crossfade). */
    direction?: number
    children: ReactNode
}) {
    const dist = 40

    // popLayout (not "wait"): the incoming tab mounts immediately and slides in
    // while the outgoing one is popped out of flow and fades — an overlapping
    // crossfade with no blank gap, and the swap never waits on an exit animation.
    return (
        <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
                key={tabKey}
                className="mo-tab"
                initial={{ opacity: 0, x: direction * dist, scale: 0.99, filter: "blur(6px)" }}
                animate={{
                    opacity: 1, x: 0, scale: 1, filter: "blur(0px)",
                    transition: { duration: 0.34, ease: [0.16, 1, 0.3, 1], delay: 0.06 },
                }}
                exit={{
                    opacity: 0, x: direction * -dist * 0.4, scale: 0.995, filter: "blur(4px)",
                    transition: { duration: 0.16, ease: "easeIn" },
                }}
            >
                {children}
            </motion.div>
        </AnimatePresence>
    )
}

export function ShimmerWrap({ children }: { children: ReactNode }) {
    return <div className="mo-shimmer-wrap">{children}</div>
}
