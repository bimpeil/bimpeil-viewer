/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: what the page Positioning hears per model (models.ts, BIMpeil decision 223) */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FederatedModel } from '@/store';
import { emptyPlacementState, type PlacementState } from '@/lib/model-placement/state';
import { positionModels } from './models';

const file = (name: string) => new File(['ISO-10303-21;'], name);

function model(id: string, extra: Partial<FederatedModel>): FederatedModel {
  return { id, name: `${id}.ifc`, loadedAt: 1, schemaVersion: 'IFC4', sourceFile: file(`${id}.ifc`), loadState: 'complete', geometryResult: null, ...extra } as unknown as FederatedModel;
}

test('per model the correction, or why there is none', () => {
  const a = model('a', { loadedAt: 1 });
  const b = model('b', { loadedAt: 2, federationAlignmentStatus: 'same-crs' });
  const c = model('c', { loadedAt: 3, loadState: 'streaming-geometry' });
  const d = model('d', { loadedAt: 4, sourceFile: undefined });
  const placement: PlacementState = {
    ...emptyPlacementState(),
    placements: new Map([['a', { translation: [1, 2, 0], rotation: { angle: 0.5, pivot: [0, 0, 0] }, locked: false }]]),
  };
  const out = positionModels(new Map([['d', d], ['c', c], ['b', b], ['a', a]]), placement);
  assert.deepEqual(out.map((m) => [m.modelId, m.reason]), [['a', null], ['b', 'aligned'], ['c', 'loading'], ['d', 'noFile']]);
  assert.deepEqual(out[0].correction, { translation: [1, 2, 0], rotation: 0.5, pivot: [0, 0, 0] });
  assert.equal(out[0].file, a.sourceFile);
  assert.equal(out[0].schema, 'IFC4');
});

test('a move that is not applied yet is reported as previewing, with the applied placement', () => {
  const a = model('a', {});
  const placement: PlacementState = {
    ...emptyPlacementState(),
    preview: { modelIds: ['a'], before: new Map([['a', { translation: [0, 0, 0], rotation: { angle: 0, pivot: [0, 0, 0] }, locked: false }]]), delta: [5, 0, 0], constraint: 'free', source: null, target: null },
  };
  const [out] = positionModels(new Map([['a', a]]), placement);
  assert.equal(out.previewing, true);
  assert.deepEqual(out.correction?.translation, [0, 0, 0]);
  // After Apply a new, empty move starts: nothing waits
  const [empty] = positionModels(new Map([['a', a]]), { ...placement, preview: { ...placement.preview!, delta: [0, 0, 0] } });
  assert.equal(empty.previewing, false);
});
