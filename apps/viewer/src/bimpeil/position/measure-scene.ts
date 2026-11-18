/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: measuring an angle and choosing a pivot by clicking in the bare viewer for positioning. Two points on the
 * model that moves, two on the reference, and the angle between those lines seen from above (measure.ts); or one
 * point anywhere as the pivot of a turn. The page starts and stops it (usePositionBridge.ts), MeasureLayer.tsx picks
 * the points and draws them.
 *
 * Not the picking of IfcLite for moving: that one moves the model as soon as a point on the reference is known.
 * A point is kept in the frame of the model it was clicked on, so it moves with that model: after a turn, the line
 * on the model is drawn where the model is, parallel to the one on the reference.
 */
import { useViewerStore } from '@/store';
import { displayedTranslation, placementFor, type PlacementState } from '@/lib/model-placement/state';
import { modelPointToWorkspacePoint, workspacePointToModelFrame, type PointPlacement } from '@/lib/model-placement/rotation';
import type { Translation } from '@/lib/model-placement/translation';
import { planAngle } from './measure';
import type { MeasureSession, PickKind, PickStep } from './session';

/** A clicked point, in the frame of the model it is on */
export interface Anchor {
  modelId: string;
  local: Translation;
  kind: PickKind;
}

export interface Hit {
  modelId: string;
  /** Workspace, as drawn */
  point: Translation;
  kind: PickKind;
}

interface MeasureState {
  picking: PickStep | null;
  moving: string | null;
  reference: string | null;
  modelLine: Anchor[];
  referenceLine: Anchor[];
  angle: number | null;
  tooShort: boolean;
  /** Counts finished measurements, so the page notices a new one */
  result: number;
  pivot: Anchor | null;
  hover: Hit | null;
  /** The last click found no point */
  missed: boolean;
}

const empty = (): MeasureState => ({
  picking: null, moving: null, reference: null, modelLine: [], referenceLine: [], angle: null, tooShort: false, result: 0, pivot: null, hover: null, missed: false,
});

let state = empty();
const listeners = new Set<() => void>();
const set = (next: Partial<MeasureState>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};

export const measureState = (): Readonly<MeasureState> => state;

export function subscribeMeasure(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function measureSession(): MeasureSession {
  const s = state;
  return {
    picking: s.picking,
    count: s.picking === 'model' ? s.modelLine.length : s.picking === 'reference' ? s.referenceLine.length : 0,
    hover: s.picking ? (s.hover?.kind ?? null) : null,
    angle: s.angle,
    tooShort: s.tooShort,
    result: s.result,
    pivot: s.pivot?.kind ?? null,
    shown: s.modelLine.length > 0 || s.referenceLine.length > 0 || s.pivot !== null,
    missed: s.missed,
  };
}

// ---- Points that move with their model ------------------------------------------------------------------------------

export function drawnPlacement(placement: PlacementState, modelId: string): PointPlacement {
  return { translation: displayedTranslation(placement, modelId), rotation: placementFor(placement, modelId).rotation };
}

export function anchorFor(hit: Hit): Anchor {
  const placement = useViewerStore.getState().modelPlacement;
  return { modelId: hit.modelId, local: workspacePointToModelFrame(hit.point, drawnPlacement(placement, hit.modelId)), kind: hit.kind };
}

/** Where the point is drawn now, or null when its model is gone */
export function drawnPoint(anchor: Anchor): Translation | null {
  const store = useViewerStore.getState();
  if (!store.models.has(anchor.modelId)) return null;
  return modelPointToWorkspacePoint(anchor.local, drawnPlacement(store.modelPlacement, anchor.modelId));
}

// ---- Steps ------------------------------------------------------------------------------------------------------------

/** Start measuring: two points on `moving`, then two on `reference`; an earlier measurement goes */
export function startMeasure(moving: string, reference: string): void {
  set({ picking: 'model', moving, reference, modelLine: [], referenceLine: [], angle: null, tooShort: false, hover: null, missed: false });
}

export function startPivot(): void {
  set({ picking: 'pivot', hover: null, missed: false });
}

/** Stop clicking; a measurement that is not finished goes */
export function stopPicking(): void {
  if (!state.picking) return;
  const unfinished = state.picking !== 'pivot' && state.angle === null && !state.tooShort;
  set({ picking: null, hover: null, missed: false, ...(unfinished ? { modelLine: [], referenceLine: [] } : {}) });
}

/** The measurement and the pivot go */
export function clearMeasure(): void {
  set({ ...empty(), result: state.result });
}

/** Which model a click may land on in the current step */
export function accepts(modelId: string): boolean {
  if (state.picking === 'model') return modelId === state.moving;
  if (state.picking === 'reference') return modelId === state.reference;
  return state.picking === 'pivot';
}

export function setHover(hover: Hit | null): void {
  if (hover === state.hover || (hover && state.hover && hover.kind === state.hover.kind && hover.point.every((v, i) => v === state.hover!.point[i]))) return;
  set({ hover });
}

export function setMissed(): void {
  set({ missed: true });
}

export function pick(hit: Hit): void {
  if (!state.picking || !accepts(hit.modelId)) return;
  const anchor = anchorFor(hit);
  if (state.picking === 'pivot') {
    set({ picking: null, pivot: anchor, hover: null, missed: false });
    return;
  }
  if (state.picking === 'model') {
    const modelLine = [...state.modelLine, anchor];
    set({ modelLine, picking: modelLine.length === 2 ? 'reference' : 'model', hover: null, missed: false });
    return;
  }
  const referenceLine = [...state.referenceLine, anchor];
  if (referenceLine.length < 2) {
    set({ referenceLine, hover: null, missed: false });
    return;
  }
  const [a1, a2] = state.modelLine.map(drawnPoint);
  const [b1, b2] = referenceLine.map(drawnPoint);
  const angle = a1 && a2 && b1 && b2 ? planAngle(a1, a2, b1, b2) : null;
  set({
    referenceLine,
    picking: null,
    hover: null,
    missed: false,
    angle,
    tooShort: angle === null,
    result: state.result + 1,
    // The first point on the model is the pivot to start with: turned about it, it stays where it is
    pivot: angle === null ? state.pivot : state.modelLine[0],
  });
}
