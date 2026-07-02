interface ElectronWindow {
    minimize(): void
    maximize(): void
    close(): void
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
    onFocusChange(cb: (focused: boolean) => void): () => void
    isMaximized(): Promise<boolean>
    isFocused(): Promise<boolean>
    setWindowIcon(dataUrl: string): void
    showOverlay(): void
    hideOverlay(): void
    sendOverlaySettings(s: { mode: string; period: string }): void
    surfaceOverlay(): void
    unsurfaceOverlay(): void
    onOverlayForeground(cb: (foreground: boolean) => void): () => void
    onOverlayPacket(cb: (state: { available: boolean; active: boolean; startedAt: number | null; confident: boolean }) => void): () => void
    onOverlaySettings(cb: (s: { mode: string; period: string }) => void): () => void
    onUpdateStatus(cb: (s: { state: "available" | "progress" | "ready" | "error"; version?: string; percent?: number }) => void): () => void
    downloadUpdate(): void
    installUpdate(): void
}

interface Window {
    electronWindow?: ElectronWindow
}
