import { useEffect, useRef, useState } from "react"
import { searchPlayers } from "../bungie/api"
import { bungieAsset } from "../bungie/client"
import { UserInfoCard } from "../bungie/types"
import { SelectedPlayer } from "../hooks/useActivities"

interface Props {
    onSelect: (player: SelectedPlayer) => void
}

function bungieName(card: UserInfoCard) {
    if (card.bungieGlobalDisplayName) {
        const code = card.bungieGlobalDisplayNameCode?.toString().padStart(4, "0")
        return { name: card.bungieGlobalDisplayName, code: code ? `#${code}` : "" }
    }
    return { name: card.displayName, code: "" }
}

export function PlayerSearch({ onSelect }: Props) {
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<UserInfoCard[]>([])
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

    function choose(card: UserInfoCard) {
        const { name, code } = bungieName(card)
        onSelect({
            membershipId: card.membershipId,
            membershipType: card.membershipType,
            displayName: `${name}${code}`
        })
        setQuery(`${name}${code}`)
        setOpen(false)
    }

    return (
        <div className="search" ref={boxRef}>
            <input
                value={query}
                placeholder="Search Bungie name (e.g. Guardian#1234)"
                onChange={e => setQuery(e.target.value)}
                onFocus={() => results.length && setOpen(true)}
            />
            {open && results.length > 0 && (
                <div className="search-results">
                    {results.map(card => {
                        const { name, code } = bungieName(card)
                        const icon = bungieAsset(card.iconPath)
                        return (
                            <button key={card.membershipId} onClick={() => choose(card)}>
                                {icon && <img src={icon} alt="" />}
                                <span>{name}</span>
                                <span className="code">{code}</span>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
