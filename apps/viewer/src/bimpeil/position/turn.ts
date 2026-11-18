/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: turn a model about a point as it is drawn, for the bare viewer for positioning (usePositionBridge.ts).
 *
 * `setModelRotation` of IfcLite takes the pivot as a point of the model in its unturned state: on a model that is
 * turned already, a new heading about another point then moves that point. The page means "turn about this point as
 * you see it": the point stays where it is and the model gets the new heading. Here the placement becomes a turn
 * about the point of the model that is drawn at the pivot, with the translation that keeps it there; one command in
 * the history of IfcLite, as `rotatePlacements` (state.ts) makes it, including a move that was shown.
 */
import { cancelPlacement, placementFor, type ModelPlacement, type PlacementState } from '@/lib/model-placement/state';
import { equalRotation, normalizeAngle, workspacePointToModelFrame } from '@/lib/model-placement/rotation';
import {
  addTranslation, assertRenderableTranslation, equalTranslation, finiteTranslation, subtractTranslation, ZERO_TRANSLATION, type Translation,
} from '@/lib/model-placement/translation';

/** The model gets heading `angle` (radians, absolute, counter-clockwise seen from above) about `pivot` (workspace, as drawn) */
export function turnAbout(state: PlacementState, modelId: string, angle: number, pivot: Translation): PlacementState {
  if (!Number.isFinite(angle) || !finiteTranslation(pivot)) throw new Error('Enter a finite angle and pivot.');
  const preview = state.preview;
  const before = new Map<string, ModelPlacement>();
  const after = new Map<string, ModelPlacement>();
  // A move that is shown is committed with the turn, as `rotatePlacements` does
  for (const id of new Set([modelId, ...(preview?.modelIds ?? [])])) {
    const placement = placementFor(state, id);
    if (placement.locked) throw new Error(id === modelId ? 'Unlock the model before turning it.' : 'Unlock the previewed models before turning.');
    const translation = preview?.before.has(id) ? addTranslation(placement.translation, preview.delta) : placement.translation;
    assertRenderableTranslation(translation);
    before.set(id, placement);
    // Not turned, or already at this heading: only a move that was shown is committed
    if (id !== modelId || Math.abs(normalizeAngle(angle - placement.rotation.angle)) < 1e-12) {
      after.set(id, { ...placement, translation });
      continue;
    }
    // The point of the model drawn at the pivot now; turned about itself, it stays at the pivot
    const local = workspacePointToModelFrame(pivot, { translation, rotation: placement.rotation });
    const moved = subtractTranslation(pivot, local);
    assertRenderableTranslation(local);
    assertRenderableTranslation(moved);
    after.set(id, { ...placement, translation: moved, rotation: { angle: normalizeAngle(angle), pivot: local } });
  }
  return commit(cancelPlacement(state), before, after);
}

/** As `commitPlacements` in state.ts (not exported there): one command, the redo history gone */
function commit(state: PlacementState, before: ReadonlyMap<string, ModelPlacement>, after: ReadonlyMap<string, ModelPlacement>): PlacementState {
  const unchanged = [...after].every(([id, value]) => {
    const old = before.get(id);
    return old ? equalTranslation(old.translation, value.translation) && equalRotation(old.rotation, value.rotation) : equalTranslation(value.translation, ZERO_TRANSLATION) && value.rotation.angle === 0;
  });
  if (unchanged) return state;
  const placements = new Map(state.placements);
  for (const [id, value] of after) placements.set(id, value);
  const revision = state.revision + 1;
  return { ...state, placements, preview: null, revision, redo: [], undo: [...state.undo.slice(-99), { id: revision, timestamp: Date.now(), before, after }] };
}
