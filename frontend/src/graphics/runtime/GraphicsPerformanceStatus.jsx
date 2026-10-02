import { useState, useSyncExternalStore } from "react";
import { useLanguage } from "../../i18n/language-system.js";
import { getGraphicsDiagnosticsSnapshot, subscribeGraphicsDiagnostics } from "./graphics-diagnostics-store.js";

export function GraphicsPerformanceStatus() {
  const { language } = useLanguage();
  const zh = language.startsWith("zh");
  const diagnostics = useSyncExternalStore(subscribeGraphicsDiagnostics, getGraphicsDiagnosticsSnapshot);
  const [copyState, setCopyState] = useState("");
  const qualityLabels = zh
    ? { low: "节能", balanced: "均衡", high: "高画质", unavailable: "未就绪" }
    : { low: "Low", balanced: "Balanced", high: "High", unavailable: "Unavailable" };
  const reasons = zh ? {
    initial: "当前画质未自动降低。",
    "slow-frames": "因持续卡顿临时降低画质；持续流畅后会逐级恢复。",
    "context-lost": "图形连接中断后采用较低画质；稳定运行后会逐级恢复。",
    recovered: "已恢复一档画质；仍会继续观察流畅度。",
  } : {
    initial: "Quality has not been reduced automatically.",
    "slow-frames": "Quality was reduced after sustained slow frames; it recovers gradually with stable headroom.",
    "context-lost": "Quality was reduced after graphics context loss; it recovers after stable rendering.",
    recovered: "One quality step has been restored; performance is still monitored.",
  };
  const frames = diagnostics.frameStatistics;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setCopyState(zh ? "已复制" : "Copied");
    } catch {
      setCopyState(zh ? "复制失败，请检查剪贴板权限" : "Copy failed; check clipboard access");
    }
  };
  return <section className="graphics-performance-status" aria-label={zh ? "实际画质与性能" : "Actual quality and performance"}>
    <p>{zh ? "设定 / 实际画质：" : "Requested / actual quality: "}
      {qualityLabels[diagnostics.requestedQuality] ?? diagnostics.requestedQuality} / {qualityLabels[diagnostics.effectiveQuality] ?? diagnostics.effectiveQuality}
      {` · DPR ${diagnostics.effectiveDpr.toFixed(2)}`}</p>
    <p>{reasons[diagnostics.adjustmentReason] ?? reasons.initial}</p>
    <p>{frames
      ? `${zh ? "活动帧间隔" : "Active frame intervals"}: ${frames.p50Ms.toFixed(1)} ms (${zh ? "中位数" : "median"}) · ${frames.p95Ms.toFixed(1)} ms (P95) · ${frames.count} ${zh ? "帧" : "frames"}`
      : zh ? "等待活动帧样本…" : "Waiting for active frame samples…"}</p>
    <small>{zh ? "统计最近最多 600 帧；暂停期间不采样。帧间隔不是 GPU 执行耗时。" : "Up to 600 recent active frames; paused time is excluded. Frame intervals are not GPU execution timings."}</small>
    {diagnostics.frameMeasuredAt ? <small>{zh ? "最后采样：" : "Last sample: "}{new Date(diagnostics.frameMeasuredAt).toLocaleTimeString(language)}</small> : null}
    <button type="button" onClick={copy}>{zh ? "复制性能信息" : "Copy performance details"}</button>
    <span role="status">{copyState}</span>
  </section>;
}
