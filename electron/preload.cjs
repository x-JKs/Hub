const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("electronWindow", {
    minimize: () => ipcRenderer.send("win:minimize"),
    maximize: () => ipcRenderer.send("win:maximize"),
    close: () => ipcRenderer.send("win:close"),
    onMaximizeChange: (cb) => {
        const handler = (_e, val) => cb(val)
        ipcRenderer.on("win:maximized", handler)
        return () => ipcRenderer.removeListener("win:maximized", handler)
    },
    onFocusChange: (cb) => {
        const handler = (_e, val) => cb(val)
        ipcRenderer.on("win:focus", handler)
        return () => ipcRenderer.removeListener("win:focus", handler)
    },
    isMaximized: () => ipcRenderer.invoke("win:isMaximized"),
    isFocused: () => ipcRenderer.invoke("win:isFocused"),
    setWindowIcon: (dataUrl) => ipcRenderer.send("win:set-icon", dataUrl),
    showOverlay: () => ipcRenderer.send("overlay:show"),
    hideOverlay: () => ipcRenderer.send("overlay:hide"),
    sendOverlaySettings: (s) => ipcRenderer.send("overlay:settings", s),
    surfaceOverlay: () => ipcRenderer.send("overlay:surface"),
    unsurfaceOverlay: () => ipcRenderer.send("overlay:unsurface"),
    onOverlayForeground: (cb) => {
        const handler = (_e, val) => cb(val)
        ipcRenderer.on("overlay:foreground", handler)
        return () => ipcRenderer.removeListener("overlay:foreground", handler)
    },
    onOverlayPacket: (cb) => {
        const handler = (_e, state) => cb(state)
        ipcRenderer.on("overlay:packet", handler)
        return () => ipcRenderer.removeListener("overlay:packet", handler)
    },
    onOverlaySettings: (cb) => {
        const handler = (_e, s) => cb(s)
        ipcRenderer.on("overlay:settings", handler)
        return () => ipcRenderer.removeListener("overlay:settings", handler)
    },
    onUpdateStatus: (cb) => {
        const handler = (_e, s) => cb(s)
        ipcRenderer.on("update:status", handler)
        return () => ipcRenderer.removeListener("update:status", handler)
    },
    downloadUpdate: () => ipcRenderer.send("update:download"),
    installUpdate: () => ipcRenderer.send("update:install"),
})

// Renderer error reporting → userData/hub.log (see main.cjs logError).
contextBridge.exposeInMainWorld("electronLog", {
    error: (message) => ipcRenderer.send("log:error", String(message)),
})
