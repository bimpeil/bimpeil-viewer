/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: modellen openen vanuit de webapp eromheen, zonder de viewer te herladen.
 *
 * De webapp (zelfde origin, iframe op /viewer/) stuurt:
 * - `{ type: 'bimpeil:open', url, name, ref }` met een kortlopende ondertekende URL op /opslag/ en het
 *   bestand en de versie in BIMpeil (origin.ts);
 * - `{ type: 'bimpeil:context', project }` met het actieve project, voor het paneel BIMpeil bestanden.
 * Het model wordt toegevoegd naast wat al open staat, met dezelfde `addModel` als `?model=`.
 * De viewer meldt `bimpeil:ready` bij het starten en daarna `bimpeil:opened` of `bimpeil:open-failed`.
 *
 * VEILIGHEID: alleen berichten van dezelfde origin, en alleen URL's op dezelfde origin, net als
 * `?model=` (useModelUrlAutoload).
 */

import { useCallback, useEffect } from 'react';
import { useIfcLoader } from '@/hooks/useIfcLoader.js';
import { useIfcFederation } from '@/hooks/useIfcFederation.js';
import { useWebGpuOpenGuard } from '@/hooks/useWebGpuOpenGuard';
import { showLoadError } from '@/lib/analytics';
import { useViewerStore } from '@/store';
import { useTranslation } from '@/i18n';
import { useBimpeilContext, type BimpeilProject } from './context';
import { markBimpeilFile, modelForFile, parseModelRef, type BimpeilModelRef } from './origin';
import { offerChangeSets } from './BimpeilChangeSetActions';

const isObject = (data: unknown): data is Record<string, unknown> => !!data && typeof data === 'object';

/**
 * Een model van een URL op dezelfde origin laden: `add` zet het naast wat open staat, `open`
 * vervangt alles (zoals Openen met één bestand in IfcLite). Geeft true bij succes; een fout komt in
 * de foutkaart van de viewer (zonder Opnieuw: de ondertekende URL verloopt, opnieuw gaat via BIMpeil).
 */
export function useBimpeilAddModel(mode: 'add' | 'open' = 'add'): (url: string, name: string, ref?: BimpeilModelRef | null) => Promise<boolean> {
  const { loadFile } = useIfcLoader();
  const { addModel } = useIfcFederation(loadFile);
  const { guard: guardWebGpu } = useWebGpuOpenGuard();
  const { t } = useTranslation();

  return useCallback(
    async (url: string, name: string, ref?: BimpeilModelRef | null) => {
      let source: URL;
      try {
        source = new URL(url, window.location.href);
      } catch {
        return false;
      }
      if (source.origin !== window.location.origin) return false;
      if (!guardWebGpu(() => {})) return false;
      try {
        const res = await fetch(source.href);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const blob = await res.blob();
        const file = new File([blob], name, { type: blob.type || 'application/x-step' });
        if (ref) markBimpeilFile(file, ref);
        if (mode === 'open') await loadFile(file, { kind: 'primary' });
        else await addModel(file);
        // Change sets van het eigen taakteam bij dit bestand aanbieden (V4b)
        const model = ref ? modelForFile(file) : null;
        if (model) void offerChangeSets(model);
        return true;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const { setError, setLastLoadRetry } = useViewerStore.getState();
        showLoadError(setError, setLastLoadRetry, t('viewportLighting.container.modelUrlAutoload.fetchFailed', { reason }), 'model_url_fetch_failed', null);
        return false;
      }
    },
    [mode, loadFile, addModel, guardWebGpu, t],
  );
}

export function useBimpeilOpen(): void {
  const addFromUrl = useBimpeilAddModel();
  const setProject = useBimpeilContext((s) => s.setProject);

  useEffect(() => {
    const reply = (message: Record<string, unknown>) => {
      if (window.parent !== window) window.parent.postMessage(message, window.location.origin);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !isObject(event.data)) return;
      const data = event.data;
      if (data.type === 'bimpeil:context') {
        const project = isObject(data.project) && typeof data.project.id === 'string' ? (data.project as unknown as BimpeilProject) : null;
        setProject(project);
        return;
      }
      if (data.type !== 'bimpeil:open' || typeof data.url !== 'string') return;
      const name = typeof data.name === 'string' && data.name ? data.name : 'model.ifc';
      void addFromUrl(data.url, name, parseModelRef(data.ref)).then((ok) => reply(ok ? { type: 'bimpeil:opened', name } : { type: 'bimpeil:open-failed', name }));
    };

    window.addEventListener('message', onMessage);
    reply({ type: 'bimpeil:ready' });
    return () => window.removeEventListener('message', onMessage);
  }, [addFromUrl, setProject]);
}
