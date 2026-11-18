/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: zooming in stops short of what is under the cursor, also where IfcLite skips finding it (surface-zoom.ts).
 * A real `Camera` of IfcLite; the scene is a thin object 8 m in front of the camera, with the orbit target 100 m behind
 * it, as with a small origin object in front of four large models.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Camera } from '@ifc-lite/renderer';
import { wrapSurfaceZoom, type SurfaceFinder } from './surface-zoom';

const OBJECT_Z = 2;
const WIDTH = 800;
const HEIGHT = 600;
/** One notch of a mouse wheel, toward the screen */
const NOTCH_IN = -100;

function rig() {
  const camera = new Camera();
  camera.setAspect(WIDTH / HEIGHT);
  camera.setPosition(0, 0, 10);
  camera.setTarget(0, 0, -100);
  const finds: Array<[number, number]> = [];
  // The object: the plane z = 2 where the ray of the camera through the point crosses it in front of the camera
  const find: SurfaceFinder = (x, y, width, height) => {
    finds.push([x, y]);
    const ray = camera.unprojectToRay(x, y, width, height);
    if (!(ray.direction.z < 0)) return null;
    const t = (OBJECT_Z - ray.origin.z) / ray.direction.z;
    return t > 0 ? { x: ray.origin.x + ray.direction.x * t, y: ray.origin.y + ray.direction.y * t, z: OBJECT_Z } : null;
  };
  let clock = 1_000_000;
  const tick = (ms: number) => (clock += ms);
  const unwrap = wrapSurfaceZoom(camera, find, () => ({ width: WIDTH, height: HEIGHT }), () => clock);
  const notch = (x = WIDTH / 2, y = HEIGHT / 2, delta = NOTCH_IN, fast = false) => {
    camera.zoom(delta, false, x, y, WIDTH, HEIGHT, fast);
    tick(16);
    return camera.getPosition().z;
  };
  return { camera, finds, tick, unwrap, notch };
}

test('without the point, as IfcLite above its limit, one notch passes straight through the object (the defect)', () => {
  const camera = new Camera();
  camera.setAspect(WIDTH / HEIGHT);
  camera.setPosition(0, 0, 10);
  camera.setTarget(0, 0, -100);
  camera.zoom(NOTCH_IN, false, WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, false);
  assert.ok(camera.getPosition().z < OBJECT_Z, `plain zoom did not pass the object: z ${camera.getPosition().z}`);
});

test('with the point, sixty notches come close to the object and never pass it', () => {
  const { notch } = rig();
  const zs = Array.from({ length: 60 }, () => notch());
  assert.ok(zs[0] < 10, 'a notch toward the screen must zoom in');
  assert.ok(Math.min(...zs) > OBJECT_Z, `passed the object: min z ${Math.min(...zs)}`);
  assert.ok(zs[zs.length - 1] < OBJECT_Z + 0.1, `did not come close: z ${zs[zs.length - 1]}`);
});

test('an off centre cursor keeps the point under the cursor and does not pass the object either', () => {
  const { notch, camera } = rig();
  for (let i = 0; i < 40; i++) notch(600, 200);
  assert.ok(camera.getPosition().z > OBJECT_Z);
});

test('zooming out, the plain dolly (Shift) and a point of IfcLite itself are left alone', () => {
  const { camera, finds, notch } = rig();
  notch(WIDTH / 2, HEIGHT / 2, 100);
  assert.ok(camera.getPosition().z > 10, 'zooming out moves back');
  notch(WIDTH / 2, HEIGHT / 2, NOTCH_IN, true);
  const given = { x: 0, y: 0, z: 5 };
  camera.zoom(NOTCH_IN, false, WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, false, given);
  assert.equal(finds.length, 0);
});

test('one find per gesture; again after a pause, after the cursor moved, and after the camera moved otherwise', () => {
  const { camera, finds, tick, notch } = rig();
  notch();
  notch();
  notch();
  assert.equal(finds.length, 1, 'one gesture, one find');
  tick(500);
  notch();
  assert.equal(finds.length, 2, 'a pause starts a new gesture');
  notch(WIDTH / 2 + 10, HEIGHT / 2);
  assert.equal(finds.length, 3, 'the cursor moved');
  notch(WIDTH / 2 + 12, HEIGHT / 2);
  assert.equal(finds.length, 3, 'within the slop of the gesture');
  camera.orbit(30, 0);
  notch(WIDTH / 2 + 12, HEIGHT / 2);
  assert.equal(finds.length, 4, 'an orbit in between');
});

test('a robust orbit anchor (a few elements far from the rest, such as an origin object) does not stop the find', () => {
  const { camera, finds, notch } = rig();
  camera.setOrbitAnchorBounds({ min: { x: -50, y: -50, z: -150 }, max: { x: 50, y: 50, z: -50 } });
  const zs = Array.from({ length: 30 }, () => notch());
  assert.equal(finds.length, 1);
  assert.ok(Math.min(...zs) > OBJECT_Z);
});

test('a zoom without a cursor (keys, toolbar) finds the surface under the centre of the canvas', () => {
  const { camera, finds } = rig();
  camera.zoom(NOTCH_IN, false);
  assert.deepEqual(finds, [[WIDTH / 2, HEIGHT / 2]]);
});

test('unwrapping puts the zoom of IfcLite back', () => {
  const { camera, finds, unwrap } = rig();
  unwrap();
  camera.zoom(NOTCH_IN, false, WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, false);
  assert.equal(finds.length, 0);
  assert.ok(camera.getPosition().z < OBJECT_Z, 'back to the plain zoom');
});
