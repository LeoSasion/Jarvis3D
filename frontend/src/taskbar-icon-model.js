const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const GENERIC_WINDOWS_HOSTS = new Set(["applicationframehost", "wwahost"]);

function firstCharacter(value) {
  return Array.from(value ?? "")[0] ?? "";
}

export function getTaskbarFallbackMark({ processName, label, title } = {}) {
  const normalizedProcess = typeof processName === "string"
    ? processName.trim().replace(/\.(?:exe|com|bat|cmd)$/iu, "").toLocaleLowerCase()
    : "";
  const candidates = GENERIC_WINDOWS_HOSTS.has(normalizedProcess)
    ? [label, title, processName]
    : [processName, label, title];
  const source = candidates.find((value) =>
    typeof value === "string" && value.trim().length > 0);
  if (!source) return "?";

  const normalized = source.trim().replace(/\.(?:exe|com|bat|cmd)$/iu, "");
  const tokens = normalized.match(TOKEN_PATTERN) ?? [];
  const mark = tokens.length > 1
    ? `${firstCharacter(tokens[0])}${firstCharacter(tokens[1])}`
    : Array.from(tokens[0] ?? "").slice(0, 2).join("");

  return mark ? mark.toUpperCase() : "?";
}
