import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GRAPH_FX_PROFILES,
  getGraphFxSettingValue,
  normalizeGraphFxProfiles,
  withGraphFxProfileSetting,
} from "../src/graphics/graph/graph-fx-profile.js";

test("graph FX profiles are canonical, deeply frozen, and restore the 3D Relation Halo", () => {
  const profiles = normalizeGraphFxProfiles({
    "2d": {
      edge: { halo: { enabled: true, opacity: -1 } },
      unknownLayer: { enabled: true },
    },
    "3d": {
      edge: { halo: { enabled: true, opacity: 9 } },
      orb: { rim: { fresnelPower: 99 } },
      script: "not retained",
    },
  });

  assert.equal(profiles["2d"].edge.halo.enabled, true);
  assert.equal(profiles["2d"].edge.halo.opacity, 0);
  assert.equal(profiles["3d"].edge.halo.enabled, true);
  assert.equal(profiles["3d"].edge.halo.opacity, 1);
  assert.equal(profiles["3d"].orb.rim.fresnelPower, 10);
  assert.equal(Object.hasOwn(profiles["2d"], "unknownLayer"), false);
  assert.equal(Object.hasOwn(profiles["3d"], "script"), false);
  assert.equal(Object.isFrozen(profiles), true);
  assert.equal(Object.isFrozen(profiles["3d"]), true);
  assert.equal(Object.isFrozen(profiles["3d"].edge), true);
  assert.equal(Object.isFrozen(profiles["3d"].edge.halo), true);
});

test("canonical profile updates are isolated by dimension and keep unsupported paths closed", () => {
  const twoDimensionalBefore = DEFAULT_GRAPH_FX_PROFILES["2d"];
  const updated = withGraphFxProfileSetting(
    DEFAULT_GRAPH_FX_PROFILES,
    "3d",
    "edge.halo.opacity",
    0.29,
  );
  const unsupported = withGraphFxProfileSetting(
    updated,
    "2d",
    "orb.rim.enabled",
    false,
  );

  assert.deepEqual(updated["2d"], twoDimensionalBefore);
  assert.equal(getGraphFxSettingValue(updated["3d"], "edge.halo.opacity"), 0.29);
  assert.equal(updated["3d"].edge.halo.enabled, true);
  assert.deepEqual(unsupported, updated);
  assert.equal(Object.hasOwn(unsupported["2d"], "orb"), false);
});
