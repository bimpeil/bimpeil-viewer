/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: the state of moving, for the page around the bare viewer (usePositionBridge.ts). The page draws its own
 * controls and needs to know which model moves, the move that is shown but not applied, what is being picked in the
 * 3D view and whether undo is possible. Pure, from the placement state of IfcLite and its reposition runtime.
 */
import { NO_SECTION, type SectionSession } from './section';
import type { PlacementState } from '@/lib/model-placement/state';
import type { RepositionRuntime } from '@/lib/model-placement/reposition-runtime';

export type PickKind = 'point' | 'vertex' | 'edge' | 'face' | 'origin' | 'bounds';

export type PickStep = 'model' | 'reference' | 'pivot' | 'section';

/** Measuring an angle and choosing a pivot by clicking, as the page gets it (measure-scene.ts) */
export interface MeasureSession {
  picking: PickStep | null;
  /** Points clicked in this step: 0 or 1 */
  count: number;
  hover: PickKind | null;
  /** Radians, counter-clockwise seen from above; null when nothing is measured */
  angle: number | null;
  tooShort: boolean;
  result: number;
  /** What the chosen pivot snapped to, or null when there is none */
  pivot: PickKind | null;
  /** Points or lines are drawn */
  shown: boolean;
  missed: boolean;
}

export const NO_MEASURE: MeasureSession = {
  picking: null, count: 0, hover: null, angle: null, tooShort: false, result: 0, pivot: null, shown: false, missed: false,
};

export interface PositionSession {
  /** Moving is on (the reposition session of IfcLite is open) */
  open: boolean;
  /** The model that moves, or null */
  moving: string | null;
  /** The model a target point is picked on, or null */
  reference: string | null;
  /** What a click in the 3D view picks now */
  role: 'source' | 'target' | null;
  /** The move that is shown, in metres, not applied yet */
  delta: [number, number, number];
  previewing: boolean;
  /** What the picked points snapped to */
  source: PickKind | null;
  target: PickKind | null;
  /** What the pointer snaps to now while picking */
  hover: PickKind | null;
  canUndo: boolean;
  canRedo: boolean;
  /** The origins of the models are shown (the basepoints of IfcLite) */
  basepoints: boolean;
  /** The last error of IfcLite, in English, or null */
  error: string | null;
  /** Measuring an angle and choosing a pivot by clicking (measure-scene.ts) */
  measure: MeasureSession;
  /** The section (section-scene.ts) */
  section: SectionSession;
}

type RuntimeView = Pick<RepositionRuntime, 'selected' | 'reference' | 'role' | 'hover' | 'error'>;

export function positionSession(
  open: boolean,
  placement: PlacementState,
  runtime: RuntimeView | null,
  basepoints = false,
  measure: MeasureSession = NO_MEASURE,
  section: SectionSession = NO_SECTION,
): PositionSession {
  const preview = placement.preview;
  const delta = (preview?.delta ?? [0, 0, 0]).map((v) => v + 0) as [number, number, number];
  return {
    open,
    moving: preview?.modelIds[0] ?? runtime?.selected[0] ?? null,
    reference: open ? runtime?.reference || null : null,
    role: open ? (runtime?.role ?? null) : null,
    delta,
    previewing: !!preview && delta.some((v) => v !== 0),
    source: preview?.source?.kind ?? null,
    target: preview?.target?.kind ?? null,
    hover: open && runtime?.role ? (runtime.hover?.kind ?? null) : null,
    canUndo: placement.undo.length > 0,
    canRedo: placement.redo.length > 0,
    basepoints,
    error: runtime?.error || null,
    measure,
    section,
  };
}
