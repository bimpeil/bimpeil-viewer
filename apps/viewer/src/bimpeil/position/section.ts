/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: a section of the bare viewer for positioning, horizontal or across X or Y of the file, placed with a slider
 * on the page (section-scene.ts). Pure: the plane at a place of the slider, and back to metres in the file.
 *
 * IfcLite keeps its own cardinal section as a percentage of bounds it derives inside the viewport, out of reach of the
 * bridge. To know exactly where the plane is, the bridge sets it as a plane with a normal and a distance, as IfcLite
 * does for a picked face. The render frame has Y up and is the file minus the offset of the render frame; workspace Y
 * is minus render Z (lib/model-placement/translation.ts). The normals are chosen so that the distance along them is
 * the coordinate of the file axis minus that offset.
 */

/** `z`: horizontal at a height; `x`: across X (the plane where X is one value); `y`: across Y */
export type SectionDirection = 'z' | 'x' | 'y';

export type Triple = [number, number, number];

/** The section as the bridge reports it to the page (bimpeil:position-session) */
export interface SectionSession {
  enabled: boolean;
  /** `other`: a plane IfcLite set otherwise (none in this viewer yet) */
  direction: SectionDirection | 'other' | null;
  /** The place over the scene, 0 to 1 */
  fraction: number | null;
  /** Where the plane is: the height, X or Y in metres in the file */
  value: number | null;
  flipped: boolean;
  /** The last frame of the renderer was cut */
  clipped: boolean;
}

export const NO_SECTION: SectionSession = { enabled: false, direction: null, fraction: null, value: null, flipped: false, clipped: false };

export interface RenderBox {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface SectionPlaneSpec {
  /** Unit normal in the render frame */
  normal: Triple;
  /** A point on the plane in the render frame */
  point: Triple;
  /** dot(point, normal) */
  distance: number;
}

export function sectionNormal(direction: SectionDirection): Triple {
  return direction === 'z' ? [0, 1, 0] : direction === 'x' ? [1, 0, 0] : [0, 0, -1];
}

/** The range of the distance along the normal over a box of the scene */
export function sectionRange(direction: SectionDirection, box: RenderBox): { min: number; max: number } {
  if (direction === 'z') return { min: box.min.y, max: box.max.y };
  if (direction === 'x') return { min: box.min.x, max: box.max.x };
  return { min: -box.max.z, max: -box.min.z };
}

/** The plane at a fraction (0 to 1) of the range over the scene, through the middle of the scene */
export function sectionPlaneAt(direction: SectionDirection, fraction: number, box: RenderBox): SectionPlaneSpec {
  const range = sectionRange(direction, box);
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0.5;
  const distance = range.min + f * (range.max - range.min);
  const normal = sectionNormal(direction);
  const centre: Triple = [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2];
  const shift = distance - (centre[0] * normal[0] + centre[1] * normal[1] + centre[2] * normal[2]);
  const point: Triple = [centre[0] + normal[0] * shift, centre[1] + normal[1] * shift, centre[2] + normal[2] * shift];
  return { normal, point, distance: distance + 0 };
}

/** Where a distance lies in the range over the scene, from 0 to 1 */
export function sectionFraction(direction: SectionDirection, distance: number, box: RenderBox): number {
  const { min, max } = sectionRange(direction, box);
  if (!(max - min > 1e-9)) return 0.5;
  return Math.min(1, Math.max(0, (distance - min) / (max - min)));
}

/** The place of the plane in the file, in metres: the distance plus the offset of the render frame on that axis */
export function sectionValue(direction: SectionDirection, distance: number, offset: { x: number; y: number; z: number }): number {
  return distance + (direction === 'z' ? offset.z : direction === 'x' ? offset.x : offset.y) + 0;
}

/** The direction of a plane with this normal, or null for any other normal (a picked face) */
export function directionOf(normal: readonly number[]): SectionDirection | null {
  for (const direction of ['z', 'x', 'y'] as const) {
    const n = sectionNormal(direction);
    if (n.every((v, i) => Math.abs(v - normal[i]) < 1e-9)) return direction;
  }
  return null;
}
