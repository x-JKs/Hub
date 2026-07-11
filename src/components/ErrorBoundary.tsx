import { Component, type ErrorInfo, type ReactNode } from "react"

interface Props {
    children: ReactNode
}

interface State {
    error: Error | null
}

/**
 * Top-level error boundary: a render crash anywhere below shows a friendly
 * recovery screen instead of a blank window. The title bar stays mounted
 * outside the boundary so the window can always be closed.
 */
export class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("Unhandled render error:", error, info.componentStack)
        // Forward to the main process log file when running in Electron.
        window.electronLog?.error?.(
            `render crash: ${error.message}\n${error.stack ?? ""}${info.componentStack ?? ""}`
        )
    }

    render() {
        if (!this.state.error) return this.props.children
        return (
            <div className="crash">
                <div className="crash-box">
                    <h2>Something went wrong</h2>
                    <p>
                        The app hit an unexpected error and couldn&rsquo;t recover on its own.
                        Reloading usually fixes it.
                    </p>
                    <pre className="crash-detail">{this.state.error.message}</pre>
                    <div className="crash-actions">
                        <button
                            className="crash-reload"
                            onClick={() => window.location.reload()}
                        >
                            Reload app
                        </button>
                        <button
                            className="crash-continue"
                            onClick={() => this.setState({ error: null })}
                        >
                            Try to continue
                        </button>
                    </div>
                </div>
            </div>
        )
    }
}
