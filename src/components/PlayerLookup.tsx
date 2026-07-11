import { useMemo, useState } from "react"
import { getAggregateActivityStats, getCharacters, getLiveProfile } from "../bungie/api"
import type { LiveCharacter } from "../bungie/api"
import type { AggregateHashStat } from "../bungie/types"
import type { SelectedPlayer } from "../hooks/useActivities"
import { classify } from "../stats/activityBreakdown"
import { formatAvgDuration } from "../stats/format"
import { PlayerSearch } from "./PlayerSearch"
import { CharacterLoadoutOverlay } from "./LiveActivity"

interface Target {
    membershipType: number
    membershipId: string
    characterId: string
    displayName: string
    className: string
    light: number
    characters: LiveCharacter[]
}

interface CompareTarget {
    displayName: string
    aggregate: AggregateHashStat[]
}

interface CompareRow {
    key: string
    name: string
    category: "raid" | "dungeon"
    you: { clears: number; fastest: number | null }
    them: { clears: number; fastest: number | null }
}

/** Group an aggregate into per-activity clears + best time, raids & dungeons. */
function summarizeAggregate(aggregate: AggregateHashStat[]) {
    const map = new Map<string, { name: string; category: "raid" | "dungeon"; clears: number; fastest: number | null }>()
    for (const stat of aggregate) {
        for (const category of ["raid", "dungeon"] as const) {
            const c = classify(stat.hash, category)
            if (!c) continue
            const cur = map.get(c.groupKey) ?? { name: c.name, category, clears: 0, fastest: null }
            cur.clears += stat.clears
            if (stat.fastestSeconds !== null) {
                cur.fastest = cur.fastest === null ? stat.fastestSeconds : Math.min(cur.fastest, stat.fastestSeconds)
            }
            map.set(c.groupKey, cur)
            break
        }
    }
    return map
}

function CompareTable({
    youName,
    themName,
    youAggregate,
    them,
}: {
    youName: string
    themName: string
    youAggregate: AggregateHashStat[]
    them: CompareTarget
}) {
    const rows = useMemo<CompareRow[]>(() => {
        const you = summarizeAggregate(youAggregate)
        const other = summarizeAggregate(them.aggregate)
        const keys = new Set([...you.keys(), ...other.keys()])
        const out: CompareRow[] = []
        for (const key of keys) {
            const a = you.get(key)
            const b = other.get(key)
            out.push({
                key,
                name: (a ?? b)!.name,
                category: (a ?? b)!.category,
                you: { clears: a?.clears ?? 0, fastest: a?.fastest ?? null },
                them: { clears: b?.clears ?? 0, fastest: b?.fastest ?? null },
            })
        }
        // Most-contested first: activities either player has actually run.
        out.sort((x, y) => y.you.clears + y.them.clears - (x.you.clears + x.them.clears))
        return out.filter(r => r.you.clears > 0 || r.them.clears > 0)
    }, [youAggregate, them])

    const totals = useMemo(
        () => ({
            you: rows.reduce((s, r) => s + r.you.clears, 0),
            them: rows.reduce((s, r) => s + r.them.clears, 0),
        }),
        [rows]
    )

    if (rows.length === 0) {
        return <div className="lookup-status">No raid or dungeon history to compare.</div>
    }

    const fmtFast = (s: number | null) => (s !== null ? formatAvgDuration(s) : "—")

    return (
        <div className="compare-table">
            <div className="compare-row compare-head">
                <span>Activity</span>
                <span title={youName}>You</span>
                <span title={themName}>{themName}</span>
            </div>
            <div className="compare-row compare-totals">
                <span>Total clears</span>
                <span className={totals.you >= totals.them ? "win" : ""}>{totals.you.toLocaleString()}</span>
                <span className={totals.them >= totals.you ? "win" : ""}>{totals.them.toLocaleString()}</span>
            </div>
            {rows.map(r => (
                <div className="compare-row" key={r.key}>
                    <span className="compare-name">{r.name}</span>
                    <span className={r.you.clears >= r.them.clears && r.you.clears > 0 ? "win" : ""}>
                        {r.you.clears.toLocaleString()}
                        <small title="Best time from Bungie's aggregate stats (may include checkpoint runs)">
                            {fmtFast(r.you.fastest)}
                        </small>
                    </span>
                    <span className={r.them.clears >= r.you.clears && r.them.clears > 0 ? "win" : ""}>
                        {r.them.clears.toLocaleString()}
                        <small title="Best time from Bungie's aggregate stats (may include checkpoint runs)">
                            {fmtFast(r.them.fastest)}
                        </small>
                    </span>
                </div>
            ))}
        </div>
    )
}

/**
 * Look up any Guardian without changing the tracked player: inspect their
 * current loadout, or compare lifetime raid/dungeon stats side by side.
 */
export function PlayerLookup({
    currentPlayer,
    currentAggregate,
}: {
    currentPlayer: SelectedPlayer | null
    currentAggregate: AggregateHashStat[]
}) {
    const [mode, setMode] = useState<"loadout" | "compare">("loadout")
    const [target, setTarget] = useState<Target | null>(null)
    const [compare, setCompare] = useState<CompareTarget | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function handleSelect(p: SelectedPlayer) {
        setLoading(true)
        setError(null)
        setTarget(null)
        setCompare(null)
        try {
            if (mode === "loadout") {
                const profile = await getLiveProfile(p.membershipType, p.membershipId)
                const char = profile.characters[0]
                if (!char) {
                    setError("No characters found for this Guardian (private profile?).")
                    return
                }
                setTarget({
                    membershipType: p.membershipType,
                    membershipId: p.membershipId,
                    characterId: char.characterId,
                    displayName: profile.displayName || p.displayName,
                    className: char.className,
                    light: char.light,
                    characters: profile.characters,
                })
            } else {
                const chars = await getCharacters(p.membershipType, p.membershipId)
                const aggregate = await getAggregateActivityStats(
                    p.membershipType,
                    p.membershipId,
                    chars.all
                )
                setCompare({ displayName: p.displayName, aggregate })
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }

    const canCompare = currentPlayer !== null && currentAggregate.length > 0

    return (
        <div className="lookup-section">
            <div className="lookup-head">
                <div className="pgcr-section-label">Player Lookup</div>
                <div className="toggle">
                    <button
                        className={mode === "loadout" ? "active" : ""}
                        onClick={() => setMode("loadout")}
                    >
                        Loadout
                    </button>
                    <button
                        className={mode === "compare" ? "active" : ""}
                        onClick={() => setMode("compare")}
                        disabled={!canCompare}
                        title={canCompare ? undefined : "Load a tracked player first"}
                    >
                        Compare
                    </button>
                </div>
            </div>
            <p className="lookup-hint">
                {mode === "loadout"
                    ? "See what any Guardian is currently running — enter a name to inspect their loadout."
                    : "Put any Guardian's lifetime raid & dungeon clears next to yours."}
            </p>
            <div className="lookup-search">
                <PlayerSearch
                    onSelect={handleSelect}
                    placeholder={
                        mode === "loadout"
                            ? "Look up a Guardian's loadout…"
                            : "Compare against a Guardian…"
                    }
                />
            </div>
            {loading && (
                <div className="lookup-status">
                    <div className="spinner" /> {mode === "loadout" ? "Loading loadout" : "Loading stats"}&hellip;
                </div>
            )}
            {error && <div className="lookup-status lookup-error">{error}</div>}

            {mode === "compare" && compare && currentPlayer && (
                <CompareTable
                    youName={currentPlayer.displayName}
                    themName={compare.displayName}
                    youAggregate={currentAggregate}
                    them={compare}
                />
            )}

            {target && (
                <CharacterLoadoutOverlay
                    membershipType={target.membershipType}
                    membershipId={target.membershipId}
                    characterId={target.characterId}
                    characters={target.characters}
                    displayName={target.displayName}
                    className={target.className}
                    light={target.light}
                    onClose={() => setTarget(null)}
                />
            )}
        </div>
    )
}
