/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: keep the view of the bare viewer for positioning when a model turns (usePositionBridge.ts).
 *
 * A turn is baked into the geometry of IfcLite (`useModelRotationSync.ts`), which bumps the content version; the
 * viewport then takes the geometry as new and frames the camera again (`useGeometryStreaming.ts`), from another side.
 * Before a turn, an undo, a redo or a reset, the camera is held: when the view changes without the user, it is put
 * back. That stops at the first pointer, wheel or key of the user, at All and From above (`releaseCamera`), half a
 * second after the view was put back (an animated fit is over by then), or after ten seconds without a change.
 */
import { getGlobalRenderer } from '@/hooks/useBCF';

interface Pose {
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  orthoSize: number | null;
}

type Camera = ReturnType<NonNullable<ReturnType<typeof getGlobalRenderer>>['getCamera']>;

const WAIT_FOR_FIT_MS = 10_000;
const AFTER_FIT_MS = 500;

function poseOf(camera: Camera): Pose {
  return {
    position: camera.getPosition(),
    target: camera.getTarget(),
    up: camera.getUp(),
    orthoSize: camera.getProjectionMode() === 'orthographic' ? camera.getOrthoSize() : null,
  };
}

const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.z - b.z) < 1e-6;

export function samePose(a: Pose, b: Pose): boolean {
  return close(a.position, b.position) && close(a.target, b.target) && close(a.up, b.up) && a.orthoSize === b.orthoSize;
}

/**
 * The layer with the handles of IfcLite wakes on pointer moves over the canvas only (its projector,
 * `SceneProjectorProvider.tsx`): after the camera moved without the user, one is sent, not bubbling
 */
export function wakeHandles(): void {
  for (const canvas of document.querySelectorAll('.bimpeil-position canvas')) canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: false }));
}

let release: (() => void) | null = null;

/** Stop holding the camera: the user or the page moves it on purpose */
export function releaseCamera(): void {
  release?.();
}

/** Hold the camera as it is now until the geometry has been framed again (see above) */
export function holdCamera(): void {
  release?.();
  const renderer = getGlobalRenderer();
  const camera = renderer?.getCamera();
  if (!renderer || !camera) return;
  camera.stopInertia();
  const kept = poseOf(camera);
  const canvas = renderer.getCanvas();
  let until = performance.now() + WAIT_FOR_FIT_MS;
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    canvas?.removeEventListener('pointerdown', stop, true);
    canvas?.removeEventListener('wheel', stop, true);
    window.removeEventListener('keydown', stop, true);
    if (release === stop) release = null;
  };
  const tick = () => {
    if (performance.now() > until) return stop();
    if (!samePose(poseOf(camera), kept)) {
      camera.stopInertia();
      camera.setPosition(kept.position.x, kept.position.y, kept.position.z);
      camera.setTarget(kept.target.x, kept.target.y, kept.target.z);
      camera.setUp(kept.up.x, kept.up.y, kept.up.z);
      if (kept.orthoSize !== null) camera.setOrthoSize(kept.orthoSize);
      renderer.requestRender();
      wakeHandles();
      until = Math.min(until, performance.now() + AFTER_FIT_MS);
    }
    frame = requestAnimationFrame(tick);
  };
  canvas?.addEventListener('pointerdown', stop, true);
  canvas?.addEventListener('wheel', stop, true);
  window.addEventListener('keydown', stop, true);
  release = stop;
  frame = requestAnimationFrame(tick);
}
