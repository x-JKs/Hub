// Package the built app into a runnable Windows .exe — manually, offline.
//
// We assemble the standard Electron layout directly from the prebuilt binaries
// in node_modules/electron/dist. This avoids @electron/packager and
// electron-builder, both of which rely on a zip extractor that fails on this
// machine, and needs no network access.

import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const { rcedit } = createRequire(import.meta.url)("rcedit")

const root = path.resolve(".")
const electronDist = path.join(root, "node_modules", "electron", "dist")
const outName = "Hub-win32-x64"
const outDir = path.join(root, "release", outName)
const appDir = path.join(outDir, "resources", "app")
const exeName = "Hub.exe"

if (!existsSync(path.join(electronDist, "electron.exe"))) {
    console.error(
        "node_modules/electron/dist/electron.exe is missing. Run `npm install` (and let " +
            "Electron's binary download finish) before packaging."
    )
    process.exit(1)
}
if (!existsSync(path.join(root, "dist", "index.html"))) {
    console.error("dist/ is missing. Run `npm run build` first.")
    process.exit(1)
}

console.log("Cleaning output…")
await rm(path.join(root, "release"), { recursive: true, force: true })

console.log("Copying Electron runtime…")
await cp(electronDist, outDir, { recursive: true })

console.log("Renaming launcher exe…")
await rename(path.join(outDir, "electron.exe"), path.join(outDir, exeName))

// Stamp the exe with the app icon + metadata (Explorer/taskbar show the logo).
const iconPath = path.join(root, "build", "icon.ico")
if (existsSync(iconPath)) {
    console.log("Setting exe icon + metadata…")
    await rcedit(path.join(outDir, exeName), {
        icon: iconPath,
        "version-string": {
            ProductName: "Hub",
            FileDescription: "Hub — Destiny 2 activity tracker",
            CompanyName: "Hub",
            LegalCopyright: ""
        }
    })
}

// Our app replaces Electron's bundled default app (resources/app takes
// precedence over default_app.asar, but remove it to keep things clean).
await rm(path.join(outDir, "resources", "default_app.asar"), { force: true })

console.log("Staging app files…")
await mkdir(appDir, { recursive: true })
await cp(path.join(root, "dist"), path.join(appDir, "dist"), { recursive: true })
await cp(path.join(root, "electron"), path.join(appDir, "electron"), { recursive: true })

// The main process require()s koffi at runtime (for the WinDivert packet timer),
// so it must ship with the app — otherwise the packet timer is silently disabled.
// koffi 3.x keeps its actual native binary (koffi.node) in a SEPARATE scoped
// package (@koromix/koffi-win32-x64), so both must be copied.
console.log("Bundling koffi native module…")
for (const dep of ["koffi", path.join("@koromix", "koffi-win32-x64")]) {
    await cp(
        path.join(root, "node_modules", dep),
        path.join(appDir, "node_modules", dep),
        { recursive: true }
    )
}

// Minimal package.json so Electron loads our main process.
const pkg = JSON.parse(await import("node:fs").then(fs => fs.promises.readFile("package.json", "utf8")))
await writeFile(
    path.join(appDir, "package.json"),
    JSON.stringify(
        {
            name: pkg.name,
            productName: "Hub",
            version: pkg.version,
            main: "electron/main.cjs"
        },
        null,
        2
    )
)

console.log(`\n✔ Done. Portable app folder: release/${outName}`)
console.log(`  Double-click: release/${outName}/${exeName}`)
