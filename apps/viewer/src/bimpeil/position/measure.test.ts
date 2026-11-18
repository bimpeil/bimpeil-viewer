/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: the angle between a line on the model and a line on the reference, seen from above (measure.ts) */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planAngle } from './measure';

const deg = (r: number | null) => (r === null ? null : Math.round(((r * 180) / Math.PI) * 1e9) / 1e9);
const at = (d: number, length = 10): [number, number, number] => [length * Math.cos((d * Math.PI) / 180), length * Math.sin((d * Math.PI) / 180), 0];

test('counter-clockwise seen from above is positive', () => {
  assert.equal(deg(planAngle([0, 0, 0], [10, 0, 0], [0, 0, 0], at(10))), 10);
  assert.equal(deg(planAngle([0, 0, 0], [10, 0, 0], [0, 0, 0], at(-10))), -10);
  assert.equal(deg(planAngle([5, 5, 0], [5, 15, 0], [100, 100, 0], [100, 120, 0])), 0);
});

test('which point was clicked first does not matter: the smallest turn that makes the lines parallel', () => {
  // The reference clicked the other way round
  assert.equal(deg(planAngle([0, 0, 0], [10, 0, 0], at(10), [0, 0, 0])), 10);
  assert.equal(deg(planAngle([10, 0, 0], [0, 0, 0], [0, 0, 0], at(-3))), -3);
  // 100 degrees is 80 the other way
  assert.equal(deg(planAngle([0, 0, 0], [10, 0, 0], [0, 0, 0], at(100))), -80);
  // A quarter turn is plus a quarter turn, whichever way
  assert.equal(deg(planAngle([0, 0, 0], [10, 0, 0], [0, 0, 0], at(90))), 90);
  assert.equal(deg(planAngle([0, 0, 0], [10, 0, 0], [0, 0, 0], at(-90))), 90);
});

test('seen from above: heights do not count', () => {
  assert.equal(deg(planAngle([0, 0, 0], [10, 0, 30], [0, 0, -5], [10, 0, 5])), 0);
});

test('a line too short seen from above has no angle', () => {
  assert.equal(planAngle([0, 0, 0], [0, 0, 3], [0, 0, 0], [10, 0, 0]), null);
  assert.equal(planAngle([0, 0, 0], [10, 0, 0], [1, 1, 0], [1.005, 1, 0]), null);
});
