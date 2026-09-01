import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);

async function readSource(path) {
  return readFile(new URL(path, sourceRoot), "utf8");
}

test("the terminal stays on its built-in renderer and never claims a WebGL context", async () => {
  const terminal = await readSource("components/TerminalWorkbench.jsx");
  assert.doesNotMatch(terminal, /addon-webgl|WebglAddon/u);
});

test("the graphics owner adapts inside the demand loop without another RAF", async () => {
  const [runtime, environment] = await Promise.all([
    readSource("graphics/GraphicsRuntime.jsx"),
    readSource("graphics/runtime/display-environment.js"),
  ]);
  assert.match(runtime, /frameloop="demand"/u);
  assert.match(runtime, /calculateEffectiveGraphicsDpr/u);
  assert.match(runtime, /webglcontextlost/u);
  assert.match(runtime, /webglcontextrestored/u);
  assert.match(runtime, /deltaMs: delta \* 1_000/u);
  assert.match(runtime, /readFrameIntervalSample/u);
  assert.doesNotMatch(runtime, /performance\.now\(\) - startedAt/u);
  assert.doesNotMatch(runtime, /requestAnimationFrame/u);
  assert.match(environment, /visualViewport/u);
  assert.match(environment, /forced-colors: active/u);
  assert.match(environment, /resolution:/u);
});

test("interactive graph canvases expose local focus treatment and passive canvases remove keyboard semantics", async () => {
  const [navigation, style] = await Promise.all([
    readSource("graphics/graph/GraphCameraNavigation.jsx"),
    readSource("graphics/graphics-runtime.css"),
  ]);

  assert.match(navigation, /if \(!interactive\) \{[\s\S]*removeAttribute\("tabindex"\)[\s\S]*removeAttribute\("aria-label"\)/u);
  assert.match(navigation, /canvas\.tabIndex = 0/u);
  assert.match(navigation, /aria-keyshortcuts/u);
  assert.match(navigation, /t\("graph\.camera\.controls\.aria"\)/u);
  assert.match(style, /\.graphics-runtime\.is-interactive canvas:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--signal-hot\)/su);
  assert.match(style, /@media \(forced-colors: active\)\s*\{[\s\S]*outline-color:\s*Highlight/u);
});

test("camera reset restores the controlled zoom after Fit in both graph surfaces", async () => {
  const [navigation, scene, canvas, workspace, core] = await Promise.all([
    readSource("graphics/graph/GraphCameraNavigation.jsx"),
    readSource("graphics/graph/GraphScene.jsx"),
    readSource("graphics/CoreVisualCanvas.jsx"),
    readSource("components/KnowledgeGraphWorkspace.jsx"),
    readSource("components/CoreStage.jsx"),
  ]);

  assert.match(
    navigation,
    /zoom: getGraphCameraZoom\(zoom, size\.width, size\.height\)/u,
  );
  const resetImplementation = navigation.slice(
    navigation.indexOf("const resetGraph"),
    navigation.indexOf("const panBy"),
  );
  assert.doesNotMatch(resetImplementation, /zoom: camera\.zoom/u);
  assert.match(scene, /<GraphCameraNavigation[\s\S]*zoom=\{zoom\}/u);
  assert.match(canvas, /function EnabledCoreVisualCanvas\(\{[\s\S]*zoom = 1/u);
  assert.match(canvas, /<GraphScene[\s\S]*zoom=\{zoom\}/u);
  assert.match(workspace, /setZoom\(1\);[\s\S]*issueCameraCommand\("reset"\)/u);
  assert.match(core, /onClick=\{\(\) => issueCameraCommand\("reset"\)\}/u);
});

test("one composer exclusively owns its buffers and consumes quality-aware passes", async () => {
  const pipeline = await readSource("graphics/RenderPipeline.jsx");
  assert.equal(pipeline.match(/<EffectComposer\b/gu)?.length, 1);
  assert.match(pipeline, /createGraphicsPassRegistry/u);
  assert.match(pipeline, /registry\.passes\.map/u);
  assert.match(pipeline, /levels=\{pass\.levels\}/u);
  assert.match(pipeline, /radius=\{pass\.radius\}/u);
  assert.match(pipeline, /bloomRadius,/u);
  assert.match(pipeline, /bloomRadius,[\s\S]*runtime,/u);
  assert.match(pipeline, /runtime\?\.rendererStatus !== "ready"/u);
  assert.doesNotMatch(pipeline, /ComposerResolutionController|EffectComposerContext/u);
  assert.doesNotMatch(pipeline, /resizeEffectComposerBuffers|composer\.setSize/u);
  assert.doesNotMatch(pipeline, /new EffectComposer/u);
});

test("the 3D profile owns toggleable Bloom and passes its explicit radius", async () => {
  const canvas = await readSource("graphics/CoreVisualCanvas.jsx");

  assert.match(canvas, /const profile3dBloom = scenePlan\.profiles\["3d"\]\.postFx\.bloom;/u);
  assert.match(
    canvas,
    /bloom=\{orbEnergyPresentation[\s\S]*profile3dBloom\.enabled \? "required" : false/u,
  );
  assert.match(canvas, /bloomIntensity=\{orbEnergyPresentation[\s\S]*profile3dBloom\.intensity/u);
  assert.match(canvas, /bloomRadius=\{orbEnergyPresentation[\s\S]*profile3dBloom\.radius/u);
  assert.match(canvas, /bloomSmoothing=\{orbEnergyPresentation[\s\S]*profile3dBloom\.softKnee/u);
  assert.match(canvas, /bloomThreshold=\{orbEnergyPresentation[\s\S]*profile3dBloom\.threshold/u);
  assert.match(canvas, /settings\.profiles\?\.\["3d"\]\?\.postFx\?\.bloom/u);
  assert.match(canvas, /ORB_BLOOM_PROFILE/u);
  assert.doesNotMatch(canvas, /settings\.orb|scenePlan\.orb/u);
});
