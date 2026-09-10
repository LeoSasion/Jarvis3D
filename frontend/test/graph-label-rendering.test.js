import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Scene } from "three";
import { GRAPH_LABEL_LAYER, renderGraphLabels } from "../src/graphics/graph/graph-label-rendering.js";
import { createGraphLabelAtlas } from "../src/graphics/graph/graph-label-atlas.js";
import { calculateEffectiveGraphicsDpr, graphicsQualityProfiles } from "../src/graphics/graphics-runtime-policy.js";

test("interactive labels avoid subpixel upscaling without overruling hardware limits or idle budgets", () => {
  const input = { width: 2560, height: 1440, devicePixelRatio: 1, maxTextureSize: 4096, qualityProfile: graphicsQualityProfiles.low };
  assert.ok(calculateEffectiveGraphicsDpr(input) < 1);
  assert.equal(calculateEffectiveGraphicsDpr({ ...input, minimumDpr: 1 }), 1);
  assert.equal(calculateEffectiveGraphicsDpr({ ...input, minimumDpr: 1, adaptiveTier: 3 }), 1);
  assert.ok(calculateEffectiveGraphicsDpr({ ...input, minimumDpr: 1, maxTextureSize: 1024 }) <= 0.4);
});

test("label overlay preserves the composed graph and restores camera state even on a draw failure", () => {
  const camera = new PerspectiveCamera();
  const scene = new Scene();
  const initialMask = camera.layers.mask;
  let fail = false;
  const renderer = {
    autoClear: true,
    render(actualScene, actualCamera) {
      assert.equal(actualScene, scene);
      assert.equal(actualCamera, camera);
      assert.equal(camera.layers.mask, 1 << GRAPH_LABEL_LAYER);
      assert.equal(this.autoClear, false);
      if (fail) throw new Error("context lost");
    },
  };
  renderGraphLabels(renderer, scene, camera);
  assert.equal(camera.layers.mask, initialMask);
  assert.equal(renderer.autoClear, true);
  fail = true;
  assert.throws(() => renderGraphLabels(renderer, scene, camera), /context lost/);
  assert.equal(camera.layers.mask, initialMask);
  assert.equal(renderer.autoClear, true);
});

test("label atlas draws at the requested pixel size without squeezing or decorating long text", () => {
  const draws = [];
  const context = {
    save() {}, restore() {}, clearRect() {},
    measureText(text) { return { width: Array.from(text).length * Number.parseFloat(this.font.slice(4)) }; },
    fillText(...args) { draws.push({ font: this.font, args }); },
    strokeText() { assert.fail("labels must not have an outline"); },
  };
  const canvas = { getContext: () => context };
  const atlas = createGraphLabelAtlas(["服装行业知识地图", "这是一条非常长的服装行业知识图谱节点标题"], () => canvas, 24);
  assert.equal(atlas.layout.fontSize, 24);
  assert.match(draws[0].font, /^400 24px /);
  assert.equal(draws[0].args[0], "服装行业知识地图");
  assert.ok(draws[1].args[0].endsWith("…"));
  assert.equal(draws[1].args.length, 3, "no maxWidth parameter that horizontally rescales glyphs");
  assert.ok(context.measureText(atlas.entries[1].text).width <= atlas.layout.cellWidth - atlas.layout.padding * 2);
  atlas.update(1, "悬停节点");
  assert.equal(atlas.entries[1].text, "悬停节点");
  atlas.dispose();
  assert.equal(canvas.width, 1);
  assert.equal(atlas.update(1, "已释放"), null);
});
