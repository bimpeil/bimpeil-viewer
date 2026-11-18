/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: the section of the bare viewer for positioning, on the section plane of IfcLite (usePositionBridge.ts).
 *
 * The page sends the direction, the place of its slider (0 to 1 over the scene) and which side is cut away; the
 * bridge sets the plane with `setSectionPlaneFromFace` and `setSectionCustomDistance`, as IfcLite does for a picked
 * face (section.ts says why), with the cut faces filled and outlined. It reports where the plane is in metres in the
 * file, and whether the last frame of the renderer was actually cut.
 */
import { getGlobalRenderer } from '@/hooks/useBCF';
import { useViewerStore, type FederatedModel } from '@/store';
import { renderFrameWorldOffset } from '@ifc-lite/geometry/world-frame';
import { modelBounds } from '@/lib/model-placement/scene';
import { hasOwnFrame } from './correction';
import { renderBoxAround } from './origin';
import {
  directionOf,
  distanceAlong,
  fractionAlong,
  NO_SECTION,
  offsetFrom,
  planeFoot,
  sectionFraction,
  sectionPlaneAt,
  sectionValue,
  towardCamera,
  type RenderBox,
  type SectionDirection,
  type SectionSession,
  type Triple,
} from './section';

export interface SectionCommand {
  enabled: boolean;
  /** `picked`: the plane through the face that was clicked last, moved along its normal */
  direction: SectionDirection | 'picked';
  /** The place of the slider, 0 to 1 over the scene */
  fraction: number;
  flipped: boolean;
}

/** The box of all models as they are drawn (moved or not) in the render frame, as All frames them */
function sceneBox(): RenderBox | null {
  const boxes = [...useViewerStore.getState().models.keys()].map(modelBounds).filter((b) => b !== null);
  return renderBoxAround(boxes, []);
}

/** The offset of the render frame: that of the model that moves, else of the first model drawn in its own frame */
function frameOffset(moving: string | null): { x: number; y: number; z: number } {
  const models = useViewerStore.getState().models as ReadonlyMap<string, FederatedModel>;
  const chosen = (moving ? models.get(moving) : undefined) ?? [...models.values()].find((m) => hasOwnFrame(m.federationAlignmentStatus));
  return renderFrameWorldOffset(chosen?.geometryResult?.coordinateInfo);
}

/** Set the section; false when the bounds of the models are not there yet (just after loading): try again later */
export function applySection(command: SectionCommand): boolean {
  const store = useViewerStore.getState();
  if (!command.enabled) {
    store.setSectionPlaneEnabled(false);
    getGlobalRenderer()?.requestRender();
    return true;
  }
  const box = sceneBox();
  if (!box) return false;
  const current = store.sectionPlane;
  if (command.direction === 'picked') {
    const custom = current.custom;
    // Nothing was clicked, or the plane is one of the three directions now: nothing to move
    if (!custom || directionOf(custom.normal) !== null) return true;
    if (!current.enabled) store.setSectionPlaneEnabled(true);
    useViewerStore.getState().setSectionCustomDistance(distanceAlong(custom.normal, command.fraction, box));
    if (useViewerStore.getState().sectionPlane.flipped !== command.flipped) useViewerStore.getState().flipSectionPlane();
    getGlobalRenderer()?.requestRender();
    return true;
  }
  const plane = sectionPlaneAt(command.direction, command.fraction, box);
  if (!current.enabled || !current.custom || directionOf(current.custom.normal) !== command.direction) {
    store.setSectionPlaneFromFace(plane.normal, plane.point);
    store.setSectionShowCap(true);
    store.setSectionShowOutlines(true);
  }
  // The face pick insets the plane a little from the face; this plane is exactly where the slider is
  useViewerStore.getState().setSectionCustomDistance(plane.distance);
  if (useViewerStore.getState().sectionPlane.flipped !== command.flipped) useViewerStore.getState().flipSectionPlane();
  getGlobalRenderer()?.requestRender();
  return true;
}

/** A face clicked on a model (render frame): the section goes through it, with filled and outlined cut faces */
export function applyPickedSection(face: { point: Triple; normal: Triple }): void {
  const renderer = getGlobalRenderer();
  const camera = renderer?.getCamera().getPosition();
  const normal = camera ? towardCamera(face.normal, face.point, [camera.x, camera.y, camera.z]) : face.normal;
  const box = sceneBox();
  const store = useViewerStore.getState();
  store.setSectionPlaneFromFace(normal, face.point, box ? { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] } : undefined);
  store.setSectionShowCap(true);
  store.setSectionShowOutlines(true);
  renderer?.requestRender();
}

export function sectionSession(moving: string | null): SectionSession {
  const plane = useViewerStore.getState().sectionPlane;
  if (!plane.enabled) return { ...NO_SECTION, flipped: plane.flipped };
  const clipped = getGlobalRenderer()?.hasActiveClipping() ?? false;
  if (!plane.custom) return { enabled: true, direction: null, fraction: null, value: null, flipped: plane.flipped, clipped };
  const direction = directionOf(plane.custom.normal);
  const box = sceneBox();
  if (!direction) {
    // A picked face: where the plane is, as the distance from that face, to the millimetre
    const offset = Math.round(offsetFrom(plane.custom.pickedAt, plane.custom.normal, plane.custom.distance) * 1000) / 1000 + 0;
    const fraction = box ? fractionAlong(plane.custom.normal, plane.custom.distance, box) : null;
    return { enabled: true, direction: 'picked', fraction, value: offset, flipped: plane.flipped, clipped };
  }
  return {
    enabled: true,
    direction,
    fraction: box ? sectionFraction(direction, plane.custom.distance, box) : null,
    value: Math.round(sectionValue(direction, plane.custom.distance, frameOffset(moving)) * 1e6) / 1e6,
    flipped: plane.flipped,
    clipped,
  };
}

/** A horizontal section through a clicked point (render frame), exactly at its height */
export function horizontalSectionAt(point: Triple): void {
  const store = useViewerStore.getState();
  const box = sceneBox();
  store.setSectionPlaneFromFace([0, 1, 0], point, box ? { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] } : undefined);
  useViewerStore.getState().setSectionCustomDistance(point[1]);
  store.setSectionShowCap(true);
  store.setSectionShowOutlines(true);
  getGlobalRenderer()?.requestRender();
}

export function flipSection(): void {
  useViewerStore.getState().flipSectionPlane();
  getGlobalRenderer()?.requestRender();
}

export function removeSection(): void {
  useViewerStore.getState().setSectionPlaneEnabled(false);
  getGlobalRenderer()?.requestRender();
}

/** Move the plane to a distance along its normal (dragging the handle) */
export function moveSectionTo(distance: number): void {
  if (!Number.isFinite(distance)) return;
  useViewerStore.getState().setSectionCustomDistance(distance);
  getGlobalRenderer()?.requestRender();
}

export interface SectionHandle {
  /** The handle on the plane, under the clicked point, and one metre along the normal from there (render frame) */
  foot: { x: number; y: number; z: number };
  tip: { x: number; y: number; z: number };
  distance: number;
  direction: SectionDirection | 'picked';
  /** Where the plane is: the height, X or Y in the file, or the distance from the clicked face */
  value: number;
  flipped: boolean;
}

/** The handle of the section that cuts now, or null */
export function sectionHandle(moving: string | null): SectionHandle | null {
  const plane = useViewerStore.getState().sectionPlane;
  const custom = plane.custom;
  if (!plane.enabled || !custom) return null;
  // Every frame: no bounds of the models here, only the plane and the offset of the render frame
  const direction = directionOf(custom.normal);
  const value = direction
    ? sectionValue(direction, custom.distance, frameOffset(moving))
    : Math.round(offsetFrom(custom.pickedAt, custom.normal, custom.distance) * 1000) / 1000 + 0;
  const [fx, fy, fz] = planeFoot(custom.pickedAt, custom.normal, custom.distance);
  const [nx, ny, nz] = custom.normal;
  return {
    foot: { x: fx, y: fy, z: fz },
    tip: { x: fx + nx, y: fy + ny, z: fz + nz },
    distance: custom.distance,
    direction: direction ?? 'picked',
    value,
    flipped: plane.flipped,
  };
}
