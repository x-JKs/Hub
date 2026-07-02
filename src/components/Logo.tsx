// App logo — the emblem the user dropped in assets. Already transparent.
// Shared by the titlebar and the runtime app-icon generator.

import logoUrl from "../assets/logo.png"

export const LOGO_URL = logoUrl

export function Logo({ size = 16, className }: { size?: number; className?: string }) {
    return (
        <img
            src={logoUrl}
            width={size}
            height={size}
            className={className}
            alt=""
            aria-hidden="true"
            draggable={false}
        />
    )
}
