/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: clicking a face for the section (measure-scene.ts, section-scene.ts), on the real store of IfcLite */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useViewerStore } from '@/store';
import { accepts, measureState, pick, startMeasure, startSectionPick, stopPicking } from './measure-scene';

test('a click on a face while picking for the section puts the section through it, with filled and outlined cuts', () => {
  useViewerStore.getState().setSectionPlaneEnabled(false);
  startSectionPick();
  assert.equal(measureState().picking, 'section');
  assert.equal(accepts('any model'), true);
  pick({ modelId: 'any model', point: [0, 0, 0], kind: 'face', face: { point: [1, 2, 3], normal: [0, 0, -1] } });
  assert.equal(measureState().picking, null);
  const plane = useViewerStore.getState().sectionPlane;
  assert.equal(plane.enabled, true);
  // Without a renderer there is no camera to turn the normal to: as clicked
  assert.deepEqual(plane.custom?.normal, [0, 0, -1]);
  assert.deepEqual(plane.custom?.pickedAt, [1, 2, 3]);
  assert.equal(plane.showCap, true);
  assert.equal(plane.showOutlines, true);
});

test('a click without a face ends picking and cuts nothing; stopping keeps what was measured', () => {
  useViewerStore.getState().setSectionPlaneEnabled(false);
  startSectionPick();
  pick({ modelId: 'any model', point: [0, 0, 0], kind: 'point' });
  assert.equal(measureState().picking, null);
  assert.equal(measureState().missed, true);
  assert.equal(useViewerStore.getState().sectionPlane.enabled, false);
  // Section picking started after measuring on the model: stopping it does not throw the measured points away
  startMeasure('a', 'b');
  startSectionPick();
  stopPicking();
  assert.equal(measureState().picking, null);
});
