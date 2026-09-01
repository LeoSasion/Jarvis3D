import assert from "node:assert/strict";
import test from "node:test";
import {
  graphVisualProfileLibraryPolicy,
  normalizeGraphVisualProfileDocument,
  serializeGraphVisualProfileDocument,
} from "../src/graph/graph-visual-profile-library.js";
import { withGraphFxProfileSetting } from "../src/graphics/graph/graph-fx-profile.js";
import { DEFAULT_GRAPH_VISUAL_SETTINGS } from "../src/graphics/graph/graph-visual-settings.js";

test("graph visual profile documents are versioned and settings are bounded", () => {
  const documentValue = normalizeGraphVisualProfileDocument({
    version: 1,
    profiles: [{
      id: "profile-a",
      label: "My 3D graph",
      scope: "Vault",
      settings: {
        ...DEFAULT_GRAPH_VISUAL_SETTINGS,
        view: { dimension: 3 },
        node: { ...DEFAULT_GRAPH_VISUAL_SETTINGS.node, scale: 99 },
      },
    }],
  });
  assert.equal(documentValue.profiles[0].settings.view.dimension, 3);
  assert.equal(documentValue.profiles[0].settings.node.scale, 2.5);
  assert.equal(documentValue.profiles[0].settings.version, 6);
  assert.equal(documentValue.profiles[0].settings.profiles["3d"].edge.halo.enabled, true);
});

test("graph visual profile export round trips without executable fields", () => {
  const profiles = withGraphFxProfileSetting(
    DEFAULT_GRAPH_VISUAL_SETTINGS.profiles,
    "3d",
    "edge.halo.opacity",
    0.33,
  );
  const serialized = serializeGraphVisualProfileDocument([{
    id: "profile-a",
    label: "Quiet",
    scope: "global",
    settings: {
      ...DEFAULT_GRAPH_VISUAL_SETTINGS,
      profiles: {
        ...profiles,
        "3d": {
          ...profiles["3d"],
          script: "alert('not executable')",
        },
      },
    },
  }]);
  const parsed = normalizeGraphVisualProfileDocument(JSON.parse(serialized));
  assert.equal(parsed.profiles[0].label, "Quiet");
  assert.equal(Object.hasOwn(parsed.profiles[0], "script"), false);
  assert.equal(parsed.profiles[0].settings.profiles["3d"].edge.halo.opacity, 0.33);
  assert.equal(Object.hasOwn(parsed.profiles[0].settings.profiles["3d"], "script"), false);
  assert.equal(Object.isFrozen(parsed.profiles[0].settings.profiles["3d"].edge.halo), true);
});

test("profile documents import v5 Orb controls as v6 3D FX", () => {
  const documentValue = normalizeGraphVisualProfileDocument({
    version: 1,
    profiles: [{
      id: "legacy-v5",
      label: "Legacy Orb",
      settings: {
        ...DEFAULT_GRAPH_VISUAL_SETTINGS,
        version: 5,
        orb: {
          bloomIntensity: 2.15,
          bloomThreshold: 0.2,
          bloomSmoothing: 0.44,
          bloomRadius: 0.9,
          lineOpacity: 0.71,
          lineWidth: 1.24,
          lineHalo: false,
          lineHaloRadius: 1.18,
          lineHaloOpacity: 0.41,
          lineHaloFalloff: 1.8,
          nodeSize: 1.1,
          nodeHalo: 0.8,
          nodePulse: 1.2,
        },
      },
    }],
  });
  const settings = documentValue.profiles[0].settings;

  assert.equal(settings.version, 6);
  assert.equal(settings.profiles["3d"].postFx.bloom.intensity, 2.15);
  assert.equal(settings.profiles["3d"].edge.core.widthScale, 1.24);
  assert.equal(settings.profiles["3d"].edge.halo.enabled, true);
  assert.equal(settings.profiles["3d"].edge.halo.opacity, 0.41);
});

test("graph visual profile imports remain bounded", () => {
  const documentValue = normalizeGraphVisualProfileDocument({
    version: 1,
    profiles: Array.from({ length: graphVisualProfileLibraryPolicy.maximumProfiles + 5 }, (_, index) => ({
      id: `profile-${index}`,
      label: `Profile ${index}`,
      settings: DEFAULT_GRAPH_VISUAL_SETTINGS,
    })),
  });
  assert.equal(documentValue.profiles.length, graphVisualProfileLibraryPolicy.maximumProfiles);
});
