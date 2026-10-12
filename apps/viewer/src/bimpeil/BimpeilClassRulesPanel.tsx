/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: paneel Classificatieregels (K2). Een set van het actieve project kiezen, de klassen met hun aantallen,
 * kleuren per klas (de lens uit classRulesStore.ts), per klas isoleren en verbergen, en de modelboom per klas openen.
 * Bewerken komt in K3; tot dan staan de regels alleen te lezen.
 */

import { useMemo } from 'react';
import { Eye, EyeOff, Focus, ListTree, RefreshCw, Shapes, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Switch } from '@/components/ui/switch';
import { useViewerStore } from '@/store';
import { useBimpeilContext } from './context';
import { flattenClasses } from './classRules';
import { CLASS_RULES_LENS_ID, chooseClassRuleSet, loadClassRuleSets, showClassColors, useClassRules, type ClassMember } from './classRulesStore';
import { UNCLASSIFIED_LABEL } from './classRulesTree';

const GREY = '#9ca3af';

export function BimpeilClassRulesPanel({ onClose }: { onClose?: () => void }) {
  const project = useBimpeilContext((s) => s.project);
  const { sets, listError, loaded, loading, computing, result, error } = useClassRules();
  const colorsOn = useViewerStore((s) => s.activeLensId === CLASS_RULES_LENS_ID);
  const hiddenEntities = useViewerStore((s) => s.hiddenEntities);
  const isolated = useViewerStore((s) => s.isolatedEntities);

  const rows = useMemo(() => {
    if (!loaded || !result) return [];
    const list = flattenClasses(loaded.definition.classes).map(({ cls, depth }) => ({
      key: cls.id,
      name: cls.name,
      code: cls.code,
      color: cls.color,
      depth,
      members: result.all.get(cls.id) ?? [],
    }));
    if (result.unclassified.length) list.push({ key: 'niet', name: UNCLASSIFIED_LABEL, code: undefined, color: GREY, depth: 0, members: result.unclassified });
    return list;
  }, [loaded, result]);

  const ids = (members: ClassMember[]) => members.map((m) => m.globalId);
  const allHidden = (members: ClassMember[]) => members.length > 0 && members.every((m) => hiddenEntities.has(m.globalId));
  const isIsolated = (members: ClassMember[]) => !!isolated && isolated.size === members.length && members.every((m) => isolated.has(m.globalId));

  function openTree() {
    const viewer = useViewerStore.getState();
    viewer.setHierarchyMode('klassen');
    viewer.setLeftPanelCollapsed(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="Classificatieregels">
      <div className="flex items-center gap-2 border-b p-3">
        <Shapes className="h-4 w-4" aria-hidden="true" />
        <h2 className="flex-1 truncate text-sm font-medium">Classificatieregels</h2>
        {project && (
          <IconButton label="Opnieuw ophalen" className="h-6 w-6" onClick={() => void loadClassRuleSets(project.id)}>
            <RefreshCw className="h-3.5 w-3.5" />
          </IconButton>
        )}
        {onClose && (
          <IconButton label="Sluiten" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>

      {!project && <p className="p-3 text-sm text-muted-foreground">Open de viewer vanuit een project in BIMpeil om de classificatieregels van dat project te gebruiken.</p>}

      {project && (
        <div className="space-y-2 border-b p-3">
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="bimpeil-klassen-set">
            Set van {project.code}
          </label>
          <select
            id="bimpeil-klassen-set"
            className="h-8 w-full rounded-md border bg-background px-2 text-sm"
            value={loaded?.id ?? ''}
            disabled={sets === null || loading}
            onChange={(e) => void chooseClassRuleSet(e.target.value || null)}
          >
            <option value="">{sets === null ? 'Laden…' : sets.length === 0 ? 'Nog geen classificatieregels in dit project' : 'Kies een set'}</option>
            {sets?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (versie {s.version}, {s.classCount} {s.classCount === 1 ? 'klas' : 'klassen'})
              </option>
            ))}
          </select>
          {listError && <p className="text-xs text-destructive" role="alert">{listError}</p>}
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          {loaded && (
            <>
              {loaded.version < loaded.latestVersion && (
                <p className="text-xs text-muted-foreground">
                  Je bekijkt versie {loaded.version}; de nieuwste is {loaded.latestVersion}.{' '}
                  <button type="button" className="underline" onClick={() => void chooseClassRuleSet(loaded.id)}>
                    Nieuwste openen
                  </button>
                </p>
              )}
              <div className="flex items-center gap-2">
                <Switch id="bimpeil-klassen-kleuren" checked={colorsOn} disabled={!result} onCheckedChange={showClassColors} />
                <label htmlFor="bimpeil-klassen-kleuren" className="flex-1 text-sm">
                  Kleuren per klas
                </label>
                <Button type="button" size="sm" variant="outline" onClick={openTree}>
                  <ListTree className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Boom per klas
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {loaded && computing && !result && <p className="p-3 text-sm text-muted-foreground">Klassen worden uitgerekend…</p>}
      {loaded && !computing && !result && !error && <p className="p-3 text-sm text-muted-foreground">Open een model om te zien wat er in elke klas valt.</p>}
      {loaded && result && rows.length === 0 && <p className="p-3 text-sm text-muted-foreground">Deze classificatieregels hebben nog geen klassen.</p>}

      {rows.length > 0 && (
        <ol className="min-h-0 flex-1 overflow-y-auto py-1" aria-busy={computing}>
          {rows.map((row) => {
            const hidden = allHidden(row.members);
            const empty = row.members.length === 0;
            return (
              <li key={row.key} className="flex items-center gap-2 py-1 pr-2" style={{ paddingLeft: 12 + row.depth * 14 }}>
                <span className="h-3 w-3 shrink-0 rounded-sm border" style={{ backgroundColor: row.color }} aria-hidden="true" />
                <span className={`min-w-0 flex-1 truncate text-sm ${hidden ? 'line-through text-muted-foreground' : ''}`} title={row.name}>
                  {row.code ? <span className="mr-1 text-muted-foreground">{row.code}</span> : null}
                  {row.name}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{row.members.length}</span>
                <IconButton
                  label={isIsolated(row.members) ? `Isoleren van ${row.name} opheffen` : `${row.name} isoleren`}
                  className="h-6 w-6"
                  disabled={empty}
                  onClick={() => useViewerStore.getState().isolateEntities(ids(row.members))}
                >
                  <Focus className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                  label={hidden ? `${row.name} tonen` : `${row.name} verbergen`}
                  className="h-6 w-6"
                  disabled={empty}
                  onClick={() => (hidden ? useViewerStore.getState().showEntities(ids(row.members)) : useViewerStore.getState().hideEntities(ids(row.members)))}
                >
                  {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </IconButton>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
