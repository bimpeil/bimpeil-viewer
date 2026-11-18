/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: in the bare viewer for positioning, zooming in stops short of what is under the cursor, also in a large
 * scene (PositionLayout.tsx).
 *
 * IfcLite zooms in toward the surface under the cursor and stops short of it (#5393, `wheelZoom.ts`,
 * `camera-surface-zoom.ts`), but skips finding that surface above 50,000 elements or 3 million indices
 * (`isPivotRaycastTooExpensive`), because `raycastScene` grows with the scene. A notch then moves by a share of the
 * distance to the orbit target, which can lie far behind a small object in front of it: one notch passed straight
 * through the 1 m origin object of a model, with four large models open. Positioning works with several large models
 * at once, so here `camera.zoom` itself gets the point when IfcLite did not give one. It is found with the raycast of
 * the scene (`Scene.raycast`, where the GPU pick of IfcLite falls back above its budget): on four large models a few
 * milliseconds where `raycastScene` took tens to hundreds, with the same point.
 *
 * IfcLite also skips it on a model with a robust orbit anchor (#1394): a few elements far from the rest, which make
 * its raycast slow and, it says, the find unneeded. Here it is found all the same: `Scene.raycast` builds no index
 * and stays fast, and such a far element is often just the origin object one zooms in on.
 *
 * No file of IfcLite changes: its wheel handler stays as it is (drawing, the interaction signals, Ctrl for a finer
 * step, Shift for a plain dolly); only `zoom` of the camera of this viewer is wrapped. Zooming out and the plain dolly
 * are left alone, as IfcLite leaves them.
 */
import { getGlobalRenderer } from '@/hooks/useBCF';
import { isGeometryLoadStreaming } from '@/lib/pick-gating';
import { useViewerStore } from '@/store';
import { cameraPoseKey, SURFACE_PICK_IDLE_MS, type SurfacePoint } from '@/components/viewer/zoomSurface';

/** The part of the renderer the finder uses */
export interface SurfaceRenderer {
  getScene(): object;
  getCamera(): { unprojectToRay(x: number, y: number, width: number, height: number): { origin: SurfacePoint; direction: SurfacePoint } };
  hasActiveClipping(): boolean;
  raycastScene(x: number, y: number, options: { isStreaming: boolean; hiddenIds: Set<number>; isolatedIds: Set<number> | null }): { intersection: { point: SurfacePoint } } | null;
}

/** The part of the camera of IfcLite this module uses */
export interface ZoomCamera {
  zoom(
    delta: number,
    addVelocity?: boolean,
    mouseX?: number,
    mouseY?: number,
    canvasWidth?: number,
    canvasHeight?: number,
    fastZoom?: boolean,
    surfacePoint?: SurfacePoint,
  ): void;
  getPosition(): SurfacePoint;
  getTarget(): SurfacePoint;
}

/** The visible surface under a point of the canvas (CSS px, with the size of the canvas), or null over empty space */
export type SurfaceFinder = (x: number, y: number, width: number, height: number) => SurfacePoint | null;

/** As IfcLite: the cursor may wander this far within one gesture */
const GESTURE_SLOP_PX = 4;

/**
 * Wrap `camera.zoom`: zooming in without a surface point (IfcLite skipped finding it) gets the one under the cursor,
 * or under the centre of the canvas for a zoom without a cursor (the keys, the toolbar). One find per gesture, as in
 * IfcLite: while the cursor stays put and only this zoom moved the camera, the point found is used again. Returns the
 * function that puts the original back.
 */
export function wrapSurfaceZoom(
  camera: ZoomCamera,
  find: SurfaceFinder,
  canvasSize: () => { width: number; height: number },
  now: () => number = Date.now,
): () => void {
  const original = camera.zoom;
  let gesture: { x: number; y: number; at: number; pose: string; point: SurfacePoint | null } | null = null;
  const wrapped: ZoomCamera['zoom'] = (delta, addVelocity, mouseX, mouseY, canvasWidth, canvasHeight, fastZoom, surfacePoint) => {
    if (!(delta < 0) || fastZoom || surfacePoint) {
      original.call(camera, delta, addVelocity, mouseX, mouseY, canvasWidth, canvasHeight, fastZoom, surfacePoint);
      return;
    }
    const size = canvasWidth !== undefined && canvasHeight !== undefined ? { width: canvasWidth, height: canvasHeight } : canvasSize();
    const x = mouseX ?? size.width / 2;
    const y = mouseY ?? size.height / 2;
    const at = now();
    const same =
      gesture !== null &&
      at - gesture.at < SURFACE_PICK_IDLE_MS &&
      gesture.pose === cameraPoseKey(camera) &&
      Math.abs(gesture.x - x) <= GESTURE_SLOP_PX &&
      Math.abs(gesture.y - y) <= GESTURE_SLOP_PX;
    if (!same || gesture === null) {
      gesture = { x, y, at, pose: '', point: size.width > 0 && size.height > 0 ? find(x, y, size.width, size.height) : null };
    }
    gesture.at = at;
    original.call(camera, delta, addVelocity, mouseX, mouseY, canvasWidth, canvasHeight, fastZoom, gesture.point ?? undefined);
    gesture.pose = cameraPoseKey(camera);
  };
  camera.zoom = wrapped;
  return () => {
    if (camera.zoom === wrapped) camera.zoom = original;
  };
}

/**
 * `Scene.raycast` of IfcLite. It is not in the published surface of the renderer (`SceneContents`, see
 * `scene-contents.ts`), so it is checked at run time: after an upgrade without it, zooming is that of IfcLite again,
 * with one warning, and the smoke test of BIMpeil-ifc fails on it.
 */
interface SceneRaycast {
  raycast(
    origin: SurfacePoint,
    direction: SurfacePoint,
    hiddenIds?: Set<number>,
    isolatedIds?: Set<number> | null,
    clip?: null,
  ): { distance: number } | null;
}
function canRaycast(scene: object): scene is SceneRaycast {
  return 'raycast' in scene && typeof scene.raycast === 'function';
}
let warned = false;

/**
 * The surface under a point with the raycast of the scene: the ray of the camera through the point, and the point at
 * the distance of the nearest hit. Hidden and isolated elements count as for picking; not while a model is loading,
 * as IfcLite. When IfcLite has released the geometry to save memory, the scene only knows the boxes of the elements
 * (`Scene.raycast`): zooming then stops short of a box, which still does not pass through it.
 *
 * While a section cuts the models (section-scene.ts), the raycast of the renderer is used instead: it leaves out what
 * is cut away, which `Scene.raycast` only does with the clip state the renderer keeps to itself. It is slower in a
 * large scene (once per gesture), but zooming does not stop short of what is not there.
 */
export function sceneSurfaceFinder(renderer: SurfaceRenderer): SurfaceFinder {
  return (x, y, width, height) => {
    const state = useViewerStore.getState();
    if (isGeometryLoadStreaming(state)) return null;
    if (renderer.hasActiveClipping()) {
      return renderer.raycastScene(x, y, { isStreaming: false, hiddenIds: state.hiddenEntities, isolatedIds: state.isolatedEntities })?.intersection.point ?? null;
    }
    const scene = renderer.getScene();
    if (!canRaycast(scene)) {
      if (!warned) console.warn('[BIMpeil] Scene.raycast is missing: zooming in falls back to IfcLite (surface-zoom.ts)');
      warned = true;
      return null;
    }
    const ray = renderer.getCamera().unprojectToRay(x, y, width, height);
    const hit = scene.raycast(ray.origin, ray.direction, state.hiddenEntities, state.isolatedEntities, null);
    if (!hit || !Number.isFinite(hit.distance)) return null;
    return {
      x: ray.origin.x + ray.direction.x * hit.distance,
      y: ray.origin.y + ray.direction.y * hit.distance,
      z: ray.origin.z + ray.direction.z * hit.distance,
    };
  };
}

/**
 * Keep the camera of the renderer wrapped: the renderer starts after this viewer, and a new one (after a lost device)
 * brings a new camera. Checked on every change of the store, which is cheap. Returns the function that stops it.
 */
export function keepSurfaceZoom(): () => void {
  let camera: ZoomCamera | null = null;
  let unwrap: (() => void) | null = null;
  const check = () => {
    const renderer = getGlobalRenderer();
    const current = renderer?.getCamera() ?? null;
    if (!renderer || !current || current === camera) return;
    unwrap?.();
    camera = current;
    unwrap = wrapSurfaceZoom(current, sceneSurfaceFinder(renderer), () => {
      const rect = renderer.getCanvas().getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
  };
  const unsubscribe = useViewerStore.subscribe(check);
  check();
  return () => {
    unsubscribe();
    unwrap?.();
  };
}
