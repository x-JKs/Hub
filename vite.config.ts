import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// https://vite.dev/config/
export default defineConfig({
    // Relative base so the built assets load from file:// inside the Electron exe.
    base: "./",
    plugins: [react()],
    server: {
        proxy: {
            // Proxy Bungie API calls server-side and drop the Origin/Referer
            // headers, so the origin-restricted API key is accepted (Bungie
            // rejects browser POSTs whose Origin doesn't match the key).
            "/bungie-stats": {
                target: "https://stats.bungie.net",
                changeOrigin: true,
                rewrite: path => path.replace(/^\/bungie-stats/, ""),
                configure: proxy => {
                    proxy.on("proxyReq", proxyReq => {
                        proxyReq.removeHeader("origin")
                        proxyReq.removeHeader("referer")
                    })
                }
            },
            "/bungie": {
                target: "https://www.bungie.net",
                changeOrigin: true,
                rewrite: path => path.replace(/^\/bungie/, ""),
                configure: proxy => {
                    proxy.on("proxyReq", proxyReq => {
                        proxyReq.removeHeader("origin")
                        proxyReq.removeHeader("referer")
                    })
                }
            }
        }
    }
})
