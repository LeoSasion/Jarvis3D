import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "../i18n/language-system.js";
import { platform } from "../platform/index.js";
import { MAX_AGENT_CONTENT_ITEMS } from "../agent-context-model.js";
import {
  createKnowledgeContextItem, createNeighborhoodScene, getKnowledgeSearchKey,
  isKnowledgeBasketItemStale, KNOWLEDGE_PAGE_SIZE,
} from "./knowledge-browser-model.js";
import "./knowledge-browser.css";

export function KnowledgeBrowser({ graph, selectedNodeId, onSelectNode, onFocusNode, onNeighborhood, onLinkToAgent }) {
  const { t, language } = useLanguage();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [offset, setOffset] = useState(0);
  const [previousOffsets, setPreviousOffsets] = useState([]);
  const [search, setSearch] = useState(null);
  const [searching, setSearching] = useState(false);
  const [scope, setScope] = useState(0);
  const [neighborhood, setNeighborhood] = useState(null);
  const [excerpt, setExcerpt] = useState(null);
  const [startLine, setStartLine] = useState(1);
  const [basket, setBasket] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [errorKind, setErrorKind] = useState(null);
  const [retry, setRetry] = useState(0);
  const readSequence = useRef(0);
  const searchKey = getKnowledgeSearchKey(graph.source.revision, query, tag, offset);
  const currentSearch = search?.requestKey === searchKey && !searching ? search : null;
  const basketRevisionPending = basket.length > 0 && !currentSearch;
  const staleBasketCount = currentSearch
    ? basket.filter((item) => isKnowledgeBasketItemStale(item, currentSearch.revision)).length
    : 0;
  const selected = useMemo(() => [...(currentSearch?.items ?? []), ...(neighborhood?.nodes ?? []), ...graph.nodes]
    .find((node) => node.id === selectedNodeId), [currentSearch, graph.nodes, neighborhood, selectedNodeId]);
  const relations = useMemo(() => {
    const source = neighborhood ?? graph;
    const nodes = new Map(source.nodes.map((node) => [node.id, node]));
    return source.edges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
      .map((edge) => ({ ...edge, direction: edge.source === selectedNodeId ? "outgoing" : "incoming",
        node: nodes.get(edge.source === selectedNodeId ? edge.target : edge.source) }));
  }, [graph, neighborhood, selectedNodeId]);

  useEffect(() => {
    let current = true;
    const requestKey = getKnowledgeSearchKey(graph.source.revision, query, tag, offset);
    setSearching(true);
    const timer = window.setTimeout(() => {
      platform.knowledgeGraph.search({ query, tag, offset, limit: KNOWLEDGE_PAGE_SIZE }).then((value) => {
        if (current) { setSearch({ ...value, requestKey }); setError(null); setErrorKind(null); }
      }).catch(() => { if (current) { setSearch(null); setError(t("knowledge.error.search")); setErrorKind("search"); } })
        .finally(() => { if (current) setSearching(false); });
    }, 180);
    return () => { current = false; window.clearTimeout(timer); };
  }, [graph.source.revision, offset, query, retry, t, tag]);

  useEffect(() => {
    let current = true;
    if (!selectedNodeId || !currentSearch?.revision) { onNeighborhood(null); return undefined; }
    platform.knowledgeGraph.neighborhood({ revision: currentSearch.revision, nodeId: selectedNodeId, hops: scope || 1 })
      .then((value) => {
        if (!current) return;
        setNeighborhood(value);
        onNeighborhood(scope ? createNeighborhoodScene(graph, value) : null);
      }).catch(() => { if (current) { setError(t("knowledge.error.changed")); setErrorKind("search"); onNeighborhood(null); } });
    return () => { current = false; };
  }, [graph, onNeighborhood, scope, currentSearch?.revision, selectedNodeId, t]);

  useEffect(() => {
    readSequence.current += 1;
    setExcerpt(null);
    setStartLine(1);
    setBusy(false);
    return () => { readSequence.current += 1; };
  }, [selectedNodeId, graph.source.revision]);

  const choose = (node) => {
    if (!node || !currentSearch) return;
    onSelectNode(node);
    if (!graph.nodes.some((item) => item.id === node.id)) setScope(1);
    onFocusNode?.(node);
  };
  const readNote = async () => {
    const sequence = ++readSequence.current;
    setBusy(true);
    setError(null);
    try {
      const value = await platform.knowledgeGraph.readNote({ revision: currentSearch.revision, nodeId: selectedNodeId, startLine });
      if (sequence === readSequence.current) setExcerpt({ ...value, capturedAt: new Date().toISOString() });
    } catch { if (sequence === readSequence.current) { setError(t("knowledge.error.read")); setErrorKind("read"); } }
    finally { if (sequence === readSequence.current) setBusy(false); }
  };
  const stage = () => {
    if (!currentSearch || isKnowledgeBasketItemStale({ excerpt }, currentSearch.revision)) return;
    const item = createKnowledgeContextItem(excerpt);
    if (!item) return;
    setBasket((items) => [...items.filter((entry) => entry.id !== item.id), item].slice(-MAX_AGENT_CONTENT_ITEMS));
  };
  const refreshBasketItem = async (item) => {
    if (!currentSearch?.revision) return;
    setBusy(true);
    setError(null);
    try {
      const value = await platform.knowledgeGraph.readNote({
        revision: currentSearch.revision, nodeId: item.id, startLine: item.excerpt.startLine,
      });
      const refreshed = createKnowledgeContextItem({ ...value, capturedAt: new Date().toISOString() });
      if (!refreshed) throw new Error("Invalid excerpt");
      setBasket((items) => items.map((entry) => entry.id === item.id ? refreshed : entry));
    } catch {
      setError(t("knowledge.error.refresh"));
      setErrorKind("read");
    } finally { setBusy(false); }
  };
  const ask = async (intent) => {
    if (!basket.length || staleBasketCount || basketRevisionPending) return;
    setBusy(true);
    try { await onLinkToAgent(basket, t(`knowledge.prompt.${intent}`)); }
    catch { setError(t("knowledge.error.agent")); setErrorKind("agent"); }
    finally { setBusy(false); }
  };
  return (
    <aside className="knowledge-browser" aria-label={t("knowledge.browser.title")}>
      <header><strong>{t("knowledge.browser.title")}</strong><small>{graph.source.name}</small></header>
      <label>{t("knowledge.search.label")}<input type="search" value={query} maxLength={256}
        placeholder={t("knowledge.search.placeholder")}
        onChange={(event) => { setQuery(event.target.value); setOffset(0); setPreviousOffsets([]); }} /></label>
      <label>{t("knowledge.tag.label")}<select value={tag} onChange={(event) => { setTag(event.target.value); setOffset(0); setPreviousOffsets([]); }}>
        <option value="">{t("knowledge.tag.all")}</option>
        {(search?.tags ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <div className="knowledge-browser__status" role="status">
        {searching ? t("knowledge.search.loading") : t("knowledge.search.count", { count: search?.total ?? 0 })}
        {search?.truncated ? <small>{t("knowledge.search.bounded")}</small> : null}
      </div>
      {error ? <p role="alert">{error} {errorKind === "search" ? <button type="button" onClick={() => setRetry((value) => value + 1)}>{t("knowledge.retry")}</button> : null}</p> : null}
      {query || tag ? <button type="button" className="knowledge-browser__clear-search" onClick={() => {
        setQuery(""); setTag(""); setOffset(0); setPreviousOffsets([]);
      }}>{t("knowledge.search.clear")}</button> : null}
      <ul className="knowledge-browser__results" aria-label={t("knowledge.search.results")}>
        {(currentSearch?.items ?? []).map((node) => <li key={node.id}><button type="button"
          aria-current={node.id === selectedNodeId ? "true" : undefined} onClick={() => choose(node)}>
          <strong>{node.title}</strong><small>{node.relativePath}</small>
        </button></li>)}
      </ul>
      {currentSearch && (currentSearch.nextOffset < currentSearch.total || offset > 0) ? <nav className="knowledge-browser__actions" aria-label={t("knowledge.search.pages")}>
        <button type="button" disabled={searching || !previousOffsets.length} onClick={() => {
          setOffset(previousOffsets.at(-1) ?? 0); setPreviousOffsets((values) => values.slice(0, -1));
        }}>{t("knowledge.previous")}</button>
        <span>{offset + 1}–{currentSearch.nextOffset} / {currentSearch.total}</span>
        <button type="button" disabled={searching || currentSearch.nextOffset >= currentSearch.total || currentSearch.nextOffset <= offset} onClick={() => {
          setPreviousOffsets((values) => [...values, offset]); setOffset(currentSearch.nextOffset);
        }}>{t("knowledge.next")}</button>
      </nav> : null}
      {selected ? <section className="knowledge-browser__note">
        <h3>{selected.title}</h3><small>{selected.relativePath}</small>
        <div className="knowledge-browser__actions">
          <button type="button" disabled={!currentSearch} onClick={() => onFocusNode?.(selected)}>{t("knowledge.locate")}</button>
          <button type="button" onClick={() => onSelectNode(null)}>{t("knowledge.selection.clear")}</button>
        </div>
        {selected.aliases?.length ? <p>{t("knowledge.aliases")}: {selected.aliases.join(" · ")}</p> : null}
        <div className="knowledge-browser__actions" aria-label={t("knowledge.scope")}>
          {[0, 1, 2].map((hops) => <button type="button" key={hops} aria-pressed={scope === hops} onClick={() => setScope(hops)}>
            {hops ? t("knowledge.scope.hops", { count: hops }) : t("knowledge.scope.all")}</button>)}
        </div>
        {neighborhood?.truncated ? <p>{t("knowledge.neighborhood.bounded")}</p> : null}
        {typeof platform.knowledgeGraph.openNote === "function" ? <button type="button" disabled={!currentSearch?.revision} onClick={() => {
          void platform.knowledgeGraph.openNote({ revision: currentSearch.revision, nodeId: selectedNodeId }).catch(() => { setError(t("knowledge.error.read")); setErrorKind("read"); });
        }}>{t("knowledge.open")}</button> : null}
        <details><summary>{t("knowledge.relations", { count: relations.length })}</summary>
          <ul className="knowledge-browser__relations">{relations.map((edge) => <li key={edge.id}>
            <button type="button" onClick={() => choose(edge.node)} disabled={!edge.node}>
              <small>{t(`knowledge.${edge.direction}`)} · {edge.relationType || edge.kind}</small>
              {edge.node?.title ?? "—"}
            </button>
          </li>)}</ul>
        </details>
        <div className="knowledge-browser__actions">
          <label>{t("knowledge.startLine")}<input type="number" value={startLine} min={1} max={100000}
            onChange={(event) => setStartLine(Math.min(100000, Math.max(1, Number(event.target.value) || 1)))} /></label>
          <button type="button" disabled={busy || !currentSearch?.revision} onClick={() => void readNote()}>{t("knowledge.read")}</button>
        </div>
        {excerpt ? <div className="knowledge-browser__excerpt">
          <p>{t("knowledge.excerpt.range", { start: excerpt.startLine, end: excerpt.endLine, count: excerpt.text.length })}</p>
          <small>{t("knowledge.snapshot.captured", { time: new Date(excerpt.capturedAt).toLocaleString(language) })}</small>
          <pre>{excerpt.text}</pre>
          {excerpt.truncated ? <small>{t("knowledge.excerpt.truncated")}</small> : null}
          <button type="button" disabled={!currentSearch || isKnowledgeBasketItemStale({ excerpt }, currentSearch.revision)
            || (basket.length >= MAX_AGENT_CONTENT_ITEMS && !basket.some((item) => item.id === excerpt.nodeId))}
            onClick={stage}>{t("knowledge.excerpt.add")}</button>
        </div> : null}
      </section> : null}
      {basket.length ? <section className="knowledge-browser__basket">
        <strong>{t("knowledge.send.title", { count: basket.length })}</strong>
        {basketRevisionPending ? <p role="status">{t("knowledge.send.checking")}</p> : null}
        {staleBasketCount ? <p role="status">{t("knowledge.send.stale", { count: staleBasketCount })}</p> : null}
        <p>{t("knowledge.send.scope")}</p>
        {basket.map((item, index) => <div key={item.id} className="knowledge-browser__basket-item">
          <span>[S{index + 1}] {item.name} · L{item.excerpt.startLine}–{item.excerpt.endLine} · {item.excerpt.text.length}
            <small>{t(currentSearch && isKnowledgeBasketItemStale(item, currentSearch.revision) ? "knowledge.snapshot.stale" : "knowledge.snapshot.captured", {
              time: new Date(item.capturedAt).toLocaleString(language),
            })}</small>
          </span>
          {currentSearch && isKnowledgeBasketItemStale(item, currentSearch.revision) ? <button type="button" disabled={busy}
            onClick={() => void refreshBasketItem(item)}>{t("knowledge.snapshot.refresh")}</button> : null}
          <button type="button" aria-label={t("knowledge.remove", { name: item.name })}
            onClick={() => setBasket((items) => items.filter((entry) => entry.id !== item.id))}>×</button>
        </div>)}
        <div className="knowledge-browser__actions">{["summary", "compare", "question"].map((intent) => <button
          type="button" key={intent} disabled={busy || basketRevisionPending || staleBasketCount > 0 || (intent === "compare" && basket.length < 2)} onClick={() => void ask(intent)}>
          {t(`knowledge.intent.${intent}`)}</button>)}</div>
      </section> : null}
    </aside>
  );
}
