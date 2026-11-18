/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: the origin of a model in the bare viewer for positioning (origin.ts) */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderFrameWorldOffset } from '@ifc-lite/geometry/world-frame';
import { toRenderTranslation } from '@/lib/model-placement/translation';
import { fileCorrection, type FileCorrection, type Triple } from './correction';
import { displayedOrigin, distanceToBox, isNearModel, NEAR_AT_LEAST, renderBoxAround, workspaceBox, type Box } from './origin';

const near = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

const frame = { wasmRtcOffset: { x: 155000, y: 463000, z: 0 }, originShift: { x: 1, y: 2, z: 3 } };
const none = { translation: [0, 0, 0] as Triple, rotation: { angle: 0, pivot: [0, 0, 0] as Triple } };

/** The correction as BIMpeil IFC writes it: first the turn about the pivot, then the shift */
function applyCorrection(c: FileCorrection, p: Triple): Triple {
  const cos = Math.cos(c.rotation);
  const sin = Math.sin(c.rotation);
  const dx = p[0] - c.pivot[0];
  const dy = p[1] - c.pivot[1];
  return [c.pivot[0] + dx * cos - dy * sin + c.translation[0], c.pivot[1] + dx * sin + dy * cos + c.translation[1], p[2] + c.translation[2]];
}

test('an unmoved origin is drawn at minus the offset of the render frame', () => {
  const offset = renderFrameWorldOffset(frame);
  assert.ok(near(displayedOrigin(frame, none, null), [-offset.x, -offset.y, -offset.z]));
  assert.deepEqual(displayedOrigin(null, none, null), [0, 0, 0]);
});

test('the origin moves with the model: its placement and the move that is shown', () => {
  const placement = { translation: [4, -2, 1] as Triple, rotation: { angle: 0, pivot: [0, 0, 0] as Triple } };
  assert.ok(near(displayedOrigin(null, placement, null), [4, -2, 1]));
  assert.ok(near(displayedOrigin(null, placement, [1, 1, 0]), [5, -1, 1]));
  // A quarter turn about (10, 0, 0) takes the origin to (10, -10, 0)
  const turned = { translation: [0, 0, 0] as Triple, rotation: { angle: Math.PI / 2, pivot: [10, 0, 0] as Triple } };
  assert.ok(near(displayedOrigin(null, turned, null), [10, -10, 0]));
});

test('the marker stands where the correction puts the origin of the file', () => {
  const placement = { translation: [-4.5, 12.25, 0.75] as Triple, rotation: { angle: -0.4, pivot: [3, -7, 1] as Triple } };
  const result = fileCorrection(placement, frame, 'anchor');
  assert.ok(result.ok);
  const offset = renderFrameWorldOffset(frame);
  const written = applyCorrection(result.correction, [0, 0, 0]);
  assert.ok(near(displayedOrigin(frame, placement, null), [written[0] - offset.x, written[1] - offset.y, written[2] - offset.z]));
});

test('a render box (Y up) is a workspace box (Z up) with workspace y minus render z', () => {
  const render = { min: { x: 0, y: 1, z: -5 }, max: { x: 10, y: 4, z: -2 } };
  assert.deepEqual(workspaceBox(render), { min: [0, 2, 1], max: [10, 5, 4] });
  // The corners land in the box both ways
  for (const corner of [[0, 2, 1], [10, 5, 4]] as Triple[]) {
    const [x, y, z] = toRenderTranslation(corner);
    assert.ok(x >= render.min.x && x <= render.max.x && y >= render.min.y && y <= render.max.y && z >= render.min.z && z <= render.max.z);
  }
});

test('distance to a box: zero inside, straight to a side, diagonal to a corner', () => {
  const box: Box = { min: [0, 0, 0], max: [10, 10, 3] };
  assert.equal(distanceToBox([5, 5, 1], box), 0);
  assert.equal(distanceToBox([15, 5, 1], box), 5);
  assert.equal(distanceToBox([-3, -4, 0], box), 5);
});

test('near: within the size of the model and always within 100 m; coordinates of the national grid are far', () => {
  const building: Box = { min: [0, 0, 0], max: [30, 20, 12] };
  assert.equal(NEAR_AT_LEAST, 100);
  assert.equal(isNearModel([0, 0, 0], building), true);
  assert.equal(isNearModel([-60, -50, 0], building), true);
  assert.equal(isNearModel([-150, 0, 0], building), false);
  const site: Box = { min: [0, 0, 0], max: [400, 300, 20] };
  assert.equal(isNearModel([-450, 0, 0], site), true);
  assert.equal(isNearModel([-600, 0, 0], site), false);
  // A building at its place in the Dutch national grid, the origin of the file 155 km and 463 km away
  const placed: Box = { min: [155000, 463000, 0], max: [155030, 463020, 12] };
  assert.equal(isNearModel([0, 0, 0], placed), false);
});

test('the box around models and origins, for All and From above', () => {
  const box = { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 3, z: 10 } };
  assert.deepEqual(renderBoxAround([box], [{ x: -20, y: 0, z: 5 }]), { min: { x: -20, y: 0, z: 0 }, max: { x: 10, y: 3, z: 10 } });
  assert.deepEqual(renderBoxAround([box], []), box);
  assert.equal(renderBoxAround([], []), null);
});
