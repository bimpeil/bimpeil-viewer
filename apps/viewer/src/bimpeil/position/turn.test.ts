/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: turning about a point as it is drawn (turn.ts) */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyPlacementState, placementFor, type ModelPlacement, type PlacementState } from '@/lib/model-placement/state';
import { modelPointToWorkspacePoint, rotateWorkspacePoint } from '@/lib/model-placement/rotation';
import type { Translation } from '@/lib/model-placement/translation';
import { turnAbout } from './turn';

const near = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
const deg = (d: number) => (d * Math.PI) / 180;

function withPlacement(placement: Partial<ModelPlacement>): PlacementState {
  const full: ModelPlacement = { translation: [0, 0, 0], rotation: { angle: 0, pivot: [0, 0, 0] }, locked: false, ...placement };
  return { ...emptyPlacementState(), placements: new Map([['a', full]]) };
}
const drawn = (state: PlacementState, local: Translation) => modelPointToWorkspacePoint(local, placementFor(state, 'a'));

test('the pivot stays where it is drawn, the model turns about it', () => {
  const before = withPlacement({ translation: [5, 0, 0] });
  const after = turnAbout(before, 'a', deg(90), [10, 0, 0]);
  // The point of the model drawn at the pivot stays there
  assert.ok(near(drawn(after, [5, 0, 0]), [10, 0, 0]));
  // The origin of the model, drawn at (5, 0, 0), goes a quarter turn about (10, 0) to (10, -5)
  assert.ok(near(drawn(after, [0, 0, 0]), [10, -5, 0]));
  assert.equal(placementFor(after, 'a').rotation.angle, deg(90));
});

test('on a model that is turned already: the same as turning what is drawn by the difference about the pivot', () => {
  const before = withPlacement({ translation: [1, 2, 0.5], rotation: { angle: deg(30), pivot: [3, -1, 0] } });
  const pivot: Translation = [7, 4, 1];
  const after = turnAbout(before, 'a', deg(50), pivot);
  for (const local of [[0, 0, 0], [12.5, -3, 4], [-100, 250, -2], [3, -1, 0]] as Translation[]) {
    const expected = rotateWorkspacePoint(drawn(before, local), { angle: deg(20), pivot });
    assert.ok(near(drawn(after, local), expected), `${local}`);
  }
  assert.ok(Math.abs(placementFor(after, 'a').rotation.angle - deg(50)) < 1e-12);
  // Heights stay
  assert.equal(placementFor(after, 'a').translation[2], 0.5);
});

test('one command in the history; undo gives the placement before; a move that was shown is committed', () => {
  const placement: ModelPlacement = { translation: [0, 0, 0], rotation: { angle: 0, pivot: [0, 0, 0] }, locked: false };
  const shown: PlacementState = {
    ...withPlacement(placement),
    preview: { modelIds: ['a'], before: new Map([['a', placement]]), delta: [2, 0, 0], constraint: 'free', source: null, target: null },
  };
  const after = turnAbout(shown, 'a', deg(10), [2, 0, 0]);
  assert.equal(after.preview, null);
  assert.equal(after.undo.length, 1);
  assert.deepEqual(after.redo, []);
  assert.deepEqual(after.undo[0].before.get('a'), placement);
  // The shown move is in: the point drawn at (2, 0, 0) is the origin of the model, and it stays there
  assert.ok(near(drawn(after, [0, 0, 0]), [2, 0, 0]));
});

test('the same heading again: no step in the history', () => {
  const before = withPlacement({ translation: [1, 1, 0], rotation: { angle: deg(15), pivot: [0, 0, 0] } });
  const after = turnAbout(before, 'a', deg(15), [40, -3, 0]);
  assert.equal(after.undo.length, 0);
  assert.deepEqual(placementFor(after, 'a'), placementFor(before, 'a'));
});

test('a locked model is not turned; a pivot or angle that is not a number is refused', () => {
  assert.throws(() => turnAbout(withPlacement({ locked: true }), 'a', deg(5), [0, 0, 0]), /Unlock/);
  assert.throws(() => turnAbout(withPlacement({}), 'a', Number.NaN, [0, 0, 0]), /finite/);
  assert.throws(() => turnAbout(withPlacement({}), 'a', deg(5), [Number.POSITIVE_INFINITY, 0, 0]), /finite/);
});
