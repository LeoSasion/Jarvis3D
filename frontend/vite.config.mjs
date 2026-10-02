import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { localGraphPreview } from "./scripts/local-graph-preview.mjs";
import { execFileSync } from "node:child_process";

function buildIdentity() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  try {
    return { version: "development", revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", windowsHide: true }).trim(),
      dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8", windowsHide: true }).trim()),
      builtAtUtc: new Date().toISOString() };
  } catch { return { version: "development", revision: "unknown", dirty: null, builtAtUtc: new Date().toISOString() }; }
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "JARVIS_");
  const vault = command === "serve" ? env.JARVIS_OBSIDIAN_VAULT : "";
  return {
    define: {
      "import.meta.env.JARVIS_LOCAL_GRAPH": JSON.stringify(Boolean(vault)),
      "import.meta.env.JARVIS_BUILD": JSON.stringify(buildIdentity()),
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
