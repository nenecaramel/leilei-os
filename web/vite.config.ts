import {
  defineConfig,
  loadEnv,
} from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  const commit =
    (
      env.RAILWAY_GIT_COMMIT_SHA ||
      env.GITHUB_SHA ||
      env.VERCEL_GIT_COMMIT_SHA ||
      ""
    )
      .trim()
      .slice(0, 7);

  return {
    define: {
      __LEILEI_VERSION__:
        JSON.stringify("0.1.0"),
      __LEILEI_COMMIT__:
        JSON.stringify(commit),
      __LEILEI_MODE__:
        JSON.stringify(mode),
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        includeAssets: [
          "pwa-192.png",
          "pwa-512.png",
          "pwa-maskable-512.png",
          "apple-touch-icon.png",
        ],
        manifest: {
          id: "/",
          name: "Leilei OS",
          short_name: "Leilei OS",
          description: "Leilei OS personal space",
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#ebeae4",
          theme_color: "#ebeae4",
          icons: [
            {
              src: "/pwa-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "/pwa-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    ],
    server: {
      port: 5173,
    },
    preview: {
      port: 4173,
    },
  };
});
