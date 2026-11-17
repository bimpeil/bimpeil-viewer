/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: per loaded model what the page Positioning needs (usePositionBridge.ts, BIMpeil decision 223) */
import type { FederatedModel } from '@/store';
import { placementFor, type PlacementState } from '@/lib/model-placement/state';
import { fileCorrection, type FileCorrection } from './correction';

export type PositionReason = 'aligned' | 'noFrame' | 'loading' | 'noFile';

export interface PositionModel {
  modelId: string;
  name: string;
  schema: string;
  file: File | null;
  loaded: boolean;
  previewing: boolean;
  correction: FileCorrection | null;
  reason: PositionReason | null;
}

/** What the page needs to know per loaded model */
export function positionModels(models: ReadonlyMap<string, FederatedModel>, placement: PlacementState): PositionModel[] {
  return [...models.values()]
    .sort((a, b) => a.loadedAt - b.loadedAt)
    .map((model) => {
      const loaded = model.loadState === undefined || model.loadState === 'complete';
      const base = {
        modelId: model.id,
        name: model.name,
        schema: String(model.schemaVersion ?? ''),
        file: model.sourceFile ?? null,
        loaded,
        // A move that is shown but not applied; after Apply IfcLite starts a new, empty one at once
        previewing: !!placement.preview?.before.has(model.id) && placement.preview.delta.some((v) => v !== 0),
      };
      if (!loaded) return { ...base, correction: null, reason: 'loading' as const };
      if (!model.sourceFile) return { ...base, correction: null, reason: 'noFile' as const };
      const result = fileCorrection(placementFor(placement, model.id), model.geometryResult?.coordinateInfo, model.federationAlignmentStatus);
      return result.ok ? { ...base, correction: result.correction, reason: null } : { ...base, correction: null, reason: result.reason };
    });
}
