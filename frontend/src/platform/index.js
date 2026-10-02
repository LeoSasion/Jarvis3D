import { createMockPlatform } from "./mock-platform.js";
import { createWindowsPlatform } from "./windows-platform.js";
import { createLocalGraphPreview } from "./local-graph-preview.js";
import { createLocalVisualSettings } from "./local-visual-settings.js";
import { createLocalConfiguration } from "./local-configuration.js";
import { createLocalAgentConversations } from "./local-agent-conversations.js";

const webview = globalThis.window?.chrome?.webview;

const basePlatform = webview?.postMessage && webview?.addEventListener
  ? createWindowsPlatform(webview)
  : createMockPlatform();

const graphPlatform = basePlatform.kind !== "windows" && import.meta.env?.DEV && import.meta.env.JARVIS_LOCAL_GRAPH
  ? { ...basePlatform, knowledgeGraph: createLocalGraphPreview() }
  : basePlatform;

export const platform = basePlatform.kind !== "windows"
  && ["localhost", "127.0.0.1", "[::1]"].includes(globalThis.window?.location?.hostname)
  ? { ...graphPlatform, graphVisualSettings: createLocalVisualSettings(), configuration: createLocalConfiguration(),
      agentConversations: createLocalAgentConversations() }
  : graphPlatform;
