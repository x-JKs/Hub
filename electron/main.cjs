// Electron main process. Creates the window and loads the built Vite app
// (or the dev server when ELECTRON_DEV is set).

const { app, BrowserWindow, ipcMain, nativeImage, session, shell } = require("electron")
const { execSync, spawn } = require("child_process")
const http = require("http")
const path = require("path")
const packetTimer = require("./packetTimer.cjs")

const isDev = !!process.env.ELECTRON_DEV
const PROTOCOL = "destiny-tracker"

// Auto-updater. Only bundled in official electron-builder releases (which also
// ship the app-update.yml that points at the GitHub releases feed). The require
// is guarded so the portable/dev build — which doesn't bundle it — still runs.
let autoUpdater = null
try {
    autoUpdater = require("electron-updater").autoUpdater
} catch {
    /* not an official release build */
}

function initAutoUpdate() {
    if (!autoUpdater || !app.isPackaged) return
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on("error", e => console.warn("[updater] error:", e?.message ?? e))
    autoUpdater.on("update-available", i => console.log("[updater] update available:", i?.version))
    autoUpdater.on("update-downloaded", i =>
        console.log("[updater] downloaded", i?.version, "— installs on quit")
    )
    // Downloads a newer release in the background and installs it on next quit.
    autoUpdater.checkForUpdatesAndNotify().catch(e =>
        console.warn("[updater] check failed:", e?.message ?? e)
    )
}

const OAUTH_PORT = 8420

let mainWindow = null
let overlayWindow = null
let oauthCode = null



// ---------------------------------------------------------------------------
// Custom protocol — register destiny-tracker:// in the Windows registry so
// the system browser can redirect back to this app after Bungie OAuth.
// Uses HKCU (no admin needed). Re-registers on every launch so the exe path
// stays current even if the user moves the folder.
// ---------------------------------------------------------------------------

function registerProtocol() {
    const exePath = process.execPath.replace(/\\/g, "\\\\")
    // In dev (`electron .`) execPath is electron.exe, which must be launched with
    // the APP PATH before the callback URL — otherwise Windows runs
    // `electron.exe "destiny-tracker://callback?..."` and Electron tries to load
    // the URL as the app ("Cannot find module ...destiny-tracker:\callback").
    // Packaged, execPath is the app exe itself, so no app path is needed.
    let command
    if (process.defaultApp) {
        const appPath = app.getAppPath().replace(/\\/g, "\\\\")
        command = `\\"${exePath}\\" \\"${appPath}\\" \\"%1\\"`
    } else {
        command = `\\"${exePath}\\" \\"%1\\"`
    }
    try {
        execSync(`reg add "HKCU\\Software\\Classes\\${PROTOCOL}" /ve /d "URL:Destiny Tracker" /f`, { stdio: "ignore" })
        execSync(`reg add "HKCU\\Software\\Classes\\${PROTOCOL}" /v "URL Protocol" /d "" /f`, { stdio: "ignore" })
        execSync(`reg add "HKCU\\Software\\Classes\\${PROTOCOL}\\shell\\open\\command" /ve /d "${command}" /f`, { stdio: "ignore" })
    } catch (err) {
        console.warn("Failed to register protocol handler:", err.message)
    }
}

// ---------------------------------------------------------------------------
// Single-instance lock — when Bungie redirects to destiny-tracker://callback,
// Windows launches a second exe. The lock routes those args to the existing
// instance instead.
// ---------------------------------------------------------------------------

function extractCodeFromArgs(argv) {
    const arg = argv.find(a => a.startsWith(`${PROTOCOL}://`))
    if (!arg) return
    try {
        const parsed = new URL(arg)
        const code = parsed.searchParams.get("code")
        if (code) oauthCode = code
    } catch {
        const m = arg.match(/[?&]code=([^&]+)/)
        if (m) oauthCode = m[1]
    }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
    // This is the second instance launched by the protocol redirect.
    // The args are forwarded to the first instance via second-instance event.
    app.quit()
} else {
    app.on("second-instance", (_event, argv) => {
        extractCodeFromArgs(argv)
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }
    })
}

// Also check our own launch args (in case the app wasn't running when the
// redirect happened and this IS the first instance)
extractCodeFromArgs(process.argv)

// ---------------------------------------------------------------------------
// Bungie Origin stripping
// ---------------------------------------------------------------------------

function stripBungieOrigin() {
    session.defaultSession.webRequest.onBeforeSendHeaders(
        { urls: ["https://www.bungie.net/*", "https://stats.bungie.net/*"] },
        (details, callback) => {
            const headers = details.requestHeaders
            for (const key of Object.keys(headers)) {
                const lower = key.toLowerCase()
                if (lower === "origin" || lower === "referer") delete headers[key]
            }
            callback({ requestHeaders: headers })
        }
    )
}

// ---------------------------------------------------------------------------
// Bridge server — renderer polls /poll to retrieve the auth code
// ---------------------------------------------------------------------------

function startBridgeServer() {
    const server = http.createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*")
        res.setHeader("Access-Control-Allow-Methods", "GET")
        const url = new URL(req.url, `http://localhost:${OAUTH_PORT}`)

        if (url.pathname === "/poll") {
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ code: oauthCode }))
            return
        }

        if (url.pathname === "/clear") {
            oauthCode = null
            res.writeHead(200, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ ok: true }))
            return
        }

        res.writeHead(404)
        res.end()
    })

    server.listen(OAUTH_PORT, "127.0.0.1", () => {
        if (isDev) console.log(`Bridge server on http://127.0.0.1:${OAUTH_PORT}`)
    })

    server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
            console.warn(`Bridge port ${OAUTH_PORT} already in use, skipping`)
        } else {
            console.error("Bridge server error:", err)
        }
    })
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 760,
        minWidth: 760,
        minHeight: 560,
        backgroundColor: "#06060a",
        frame: false,
        autoHideMenuBar: true,
        webPreferences: {
            webSecurity: false,
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
        }
    })

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)
        return { action: "deny" }
    })

    // Window state → renderer
    const sendMaxState = () => {
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send("win:maximized", mainWindow.isMaximized())
    }
    mainWindow.on("maximize", sendMaxState)
    mainWindow.on("unmaximize", sendMaxState)

    mainWindow.on("focus", () => {
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send("win:focus", true)
    })
    mainWindow.on("blur", () => {
        if (mainWindow && !mainWindow.isDestroyed())
            mainWindow.webContents.send("win:focus", false)
    })

    if (isDev) {
        mainWindow.loadURL("http://localhost:5173")
        mainWindow.webContents.openDevTools({ mode: "detach" })
    } else {
        mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"))
    }

    mainWindow.on("closed", () => {
        mainWindow = null
        if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
    })
}

// Window control IPC
ipcMain.on("win:minimize", () => mainWindow?.minimize())
ipcMain.on("win:maximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
})
ipcMain.on("win:close", () => mainWindow?.close())
ipcMain.handle("win:isMaximized", () => mainWindow?.isMaximized() ?? false)
ipcMain.handle("win:isFocused", () => mainWindow?.isFocused() ?? true)
ipcMain.on("win:set-icon", (_event, dataUrl) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    try {
        const img = nativeImage.createFromDataURL(dataUrl)
        if (!img.isEmpty()) mainWindow.setIcon(img)
    } catch { /* non-critical */ }
})

// ---------------------------------------------------------------------------
// Overlay window
// ---------------------------------------------------------------------------

const GAME_PROCESS = "destiny2" // foreground exe (minus .exe) we show the overlay for
let gameForeground = false      // is Destiny the focused window right now?
let overlayNotifActive = false  // is a completion toast currently showing?
let fgProc = null               // persistent foreground-watcher child process
let overlayHideTimer = null     // delays the hide so the renderer can fade out

// Show the normal overlay only while the game is focused; a completion toast
// (notifActive) forces it visible even when the game is alt-tabbed away.
function applyOverlayVisibility() {
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    clearTimeout(overlayHideTimer)
    if (overlayNotifActive || gameForeground) {
        overlayWindow.showInactive()
        overlayWindow.moveTop()
    } else {
        // Delay the actual hide so the renderer's fade-out (driven by the
        // overlay:foreground signal) plays before the window disappears.
        overlayHideTimer = setTimeout(() => {
            if (overlayWindow && !overlayWindow.isDestroyed() && !overlayNotifActive && !gameForeground) {
                overlayWindow.hide()
            }
        }, 450)
    }
}

// Persistent PowerShell loop that prints the foreground window's process name
// (~2/sec). Far cheaper than spawning a process per poll.
function startForegroundWatch() {
    if (fgProc) return
    const script =
        '$s=@"\n' +
        'using System;using System.Runtime.InteropServices;\n' +
        'public class FG{[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();' +
        '[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);}\n' +
        '"@\n' +
        'Add-Type $s\n' +
        'while($true){$h=[FG]::GetForegroundWindow();$p=0;[void][FG]::GetWindowThreadProcessId($h,[ref]$p);' +
        'try{$n=(Get-Process -Id $p -ErrorAction Stop).ProcessName}catch{$n=""};' +
        '[Console]::Out.WriteLine($n);[Console]::Out.Flush();Start-Sleep -Milliseconds 500}'

    try {
        fgProc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
            windowsHide: true,
        })
    } catch (err) {
        console.warn("Foreground watch failed to start:", err.message)
        return
    }

    fgProc.stdout.on("data", (buf) => {
        const lines = buf.toString().split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        if (lines.length === 0) return
        const name = lines[lines.length - 1].toLowerCase()
        const next = name === GAME_PROCESS
        if (next !== gameForeground) {
            gameForeground = next
            // Tell the renderer first so it can fade out before the delayed hide.
            if (overlayWindow && !overlayWindow.isDestroyed()) {
                overlayWindow.webContents.send("overlay:foreground", gameForeground)
            }
            applyOverlayVisibility()
        }
    })
    fgProc.on("exit", () => { fgProc = null })
}

function stopForegroundWatch() {
    if (fgProc) {
        try { fgProc.kill() } catch { /* ignore */ }
        fgProc = null
    }
}

function createOverlay() {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        applyOverlayVisibility()
        return
    }

    overlayWindow = new BrowserWindow({
        // Wide + transparent/click-through so long completion-notification names
        // (e.g. "Pantheon: Insurrection Prime Revolutionary: Customize") show in
        // full instead of clipping at the window edge. The visible content (top-
        // left) sizes itself to its text.
        width: 900,
        height: 90,
        x: 8,
        y: 8,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        hasShadow: false,
        focusable: false,
        show: false,
        backgroundColor: "#00000000",
        webPreferences: {
            webSecurity: false,
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            // The overlay never holds focus (focusable:false, click-through), so
            // Chromium would throttle/freeze its timer tick while the game is
            // foreground — making the elapsed timer drift further behind the
            // longer you play. Keep it running at full rate.
            backgroundThrottling: false,
        }
    })

    overlayWindow.setAlwaysOnTop(true, "screen-saver")
    overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    overlayWindow.webContents.setBackgroundThrottling(false)

    if (isDev) {
        overlayWindow.loadURL("http://localhost:5173?overlay=true")
    } else {
        overlayWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
            query: { overlay: "true" }
        })
    }

    overlayWindow.webContents.on("did-finish-load", () => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send("overlay:foreground", gameForeground)
        }
    })

    overlayWindow.on("closed", () => {
        overlayWindow = null
        overlayNotifActive = false
        stopForegroundWatch()
        stopPacketTimer()
    })

    startForegroundWatch()
    startPacketTimer()
}

// Packet-based timer: start the capture and push instance state to the overlay.
let packetStateInterval = null
function startPacketTimer() {
    packetTimer.start() // returns false (and stays available:false) without admin
    clearInterval(packetStateInterval)
    packetStateInterval = setInterval(() => {
        if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send("overlay:packet", packetTimer.getState())
        }
    }, 500)
}
function stopPacketTimer() {
    clearInterval(packetStateInterval)
    packetStateInterval = null
    packetTimer.stop()
}

ipcMain.on("overlay:show", () => createOverlay())
ipcMain.on("overlay:hide", () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
    stopForegroundWatch()
})
ipcMain.on("overlay:settings", (_event, settings) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send("overlay:settings", settings)
    }
})
// A completion toast started — force the overlay above everything (even when the
// game is alt-tabbed away) so the notification is always seen.
ipcMain.on("overlay:surface", () => {
    overlayNotifActive = true
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setAlwaysOnTop(true, "screen-saver")
        overlayWindow.showInactive()
        overlayWindow.moveTop()
    }
})
// Toast ended — return to normal (visible only while the game is focused).
ipcMain.on("overlay:unsurface", () => {
    overlayNotifActive = false
    applyOverlayVisibility()
})

app.whenReady().then(() => {
    registerProtocol()
    stripBungieOrigin()
    startBridgeServer()
    createWindow()
    initAutoUpdate()
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
})

app.on("before-quit", () => { stopForegroundWatch(); stopPacketTimer() })

app.on("window-all-closed", () => {
    stopForegroundWatch()
    stopPacketTimer()
    if (process.platform !== "darwin") app.quit()
})
