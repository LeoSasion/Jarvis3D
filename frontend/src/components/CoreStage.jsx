import {
  ArrowSyncRegular,
  ChevronRightRegular,
  DesktopRegular,
  FolderOpenRegular,
  FolderRegular,
  SearchRegular,
  SettingsRegular,
} from "@fluentui/react-icons";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getGraphSourceDiagnostics } from "../graph/graph-source-diagnostics.js";
import { isRenderableGraphSource } from "../graph/graph-source-model.js";
import { GraphVisualSettings } from "../graphics/graph/GraphVisualSettings.jsx";
import {
  getGraphVisualSettingsSnapshot,
  setGraphVisualSetting,
  subscribeGraphVisualSettings,
} from "../graphics/graph/graph-visual-settings.js";
import { useDesktopTools } from "../desktop-tools-context.js";
import { GraphViewControls } from "./GraphViewControls.jsx";
import { usePlatformKind } from "../hooks/usePlatformData.js";
import { useReducedMotion } from "../hooks/useReducedMotion.js";
import { useLanguage } from "../i18n/language-system.js";
import { clampKnowledgeGraphZoom, getKnowledgeGraphPresentation } from "../knowledge-graph-model.js";
import {
  GraphAccessibleNavigator,
  KnowledgeGraphWorkspace,
} from "./KnowledgeGraphWorkspace.jsx";
import { KnowledgeGraphField } from "./VectorMarks.jsx";
import "../graphics/graph/graph-neuron.css";

const CoreVisualCanvas = lazy(() => import("../graphics/CoreVisualCanvas.jsx")
  .then((module) => ({ default: module.CoreVisualCanvas })));
const actionIcons = Object.freeze({
  "search-local": SearchRegular,
  "open-files": FolderRegular,
  "desktop-only": DesktopRegular,
});
const EMPTY_GRAPH_SELECTION = Object.freeze([]);

function GraphFallback({ runtimeFallback = false }) {
  return (
    <div
      className="core-stage__graphics-fallback"
      data-runtime-fallback={runtimeFallback ? "resolved" : undefined}
      aria-hidden="true"
    >
      <KnowledgeGraphField connected={false} />
    </div>
  );
}

function getDesktopGraphMotionMode() {
  if (typeof window === "undefined") return "system";
  const motion = new URLSearchParams(window.location.search).get("motion");
  return motion === "full" || motion === "reduced" ? motion : "system";
}

function NeuralDesktopField({ motionMode }) {
  return (
    <Suspense fallback={<GraphFallback />}>
      <CoreVisualCanvas
        fallback={<GraphFallback runtimeFallback />}
        motionMode={motionMode}
        scene="neural-orb"
      />
    </Suspense>
  );
}

function getLocalizedGraphDiagnostics(diagnostics, t) {
  const title = t(`core.graph.health.${diagnostics.id}.title`);
  if (diagnostics.id === "error") {
    return {
      title,
      detail: diagnostics.detail || t("core.graph.health.error.detail"),
    };
  }
  return {
    title,
    detail: t(`core.graph.health.${diagnostics.id}.detail`, diagnostics.counts),
  };
}

function getLocalizedPresentationAnnouncement(presentation, t) {
  if (!presentation.connected) return t("core.graph.announcement.disconnected");
  return presentation.simulation
    ? t("core.graph.announcement.preview")
    : t("core.graph.announcement.connected", { count: presentation.sourceCount });
}

function isDefaultGraphNodeExpandable() {
  return false;
}

export function CoreStage({
  graphState = null,
  graphSource = null,
  defaultGraphState = null,
  graphSelection = EMPTY_GRAPH_SELECTION,
  desktopOnly = false,
  onOpenSearch,
  onOpenFiles,
  onOpenGraphPath,
  onLinkGraphNode,
  onKeepDesktop,
  onRestoreLaunchpad,
}) {
  const { t } = useLanguage();
  const stageRef = useRef(null);
  const rectRef = useRef(null);
  const motionReduced = useReducedMotion();
  const graphMotionMode = getDesktopGraphMotionMode();
  const platformKind = usePlatformKind();
  const { activePanel, setActivePanel, togglePanel } = useDesktopTools();
  const visualSettingsOpen = activePanel === "graph-settings";
  const toggleVisualSettings = () => togglePanel("graph-settings");
  const [graphZoom, setGraphZoom] = useState(1);
  const [graphDepth, setGraphDepth] = useState(720);
  const handleCameraViewChange = useCallback((view) => {
    if (view.dimension === 2) setGraphZoom(view.zoom);
    else setGraphDepth(view.depth);
  }, []);
  const [graphExploreMode, setGraphExploreMode] = useState(false);
  const [graphQuery, setGraphQuery] = useState("");
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState(null);
  const [hoveredGraphNodeId, setHoveredGraphNodeId] = useState(null);
  const [cameraCommand, setCameraCommand] = useState(null);
  const cameraCommandIdRef = useRef(0);
  const visualSettingsTriggerRef = useRef(null);
  const defaultConnectionHeadingId = useId();
  const defaultConnectionSummaryId = useId();
  const graphVisualSettings = useSyncExternalStore(
    subscribeGraphVisualSettings,
    getGraphVisualSettingsSnapshot,
    getGraphVisualSettingsSnapshot,
  );
  const activeGraphSource = graphSource ?? graphState;
  const presentation = getKnowledgeGraphPresentation(activeGraphSource);
  const defaultGraph = defaultGraphState?.graph ?? null;
  const defaultGraphConnected = Boolean(defaultGraph?.available);
  const defaultGraphReady = isRenderableGraphSource(defaultGraph);
  const graphDiagnostics = useMemo(
    () => getGraphSourceDiagnostics(defaultGraphState ?? {}),
    [defaultGraphState],
  );
  const graphDiagnosticsCopy = getLocalizedGraphDiagnostics(graphDiagnostics, t);
  const semanticGraphActive = presentation.connected || defaultGraphConnected;
  const stageStatus = semanticGraphActive ? "connected" : presentation.status;
  const actionHandlers = useMemo(() => ({
    "search-local": onOpenSearch,
    "open-files": onOpenFiles,
    "desktop-only": onKeepDesktop,
  }), [onKeepDesktop, onOpenFiles, onOpenSearch]);
  const graphSelectionPaths = useMemo(
    () => graphSelection.map((entry) => entry.path).filter(Boolean),
    [graphSelection],
  );
  const selectedGraphNode = useMemo(
    () => defaultGraph?.nodes.find((node) => node.id === selectedGraphNodeId) ?? null,
    [defaultGraph, selectedGraphNodeId],
  );
  const selectedGraphRelations = useMemo(
    () => defaultGraph?.edges.filter((edge) => (
      edge.source === selectedGraphNodeId || edge.target === selectedGraphNodeId
    )) ?? [],
    [defaultGraph, selectedGraphNodeId],
  );
  const defaultGraphNodeMap = useMemo(
    () => new Map((defaultGraph?.nodes ?? []).map((node) => [node.id, node])),
    [defaultGraph],
  );
  const selectedGraphConnections = useMemo(
    () => selectedGraphRelations.flatMap((edge) => {
      const outgoing = edge.source === selectedGraphNodeId;
      const adjacentNode = defaultGraphNodeMap.get(outgoing ? edge.target : edge.source);
      if (!adjacentNode) return [];
      return [{
        id: edge.id,
        kind: edge.kind ?? "relates",
        direction: outgoing ? "outgoing" : "incoming",
        node: adjacentNode,
      }];
    }),
    [defaultGraphNodeMap, selectedGraphNodeId, selectedGraphRelations],
  );
  const getDefaultGraphNodeLabel = useCallback(
    (node) => node?.title ?? t("core.graph.node.untitled"),
    [t],
  );
  const getDefaultGraphNodeMeta = useCallback(
    (node) => [node?.group, node?.kind].filter(Boolean).join(" · ") ||
      t("core.graph.node.local"),
    [t],
  );

  const issueCameraCommand = useCallback((type) => {
    cameraCommandIdRef.current += 1;
    setCameraCommand({ id: cameraCommandIdRef.current, type });
  }, []);

  const selectDefaultGraphNode = useCallback((node) => {
    setSelectedGraphNodeId(node?.id ?? null);
  }, []);

  const toggleGraphExplore = useCallback(() => {
    setGraphExploreMode((current) => {
      const next = !current;
      if (!next) {
        setGraphQuery("");
        setSelectedGraphNodeId(null);
        setHoveredGraphNodeId(null);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (graphVisualSettings.view.enabled) return;
    setGraphExploreMode(false);
    setGraphQuery("");
    setSelectedGraphNodeId(null);
    setHoveredGraphNodeId(null);
  }, [graphVisualSettings.view.enabled]);

  const selectDefaultGraphMatch = useCallback((value) => {
    const query = value.trim().toLocaleLowerCase();
    if (!query || !defaultGraph) return;
    const match = defaultGraph.nodes.find((node) => (
      `${node.title} ${node.relativePath} ${node.group} ${(node.tags ?? []).join(" ")}`
        .toLocaleLowerCase()
        .includes(query)
    ));
    if (match) setSelectedGraphNodeId(match.id);
  }, [defaultGraph]);

  const searchDefaultGraph = useCallback((event) => {
    event.preventDefault();
    selectDefaultGraphMatch(graphQuery);
  }, [graphQuery, selectDefaultGraphMatch]);

  const handlePointerMove = (event) => {
    const stage = stageRef.current;
    const rect = rectRef.current ?? stage?.getBoundingClientRect();
    if (!stage || !rect || rect.width <= 0 || rect.height <= 0) return;
    rectRef.current = rect;
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    stage.style.setProperty("--parallax-x", `${x * 8}px`);
    stage.style.setProperty("--parallax-y", `${y * 6}px`);
  };

  const resetPointer = () => {
    const stage = stageRef.current;
    if (!stage) return;
    rectRef.current = null;
    stage.style.setProperty("--parallax-x", "0px");
    stage.style.setProperty("--parallax-y", "0px");
  };

  return (
    <section
      ref={stageRef}
      className={`core-stage is-${stageStatus} is-dimension-${graphVisualSettings.view.dimension} ${desktopOnly ? "is-desktop-only" : ""} ${graphExploreMode ? "is-graph-exploring" : "is-neural-idle"}`}
      onPointerEnter={motionReduced || semanticGraphActive ? undefined : () => {
        rectRef.current = stageRef.current?.getBoundingClientRect() ?? null;
      }}
      onPointerMove={motionReduced || semanticGraphActive ? undefined : handlePointerMove}
      onPointerLeave={motionReduced || semanticGraphActive ? undefined : resetPointer}
      aria-label={t("core.graph.accessibility.workspace")}
    >
      <p className="sr-only">
        {defaultGraphConnected
          ? t("core.graph.announcement.defaultSource", {
            name: defaultGraph.source.name,
            nodes: defaultGraph.nodes.length,
            relations: defaultGraph.edges.length,
          })
          : getLocalizedPresentationAnnouncement(presentation, t)}
      </p>
      {presentation.connected ? (
        <div className="core-stage__media is-interactive">
          <KnowledgeGraphWorkspace
            source={activeGraphSource}
            selectionPaths={graphSelectionPaths}
            platformKind={platformKind}
            onOpenPath={onOpenGraphPath}
            onLinkNodeToAgent={onLinkGraphNode}
            visualSettingsOpen={visualSettingsOpen}
            visualSettingsTriggerRef={visualSettingsTriggerRef}
            onOpenVisualSettings={toggleVisualSettings}
          />
        </div>
      ) : defaultGraphReady ? (
        <div className={`core-stage__media is-graphics ${graphExploreMode ? "is-exploring" : ""} ${graphVisualSettings.view.enabled ? "" : "is-disabled"}`}>
          {graphExploreMode && graphVisualSettings.view.enabled
            && graphVisualSettings.layout.mode === "neuron" ? (
              <div className="core-stage__neuron-heading">
                <h2>{t("core.graph.neuron.title")}</h2>
                <p>{t(graphVisualSettings.view.dimension === 3 ? "core.graph.neuron.spatialDetail" : "core.graph.neuron.detail")}</p>
              </div>
            ) : null}
          {graphVisualSettings.view.enabled ? (
            <Suspense fallback={<GraphFallback />}>
              <CoreVisualCanvas
                onCameraViewChange={handleCameraViewChange}
                cameraCommand={cameraCommand}
                fallback={<GraphFallback runtimeFallback />}
                graph={defaultGraph}
                hoveredNodeId={hoveredGraphNodeId}
                interactive={graphExploreMode}
                motionMode={graphMotionMode}
                onNodeHover={(node) => setHoveredGraphNodeId(node?.id ?? null)}
                onNodeSelect={selectDefaultGraphNode}
                selectedNodeId={selectedGraphNodeId}
                zoom={graphZoom}
              />
            </Suspense>
          ) : null}
          <div className="core-stage__readout is-graph-source" aria-hidden="true">
            <span>{graphExploreMode
              ? t("core.graph.readout.localObsidian")
              : t("core.graph.readout.neuralCore")}</span>
            <strong>{defaultGraph.source.name}</strong>
            <small>{graphVisualSettings.view.enabled
              ? graphExploreMode
                ? t("core.graph.readout.counts", {
                  nodes: defaultGraph.nodes.length,
                  relations: defaultGraph.edges.length,
                })
                : t(graphVisualSettings.idleShape === "neuronSphere" ? "core.graph.readout.neuronSphere" : "core.graph.readout.idleReady", {
                  dimension: `${graphVisualSettings.view.dimension}D`,
                })
              : t("core.graph.readout.gpuReleased")}</small>
            <small>{defaultGraph.source.simulation
              ? t("core.graph.source.browserPreview")
              : t(defaultGraph.source.resolution === "local-preview"
                ? "core.graph.source.localVault"
                : "core.graph.source.windowsReadOnly")}</small>
          </div>
        </div>
      ) : defaultGraphConnected ? (
        <div className="core-stage__media is-graphics is-neural-fallback" aria-hidden="true">
          <NeuralDesktopField motionMode={graphMotionMode} />
          <div className="core-stage__readout is-graph-source">
            <span>{t("core.graph.readout.neuralCore")}</span>
            <strong>{defaultGraph.source.name}</strong>
            <small>{t("core.graph.readout.emptyVault", { dimension: "3D" })}</small>
            <small>{defaultGraph.source.simulation
              ? t("core.graph.source.browserPreview")
              : t(defaultGraph.source.resolution === "local-preview"
                ? "core.graph.source.localVault"
                : "core.graph.source.windowsReadOnly")}</small>
          </div>
        </div>
      ) : (
        <div className="core-stage__media is-graphics is-neural-fallback" aria-hidden="true">
          <NeuralDesktopField motionMode={graphMotionMode} />
          <div className="core-stage__readout">
            <span>{t("core.graph.readout.neuralCore")}</span>
            <strong>{defaultGraphState?.status === "loading"
              ? t("core.graph.readout.discoveringVault")
              : t("core.graph.readout.idleForm", { dimension: "3D" })}</strong>
            <small>{defaultGraphState?.status === "loading"
              ? t("core.graph.readout.readOnlyIndex")
              : t("core.graph.presentation.disconnected.detail")}</small>
            <small>{t("core.graph.presentation.disconnected.meta")}</small>
          </div>
        </div>
      )}
      {defaultGraphReady && !presentation.connected ? (
        <div
          className="core-stage__graph-toolbar"
          role="group"
          aria-label={t("core.graph.toolbar.accessibility.label")}
        >
          {graphVisualSettings.view.enabled ? (
            <button
              type="button"
              className="core-stage__graph-explore"
              aria-pressed={graphExploreMode}
              onClick={toggleGraphExplore}
            >
              {graphExploreMode
                ? t("core.graph.toolbar.exitExplore")
                : t("core.graph.toolbar.explore")}
            </button>
          ) : (
            <button
              type="button"
              className="core-stage__graph-explore"
              onClick={() => setGraphVisualSetting("view", "enabled", true)}
            >
              {t("core.graph.toolbar.show")}
            </button>
          )}
          {graphVisualSettings.view.enabled && graphExploreMode ? (
            <form role="search" onSubmit={searchDefaultGraph}>
              <SearchRegular aria-hidden="true" />
              <input
                type="search"
                value={graphQuery}
                onChange={(event) => {
                  setGraphQuery(event.currentTarget.value);
                  selectDefaultGraphMatch(event.currentTarget.value);
                }}
                placeholder={t("core.graph.search.placeholder")}
                aria-label={t("core.graph.search.accessibility.label")}
              />
              <button type="submit" className="sr-only">
                {t("core.graph.search.submit")}
              </button>
            </form>
          ) : null}
          {!graphExploreMode ? (
            <button
              ref={visualSettingsTriggerRef}
              type="button"
              aria-label={t("core.graph.toolbar.visualSettings")}
              title={t("core.graph.toolbar.visualSettings")}
              aria-controls="graph-visual-settings-panel"
              aria-expanded={visualSettingsOpen}
              onClick={toggleVisualSettings}
            ><SettingsRegular aria-hidden="true" /></button>
          ) : null}
          <GraphViewControls
            active={graphVisualSettings.view.enabled && graphExploreMode}
            dimension={graphVisualSettings.view.dimension}
            zoom={graphZoom}
            depth={graphDepth}
            onZoom={(delta) => graphVisualSettings.view.dimension === 3
              ? issueCameraCommand(delta > 0 ? "dolly-in" : "dolly-out")
              : setGraphZoom((current) => clampKnowledgeGraphZoom(current + delta))}
            onFit={() => issueCameraCommand("fit")}
            onReset={() => {
              if (graphVisualSettings.view.dimension === 2) setGraphZoom(1);
              issueCameraCommand("reset");
            }}
            onOpenVisualSettings={toggleVisualSettings}
            visualSettingsOpen={visualSettingsOpen}
            visualSettingsTriggerRef={visualSettingsTriggerRef}
          />
        </div>
      ) : null}
      {defaultGraphReady && !presentation.connected ? (
        <GraphAccessibleNavigator
          active={graphVisualSettings.view.enabled && graphExploreMode}
          nodes={defaultGraph.nodes}
          selectedNodeId={selectedGraphNodeId}
          connections={selectedGraphConnections}
          onSelectNode={selectDefaultGraphNode}
          onActivateNode={selectDefaultGraphNode}
          connectionHeadingId={defaultConnectionHeadingId}
          connectionSummaryId={defaultConnectionSummaryId}
          getNodeLabel={getDefaultGraphNodeLabel}
          getNodeMeta={getDefaultGraphNodeMeta}
          isExpandableNode={isDefaultGraphNodeExpandable}
        />
      ) : null}
      {!presentation.connected && defaultGraphState ? (
        <aside className={`core-stage__graph-health is-${graphDiagnostics.severity}`} aria-live="polite">
          <span><strong>{graphDiagnosticsCopy.title}</strong><small>{graphDiagnosticsCopy.detail}</small></span>
          {typeof defaultGraphState.refresh === "function" ? (
            <button
              type="button"
              disabled={defaultGraphState.refreshing}
              onClick={() => defaultGraphState.refresh({ force: true, rescan: true })}
            >
              <ArrowSyncRegular aria-hidden="true" />
              {defaultGraphState.refreshing
                ? t("core.graph.health.scanning")
                : t("core.graph.health.rescan")}
            </button>
          ) : null}
          {defaultGraphState.canChooseVault && typeof defaultGraphState.chooseVault === "function" ? (
            <button type="button" onClick={defaultGraphState.chooseVault}>
              <FolderOpenRegular aria-hidden="true" />{t("core.graph.health.chooseVault")}
            </button>
          ) : null}
        </aside>
      ) : null}
      {graphVisualSettings.view.enabled && graphExploreMode && selectedGraphNode ? (
        <aside
          className="core-stage__graph-inspector"
          aria-label={t("core.graph.inspector.accessibility.label")}
          aria-describedby={defaultConnectionSummaryId}
        >
          <span>{selectedGraphNode.kind.toUpperCase()}</span>
          <strong>{selectedGraphNode.title}</strong>
          <small>{selectedGraphNode.relativePath || t("core.graph.node.local")}</small>
          <small>
            {t("core.graph.inspector.relations", {
              count: selectedGraphRelations.length,
              types: [...new Set(selectedGraphRelations.map((edge) => edge.kind))].join(" · ") ||
                t("core.graph.inspector.noType"),
            })}
          </small>
        </aside>
      ) : null}
      {semanticGraphActive && visualSettingsOpen ? (
        <GraphVisualSettings
          onClose={() => setActivePanel(null)}
          returnFocusRef={visualSettingsTriggerRef}
        />
      ) : null}
      {!semanticGraphActive && defaultGraphState?.status !== "loading" && !desktopOnly ? (
        <nav className="core-stage__launchpad" aria-label={t("core.graph.launchpad.accessibility.label")}>
          <header>
            <span>{t("core.graph.launchpad.noSource")}</span>
            <strong>{t("core.graph.launchpad.chooseStart")}</strong>
          </header>
          {presentation.actions.map((action, index) => {
            const Icon = actionIcons[action.id];
            const actionKey = `core.graph.launchpad.action.${action.id}`;
            return (
              <button key={action.id} type="button" onClick={actionHandlers[action.id]}>
                <code>{String(index + 1).padStart(2, "0")}</code>
                <Icon aria-hidden="true" />
                <span>
                  <strong>{t(`${actionKey}.label`)}</strong>
                  <small>{t(`${actionKey}.detail`)}</small>
                </span>
                <ChevronRightRegular aria-hidden="true" />
              </button>
            );
          })}
        </nav>
      ) : null}
      {!semanticGraphActive && defaultGraphState?.status !== "loading" && desktopOnly ? (
        <button type="button" className="core-stage__restore" onClick={onRestoreLaunchpad}>
          <span>{t("core.graph.restore.localGraph")}</span>
          <strong>{t("core.graph.restore.showOptions")}</strong>
          <ChevronRightRegular aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}
