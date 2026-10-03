import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  MathUtils,
  Spherical,
  Vector3,
} from "three";
import { useLanguage } from "../../i18n/language-system.js";
import { getGraphCameraZoom } from "../graphics-runtime-policy.js";
import { useGraphicsRuntimeContext } from "../runtime/runtime-context.js";

import { graphWheelDepth, graphWheelPixels, graphWheelZoom } from "./graph-camera-input.js";
import { consumePendingGraphFocus, shouldApplyGraphCameraCommand } from "./graph-camera-command.js";
import { getGraphPlanarCameraTarget, getGraphVisibleViewport, measureGraphViewportInsets } from "./graph-camera-viewport.js";

const MIN_POLAR_ANGLE = 0.12;
const MAX_POLAR_ANGLE = Math.PI - 0.12;
const PAN_STEP = 42;

function readBounds(positions, dimension) {
  if (!(positions instanceof Float32Array) || positions.length < 3) return null;
  const minimum = new Vector3(Infinity, Infinity, Infinity);
  const maximum = new Vector3(-Infinity, -Infinity, -Infinity);
  for (let offset = 0; offset < positions.length; offset += 3) {
    minimum.x = Math.min(minimum.x, positions[offset]);
    minimum.y = Math.min(minimum.y, positions[offset + 1]);
    minimum.z = Math.min(minimum.z, dimension === 3 ? positions[offset + 2] : 0);
    maximum.x = Math.max(maximum.x, positions[offset]);
    maximum.y = Math.max(maximum.y, positions[offset + 1]);
    maximum.z = Math.max(maximum.z, dimension === 3 ? positions[offset + 2] : 0);
  }
  if (!Number.isFinite(minimum.x)) return null;
  return {
    center: minimum.clone().add(maximum).multiplyScalar(0.5),
    size: maximum.clone().sub(minimum),
  };
}

function copyView(camera, target) {
  return {
    position: camera.position.clone(),
    target: target.clone(),
    zoom: camera.zoom,
  };
}

export function GraphCameraNavigation({
  command = null,
  dimension = 2,
  getNodePosition,
  getPositions,
  interactive = false,
  layoutReady = false,
  frozen = false,
  reducedMotion = false,
  zoom = 1,
  onCommandConsumed,
  onViewChange,
}) {
  const { t } = useLanguage();
  const runtime = useGraphicsRuntimeContext();
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);
  const targetRef = useMemo(() => {
    camera.userData.graphTarget ??= new Vector3();
    return { current: camera.userData.graphTarget };
  }, [camera]);
  const viewChangeRef = useRef(onViewChange);
  viewChangeRef.current = onViewChange;
  const publishView = useCallback(() => {
    if (Boolean(camera.isPerspectiveCamera) !== (dimension === 3)) return;
    const view = {
      dimension,
      zoom: camera.zoom / getGraphCameraZoom(1, size.width, size.height),
      depth: camera.position.z,
    };
    Object.assign(gl.domElement.dataset, {
      cameraX: String(camera.position.x), cameraY: String(camera.position.y),
      cameraZ: String(camera.position.z), cameraZoom: String(camera.zoom),
    });
    viewChangeRef.current?.(view);
  }, [camera, dimension, gl, size.width, size.height]);
  const scratchRef = useRef({
    offset: new Vector3(),
    right: new Vector3(),
    spherical: new Spherical(),
    up: new Vector3(),
  });
  const tweenRef = useRef(null);
  const dragRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const lastCommandIdRef = useRef(camera.userData.graphLastCommandId ?? null);
  const consumeCommand = useCallback((id) => {
    lastCommandIdRef.current = id;
    camera.userData.graphLastCommandId = id;
    onCommandConsumed?.(id);
  }, [camera, onCommandConsumed]);
  const cancelPendingFocus = useCallback(() => {
    const consumedId = consumePendingGraphFocus(command, lastCommandIdRef.current, dimension);
    if (consumedId !== lastCommandIdRef.current) consumeCommand(consumedId);
  }, [command, consumeCommand, dimension]);
  useEffect(() => {
    if (frozen) { tweenRef.current = null; dragRef.current = null; }
  }, [frozen]);

  const applyView = useCallback((nextView, animate = true) => {
    const duration = reducedMotion || !animate ? 0 : 0.22;
    if (duration === 0) {
      camera.position.copy(nextView.position);
      targetRef.current.copy(nextView.target);
      camera.zoom = nextView.zoom;
      camera.lookAt(targetRef.current);
      camera.updateProjectionMatrix();
      tweenRef.current = null;
      invalidate();
      publishView();
      return;
    }
    tweenRef.current = {
      elapsed: 0,
      duration,
      from: copyView(camera, targetRef.current),
      to: nextView,
    };
    invalidate();
  }, [camera, invalidate, publishView, reducedMotion]);

  const fitGraph = useCallback((animate = true) => {
    const bounds = readBounds(getPositions?.(), dimension);
    if (!bounds) return;
    const visible = getGraphVisibleViewport(size.width, size.height, measureGraphViewportInsets(gl.domElement));
    const padding = dimension === 3 ? 1.34 : 1.2;
    if (camera.isOrthographicCamera) {
      const spanX = Math.max(80, bounds.size.x * padding);
      const spanY = Math.max(80, bounds.size.y * padding);
      const baseZoom = getGraphCameraZoom(1, size.width, size.height);
      const fitZoom = Math.max(0.1 * baseZoom, Math.min(8 * baseZoom, visible.width / spanX, visible.height / spanY));
      const { x: centerX, y: centerY } = getGraphPlanarCameraTarget(bounds.center, fitZoom, visible);
      applyView({
        position: new Vector3(centerX, centerY, 700),
        target: new Vector3(centerX, centerY, 0),
        zoom: fitZoom,
      }, animate);
      return;
    }
    const radius = Math.max(80, bounds.size.length() * 0.5);
    const verticalHalfFov = MathUtils.degToRad(camera.fov) * 0.5;
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * size.width / Math.max(1, size.height));
    const distance = Math.min(
      3_200,
      Math.max(180, radius * padding * Math.max(
        size.height / (visible.height * Math.tan(verticalHalfFov)),
        size.width / (visible.width * Math.tan(horizontalHalfFov)),
      )),
    );
    const direction = camera.position.clone().sub(targetRef.current);
    if (direction.lengthSq() < 0.001) direction.set(0.34, 0.24, 1);
    direction.normalize();
    const worldPerPixel = 2 * distance * Math.tan(verticalHalfFov) / Math.max(1, size.height);
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const target = bounds.center.clone()
      .addScaledVector(right, -visible.offsetX * worldPerPixel)
      .addScaledVector(up, visible.offsetY * worldPerPixel);
    applyView({
      position: target.clone().addScaledVector(direction, distance),
      target,
      zoom: 1,
    }, animate);
  }, [applyView, camera, dimension, getPositions, gl.domElement, size.height, size.width]);

  const focusNode = useCallback((nodeId) => {
    const point = getNodePosition?.(nodeId);
    if (!point) return false;
    const visible = getGraphVisibleViewport(size.width, size.height, measureGraphViewportInsets(gl.domElement));
    if (camera.isOrthographicCamera) {
      const { x, y } = getGraphPlanarCameraTarget(point, camera.zoom, visible);
      applyView({
        position: new Vector3(x, y, camera.position.z),
        target: new Vector3(x, y, 0),
        zoom: camera.zoom,
      });
    } else {
      const direction = camera.position.clone().sub(targetRef.current);
      const distance = Math.max(80, direction.length());
      direction.normalize();
      const worldPerPixel = 2 * distance * Math.tan(MathUtils.degToRad(camera.fov) * 0.5)
        / Math.max(1, size.height);
      const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const target = new Vector3(point.x, point.y, point.z)
        .addScaledVector(right, -visible.offsetX * worldPerPixel)
        .addScaledVector(up, visible.offsetY * worldPerPixel);
      applyView({ position: target.clone().addScaledVector(direction, distance), target, zoom: camera.zoom });
    }
    return true;
  }, [applyView, camera, getNodePosition, gl.domElement, size.height, size.width, targetRef]);

  const resetGraph = useCallback((animate = true) => {
    applyView({
      position: new Vector3(0, 0, dimension === 3 ? 720 : 700),
      target: new Vector3(),
      zoom: dimension === 3 ? 1 : getGraphCameraZoom(zoom, size.width, size.height),
    }, animate);
  }, [applyView, dimension, size.height, size.width, zoom]);

  const panBy = useCallback((horizontal, vertical) => {
    const scratch = scratchRef.current;
    if (camera.isOrthographicCamera) {
      scratch.offset.set(
        horizontal / Math.max(0.01, camera.zoom),
        vertical / Math.max(0.01, camera.zoom),
        0,
      );
      camera.position.add(scratch.offset);
      targetRef.current.add(scratch.offset);
    } else {
      const distance = Math.max(120, camera.position.distanceTo(targetRef.current));
      const factor = distance / Math.max(320, size.height);
      const elements = camera.matrixWorld.elements;
      scratch.right.set(elements[0], elements[1], elements[2]);
      scratch.up.set(elements[4], elements[5], elements[6]);
      scratch.offset.copy(scratch.right).multiplyScalar(horizontal * factor)
        .add(scratch.up.multiplyScalar(vertical * factor));
      camera.position.add(scratch.offset);
      targetRef.current.add(scratch.offset);
    }
    camera.lookAt(targetRef.current);
    camera.updateMatrixWorld();
    invalidate();
  }, [camera, invalidate, size.height]);

  const orbitBy = useCallback((horizontal, vertical) => {
    if (dimension !== 3 || camera.isOrthographicCamera) return;
    const scratch = scratchRef.current;
    scratch.offset.copy(camera.position).sub(targetRef.current);
    scratch.spherical.setFromVector3(scratch.offset);
    scratch.spherical.theta -= horizontal;
    scratch.spherical.phi = MathUtils.clamp(
      scratch.spherical.phi - vertical,
      MIN_POLAR_ANGLE,
      MAX_POLAR_ANGLE,
    );
    camera.position.copy(targetRef.current).add(
      scratch.offset.setFromSpherical(scratch.spherical),
    );
    camera.lookAt(targetRef.current);
    camera.updateMatrixWorld();
    invalidate();
  }, [camera, dimension, invalidate]);

  const navigateWheel = useCallback((pixels) => {
    if (!pixels) return;
    tweenRef.current = null;
    if (dimension === 2) {
      const baseZoom = getGraphCameraZoom(1, size.width, size.height);
      camera.zoom = graphWheelZoom(camera.zoom / baseZoom, pixels) * baseZoom;
      camera.updateProjectionMatrix();
    } else {
      const distance = camera.position.distanceTo(targetRef.current);
      // Dolly along the camera's local Z axis; perspective zoom/FOV stay unchanged.
      camera.translateZ(graphWheelDepth(distance, pixels) - distance);
      camera.updateMatrixWorld();
    }
    invalidate();
    publishView();
  }, [camera, dimension, invalidate, publishView, size.width, size.height, targetRef]);

  useEffect(() => { publishView(); }, [publishView]);

  useEffect(() => {
    if (!command || frozen) return;
    if (!shouldApplyGraphCameraCommand(command, lastCommandIdRef.current, dimension, layoutReady)) return;
    if (command.type === "focus-node") {
      if (focusNode(command.nodeId)) {
        consumeCommand(command.id);
      }
      return;
    }
    consumeCommand(command.id);
    if (command.type === "dolly-in") navigateWheel(-60);
    if (command.type === "dolly-out") navigateWheel(60);
    if (command.type === "fit") fitGraph();
    if (command.type === "reset") resetGraph();
    if (command.type === "pan-left") panBy(PAN_STEP, 0);
    if (command.type === "pan-right") panBy(-PAN_STEP, 0);
    if (command.type === "pan-up") panBy(0, -PAN_STEP);
    if (command.type === "pan-down") panBy(0, PAN_STEP);
    if (command.type === "orbit-left") orbitBy(-0.16, 0);
    if (command.type === "orbit-right") orbitBy(0.16, 0);
  }, [command, consumeCommand, dimension, fitGraph, focusNode, frozen, layoutReady, navigateWheel, orbitBy, panBy, resetGraph]);

  useEffect(() => {
    const canvas = gl.domElement;
    if (!interactive || frozen) {
      canvas.removeAttribute("tabindex");
      canvas.removeAttribute("aria-label");
      canvas.removeAttribute("aria-keyshortcuts");
      return undefined;
    }
    canvas.tabIndex = 0;
    canvas.setAttribute(
      "aria-label",
      t(`graph.camera.controls.${dimension}d.aria`),
    );
    canvas.setAttribute(
      "aria-keyshortcuts",
      "F 0 ArrowLeft ArrowRight ArrowUp ArrowDown Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown",
    );

    const handlePointerDown = (event) => {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
      cancelPendingFocus();
      tweenRef.current = null;
      if (event.pointerType === "touch") {
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointersRef.current.size === 2) {
          const [first, second] = [...pointersRef.current.values()];
          gestureRef.current = {
            x: (first.x + second.x) * 0.5,
            y: (first.y + second.y) * 0.5,
            distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
          };
          dragRef.current = null;
        }
      }
      if (event.pointerType !== "touch" || pointersRef.current.size === 1) {
      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        mode: dimension === 3 && event.button === 0 && !event.shiftKey ? "orbit" : "pan",
      };
      }
      canvas.setPointerCapture?.(event.pointerId);
    };
    const handlePointerMove = (event) => {
      if (event.pointerType === "touch" && pointersRef.current.has(event.pointerId)) {
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointersRef.current.size >= 2) {
          const [first, second] = [...pointersRef.current.values()];
          const next = {
            x: (first.x + second.x) * 0.5,
            y: (first.y + second.y) * 0.5,
            distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
          };
          const previous = gestureRef.current;
          if (previous) {
            panBy(previous.x - next.x, next.y - previous.y);
            navigateWheel(Math.max(-240, Math.min(240, -Math.log(next.distance / previous.distance) / 0.002)));
          }
          gestureRef.current = next;
          return;
        }
      }
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.x;
      const deltaY = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (drag.mode === "orbit") orbitBy(deltaX * 0.006, deltaY * 0.006);
      else panBy(-deltaX, deltaY);
    };
    const handlePointerUp = (event) => {
      if (event.pointerType === "touch") {
        pointersRef.current.delete(event.pointerId);
        gestureRef.current = null;
        const remaining = [...pointersRef.current.entries()][0];
        dragRef.current = remaining ? {
          pointerId: remaining[0], x: remaining[1].x, y: remaining[1].y,
          mode: dimension === 3 ? "orbit" : "pan",
        } : null;
        canvas.releasePointerCapture?.(event.pointerId);
        publishView();
        return;
      }
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      canvas.releasePointerCapture?.(event.pointerId);
      publishView();
    };
    const handleKeyDown = (event) => {
      const panAmount = event.shiftKey ? PAN_STEP * 2 : PAN_STEP;
      const navigationKey = event.key.toLowerCase() === "f" || event.key === "0"
        || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key);
      if (!navigationKey) return;
      cancelPendingFocus();
      if (event.key.toLowerCase() === "f") fitGraph();
      else if (event.key === "0") resetGraph();
      else if (event.altKey && event.key === "ArrowLeft") orbitBy(-0.14, 0);
      else if (event.altKey && event.key === "ArrowRight") orbitBy(0.14, 0);
      else if (event.altKey && event.key === "ArrowUp") orbitBy(0, -0.1);
      else if (event.altKey && event.key === "ArrowDown") orbitBy(0, 0.1);
      else if (event.key === "ArrowLeft") panBy(panAmount, 0);
      else if (event.key === "ArrowRight") panBy(-panAmount, 0);
      else if (event.key === "ArrowUp") panBy(0, -panAmount);
      else if (event.key === "ArrowDown") panBy(0, panAmount);
      else return;
      event.preventDefault();
    };
    const handleWheel = (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelPendingFocus();
      navigateWheel(graphWheelPixels(event.deltaY, event.deltaMode, size.height));
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    const preventContextMenu = (event) => event.preventDefault();
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("contextmenu", preventContextMenu);
    return () => {
      dragRef.current = null;
      pointersRef.current.clear();
      gestureRef.current = null;
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("contextmenu", preventContextMenu);
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeAttribute("tabindex");
      canvas.removeAttribute("aria-label");
      canvas.removeAttribute("aria-keyshortcuts");
    };
  }, [cancelPendingFocus, dimension, fitGraph, frozen, gl, interactive, navigateWheel, orbitBy, panBy, publishView, resetGraph, size.height, t]);

  useFrame((_, delta) => {
    if (frozen) return;
    const tween = tweenRef.current;
    if (!tween) return;
    tween.elapsed = Math.min(tween.duration, tween.elapsed + delta);
    const progress = tween.duration <= 0 ? 1 : tween.elapsed / tween.duration;
    const eased = 1 - ((1 - progress) ** 3);
    camera.position.lerpVectors(tween.from.position, tween.to.position, eased);
    targetRef.current.lerpVectors(tween.from.target, tween.to.target, eased);
    camera.zoom = MathUtils.lerp(tween.from.zoom, tween.to.zoom, eased);
    camera.lookAt(targetRef.current);
    camera.updateProjectionMatrix();
    if (progress >= 1) { tweenRef.current = null; publishView(); }
    else { runtime?.markContinuousFrame?.(); invalidate(); }
  });

  return null;
}
