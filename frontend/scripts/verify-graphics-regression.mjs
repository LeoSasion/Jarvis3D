/* global window */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL, URL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const options = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key === "--headed") options.set(key, true);
  else if (["--url", "--output", "--channel", "--playwright-module", "--baseline"].includes(key) && process.argv[index + 1]) {
    options.set(key, process.argv[++index]);
  } else throw new Error(`Unknown or incomplete argument: ${key}`);
}
const output = options.get("--output");
if (!output) throw new Error("Provide a new --output directory for the report and PNG captures.");
const url = new URL(options.get("--url") ?? "http://127.0.0.1:8888/graphics-regression.html");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol)) {
  throw new Error("Graphics regression only accepts a loopback URL.");
}
await mkdir(resolve(output), { recursive: false });
const playwrightModule = options.get("--playwright-module") ?? process.env.JARVIS_PLAYWRIGHT_MODULE;
const { chromium } = await import(playwrightModule ? pathToFileURL(resolve(playwrightModule)).href : "playwright");
const browser = await chromium.launch({ headless: !options.get("--headed"), channel: options.get("--channel") ?? "msedge" });
const failures = [];
const report = { schemaVersion: 1, environment: "browser", browserVersion: browser.version(), capturedAtUtc: new Date().toISOString(), headless: !options.get("--headed"), url: url.href,
  note: "Fixed-step animation at 60 Hz; P95 measures actual active frame intervals, not simulation time or GPU execution. Screenshots are browser-composited stage captures.", samples: [], errors: failures, success: false };
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: "no-preference" });
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") failures.push(message.text()); });
  await page.goto(url.href, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-regression-ready=true]");
  if (await page.title() !== "JARVIS Graphics Regression") throw new Error("Unexpected regression page title.");
  report.manifest = await page.evaluate(() => window.jarvisGraphicsRegression.manifest);
  report.runtime = await page.evaluate(() => window.jarvisGraphicsRegression.environment());
  if (!report.runtime.documentVisible) throw new Error("The regression document is hidden.");
  for (const caseId of report.manifest.cases) {
    const accepted = await page.evaluate((id) => window.jarvisGraphicsRegression.start(id), caseId);
    if (!accepted) throw new Error(`Regression case rejected: ${caseId}`);
    await page.waitForFunction(() => ["complete", "failed"].includes(window.jarvisGraphicsRegression.status().phase), undefined, { timeout: 60_000 });
    const status = await page.evaluate(() => window.jarvisGraphicsRegression.status());
    if (status.phase !== "complete") throw new Error(`${caseId}: ${status.error}`);
    const screenshot = `${caseId}.png`;
    const buffer = await page.locator("#graphics-regression-stage").screenshot({ path: resolve(output, screenshot), animations: "disabled" });
    report.samples.push({ ...status.result, screenshot, screenshotSha256: createHash("sha256").update(buffer).digest("hex") });
    process.stdout.write(`${caseId}: ${status.result.render.calls} calls, ${status.result.memory.geometries} geometries, ${status.result.memory.textures} textures, P95 ${status.result.frameStatistics.p95Ms.toFixed(2)} ms\n`);
  }
  const byCase = Object.fromEntries(report.samples.map((sample) => [sample.caseId, sample]));
  if (byCase["frozen-a"].screenshotSha256 !== byCase["frozen-a-restored"].screenshotSha256) throw new Error("Restoring frozen A did not restore the composed screenshot.");
  if (byCase["frozen-a"].screenshotSha256 === byCase["frozen-b"].screenshotSha256) throw new Error("The B visual edit did not change the composed screenshot.");
  if (byCase.reentry.screenshotSha256 !== byCase["context-restored"].screenshotSha256) throw new Error("Context recovery changed the composed screenshot.");
  if (options.has("--baseline")) {
    const baseline = JSON.parse(await readFile(resolve(options.get("--baseline")), "utf8"));
    if (!isDeepStrictEqual(baseline.manifest, report.manifest)) throw new Error("Baseline uses a different fixture or manifest.");
    const sameEnvironment = baseline.environment === report.environment && baseline.browserVersion === report.browserVersion;
    report.comparison = report.samples.map((sample) => {
      const previous = baseline.samples.find((entry) => entry.caseId === sample.caseId);
      if (!previous) throw new Error(`Baseline lacks ${sample.caseId}.`);
      // JSON receipts normalize -0; WebView2 also orders object keys differently.
      const stable = (entry) => JSON.parse(JSON.stringify([entry.camera, entry.timeSeconds, entry.shaderTime, entry.positionDigest, entry.signalDigest]));
      if (!isDeepStrictEqual(stable(previous), stable(sample))) throw new Error(`${sample.caseId}: scene/camera baseline changed.`);
      const resourcesMatch = isDeepStrictEqual([previous.render, previous.memory], [sample.render, sample.memory]);
      if (sameEnvironment && !resourcesMatch) throw new Error(`${sample.caseId}: resource baseline changed.`);
      return { caseId: sample.caseId, screenshotMatches: previous.screenshotSha256 === sample.screenshotSha256,
        resourcesMatch, p95Ratio: sample.frameStatistics.p95Ms / previous.frameStatistics.p95Ms };
    });
    report.comparisonNote = sameEnvironment ? "Same browser build: scene, resource and PNG equality required."
      : "Different runtime/build: scene invariants required; PNG encoding/pixel variance and resource counts are reported separately for review.";
    if (sameEnvironment && report.comparison.some((entry) => !entry.screenshotMatches)) throw new Error("Composed screenshot differs from baseline; review the PNGs before accepting a new baseline.");
  }
  if (failures.length) throw new Error("The browser reported an application error.");
  report.success = true;
} catch (error) {
  failures.push(error.message);
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await browser.close();
}
process.stdout.write(`Graphics regression ${report.success ? "PASS" : "FAIL"}: ${resolve(output, "report.json")}\n`);
if (!report.success) process.stderr.write(`${failures.join("\n")}\n`);
