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
import { directionOf, NO_SECTION, sectionFraction, sectionPlaneAt, sectionValue, type RenderBox, type SectionDirection, type SectionSession } from './section';

export interface SectionCommand {
  enabled: boolean;
  direction: SectionDirection;
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
  const plane = sectionPlaneAt(command.direction, command.fraction, box);
  const current = store.sectionPlane;
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

export function sectionSession(moving: string | null): SectionSession {
  const plane = useViewerStore.getState().sectionPlane;
  if (!plane.enabled) return { ...NO_SECTION, flipped: plane.flipped };
  const clipped = getGlobalRenderer()?.hasActiveClipping() ?? false;
  const direction = plane.custom ? directionOf(plane.custom.normal) : null;
  if (!plane.custom || !direction) return { enabled: true, direction: 'other', fraction: null, value: null, flipped: plane.flipped, clipped };
  const box = sceneBox();
  return {
    enabled: true,
    direction,
    fraction: box ? sectionFraction(direction, plane.custom.distance, box) : null,
    value: Math.round(sectionValue(direction, plane.custom.distance, frameOffset(moving)) * 1e6) / 1e6,
    flipped: plane.flipped,
    clipped,
  };
}
