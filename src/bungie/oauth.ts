// Bungie OAuth2 flow for the Electron app.
// Uses a localhost callback server (started by main.cjs on port 8420) and
// polls for the auth code after the user authorizes in their system browser.

import { getApiKey } from "./client"

const OAUTH_PORT = 8420
const REDIRECT_URI = "destiny-tracker://callback"
const AUTH_URL = "https://www.bungie.net/en/OAuth/Authorize"
const TOKEN_URL = "https://www.bungie.net/platform/app/oauth/token/"

const STORAGE_KEYS = {
    clientId: "oauth-client-id",
    clientSecret: "oauth-client-secret",
    accessToken: "oauth-access-token",
    refreshToken: "oauth-refresh-token",
    expiresAt: "oauth-expires-at",
    membershipId: "oauth-membership-id",
    destinyType: "oauth-destiny-type",
    destinyId: "oauth-destiny-id",
    displayName: "oauth-display-name",
} as const

// ---------------------------------------------------------------------------
// Client credential storage (defaults built in, overridable via settings)
// ---------------------------------------------------------------------------

// Baked in at build time from .env (gitignored). Empty in the committed source /
// a fresh clone — set VITE_OAUTH_CLIENT_ID and VITE_OAUTH_CLIENT_SECRET before
// building an official release. Anything stored in-app takes precedence.
const DEFAULT_CLIENT_ID = (import.meta.env.VITE_OAUTH_CLIENT_ID as string | undefined)?.trim() ?? ""
const DEFAULT_CLIENT_SECRET =
    (import.meta.env.VITE_OAUTH_CLIENT_SECRET as string | undefined)?.trim() ?? ""

export function getOAuthClientId(): string {
    return localStorage.getItem(STORAGE_KEYS.clientId)?.trim() || DEFAULT_CLIENT_ID
}

export function getOAuthClientSecret(): string {
    return localStorage.getItem(STORAGE_KEYS.clientSecret)?.trim() || DEFAULT_CLIENT_SECRET
}

export function setOAuthCredentials(clientId: string, clientSecret: string) {
    localStorage.setItem(STORAGE_KEYS.clientId, clientId.trim())
    localStorage.setItem(STORAGE_KEYS.clientSecret, clientSecret.trim())
}

export function hasOAuthCredentials(): boolean {
    return Boolean(getOAuthClientId() && getOAuthClientSecret())
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

interface TokenData {
    accessToken: string
    refreshToken: string
    expiresAt: number
    membershipId: string
}

function getStoredTokens(): TokenData | null {
    const accessToken = localStorage.getItem(STORAGE_KEYS.accessToken)
    const refreshToken = localStorage.getItem(STORAGE_KEYS.refreshToken)
    const expiresAt = Number(localStorage.getItem(STORAGE_KEYS.expiresAt) || 0)
    const membershipId = localStorage.getItem(STORAGE_KEYS.membershipId) ?? ""
    if (!accessToken || !refreshToken) return null
    return { accessToken, refreshToken, expiresAt, membershipId }
}

function storeTokens(data: TokenData) {
    localStorage.setItem(STORAGE_KEYS.accessToken, data.accessToken)
    localStorage.setItem(STORAGE_KEYS.refreshToken, data.refreshToken)
    localStorage.setItem(STORAGE_KEYS.expiresAt, String(data.expiresAt))
    localStorage.setItem(STORAGE_KEYS.membershipId, data.membershipId)
}

export function clearTokens() {
    localStorage.removeItem(STORAGE_KEYS.accessToken)
    localStorage.removeItem(STORAGE_KEYS.refreshToken)
    localStorage.removeItem(STORAGE_KEYS.expiresAt)
    localStorage.removeItem(STORAGE_KEYS.membershipId)
    localStorage.removeItem(STORAGE_KEYS.destinyType)
    localStorage.removeItem(STORAGE_KEYS.destinyId)
    localStorage.removeItem(STORAGE_KEYS.displayName)
}

export function isLoggedIn(): boolean {
    return getStoredTokens() !== null
}

export function getStoredMembershipId(): string | null {
    return localStorage.getItem(STORAGE_KEYS.membershipId) || null
}

export interface DestinyMembership {
    membershipType: number
    membershipId: string
    displayName: string
}

export function getStoredDestinyMembership(): DestinyMembership | null {
    const membershipType = Number(localStorage.getItem(STORAGE_KEYS.destinyType) || 0)
    const membershipId = localStorage.getItem(STORAGE_KEYS.destinyId)
    const displayName = localStorage.getItem(STORAGE_KEYS.displayName) ?? ""
    if (!membershipId || !membershipType) return null
    return { membershipType, membershipId, displayName }
}

function storeDestinyMembership(m: DestinyMembership) {
    localStorage.setItem(STORAGE_KEYS.destinyType, String(m.membershipType))
    localStorage.setItem(STORAGE_KEYS.destinyId, m.membershipId)
    localStorage.setItem(STORAGE_KEYS.displayName, m.displayName)
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

export const PLATFORM_NAMES: Record<number, string> = {
    1: "Xbox",
    2: "PlayStation",
    3: "Steam",
    4: "Blizzard",
    5: "Stadia",
    6: "Epic Games",
    10: "Demon",
    254: "Bungie.net",
}

export interface LoginResult {
    memberships: DestinyMembership[]
    picked: DestinyMembership
}

export async function startLogin(): Promise<LoginResult> {
    const clientId = getOAuthClientId()
    if (!clientId) throw new Error("OAuth Client ID not configured")

    await fetch(`http://localhost:${OAUTH_PORT}/clear`)

    const authUrl = `${AUTH_URL}?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    window.open(authUrl, "_blank")

    const code = await pollForCode()
    await exchangeCode(code)

    return resolveDestinyMemberships()
}

async function resolveDestinyMemberships(): Promise<LoginResult> {
    const data = await bungieAuthGet<{
        destinyMemberships: Array<{
            membershipType: number
            membershipId: string
            displayName: string
            bungieGlobalDisplayName: string
            bungieGlobalDisplayNameCode: number
            crossSaveOverride: number
        }>
        primaryMembershipId: string
    }>("/User/GetMembershipsForCurrentUser/")

    const raw = data.destinyMemberships
    if (!raw.length) throw new Error("No Destiny memberships found on this account")

    const memberships: DestinyMembership[] = raw.map(m => {
        const display = m.bungieGlobalDisplayName && m.bungieGlobalDisplayNameCode
            ? `${m.bungieGlobalDisplayName}#${String(m.bungieGlobalDisplayNameCode).padStart(4, "0")}`
            : m.displayName
        return {
            membershipType: m.membershipType,
            membershipId: m.membershipId,
            displayName: display,
        }
    })

    const picked = memberships.find(m => m.membershipId === data.primaryMembershipId)
        ?? memberships.find(m => {
            const r = raw.find(x => x.membershipId === m.membershipId)
            return r && r.crossSaveOverride === r.membershipType
        })
        ?? memberships[0]

    storeDestinyMembership(picked)
    return { memberships, picked }
}

export function selectMembership(m: DestinyMembership) {
    storeDestinyMembership(m)
}

async function pollForCode(): Promise<string> {
    for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 1000))
        try {
            const res = await fetch(`http://localhost:${OAUTH_PORT}/poll`)
            const data = await res.json()
            if (data.code) {
                await fetch(`http://localhost:${OAUTH_PORT}/clear`)
                return data.code
            }
        } catch {
            // Server not ready yet
        }
    }
    throw new Error("Login timed out — no authorization received within 5 minutes")
}

async function exchangeCode(code: string): Promise<TokenData> {
    const clientId = getOAuthClientId()
    const clientSecret = getOAuthClientSecret()

    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
    })

    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    })

    if (!res.ok) {
        const text = await res.text()
        throw new Error(`Token exchange failed (${res.status}): ${text}`)
    }

    const json = await res.json()
    const data: TokenData = {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: Date.now() + json.expires_in * 1000,
        membershipId: json.membership_id,
    }
    storeTokens(data)
    return data
}

async function refreshAccessToken(): Promise<TokenData> {
    const stored = getStoredTokens()
    if (!stored) throw new Error("No refresh token")

    const clientId = getOAuthClientId()
    const clientSecret = getOAuthClientSecret()

    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
    })

    const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    })

    if (!res.ok) {
        clearTokens()
        throw new Error("Session expired — please log in again")
    }

    const json = await res.json()
    const data: TokenData = {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: Date.now() + json.expires_in * 1000,
        membershipId: json.membership_id,
    }
    storeTokens(data)
    return data
}

// ---------------------------------------------------------------------------
// Authenticated API helper
// ---------------------------------------------------------------------------

export async function getAccessToken(): Promise<string> {
    let tokens = getStoredTokens()
    if (!tokens) throw new Error("Not logged in")

    // Refresh if expired (with 60s buffer)
    if (Date.now() > tokens.expiresAt - 60_000) {
        tokens = await refreshAccessToken()
    }
    return tokens.accessToken
}

/** Make an authenticated GET to the Bungie API. */
export async function bungieAuthGet<T>(path: string): Promise<T> {
    const token = await getAccessToken()
    const apiKey = getApiKey()

    const res = await fetch(`https://www.bungie.net/Platform${path}`, {
        headers: {
            "X-API-Key": apiKey!,
            Authorization: `Bearer ${token}`,
        },
    })

    const body = await res.json()
    if (body.ErrorCode !== 1) {
        throw new Error(body.Message || `Bungie error: ${body.ErrorStatus}`)
    }
    return body.Response
}
