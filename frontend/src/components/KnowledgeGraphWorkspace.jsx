import {
  ArrowResetRegular,
  LinkRegular,
  OpenRegular,
  SearchRegular,
  SettingsRegular,
  ZoomInRegular,
  ZoomOutRegular,
} from "@fluentui/react-icons";
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getGraphVisualSettingsSnapshot,
  setGraphVisualSetting,
  subscribeGraphVisualSettings,
} from "../graphics/graph/graph-visual-settings.js";
import { useLanguage } from "../i18n/language-system.js";
import { formatDateTime } from "../i18n/locale-format.js";
import {
  clampKnowledgeGraphZoom,
  createKnowledgeGraphModel,
  getKnowledgeGraphNavigationIndex,
  getKnowledgeGraphNodeConnections,
  getKnowledgeGraphNodeContextItem,
  getKnowledgeGraphWheelZoomDelta,
} from "../knowledge-graph-model.js";
import { KnowledgeGraphField } from "./VectorMarks.jsx";

const CoreVisualCanvas = lazy(() => import("../graphics/CoreVisualCanvas.jsx")
  .then((module) => ({ default: module.CoreVisualCanvas })));
const EMPTY_OFFSETS = Object.freeze({});
const EMPTY_SELECTION = Object.freeze([]);
function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function createSceneGraph(graph, sourceKey) {
  const degreeById = new Map(graph.nodes.map((node) => [node.id, 0]));
  graph.edges.forEach((edge) => {
    degreeById.set(edge.from, (degreeById.get(edge.from) ?? 0) + 1);
    degreeById.set(edge.to, (degreeById.get(edge.to) ?? 0) + 1);
  });
  return {
    schemaVersion: 1,
    available: graph.nodes.length > 0,
    source: {
      kind: "explorer",
      name: graph.source.sourceName,
      simulation: graph.source.simulation,
      revision: `${sourceKey}:${graph.visibleEntryCount}:${graph.relationCount}`,
    },
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      title: node.label,
      relativePath: node.path ?? "",
      kind: node.kind === "entry" ? "note" : node.kind,
      group: node.meta ?? "",
      tags: node.graphKind ? [node.graphKind] : [],
      resolved: true,
      degree: degreeById.get(node.id) ?? 0,
      weight: node.kind === "source" ? 7 : node.kind === "group" ? 4 : node.selected ? 2 : 1,
      x: node.x - 500,
      y: 310 - node.y,
      z: 0,
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.from,
      target: edge.to,
      kind: "contains",
      weight: 1,
    })),
    stats: {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      resolvedEdgeCount: graph.edges.length,
      unresolvedNodeCount: 0,
      truncated: graph.source.truncatedCount > 0,
    },
  };
}

function GraphFallback() {
  return (
    <div className="knowledge-workspace__gpu-fallback" aria-hidden="true">
      <KnowledgeGraphField connected />
    </div>
  );
}

function getAccessibleNodeLabel(node) {
  return node?.label ?? node?.title;
}

function getAccessibleNodeMeta(node) {
  return node?.meta ?? node?.group ?? node?.kind;
}

function isAccessibleGroupNode(node) {
  return node?.kind === "group";
}

function localizeKnowledgeGraph(graph, t) {
  return Object.freeze({
    ...graph,
    nodes: Object.freeze(graph.nodes.map((node) => Object.freeze({
      ...node,
      label: node.labelKey ? t(node.labelKey) : node.label,
      meta: node.metaKey ? t(node.metaKey, node.metaValues) : node.meta,
    }))),
  });
}

export function GraphAccessibleNavigator({
  active = false,
  nodes = EMPTY_SELECTION,
  selectedNodeId = null,
  connections = EMPTY_SELECTION,
  onSelectNode,
  onActivateNode = onSelectNode,
  connectionHeadingId,
  connectionSummaryId,
  getNodeLabel = getAccessibleNodeLabel,
  getNodeMeta = getAccessibleNodeMeta,
  isExpandableNode = isAccessibleGroupNode,
}) {
  const { t } = useLanguage();
  const generatedHeadingId = useId();
  const generatedSummaryId = useId();
  const [nodeIndex, setNodeIndex] = useState(0);
  const [connectionIndex, setConnectionIndex] = useState(0);
  const selectedNodeIndex = useMemo(
    () => nodes.findIndex((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId],
  );
  const boundedNodeIndex = selectedNodeIndex >= 0
    ? selectedNodeIndex
    : nodes.length > 0 ? Math.min(nodes.length - 1, Math.max(0, nodeIndex)) : -1;
  const activeNode = nodes[boundedNodeIndex] ?? null;
  const selectedNode = nodes[selectedNodeIndex] ?? null;
  const boundedConnectionIndex = connections.length > 0
    ? Math.min(connections.length - 1, Math.max(0, connectionIndex))
    : -1;
  const activeConnection = connections[boundedConnectionIndex] ?? null;
  const resolvedHeadingId = connectionHeadingId ?? generatedHeadingId;
  const resolvedSummaryId = connectionSummaryId ?? generatedSummaryId;
  const selectedRelationTypes = useMemo(
    () => [...new Set(connections.map((connection) => connection.kind))],
    [connections],
  );

  useEffect(() => {
    setConnectionIndex(0);
  }, [selectedNodeId]);

  const selectNode = useCallback((node) => {
    if (!node) return;
    const nextIndex = nodes.findIndex((candidate) => candidate.id === node.id);
    if (nextIndex >= 0) setNodeIndex(nextIndex);
    setConnectionIndex(0);
    onSelectNode?.(node);
  }, [nodes, onSelectNode]);

  const activateNode = useCallback((node) => {
    if (!node) return;
    onActivateNode?.(node);
  }, [onActivateNode]);

  const handleNodeKeyDown = useCallback((event) => {
    const nextIndex = getKnowledgeGraphNavigationIndex(
      boundedNodeIndex,
      event.key,
      nodes.length,
    );
    if (nextIndex >= 0) {
      event.preventDefault();
      selectNode(nodes[nextIndex]);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateNode(activeNode);
    }
  }, [activeNode, activateNode, boundedNodeIndex, nodes, selectNode]);

  const handleConnectionKeyDown = useCallback((event) => {
    const nextIndex = getKnowledgeGraphNavigationIndex(
      boundedConnectionIndex,
      event.key,
      connections.length,
    );
    if (nextIndex >= 0) {
      event.preventDefault();
      setConnectionIndex(nextIndex);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && activeConnection) {
      event.preventDefault();
      selectNode(activeConnection.node);
    }
  }, [activeConnection, boundedConnectionIndex, connections.length, selectNode]);

  if (!active || !activeNode) return null;

  const resolveNodeLabel = (node) => getNodeLabel(node) || t("graph.navigator.node.untitled");
  const activeNodeLabel = resolveNodeLabel(activeNode);
  const activeNodeMeta = getNodeMeta(activeNode) || t("graph.navigator.node.local");
  const selectedNodeLabel = selectedNode ? resolveNodeLabel(selectedNode) : "";
  const expandable = isExpandableNode(activeNode);

  return (
    <div className="knowledge-workspace__accessible-nodes sr-only">
      <div role="listbox" aria-label={t("graph.navigator.nodes.aria")}>
        <button
          type="button"
          role="option"
          aria-selected={selectedNodeId === activeNode.id}
          aria-setsize={nodes.length}
          aria-posinset={boundedNodeIndex + 1}
          aria-expanded={expandable ? Boolean(activeNode.expanded) : undefined}
          onClick={() => activateNode(activeNode)}
          onFocus={() => selectNode(activeNode)}
          onKeyDown={handleNodeKeyDown}
        >
          {t("graph.navigator.node.position", {
            label: activeNodeLabel,
            meta: activeNodeMeta,
            position: boundedNodeIndex + 1,
            count: nodes.length,
          })}
          {expandable
            ? t(activeNode.expanded
              ? "graph.navigator.group.expanded"
              : "graph.navigator.group.collapsed")
            : t("graph.navigator.node.selectHint")}
        </button>
      </div>

      {selectedNode ? (
        <section aria-labelledby={resolvedHeadingId}>
          <strong id={resolvedHeadingId} className="sr-only">{t("graph.navigator.connections.title")}</strong>
          <p id={resolvedSummaryId} className="sr-only">
            {t(connections.length === 1
              ? "graph.navigator.connections.summary.one"
              : "graph.navigator.connections.summary.other", {
              label: selectedNodeLabel,
              count: connections.length,
            })}
            {selectedRelationTypes.length > 0
              ? t("graph.navigator.connections.types", {
                types: selectedRelationTypes.join(t("common.separator.list")),
              })
              : t("graph.navigator.connections.noTypes")}
          </p>
          {activeConnection ? (
            <div
              role="listbox"
              aria-label={t("graph.navigator.connections.aria", { label: selectedNodeLabel })}
            >
              <button
                type="button"
                role="option"
                aria-selected={true}
                aria-setsize={connections.length}
                aria-posinset={boundedConnectionIndex + 1}
                onClick={() => selectNode(activeConnection.node)}
                onKeyDown={handleConnectionKeyDown}
              >
                {t("graph.navigator.connection.position", {
                  source: activeConnection.direction === "outgoing"
                    ? selectedNodeLabel
                    : resolveNodeLabel(activeConnection.node),
                  relation: activeConnection.kind,
                  target: activeConnection.direction === "outgoing"
                    ? resolveNodeLabel(activeConnection.node)
                    : selectedNodeLabel,
                  position: boundedConnectionIndex + 1,
                  count: connections.length,
                })}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export function KnowledgeGraphWorkspace({
  source,
  selectionPaths = EMPTY_SELECTION,
  platformKind = "preview",
  onOpenPath,
  onLinkNodeToAgent,
  onOpenVisualSettings,
  visualSettingsOpen = false,
  visualSettingsTriggerRef,
}) {
  const { language, t } = useLanguage();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [collapsedIds, setCollapsedIds] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [exploreMode, setExploreMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [cameraCommand, setCameraCommand] = useState(null);
  const cameraCommandIdRef = useRef(0);
  const canvasRef = useRef(null);
  const visualSettings = useSyncExternalStore(
    subscribeGraphVisualSettings,
    getGraphVisualSettingsSnapshot,
    getGraphVisualSettingsSnapshot,
  );
  const connectionHeadingId = useId();
  const connectionSummaryId = useId();
  const sourceKey = source?.currentPath ?? source?.CurrentPath ?? "";
  const graphModel = useMemo(() => createKnowledgeGraphModel(source, {
    collapsedIds,
    nodeOffsets: EMPTY_OFFSETS,
    query: deferredQuery,
    selectedPaths: selectionPaths,
  }), [collapsedIds, deferredQuery, selectionPaths, source]);
  const graph = useMemo(
    () => localizeKnowledgeGraph(graphModel, t),
    [graphModel, t],
  );
  const nodeMap = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const sceneGraph = useMemo(
    () => createSceneGraph(graph, sourceKey),
    [graph, sourceKey],
  );
  const selectedNode = nodeMap.get(selectedNodeId) ?? null;
  const selectedConnections = useMemo(
    () => getKnowledgeGraphNodeConnections(graph, selectedNodeId),
    [graph, selectedNodeId],
  );
  const selectedRelationTypes = useMemo(
    () => [...new Set(selectedConnections.map((connection) => connection.kind))],
    [selectedConnections],
  );

  useEffect(() => {
    setQuery("");
    setCollapsedIds([]);
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    setExploreMode(false);
    setZoom(1);
  }, [sourceKey]);

  const changeZoom = useCallback((delta) => {
    setZoom((current) => clampKnowledgeGraphZoom(current + delta));
  }, []);

  const issueCameraCommand = useCallback((type) => {
    cameraCommandIdRef.current += 1;
    setCameraCommand({ id: cameraCommandIdRef.current, type });
  }, []);

  const toggleExploreMode = useCallback(() => {
    setExploreMode((current) => {
      const next = !current;
      if (!next) {
        setHoveredNodeId(null);
        setSelectedNodeId(null);
      }
      return next;
    });
  }, []);

  const handleWheel = useCallback((event) => {
    if (!exploreMode) return;
    event.preventDefault();
    const delta = getKnowledgeGraphWheelZoomDelta(event.deltaY, event.deltaMode);
    if (delta !== 0) changeZoom(delta);
  }, [changeZoom, exploreMode]);

  const toggleGroup = useCallback((nodeId) => {
    setCollapsedIds((current) => current.includes(nodeId)
      ? current.filter((id) => id !== nodeId)
      : [...current, nodeId]);
  }, []);

  const focusNode = useCallback((node) => {
    if (!node) return;
    setSelectedNodeId(node.id);
  }, []);

  const activateNode = useCallback((node) => {
    if (!node) return;
    focusNode(node);
    if (node.kind === "group") {
      toggleGroup(node.id);
    }
  }, [focusNode, toggleGroup]);

  const resetView = useCallback(() => {
    setQuery("");
    setCollapsedIds([]);
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    setZoom(1);
    issueCameraCommand("reset");
  }, [issueCameraCommand]);

  const selectedContextItem = getKnowledgeGraphNodeContextItem(selectedNode);
  const sourceModeLabel = platformKind === "windows" && !graph.source.simulation
    ? t("graph.workspace.source.windowsHost")
    : t("graph.workspace.source.simulatedPreview");
  const nodeDensity = graph.visibleEntryCount <= 18
    ? "expanded"
    : graph.visibleEntryCount <= 30 ? "balanced" : "compact";

  return (
    <div className="knowledge-workspace" data-node-density={nodeDensity}>
      <header className="knowledge-workspace__toolbar">
        <button
          type="button"
          className="knowledge-workspace__explore-toggle"
          aria-pressed={exploreMode}
          onClick={toggleExploreMode}
        >
          {exploreMode
            ? t("graph.workspace.action.exitExplore")
            : t("graph.workspace.action.explore")}
        </button>
        <label>
          <SearchRegular aria-hidden="true" />
          <span className="sr-only">{t("graph.workspace.search.aria")}</span>
          <input
            type="search"
            value={query}
            disabled={!exploreMode}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("graph.workspace.search.placeholder")}
            aria-label={t("graph.workspace.search.aria")}
          />
        </label>
        <div className="knowledge-workspace__facts" aria-live="polite">
          <strong>{graph.source.sourceName}</strong>
          <span>{t("graph.workspace.facts.visible", { count: graph.visibleEntryCount })}</span>
          <span>{t("graph.workspace.facts.relations", { count: graph.relationCount })}</span>
          <span>{sourceModeLabel}</span>
        </div>
        <div
          className="knowledge-workspace__zoom"
          role="group"
          aria-label={t("graph.workspace.viewControls.aria")}
        >
          <button
            type="button"
            className={visualSettings.view.dimension === 2 ? "is-active" : ""}
            onClick={() => setGraphVisualSetting("view", "dimension", 2)}
            aria-pressed={visualSettings.view.dimension === 2}
            aria-label={t("graph.workspace.action.switch2d")}
          >2D</button>
          <button
            type="button"
            className={visualSettings.view.dimension === 3 ? "is-active" : ""}
            onClick={() => setGraphVisualSetting("view", "dimension", 3)}
            aria-pressed={visualSettings.view.dimension === 3}
            aria-label={t("graph.workspace.action.switch3d")}
          >3D</button>
          <button type="button" onClick={() => changeZoom(-0.12)} aria-label={t("graph.workspace.action.zoomOut")}><ZoomOutRegular /></button>
          <output aria-label={t("graph.workspace.zoom.aria")}>{Math.round(zoom * 100)}%</output>
          <button type="button" onClick={() => changeZoom(0.12)} aria-label={t("graph.workspace.action.zoomIn")}><ZoomInRegular /></button>
          <button type="button" onClick={() => issueCameraCommand("fit")} aria-label={t("graph.workspace.action.fit")}>{t("graph.workspace.action.fitShort")}</button>
          <button type="button" onClick={resetView} aria-label={t("graph.workspace.action.resetView")}><ArrowResetRegular /></button>
          <button
            ref={visualSettingsTriggerRef}
            type="button"
            onClick={onOpenVisualSettings}
            aria-label={t(visualSettingsOpen
              ? "graph.workspace.action.closeVisualSettings"
              : "graph.workspace.action.openVisualSettings")}
            aria-controls="graph-visual-settings-panel"
            aria-expanded={visualSettingsOpen}
          >
            <SettingsRegular />
          </button>
        </div>
      </header>

      <div
        ref={canvasRef}
        className={`knowledge-workspace__canvas ${exploreMode ? "is-exploring" : "is-passive"}`}
        role={exploreMode ? "group" : undefined}
        aria-label={exploreMode
          ? t("graph.workspace.canvas.aria", { source: graph.source.sourceName })
          : undefined}
        data-graphics-input-owner={exploreMode ? "graph" : undefined}
        onWheel={handleWheel}
      >
        <Suspense fallback={<GraphFallback />}>
          <CoreVisualCanvas
            cameraCommand={cameraCommand}
            fallback={<GraphFallback />}
            graph={sceneGraph}
            hoveredNodeId={hoveredNodeId}
            interactive={exploreMode}
            onNodeHover={(node) => setHoveredNodeId(node?.id ?? null)}
            onNodeSelect={(node) => activateNode(nodeMap.get(node.id))}
            selectedNodeId={selectedNodeId}
            zoom={zoom}
          />
        </Suspense>
      </div>

      <GraphAccessibleNavigator
        active={exploreMode}
        nodes={graph.nodes}
        selectedNodeId={selectedNodeId}
        connections={selectedConnections}
        onSelectNode={focusNode}
        onActivateNode={activateNode}
        connectionHeadingId={connectionHeadingId}
        connectionSummaryId={connectionSummaryId}
      />

      {graph.source.truncatedCount > 0 ? (
        <p className="knowledge-workspace__limit">
          {t("graph.workspace.limit", { count: graph.source.truncatedCount })}
        </p>
      ) : null}

      {deferredQuery && graph.visibleEntryCount === 0 ? (
        <p className="knowledge-workspace__empty" role="status">
          {t("graph.workspace.empty", { query: query.trim() })}
        </p>
      ) : null}

      {selectedNode ? (
        <aside
          className="knowledge-workspace__inspector"
          aria-label={t("graph.workspace.inspector.aria")}
          aria-describedby={connectionSummaryId}
        >
          <header><span>{selectedNode.kind === "source" ? t("graph.workspace.inspector.source") : selectedNode.meta}</span><strong>{selectedNode.label}</strong></header>
          <dl>
            <div><dt>{t("graph.workspace.inspector.path")}</dt><dd title={selectedNode.path}>{selectedNode.path ?? t("graph.workspace.inspector.groupedMetadata")}</dd></div>
            <div><dt>{t("graph.workspace.inspector.size")}</dt><dd>{formatFileSize(selectedNode.sizeBytes)}</dd></div>
            <div><dt>{t("graph.workspace.inspector.modified")}</dt><dd>{formatDateTime(selectedNode.modified, language)}</dd></div>
            <div><dt>{t("graph.workspace.inspector.relations")}</dt><dd>{selectedConnections.length}</dd></div>
            <div><dt>{t("graph.workspace.inspector.types")}</dt><dd>{selectedRelationTypes.join(" · ") || "—"}</dd></div>
          </dl>
          {selectedContextItem ? (
            <footer>
              <button
                type="button"
                onClick={() => onOpenPath?.(selectedContextItem.isDirectory
                  ? selectedContextItem.path
                  : graph.source.currentPath)}
              >
                <OpenRegular /><span>{t("graph.workspace.action.showInExplorer")}</span>
              </button>
              <button type="button" onClick={() => onLinkNodeToAgent?.(selectedContextItem)}><LinkRegular /><span>{t("graph.workspace.action.askAgent")}</span></button>
            </footer>
          ) : null}
        </aside>
      ) : (
        <p className="knowledge-workspace__hint">
          {exploreMode
            ? t("graph.workspace.hint.explore")
            : t("graph.workspace.hint.background")}
        </p>
      )}
    </div>
  );
}
