/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: from the placement in the viewer to a correction in the file (correction.ts, BIMpeil decision 223) */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelPointToWorkspacePoint } from '@/lib/model-placement/rotation';
import { renderFrameWorldOffset } from '@ifc-lite/geometry/world-frame';
import { fileCorrection, fileToWorkspace, isNoCorrection, type FileCorrection, type Triple } from './correction';

const near = (a: readonly number[], b: readonly number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

/** The correction as BIMpeil writes it: first the turn about the pivot, then the shift (@bimpeil/shared/ifc-edit) */
function applyCorrection(c: FileCorrection, p: Triple): Triple {
  const cos = Math.cos(c.rotation);
  const sin = Math.sin(c.rotation);
  const dx = p[0] - c.pivot[0];
  const dy = p[1] - c.pivot[1];
  return [c.pivot[0] + dx * cos - dy * sin + c.translation[0], c.pivot[1] + dx * sin + dy * cos + c.translation[1], p[2] + c.translation[2]];
}

const frame = { wasmRtcOffset: { x: 155000, y: 463000, z: 0 }, originShift: { x: 1, y: 2, z: 3 } };

test('a shift and a turn are the same in the file; the pivot gets the offset of the render frame', () => {
  const placement = { translation: [1, 2, 3], rotation: { angle: Math.PI / 6, pivot: [10, 20, 0] } };
  const result = fileCorrection(placement, frame, undefined);
  assert.ok(result.ok);
  // Y up shift (1, 2, 3) is (1, -3, 2) in Z up; with the RTC offset (155000, 463000, 0)
  assert.deepEqual(renderFrameWorldOffset(frame), { x: 155001, y: 462997, z: 2 });
  assert.deepEqual(result.correction, { translation: [1, 2, 3], rotation: Math.PI / 6, pivot: [155011, 463017, 2] });
});

test('the correction moves every point of the file to where the viewer draws it', () => {
  const placement = { translation: [-4.5, 12.25, 0.75] as Triple, rotation: { angle: -0.4, pivot: [3, -7, 1] as Triple } };
  const result = fileCorrection(placement, frame, 'anchor');
  assert.ok(result.ok);
  const offset = renderFrameWorldOffset(frame);
  for (const workspace of [[0, 0, 0], [12.5, -3, 4], [-100, 250, -2]] as Triple[]) {
    // The point in the file: the workspace point plus the offset; drawn: the placement of IfcLite on top
    const inFile: Triple = [workspace[0] + offset.x, workspace[1] + offset.y, workspace[2] + offset.z];
    const drawn = modelPointToWorkspacePoint(workspace, placement);
    const expected = [drawn[0] + offset.x, drawn[1] + offset.y, drawn[2] + offset.z];
    assert.ok(near(applyCorrection(result.correction, inFile), expected), `${workspace.join(', ')}`);
  }
});

test('a model near the origin: no offset', () => {
  const result = fileCorrection({ translation: [0, 0, 0], rotation: { angle: 0, pivot: [0, 0, 0] } }, null, 'none');
  assert.ok(result.ok);
  assert.deepEqual(result.correction, { translation: [0, 0, 0], rotation: 0, pivot: [0, 0, 0] });
  assert.ok(isNoCorrection(result.correction));
  assert.ok(!Object.is(result.correction.pivot[1], -0));
});

test('refused: a model that alignment moved into the frame of another model', () => {
  const placement = { translation: [1, 0, 0], rotation: { angle: 0, pivot: [0, 0, 0] } };
  for (const status of ['same-crs', 'reprojected', 'failed']) assert.deepEqual(fileCorrection(placement, frame, status), { ok: false, reason: 'aligned' });
  assert.ok(fileCorrection(placement, frame, 'identity').ok);
  assert.deepEqual(fileCorrection({ ...placement, translation: [Number.NaN, 0, 0] }, frame, 'none'), { ok: false, reason: 'noFrame' });
});

test('a point of the file is drawn where the correction puts it, minus the offset', () => {
  const placement = { translation: [2, -3, 0.5] as Triple, rotation: { angle: 0.7, pivot: [10, 4, 0] as Triple } };
  const result = fileCorrection(placement, frame, undefined);
  assert.ok(result.ok);
  const offset = renderFrameWorldOffset(frame);
  for (const inFile of [[155001, 462997, 2], [155100, 463050, 10]] as Triple[]) {
    const drawn = fileToWorkspace(inFile, frame, placement);
    const corrected = applyCorrection(result.correction, inFile);
    assert.ok(near([drawn[0] + offset.x, drawn[1] + offset.y, drawn[2] + offset.z], corrected));
  }
});
