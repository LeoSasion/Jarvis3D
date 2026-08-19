import {
  ArrowResetRegular,
  LinkRegular,
  OpenRegular,
  SearchRegular,
  ZoomInRegular,
  ZoomOutRegular,
} from "@fluentui/react-icons";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clampKnowledgeGraphZoom,
  createKnowledgeGraphModel,
  getKnowledgeGraphNodeContextItem,
  getKnowledgeGraphWheelZoomDelta,
} from "../knowledge-graph-model.js";

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 620;
const EMPTY_OFFSETS = Object.freeze({});
const EMPTY_SELECTION = Object.freeze([]);
const MODIFIED_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatModified(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return MODIFIED_FORMATTER.format(date);
}

function nodeRadius(node) {
  if (node.kind === "source") return 20;
  if (node.kind === "group") return 12;
  return node.selected ? 7 : 5;
}

function displayNodeLabel(node) {
  const maximumLength = node.kind === "entry" ? 20 : 24;
  const characters = Array.from(node.label ?? "");
  return characters.length > maximumLength
    ? `${characters.slice(0, maximumLength - 1).join("")}…`
    : characters.join("");
}

function nodeClassName(node, selectedNodeId) {
  return [
    "knowledge-node",
    `is-${node.kind}`,
    node.graphKind ? `is-kind-${node.graphKind}` : "",
    node.selected ? "is-explorer-selected" : "",
    node.id === selectedNodeId ? "is-selected" : "",
    node.kind === "group" && !node.expanded ? "is-collapsed" : "",
  ].filter(Boolean).join(" ");
}

export function KnowledgeGraphWorkspace({
  source,
  selectionPaths = EMPTY_SELECTION,
  platformKind = "preview",
  onOpenPath,
  onLinkNodeToAgent,
}) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const wheelFrameRef = useRef(0);
  const wheelZoomDeltaRef = useRef(0);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [collapsedIds, setCollapsedIds] = useState([]);
  const [nodeOffsets, setNodeOffsets] = useState(EMPTY_OFFSETS);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const sourceKey = source?.currentPath ?? source?.CurrentPath ?? "";
  const graph = useMemo(() => createKnowledgeGraphModel(source, {
    collapsedIds,
    nodeOffsets,
    query: deferredQuery,
    selectedPaths: selectionPaths,
  }), [collapsedIds, deferredQuery, nodeOffsets, selectionPaths, source]);
  const nodeMap = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const selectedNode = nodeMap.get(selectedNodeId) ?? null;
  const transform = `translate(${VIEWBOX_WIDTH / 2} ${VIEWBOX_HEIGHT / 2}) scale(${zoom}) translate(${-VIEWBOX_WIDTH / 2} ${-VIEWBOX_HEIGHT / 2})`;

  useEffect(() => {
    setQuery("");
    setCollapsedIds([]);
    setNodeOffsets(EMPTY_OFFSETS);
    setSelectedNodeId(null);
    setZoom(1);
  }, [sourceKey]);

  useEffect(() => () => {
    cancelAnimationFrame(wheelFrameRef.current);
    wheelFrameRef.current = 0;
    wheelZoomDeltaRef.current = 0;
  }, []);

  const changeZoom = useCallback((delta) => {
    setZoom((current) => clampKnowledgeGraphZoom(current + delta));
  }, []);

  const handleWheel = useCallback((event) => {
    event.preventDefault();
    const delta = getKnowledgeGraphWheelZoomDelta(event.deltaY, event.deltaMode);
    if (delta === 0) return;
    wheelZoomDeltaRef.current = Math.max(
      -0.16,
      Math.min(0.16, wheelZoomDeltaRef.current + delta),
    );
    if (wheelFrameRef.current) return;
    wheelFrameRef.current = requestAnimationFrame(() => {
      wheelFrameRef.current = 0;
      const nextDelta = wheelZoomDeltaRef.current;
      wheelZoomDeltaRef.current = 0;
      changeZoom(nextDelta);
    });
  }, [changeZoom]);

  const toggleGroup = useCallback((nodeId) => {
    setCollapsedIds((current) => current.includes(nodeId)
      ? current.filter((id) => id !== nodeId)
      : [...current, nodeId]);
  }, []);

  const activateNode = useCallback((node) => {
    if (!node) return;
    if (node.kind === "group") {
      toggleGroup(node.id);
      return;
    }
    setSelectedNodeId(node.id);
  }, [toggleGroup]);

  const handleNodeKeyDown = useCallback((event, node) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activateNode(node);
  }, [activateNode]);

  const handleNodePointerDown = useCallback((event, node) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const offset = nodeOffsets[node.id] ?? { x: 0, y: 0 };
    dragRef.current = {
      id: node.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y,
      moved: false,
    };
  }, [nodeOffsets]);

  const handlePointerMove = useCallback((event) => {
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const deltaX = ((event.clientX - drag.startX) * VIEWBOX_WIDTH) / rect.width / zoom;
    const deltaY = ((event.clientY - drag.startY) * VIEWBOX_HEIGHT) / rect.height / zoom;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 3) drag.moved = true;
    setNodeOffsets((current) => ({
      ...current,
      [drag.id]: { x: drag.originX + deltaX, y: drag.originY + deltaY },
    }));
  }, [zoom]);

  const handlePointerEnd = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = drag.moved;
    dragRef.current = null;
  }, []);

  const handleNodeClick = useCallback((node) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    activateNode(node);
  }, [activateNode]);

  const resetView = useCallback(() => {
    setQuery("");
    setCollapsedIds([]);
    setNodeOffsets(EMPTY_OFFSETS);
    setSelectedNodeId(null);
    setZoom(1);
  }, []);

  const selectedContextItem = getKnowledgeGraphNodeContextItem(selectedNode);
  const sourceModeLabel = platformKind === "windows" && !graph.source.simulation
    ? "WINDOWS HOST"
    : "SIMULATED PREVIEW";
  const nodeDensity = graph.visibleEntryCount <= 18
    ? "expanded"
    : graph.visibleEntryCount <= 30 ? "balanced" : "compact";

  return (
    <div className="knowledge-workspace" data-node-density={nodeDensity}>
      <header className="knowledge-workspace__toolbar">
        <label>
          <SearchRegular aria-hidden="true" />
          <span className="sr-only">Search connected graph nodes</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="FILTER LOCAL GRAPH"
            aria-label="Search connected graph nodes"
          />
        </label>
        <div className="knowledge-workspace__facts" aria-live="polite">
          <strong>{graph.source.sourceName}</strong>
          <span>{graph.visibleEntryCount} VISIBLE</span>
          <span>{graph.relationCount} RELATIONS</span>
          <span>{sourceModeLabel}</span>
        </div>
        <div className="knowledge-workspace__zoom" aria-label="Graph view controls">
          <button type="button" onClick={() => changeZoom(-0.12)} aria-label="Zoom out"><ZoomOutRegular /></button>
          <output aria-label="Graph zoom">{Math.round(zoom * 100)}%</output>
          <button type="button" onClick={() => changeZoom(0.12)} aria-label="Zoom in"><ZoomInRegular /></button>
          <button type="button" onClick={resetView} aria-label="Reset graph view"><ArrowResetRegular /></button>
        </div>
      </header>

      <svg
        ref={svgRef}
        className="knowledge-workspace__canvas"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={`Local knowledge graph for ${graph.source.sourceName}`}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheel}
      >
        <defs>
          <pattern id="knowledge-dot-field" width="24" height="24" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="1" height="1" className="knowledge-workspace__dot" />
          </pattern>
        </defs>
        <rect className="knowledge-workspace__field" x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#knowledge-dot-field)" />
        <g transform={transform}>
          <g className="knowledge-workspace__edges" aria-hidden="true">
            {graph.edges.map((edge) => {
              const from = nodeMap.get(edge.from);
              const to = nodeMap.get(edge.to);
              if (!from || !to) return null;
              const midpoint = Math.round((from.x + to.x) / 2);
              return (
                <path
                  key={edge.id}
                  className={to.selected || to.id === selectedNodeId ? "is-active" : ""}
                  d={`M${from.x} ${from.y}H${midpoint}V${to.y}H${to.x}`}
                />
              );
            })}
          </g>
          <g className="knowledge-workspace__nodes">
            {graph.nodes.map((node) => {
              const radius = nodeRadius(node);
              const groupNode = node.kind === "group";
              const labelOnLeft = node.kind === "entry" && node.labelSide === "left";
              const labelX = groupNode
                ? node.x
                : labelOnLeft ? node.x - radius - 8 : node.x + radius + 8;
              const labelY = groupNode ? node.y - radius - 9 : node.y - 2;
              const metaY = groupNode ? node.y + radius + 15 : node.y + 12;
              const textAnchor = groupNode ? "middle" : labelOnLeft ? "end" : "start";
              return (
                <g
                  key={node.id}
                  className={nodeClassName(node, selectedNodeId)}
                  role="button"
                  tabIndex="0"
                  aria-label={`${node.label}. ${node.meta ?? "Local graph node"}`}
                  aria-expanded={node.kind === "group" ? node.expanded : undefined}
                  onClick={() => handleNodeClick(node)}
                  onKeyDown={(event) => handleNodeKeyDown(event, node)}
                  onPointerDown={(event) => handleNodePointerDown(event, node)}
                >
                  {node.kind === "source" ? (
                    <>
                      <circle className="knowledge-node__orbit" cx={node.x} cy={node.y} r={radius + 13} />
                      <path d={`M${node.x} ${node.y - radius}L${node.x + radius} ${node.y}L${node.x} ${node.y + radius}L${node.x - radius} ${node.y}Z`} />
                    </>
                  ) : (
                    <rect x={node.x - radius} y={node.y - radius} width={radius * 2} height={radius * 2} />
                  )}
                  {node.kind === "group" ? (
                    <path className="knowledge-node__state" d={node.expanded
                      ? `M${node.x - 4} ${node.y}H${node.x + 4}`
                      : `M${node.x - 4} ${node.y}H${node.x + 4}M${node.x} ${node.y - 4}V${node.y + 4}`}
                    />
                  ) : null}
                  <text x={labelX} y={labelY} textAnchor={textAnchor}>{displayNodeLabel(node)}</text>
                  <text className="knowledge-node__meta" x={labelX} y={metaY} textAnchor={textAnchor}>{node.meta}</text>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {graph.source.truncatedCount > 0 ? (
        <p className="knowledge-workspace__limit">
          {graph.source.truncatedCount} MORE ITEMS REMAIN IN EXPLORER · GRAPH VIEW IS BOUNDED
        </p>
      ) : null}

      {deferredQuery && graph.visibleEntryCount === 0 ? (
        <p className="knowledge-workspace__empty" role="status">NO LOCAL NODES MATCH “{query.trim()}”</p>
      ) : null}

      {selectedNode ? (
        <aside className="knowledge-workspace__inspector" aria-label="Selected graph node">
          <header><span>{selectedNode.kind === "source" ? "SOURCE" : selectedNode.meta}</span><strong>{selectedNode.label}</strong></header>
          <dl>
            <div><dt>PATH</dt><dd title={selectedNode.path}>{selectedNode.path ?? "GROUPED LOCAL METADATA"}</dd></div>
            <div><dt>SIZE</dt><dd>{formatFileSize(selectedNode.sizeBytes)}</dd></div>
            <div><dt>MODIFIED</dt><dd>{formatModified(selectedNode.modified)}</dd></div>
          </dl>
          {selectedContextItem ? (
            <footer>
              <button
                type="button"
                onClick={() => onOpenPath?.(selectedContextItem.isDirectory
                  ? selectedContextItem.path
                  : graph.source.currentPath)}
              >
                <OpenRegular /><span>SHOW IN EXPLORER</span>
              </button>
              <button type="button" onClick={() => onLinkNodeToAgent?.(selectedContextItem)}><LinkRegular /><span>ASK AGENT</span></button>
            </footer>
          ) : null}
        </aside>
      ) : (
        <p className="knowledge-workspace__hint">SELECT A NODE · DRAG TO REPOSITION · WHEEL TO ZOOM</p>
      )}
    </div>
  );
}
