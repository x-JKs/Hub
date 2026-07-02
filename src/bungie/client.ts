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

async function request<T>(base: string, path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
        ...init,
        headers: {
            "X-API-Key": assertKey(),
            ...(init?.body ? { "Content-Type": "application/json" } : {}),
            ...init?.headers
        }
    })

    let body: BungieEnvelope<T>
    try {
        body = await res.json()
    } catch {
        throw new BungieError(`Bungie returned a non-JSON response (HTTP ${res.status})`, undefined, res.status)
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
