import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import {
  MathUtils,
  Spherical,
  Vector3,
} from "three";
import { useLanguage } from "../../i18n/language-system.js";
import { getGraphCameraZoom } from "../graphics-runtime-policy.js";

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
  getPositions,
  interactive = false,
  reducedMotion = false,
  zoom = 1,
}) {
  const { t } = useLanguage();
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const size = useThree((state) => state.size);
  const targetRef = useRef(new Vector3());
  const scratchRef = useRef({
    offset: new Vector3(),
    right: new Vector3(),
    spherical: new Spherical(),
    up: new Vector3(),
  });
  const tweenRef = useRef(null);
  const dragRef = useRef(null);
  const lastCommandIdRef = useRef(null);

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
      return;
    }
    tweenRef.current = {
      elapsed: 0,
      duration,
      from: copyView(camera, targetRef.current),
      to: nextView,
    };
    invalidate();
  }, [camera, invalidate, reducedMotion]);

  const fitGraph = useCallback((animate = true) => {
    const bounds = readBounds(getPositions?.(), dimension);
    if (!bounds) return;
    const padding = dimension === 3 ? 1.34 : 1.2;
    if (camera.isOrthographicCamera) {
      const spanX = Math.max(80, bounds.size.x * padding);
      const spanY = Math.max(80, bounds.size.y * padding);
      const fitZoom = Math.max(0.16, Math.min(5.5, size.width / spanX, size.height / spanY));
      applyView({
        position: new Vector3(bounds.center.x, bounds.center.y, 700),
        target: new Vector3(bounds.center.x, bounds.center.y, 0),
        zoom: fitZoom,
      }, animate);
      return;
    }
    const radius = Math.max(80, bounds.size.length() * 0.5);
    const distance = Math.min(
      3_200,
      Math.max(180, (radius / Math.tan(MathUtils.degToRad(camera.fov) * 0.5)) * padding),
    );
    const direction = camera.position.clone().sub(targetRef.current);
    if (direction.lengthSq() < 0.001) direction.set(0.34, 0.24, 1);
    direction.normalize();
    applyView({
      position: bounds.center.clone().addScaledVector(direction, distance),
      target: bounds.center,
      zoom: 1,
    }, animate);
  }, [applyView, camera, dimension, getPositions, size.height, size.width]);

  const resetGraph = useCallback((animate = true) => {
    applyView({
      position: new Vector3(0, 0, dimension === 3 ? 720 : 700),
      target: new Vector3(),
      zoom: getGraphCameraZoom(zoom, size.width, size.height),
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

  useEffect(() => {
    if (!command || command.id === lastCommandIdRef.current) return;
    lastCommandIdRef.current = command.id;
    if (command.type === "fit") fitGraph();
    if (command.type === "reset") resetGraph();
    if (command.type === "pan-left") panBy(PAN_STEP, 0);
    if (command.type === "pan-right") panBy(-PAN_STEP, 0);
    if (command.type === "pan-up") panBy(0, -PAN_STEP);
    if (command.type === "pan-down") panBy(0, PAN_STEP);
    if (command.type === "orbit-left") orbitBy(-0.16, 0);
    if (command.type === "orbit-right") orbitBy(0.16, 0);
  }, [command, fitGraph, orbitBy, panBy, resetGraph]);

  useEffect(() => {
    const canvas = gl.domElement;
    if (!interactive) {
      canvas.removeAttribute("tabindex");
      canvas.removeAttribute("aria-label");
      canvas.removeAttribute("aria-keyshortcuts");
      return undefined;
    }
    canvas.tabIndex = 0;
    canvas.setAttribute(
      "aria-label",
      t("graph.camera.controls.aria"),
    );
    canvas.setAttribute(
      "aria-keyshortcuts",
      "F 0 ArrowLeft ArrowRight ArrowUp ArrowDown Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown",
    );

    const handlePointerDown = (event) => {
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
      tweenRef.current = null;
      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        mode: dimension === 3 && event.button === 0 && !event.shiftKey ? "orbit" : "pan",
      };
      canvas.setPointerCapture?.(event.pointerId);
    };
    const handlePointerMove = (event) => {
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
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current = null;
      canvas.releasePointerCapture?.(event.pointerId);
    };
    const handleKeyDown = (event) => {
      const panAmount = event.shiftKey ? PAN_STEP * 2 : PAN_STEP;
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
    const preventContextMenu = (event) => event.preventDefault();
    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointercancel", handlePointerUp);
    canvas.addEventListener("keydown", handleKeyDown);
    canvas.addEventListener("contextmenu", preventContextMenu);
    return () => {
      dragRef.current = null;
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerUp);
      canvas.removeEventListener("keydown", handleKeyDown);
      canvas.removeEventListener("contextmenu", preventContextMenu);
      canvas.removeAttribute("tabindex");
      canvas.removeAttribute("aria-label");
      canvas.removeAttribute("aria-keyshortcuts");
    };
  }, [dimension, fitGraph, gl, interactive, orbitBy, panBy, resetGraph, t]);

  useFrame((_, delta) => {
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
    if (progress >= 1) tweenRef.current = null;
    else invalidate();
  });

  return null;
}
