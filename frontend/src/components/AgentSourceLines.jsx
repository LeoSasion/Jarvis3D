export function AgentSourceLines({ source, targetLine = null }) {
  const lines = String(source.text ?? "").split(/\r?\n/u)
    .slice(0, Math.max(1, source.endLine - source.startLine + 1));
  return <div className="agent-source-lines" role="list">
    {lines.map((line, index) => {
      const number = source.startLine + index;
      return <div key={number} className={`agent-source-lines__row${number === targetLine ? " is-target" : ""}`}
        data-source-line={number} role="listitem">
        <span className="agent-source-lines__number" aria-hidden="true">{number}</span>
        <span className="agent-source-lines__text" aria-label={`L${number}: ${line}`}>{line || "\u00a0"}</span>
      </div>;
    })}
  </div>;
}
