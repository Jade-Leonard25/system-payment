import path from "node:path";
import { fileURLToPath } from "node:url";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    babel({ presets: [reactCompilerPreset()] }),
    electron({
      main: {
        entry: "electron/main.js",
        onstart({ startup }) {
          // dev only: your shell has no WAYLAND_DISPLAY, so force XWayland
          process.env.ELECTRON_OZONE_PLATFORM_HINT = "x11";
          delete process.env.WAYLAND_DISPLAY;
          startup(["dist-electron/main.js", "--no-sandbox"]);
        },
      },
      preload: {
        input: "electron/preload.js",
        vite: {
          build: {
            rolldownOptions: {
              output: {
                entryFileNames: "[name].cjs",
                chunkFileNames: "[name].cjs",
              },
            },
          },
        },
      },
    }),
  ],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "https://system-payroll-api.automation-payroll.workers.dev",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});