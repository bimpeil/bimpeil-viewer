/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: the origins of the loaded models in the scene (origin.ts has the rules), and whether the page shows them.
 * Read by the bridge (usePositionBridge.ts: where moving starts, All and From above) and by OriginMarkers.tsx. The
 * basepoints of IfcLite stay off: they do not move with a model, and they are not in the style of the page.
 */
import { useViewerStore, type FederatedModel } from '@/store';
import { placementFor } from '@/lib/model-placement/state';
import { modelBounds } from '@/lib/model-placement/scene';
import { toRenderTranslation } from '@/lib/model-placement/translation';
import { hasOwnFrame, type Triple } from './correction';
import { displayedOrigin, isNearModel, workspaceBox } from './origin';

export interface ModelOrigin {
  modelId: string;
  name: string;
  /** Workspace frame (Z up, metres), as drawn now */
  workspace: Triple;
  /** Render frame (Y up), for the camera and the projection to the screen */
  render: { x: number; y: number; z: number };
  /** The model is being moved */
  moving: boolean;
  /** Near the model (origin.ts); null when not asked or when the bounds of the model are not there yet */
  near: boolean | null;
}

/**
 * The origin of every visible model drawn in its own frame. A model aligned to another one by IfcLite (same CRS,
 * reprojected) is left out: the point of its file no longer maps to the view with its own offset.
 */
export function currentOrigins(options: { near?: boolean } = {}): ModelOrigin[] {
  const state = useViewerStore.getState();
  const preview = state.modelPlacement.preview;
  const out: ModelOrigin[] = [];
  for (const [modelId, model] of state.models as ReadonlyMap<string, FederatedModel>) {
    if (!model.visible || !hasOwnFrame(model.federationAlignmentStatus)) continue;
    const moving = !!preview?.before.has(modelId);
    const workspace = displayedOrigin(model.geometryResult?.coordinateInfo, placementFor(state.modelPlacement, modelId), moving ? preview!.delta : null);
    if (!workspace.every(Number.isFinite)) continue;
    let near: boolean | null = null;
    if (options.near) {
      const bounds = modelBounds(modelId);
      near = bounds ? isNearModel(workspace, workspaceBox(bounds)) : null;
    }
    const [x, y, z] = toRenderTranslation(workspace);
    out.push({ modelId, name: model.name, workspace, render: { x, y, z }, moving, near });
  }
  return out;
}

// ---- Shown or not: set by the page (bimpeil:position-move basepoints) -----------------------------------------------

let shown = false;
const listeners = new Set<() => void>();

export const originsShown = (): boolean => shown;

export function setOriginsShown(next: boolean): void {
  if (next === shown) return;
  shown = next;
  for (const listener of listeners) listener();
}

export function subscribeOriginsShown(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
