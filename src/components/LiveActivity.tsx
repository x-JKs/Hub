import { useEffect, useRef, useState } from "react"
import { bungieAsset } from "../bungie/client"
import { resolveItems } from "../bungie/manifest"
import { getCharacterLoadout } from "../bungie/api"
import type { ManifestItemDef } from "../bungie/types"
import type { LiveActivityState, LiveMember } from "../hooks/useLiveActivity"
import type { SelectedPlayer } from "../hooks/useActivities"
import { AnimatedOverlay } from "../motion/components"

const BUCKET_LABELS: Record<number, string> = {
    3284755031: "Subclass",
    1498876634: "Kinetic",
    2465295065: "Energy",
    953998645: "Power",
    3448274439: "Helmet",
    3551918588: "Gauntlets",
    14239492: "Chest Armor",
    20886954: "Leg Armor",
    1585787867: "Class Item",
    4023194814: "Ghost",
}

const BUCKET_ORDER = [
    3284755031, 1498876634, 2465295065, 953998645,
    3448274439, 3551918588, 14239492, 20886954, 1585787867,
    4023194814,
]

const SLOT_COLORS: Record<string, string> = {
    Subclass: "#4fc3f7",
    Kinetic: "#aaa",
    Energy: "#4ade80",
    Power: "#b48cff",
    Helmet: "#888",
    Gauntlets: "#888",
    "Chest Armor": "#888",
    "Leg Armor": "#888",
    "Class Item": "#888",
    Ghost: "#b0b0b0",
}

const EMPTY_SOCKET = /empty.*(socket|slot)|deprecated|disabled/i

function isEmptyPlaceholder(d: ManifestItemDef): boolean {
    if (EMPTY_SOCKET.test(d.name)) return true
    if (EMPTY_SOCKET.test(d.itemTypeDisplayName)) return true
    if (!d.name || d.name === "Unknown Weapon") return true
    return false
}

function formatElapsed(ms: number): string {
    const totalSec = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    const pad = (n: number) => String(n).padStart(2, "0")
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function ElapsedTimer({ since }: { since: string }) {
    const [elapsed, setElapsed] = useState(() => Date.now() - new Date(since).getTime())
    const ref = useRef<ReturnType<typeof setInterval>>()

    useEffect(() => {
        const start = new Date(since).getTime()
        setElapsed(Date.now() - start)
        ref.current = setInterval(() => setElapsed(Date.now() - start), 1000)
        return () => clearInterval(ref.current)
    }, [since])

    return <span className="live-timer">{formatElapsed(elapsed)}</span>
}

interface Props {
    state: LiveActivityState
    player: SelectedPlayer | null
}

export function LiveActivity({ state, player }: Props) {
    const [inspectCharId, setInspectCharId] = useState<string | null>(null)
    const [inspecting, setInspecting] = useState<LiveMember | null>(null)

    if (state.loading && !state.character) {
        return (
            <div className="live-section">
                <div className="live-loading">
                    <div className="spinner" /> Loading live activity&hellip;
                </div>
            </div>
        )
    }

    if (state.error && !state.character) return null
    if (!state.character) return null

    const c = state.character

    return (
        <div className="live-section">
            <div className="pgcr-section-label">Current Activity</div>

            <button className="live-card" onClick={() => setInspectCharId(c.characterId)}>
                <div className="live-banner">
                    {state.emblemBgUrl && (
                        <img className="live-banner-img" src={state.emblemBgUrl} alt="" />
                    )}
                    <div className="live-banner-overlay">
                        <div className="live-info">
                            <div className="live-class">
                                {c.className} <span className="live-light">{c.light}</span>
                            </div>
                            <div className={`live-status ${state.isOnline ? "online" : "offline"}`}>
                                <span className="status-dot" />
                                {state.isOnline
                                    ? state.activityName ?? "In Orbit"
                                    : "Offline"}
                                {state.activityStarted && state.isOnline && (
                                    <ElapsedTimer since={state.activityStarted} />
                                )}
                            </div>
                        </div>
                        <span className="live-inspect-hint">Click to inspect loadout</span>
                    </div>
                </div>
            </button>

            {state.allCharacters.length > 1 && (
                <div className="live-chars">
                    {state.allCharacters.map(ch => (
                        <button
                            key={ch.characterId}
                            className={`live-char-chip ${ch.characterId === c.characterId ? "active" : ""}`}
                            onClick={() => setInspectCharId(ch.characterId)}
                            title={`Inspect ${ch.className} loadout`}
                        >
                            <img src={bungieAsset(ch.emblemPath) ?? ""} alt="" className="live-char-emblem" />
                            <span>{ch.className}</span>
                            <span className="live-char-light">{ch.light}</span>
                        </button>
                    ))}
                </div>
            )}

            {state.fireteam.length > 0 && (
                <>
                    <div className="pgcr-section-label" style={{ marginTop: 12 }}>Fireteam</div>
                    <div className="live-fireteam">
                        {state.fireteam.map(m => (
                            <button
                                key={m.membershipId}
                                className="live-ft-member"
                                onClick={() => setInspecting(m)}
                            >
                                {m.emblemUrl && (
                                    <img className="live-ft-emblem" src={m.emblemUrl} alt="" />
                                )}
                                <div className="live-ft-info">
                                    <div className="live-ft-name">
                                        {m.displayName}
                                        <span className="live-ft-light">{m.className}{m.light > 0 && ` · ${m.light}`}</span>
                                    </div>
                                    {m.currentActivityName && (
                                        <div className="live-ft-activity">{m.currentActivityName}</div>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </>
            )}

            {inspectCharId && player && (() => {
                const ch = state.allCharacters.find(x => x.characterId === inspectCharId) ?? c
                return (
                    <CharacterLoadoutOverlay
                        membershipType={player.membershipType}
                        membershipId={player.membershipId}
                        characterId={inspectCharId}
                        displayName={player.displayName}
                        className={ch.className}
                        light={ch.light}
                        onClose={() => setInspectCharId(null)}
                    />
                )
            })()}

            {inspecting && (
                <CharacterLoadoutOverlay
                    membershipType={inspecting.membershipType}
                    membershipId={inspecting.membershipId}
                    displayName={inspecting.displayName}
                    className={inspecting.className}
                    light={inspecting.light}
                    onClose={() => setInspecting(null)}
                />
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Loadout overlay — fetches equipment + sockets on mount
// ---------------------------------------------------------------------------

function CharacterLoadoutOverlay({
    membershipType,
    membershipId,
    characterId,
    displayName,
    className,
    light,
    onClose,
}: {
    membershipType: number
    membershipId: string
    characterId?: string
    displayName: string
    className: string
    light: number
    onClose: () => void
}) {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [slots, setSlots] = useState<LoadoutSlot[]>([])

    async function load() {
        setLoading(true)
        setError(null)
        try {
            const loadout = await getCharacterLoadout(membershipType, membershipId, characterId)

            // Collect all hashes to resolve: item hashes + socket plug hashes
            const allHashes: number[] = []
            for (const item of loadout.items) {
                allHashes.push(item.itemHash)
                allHashes.push(...item.sockets)
            }
            const defs = await resolveItems(allHashes)

            // Group by bucket in display order
            const result: LoadoutSlot[] = []
            for (const bucket of BUCKET_ORDER) {
                const item = loadout.items.find(i => i.bucketHash === bucket)
                if (!item) continue
                const def = defs.get(item.itemHash)
                if (!def) continue

                const mods = item.sockets
                    .map(h => defs.get(h))
                    .filter((d): d is ManifestItemDef =>
                        d != null &&
                        d.hash !== item.itemHash &&
                        !isEmptyPlaceholder(d)
                    )

                result.push({
                    bucket,
                    label: BUCKET_LABELS[bucket] ?? "Unknown",
                    item: def,
                    mods,
                })
            }
            setSlots(result)
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        }
        setLoading(false)
    }

    useEffect(() => { load() }, [membershipId, characterId])

    return (
        <AnimatedOverlay onClose={onClose}>
            <div className="pgcr-overlay-inner" onClick={e => e.stopPropagation()}>
                <div className="pgcr-panel">
                    <div className="pgcr-topbar">
                        <button className="pgcr-close" onClick={onClose}>&times;</button>
                    </div>

                    <div className="live-loadout-header">
                        <div>
                            <div className="live-loadout-name">{displayName}</div>
                            <div className="live-loadout-class">
                                {className}{light > 0 && ` · ${light}`}
                            </div>
                        </div>
                        <button
                            className="live-refresh-btn"
                            onClick={e => { e.stopPropagation(); load() }}
                            disabled={loading}
                            title="Refresh loadout"
                        >
                            {loading ? "…" : "↻"}
                        </button>
                    </div>

                    {loading && slots.length === 0 ? (
                        <div className="pgcr-loading">
                            <div className="spinner" /> Loading loadout&hellip;
                        </div>
                    ) : error ? (
                        <div className="pgcr-loading pgcr-error-msg">{error}</div>
                    ) : (
                        <div className="loadout-list">
                            {slots.map(slot =>
                                slot.bucket === 3284755031
                                    ? <SubclassBlock key={slot.bucket} slot={slot} />
                                    : <EquipmentRow key={slot.bucket} slot={slot} />
                            )}
                        </div>
                    )}
                </div>
            </div>
        </AnimatedOverlay>
    )
}

interface LoadoutSlot {
    bucket: number
    label: string
    item: ManifestItemDef
    mods: ManifestItemDef[]
}

// ---------------------------------------------------------------------------
// Standard equipment row (weapons, armor, ghost)
// ---------------------------------------------------------------------------

function EquipmentRow({ slot }: { slot: LoadoutSlot }) {
    return (
        <div className="loadout-item">
            <div className="loadout-item-main">
                <div className="pgcr-weapon-icon">
                    {slot.item.icon
                        ? <img src={slot.item.icon} alt="" />
                        : <div className="pgcr-weapon-placeholder" />}
                </div>
                <div className="loadout-item-info">
                    <div className="loadout-item-top">
                        <span className="pgcr-weapon-name">{slot.item.name}</span>
                        <span
                            className="pgcr-weapon-slot"
                            style={{
                                color: SLOT_COLORS[slot.label] ?? "#888",
                                borderColor: SLOT_COLORS[slot.label] ?? "#555",
                            }}
                        >
                            {slot.label}
                        </span>
                    </div>
                    <div className="pgcr-weapon-sub">{slot.item.itemTypeDisplayName}</div>
                </div>
            </div>
            {slot.mods.length > 0 && (
                <div className="loadout-mods">
                    {slot.mods.map((mod, i) => (
                        <div key={i} className="loadout-mod" title={mod.name}>
                            {mod.icon
                                ? <img src={mod.icon} alt="" />
                                : <span className="loadout-mod-text">{mod.name.slice(0, 2)}</span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Subclass block — groups sockets into abilities, aspects, fragments
// ---------------------------------------------------------------------------

const ABILITY_TYPES = /super|grenade|melee|class ability|movement/i
const ASPECT_TYPES = /aspect/i
const FRAGMENT_TYPES = /fragment/i

function SubclassBlock({ slot }: { slot: LoadoutSlot }) {
    const abilities: ManifestItemDef[] = []
    const aspects: ManifestItemDef[] = []
    const fragments: ManifestItemDef[] = []
    const other: ManifestItemDef[] = []

    for (const mod of slot.mods) {
        const t = mod.itemTypeDisplayName
        if (ASPECT_TYPES.test(t)) aspects.push(mod)
        else if (FRAGMENT_TYPES.test(t)) fragments.push(mod)
        else if (ABILITY_TYPES.test(t)) abilities.push(mod)
        else other.push(mod)
    }

    return (
        <div className="loadout-subclass">
            <div className="loadout-item-main">
                <div className="pgcr-weapon-icon">
                    {slot.item.icon
                        ? <img src={slot.item.icon} alt="" />
                        : <div className="pgcr-weapon-placeholder" />}
                </div>
                <div className="loadout-item-info">
                    <div className="loadout-item-top">
                        <span className="pgcr-weapon-name">{slot.item.name}</span>
                        <span
                            className="pgcr-weapon-slot"
                            style={{ color: "#4fc3f7", borderColor: "#4fc3f7" }}
                        >
                            Subclass
                        </span>
                    </div>
                    <div className="pgcr-weapon-sub">{slot.item.itemTypeDisplayName}</div>
                </div>
            </div>

            {abilities.length > 0 && (
                <div className="subclass-group">
                    <div className="subclass-group-label">Abilities</div>
                    <div className="subclass-group-items">
                        {abilities.map((m, i) => (
                            <div key={i} className="subclass-plug" title={m.name}>
                                {m.icon && <img src={m.icon} alt="" />}
                                <span>{m.name}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {aspects.length > 0 && (
                <div className="subclass-group">
                    <div className="subclass-group-label">Aspects</div>
                    <div className="subclass-group-items">
                        {aspects.map((m, i) => (
                            <div key={i} className="subclass-plug" title={m.name}>
                                {m.icon && <img src={m.icon} alt="" />}
                                <span>{m.name}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {fragments.length > 0 && (
                <div className="subclass-group">
                    <div className="subclass-group-label">Fragments</div>
                    <div className="subclass-group-items">
                        {fragments.map((m, i) => (
                            <div key={i} className="subclass-plug" title={m.name}>
                                {m.icon && <img src={m.icon} alt="" />}
                                <span>{m.name}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {other.length > 0 && (
                <div className="loadout-mods" style={{ marginTop: 6, marginLeft: 0 }}>
                    {other.map((m, i) => (
                        <div key={i} className="loadout-mod" title={m.name}>
                            {m.icon ? <img src={m.icon} alt="" /> : <span className="loadout-mod-text">{m.name.slice(0, 2)}</span>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
