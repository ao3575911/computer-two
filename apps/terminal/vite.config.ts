import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tauriConfig from "./src-tauri/tauri.conf.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __COMPUTER_TWO_BUILD_VERSION__: JSON.stringify(tauriConfig.version),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
