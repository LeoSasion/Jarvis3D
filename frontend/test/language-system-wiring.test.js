import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
const hostSource = await readFile(
  new URL("../../host/Jarvis.Host/Infrastructure/WebViewEnvironmentProvider.cs", import.meta.url),
  "utf8",
);

test("language initializes before surfaces load and the native WebView follows Windows UI culture", () => {
  const languageInit = mainSource.indexOf("initializeLanguageSystem()");
  const surfaceImport = mainSource.indexOf('import("./TaskbarSurface.jsx")');
  assert.ok(languageInit >= 0 && languageInit < surfaceImport);
  assert.match(hostSource, /CultureInfo\.CurrentUICulture\.Name/u);
  assert.match(hostSource, /CoreWebView2EnvironmentOptions/u);
  assert.match(hostSource, /Language\s*=\s*CultureInfo\.CurrentUICulture\.Name/u);
});
