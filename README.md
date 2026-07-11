<div align="center">



<p>
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6?logo=windows&logoColor=white" alt="Windows 10/11" />
  <img src="https://img.shields.io/github/package-json/v/x-JKs/Hub?color=6b5bd2&label=version" alt="Version" />
  <img src="https://img.shields.io/github/downloads/x-JKs/Hub/total?color=6b5bd2&label=downloads" alt="Downloads" />
  <img src="https://img.shields.io/github/license/x-JKs/Hub?color=6b5bd2" alt="License" />
</p>
<p>
  <img src="https://img.shields.io/badge/Electron-2B2E3A?logo=electron&logoColor=9FEAF9" alt="Electron" />
  <img src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" alt="Vite" />
</p>

**A fast, native desktop tracker for Destiny 2 raids, dungeons &amp; Pantheon — with a live in-game overlay.**

[**Download**](https://github.com/x-JKs/Hub/releases/latest) · [Getting started](#getting-started) · [Build from source](#build-from-source)

</div>

---

Hub pulls a Guardian's complete raid, dungeon and Pantheon history straight from Bungie's API and lays it out in a clean desktop dashboard — lifetime clears, fastest *full* clears, flawless / lowman / day-one tags, weapon-level post-game reports, and a live in-game overlay that times your runs and counts your clears without ever leaving the game.

## Download

> **Windows 10/11** Just install and search any Guardian.

1. Download the latest **`Hub Setup x.x.x.exe`** from the [**Releases page**](https://github.com/x-JKs/Hub/releases/latest).
2. Run it — Hub installs to your Start menu (just type **“Hub”** in Windows search).
3. Log in with Bungie, or type any Bungie name (e.g. `Guardian#1234`) to start.

**Hub keeps itself up to date** — it checks for new versions on launch and installs them in the background, so you're always on the latest release.

## Getting started

On first launch, open **Settings** to:

- **Log in with Bungie** to auto-load your own profile on startup, or set a **default player** by Bungie name / membership ID.
- **Enable the overlay** and choose Raids / Dungeons / both and a weekly or daily reset period.

> **Tip:** run Hub as **Administrator** to unlock the instant, packet-based overlay timer (WinDivert). Without admin it still works, falling back to Bungie's API for timing.

## Build from source

Requires **Node.js 18+** on Windows.

```bash
git clone https://github.com/x-JKs/Hub.git
cd Hub
npm install
cp .env.example .env      # add your own Bungie API key + OAuth creds (see .env.example)

npm run dev              # renderer (Vite dev server)
npm run electron:dev     # Electron shell — run from an admin terminal for the packet timer
```

Package it:

```bash
npm run exe    # portable folder  -> release/Hub-win32-x64/Hub.exe
npm run dist   # NSIS installer    -> release/Hub Setup <version>.exe   (run from an Administrator terminal*)
```

> \* electron-builder's `winCodeSign` step extracts symlinks and needs symlink privileges — run from an **Administrator** terminal, or enable Windows **Developer Mode** once.

Released builds bake in the maintainer's Bungie key at build time; when building from source you supply your **own** key in `.env` (the file is git-ignored and never committed).

## Stack

- **Electron** + **Vite** + **React** + **TypeScript**

## Acknowledgements

Inspired by [raid.report](https://raid.report) / [dungeon.report](https://dungeon.report) / threepole in-game overlays. Built on the [Bungie.net API](https://bungie-net.github.io/).

## Disclaimer &amp; license

Hub is a fan-made project and is **not affiliated with or endorsed by Bungie, Inc.** Destiny 2 and all related assets are trademarks of Bungie. Some stats (e.g. leaderboard-style “fastest” times) are approximated from public API data and may differ slightly from RaidHub's crawled database.

Released under the [MIT License](LICENSE).
