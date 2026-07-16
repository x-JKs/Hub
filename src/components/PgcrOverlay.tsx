import { useCallback, useEffect, useRef, useState } from "react"
import { getFullPgcr } from "../bungie/api"
import { resolveActivityInfo, resolveClassIcons, getCachedClassIcon, resolveItems } from "../bungie/manifest"
import { raidByHash, raidSplashUrl } from "../manifest/raids"
import type { ManifestItemDef, PgcrEntry, PgcrResponse } from "../bungie/types"
import type { ActivityRun } from "../stats/compute"
import { formatAvgDuration } from "../stats/format"
import { dungeonByHash } from "../manifest/dungeons"
import { AnimatedOverlay } from "../motion/components"
import { parallaxHandlers } from "../motion/hooks"
import { findSnapshot, type LoadoutSnapshot } from "../lib/loadoutSnapshots"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClearsView {
    type: "clears"
    groupKey: string
    activityName: string
    splashUrl: string | null
}

interface PgcrView {
    type: "pgcr"
    instanceId: string
    fromActivity: string
}

interface PlayerView {
    type: "player"
    pgcr: PgcrResponse
    entryIndex: number
    items: Map<number, ManifestItemDef>
    classIcons: Record<string, string>
    activityName: string
}

type View = ClearsView | PgcrView | PlayerView

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const val = (entry: PgcrEntry, key: string) => entry.values[key]?.basic.value ?? 0
const dval = (entry: PgcrEntry, key: string) => entry.values[key]?.basic.displayValue ?? "0"

function playerName(entry: PgcrEntry): string {
    const p = entry.player.destinyUserInfo
    if (p.bungieGlobalDisplayName && p.bungieGlobalDisplayNameCode) {
        return `${p.bungieGlobalDisplayName}#${String(p.bungieGlobalDisplayNameCode).padStart(4, "0")}`
    }
    return p.displayName
}

function shortName(entry: PgcrEntry): string {
    const p = entry.player.destinyUserInfo
    return p.bungieGlobalDisplayName || p.displayName
}

const CLASS_COLORS: Record<string, string> = {
    Hunter: "#c44040",
    Titan: "#5577cc",
    Warlock: "#8855bb",
}

function classColor(cls: string) { return CLASS_COLORS[cls] ?? "#555" }

const SLOT_TAG_COLOR: Record<string, string> = {
    Kinetic: "#aaa",
    Energy: "#4ade80",
    Power: "#b48cff",
}

function slotTagColor(slot: string) { return SLOT_TAG_COLOR[slot] ?? "#888" }

const PLATFORM_SLUG: Record<number, string> = { 1: "xb", 2: "ps", 3: "pc", 5: "stadia", 6: "epic" }
const DTR_SLUG: Record<number, string> = { 1: "xbl", 2: "psn", 3: "steam", 5: "stadia", 6: "epic" }

interface ReportSite {
    name: string
    icon: string
    url: (membershipType: number, membershipId: string) => string
}

const REPORT_SITES: ReportSite[] = [
    { name: "Raid Report", icon: "https://raid.report/favicon.ico", url: (t, id) => `https://raid.report/${PLATFORM_SLUG[t] ?? "pc"}/${id}` },
    { name: "Dungeon Report", icon: "https://dungeon.report/favicon.ico", url: (t, id) => `https://dungeon.report/${PLATFORM_SLUG[t] ?? "pc"}/${id}` },
    { name: "GM Report", icon: "https://grandmaster.report/favicon.ico", url: (t, id) => `https://grandmaster.report/${PLATFORM_SLUG[t] ?? "pc"}/${id}` },
    { name: "Trials Report", icon: "https://trials.report/favicon.ico", url: (t, id) => `https://trials.report/report/${t}/${id}` },
    { name: "Crucible Report", icon: "https://crucible.report/favicon.ico", url: (t, id) => `https://crucible.report/report/${t}/${id}` },
    { name: "Guardian Report", icon: "https://guardian.report/favicon.ico", url: (t, id) => `https://guardian.report/${PLATFORM_SLUG[t] ?? "pc"}/${id}` },
    { name: "Destiny Tracker", icon: "https://destinytracker.com/favicon.ico", url: (t, id) => `https://destinytracker.com/destiny-2/profile/${DTR_SLUG[t] ?? "steam"}/${id}/overview` },
    { name: "Braytech", icon: "https://bray.tech/favicon.ico", url: (t, id) => `https://bray.tech/${t}/${id}` },
]

// ---------------------------------------------------------------------------
// Emblem + class icon component
// ---------------------------------------------------------------------------

function PlayerEmblem({
    entry,
    items,
    classIcons,
    size = 36,
}: {
    entry: PgcrEntry
    items: Map<number, ManifestItemDef>
    classIcons: Record<string, string>
    size?: number
}) {
    const emblemDef = items.get(entry.player.emblemHash)
    const classIcon = classIcons[entry.player.characterClass] ?? getCachedClassIcon(entry.player.characterClass)
    const color = classColor(entry.player.characterClass)

    return (
        <div className="pgcr-emblem-wrap" style={{ width: size, height: size }}>
            {emblemDef?.icon ? (
                <img
                    className="pgcr-emblem-img"
                    src={emblemDef.icon}
                    alt=""
                    style={{ width: size, height: size }}
                />
            ) : (
                <div
                    className="pgcr-emblem-fallback"
                    style={{ width: size, height: size, background: color }}
                >
                    {entry.player.characterClass?.[0] ?? "?"}
                </div>
            )}
            {classIcon && (
                <img
                    className="pgcr-class-badge"
                    src={classIcon}
                    alt={entry.player.characterClass}
                    title={entry.player.characterClass}
                />
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------

function ClearsList({
    runs,
    activityName,
    splashUrl,
    onSelect,
    onClose,
}: {
    runs: ActivityRun[]
    activityName: string
    splashUrl: string | null
    onSelect: (instanceId: string) => void
    onClose: () => void
}) {
    const [limit, setLimit] = useState(10)
    const visible = runs.slice(0, limit)

    return (
        <div className="pgcr-panel">
            <div className="pgcr-topbar">
                <button className="pgcr-close" onClick={onClose} aria-label="Close">&times;</button>
            </div>
            <div className="pgcr-header">
                {splashUrl && <div className="pgcr-header-bg" style={{ backgroundImage: `url(${splashUrl})` }} />}
                <div className="pgcr-header-scrim" />
                <div className="pgcr-header-text">
                    <div className="pgcr-header-title">{activityName}</div>
                    <div className="pgcr-header-sub">{runs.length} recent clears &amp; attempts</div>
                </div>
            </div>
            <div className="pgcr-clears-list">
                <div className="pgcr-clears-head">
                    <span>Date</span>
                    <span>Duration</span>
                    <span>Players</span>
                    <span>K / D</span>
                    <span>Status</span>
                </div>
                {visible.map(r => (
                    <button
                        key={r.instanceId}
                        className={`pgcr-clear-row ${r.completed ? "clear" : "dnf"}`}
                        {...parallaxHandlers()}
                        onClick={() => onSelect(r.instanceId)}
                    >
                        <span className="cl-date">
                            {r.date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                            <small>{r.date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</small>
                        </span>
                        <span className="cl-dur">{formatAvgDuration(r.durationSeconds)}</span>
                        <span className="cl-pc">{r.playerCount || "—"}</span>
                        <span className="cl-kd">
                            {r.kills} / {r.deaths}
                        </span>
                        <span className={`cl-status ${r.completed ? "ok" : "bad"}`}>
                            {r.completed ? "Clear" : "DNF"}
                        </span>
                    </button>
                ))}
            </div>
            {limit < runs.length && (
                <button className="pgcr-load-more" onClick={() => setLimit(l => l + 10)}>
                    Load More ({runs.length - limit} remaining)
                </button>
            )}
        </div>
    )
}

// "What was I running?" — the loadout snapshot captured when this activity
// started (if the app was open at the time). Icons resolve via the manifest.
function LoadoutSnapshotStrip({ period }: { period: string }) {
    const [snap, setSnap] = useState<LoadoutSnapshot | null>(null)
    const [defs, setDefs] = useState<Map<number, ManifestItemDef>>(new Map())

    useEffect(() => {
        const s = findSnapshot(period)
        setSnap(s)
        setDefs(new Map())
        if (!s) return
        let cancelled = false
        resolveItems(s.itemHashes).then(map => { if (!cancelled) setDefs(map) })
        return () => { cancelled = true }
    }, [period])

    if (!snap || defs.size === 0) return null
    const resolved = snap.itemHashes
        .map(h => defs.get(h))
        .filter((d): d is ManifestItemDef => !!d && !!d.icon)
    if (resolved.length === 0) return null

    return (
        <div className="pgcr-snapshot-section">
            <div className="pgcr-section-label">
                Your {snap.characterClass} loadout at start
            </div>
            <div className="pgcr-snapshot">
                {resolved.map((d, i) => (
                    <div key={i} className="pgcr-snapshot-icon" title={d.name}>
                        <img src={d.icon!} alt={d.name} />
                    </div>
                ))}
            </div>
        </div>
    )
}

function PgcrDetail({
    pgcr,
    items,
    classIcons,
    activityName,
    activityImage,
    onBack,
    onClose,
    onPlayerClick,
}: {
    pgcr: PgcrResponse
    items: Map<number, ManifestItemDef>
    classIcons: Record<string, string>
    activityName: string
    activityImage: string | null
    onBack: () => void
    onClose: () => void
    onPlayerClick: (index: number) => void
}) {
    const entries = pgcr.entries.sort((a, b) => val(b, "kills") - val(a, "kills"))
    const date = new Date(pgcr.period)
    const durationSeconds = entries.length ? val(entries[0], "activityDurationSeconds") : 0
    const totalKills = entries.reduce((s, e) => s + val(e, "kills"), 0)
    const totalDeaths = entries.reduce((s, e) => s + val(e, "deaths"), 0)
    const totalAssists = entries.reduce((s, e) => s + val(e, "assists"), 0)
    const totalSupers = entries.reduce((s, e) => s + val(e, "weaponKillsSuper"), 0)
    const teamKd = totalDeaths > 0 ? (totalKills / totalDeaths).toFixed(2) : totalKills.toFixed(2)

    // Per-clear badges (lowman / flawless) + fresh-vs-checkpoint, from THIS PGCR.
    const distinctPlayers = new Set(entries.map(e => e.player.destinyUserInfo.membershipId)).size
    const cleared = entries.some(e => val(e, "completed") === 1)
    const fresh = pgcr.activityWasStartedFromBeginning // boolean | undefined
    const isDungeon = !!dungeonByHash(pgcr.activityDetails.referenceId)
    // Flawless = whole-team 0 deaths on a fresh full clear. Lowman = below a full
    // team (dungeons: only Solo counts, matching the card).
    const isFlawless = cleared && totalDeaths === 0 && fresh === true
    const lowmanTag =
        !cleared ? null
        : distinctPlayers === 1 ? "Solo"
        : isDungeon ? null
        : distinctPlayers === 2 ? "Duo"
        : distinctPlayers === 3 ? "Trio"
        : null
    const runBadges: string[] = []
    if (isFlawless) runBadges.push(lowmanTag ? `${lowmanTag} Flawless` : "Flawless")
    else if (lowmanTag) runBadges.push(lowmanTag)

    const mvp = entries[0]
    const mostAssists = [...entries].sort((a, b) => val(b, "assists") - val(a, "assists"))[0]
    const bestKd = [...entries].sort((a, b) => val(b, "killsDeathsRatio") - val(a, "killsDeathsRatio"))[0]
    const mostDeaths = [...entries].sort((a, b) => val(b, "deaths") - val(a, "deaths"))[0]

    const weaponTotals = new Map<number, { kills: number; precision: number }>()
    for (const e of entries) {
        for (const w of e.extended?.weapons ?? []) {
            const cur = weaponTotals.get(w.referenceId) ?? { kills: 0, precision: 0 }
            cur.kills += w.values.uniqueWeaponKills?.basic.value ?? 0
            cur.precision += w.values.uniqueWeaponPrecisionKills?.basic.value ?? 0
            weaponTotals.set(w.referenceId, cur)
        }
    }
    const weaponList = [...weaponTotals.entries()]
        .map(([hash, stats]) => ({ hash, ...stats, def: items.get(hash) }))
        .sort((a, b) => b.kills - a.kills)
        .slice(0, 8)

    return (
        <div className="pgcr-panel">
            <div className="pgcr-topbar">
                <button className="pgcr-back" onClick={onBack}>&larr; Back</button>
                <button className="pgcr-close" onClick={onClose} aria-label="Close">&times;</button>
            </div>
            <div className={`pgcr-detail-header${activityImage ? " has-art" : ""}`}>
                {activityImage && (
                    <>
                        <div className="pgcr-detail-bg" style={{ backgroundImage: `url(${activityImage})` }} />
                        <div className="pgcr-detail-scrim" />
                    </>
                )}
                <div className="pgcr-detail-headtext">
                    <div className="pgcr-detail-name">{activityName}</div>
                    <div className="pgcr-detail-date">
                        {date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}{" "}
                        {date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        {durationSeconds > 0 && (
                            <span className="pgcr-detail-dur"> &middot; {formatAvgDuration(durationSeconds)}</span>
                        )}
                    </div>
                    {(runBadges.length > 0 || fresh !== undefined) && (
                        <div className="pgcr-detail-badges">
                            {runBadges.map(b => (
                                <span key={b} className={`tag tag-${b.toLowerCase().replace(/\s+/g, "")}`}>{b}</span>
                            ))}
                            {fresh === true && <span className="tag tag-full">Full Clear</span>}
                            {fresh === false && <span className="tag tag-checkpoint">Checkpoint</span>}
                        </div>
                    )}
                </div>
            </div>

            <div className="pgcr-body">
                <div className="pgcr-col-left">
                    <div className="pgcr-section-label">Players</div>
                    {entries.map(e => {
                        const completed = val(e, "completed") === 1
                        return (
                            <button
                                key={e.characterId}
                                className="pgcr-player-row"
                                {...parallaxHandlers()}
                                onClick={() => onPlayerClick(pgcr.entries.indexOf(e))}
                            >
                                <PlayerEmblem entry={e} items={items} classIcons={classIcons} size={36} />
                                <div className="pgcr-player-info">
                                    <div className="pgcr-player-name">
                                        {shortName(e)}
                                        <span className="pgcr-player-code">
                                            #{String(e.player.destinyUserInfo.bungieGlobalDisplayNameCode ?? "").padStart(4, "0")}
                                        </span>
                                        {!completed && <span className="pgcr-dnf">DNF</span>}
                                    </div>
                                    <div className="pgcr-player-stats">
                                        {val(e, "kills")}K / {val(e, "deaths")}D / {val(e, "assists")}A
                                        &nbsp;&middot;&nbsp;K/D {dval(e, "killsDeathsRatio")}
                                    </div>
                                </div>
                            </button>
                        )
                    })}
                </div>

                <div className="pgcr-col-right">
                    <div className="pgcr-section-label">Combat Stats</div>
                    <div className="pgcr-stats-grid">
                        <div className="pgcr-stat-row"><span>Total Kills</span><span>{totalKills}</span></div>
                        <div className="pgcr-stat-row"><span>Total Assists</span><span>{totalAssists}</span></div>
                        <div className="pgcr-stat-row"><span>Total Deaths</span><span>{totalDeaths}</span></div>
                        <div className="pgcr-stat-row"><span>Team K/D</span><span>{teamKd}</span></div>
                        <div className="pgcr-stat-row"><span>Super Kills</span><span>{totalSupers}</span></div>
                    </div>

                    <div className="pgcr-section-label" style={{ marginTop: 20 }}>Activity Highlights</div>
                    <div className="pgcr-stats-grid highlights">
                        {mvp && <div className="pgcr-stat-row"><span>MVP</span><span>{shortName(mvp)}</span></div>}
                        {mvp && <div className="pgcr-stat-row"><span>Most Kills</span><span>{shortName(mvp)} &middot; {val(mvp, "kills")}</span></div>}
                        {mostAssists && <div className="pgcr-stat-row"><span>Most Assists</span><span>{shortName(mostAssists)} &middot; {val(mostAssists, "assists")}</span></div>}
                        {bestKd && <div className="pgcr-stat-row"><span>Best K/D</span><span>{shortName(bestKd)} &middot; {dval(bestKd, "killsDeathsRatio")}</span></div>}
                        {mostDeaths && <div className="pgcr-stat-row"><span>Most Deaths</span><span>{shortName(mostDeaths)} &middot; {val(mostDeaths, "deaths")}</span></div>}
                    </div>
                </div>
            </div>

            <LoadoutSnapshotStrip period={pgcr.period} />

            {weaponList.length > 0 && (
                <div className="pgcr-weapons-section">
                    <div className="pgcr-section-label">Weapons</div>
                    <div className="pgcr-weapon-list">
                        {weaponList.map(w => {
                            const pct = totalKills > 0 ? Math.round((w.kills / totalKills) * 100) : 0
                            const precPct = w.kills > 0 ? Math.round((w.precision / w.kills) * 100) : 0
                            return (
                                <div key={w.hash} className="pgcr-weapon" {...parallaxHandlers()}>
                                    <div className="pgcr-weapon-icon">
                                        {w.def?.icon
                                            ? <img src={w.def.icon} alt="" />
                                            : <div className="pgcr-weapon-placeholder" />}
                                    </div>
                                    <div className="pgcr-weapon-info">
                                        <div className="pgcr-weapon-top">
                                            <span className="pgcr-weapon-name">{w.def?.name ?? "Unknown"}</span>
                                            {w.def && w.def.equipmentSlot !== "Unknown" && (
                                                <span
                                                    className="pgcr-weapon-slot"
                                                    style={{ color: slotTagColor(w.def.equipmentSlot), borderColor: slotTagColor(w.def.equipmentSlot) }}
                                                >
                                                    {w.def.equipmentSlot}
                                                </span>
                                            )}
                                        </div>
                                        <div className="pgcr-weapon-sub">
                                            {w.kills} kills &middot; {pct}% of activity
                                        </div>
                                        <div className="pgcr-weapon-precision">
                                            Precision: {w.precision} ({precPct}%)
                                        </div>
                                        <div className="pgcr-weapon-bar">
                                            <div className="pgcr-weapon-bar-fill" style={{ width: `${pct}%` }} />
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}

function PlayerDetailView({
    entry,
    items,
    classIcons,
    onBack,
    onClose,
}: {
    entry: PgcrEntry
    items: Map<number, ManifestItemDef>
    classIcons: Record<string, string>
    onBack: () => void
    onClose: () => void
}) {
    const totalKills = val(entry, "kills")
    const weapons = (entry.extended?.weapons ?? [])
        .map(w => ({
            hash: w.referenceId,
            kills: w.values.uniqueWeaponKills?.basic.value ?? 0,
            precision: w.values.uniqueWeaponPrecisionKills?.basic.value ?? 0,
            def: items.get(w.referenceId),
        }))
        .sort((a, b) => b.kills - a.kills)

    const extVal = (key: string) => entry.extended?.values?.[key]?.basic.value ?? 0
    const info = entry.player.destinyUserInfo

    return (
        <div className="pgcr-panel">
            <div className="pgcr-topbar">
                <button className="pgcr-back" onClick={onBack}>&larr; Back</button>
                <button className="pgcr-close" onClick={onClose} aria-label="Close">&times;</button>
            </div>

            <div className="pgcr-player-header" style={{ borderLeftColor: val(entry, "completed") === 1 ? "#4ade80" : "#e05252" }} {...parallaxHandlers()}>
                <PlayerEmblem entry={entry} items={items} classIcons={classIcons} size={56} />
                <div>
                    <div className="pgcr-player-header-name">{playerName(entry)}</div>
                    <div className="pgcr-player-header-class">{entry.player.characterClass}</div>
                </div>
            </div>

            <div className="pgcr-report-links" style={{ marginTop: 8 }}>
                {REPORT_SITES.map(site => (
                    <button
                        key={site.name}
                        className="pgcr-report-btn"
                        title={site.name}
                        onClick={() => window.open(site.url(info.membershipType, info.membershipId), "_blank")}
                    >
                        <img src={site.icon} alt="" className="pgcr-report-icon" onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
                    </button>
                ))}
            </div>

            <div className="pgcr-section-label">Performance</div>
            <div className="pgcr-perf-grid">
                <div className="pgcr-perf-cell" {...parallaxHandlers()}>
                    <div className="pgcr-perf-val">{formatAvgDuration(val(entry, "timePlayedSeconds"))}</div>
                    <div className="pgcr-perf-label">Time Played</div>
                </div>
                <div className="pgcr-perf-cell" {...parallaxHandlers()}>
                    <div className="pgcr-perf-val">{val(entry, "kills")}</div>
                    <div className="pgcr-perf-label">Kills</div>
                </div>
                <div className="pgcr-perf-cell" {...parallaxHandlers()}>
                    <div className="pgcr-perf-val">{val(entry, "deaths")}</div>
                    <div className="pgcr-perf-label">Deaths</div>
                </div>
                <div className="pgcr-perf-cell" {...parallaxHandlers()}>
                    <div className="pgcr-perf-val">{val(entry, "assists")}</div>
                    <div className="pgcr-perf-label">Assists</div>
                </div>
                <div className="pgcr-perf-cell" {...parallaxHandlers()}>
                    <div className="pgcr-perf-val">{dval(entry, "killsDeathsRatio")}</div>
                    <div className="pgcr-perf-label">K/D</div>
                </div>
                <div className="pgcr-perf-cell" {...parallaxHandlers()}>
                    <div className="pgcr-perf-val">{extVal("weaponKillsMelee")}</div>
                    <div className="pgcr-perf-label">Melee Kills</div>
                </div>
                <div className="pgcr-perf-cell" {...parallaxHandlers()}>
                    <div className="pgcr-perf-val">{extVal("weaponKillsGrenade")}</div>
                    <div className="pgcr-perf-label">Grenade Kills</div>
                </div>
                <div className="pgcr-perf-cell" {...parallaxHandlers()}>
                    <div className="pgcr-perf-val">{extVal("weaponKillsSuper")}</div>
                    <div className="pgcr-perf-label">Super Kills</div>
                </div>
                <div className="pgcr-perf-cell" {...parallaxHandlers()}>
                    <div className="pgcr-perf-val">{extVal("precisionKills")}</div>
                    <div className="pgcr-perf-label">Precision Kills</div>
                </div>
                <div className="pgcr-perf-cell" {...parallaxHandlers()}>
                    <div className="pgcr-perf-val">
                        {val(entry, "longestKillSpree") > 0
                            ? val(entry, "longestKillSpree")
                            : "—"}
                    </div>
                    <div className="pgcr-perf-label">Longest Spree</div>
                </div>
            </div>

            {weapons.length > 0 && (
                <>
                    <div className="pgcr-section-label">Loadout</div>
                    <div className="pgcr-weapon-list">
                        {weapons.map(w => {
                            const pct = totalKills > 0 ? Math.round((w.kills / totalKills) * 100) : 0
                            const precPct = w.kills > 0 ? Math.round((w.precision / w.kills) * 100) : 0
                            return (
                                <div key={w.hash} className="pgcr-weapon" {...parallaxHandlers()}>
                                    <div className="pgcr-weapon-icon">
                                        {w.def?.icon
                                            ? <img src={w.def.icon} alt="" />
                                            : <div className="pgcr-weapon-placeholder" />}
                                    </div>
                                    <div className="pgcr-weapon-info">
                                        <div className="pgcr-weapon-top">
                                            <span className="pgcr-weapon-name">{w.def?.name ?? "Unknown"}</span>
                                            {w.def && w.def.equipmentSlot !== "Unknown" && (
                                                <span
                                                    className="pgcr-weapon-slot"
                                                    style={{ color: slotTagColor(w.def.equipmentSlot), borderColor: slotTagColor(w.def.equipmentSlot) }}
                                                >
                                                    {w.def.equipmentSlot}
                                                </span>
                                            )}
                                        </div>
                                        <div className="pgcr-weapon-sub">
                                            {w.kills} kills &middot; {pct}% of loadout
                                        </div>
                                        <div className="pgcr-weapon-precision">
                                            Precision: {w.precision} ({precPct}%)
                                        </div>
                                        <div className="pgcr-weapon-bar">
                                            <div className="pgcr-weapon-bar-fill" style={{ width: `${pct}%` }} />
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </>
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Main Overlay
// ---------------------------------------------------------------------------

export function PgcrOverlay({
    runs,
    initialView,
    onClose,
}: {
    runs: ActivityRun[]
    initialView: ClearsView | { type: "pgcr"; instanceId: string; fromActivity: string }
    onClose: () => void
}) {
    const [stack, setStack] = useState<View[]>([initialView])
    const [pgcrData, setPgcrData] = useState<PgcrResponse | null>(null)
    const [pgcrItems, setPgcrItems] = useState<Map<number, ManifestItemDef>>(new Map())
    const [pgcrClassIcons, setPgcrClassIcons] = useState<Record<string, string>>({})
    const [pgcrActivityName, setPgcrActivityName] = useState("")
    const [pgcrActivityImage, setPgcrActivityImage] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const loadedIdRef = useRef<string | null>(null)

    const current = stack[stack.length - 1]

    const push = useCallback((v: View) => setStack(s => [...s, v]), [])
    // Go back a level, or close when already at the root (e.g. opened directly on
    // a single PGCR from a "fastest clear" click, where there's nothing to pop to).
    const pop = useCallback(() => {
        if (stack.length > 1) setStack(s => s.slice(0, -1))
        else onClose()
    }, [stack.length, onClose])

    const activityRuns = current.type === "clears"
        ? runs.filter(r => r.groupKey === current.groupKey).sort((a, b) => b.date.getTime() - a.date.getTime())
        : []

    const pgcrInstanceId = current.type === "pgcr" ? current.instanceId : null

    // Fetch PGCR + resolve emblems, weapons, class icons
    useEffect(() => {
        if (!pgcrInstanceId || pgcrInstanceId === loadedIdRef.current) return
        const instanceId = pgcrInstanceId
        loadedIdRef.current = instanceId
        setLoading(true)
        setError(null)
        setPgcrData(null)
        setPgcrActivityImage(null)

        ;(async () => {
            try {
                const [pgcr, classIcons] = await Promise.all([
                    getFullPgcr(instanceId),
                    resolveClassIcons(),
                ])
                setPgcrData(pgcr)
                setPgcrClassIcons(classIcons)
                setPgcrActivityName((current as PgcrView).fromActivity)

                // Name + banner image. Curated raid/dungeon splash art first
                // (nicer), else the manifest's activity image.
                const ref = pgcr.activityDetails.referenceId
                const raid = raidByHash(ref)
                const dungeon = dungeonByHash(ref)
                if (raid) {
                    setPgcrActivityName(raid.name)
                    setPgcrActivityImage(raidSplashUrl(raid.splashSlug))
                } else if (dungeon) {
                    setPgcrActivityName(dungeon.name)
                    setPgcrActivityImage(dungeon.splashUrl)
                } else {
                    const info = await resolveActivityInfo(ref)
                    if (info.name) setPgcrActivityName(info.name)
                    setPgcrActivityImage(info.image)
                }

                const hashesToResolve: number[] = []
                for (const e of pgcr.entries) {
                    if (e.player.emblemHash) hashesToResolve.push(e.player.emblemHash)
                    for (const w of e.extended?.weapons ?? []) {
                        hashesToResolve.push(w.referenceId)
                    }
                }
                const itemMap = await resolveItems(hashesToResolve)
                setPgcrItems(itemMap)
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
            } finally {
                setLoading(false)
            }
        })()
    }, [pgcrInstanceId])

    // Escape is handled by AnimatedOverlay (with the exit animation).

    return (
        <AnimatedOverlay onClose={onClose}>
            <div className="pgcr-overlay-inner" onClick={e => e.stopPropagation()}>
                {current.type === "clears" && (
                    <ClearsList
                        runs={activityRuns}
                        activityName={current.activityName}
                        splashUrl={current.splashUrl}
                        onSelect={instanceId => {
                            push({ type: "pgcr", instanceId, fromActivity: current.activityName })
                        }}
                        onClose={onClose}
                    />
                )}

                {current.type === "pgcr" && (
                    loading ? (
                        <div className="pgcr-panel">
                            <div className="pgcr-topbar">
                                <button className="pgcr-back" onClick={pop}>&larr; Back</button>
                                <button className="pgcr-close" onClick={onClose} aria-label="Close">&times;</button>
                            </div>
                            <div className="pgcr-loading">
                                <div className="spinner" />
                                Loading activity report&hellip;
                            </div>
                        </div>
                    ) : error ? (
                        <div className="pgcr-panel">
                            <div className="pgcr-topbar">
                                <button className="pgcr-back" onClick={pop}>&larr; Back</button>
                                <button className="pgcr-close" onClick={onClose} aria-label="Close">&times;</button>
                            </div>
                            <div className="pgcr-loading pgcr-error-msg">{error}</div>
                        </div>
                    ) : pgcrData ? (
                        <PgcrDetail
                            pgcr={pgcrData}
                            items={pgcrItems}
                            classIcons={pgcrClassIcons}
                            activityName={pgcrActivityName}
                            activityImage={pgcrActivityImage}
                            onBack={pop}
                            onClose={onClose}
                            onPlayerClick={idx => {
                                push({
                                    type: "player",
                                    pgcr: pgcrData,
                                    entryIndex: idx,
                                    items: pgcrItems,
                                    classIcons: pgcrClassIcons,
                                    activityName: pgcrActivityName,
                                })
                            }}
                        />
                    ) : null
                )}

                {current.type === "player" && (
                    <PlayerDetailView
                        entry={current.pgcr.entries[current.entryIndex]}
                        items={current.items}
                        classIcons={current.classIcons}
                        onBack={pop}
                        onClose={onClose}
                    />
                )}
            </div>
        </AnimatedOverlay>
    )
}
