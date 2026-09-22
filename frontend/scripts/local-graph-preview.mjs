import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath, URL } from "node:url";
import { promisify } from "node:util";
import { setTimeout, clearTimeout } from "node:timers";
import process from "node:process";
import { Buffer } from "node:buffer";

const run = promisify(execFile);
const project = fileURLToPath(new URL("../../host/Jarvis.GraphPreview/Jarvis.GraphPreview.csproj", import.meta.url));
const assembly = fileURLToPath(new URL("../../host/Jarvis.GraphPreview/bin/Debug/net8.0/Jarvis.GraphPreview.dll", import.meta.url));

export function isLocalGraphRequest(request) {
  const address = request.socket.remoteAddress;
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) return false;
  try {
    const url = new URL(`http://${request.headers.host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
    return !request.headers.origin || request.headers.origin === url.origin;
  } catch {
    return false;
  }
}

export async function readVisualSettingsRequest(request) {
  if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new Error("INVALID_PARAMS");
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 64 * 1024) throw new Error("INVALID_PARAMS");
    chunks.push(Buffer.from(chunk));
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !["revision", "settings"].includes(key))
    || !(value.revision === null || typeof value.revision === "string" && /^[A-Fa-f0-9]{64}$/u.test(value.revision))
    || !value.settings || typeof value.settings !== "object") throw new Error("INVALID_PARAMS");
  return { method: "visual.write", revision: value.revision, settings: value.settings };
}

export function localGraphPreview(vault) {
  let worker;
  let starting;
  let sequence = 0;
  let closed = false;
  const pending = new Map();
  const failPending = () => {
    for (const item of pending.values()) item.reject(new Error("LOCAL_GRAPH_UNAVAILABLE"));
    pending.clear();
  };
  const start = () => {
    if (closed) return Promise.reject(new Error("LOCAL_GRAPH_UNAVAILABLE"));
    if (worker) return Promise.resolve(worker);
    if (starting) return starting;
    starting = (async () => {
      await run("dotnet", ["build", project, "--nologo", "--verbosity", "quiet"], {
        windowsHide: true, timeout: 120_000,
      });
      if (closed) throw new Error("LOCAL_GRAPH_UNAVAILABLE");
      const child = spawn("dotnet", [assembly], {
        env: { ...process.env, JARVIS_OBSIDIAN_VAULT: vault },
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
      });
      worker = child;
      child.stdin.on("error", failPending);
      child.on("error", failPending);
      child.on("exit", () => { worker = null; failPending(); });
      createInterface({ input: child.stdout }).on("line", (line) => {
        try {
          const message = JSON.parse(line);
          const item = pending.get(message.id);
          if (!item) return;
          pending.delete(message.id);
          if (message.error) item.reject(new Error(message.error.code));
          else item.resolve(message.result);
        } catch { failPending(); }
      });
      return child;
    })().finally(() => { starting = null; });
    return starting;
  };
  const requestGraph = async (params) => {
    const child = await start();
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("LOCAL_GRAPH_UNAVAILABLE"));
      }, 30_000);
      pending.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(`${JSON.stringify({ ...params, id })}\n`);
    });
  };

  const configureServer = (server) => {
      server.httpServer?.once("close", () => {
        closed = true;
        worker?.kill();
        failPending();
      });
      server.middlewares.use("/__jarvis/visual-settings", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (!isLocalGraphRequest(request) || request.headers["sec-fetch-site"] === "cross-site"
          || !["GET", "PUT"].includes(request.method)) {
          response.statusCode = 403;
          response.end(JSON.stringify({ code: "LOCAL_SETTINGS_FORBIDDEN" }));
          return;
        }
        try {
          const params = request.method === "GET" ? { method: "visual.read" } : await readVisualSettingsRequest(request);
          response.end(JSON.stringify(await requestGraph(params)));
        } catch {
          response.statusCode = 503;
          response.end(JSON.stringify({ code: "LOCAL_SETTINGS_UNAVAILABLE" }));
        }
      });
      if (!vault) return;
      server.middlewares.use("/__jarvis/graph", async (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        if (!isLocalGraphRequest(request) || request.method !== "GET") {
          response.statusCode = 403;
          response.end(JSON.stringify({ code: "LOCAL_GRAPH_FORBIDDEN" }));
          return;
        }
        try {
          const url = new URL(request.url, "http://localhost");
          let params;
          if (url.pathname === "/manifest") {
            params = { method: "manifest", force: url.searchParams.get("force") === "true" };
          } else if (url.pathname === "/chunk") {
            params = { method: "chunk", revision: url.searchParams.get("revision") ?? "" };
            for (const key of ["nodeOffset", "nodeLimit", "edgeOffset", "edgeLimit"]) {
              const value = Number(url.searchParams.get(key));
              if (!Number.isSafeInteger(value) || value < 0) throw new Error("LOCAL_GRAPH_UNAVAILABLE");
              params[key] = value;
            }
          } else {
            response.statusCode = 404;
            response.end(JSON.stringify({ code: "LOCAL_GRAPH_NOT_FOUND" }));
            return;
          }
          response.end(JSON.stringify(await requestGraph(params)));
        } catch (error) {
          response.statusCode = error.message === "GRAPH_REVISION_STALE" ? 409 : 503;
          response.end(JSON.stringify({ code: response.statusCode === 409 ? "GRAPH_REVISION_STALE" : "LOCAL_GRAPH_UNAVAILABLE" }));
        }
      });
  };
  return {
    name: "jarvis-local-graph-preview",
    apply: "serve",
    configureServer,
    configurePreviewServer: configureServer,
  };
}
