/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: the state of moving as the page Positioning hears it (session.ts, BIMpeil IFC decision 5) */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyPlacementState, type PlacementState } from '@/lib/model-placement/state';
import { positionSession } from './session';

const still = { translation: [0, 0, 0] as const, rotation: { angle: 0, pivot: [0, 0, 0] as const }, locked: false };

test('closed: nothing moves, nothing is picked', () => {
  const s = positionSession(false, emptyPlacementState(), null);
  assert.deepEqual(s, { open: false, moving: null, reference: null, role: null, delta: [0, 0, 0], previewing: false, source: null, target: null, hover: null, canUndo: false, canRedo: false, basepoints: false, error: null });
});

test('open, picking a point on the model that moves, with a move shown', () => {
  const placement: PlacementState = {
    ...emptyPlacementState(),
    preview: { modelIds: ['a'], before: new Map([['a', still]]), delta: [1, -0, 2], constraint: 'free', source: { modelId: 'a', point: [0, 0, 0], kind: 'vertex' }, target: null },
    undo: [{ id: 1, timestamp: 0, before: new Map(), after: new Map() }],
  };
  const runtime = { selected: ['a'], reference: 'b', role: 'source' as const, hover: { modelId: 'a', point: [1, 2, 3] as const, kind: 'edge' as const }, error: '' };
  const s = positionSession(true, placement, runtime);
  assert.equal(s.moving, 'a');
  assert.equal(s.reference, 'b');
  assert.equal(s.role, 'source');
  assert.deepEqual(s.delta, [1, 0, 2]);
  assert.ok(!Object.is(s.delta[1], -0));
  assert.equal(s.previewing, true);
  assert.equal(s.source, 'vertex');
  assert.equal(s.hover, 'edge');
  assert.equal(s.canUndo, true);
  assert.equal(s.error, null);
});

test('after Apply: a new, empty move for the same model, nothing waits', () => {
  const placement: PlacementState = { ...emptyPlacementState(), preview: { modelIds: ['a'], before: new Map([['a', still]]), delta: [0, 0, 0], constraint: 'free', source: null, target: null } };
  const s = positionSession(true, placement, { selected: ['a'], reference: 'b', role: null, hover: null, error: 'Model bounds are not available yet.' });
  assert.equal(s.previewing, false);
  assert.equal(s.hover, null);
  assert.equal(s.error, 'Model bounds are not available yet.');
  assert.equal(positionSession(true, placement, null, true).basepoints, true);
});
