import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (await readFile(
  new URL("../src/components/DesktopShortcuts.jsx", import.meta.url),
  "utf8",
)).replaceAll("\r\n", "\n");

function readBlock(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("DPR profile changes refresh every manual-position writer", () => {
  const profileBinding = readBlock(
    "const [displayScale, setDisplayScale] = useState",
    "\n  const iconMetrics = useMemo",
  );
  const profileResizeEffect = readBlock(
    "useEffect(() => {\n    const container = containerRef.current;",
    "\n\n  useEffect(() => {\n    try {\n      window.localStorage.setItem(AUTO_ARRANGE_STORAGE_KEY",
  );
  const normalizationEffect = readBlock(
    "useEffect(() => {\n    if (autoArrange || containerSize.width <= 0",
    "\n\n  useEffect(() => {\n    const openDesktopMenu",
  );
  const captureArrangedPositions = readBlock(
    "const captureArrangedPositions = useCallback",
    "\n\n  const toggleAutoArrange",
  );
  const toggleAlignToGrid = readBlock(
    "const toggleAlignToGrid = useCallback",
    "\n\n  const setDesktopIconSize",
  );
  const finishShortcutMove = readBlock(
    "const finishShortcutMove = useCallback",
    "\n\n  const selectedContextShortcut",
  );

  assert.match(
    profileBinding,
    /getDesktopLayoutProfileId\([\s\S]*?displayScale,[\s\S]*?\)/u,
  );
  assert.match(
    profileBinding,
    /const setManualPositions = useCallback[\s\S]*?currentProfiles\[layoutProfileId\][\s\S]*?\}, \[layoutProfileId\]\);/u,
  );
  assert.match(
    profileResizeEffect,
    /setDisplayScale\([\s\S]*?window\.devicePixelRatio/u,
  );
  assert.match(profileResizeEffect, /window\.addEventListener\("resize", updateSize\)/u);
  assert.match(
    profileResizeEffect,
    /window\.visualViewport\?\.addEventListener\("resize", updateSize\)/u,
  );

  for (const hookSource of [
    normalizationEffect,
    captureArrangedPositions,
    toggleAlignToGrid,
    finishShortcutMove,
  ]) {
    assert.match(hookSource, /setManualPositions/u);
    assert.match(hookSource, /\[[^\]]*setManualPositions[^\]]*\]\);/su);
  }
});
