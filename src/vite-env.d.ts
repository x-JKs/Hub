/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_BUNGIE_API_KEY?: string
    readonly VITE_OAUTH_CLIENT_ID?: string
    readonly VITE_OAUTH_CLIENT_SECRET?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
