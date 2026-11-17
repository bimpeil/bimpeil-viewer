/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: from the placement of a model in the viewer to a correction in the coordinates of its IFC file (BIMpeil
 * decision 223). The page around the viewer writes that correction into IfcSite or IfcBuilding.
 *
 * The Placement panel of IfcLite keeps per model a turn about the vertical axis through `rotation.pivot`, then a shift
 * `translation`, in metres, engineering axes (Z up), in the workspace frame (lib/model-placement/rotation.ts). That
 * frame is the render frame with Z up: the IFC world coordinates minus the RTC offset and origin shift the viewer took
 * off for precision (`renderFrameWorldOffset`, @ifc-lite/geometry/world-frame). A shift and an angle are the same in
 * both frames; the pivot is a point and gets that offset added.
 *
 * That only holds while the model is in its own frame. A model that federation alignment re-baked through
 * georeferencing (IfcMapConversion; status `same-crs`, `reprojected`) has been turned and moved into the frame of
 * another model, and `failed` is unknown: those are refused with the reason `aligned`. Writing IfcMapConversion is a
 * later step.
 *
 * The other way round, `fileToWorkspace` gives where a point of the file is drawn now, for a pivot the page names in
 * file coordinates (the origin of the file).
 */
import { renderFrameWorldOffset, type RenderFrameInfo } from '@ifc-lite/geometry/world-frame';
import { modelPointToWorkspacePoint, type PointPlacement } from '@/lib/model-placement/rotation';

export type Triple = [number, number, number];

/** The same shape as `Correction` in BIMpeil (@bimpeil/shared/ifc-edit): metres, radians, file coordinates */
export interface FileCorrection {
  translation: Triple;
  rotation: number;
  pivot: Triple;
}

export type CorrectionResult = { ok: true; correction: FileCorrection } | { ok: false; reason: 'aligned' | 'noFrame' };

export interface ViewerPlacement {
  translation: readonly number[];
  rotation: { angle: number; pivot: readonly number[] };
}

/** Federation statuses where the geometry is still in the model's own frame */
const OWN_FRAME: ReadonlySet<string | undefined> = new Set([undefined, 'none', 'anchor', 'identity']);

const plain = (v: number) => v + 0;

export function fileCorrection(placement: ViewerPlacement, frame: RenderFrameInfo | null | undefined, alignmentStatus: string | undefined): CorrectionResult {
  if (!OWN_FRAME.has(alignmentStatus)) return { ok: false, reason: 'aligned' };
  const [x, y, z] = placement.translation;
  const [px, py, pz] = placement.rotation.pivot;
  if (![x, y, z, px, py, pz, placement.rotation.angle].every(Number.isFinite)) return { ok: false, reason: 'noFrame' };
  const offset = renderFrameWorldOffset(frame);
  return {
    ok: true,
    correction: {
      translation: [plain(x), plain(y), plain(z)],
      rotation: plain(placement.rotation.angle),
      pivot: [plain(px + offset.x), plain(py + offset.y), plain(pz + offset.z)],
    },
  };
}

/** True when the correction changes nothing: no shift and no turn */
export function isNoCorrection(correction: FileCorrection): boolean {
  return correction.rotation === 0 && correction.translation.every((v) => v === 0);
}

/** Where a point of the file (metres, file coordinates) is drawn now: minus the offset of the render frame, then the placement */
export function fileToWorkspace(point: readonly number[], frame: RenderFrameInfo | null | undefined, placement: PointPlacement): Triple {
  const offset = renderFrameWorldOffset(frame);
  const drawn = modelPointToWorkspacePoint([point[0] - offset.x, point[1] - offset.y, point[2] - offset.z], placement);
  return [plain(drawn[0]), plain(drawn[1]), plain(drawn[2])];
}
