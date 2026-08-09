import {
  defineConfig,
  loadEnv,
} from "vite";
import react from "@vitejs/plugin-react";

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
    plugins: [react()],
    server: {
      port: 5173,
    },
    preview: {
      port: 4173,
    },
  };
});
