import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function configuredHosts(telegramRedirectUri?: string) {
  const hosts = new Set<string>();

  if (telegramRedirectUri) {
    try {
      hosts.add(new URL(telegramRedirectUri).hostname);
    } catch {
      // The API validates the redirect URI; Vite simply ignores an invalid value here.
    }
  }

  return [...hosts];
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../", "");
  const apiTarget = env.VITE_API_PROXY_TARGET || `http://127.0.0.1:${env.API_PORT || "4201"}`;

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 4200,
      strictPort: true,
      allowedHosts: configuredHosts(env.TELEGRAM_REDIRECT_URI),
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true
        }
      }
    }
  };
});
