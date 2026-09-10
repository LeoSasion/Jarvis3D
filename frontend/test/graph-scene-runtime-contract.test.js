import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const graphSceneUrl = new URL("../src/graphics/graph/GraphScene.jsx", import.meta.url);
const graphVisualSettingsUrl = new URL(
  "../src/graphics/graph/GraphVisualSettings.jsx",
  import.meta.url,
);

test("label atlas disposal follows atlas identity instead of hover-dependent font work", async () => {
  const source = await readFile(graphSceneUrl, "utf8");
  const disposeCalls = source.match(/labelAtlas\?\.dispose\(\)/gu) ?? [];

  assert.equal(disposeCalls.length, 1);
  assert.match(
    source,
    /labelAtlas\?\.dispose\(\)[\s\S]*?\}, \[labelAtlas\]\);/u,
  );
  assert.doesNotMatch(
    source,
    /return \(\) => \{\s*active = false;\s*labelAtlas\?*\.dispose\(\);/u,
  );
});

test("graph interaction stays in the shared demand frame and bypasses mesh raycasting", async () => {
  const source = await readFile(graphSceneUrl, "utf8");

  assert.match(source, /createGraphPointerQueue/u);
  assert.match(source, /createGraphScreenIndex/u);
  assert.match(source, /applyGraphRuntimeQuality/u);
  assert.match(source, /pointerQueue\.consume\(\)/u);
  assert.match(source, /raycast=\{\(\) => null\}/u);
  assert.doesNotMatch(source, /requestAnimationFrame/u);
  assert.doesNotMatch(source, /onPointerMove=\{handleNodeHover\}/u);
});

test("2D and 3D presentation changes preserve morph progress instead of snapping", async () => {
  const source = await readFile(graphSceneUrl, "utf8");

  assert.match(
    source,
    /const presentationTargetRef = useRef\(presentationTarget\);/u,
  );
  assert.match(
    source,
    /morphProgressRef\.current = presentationTargetRef\.current;/u,
  );
  assert.match(source, /GRAPH_MORPH_DURATION_SECONDS = 1\.28/u);
  assert.match(source, /DIMENSION_MORPH_DURATION_SECONDS = 0\.72/u);
  assert.match(source, /createGraphPlanarMorphModel/u);
  assert.match(source, /const presentationTarget = presentation === "graph" \? 1 : 0;/u);
  assert.match(
    source,
    /const next = current \+ direction \* frameDelta \/ GRAPH_MORPH_DURATION_SECONDS;/u,
  );
  assert.match(source, /const transitionEnergy = Math\.sin\(progress \* Math\.PI\);/u);
  assert.match(source, /Math\.pow\(1 - progress, 1\.65\)/u);
  assert.match(source, /GRAPH_ORB_RIM_VERTEX_SHADER/u);
  assert.match(source, /innerShellEdgeMaterialRef/u);
  assert.match(source, /createOrbAmbientField/u);
  assert.match(source, /attributes-pointPhase/u);
  assert.match(source, /nodeEnergyMaterial\.uniforms\.energyTime\.value = elapsed/u);
});

test("3D idle energy preserves orange hierarchy through separate Core and Halo layers", async () => {
  const source = await readFile(graphSceneUrl, "utf8");

  assert.match(source, /function createNodeEnergyStyle/u);
  assert.match(source, /function createEdgeEnergyStyle/u);
  assert.match(source, /function resolveMoltenOrangeColor/u);
  assert.match(source, /model\.degrees\[index\]/u);
  assert.match(source, /model\.hubMask\[index\]/u);
  assert.match(source, /attributes-pointColor/u);
  assert.match(source, /attributes-pointHierarchy/u);
  assert.match(source, /attributes-edgeWidth/u);
  assert.match(source, /attributes-edgeEnergy/u);
  assert.match(source, /uniform float lineCoreEmissionIntensity/u);
  assert.match(source, /uniform float lineCoreVisibility/u);
  assert.match(source, /uniform float lineHaloEmissionIntensity/u);
  assert.match(source, /uniform float lineHaloVisibility/u);
  assert.match(source, /lineCoreVisibility\.value = Number\(fx3d\.edge\.core\.enabled\)/u);
  assert.match(source, /lineHaloVisibility\.value = Number\(fx3d\.edge\.halo\.enabled\)/u);
  assert.match(source, /lineHaloRadiusScale[\s\S]*\* lineHaloVisibility/u);
  assert.match(source, /pointColorVariation\.value = neuronMode \? 1 : threeDEnergyWeight/u);
  assert.match(source, /pointCoreEmissionIntensity\.value = fx3d\.node\.core\.emissionIntensity/u);
  assert.match(source, /pointHaloEmissionIntensity\.value = fx3d\.node\.halo\.emissionIntensity/u);
  assert.match(source, /pointCoreVisibility\.value = Number\(fx3d\.node\.core\.enabled/u);
  assert.match(source, /pointHaloVisibility\.value = Number\(fx3d\.node\.halo\.enabled/u);
  assert.match(source, /const configuredCoreOpacity = fx3d\.node\.core\.enabled/u);
  assert.match(source, /const configuredHaloOpacity = fx3d\.node\.halo\.enabled/u);
  assert.match(source, /const orbLineWeight = dimensionProgress/u);
  assert.match(source, /nodeEnergyMaterial\.uniforms\.orbStyle\.value = neuronMode \? 1 : threeDEnergyWeight/u);
  assert.match(source, /const graphPointSize = sharedStyle \|\| spatialNeuron \? 9 : dimension === 3 \? idlePointSize : neuronMode \? 14 : 13\.2/u);
  assert.match(source, /pointLayering\.value = neuronSphere \? 0 : orbEnergyWeight/u);
  assert.match(source, /pointAbsoluteLayer\.value = neuronSphere \? idleWeight : 0/u);
  assert.match(source, /EDGE_ORB_SOURCE_COLOR\.fromArray\(edgeEnergyStyle\.sourceColors/u);
  assert.match(source, /widths\[index\] = 0\.48 \+ Math\.pow\(strength, 1\.55\) \* 0\.88/u);
  assert.match(source, /mix\(1\.0, 1\.26, hierarchy\)/u);
  assert.match(
    source,
    /energyLineObjectRef\.current\.visible = energyLineVisibility > 0\.002[\s\S]*fx3d\.edge\.core\.enabled \|\| fx3d\.edge\.halo\.enabled/u,
  );
  assert.doesNotMatch(source, /ENERGY_LINE_HALO_VISIBLE|lineGlowScale|scenePlan\.orb/u);
  assert.doesNotMatch(source, /color\.multiplyScalar\(0\.48 \+ energy \* 0\.48\)/u);
  assert.doesNotMatch(source, /\.lerp\(palette\.base, orbCoreGain\)/u);
});

test("Node Pulse and Relation Halo retain independent visible energy contributions", async () => {
  const [source, settingsSource] = await Promise.all([
    readFile(graphSceneUrl, "utf8"),
    readFile(graphVisualSettingsUrl, "utf8"),
  ]);

  assert.match(source, /uniform float pointPulseVisibility/u);
  assert.match(source, /const energyLineUniforms = energyLineMaterial\.uniforms/u);
  assert.match(source, /<primitive attach="material" object=\{energyLineMaterial\} \/>/u);
  assert.doesNotMatch(source, /<shaderMaterial[\s\S]*uniforms=\{energyLineUniforms\}/u);
  assert.match(source, /energyLineDistance = side/u);
  assert.match(source, /float lineDistance = abs\(energyLineDistance\)/u);
  assert.doesNotMatch(source, /energyLineDistance = abs\(side\)/u);
  assert.match(source, /float pulseAlpha = pulseRing[\s\S]*pointPulseVisibility/u);
  assert.match(source, /min\(1\.0, baseAlpha \+ pulseAlpha\)/u);
  assert.match(
    source,
    /pointPulseVisibility\.value = Number\([\s\S]*fx3d\.node\.pulse\.enabled[\s\S]*fx3d\.node\.master\.opacity/u,
  );
  assert.match(source, /const threeDEnergyWeight = sharedStyle \? 1 : dimensionProgress/u);
  assert.match(source, /const energyLineVisibility = 1 - transitionEnergy \* 0\.12/u);
  assert.match(source, /uniform vec3 lineHaloColor/u);
  assert.match(source, /float haloPixels = \(2\.4 \+ haloStrength \* 6\.8\)/u);
  assert.match(source, /mix\(0\.22, 1\.0, pow\(strength, 1\.3\)\)/u);
  assert.match(
    settingsSource,
    /path="node\.pulse\.amount"[\s\S]*disabled=\{!activeProfile\.node\.pulse\.enabled\}/u,
  );
  assert.doesNotMatch(
    settingsSource,
    /node\.pulse\.amount"[\s\S]{0,300}disabled=\{!activeProfile\.node\.core\.enabled/u,
  );
});

test("Orb Rim and Ambient Sparks retain independent visible energy contributions", async () => {
  const [source, settingsSource] = await Promise.all([
    readFile(graphSceneUrl, "utf8"),
    readFile(graphVisualSettingsUrl, "utf8"),
  ]);

  assert.match(source, /const orbRimUniforms = orbRimMaterial\.uniforms/u);
  assert.match(source, /<primitive attach="material" object=\{orbRimMaterial\} \/>/u);
  assert.match(source, /orbRimMaterial\.dispose\(\)/u);
  assert.doesNotMatch(source, /<shaderMaterial[\s\S]*uniforms=\{orbRimUniforms\}/u);
  assert.match(source, /float broadRim = pow/u);
  assert.match(source, /float tightRim = pow/u);
  assert.match(source, /rimIntensity\.value = fx3d\.orb\.rim\.intensity[\s\S]*orbEnergyWeight/u);
  assert.match(source, /\? 64[\s\S]*\? 32 : 48/u);
  assert.match(source, /hierarchy\[index\] = 0\.26[\s\S]*scaleEnergy/u);
  assert.doesNotMatch(source, /new Float32Array\(orbAmbientCount\)\.fill\(0\.24\)/u);
  assert.match(
    source,
    /ambientEnergyMaterial\.uniforms\.pointPulseVisibility\.value = Number\([\s\S]*fx3d\.orb\.sparks\.enabled[\s\S]*orbEnergyWeight/u,
  );
  assert.match(source, /ambientEnergyMaterial\.uniforms\.pulseAmount\.value = reducedMotion[\s\S]*0\.64 \* orbEnergyWeight/u);
  assert.match(
    settingsSource,
    /path="orb\.rim\.intensity"[\s\S]{0,350}disabled=\{!activeProfile\.orb\.rim\.enabled\}/u,
  );
  assert.match(
    settingsSource,
    /path="orb\.sparks\.opacity"[\s\S]{0,350}disabled=\{!activeProfile\.orb\.sparks\.enabled\}/u,
  );
});

test("the 3D profile revision drives every independently visible idle layer", async () => {
  const source = await readFile(graphSceneUrl, "utf8");

  assert.match(source, /scenePlan\.profiles\[`\$\{dimension\}d`\]/u);
  assert.match(source, /const profile3dRef = useRef\(profile3d\);/u);
  assert.match(source, /profile3dRef\.current = profile3d;/u);
  assert.match(source, /const fxRevisionKey = JSON\.stringify\(profile3d\);/u);
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{[\s\S]*signalGeometryRef\.current\?\.setDrawRange[\s\S]*applyPresentationPositionsRef\.current[\s\S]*fxRevisionKey,/u,
  );
  assert.match(source, /innerShellEdgeObjectRef\.current\.visible = !neuronSphere && fx3d\.orb\.innerNetwork\.enabled/u);
  assert.match(source, /orbAmbientRef\.current\.visible = fx3d\.orb\.sparks\.enabled/u);
  assert.match(source, /orbRimRef\.current\.visible = fx3d\.orb\.rim\.enabled/u);
  assert.match(
    source,
    /profile3d\.signal\.enabled && profile3d\.signal\.count > 0/u,
  );
  assert.match(source, /const signalLayerActive = isGraphSignalLayerActive\(\{/u);
  assert.match(source, /signalCount: fx3d\.signal\.count/u);
  assert.match(source, /signalEnabled: fx3d\.signal\.enabled/u);
  assert.match(source, /rimFresnelPower\.value = fx3d\.orb\.rim\.fresnelPower/u);
  assert.match(source, /pointOpacity\.value = fx3d\.signal\.opacity/u);
});
