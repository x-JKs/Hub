import { useCallback, useEffect, useRef, useState } from "react"
import { STAGGER } from "./tokens"

export function useStaggeredEntrance(
    _count: number,
    stagger: number = STAGGER.tight,
    enabled = true
): { getStyle: (index: number) => React.CSSProperties } {
    const [entered, setEntered] = useState(!enabled)

    useEffect(() => {
        if (!enabled) { setEntered(true); return }
        requestAnimationFrame(() => setEntered(true))
    }, [enabled])

    const getStyle = useCallback((index: number): React.CSSProperties => {
        if (!enabled) return {}
        return {
            opacity: entered ? 1 : 0,
            transform: entered ? "translateY(0)" : "translateY(8px)",
            transition: `opacity 280ms cubic-bezier(0.16,1,0.3,1) ${index * stagger}ms, transform 280ms cubic-bezier(0.16,1,0.3,1) ${index * stagger}ms`,
        }
    }, [entered, stagger, enabled])

    return { getStyle }
}

export function useCountUp(target: number, duration = 1200, enabled = true): number {
    const [value, setValue] = useState(0)
    const prevTarget = useRef(0)

    useEffect(() => {
        if (!enabled || target === 0) {
            setValue(target)
            prevTarget.current = target
            return
        }

        const from = prevTarget.current
        const delta = target - from
        if (delta === 0) return

        prevTarget.current = target
        const start = performance.now()

        let raf: number
        const tick = (now: number) => {
            const elapsed = now - start
            const progress = Math.min(elapsed / duration, 1)
            const eased = 1 - Math.pow(1 - progress, 3)
            setValue(Math.round(from + delta * eased))
            if (progress < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [target, duration, enabled])

    return value
}

export function useFadeIn(delay = 0): { entered: boolean; style: React.CSSProperties } {
    const [entered, setEntered] = useState(false)

    useEffect(() => {
        const id = setTimeout(() => {
            requestAnimationFrame(() => setEntered(true))
        }, delay)
        return () => clearTimeout(id)
    }, [delay])

    const style: React.CSSProperties = {
        opacity: entered ? 1 : 0,
        transform: entered ? "translateY(0)" : "translateY(6px)",
        transition: `opacity 400ms cubic-bezier(0.16,1,0.3,1), transform 400ms cubic-bezier(0.16,1,0.3,1)`,
    }

    return { entered, style }
}
