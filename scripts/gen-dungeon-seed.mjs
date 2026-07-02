// One-off: build a bundled dungeon definition table from Bungie's manifest.
// Bungie's AggregateActivityStats returns raw activity hashes with no mode info;
// raids map via the RaidHub seed, but dungeons need their own hash->name lookup.
// We extract every activity whose modes include Dungeon (82).
import { writeFileSync, readFileSync } from "node:fs"

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
const get = async url => (await fetch(url, { headers: { "X-API-Key": KEY } })).json()

const manifest = await get(`${B}/Destiny2/Manifest/`)
const path = manifest.Response.jsonWorldComponentContentPaths.en.DestinyActivityDefinition
console.log("Fetching activity definitions:", path)
const defs = await (await fetch(`https://www.bungie.net${path}`)).json()

const DUNGEON_MODE = 82
const dungeons = []
for (const hash of Object.keys(defs)) {
    const d = defs[hash]
    const modes = d.activityModeTypes ?? []
    if (!modes.includes(DUNGEON_MODE)) continue
    if (d.redacted || !d.displayProperties?.name) continue
    dungeons.push({
        hash: Number(hash),
        name: d.displayProperties.name,
        pgcrImage: d.pgcrImage ?? null
    })
}

dungeons.sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(
    new URL("../src/manifest/dungeonSeed.json", import.meta.url),
    JSON.stringify({ dungeons }, null, 2)
)
console.log(`Wrote ${dungeons.length} dungeon activity hashes`)
console.log("sample:", dungeons.slice(0, 8).map(d => d.name))
