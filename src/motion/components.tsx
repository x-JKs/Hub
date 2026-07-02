import { useEffect, useRef, useState, type ReactNode } from "react"

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

    const handleClose = () => {
        if (exiting) return
        setExiting(true)
        setTimeout(onClose, 260)
    }

    return (
        <div
            className={`${className} mo-overlay${exiting ? " mo-overlay--exit" : ""}`}
            onClick={handleClose}
        >
            {children}
        </div>
    )
}

export function TabTransition({
    tabKey,
    children,
}: {
    tabKey: string
    children: ReactNode
}) {
    const [display, setDisplay] = useState<{ key: string; content: ReactNode }>({
        key: tabKey,
        content: children,
    })
    const [phase, setPhase] = useState<"visible" | "out" | "in">("visible")
    const timeoutRef = useRef<ReturnType<typeof setTimeout>>()

    if (tabKey === display.key && phase === "visible") {
        display.content = children
    }

    useEffect(() => {
        if (tabKey === display.key) return

        setPhase("out")
        clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => {
            setDisplay({ key: tabKey, content: children })
            setPhase("in")
        }, 120)

        return () => clearTimeout(timeoutRef.current)
    }, [tabKey])

    useEffect(() => {
        if (phase !== "in") return
        const raf = requestAnimationFrame(() => {
            requestAnimationFrame(() => setPhase("visible"))
        })
        return () => cancelAnimationFrame(raf)
    }, [phase])

    return (
        <div className={`mo-tab mo-tab--${phase}`}>
            {display.content}
        </div>
    )
}

export function ShimmerWrap({ children }: { children: ReactNode }) {
    return <div className="mo-shimmer-wrap">{children}</div>
}
