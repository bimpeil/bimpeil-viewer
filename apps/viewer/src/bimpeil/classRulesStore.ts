/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: classificatieregels in de viewer (K2). Haalt de sets van het actieve project uit BIMpeil, rekent de gekozen
 * set uit op de geladen modellen (classRules.ts) en levert:
 *  - per klas de elementen, voor het paneel en de boom (classRulesTree.ts);
 *  - een lens met één regel per klas en de treffers al uitgerekend; useLens.ts van IfcLite gebruikt die als de lens
 *    aan staat, zodat kleuren, het grijs maken van de rest en het samenspel met IDS en clash werken zoals bij elke lens.
 *
 * De gekozen set wordt per project onthouden in de browser (alleen gemak). Opnieuw rekenen gebeurt bij een andere set
 * of als de modellen veranderen (useBimpeilClassRulesSync in ViewerLayout).
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import type { Lens } from '@ifc-lite/lens';
import { evaluateFilterGroupsFederated } from '@ifc-lite/rules';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { definedModelTagIdsOf, evaluatorModelsFromState } from '@/lib/model-tags/evaluator-models';
import { isProductTreeClass } from '@/components/viewer/hierarchy/productTreeClasses';
import { useBimpeilContext } from './context';
import {
  assignClasses,
  flattenClasses,
  parseDefinition,
  type ClassRuleSetSummary,
  type EvaluateGroups,
  type IdsByModel,
  type LoadedClassRuleSet,
} from './classRules';

/** Id van de lens die de klassen kleurt; staat niet tussen de lenzen van IfcLite en wordt nooit bewaard */
export const CLASS_RULES_LENS_ID = 'bimpeil-classificatieregels';

/** Een element in een klas */
export interface ClassMember {
  modelId: string;
  expressId: number;
  globalId: number;
}

export interface ClassResult {
  /** Per klas de elementen in die klas zelf */
  own: Map<string, ClassMember[]>;
  /** Per klas alle elementen eronder (ook in de kinderen) */
  all: Map<string, ClassMember[]>;
  unclassified: ClassMember[];
}

interface State {
  projectId: string | null;
  sets: ClassRuleSetSummary[] | null;
  canEdit: boolean;
  listError: string | null;
  loaded: LoadedClassRuleSet | null;
  loading: boolean;
  /** Bezig met rekenen op de modellen */
  computing: boolean;
  result: ClassResult | null;
  error: string | null;
  /** De lens voor useLens, met de treffers per regel (klas) */
  lens: { lens: Lens; matched: Map<string, Set<number>> } | null;
}

export const useClassRules = create<State>(() => ({
  projectId: null,
  sets: null,
  canEdit: false,
  listError: null,
  loaded: null,
  loading: false,
  computing: false,
  result: null,
  error: null,
  lens: null,
}));

const rememberKey = (projectId: string) => `bimpeil:classificatieregels:${projectId}`;
function remembered(projectId: string): string | null {
  try {
    return localStorage.getItem(rememberKey(projectId));
  } catch {
    return null;
  }
}
function remember(projectId: string, setId: string | null) {
  try {
    if (setId) localStorage.setItem(rememberKey(projectId), setId);
    else localStorage.removeItem(rememberKey(projectId));
  } catch {
    // Alleen gemak
  }
}

async function json<T>(path: string): Promise<T> {
  const r = await fetch(path);
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw Object.assign(new Error(d.error ?? `BIMpeil antwoordt met ${r.status}`), { status: r.status });
  return d;
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** De sets van het project ophalen; zonder gekozen set de vorige keuze in deze browser openen */
export async function loadClassRuleSets(projectId: string): Promise<void> {
  useClassRules.setState({ listError: null });
  try {
    const d = await json<{ sets: ClassRuleSetSummary[]; canEdit: boolean }>(`/api/projects/${projectId}/class-rules`);
    if (useClassRules.getState().projectId !== projectId) return;
    useClassRules.setState({ sets: d.sets, canEdit: d.canEdit });
    const { loaded } = useClassRules.getState();
    const last = remembered(projectId);
    if (!loaded && last && d.sets.some((s) => s.id === last)) await chooseClassRuleSet(last);
  } catch (e) {
    if (useClassRules.getState().projectId === projectId) useClassRules.setState({ sets: [], listError: message(e) });
  }
}

/** Een set kiezen (de laatste versie, of `version`); null zet de keuze uit */
export async function chooseClassRuleSet(setId: string | null, version?: number): Promise<void> {
  const { projectId } = useClassRules.getState();
  if (!projectId) return;
  if (!setId) {
    remember(projectId, null);
    showClassColors(false);
    useClassRules.setState({ loaded: null, result: null, lens: null, error: null });
    return;
  }
  useClassRules.setState({ loading: true, error: null });
  try {
    const d = await json<Omit<LoadedClassRuleSet, 'definition'> & { definition: unknown }>(
      `/api/projects/${projectId}/class-rules/${setId}${version ? `?versie=${version}` : ''}`,
    );
    if (useClassRules.getState().projectId !== projectId) return;
    const definition = parseDefinition(d.definition);
    if (!definition) throw new Error('Deze classificatieregels kan de viewer niet lezen.');
    remember(projectId, setId);
    useClassRules.setState({
      loaded: { id: d.id, name: d.name, version: d.version, latestVersion: d.latestVersion, definition, canEdit: d.canEdit },
      loading: false,
    });
  } catch (e) {
    // Weg of niet meer te zien: niet blijven proberen bij de volgende keer openen
    if ((e as { status?: number }).status === 404) remember(projectId, null);
    useClassRules.setState({ loading: false, error: message(e) });
  }
}

/** Kleuren per klas aan of uit; aan zet de lens van de klassen actief (een andere lens gaat dan uit) */
export function showClassColors(on: boolean): void {
  const viewer = useViewerStore.getState();
  if (on) viewer.setActiveLens(CLASS_RULES_LENS_ID);
  else if (viewer.activeLensId === CLASS_RULES_LENS_ID) viewer.setActiveLens(null);
}

/** De kandidaten: elementen van een productklasse in elk geladen model (dezelfde klassen als de modelboom) */
function candidatesOf(): IdsByModel {
  const { models, ifcDataStore } = useViewerStore.getState();
  const out: IdsByModel = new Map();
  const stores = models.size > 0 ? [...models].map(([id, m]) => [id, m.ifcDataStore] as const) : [['legacy', ifcDataStore] as const];
  for (const [modelId, store] of stores) {
    if (!store) continue;
    const ids: number[] = [];
    for (let i = 0; i < store.entities.count; i++) {
      const expressId = store.entities.expressId[i];
      if (expressId && isProductTreeClass(store.entities.getTypeName(expressId) || '')) ids.push(expressId);
    }
    if (ids.length) out.set(modelId, ids);
  }
  return out;
}

let running: AbortController | null = null;

/** De gekozen set opnieuw uitrekenen op de modellen die nu geladen zijn */
export async function computeClassRules(): Promise<void> {
  running?.abort();
  const { loaded } = useClassRules.getState();
  const state = useViewerStore.getState();
  if (!loaded || (state.models.size === 0 && !state.ifcDataStore)) {
    useClassRules.setState({ result: null, lens: null, computing: false });
    return;
  }
  const controller = new AbortController();
  running = controller;
  useClassRules.setState({ computing: true, error: null });
  const evaluatorModels = state.models.size > 0
    ? evaluatorModelsFromState(state)
    : [{ id: 'legacy', store: state.ifcDataStore, mutationView: state.mutationViews.get('legacy') }];
  const definedModelTagIds = definedModelTagIdsOf(state);
  const evaluate: EvaluateGroups = async (groups, candidates) => {
    const rows = await evaluateFilterGroupsFederated(evaluatorModels.filter((m) => candidates.has(m.id)), groups, {
      candidateExpressIdsByModel: candidates,
      limit: Number.POSITIVE_INFINITY,
      signal: controller.signal,
      definedModelTagIds,
    });
    const out: IdsByModel = new Map();
    for (const { modelId, expressId } of rows) out.set(modelId, [...(out.get(modelId) ?? []), expressId]);
    return out;
  };
  try {
    const assignment = await assignClasses(loaded.definition.classes, candidatesOf(), evaluate, controller.signal);
    if (controller.signal.aborted) return;
    const models = useViewerStore.getState().models;
    const members = (ids: IdsByModel): ClassMember[] =>
      [...ids].flatMap(([modelId, list]) => list.map((expressId) => ({ modelId, expressId, globalId: toGlobalIdFromModels(models, modelId, expressId) })));
    const own = new Map([...assignment.own].map(([id, ids]) => [id, members(ids)]));
    const all = new Map([...assignment.all].map(([id, ids]) => [id, members(ids)]));
    const flat = flattenClasses(loaded.definition.classes);
    // Eén regel per klas; de treffers zijn de elementen in de klas zelf, dus nooit twee regels voor één element
    const lens: Lens = {
      id: CLASS_RULES_LENS_ID,
      name: `Classificatieregels: ${loaded.name}`,
      rules: flat.map(({ cls }) => ({ id: cls.id, name: cls.name, enabled: true, groups: [], action: 'colorize' as const, color: cls.color })),
    };
    const matched = new Map(flat.map(({ cls }) => [cls.id, new Set((own.get(cls.id) ?? []).map((m) => m.globalId))]));
    useClassRules.setState({ result: { own, all, unclassified: members(assignment.unclassified) }, lens: { lens, matched }, computing: false });
  } catch (e) {
    if (controller.signal.aborted) return;
    useClassRules.setState({ computing: false, result: null, lens: null, error: `De regels konden niet worden uitgerekend: ${message(e)}` });
  } finally {
    if (running === controller) running = null;
  }
}

/** Voor useLens: de lens van de klassen en de treffers, als die er is */
export function useBimpeilClassLens() {
  return useClassRules((s) => s.lens);
}

/**
 * In ViewerLayout: volgt het project uit BIMpeil (sets ophalen, keuze leegmaken bij een ander project) en rekent opnieuw
 * bij een andere set of andere modellen.
 */
export function useBimpeilClassRulesSync(): void {
  const project = useBimpeilContext((s) => s.project);
  const loaded = useClassRules((s) => s.loaded);
  const models = useViewerStore((s) => s.models);
  const ifcDataStore = useViewerStore((s) => s.ifcDataStore);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  useEffect(() => {
    const projectId = project?.id ?? null;
    if (useClassRules.getState().projectId === projectId) return;
    running?.abort();
    showClassColors(false);
    useClassRules.setState({ projectId, sets: null, canEdit: false, listError: null, loaded: null, result: null, lens: null, error: null, computing: false });
    if (projectId) void loadClassRuleSets(projectId);
  }, [project]);

  useEffect(() => {
    // Even wachten: bij het laden van een federatie komen de modellen kort na elkaar binnen
    const timer = setTimeout(() => void computeClassRules(), 300);
    return () => clearTimeout(timer);
  }, [loaded, models, ifcDataStore, mutationVersion]);
}
