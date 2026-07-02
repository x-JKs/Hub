import { useEffect, useState } from "react"
import { Logo } from "./Logo"

export function TitleBar() {
    const [maximized, setMaximized] = useState(false)
    const [focused, setFocused] = useState(true)
    const api = window.electronWindow

    useEffect(() => {
        if (!api) return
        api.isMaximized().then(setMaximized)
        api.isFocused().then(setFocused)
        const unsub1 = api.onMaximizeChange(setMaximized)
        const unsub2 = api.onFocusChange(setFocused)
        return () => { unsub1(); unsub2() }
    }, [])

    useEffect(() => {
        document.documentElement.classList.toggle("maximized", maximized)
    }, [maximized])

    if (!api) return null

    return (
        <div
            className={`titlebar ${focused ? "" : "titlebar--blurred"} ${maximized ? "titlebar--maximized" : ""}`}
        >
            <div className="titlebar-logo">
                <Logo size={20} />
            </div>

            <div className="titlebar-drag" />

            <div className="titlebar-spacer" />

            <div className="titlebar-controls">
                <button
                    className="titlebar-btn titlebar-btn--minimize"
                    onClick={() => api.minimize()}
                    aria-label="Minimize"
                    tabIndex={-1}
                >
                    <svg width="10" height="1" viewBox="0 0 10 1">
                        <rect width="10" height="1" fill="currentColor" />
                    </svg>
                </button>

                <button
                    className="titlebar-btn titlebar-btn--maximize"
                    onClick={() => api.maximize()}
                    aria-label={maximized ? "Restore" : "Maximize"}
                    tabIndex={-1}
                >
                    {maximized ? (
                        <svg width="10" height="10" viewBox="0 0 10 10">
                            <path d="M2 0h6a2 2 0 012 2v6a2 2 0 01-2 2H2a2 2 0 01-2-2V2a2 2 0 012-2z" fill="none" stroke="currentColor" strokeWidth="1" />
                            <path d="M3 0V-.5h5.5A1.5 1.5 0 0110 1v5.5H9.5" fill="none" stroke="currentColor" strokeWidth="1" transform="translate(-.5, -.5)" />
                        </svg>
                    ) : (
                        <svg width="10" height="10" viewBox="0 0 10 10">
                            <rect x=".5" y=".5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
                        </svg>
                    )}
                </button>

                <button
                    className="titlebar-btn titlebar-btn--close"
                    onClick={() => api.close()}
                    aria-label="Close"
                    tabIndex={-1}
                >
                    <svg width="10" height="10" viewBox="0 0 10 10">
                        <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                </button>
            </div>
        </div>
    )
}
