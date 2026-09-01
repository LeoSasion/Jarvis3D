import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellPanelsSource = await readFile(
  new URL("../src/components/ShellPanels.jsx", import.meta.url),
  "utf8",
);

test("Interface settings exposes the bounded language preference as an accessible radio group", () => {
  assert.match(shellPanelsSource, /LANGUAGE_OPTIONS,/u);
  assert.match(shellPanelsSource, /setLanguagePreference,/u);
  assert.match(shellPanelsSource, /useLanguage,/u);
  assert.match(shellPanelsSource, /const language = useLanguage\(\)/u);
  assert.match(shellPanelsSource, /LANGUAGE_OPTIONS\.map\(\(option, index\)/u);
  assert.match(shellPanelsSource, /role="radiogroup"/u);
  assert.match(shellPanelsSource, /role="radio"/u);
  assert.match(shellPanelsSource, /aria-checked=\{selected\}/u);
  assert.match(shellPanelsSource, /tabIndex=\{selected \? 0 : -1\}/u);
  assert.match(shellPanelsSource, /event\.key === "Home"/u);
  assert.match(shellPanelsSource, /event\.key === "End"/u);
  assert.match(shellPanelsSource, /"ArrowRight", "ArrowDown"/u);
  assert.match(shellPanelsSource, /"ArrowLeft", "ArrowUp"/u);
});

test("System language copy distinguishes Windows from browser preview without joining appearance reset", () => {
  assert.match(shellPanelsSource, /platform\.isNative/u);
  assert.match(shellPanelsSource, /settings\.language\.option\.system\.windows/u);
  assert.match(shellPanelsSource, /settings\.language\.option\.system\.browser/u);
  assert.match(shellPanelsSource, /settings\.language\.description\.browser/u);
  assert.match(shellPanelsSource, /settings\.language\.option\.\$\{option\.value\}\.description/u);
  assert.match(shellPanelsSource, /t\("settings\.language\.current"/u);
  assert.ok(
    shellPanelsSource.indexOf('t("settings.language.title")') <
      shellPanelsSource.indexOf("theme-draft-status"),
    "language controls must precede theme customization status",
  );

  const resetStart = shellPanelsSource.indexOf("const resetInterface = async () => {");
  const resetEnd = shellPanelsSource.indexOf("\n  };", resetStart);
  const resetBlock = shellPanelsSource.slice(resetStart, resetEnd);
  assert.ok(resetStart >= 0 && resetEnd > resetStart);
  assert.doesNotMatch(resetBlock, /LanguagePreference/u);
});
