/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: the section of the bare viewer, from the slider to a plane and back to metres in the file (section.ts) */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toRenderTranslation } from '@/lib/model-placement/translation';
import { directionOf, sectionFraction, sectionNormal, sectionPlaneAt, sectionRange, sectionValue, type RenderBox } from './section';

/** A scene in the render frame (Y up): file X 10..30, file Y 5..25 (render Z -25..-5), height 0..12 */
const box: RenderBox = { min: { x: 10, y: 0, z: -25 }, max: { x: 30, y: 12, z: -5 } };
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('the range of each direction is the extent of the scene along that axis of the file', () => {
  assert.deepEqual(sectionRange('z', box), { min: 0, max: 12 });
  assert.deepEqual(sectionRange('x', box), { min: 10, max: 30 });
  assert.deepEqual(sectionRange('y', box), { min: 5, max: 25 });
});

test('the plane at a place of the slider lies there, through the middle of the scene, with a unit normal', () => {
  for (const direction of ['z', 'x', 'y'] as const) {
    for (const fraction of [0, 0.25, 1]) {
      const plane = sectionPlaneAt(direction, fraction, box);
      const range = sectionRange(direction, box);
      assert.ok(Math.abs(plane.distance - (range.min + fraction * (range.max - range.min))) < 1e-12);
      assert.ok(Math.abs(dot(plane.point, plane.normal) - plane.distance) < 1e-12, 'the point lies on the plane');
      assert.equal(Math.hypot(...plane.normal), 1);
      assert.ok(Math.abs(sectionFraction(direction, plane.distance, box) - fraction) < 1e-12, 'and back to the slider');
    }
  }
  // Outside 0 to 1, or not a number: the ends, or the middle
  assert.equal(sectionPlaneAt('z', 2, box).distance, 12);
  assert.equal(sectionPlaneAt('z', -1, box).distance, 0);
  assert.equal(sectionPlaneAt('z', Number.NaN, box).distance, 6);
});

test('the distance along the normal is the coordinate of the file axis minus the offset of the render frame', () => {
  // A point of the file at (17, 9, 4), drawn with an offset of (100, 200, 3)
  const offset = { x: 100, y: 200, z: 3 };
  const file = [117, 209, 7];
  const render = toRenderTranslation([file[0] - offset.x, file[1] - offset.y, file[2] - offset.z]);
  assert.ok(Math.abs(sectionValue('x', dot(render, sectionNormal('x')), offset) - 117) < 1e-12);
  assert.ok(Math.abs(sectionValue('y', dot(render, sectionNormal('y')), offset) - 209) < 1e-12);
  assert.ok(Math.abs(sectionValue('z', dot(render, sectionNormal('z')), offset) - 7) < 1e-12);
});

test('the direction of a normal: only the three of this viewer, anything else is no direction (a picked face)', () => {
  assert.equal(directionOf([0, 1, 0]), 'z');
  assert.equal(directionOf([1, 0, 0]), 'x');
  assert.equal(directionOf([0, 0, -1]), 'y');
  assert.equal(directionOf([0, 0, 1]), null);
  assert.equal(directionOf([0.6, 0.8, 0]), null);
});
