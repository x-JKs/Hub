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
    sendOverlaySettings(s: { mode: string; period: string; position?: string; opacity?: number; showTimer?: boolean }): void
    surfaceOverlay(): void
    unsurfaceOverlay(): void
    onOverlayForeground(cb: (foreground: boolean) => void): () => void
    onOverlayPacket(cb: (state: { available: boolean; active: boolean; startedAt: number | null; confident: boolean; lastPacketAt?: number | null }) => void): () => void
    onOverlaySettings(cb: (s: { mode: string; period: string; position?: string; opacity?: number; showTimer?: boolean }) => void): () => void
    onUpdateStatus(cb: (s: { state: "available" | "progress" | "ready" | "error"; version?: string; percent?: number; notes?: string | null }) => void): () => void
    downloadUpdate(): void
    installUpdate(): void
    setDiscordPresence(activity: { details: string; state?: string; startMs?: number; imageUrl?: string; imageText?: string } | null): void
    setLaunchOnStartup(enabled: boolean): void
    getLaunchOnStartup(): Promise<boolean>
    setMinimizeToTray(enabled: boolean): void
}

interface ElectronLog {
    error(message: string): void
}

interface Window {
    electronWindow?: ElectronWindow
    electronLog?: ElectronLog
}
