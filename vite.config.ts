import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const designThemeUrl = env.VITE_DESIGN_THEME_URL;
  const parsedThemeUrl = designThemeUrl ? new URL(designThemeUrl) : null;

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: parsedThemeUrl
        ? {
            "/__design-theme__": {
              target: parsedThemeUrl.origin,
              changeOrigin: true,
              rewrite: () => `${parsedThemeUrl.pathname}${parsedThemeUrl.search}`,
            },
          }
        : undefined,
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
