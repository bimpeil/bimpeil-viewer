/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: classificatieregels (12 oktober 2026, stap K2, besluiten punt 46). Een set uit BIMpeil is een boom van
 * klassen met regels in de vorm van `FilterGroup`; het formaat en de controle staan in BIMpeil
 * (`packages/shared/src/class-rules.ts`), de API onder `/api/projects/:id/class-rules`.
 *
 * Toewijzing, zoals een classificatie in Solibri: de klassen op volgorde; een element komt in de eerste klas waarvan de
 * regels passen en probeert daarna de kinderen van die klas; past geen kind, dan blijft het in de klas zelf. Een klas
 * zonder regels past op alles wat de ouder doorlaat. Zo heeft elk element binnen een set hooguit één klas.
 *
 * Deze module is zonder store en zonder React (te testen met een eigen `evaluate`); de store en het rekenen op de
 * geladen modellen staan in classRulesStore.ts.
 */

import { isFilterGroup, type FilterGroup } from '@ifc-lite/rules';

export interface RuleClass {
  id: string;
  code?: string;
  name: string;
  color: string;
  groups: FilterGroup[];
  children?: RuleClass[];
}

export interface ClassRulesDefinition {
  schema: 1;
  classes: RuleClass[];
}

/** Een set in de lijst van het project */
export interface ClassRuleSetSummary {
  id: string;
  name: string;
  description: string | null;
  version: number;
  classCount: number;
}

/** Een geladen set: de gekozen versie met de definitie */
export interface LoadedClassRuleSet {
  id: string;
  name: string;
  version: number;
  latestVersion: number;
  definition: ClassRulesDefinition;
  canEdit: boolean;
}

/** Kandidaten of treffers per model: expressIds */
export type IdsByModel = Map<string, number[]>;

/** Rekent de regels van één klas uit binnen de kandidaten; geeft de treffers per model */
export type EvaluateGroups = (groups: FilterGroup[], candidates: IdsByModel) => Promise<IdsByModel>;

export interface Assignment {
  /** Per klas de elementen die in die klas zelf staan (niet in een kind) */
  own: Map<string, IdsByModel>;
  /** Per klas alles eronder, ook in de kinderen */
  all: Map<string, IdsByModel>;
  /** Wat in geen enkele klas past */
  unclassified: IdsByModel;
}

const count = (ids: IdsByModel) => [...ids.values()].reduce((n, list) => n + list.length, 0);
export const idsCount = count;

/** `a` zonder wat in `b` staat */
function without(a: IdsByModel, b: IdsByModel): IdsByModel {
  const out: IdsByModel = new Map();
  for (const [modelId, list] of a) {
    const drop = new Set(b.get(modelId) ?? []);
    const kept = drop.size ? list.filter((id) => !drop.has(id)) : list;
    if (kept.length) out.set(modelId, kept);
  }
  return out;
}

/** Alleen wat ook in `scope` staat (de evaluator mag nooit buiten de kandidaten treffen, maar zeker is zeker) */
function within(found: IdsByModel, scope: IdsByModel): IdsByModel {
  const out: IdsByModel = new Map();
  for (const [modelId, list] of found) {
    const allowed = new Set(scope.get(modelId) ?? []);
    const kept = list.filter((id) => allowed.has(id));
    if (kept.length) out.set(modelId, kept);
  }
  return out;
}

/**
 * De klassen toewijzen aan de kandidaten (de elementen van de geladen modellen). Elke klas rekent alleen op wat zijn
 * ouder doorliet en wat een eerdere broer of zus nog niet nam.
 */
export async function assignClasses(classes: RuleClass[], candidates: IdsByModel, evaluate: EvaluateGroups, signal?: AbortSignal): Promise<Assignment> {
  const own = new Map<string, IdsByModel>();
  const all = new Map<string, IdsByModel>();
  const walk = async (list: RuleClass[], pool: IdsByModel): Promise<IdsByModel> => {
    let remaining = pool;
    for (const cls of list) {
      if (signal?.aborted) throw new DOMException('Classificatieregels afgebroken', 'AbortError');
      const matched = count(remaining) === 0 ? new Map() : cls.groups.length === 0 ? remaining : within(await evaluate(cls.groups, remaining), remaining);
      remaining = without(remaining, matched);
      all.set(cls.id, matched);
      own.set(cls.id, cls.children?.length ? await walk(cls.children, matched) : matched);
    }
    return remaining;
  };
  const unclassified = await walk(classes, candidates);
  return { own, all, unclassified };
}

/** De klassen in boomvolgorde, met hun diepte */
export function flattenClasses(classes: RuleClass[], depth = 0): { cls: RuleClass; depth: number }[] {
  return classes.flatMap((cls) => [{ cls, depth }, ...flattenClasses(cls.children ?? [], depth + 1)]);
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Wat de API teruggeeft, nog eens nagaan in de vorm van IfcLite; anders liever niets dan een verkeerde klas */
export function parseDefinition(raw: unknown): ClassRulesDefinition | null {
  if (!isObject(raw) || raw.schema !== 1 || !Array.isArray(raw.classes)) return null;
  const walk = (list: unknown[]): RuleClass[] | null => {
    const out: RuleClass[] = [];
    for (const item of list) {
      if (!isObject(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.color !== 'string') return null;
      if (!Array.isArray(item.groups) || !item.groups.every(isFilterGroup)) return null;
      const children = Array.isArray(item.children) ? walk(item.children) : [];
      if (!children) return null;
      out.push({
        id: item.id,
        ...(typeof item.code === 'string' ? { code: item.code } : {}),
        name: item.name,
        color: item.color,
        groups: item.groups as FilterGroup[],
        ...(children.length ? { children } : {}),
      });
    }
    return out;
  };
  const classes = walk(raw.classes);
  return classes ? { schema: 1, classes } : null;
}
