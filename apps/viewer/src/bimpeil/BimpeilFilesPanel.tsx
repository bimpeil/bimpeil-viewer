/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: paneel "BIMpeil bestanden". Toont de modellen van het actieve BIMpeil project en voegt
 * ze toe naast wat al open staat, of opent ze in plaats daarvan. Openen en Model toevoegen op de
 * ribbon openen dit paneel (localFiles.ts); een lokaal bestand openen kan onderaan. De lijst komt van de BIMpeil API op dezelfde origin, met de
 * sessiecookie: rechten en de WIP regel gelden daar. Openen gaat via `?doel=viewer`, zodat het
 * audit log "bestand geopend" toont.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, HardDrive, Plus, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { useViewerStore } from '@/store';
import { useBimpeilContext } from './context';
import { useBimpeilAddModel } from './useBimpeilOpen';
import { requestLocalFiles } from './localFiles';

interface FileVersion {
  id: string;
  number: number;
  size: number;
  isoStatus: string;
  suitability: string;
  revision: string | null;
}

interface ProjectFile {
  id: string;
  name: string;
  versions: FileVersion[];
}

const MODEL_EXTENSIONS = ['.ifc', '.ifcx', '.ifczip', '.glb', '.gltf'];
const isModel = (name: string) => MODEL_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
const STATUS: Record<string, string> = { WIP: 'WIP', Shared: 'Gedeeld', Published: 'Gepubliceerd', Archived: 'Gearchiveerd' };

function formatSize(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} MB`;
  return `${(bytes / 1024 ** 3).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} GB`;
}

export function BimpeilFilesPanel({ onClose }: { onClose?: () => void }) {
  const project = useBimpeilContext((s) => s.project);
  const addFromUrl = useBimpeilAddModel('add');
  const openFromUrl = useBimpeilAddModel('open');
  const models = useViewerStore((s) => s.models);
  const loading = useViewerStore((s) => s.loading);
  const hasModels = models.size > 0;
  const openNames = useMemo(() => new Set([...models.values()].map((m) => m.name)), [models]);
  const [files, setFiles] = useState<ProjectFile[] | null>(null);
  const [viewerMax, setViewerMax] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!project) return;
    setError(null);
    fetch(`/api/projects/${encodeURIComponent(project.id)}/files`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Project niet gevonden.' : 'Bestanden ophalen is mislukt.');
        return r.json() as Promise<{ files: ProjectFile[]; viewerMaxBytes: number }>;
      })
      .then((d) => {
        setFiles(d.files.filter((f) => isModel(f.name)));
        setViewerMax(d.viewerMaxBytes);
      })
      .catch((err: Error) => setError(err.message));
  }, [project]);

  useEffect(() => {
    setFiles(null);
    load();
  }, [load]);

  async function loadModel(file: ProjectFile, version: FileVersion, mode: 'add' | 'open') {
    if (!project) return;
    setBusy(file.id);
    setError(null);
    const r = await fetch(`/api/projects/${encodeURIComponent(project.id)}/files/${file.id}/versions/${version.id}/download?doel=viewer`);
    const data = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!r.ok || !data.url) {
      setError(data.error ?? 'Openen is mislukt.');
      setBusy(null);
      return;
    }
    await (mode === 'open' ? openFromUrl : addFromUrl)(data.url, file.name);
    setBusy(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label="BIMpeil bestanden">
      <div className="flex items-center gap-2 border-b p-3">
        <FolderOpen className="h-4 w-4" aria-hidden="true" />
        <h2 className="flex-1 truncate text-sm font-medium">{project ? `${project.code} ${project.name}` : 'BIMpeil bestanden'}</h2>
        {project && (
          <IconButton label="Vernieuwen" className="h-6 w-6" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </IconButton>
        )}
        {onClose && (
          <IconButton label="Sluiten" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>

      {!project && <p className="p-3 text-sm text-muted-foreground">Kies in BIMpeil linksboven een project; dan staan de modellen hier.</p>}
      {project && error && <p className="p-3 text-sm text-destructive">{error}</p>}
      {project && !error && files === null && <p className="p-3 text-sm text-muted-foreground">Laden…</p>}
      {project && files?.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nog geen modellen in dit project die je kunt zien.</p>}

      {files && files.length > 0 && (
        <ol className="min-h-0 flex-1 divide-y overflow-y-auto">
          {files.map((f) => {
            const v = f.versions[0];
            const tooBig = viewerMax > 0 && v.size > viewerMax;
            const isOpen = openNames.has(f.name);
            return (
              <li key={f.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" title={f.name}>{f.name}</div>
                  <div className="text-2xs text-muted-foreground">
                    versie {v.number} · {STATUS[v.isoStatus] ?? v.isoStatus} {v.isoStatus !== 'Archived' ? v.suitability : ''}
                    {v.revision ? ` ${v.revision}` : ''} · {formatSize(v.size)}
                  </div>
                </div>
                {isOpen ? (
                  <span className="text-xs text-muted-foreground">open</span>
                ) : tooBig ? (
                  <span className="text-xs text-muted-foreground" title={`Groter dan ${formatSize(viewerMax)}, de browsergrens`}>
                    te groot
                  </span>
                ) : busy === f.id ? (
                  <span className="text-xs text-muted-foreground">Bezig…</span>
                ) : (
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" size="sm" variant="outline" disabled={busy !== null || loading} onClick={() => void loadModel(f, v, 'open')}
                      title="Vervangt wat open staat">
                      Openen
                    </Button>
                    {hasModels && (
                      <Button type="button" size="sm" variant="outline" disabled={busy !== null || loading} onClick={() => void loadModel(f, v, 'add')}
                        title="Naast wat open staat">
                        <Plus className="h-3 w-3" aria-hidden="true" />
                        Toevoegen
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {!(files && files.length > 0) && <div className="min-h-0 flex-1" />}
      <div className="border-t px-3 py-2">
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => requestLocalFiles('open')}>
            <HardDrive className="h-3 w-3" aria-hidden="true" />
            Lokaal bestand openen
          </Button>
          {hasModels && (
            <Button type="button" size="sm" variant="ghost" disabled={loading} onClick={() => requestLocalFiles('add')}>
              <Plus className="h-3 w-3" aria-hidden="true" />
              Lokaal toevoegen
            </Button>
          )}
        </div>
        <p className="mt-1 text-2xs text-muted-foreground">
          Een lokaal bestand wordt niet in BIMpeil opgeslagen. Uploaden en statussen regel je in BIMpeil, bij Bestanden.
        </p>
      </div>
    </div>
  );
}
