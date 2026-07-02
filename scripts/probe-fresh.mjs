// Feasibility probe for fresh-vs-checkpoint fastest.
// (1) How deep does GetActivityHistory go for JKs raids? (all-time or windowed?)
// (2) Confirm PGCR `activityWasStartedFromBeginning` and find fastest FRESH GoS.
import { readFileSync } from "node:fs"
// API key comes from the environment or .env (VITE_BUNGIE_API_KEY) — never hardcoded.
function bungieKey() {
    if (process.env.VITE_BUNGIE_API_KEY) return process.env.VITE_BUNGIE_API_KEY.trim()
    try {
        const env = readFileSync(new URL("../.env", import.meta.url), "utf8")
        return (env.match(/^VITE_BUNGIE_API_KEY=(.*)$/m)?.[1] ?? "").trim()
    } catch {
        return ""
    }
}
const KEY = bungieKey()
if (!KEY) {
    console.error("Missing VITE_BUNGIE_API_KEY — set it in .env")
    process.exit(1)
}
const B = "https://www.bungie.net/Platform"
const H = { "X-API-Key": KEY, "Content-Type": "application/json" }
const j = async (url, opts) => (await fetch(url, opts)).json()

const seed = JSON.parse(readFileSync(new URL("../src/manifest/raidSeed.json", import.meta.url)))
const gosHashes = new Set(seed.hashes.filter(h => h.activityId === 7).map(h => h.hash))

const s = await j(`${B}/Destiny2/SearchDestinyPlayerByBungieName/-1/`, {
    method: "POST", headers: H, body: JSON.stringify({ displayName: "JKs", displayNameCode: 4561 })
})
const card = s.Response.find(c => c.crossSaveOverride === 0 || c.crossSaveOverride === c.membershipType) ?? s.Response[0]
const { membershipType: mt, membershipId: mid } = card

const acct = await j(`${B}/Destiny2/${mt}/Account/${mid}/Stats/`, { headers: H })
const allChars = acct.Response.characters.map(c => ({ id: c.characterId, deleted: c.deleted }))

// Paginate raid history fully for every character (incl. deleted).
const raidRuns = []
for (const ch of allChars) {
    let pages = 0
    for (let page = 0; ; page++) {
        const res = await j(`${B}/Destiny2/${mt}/Account/${mid}/Character/${ch.id}/Stats/Activities/?mode=4&count=250&page=${page}`, { headers: H })
        const acts = res.Response?.activities ?? []
        if (acts.length === 0) break
        pages++
        for (const a of acts) {
            raidRuns.push({
                deleted: ch.deleted,
                instanceId: a.activityDetails.instanceId,
                hash: a.activityDetails.referenceId,
                period: a.period,
                dur: a.values.activityDurationSeconds?.basic.value ?? 0,
                completed: a.values.completed?.basic.value === 1 && (a.values.completionReason?.basic.value ?? 0) === 0
            })
        }
        if (acts.length < 250) break
    }
    console.log(`char ${ch.id} deleted=${ch.deleted}: ${pages} pages`)
}
const periods = raidRuns.map(r => new Date(r.period)).sort((a, b) => a - b)
console.log(`\nTotal raid history entries: ${raidRuns.length}`)
console.log(`Oldest: ${periods[0]?.toISOString().slice(0,10)}   Newest: ${periods[periods.length-1]?.toISOString().slice(0,10)}`)
const gos = raidRuns.filter(r => gosHashes.has(r.hash))
console.log(`GoS history entries: ${gos.length} (clears: ${gos.filter(r=>r.completed).length})   [aggregate says 2010 clears]`)

// (2) PGCR fresh check: take fastest GoS clears, fetch PGCRs, show fresh flag.
const gosClears = gos.filter(r => r.completed && r.dur > 0).sort((a, b) => a.dur - b.dur)
console.log(`\nFastest 8 GoS clears in history (checking PGCR freshness):`)
for (const r of gosClears.slice(0, 8)) {
    const pgcr = await j(`${B}/Destiny2/Stats/PostGameCarnageReport/${r.instanceId}/`, { headers: H })
    const R = pgcr.Response
    const fresh = R?.activityWasStartedFromBeginning
    const phase = R?.startingPhaseIndex
    console.log(`  ${Math.floor(r.dur/60)}m ${r.dur%60}s  fresh=${fresh}  startingPhaseIndex=${phase}  ${r.period.slice(0,10)}`)
}
