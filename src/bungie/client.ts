// Low-level Bungie.net API client.
// Only an API key is required for the public endpoints we use (player search,
// profile/characters, and activity history). Bungie sends permissive CORS
// headers, so we can call it directly from the browser.

// In dev we route through a Vite proxy that strips the Origin header (the API
// key is origin-restricted, and Bungie rejects browser POSTs whose Origin
// doesn't match). In the packaged app we call Bungie directly — the Electron
// main process strips Origin via a webRequest handler instead.
const BASE = import.meta.env.DEV ? "/bungie/Platform" : "https://www.bungie.net/Platform"
const STATS_BASE = import.meta.env.DEV ? "/bungie-stats/Platform" : "https://stats.bungie.net/Platform"

// The API key is baked in at BUILD time from .env (VITE_BUNGIE_API_KEY), so
// official release builds work out of the box. The committed source has no key —
// set VITE_BUNGIE_API_KEY in a local .env (gitignored) before building. A key
// entered in-app (stored) always takes precedence. Order: stored > built-in.
const KEY_STORAGE = "bungie-api-key"
const BUILTIN_KEY = (import.meta.env.VITE_BUNGIE_API_KEY as string | undefined)?.trim() ?? ""

export function getApiKey(): string | undefined {
    try {
        const stored = localStorage.getItem(KEY_STORAGE)?.trim()
        if (stored) return stored
    } catch {
        /* localStorage unavailable */
    }
    return BUILTIN_KEY || undefined
}

/** Whether a key was baked into this build — used to hide the in-app key field. */
export function hasBuiltinApiKey(): boolean {
    return BUILTIN_KEY.length > 0
}

export function setApiKey(key: string): void {
    try {
        const trimmed = key.trim()
        if (trimmed) localStorage.setItem(KEY_STORAGE, trimmed)
        else localStorage.removeItem(KEY_STORAGE)
    } catch {
        /* localStorage unavailable */
    }
}

export class BungieError extends Error {
    constructor(
        message: string,
        readonly errorCode?: number,
        readonly status?: number
    ) {
        super(message)
        this.name = "BungieError"
    }
}

/** Standard Bungie API envelope. The payload we care about lives in `Response`. */
interface BungieEnvelope<T> {
    Response: T
    ErrorCode: number
    ErrorStatus: string
    Message: string
    /** Set on throttle errors: how long Bungie wants us to back off. */
    ThrottleSeconds?: number
}

function assertKey(): string {
    const key = getApiKey()
    if (!key) {
        throw new BungieError(
            "Missing Bungie API key. Add your key in the app's settings, then try again."
        )
    }
    return key
}

// ---------------------------------------------------------------------------
// Throttle protection. Big accounts fire hundreds of requests on first load
// (history pages + PGCR verification), so: cap in-flight requests globally,
// and retry throttle responses honoring Bungie's ThrottleSeconds.
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 12
const MAX_THROTTLE_RETRIES = 3
// DestinyThrottledByGameServer / ThrottleLimitExceeded(+Minutes/Momentarily/
// Seconds) / PerApplication(+PerUser)ThrottleExceeded / PerEndpointRequestThrottleExceeded
const THROTTLE_CODES = new Set([31, 32, 33, 34, 35, 36, 51])

let activeRequests = 0
const requestQueue: (() => void)[] = []

function acquireSlot(): Promise<void> {
    return new Promise(resolve => {
        if (activeRequests < MAX_CONCURRENT) {
            activeRequests++
            resolve()
        } else {
            requestQueue.push(() => {
                activeRequests++
                resolve()
            })
        }
    })
}

function releaseSlot() {
    activeRequests--
    requestQueue.shift()?.()
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        await acquireSlot()
        let res: Response
        let body: BungieEnvelope<T> | null
        try {
            res = await fetch(`${base}${path}`, {
                ...init,
                headers: {
                    "X-API-Key": assertKey(),
                    ...(init?.body ? { "Content-Type": "application/json" } : {}),
                    ...init?.headers
                }
            })
            try {
                body = await res.json()
            } catch {
                body = null
            }
        } finally {
            releaseSlot()
        }

        const throttled =
            res.status === 429 ||
            (body !== null && body.ErrorCode !== 1 && THROTTLE_CODES.has(body.ErrorCode))
        if (throttled && attempt < MAX_THROTTLE_RETRIES) {
            const waitMs = Math.max((body?.ThrottleSeconds ?? 0) * 1000, 1000 * (attempt + 1))
            await sleep(waitMs)
            continue
        }

        if (body === null) {
            throw new BungieError(
                `Bungie returned a non-JSON response (HTTP ${res.status})`,
                undefined,
                res.status
            )
        }

        // Bungie always returns 200 with an ErrorCode field; 1 means Success.
        if (body.ErrorCode !== 1) {
            throw new BungieError(
                body.Message || `Bungie error ${body.ErrorStatus}`,
                body.ErrorCode,
                res.status
            )
        }
        return body.Response
    }
}

export const bungieGet = <T>(path: string, init?: RequestInit) => request<T>(BASE, path, init)

/** Like bungieGet but bypasses the HTTP cache — for time-sensitive live data. */
export const bungieGetFresh = <T>(path: string) => request<T>(BASE, path, { cache: "no-store" })

export const bungiePost = <T>(path: string, payload: unknown) =>
    request<T>(BASE, path, { method: "POST", body: JSON.stringify(payload) })

export const bungieStatsGet = <T>(path: string) => request<T>(STATS_BASE, path)

export const hasApiKey = () => Boolean(getApiKey())

/** Resolve a Bungie.net relative asset path (e.g. iconPath) to an absolute URL. */
export const bungieAsset = (relativePath?: string | null) =>
    relativePath ? `https://www.bungie.net${relativePath}` : null
