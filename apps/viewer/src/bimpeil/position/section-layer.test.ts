/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: the section worked from the 3D view (SectionLayer.tsx): its arithmetic, its texts, and its plane on the real store */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { useViewerStore } from '@/store';
import { dragMetres, planeFoot, sectionMenu } from './section';
import { applyPickedSection, flipSection, horizontalSectionAt, moveSectionTo, removeSection, sectionHandle } from './section-scene';
import { sectionAtText, setSectionTexts } from './section-texts';

test('a drag along the arrow on the screen moves the plane by its metres there; across it, not at all; edge on, no drag', () => {
  // One metre along the normal is 50 px to the right on the screen
  const foot = { x: 100, y: 100 };
  const tip = { x: 150, y: 100 };
  assert.equal(dragMetres(foot, tip, { x: 0, y: 0 }, { x: 25, y: 0 }), 0.5);
  assert.equal(dragMetres(foot, tip, { x: 0, y: 0 }, { x: -100, y: 0 }), -2);
  assert.equal(dragMetres(foot, tip, { x: 0, y: 0 }, { x: 0, y: 80 }), 0);
  assert.equal(dragMetres(foot, foot, { x: 0, y: 0 }, { x: 25, y: 0 }), null);
});

test('the menu: on a face through it or horizontal there; with a section also flip and remove; nothing else', () => {
  assert.deepEqual(sectionMenu(true, false), ['throughFace', 'horizontalHere']);
  assert.deepEqual(sectionMenu(true, true), ['throughFace', 'horizontalHere', 'flip', 'remove']);
  assert.deepEqual(sectionMenu(false, true), ['flip', 'remove']);
  assert.deepEqual(sectionMenu(false, false), []);
});

test('the handle stands on the plane under the clicked point, also when the plane moved', () => {
  assert.deepEqual(planeFoot([3, 4, 5], [0, 1, 0], 4), [3, 4, 5]);
  assert.deepEqual(planeFoot([3, 4, 5], [0, 1, 0], 6.5), [3, 6.5, 5]);
});

test('the texts of the page, with its numbers; anything that is not a short text keeps the English one', () => {
  setSectionTexts({ locale: 'nl-NL', menu: 'Doorsnede', throughFace: 'Doorsnede door dit vlak', at: { z: 'Hoogte {{value}}', picked: 'Vanaf het vlak {{value}}' }, flip: 42 });
  assert.equal(sectionAtText('z', 1234.5), 'Hoogte 1.234,500 m');
  assert.equal(sectionAtText('picked', -0.2), 'Vanaf het vlak -0,200 m');
  // Not given: English
  assert.equal(sectionAtText('x', 2), 'X 2,000 m');
  setSectionTexts({ locale: 'en-GB' });
  assert.equal(sectionAtText('z', 4), 'Height 4.000 m');
});

test('a horizontal section exactly at a clicked point; moved, flipped and removed, on the real store of IfcLite', () => {
  removeSection();
  horizontalSectionAt([2, 4.25, -1]);
  const plane = useViewerStore.getState().sectionPlane;
  assert.equal(plane.enabled, true);
  assert.deepEqual(plane.custom?.normal, [0, 1, 0]);
  assert.equal(plane.custom?.distance, 4.25, 'exactly at the point, without the inset of a face');
  assert.equal(plane.showCap, true);
  assert.equal(plane.showOutlines, true);
  let handle = sectionHandle(null)!;
  assert.equal(handle.direction, 'z');
  assert.deepEqual(handle.foot, { x: 2, y: 4.25, z: -1 });
  assert.deepEqual(handle.tip, { x: 2, y: 5.25, z: -1 });
  moveSectionTo(5);
  handle = sectionHandle(null)!;
  assert.equal(handle.distance, 5);
  assert.deepEqual(handle.foot, { x: 2, y: 5, z: -1 });
  const before = useViewerStore.getState().sectionPlane.flipped;
  flipSection();
  assert.equal(useViewerStore.getState().sectionPlane.flipped, !before);
  removeSection();
  assert.equal(useViewerStore.getState().sectionPlane.enabled, false);
  assert.equal(sectionHandle(null), null);
});

test('a section through a clicked face: its own normal, the distance from the face as the place', () => {
  removeSection();
  applyPickedSection({ point: [1, 2, 3], normal: [0.6, 0, 0.8] });
  const handle = sectionHandle(null)!;
  assert.equal(handle.direction, 'picked');
  // The plane lies a little into the face (the inset of IfcLite): at most a few millimetres
  assert.ok(Math.abs(handle.value) <= 0.005, String(handle.value));
  moveSectionTo(handle.distance - 0.25);
  assert.ok(Math.abs(sectionHandle(null)!.value - (handle.value - 0.25)) < 0.0011);
  removeSection();
});
