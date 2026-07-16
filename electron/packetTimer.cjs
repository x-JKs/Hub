// Packet-based activity timer (read-only), modelled on Yute's XboxProvider.
//
// Destiny streams its instance/activity traffic over UDP port 3074. While you're
// in an activity those packets flow continuously; in orbit they stop. We SNIFF
// (copy-only, never divert or modify) port-3074 packets via WinDivert and treat a
// >10s gap as "not in an activity" — exactly Yute's logic. We pass NULL for the
// packet buffer, so nothing is ever read, modified, or re-injected; only the
// arrival timing is used.
//
// Requires admin (WinDivert installs a signed kernel driver). If it can't open
// (not elevated / driver blocked), start() returns false and the app falls back
// to the Bungie-API timer.

const path = require("path")

const DLL = path.join(__dirname, "native", "windivert", "WinDivert.dll")
const FILTER = "udp and (udp.SrcPort == 3074 or udp.DstPort == 3074)"
const LAYER_NETWORK = 0
const FLAG_SNIFF = 0x0001
const FLAG_RECV_ONLY = 0x0004
const GAP_MS = 10_000

let koffi, lib, WinDivertOpen, WinDivertRecv, WinDivertClose
let handle = null
let running = false
let available = false
let lastPacket = 0
let instanceStarted = 0
// Whether instanceStarted came from a real orbit→activity gap (trustworthy)
// vs. the first packet after capture began (we may have started mid-activity,
// so the start time is unknown — the renderer falls back to the API start).
let confident = false

function loadLib() {
    if (lib) return true
    try {
        koffi = require("koffi")
        lib = koffi.load(DLL)
        WinDivertOpen = lib.func("void* WinDivertOpen(const char* filter, int layer, int16 priority, uint64 flags)")
        WinDivertRecv = lib.func("bool WinDivertRecv(void* handle, void* pPacket, uint packetLen, void* pRecvLen, void* pAddr)")
        WinDivertClose = lib.func("bool WinDivertClose(void* handle)")
        return true
    } catch (err) {
        console.warn("[packetTimer] could not load WinDivert/koffi:", err.message)
        return false
    }
}

function isInvalid(h) {
    const a = String(koffi.address(h))
    return a === "0" || a === "18446744073709551615" || a === "-1"
}

function recvOnce() {
    return new Promise((resolve, reject) => {
        WinDivertRecv.async(handle, null, 0, null, null, (err, res) => (err ? reject(err) : resolve(res)))
    })
}

async function recvLoop() {
    while (running && handle) {
        try {
            await recvOnce()
        } catch (err) {
            if (running) console.warn("[packetTimer] recv stopped:", err.message)
            break
        }
        const now = Date.now()
        if (now - lastPacket > GAP_MS) {
            instanceStarted = now // fresh instance after a gap
            // Confident only if we'd already seen packets before this gap — i.e.
            // we witnessed the real orbit→activity transition. The very first
            // packet (lastPacket === 0) means capture began mid-activity.
            confident = lastPacket > 0
        }
        lastPacket = now
    }
}

/** Start sniffing. Returns true if the capture is live (admin + driver ok). */
function start() {
    if (running) return available
    if (!loadLib()) return false
    try {
        handle = WinDivertOpen(FILTER, LAYER_NETWORK, 0, FLAG_SNIFF | FLAG_RECV_ONLY)
    } catch (err) {
        console.warn("[packetTimer] WinDivertOpen threw:", err.message)
        return false
    }
    if (isInvalid(handle)) {
        console.warn("[packetTimer] WinDivertOpen failed (run as administrator to enable the packet timer)")
        handle = null
        return false
    }
    running = true
    available = true
    lastPacket = 0
    instanceStarted = 0
    confident = false
    recvLoop()
    console.log("[packetTimer] capture active on UDP 3074")
    return true
}

function stop() {
    running = false
    available = false
    if (handle) {
        try { WinDivertClose(handle) } catch { /* ignore */ }
        handle = null
    }
}

/** Current instance state derived from packet timing. */
function getState() {
    if (!available) return { available: false, active: false, startedAt: null, confident: false, lastPacketAt: null }
    const active = lastPacket > 0 && Date.now() - lastPacket <= GAP_MS
    return {
        available: true,
        active,
        startedAt: active ? instanceStarted : null,
        confident: active ? confident : false,
        // Lets the renderer freeze the display during short (1–10s) packet gaps —
        // Yute's InstanceDuration returns its last result during those, so the
        // timer visibly pauses on loading screens instead of running through them.
        lastPacketAt: lastPacket > 0 ? lastPacket : null,
    }
}

module.exports = { start, stop, getState }
