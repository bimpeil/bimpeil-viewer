/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** BIMpeil: vaste gevallen voor classificatieregels (classRules.ts, classRulesTree.ts): toewijzing, lezen en de boom. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FilterGroup } from '@ifc-lite/rules';
import { assignClasses, flattenClasses, idsCount, parseDefinition, type EvaluateGroups, type IdsByModel, type RuleClass } from './classRules';
import { classBuckets, OWN_LABEL, UNCLASSIFIED_LABEL } from './classRulesTree';
import type { ClassMember, ClassResult } from './classRulesStore';

/**
 * Een kleine wereld zonder model: elementen met een klasse en een eigenschap. De nep `evaluate` begrijpt alleen
 * ifcType (in) en property (eq) en kijkt, zoals de echte, alleen naar de kandidaten.
 */
const ELEMENTS: Record<number, { type: string; loadBearing?: string }> = {
  1: { type: 'IfcWall', loadBearing: 'true' },
  2: { type: 'IfcWall', loadBearing: 'false' },
  3: { type: 'IfcWall' },
  4: { type: 'IfcSlab', loadBearing: 'true' },
  5: { type: 'IfcDoor' },
  6: { type: 'IfcWindow' },
};
const all = (): IdsByModel => new Map([['m1', Object.keys(ELEMENTS).map(Number)]]);
const type = (...values: string[]): FilterGroup => ({ combinator: 'AND', rules: [{ kind: 'ifcType', op: 'in', values }] });
const loadBearing = (value: string): FilterGroup => ({
  combinator: 'AND',
  rules: [{ kind: 'property', setName: 'Pset_WallCommon', propertyName: 'LoadBearing', op: 'eq', value }],
});
let calls = 0;
const evaluate: EvaluateGroups = async (groups, candidates) => {
  calls++;
  const hit = (id: number) =>
    groups.some((g) =>
      g.rules.every((r) =>
        r.kind === 'ifcType' ? r.values.includes(ELEMENTS[id].type) : r.kind === 'property' ? ELEMENTS[id].loadBearing === r.value : false,
      ),
    );
  return new Map([...candidates].map(([m, ids]) => [m, ids.filter(hit)]));
};
const cls = (id: string, groups: FilterGroup[], children?: RuleClass[]): RuleClass => ({ id, name: id, color: '#123456', groups, ...(children ? { children } : {}) });
const ids = (map: Map<string, IdsByModel>, id: string) => map.get(id)?.get('m1') ?? [];

test('eerste klas wint; een latere klas krijgt alleen wat over is', async () => {
  const r = await assignClasses([cls('dragend', [loadBearing('true')]), cls('wanden', [type('IfcWall')])], all(), evaluate);
  assert.deepEqual(ids(r.own, 'dragend'), [1, 4]);
  assert.deepEqual(ids(r.own, 'wanden'), [2, 3], 'wand 1 is al dragend');
  assert.deepEqual(r.unclassified.get('m1'), [5, 6]);
});

test('kinderen alleen binnen de ouder; wat geen kind past, blijft in de ouder', async () => {
  const r = await assignClasses(
    [cls('wanden', [type('IfcWall')], [cls('dragend', [loadBearing('true')]), cls('niet', [loadBearing('false')])]), cls('rest', [])],
    all(),
    evaluate,
  );
  assert.deepEqual(ids(r.own, 'dragend'), [1], 'de dragende vloer 4 is geen wand');
  assert.deepEqual(ids(r.own, 'niet'), [2]);
  assert.deepEqual(ids(r.own, 'wanden'), [3], 'zonder LoadBearing in de ouder');
  assert.deepEqual(ids(r.all, 'wanden'), [1, 2, 3]);
  assert.deepEqual(ids(r.own, 'rest'), [4, 5, 6], 'een klas zonder regels neemt de rest');
  assert.equal(idsCount(r.unclassified), 0);
});

test('elk element hooguit één klas, en niet rekenen als er niets meer over is', async () => {
  calls = 0;
  const r = await assignClasses([cls('alles', []), cls('wanden', [type('IfcWall')]), cls('deuren', [type('IfcDoor')])], all(), evaluate);
  assert.deepEqual(ids(r.own, 'alles'), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ids(r.own, 'wanden'), []);
  assert.equal(calls, 0, 'na "alles" is er niets meer te rekenen');
  const seen = flattenClasses([cls('alles', []), cls('wanden', []), cls('deuren', [])]).flatMap(({ cls: c }) => ids(r.own, c.id));
  assert.equal(new Set(seen).size, seen.length);
});

test('een treffer buiten de kandidaten telt niet (vangnet om de evaluator)', async () => {
  const wild: EvaluateGroups = async () => new Map([['m1', [1, 99]], ['m2', [7]]]);
  const r = await assignClasses([cls('a', [type('IfcWall')])], new Map([['m1', [1, 2]]]), wild);
  assert.deepEqual([...r.own.get('a')!], [['m1', [1]]]);
});

test('afbreken stopt het rekenen', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(assignClasses([cls('a', [type('IfcWall')])], all(), evaluate, controller.signal), { name: 'AbortError' });
});

test('lezen: alleen de vorm van IfcLite, anders niets', () => {
  const ok = parseDefinition({ schema: 1, classes: [{ id: 'a', name: 'A', code: '21', color: '#000000', groups: [type('IfcWall')], children: [] }] });
  assert.deepEqual(ok, { schema: 1, classes: [{ id: 'a', code: '21', name: 'A', color: '#000000', groups: [type('IfcWall')] }] });
  assert.equal(parseDefinition({ schema: 2, classes: [] }), null);
  assert.equal(parseDefinition({ schema: 1, classes: [{ id: 'a', name: 'A', color: '#000000', groups: [{ rules: 'x', combinator: 'AND' }] }] }), null);
  assert.equal(parseDefinition({ schema: 1, classes: [{ id: 'a', name: 'A', color: '#000000', groups: [], children: [{ id: 'b' }] }] }), null);
});

test('boom: klassen op volgorde, (in de klas zelf) alleen bij kinderen, niet geclassificeerd onderaan', () => {
  const m = (expressId: number): ClassMember => ({ modelId: 'm1', expressId, globalId: expressId + 100 });
  const classes = [cls('wanden', [type('IfcWall')], [cls('dragend', [])]), cls('deuren', [])];
  const result: ClassResult = {
    own: new Map([['wanden', [m(3)]], ['dragend', [m(1)]], ['deuren', []]]),
    all: new Map([['wanden', [m(1), m(3)]], ['dragend', [m(1)]], ['deuren', []]]),
    unclassified: [m(6)],
  };
  const buckets = classBuckets(classes, result);
  assert.deepEqual(buckets.map((b) => `${b.label}:${b.members.length}`), ['wanden:2', 'deuren:0', `${UNCLASSIFIED_LABEL}:1`]);
  assert.deepEqual(buckets[0].children?.map((b) => `${b.label}:${b.members.length}`), ['dragend:1', `${OWN_LABEL}:1`]);
  assert.equal(buckets[1].children, undefined);
});
