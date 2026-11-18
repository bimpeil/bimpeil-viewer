/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: measuring the angle between a line on the model and a line on the reference, seen from above, for the
 * bare viewer for positioning (measure-scene.ts). Pure, so the rules are fixed cases (measure.test.ts).
 */

/** Shorter than this seen from above (metres), a line has no direction worth measuring */
export const MIN_PLAN_LENGTH = 0.01;

/**
 * The turn (radians, counter-clockwise seen from above) that makes the line a1 to a2 parallel to the line b1 to b2,
 * the smallest one: between minus and plus a quarter turn, since a line has no front and back and which point was
 * clicked first should not matter. Null when a line is too short seen from above.
 */
export function planAngle(a1: readonly number[], a2: readonly number[], b1: readonly number[], b2: readonly number[]): number | null {
  const ax = a2[0] - a1[0];
  const ay = a2[1] - a1[1];
  const bx = b2[0] - b1[0];
  const by = b2[1] - b1[1];
  if (Math.hypot(ax, ay) < MIN_PLAN_LENGTH || Math.hypot(bx, by) < MIN_PLAN_LENGTH) return null;
  let angle = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  if (angle > Math.PI / 2) angle -= Math.PI;
  else if (angle <= -Math.PI / 2) angle += Math.PI;
  return angle + 0;
}
