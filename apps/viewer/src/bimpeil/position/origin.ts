/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: the origin of a model, the point 0,0,0 of its file (Model Origin in other viewers), for the bare viewer for
 * positioning. Moving starts at the origin when it lies near the model (usePositionBridge.ts), the page can show the
 * origins (OriginMarkers.tsx), and All and From above take them in. Pure, so the rules are fixed cases (origin.test.ts).
 *
 * Unlike the basepoints of IfcLite (BasepointOverlay.tsx), the origin here moves with the model: it is the point of
 * the file through the placement the viewer draws, the same conversion the correction uses (correction.ts).
 */
import { addTranslation, type Translation } from '@/lib/model-placement/translation';
import type { PointPlacement } from '@/lib/model-placement/rotation';
import type { RenderFrameInfo } from '@ifc-lite/geometry/world-frame';
import { fileToWorkspace, type Triple } from './correction';

/** A box in the render frame of IfcLite (Y up), as `getModelPlacementBounds` gives it */
export interface RenderBox {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** A box in the workspace frame (Z up, metres) */
export interface Box {
  min: Triple;
  max: Triple;
}

/**
 * An origin counts as near when it lies within the size of the model (the diagonal of its box) from that box, and
 * always within this many metres. Farther away, as with coordinates of the Dutch national grid in the file, a handle
 * at the origin cannot be dragged with the model in view, so moving starts in the middle of the model.
 */
export const NEAR_AT_LEAST = 100;

/** Where the viewer draws the origin of a file now: through its placement and the move that is shown */
export function displayedOrigin(frame: RenderFrameInfo | null | undefined, placement: PointPlacement, previewDelta: Translation | null): Triple {
  const origin = fileToWorkspace([0, 0, 0], frame, placement);
  return previewDelta ? (addTranslation(origin, previewDelta) as Triple) : origin;
}

/** The render box (Y up) as a workspace box (Z up): workspace y is minus render z */
export function workspaceBox(box: RenderBox): Box {
  return {
    min: [box.min.x, -box.max.z, box.min.y],
    max: [box.max.x, -box.min.z, box.max.y],
  };
}

export function distanceToBox(point: readonly number[], box: Box): number {
  const d = [0, 1, 2].map((i) => Math.max(box.min[i] - point[i], 0, point[i] - box.max[i]));
  return Math.hypot(d[0], d[1], d[2]);
}

export function isNearModel(origin: readonly number[], box: Box): boolean {
  const diagonal = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  return distanceToBox(origin, box) <= Math.max(diagonal, NEAR_AT_LEAST);
}

/** The smallest render box around boxes and points (both in the render frame); null when there is nothing */
export function renderBoxAround(boxes: readonly RenderBox[], points: readonly { x: number; y: number; z: number }[]): RenderBox | null {
  if (!boxes.length && !points.length) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const take = (p: { x: number; y: number; z: number }) => {
    for (const axis of ['x', 'y', 'z'] as const) {
      min[axis] = Math.min(min[axis], p[axis]);
      max[axis] = Math.max(max[axis], p[axis]);
    }
  };
  for (const box of boxes) {
    take(box.min);
    take(box.max);
  }
  for (const point of points) take(point);
  return { min, max };
}
