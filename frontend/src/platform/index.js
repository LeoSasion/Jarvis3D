import { createMockPlatform } from "./mock-platform.js";
import { createWindowsPlatform } from "./windows-platform.js";
import { createLocalGraphPreview } from "./local-graph-preview.js";

const webview = globalThis.window?.chrome?.webview;

const basePlatform = webview?.postMessage && webview?.addEventListener
  ? createWindowsPlatform(webview)
  : createMockPlatform();

export const platform = basePlatform.kind !== "windows" && import.meta.env?.DEV && import.meta.env.JARVIS_LOCAL_GRAPH
  ? { ...basePlatform, knowledgeGraph: createLocalGraphPreview() }
  : basePlatform;

export const isWindowsHost = platform.kind === "windows";
