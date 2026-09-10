import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { localGraphPreview } from "./scripts/local-graph-preview.mjs";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "JARVIS_");
  const vault = command === "serve" ? env.JARVIS_OBSIDIAN_VAULT : "";
  return {
    define: {
      "import.meta.env.JARVIS_LOCAL_GRAPH": JSON.stringify(Boolean(vault)),
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: "0.0.0.0",
      port: 8888,
      strictPort: true,
      allowedHosts: ["terminal.local"],
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [react(), localGraphPreview(vault)],
  };
});
