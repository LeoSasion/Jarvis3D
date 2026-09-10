import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

async function readSource(path) {
  return readFile(new URL(path, sourceRoot), "utf8");
}

test("Explorer navigation cannot replace the relationship graph's Obsidian Vault", async () => {
  const app = await readSource("App.jsx");
  assert.match(app, /defaultGraphState=\{defaultKnowledgeGraph\}/u);
  assert.doesNotMatch(app, /setGraphSource|graphSource=|onGraphSourceChange=/u);
  assert.match(app, /onSelectionChange=\{setExplorerSelection\}/u);
  assert.match(app, /onAddToAgentContext=\{linkExplorerSelectionToAgent\}/u);
});

test("connected graph actions use the bounded Agent metadata path", async () => {
  const [app, workspace, model] = await Promise.all([
    readSource("App.jsx"),
    readSource("components/KnowledgeGraphWorkspace.jsx"),
    readSource("knowledge-graph-model.js"),
  ]);

  assert.match(app, /agentSession\.addContextItems\(entry \? \[entry\] : \[\]\)/u);
  assert.match(workspace, /getKnowledgeGraphNodeContextItem\(selectedNode\)/u);
  assert.match(workspace, /t\("graph\.workspace\.action\.askAgent"\)/u);
  assert.match(workspace, /platformKind === "windows"/u);
  assert.doesNotMatch(workspace, /platformKind === "native"/u);
  assert.match(workspace, /<CoreVisualCanvas/u);
  assert.match(workspace, /data-graphics-input-owner=\{exploreMode \? "graph" : undefined\}/u);
  assert.match(workspace, /t\("graph\.workspace\.action\.explore"\)/u);
  assert.doesNotMatch(workspace, /requestAnimationFrame/u);
  assert.match(app, /translate\("feedback\.agent\.contextLocked"\)/u);
  assert.doesNotMatch(model, /fileContent|contents?:/iu);
});

test("the desktop loads one lazy default Obsidian graph scene", async () => {
  const [app, core, runtime, pipeline, windowsPlatform] = await Promise.all([
    readSource("App.jsx"),
    readSource("components/CoreStage.jsx"),
    readSource("graphics/GraphicsRuntime.jsx"),
    readSource("graphics/RenderPipeline.jsx"),
    readSource("platform/windows-platform.js"),
  ]);

  assert.match(app, /useDefaultKnowledgeGraph\(\)/u);
  assert.match(app, /defaultGraphState=\{defaultKnowledgeGraph\}/u);
  assert.match(core, /lazy\(\(\) => import\("\.\.\/graphics\/CoreVisualCanvas\.jsx"\)/u);
  assert.match(runtime, /frameloop="demand"/u);
  assert.match(runtime, /NoToneMapping/u);
  assert.match(pipeline, /ToneMappingMode\.ACES_FILMIC/u);
  assert.match(windowsPlatform, /knowledgeGraph\.getDefaultSource/u);
});

test("only resolved runtime graph fallbacks are exposed to the host", async () => {
  const core = await readSource("components/CoreStage.jsx");

  assert.match(
    core,
    /data-runtime-fallback=\{runtimeFallback \? "resolved" : undefined\}/u,
  );
  assert.equal(
    core.match(/<Suspense fallback=\{<GraphFallback \/>\}>/gu)?.length,
    2,
  );
  assert.equal(
    core.match(/fallback=\{<GraphFallback runtimeFallback \/>\}/gu)?.length,
    2,
  );
  assert.doesNotMatch(
    core,
    /<Suspense fallback=\{<GraphFallback runtimeFallback/u,
  );
});

test("graph visuals share one persisted settings surface and preserve instanced colors", async () => {
  const [
    core,
    workspace,
    settingsPanel,
    settingsStore,
    fxProfiles,
    graphScene,
    shellPanels,
  ] = await Promise.all([
    readSource("components/CoreStage.jsx"),
    readSource("components/KnowledgeGraphWorkspace.jsx"),
    readSource("graphics/graph/GraphVisualSettings.jsx"),
    readSource("graphics/graph/graph-visual-settings.js"),
    readSource("graphics/graph/graph-fx-profile.js"),
    readSource("graphics/graph/GraphScene.jsx"),
    readSource("components/ShellPanels.jsx"),
  ]);

  assert.match(core, /t\("core\.graph\.toolbar\.visualSettings"\)/u);
  assert.match(core, /<GraphVisualSettings/u);
  assert.match(workspace, /onOpenVisualSettings/u);
  assert.match(settingsPanel, /graphVisualPresets/u);
  assert.match(settingsPanel, /subscribeVisualTheme/u);
  assert.match(settingsPanel, /resolveGraphVisualColors/u);
  assert.match(settingsPanel, /setting="activeColor" label=\{technicalLabel\(t, "ACTIVE"\)\}/u);
  assert.match(settingsPanel, /graphVisualSettings\.footer\.customPalette/u);
  assert.match(settingsPanel, /graphVisualSettings\.footer\.activeConstraints/u);
  assert.match(settingsStore, /jarvis\.graph-visual-settings\.v1/u);
  assert.match(settingsStore, /profiles:\s*DEFAULT_GRAPH_FX_PROFILES/u);
  assert.match(fxProfiles, /PROFILE_IDS = Object\.freeze\(\["2d", "3d"\]\)/u);
  assert.match(fxProfiles, /export function normalizeGraphFxProfiles/u);
  assert.match(shellPanels, /settings-graph/u);
  assert.match(graphScene, /InstancedBufferAttribute/u);
  assert.match(graphScene, /mesh\.setColorAt/u);
  assert.match(graphScene, /vertexColors/u);
  assert.match(graphScene, /createGraphLabelAtlas/u);
  assert.doesNotMatch(graphScene, /troika-three-text|new Text\(/u);
  assert.doesNotMatch(settingsPanel, /CoreVisualCanvas|<Canvas/u);
});

test("the 3D editor exposes the named FX profile layers as independent switches", async () => {
  const [settingsPanel, settingsStore] = await Promise.all([
    readSource("graphics/graph/GraphVisualSettings.jsx"),
    readSource("graphics/graph/graph-visual-settings.js"),
  ]);

  const layerContracts = [
    ["node.core.enabled", "graphVisualSettings.layer.nodeCore"],
    ["node.halo.enabled", "graphVisualSettings.layer.nodeHalo"],
    ["node.pulse.enabled", "graphVisualSettings.layer.nodePulse"],
    ["edge.core.enabled", "graphVisualSettings.layer.relationCore"],
    ["edge.halo.enabled", "graphVisualSettings.layer.relationHalo"],
    ["signal.enabled", "graphVisualSettings.layer.relationSignals"],
    ["orb.innerNetwork.enabled", "graphVisualSettings.layer.innerNetwork"],
    ["orb.rim.enabled", "graphVisualSettings.layer.orbRim"],
    ["orb.sparks.enabled", "graphVisualSettings.layer.ambientSparks"],
    ["postFx.bloom.enabled", "graphVisualSettings.layer.bloom"],
  ];
  layerContracts.forEach(([path, labelKey]) => {
    assert.ok(settingsPanel.includes(`path="${path}"`), `${path} must expose a visibility switch`);
    assert.ok(settingsPanel.includes(`t("${labelKey}")`), `${path} must use ${labelKey}`);
  });

  assert.match(settingsPanel, /t\("graphVisualSettings\.category\.nodeFx"\)/u);
  assert.match(settingsPanel, /t\("graphVisualSettings\.category\.relationFx"\)/u);
  assert.match(settingsPanel, /t\("graphVisualSettings\.category\.signals"\)/u);
  assert.match(settingsPanel, /t\("graphVisualSettings\.scope\.idleOrb"\)/u);
  assert.match(settingsPanel, /t\("graphVisualSettings\.category\.postFx"\)/u);
  assert.match(settingsPanel, /path="postFx\.bloom\.radius" label=\{technicalLabel\(t, "BLOOM RADIUS"\)\}/u);
  assert.match(settingsStore, /settings\.profiles/u);
  assert.doesNotMatch(
    settingsPanel,
    /ENERGY SIZE|LOCAL HALO|ORANGE OUTER HALO|BLOOM SMOOTHING/u,
  );
  assert.doesNotMatch(settingsStore, /DEFAULT_GRAPH_ORB_SETTINGS/u);
});

test("graph controls expose labels, composite keyboard navigation, and focus restoration", async () => {
  const [core, workspace, settingsPanel] = await Promise.all([
    readSource("components/CoreStage.jsx"),
    readSource("components/KnowledgeGraphWorkspace.jsx"),
    readSource("graphics/graph/GraphVisualSettings.jsx"),
  ]);

  assert.match(settingsPanel, /<label htmlFor=\{inputId\}>/u);
  assert.match(settingsPanel, /aria-describedby=\{detailId\}/u);
  assert.match(settingsPanel, /<output[^>]*htmlFor=\{inputId\}[^>]*aria-hidden="true"/u);
  assert.match(settingsPanel, /aria-valuetext=\{formattedValue\}/u);
  assert.match(settingsPanel, /event\.key === "ArrowRight"/u);
  assert.match(settingsPanel, /event\.key === "Home"/u);
  assert.match(settingsPanel, /tabIndex=\{getRadioTabIndex/u);
  assert.match(settingsPanel, /returnFocusRef\?\.current/u);
  assert.match(settingsPanel, /closeButtonRef\.current/u);
  assert.match(settingsPanel, /label=\{t\("graphVisualSettings\.choice\.graphDisplay"\)\}/u);
  assert.match(settingsPanel, /label=\{technicalLabel\(t, "MAXIMUM NODES"\)\}/u);

  assert.match(core, /visualSettingsTriggerRef/u);
  assert.match(core, /returnFocusRef=\{visualSettingsTriggerRef\}/u);
  assert.match(workspace, /aria-controls="graph-visual-settings-panel"/u);
  assert.match(workspace, /aria-expanded=\{visualSettingsOpen\}/u);
  assert.match(workspace, /export function GraphAccessibleNavigator/u);
  assert.match(workspace, /role="listbox" aria-label=\{t\("graph\.navigator\.nodes\.aria"\)\}/u);
  assert.match(workspace, /getKnowledgeGraphNavigationIndex/u);
  assert.match(workspace, /selectNode\(nodes\[nextIndex\]\)/u);
  assert.match(workspace, /selectNode\(activeConnection\.node\)/u);
  assert.match(workspace, /t\("graph\.navigator\.connections\.title"\)/u);
  assert.match(workspace, /t\("graph\.navigator\.connections\.types"/u);
  assert.match(workspace, /active=\{exploreMode\}/u);
  assert.match(workspace, /role=\{exploreMode \? "group" : undefined\}/u);
  const tools = await readSource("components/GraphViewControls.jsx");
  assert.match(tools, /role="group" aria-label=\{t\("graph\.workspace\.viewControls\.aria"\)\}/u);
  assert.match(workspace, /<GraphViewControls/u);
  assert.match(core, /<GraphViewControls/u);
  assert.match(core, /<GraphAccessibleNavigator/u);
  assert.match(core, /active=\{graphExploreMode\}/u);
  assert.match(core, /className="core-stage__graph-toolbar"[\s\S]*role="group"/u);
  assert.match(core, /t\("core\.graph\.readout\.idleForm"/u);
  assert.doesNotMatch(
    core,
    /if \(next\) setGraphVisualSetting\("view", "dimension", 3\)/u,
  );
  assert.match(core, /graphVisualSettings\.view\.enabled \? \(/u);
  assert.match(core, /t\("core\.graph\.toolbar\.show"\)/u);
  assert.match(core, /setGraphExploreMode\(false\)/u);
});

test("disabled graph intent releases the GPU owner before it mounts", async () => {
  const [core, canvas, renderPolicy] = await Promise.all([
    readSource("components/CoreStage.jsx"),
    readSource("graphics/CoreVisualCanvas.jsx"),
    readSource("graphics/graph/graph-render-policy.js"),
  ]);

  assert.match(core, /graphVisualSettings\.view\.enabled \? \([\s\S]*<Suspense/u);
  assert.match(canvas, /if \(!settings\.view\.enabled\) return null/u);
  assert.match(canvas, /createGraphNodeBudgetView\(graph, settings\.node\.maxCount/u);
  assert.match(renderPolicy, /NODES \$\{requestedNodes\}→\$\{nodeCount\}/u);
});

test("linked telemetry uses the real platform kind contract", async () => {
  const rail = await readSource("components/LinkedSystemRail.jsx");

  assert.match(rail, /platformKind === "windows"/u);
  assert.doesNotMatch(rail, /platformKind === "native"/u);
});

test("operator stylesheet owns contextual taskbar labels and DPI safeguards", async () => {
  const style = await readSource("operator-workspace.css");

  assert.match(style, /data-label-mode="contextual"/u);
  assert.match(style, /position:\s*absolute/u);
  assert.match(style, /@media \(min-resolution:\s*144dpi\)/u);
  assert.match(style, /linked-system-rail\.is-collapsed/u);
  assert.match(style, /--linked-system-collapsed-width/u);
  assert.match(style, /--graph-toolbar-density-height:\s*48px/u);
  assert.match(style, /core-stage__media\.is-interactive\s*\{[^}]*pointer-events:\s*auto/su);
});
