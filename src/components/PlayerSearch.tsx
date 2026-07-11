import { useEffect, useRef, useState } from "react"
import { searchPlayers } from "../bungie/api"
import { bungieAsset } from "../bungie/client"
import { UserInfoCard } from "../bungie/types"
import { SelectedPlayer } from "../hooks/useActivities"

interface Props {
    onSelect: (player: SelectedPlayer) => void
    placeholder?: string
}

function bungieName(card: UserInfoCard) {
    if (card.bungieGlobalDisplayName) {
        const code = card.bungieGlobalDisplayNameCode?.toString().padStart(4, "0")
        return { name: card.bungieGlobalDisplayName, code: code ? `#${code}` : "" }
    }
    return { name: card.displayName, code: "" }
}

// Recently selected players — shared by every search box, newest first.
const RECENTS_KEY = "recent-players-v1"
const RECENTS_MAX = 6

interface RecentPlayer extends SelectedPlayer {
    iconPath?: string
}

function readRecents(): RecentPlayer[] {
    try {
        const list = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]")
        return Array.isArray(list) ? list.filter(p => p && p.membershipId) : []
    } catch {
        return []
    }
}

function pushRecent(p: RecentPlayer) {
    try {
        const list = [p, ...readRecents().filter(r => r.membershipId !== p.membershipId)]
        localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, RECENTS_MAX)))
    } catch {
        /* storage unavailable */
    }
}

/** Split "Name#1234" back into name + code for display. */
function splitDisplayName(displayName: string) {
    const i = displayName.lastIndexOf("#")
    if (i <= 0) return { name: displayName, code: "" }
    return { name: displayName.slice(0, i), code: displayName.slice(i) }
}

export function PlayerSearch({ onSelect, placeholder }: Props) {
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<UserInfoCard[]>([])
    const [recents, setRecents] = useState<RecentPlayer[]>([])
    const [open, setOpen] = useState(false)
    const boxRef = useRef<HTMLDivElement>(null)

    // Debounced search.
    useEffect(() => {
        const q = query.trim()
        if (q.length < 2) {
            setResults([])
            return
        }
        const handle = setTimeout(async () => {
            try {
                setResults(await searchPlayers(q))
                setOpen(true)
            } catch {
                setResults([])
            }
        }, 300)
        return () => clearTimeout(handle)
    }, [query])

    // Close on outside click.
    useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener("mousedown", onClick)
        return () => document.removeEventListener("mousedown", onClick)
    }, [])

    function select(player: RecentPlayer) {
        pushRecent(player)
        onSelect(player)
        setQuery(player.displayName)
        setOpen(false)
    }

    function choose(card: UserInfoCard) {
        const { name, code } = bungieName(card)
        select({
            membershipId: card.membershipId,
            membershipType: card.membershipType,
            displayName: `${name}${code}`,
            iconPath: card.iconPath,
        })
    }

    const showRecents = query.trim().length < 2 && recents.length > 0

    return (
        <div className="search" ref={boxRef}>
            <input
                value={query}
                placeholder={placeholder ?? "Search Bungie name (e.g. Guardian#1234)"}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => {
                    const stored = readRecents()
                    setRecents(stored)
                    if (results.length || stored.length) setOpen(true)
                }}
            />
            {open && (results.length > 0 || showRecents) && (
                <div className="search-results">
                    {showRecents ? (
                        <>
                            <div className="search-results-label">Recent</div>
                            {recents.map(p => {
                                const { name, code } = splitDisplayName(p.displayName)
                                const icon = bungieAsset(p.iconPath)
                                return (
                                    <button key={p.membershipId} onClick={() => select(p)}>
                                        {icon && <img src={icon} alt="" />}
                                        <span>{name}</span>
                                        <span className="code">{code}</span>
                                    </button>
                                )
                            })}
                        </>
                    ) : (
                        results.map(card => {
                            const { name, code } = bungieName(card)
                            const icon = bungieAsset(card.iconPath)
                            return (
                                <button key={card.membershipId} onClick={() => choose(card)}>
                                    {icon && <img src={icon} alt="" />}
                                    <span>{name}</span>
                                    <span className="code">{code}</span>
                                </button>
                            )
                        })
                    )}
                </div>
            )}
        </div>
    )
}
