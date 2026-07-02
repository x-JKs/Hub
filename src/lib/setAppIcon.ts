import { LOGO_URL } from "../components/Logo"

// Rasterize the logo asset to a 256px PNG and hand it to the main process as the
// window / taskbar icon. Keeps the bundled asset as the single source of truth.
export function setAppIcon(): void {
    const api = window.electronWindow
    if (!api?.setWindowIcon) return

    const img = new Image()
    img.onload = () => {
        const canvas = document.createElement("canvas")
        canvas.width = 256
        canvas.height = 256
        const ctx = canvas.getContext("2d")
        if (!ctx) return
        ctx.imageSmoothingQuality = "high"
        ctx.drawImage(img, 0, 0, 256, 256)
        try {
            api.setWindowIcon(canvas.toDataURL("image/png"))
        } catch { /* non-critical */ }
    }
    img.src = LOGO_URL
}
