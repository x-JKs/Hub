// Discord Rich Presence over Discord's local IPC pipe — no dependencies.
// Speaks the same length-prefixed JSON frame protocol as the discord-rpc
// library, over \\?\pipe\discord-ipc-N. Reconnects quietly in the background
// when Discord isn't running, and re-applies the last requested presence once
// it comes up. Modelled on Yute's DiscordPresenceService.

const net = require("net")

// The "Hub" Discord application — its name is what Discord shows as
// "Playing Hub", and hub_logo is the art asset uploaded to it.
const CLIENT_ID = "1527082476160290847"
const LOGO_ASSET = "hub_logo"
const LOGO_TEXT = "Hub — Destiny 2 tracker"

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2

const RETRY_MS = 30_000

let socket = null
let ready = false
let stopped = false
let retryTimer = null
let nonce = 0
// Last requested presence ({details, state?, startMs?} or null = clear).
// Kept so a (re)connect can immediately apply the current state.
let desired = null
let lastSentJson = null
let recvBuf = Buffer.alloc(0)

function frame(op, payload) {
    const data = Buffer.from(JSON.stringify(payload), "utf8")
    const buf = Buffer.alloc(8 + data.length)
    buf.writeInt32LE(op, 0)
    buf.writeInt32LE(data.length, 4)
    data.copy(buf, 8)
    return buf
}

function scheduleRetry() {
    if (stopped || retryTimer) return
    retryTimer = setTimeout(() => {
        retryTimer = null
        connect()
    }, RETRY_MS)
}

function teardown() {
    ready = false
    lastSentJson = null
    if (socket) {
        try { socket.destroy() } catch { /* ignore */ }
        socket = null
    }
}

function connect(pipe = 0) {
    if (stopped || socket) return
    const path = `\\\\?\\pipe\\discord-ipc-${pipe}`
    const sock = net.createConnection(path)
    let settled = false

    sock.on("connect", () => {
        settled = true
        socket = sock
        recvBuf = Buffer.alloc(0)
        sock.write(frame(OP_HANDSHAKE, { v: 1, client_id: CLIENT_ID }))
    })

    sock.on("data", chunk => {
        recvBuf = Buffer.concat([recvBuf, chunk])
        while (recvBuf.length >= 8) {
            const op = recvBuf.readInt32LE(0)
            const len = recvBuf.readInt32LE(4)
            if (recvBuf.length < 8 + len) break
            const body = recvBuf.subarray(8, 8 + len).toString("utf8")
            recvBuf = recvBuf.subarray(8 + len)
            try {
                const msg = JSON.parse(body)
                if (op === OP_FRAME && msg.evt === "READY") {
                    ready = true
                    console.log("[discord] connected — presence ready")
                    flush()
                } else if (op === OP_CLOSE) {
                    teardown()
                    scheduleRetry()
                }
            } catch { /* ignore malformed frames */ }
        }
    })

    sock.on("error", () => {
        if (!settled && pipe < 9) {
            // This pipe doesn't exist — Discord may be on a higher index.
            connect(pipe + 1)
            return
        }
        teardown()
        scheduleRetry()
    })

    sock.on("close", () => {
        if (!settled) return // error path already advanced/scheduled
        teardown()
        scheduleRetry()
    })
}

function flush() {
    if (!ready || !socket) return
    // With activity artwork (an https URL — Discord proxies external images),
    // the splash becomes the large image and the Hub logo sits in the corner;
    // otherwise the logo takes the large slot.
    const hasArt = Boolean(desired && desired.imageUrl)
    const activity = desired
        ? {
              details: desired.details,
              state: desired.state || undefined,
              assets: hasArt
                  ? {
                        large_image: desired.imageUrl,
                        large_text: desired.imageText || desired.details,
                        small_image: LOGO_ASSET,
                        small_text: LOGO_TEXT,
                    }
                  : { large_image: LOGO_ASSET, large_text: LOGO_TEXT },
              timestamps: desired.startMs
                  ? { start: Math.floor(desired.startMs / 1000) }
                  : undefined,
          }
        : undefined // omitting `activity` clears the presence

    const json = JSON.stringify(activity ?? null)
    if (json === lastSentJson) return
    lastSentJson = json

    try {
        socket.write(frame(OP_FRAME, {
            cmd: "SET_ACTIVITY",
            nonce: String(++nonce),
            args: { pid: process.pid, activity },
        }))
    } catch {
        teardown()
        scheduleRetry()
    }
}

/** Set (or clear, with null) the desired presence. Connects on first use. */
function setActivity(activity) {
    desired = activity
    if (ready) flush()
    else if (!socket && !retryTimer) connect()
}

function stop() {
    stopped = true
    clearTimeout(retryTimer)
    retryTimer = null
    desired = null
    if (ready && socket) {
        // Best-effort clear before disconnecting.
        try {
            socket.write(frame(OP_FRAME, {
                cmd: "SET_ACTIVITY",
                nonce: String(++nonce),
                args: { pid: process.pid },
            }))
        } catch { /* ignore */ }
    }
    teardown()
}

module.exports = { setActivity, stop }
