/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: vaste gevallen voor de lijsten van IDS uit BIMpeil (BimpeilIdsSource.tsx). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { idsFilesOf, usableTemplates } from './BimpeilIdsSource';

test('IDS bestanden: alleen .ids met een versie, de nieuwste, op naam', () => {
  const files = [
    { id: 'a', name: 'PRJ-VDM-ZZ-XX-SP-H-0002.ids', versions: [{ id: 'v2', isoStatus: 'Published', suitability: 'A', revision: 'A1' }, { id: 'v1', isoStatus: 'Shared', suitability: 'TA', revision: 'V01' }] },
    { id: 'b', name: 'model.ifc', versions: [{ id: 'm', isoStatus: 'WIP', suitability: 'S0', revision: null }] },
    { id: 'c', name: 'Basis.IDS', versions: [{ id: 'c1', isoStatus: 'WIP', suitability: 'S0', revision: null }] },
    { id: 'd', name: 'leeg.ids', versions: [] },
  ];
  assert.deepEqual(idsFilesOf(files), [
    { fileId: 'c', versionId: 'c1', name: 'Basis.IDS', status: 'WIP, S0' },
    { fileId: 'a', versionId: 'v2', name: 'PRJ-VDM-ZZ-XX-SP-H-0002.ids', status: 'Gepubliceerd, A A1' },
  ]);
});

test('sjablonen: vervallen weg, op naam', () => {
  const list = [
    { versionId: '2', system: 'MiniBIM ILS (VO)', version: '3.1' },
    { versionId: '1', system: 'BIM basis ILS (IFC4)', version: '2.0' },
    { versionId: '3', system: 'Oud', version: '1', deprecated: true },
  ];
  assert.deepEqual(usableTemplates(list).map((t) => t.versionId), ['1', '2']);
});
