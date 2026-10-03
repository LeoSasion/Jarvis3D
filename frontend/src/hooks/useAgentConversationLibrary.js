import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { platform } from "../platform/index.js";
import { translate } from "../i18n/language-system.js";
import {
  createConversationId, createSavedConversation, mergeConversationMessages,
} from "../agent-conversation-library.js";

function saveFailureKind(reason) {
  const message = String(reason?.message ?? "");
  return /saved conversation changed|revision conflict/iu.test(message) ? "conflict" : "save";
}

export function useAgentConversationLibrary(liveMessages, agentState) {
  const [current, setCurrent] = useState(() => ({ id: createConversationId(), title: "", restored: [] }));
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [listStatus, setListStatus] = useState("loading");
  const [failedRestoreId, setFailedRestoreId] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const latest = useRef(null);
  const saveQueue = useRef(Promise.resolve());
  const revisions = useRef(new Map());
  const savedSignatures = useRef(new Map());
  const saveSequence = useRef(0);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const messages = useMemo(() => mergeConversationMessages(current.restored, liveMessages), [current.restored, liveMessages]);
  latest.current = { current, messages, agentState };
  const available = Boolean(platform.agentConversations);

  const refresh = useCallback(async () => {
    if (!platform.agentConversations) return;
    if (mounted.current) setListStatus("loading");
    try {
      const values = await platform.agentConversations.list();
      if (mounted.current) {
        setEntries(values);
        setListStatus("ready");
        setError((value) => value === "read" ? null : value);
      }
      return values;
    } catch (reason) {
      if (mounted.current) { setListStatus("error"); setError("read"); }
      throw reason;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => {});
    return () => { mounted.current = false; };
  }, [refresh]);

  const save = useCallback(async ({ force = false } = {}) => {
    const snapshot = latest.current;
    if (!platform.agentConversations || !snapshot.messages.length || busyRef.current && !force) return;
    const document = createSavedConversation({ ...snapshot.current, messages: snapshot.messages, provider: snapshot.agentState.provider });
    const signature = JSON.stringify([document.title, document.provider, document.messages]);
    if (savedSignatures.current.get(document.id) === signature) return;
    const sequence = ++saveSequence.current;
    if (mounted.current) setStatus("pending");
    const write = saveQueue.current.catch(() => {}).then(async () => {
      const result = await platform.agentConversations.save({ ...document, revision: revisions.current.get(document.id) ?? 0 });
      revisions.current.set(document.id, result.revision);
      savedSignatures.current.set(document.id, signature);
      return result;
    });
    saveQueue.current = write;
    try {
      const result = await write;
      if (!mounted.current) return;
      setCurrent((value) => value.id === document.id ? { ...value, title: value.title || result.title } : value);
      if (sequence === saveSequence.current) { setStatus("saved"); setError(null); }
      await refresh().catch(() => {});
    } catch (reason) {
      if (mounted.current && sequence === saveSequence.current) {
        setStatus("error"); setError(saveFailureKind(reason));
      }
      throw reason;
    }
  }, [refresh]);

  useEffect(() => {
    if (!available || transitioning || busyRef.current || !messages.length
      || ["running", "starting"].includes(agentState.status)
      || messages.some((message) => message.status === "streaming")) return undefined;
    const timer = window.setTimeout(() => { void save().catch(() => {}); }, 350);
    return () => window.clearTimeout(timer);
  }, [agentState.status, available, messages, save, transitioning]);

  const change = useCallback(async (id, resetProvider) => {
    if (busyRef.current) throw new Error("AGENT_BUSY");
    busyRef.current = true;
    setTransitioning(true);
    let stage = "save";
    try {
      await save({ force: true });
      stage = "restore";
      const selected = id ? await platform.agentConversations.read(id) : null;
      await resetProvider();
      if (selected) {
        revisions.current.set(selected.id, selected.revision);
        savedSignatures.current.set(selected.id, JSON.stringify([selected.title, selected.provider, selected.messages]));
      }
      setCurrent(selected ? { id: selected.id, title: selected.title, restored: selected.messages }
        : { id: createConversationId(), title: "", restored: [] });
      setStatus(selected ? "saved" : "idle");
      setError(null);
      setFailedRestoreId(null);
    } catch (reason) {
      if (stage === "restore") {
        setError("restore");
        setFailedRestoreId(id);
      }
      throw reason;
    } finally {
      busyRef.current = false;
      if (mounted.current) setTransitioning(false);
    }
  }, [save]);

  const rename = useCallback(async (title) => {
    const normalized = String(title).replace(/[\x00-\x1f]/gu, " ").trim().slice(0, 80);
    if (!normalized || busyRef.current) return;
    busyRef.current = true;
    setTransitioning(true);
    try {
      await save({ force: true });
      const id = latest.current.current.id;
      const result = await platform.agentConversations.rename(id, normalized);
      revisions.current.set(id, result.revision);
      latest.current.current = { ...latest.current.current, title: normalized };
      setCurrent((value) => ({ ...value, title: normalized }));
      await refresh().catch(() => {});
    } catch (reason) { setError(saveFailureKind(reason)); throw reason; }
    finally { busyRef.current = false; setTransitioning(false); }
  }, [refresh, save]);

  const remove = useCallback(async (id) => {
    if (id === latest.current.current.id) throw new Error("ACTIVE_CONVERSATION");
    try { await platform.agentConversations.delete(id); }
    catch (reason) { setError("save"); throw reason; }
    await refresh();
  }, [refresh]);

  const saveCopy = useCallback(async () => {
    if (busyRef.current || !latest.current.messages.length || !platform.agentConversations) return;
    busyRef.current = true;
    setTransitioning(true);
    const snapshot = latest.current;
    const id = createConversationId();
    const title = translate("agent.library.copyName", { title: (snapshot.current.title || translate("agent.library.untitled")).slice(0, 64) });
    const document = createSavedConversation({ id, title, provider: snapshot.agentState.provider, messages: snapshot.messages });
    const sequence = ++saveSequence.current;
    setStatus("pending");
    // A copy has a new identity and revision zero, so a stale original can never be overwritten.
    const write = saveQueue.current.catch(() => {}).then(() => platform.agentConversations.save({ ...document, revision: 0 }));
    saveQueue.current = write;
    try {
      const result = await write;
      revisions.current.set(id, result.revision);
      savedSignatures.current.set(id, JSON.stringify([document.title, document.provider, document.messages]));
      if (!mounted.current || sequence !== saveSequence.current) return;
      setCurrent({ ...snapshot.current, id, title: document.title });
      setStatus("saved");
      setError(null);
      await refresh().catch(() => {});
    } catch (reason) { if (mounted.current) { setStatus("error"); setError(saveFailureKind(reason)); } throw reason; }
    finally { busyRef.current = false; if (mounted.current) setTransitioning(false); }
  }, [refresh]);

  return { available, current, messages, entries, status, error, listStatus, failedRestoreId,
    transitioning, busyRef, resumeMessages: current.restored,
    refresh, change, rename, remove, save, saveCopy };
}
