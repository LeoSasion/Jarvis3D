# 神经元球体与大脑形态草图

2026-09-10。按用户要求分别生成两张形态探索图片。本次只生成概念图，未修改运行代码。

使用内置 ImageGen 工具，分别调用一次。风格输入为此前生成的 [3D 神经元纵深参考](3d-neuron-depth-concept.png)；生成结果保留黑色 HUD、橙白发光节点与细枝条。文字要求清晰、无发光或阴影。

- [神经元球体](3d-neuron-sphere-concept.png)：多个神经元围成通透球面，内部存在跨层连接。
- [神经元大脑](3d-neuron-brain-concept.png)：神经元分枝构成脑回、沟壑和立体脑形。

两张图已逐张检查：主体形态可辨、具有前后层次，发光局限于节点和连线。球体强调通透和完整轮廓；大脑强调脑形辨识度与皮层细节。关系与结构均为视觉示意。

## 球体实现与共用参数

用户随后选定球体作为退出探索后的待机效果，并要求先尝试三种状态共用特效。已使用实时几何实现：当前 808 个来源笔记组成 14 个球面神经元簇、821 条装饰连接，曲线沿球面生长并少量穿过内部；进入探索后仍使用来源关系。

“共用神经元样式”连接 2D、3D、待机的节点、连线、信号和 Bloom 设置。首次启用前保存“启用共用神经元样式前”备份。布局、标签与相机保持各视图独立；待机球体另外提供大小、球面分枝展开、轴突弯曲及原有密度、表层比例、远近明暗。旧内层旋转网不参与新球体，面板隐藏其无效控件。

球体没有使用概念图作为贴图，没有改写知识库。保留真实桌面控件，概念图中的标题和示意说明不加入待机桌面。浏览器验收见 [design-qa.md](../../../frontend/design-qa.md)。

用户随后要求球体与 3D 一起研究连线粗细和透明质感。已接入共用的收尖、根部增粗、圆润高光和通透度，详见[共用枝条材质](neuron-filament-notes.md)。

## 球体最终提示词

```text
Use case: stylized-concept.
Asset type: one polished Jarvis 3D neural visualization concept, wide 16:9.
Input image 1 is a STYLE AND HUD reference, not the requested subject geometry. Reuse its restrained black desktop HUD frame, fine separators, top JARVIS bar, narrow right tool rail, bottom taskbar, warm orange/amber filaments and small white-hot neuron cores. Replace the central visualization completely with the subject specified below.
Rendering: visibly three-dimensional, rich near/middle/far depth, branching dendrites, curved interwoven axons, hundreds of differentiated tiny synapses, perspective foreshortening. Dark gaps let the viewer see the interior. A few stronger hot junctions among fine branches, energy concentrated locally on tiny cores and filament edges. Fine emissive lines remain legible, foreground clean and crisp, rear network darker and finer. The effect should feel energetic and alive while the black background stays black.
Typography: all HUD and title text is sharp flat white or restrained orange, no text glow, outline, shadow or blur. Keep functional chrome understated and approximate the reference; no added data panels or node labels.
Avoid: broad circular halos, a luminous fog disk, continuous neon rim, washed-out center, all-to-all straight-line hairball, fleshy tubes, glass or metallic solid surface, blue/cyan/purple, extraneous objects, watermarks.
Primary request: 神经元围成球体 — individual branching neurons arranged into a hollow, porous spherical volume.
Composition: one complete suspended sphere, centered in the usable canvas and comfortably inside the HUD, occupying about 68% of usable canvas height. View slightly from above in three-quarter perspective. Build the sphere from roughly 12–18 recognizable neuron bodies distributed around its front, sides, and back. Each body has a white-hot soma and many delicate branching dendrites following the sphere's curved surface and reaching neighboring neurons. Their branching crowns link into a spherical neural lattice. Several long axons cross the interior at different depths, with visible black openings and darker rear branches. This must read as a sphere assembled from neurons, not a plain particle sphere, not a radial sunburst, and not a central neuron with straight spokes. No opaque shell; the silhouette is formed only by discontinuous branches and points. Convey roundness through overlap, foreshortening and graded brightness rather than a large glow.
Top-left title (exact): "神经元球体"
Small subtitle (exact): "球面分枝 · 内部交织"
Bottom-left small caption (exact): "3D 概念草图 · 关系示意"
```

## 大脑最终提示词

```text
Use case: stylized-concept.
Asset type: one polished Jarvis 3D neural visualization concept, wide 16:9.
Input image 1 is a STYLE AND HUD reference, not the requested subject geometry. Reuse its restrained black desktop HUD frame, fine separators, top JARVIS bar, narrow right tool rail, bottom taskbar, warm orange/amber filaments and small white-hot neuron cores. Replace the central visualization completely with the subject specified below.
Rendering: visibly three-dimensional, rich near/middle/far depth, branching dendrites, curved interwoven axons, hundreds of differentiated tiny synapses, perspective foreshortening. Dark gaps let the viewer see the interior. A few stronger hot junctions among fine branches, energy concentrated locally on tiny cores and filament edges. Fine emissive lines remain legible, foreground clean and crisp, rear network darker and finer. The effect should feel energetic and alive while the black background stays black.
Typography: all HUD and title text is sharp flat white or restrained orange, no text glow, outline, shadow or blur. Keep functional chrome understated and approximate the reference; no added data panels or node labels.
Avoid: broad circular halos, a luminous fog disk, continuous neon rim, washed-out center, all-to-all straight-line hairball, fleshy tubes, glass or metallic solid surface, blue/cyan/purple, extraneous objects, watermarks.
Primary request: a 3D human brain built entirely from neurons and their connections — 3D 大脑（神经元）.
Composition: one complete suspended brain, centered in the usable canvas, generous black negative space, occupying about 68% of usable canvas height. A clear elevated three-quarter lateral/front view reveals the volume of both cerebral hemispheres, the dividing longitudinal fissure, curved cortical folds and rounded frontal/temporal/occipital lobes. The recognizable human-brain silhouette and folded structure must emerge entirely from intertwined branching neurons, tiny white-hot somas and thin warm orange axons. No solid tissue mesh or smooth brain surface under the network. Branches follow and bridge the cortical gyri, with darker sulci as genuine depth valleys, and a few long connections traversing the interior. Small near clusters sit in front of recessed dimmer networks. Clear layered volume and meaningful interweaving, open but sufficiently connected to read immediately as a brain, not a random cloud or a sphere. Keep the overall outline coherent without drawing an outline stroke. Fine neural details and energy, no gross anatomy, no skull or body.
Top-left title (exact): "神经元大脑"
Small subtitle (exact): "皮层分枝 · 纵深连接"
Bottom-left small caption (exact): "3D 概念草图 · 关系示意"
```
