/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: the messages between the bare viewer for positioning (bimpeil-position.html, PositionLayout.tsx) and the
 * page around it (the repo BIMpeil-ifc, docs/viewer.md there). The page owns the files, draws every control and
 * writes the correction; the viewer shows the models and moves them with the placement tools of IfcLite.
 *
 * Only from `window.parent` on the same origin (as useBimpeilOpen.ts). The page sends:
 * - `bimpeil:position-open` `{ id, file }`, `bimpeil:position-replace` `{ id, modelId, file }` (the corrected file in
 *   the place of a model) and `bimpeil:position-remove` `{ modelId }`; files load one at a time, because IfcLite gives
 *   up the first of two loads that run together;
 * - `bimpeil:position-move` `{ action, ... }` (MoveCommand below): start or stop moving a model, the reference model,
 *   pick a point in the 3D view, a move in metres, apply, cancel, an absolute turn about a pivot, undo, redo, reset,
 *   a view (all models, from above), and the origins of the models on or off.
 *
 * The viewer sends `bimpeil:position-ready` once, `bimpeil:position-opened` `{ id, modelId }` or
 * `bimpeil:position-failed` `{ id, message }` per file, `bimpeil:position-models` `{ models }` (models.ts) and
 * `bimpeil:position-session` `{ session }` (session.ts) when they change, and `bimpeil:position-error`
 * `{ message }` when a move command fails. The types are kept separately on both sides.
 */
import { useEffect, useRef } from 'react';
import { useIfcLoader } from '@/hooks/useIfcLoader.js';
import { useIfcFederation } from '@/hooks/useIfcFederation.js';
import { useWebGpuOpenGuard } from '@/hooks/useWebGpuOpenGuard';
import { getWebGPUStatus, retryWebGPU } from '@/hooks/useWebGPU';
import { getGlobalRenderer } from '@/hooks/useBCF';
import { useViewerStore, type FederatedModel } from '@/store';
import { placementFor } from '@/lib/model-placement/state';
import { useRepositionRuntime } from '@/lib/model-placement/reposition-runtime';
import { frameModels, modelBounds, modelCenter } from '@/lib/model-placement/scene';
import { fileToWorkspace } from './correction';
import { positionModels } from './models';
import { positionSession } from './session';

export type MoveCommand =
  | { action: 'start'; modelId: string }
  | { action: 'stop' }
  | { action: 'reference'; modelId: string }
  | { action: 'pick'; role: 'source' | 'target' | null }
  | { action: 'delta'; delta: [number, number, number] }
  | { action: 'apply' }
  | { action: 'cancel' }
  /** Absolute heading in radians about a pivot: the origin of the file, the centre of the model, or a point of the file in metres */
  | { action: 'rotate'; angle: number; pivot: 'origin' | 'centre' | [number, number, number] }
  | { action: 'undo' }
  | { action: 'redo' }
  | { action: 'reset' }
  | { action: 'view'; view: 'all' | 'top' }
  /** The origins of the models (the basepoints of IfcLite) on or off */
  | { action: 'basepoints'; show: boolean };

const isObject = (data: unknown): data is Record<string, unknown> => !!data && typeof data === 'object';
const isTriple = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** A move command from a message, or null when it is not one */
export function parseMoveCommand(data: Record<string, unknown>): MoveCommand | null {
  const a = data.action;
  if (a === 'start' || a === 'reference') return typeof data.modelId === 'string' ? { action: a, modelId: data.modelId } : null;
  if (a === 'stop' || a === 'apply' || a === 'cancel' || a === 'undo' || a === 'redo' || a === 'reset') return { action: a };
  if (a === 'pick') return data.role === 'source' || data.role === 'target' || data.role === null ? { action: a, role: data.role } : null;
  if (a === 'delta') return isTriple(data.delta) ? { action: a, delta: data.delta } : null;
  if (a === 'rotate') {
    const pivot = data.pivot === 'origin' || data.pivot === 'centre' ? data.pivot : isTriple(data.pivot) ? data.pivot : null;
    return typeof data.angle === 'number' && Number.isFinite(data.angle) && pivot ? { action: a, angle: data.angle, pivot } : null;
  }
  if (a === 'view') return data.view === 'all' || data.view === 'top' ? { action: a, view: data.view } : null;
  if (a === 'basepoints') return typeof data.show === 'boolean' ? { action: a, show: data.show } : null;
  return null;
}

export function usePositionBridge(): void {
  const { loadFile } = useIfcLoader();
  const { addModel, removeModel } = useIfcFederation(loadFile);
  const { guard } = useWebGpuOpenGuard();
  const runtime = useRepositionRuntime();
  // The newest functions and runtime, without starting the bridge again on every render
  const live = useRef({ addModel, removeModel, guard, runtime });
  live.current = { addModel, removeModel, guard, runtime };
  const sendSession = useRef<() => void>(() => {});

  // The runtime of IfcLite (role, hover, reference, error) lives in React state: report it when it changes
  useEffect(() => sendSession.current(), [runtime]);

  useEffect(() => {
    const reply = (message: Record<string, unknown>) => {
      if (window.parent !== window) window.parent.postMessage(message, window.location.origin);
    };

    // One load at a time
    let queue: Promise<unknown> = Promise.resolve();
    const add = (id: string, file: File, replace?: string) => {
      queue = queue.then(async () => {
        try {
          if (replace && useViewerStore.getState().models.has(replace)) live.current.removeModel(replace);
          if (getWebGPUStatus().checking) await retryWebGPU();
          if (!live.current.guard()) throw new Error('WebGPU');
          const modelId = await live.current.addModel(file);
          if (!modelId) throw new Error(file.name);
          reply({ type: 'bimpeil:position-opened', id, modelId });
        } catch (err) {
          reply({ type: 'bimpeil:position-failed', id, message: err instanceof Error ? err.message : String(err) });
        }
      });
    };

    const move = (command: MoveCommand) => {
      const store = useViewerStore.getState();
      const rt = live.current.runtime;
      const moving = store.modelPlacement.preview?.modelIds ?? rt?.selected ?? [];
      switch (command.action) {
        case 'start':
          store.setActiveTool?.('select');
          store.openReposition([command.modelId]);
          return;
        case 'stop':
          store.closeReposition();
          return;
        case 'reference':
          rt?.setReference(command.modelId);
          return;
        case 'pick':
          if (!rt) throw new Error('Moving is not on.');
          rt.setRole(command.role);
          return;
        case 'delta':
          if (!store.modelPlacement.preview) store.openReposition(moving);
          store.previewModelTranslation(command.delta);
          return;
        case 'apply':
          // As Apply in IfcLite: commit, and start a new, empty move for the same model
          store.applyModelTranslation();
          if (moving.length) store.openReposition(moving);
          rt?.setRole(null);
          return;
        case 'cancel':
          if (moving.length) store.openReposition(moving);
          rt?.setRole(null);
          return;
        case 'rotate': {
          const id = moving[0];
          const model = id ? (store.models.get(id) as FederatedModel | undefined) : undefined;
          if (!model) throw new Error('Choose a model to move first.');
          const placement = placementFor(store.modelPlacement, id);
          const pivot =
            command.pivot === 'centre'
              ? modelCenter(id)
              : fileToWorkspace(command.pivot === 'origin' ? [0, 0, 0] : command.pivot, model.geometryResult?.coordinateInfo, placement);
          if (!pivot) throw new Error('Model bounds are not available yet.');
          store.setModelRotation([id], { angle: command.angle, pivot: [...pivot] });
          if (!useViewerStore.getState().modelPlacement.preview) useViewerStore.getState().openReposition([id]);
          return;
        }
        case 'undo':
          store.undoModelTranslation();
          return;
        case 'redo':
          store.redoModelTranslation();
          return;
        case 'reset':
          if (moving.length) store.resetModelTranslations(moving);
          return;
        case 'basepoints':
          if (store.showModelBasepoints !== command.show) store.toggleShowModelBasepoints();
          return;
        case 'view': {
          const ids = [...store.models.keys()];
          if (!ids.length) return;
          frameModels(ids);
          if (command.view === 'top') {
            const boxes = ids.map(modelBounds).filter((b) => b !== null);
            const min = { x: Math.min(...boxes.map((b) => b.min.x)), y: Math.min(...boxes.map((b) => b.min.y)), z: Math.min(...boxes.map((b) => b.min.z)) };
            const max = { x: Math.max(...boxes.map((b) => b.max.x)), y: Math.max(...boxes.map((b) => b.max.y)), z: Math.max(...boxes.map((b) => b.max.z)) };
            getGlobalRenderer()?.getCamera().setPresetView('top', { min, max });
            getGlobalRenderer()?.requestRender();
          }
          return;
        }
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent || !isObject(event.data)) return;
      const data = event.data;
      const id = typeof data.id === 'string' ? data.id : '';
      if (data.type === 'bimpeil:position-open' && data.file instanceof File) add(id, data.file);
      else if (data.type === 'bimpeil:position-replace' && data.file instanceof File && typeof data.modelId === 'string') add(id, data.file, data.modelId);
      else if (data.type === 'bimpeil:position-remove' && typeof data.modelId === 'string') {
        if (useViewerStore.getState().models.has(data.modelId)) live.current.removeModel(data.modelId);
      } else if (data.type === 'bimpeil:position-move') {
        const command = parseMoveCommand(data);
        if (!command) return;
        try {
          move(command);
        } catch (err) {
          reply({ type: 'bimpeil:position-error', message: err instanceof Error ? err.message : String(err) });
        }
      }
    };

    // One message per frame at most, and only when something the page shows has changed (not every drag step)
    let lastModels = '';
    let lastSession = '';
    let frame = 0;
    const send = () => {
      frame = 0;
      const state = useViewerStore.getState();
      const models = positionModels(state.models as ReadonlyMap<string, FederatedModel>, state.modelPlacement);
      const modelsKey = JSON.stringify(models.map(({ file, ...rest }) => ({ ...rest, file: !!file })));
      if (modelsKey !== lastModels) {
        lastModels = modelsKey;
        reply({ type: 'bimpeil:position-models', models });
      }
      const session = positionSession(state.repositionOpen, state.modelPlacement, live.current.runtime, state.showModelBasepoints);
      const sessionKey = JSON.stringify(session);
      if (sessionKey !== lastSession) {
        lastSession = sessionKey;
        reply({ type: 'bimpeil:position-session', session });
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(send);
    };
    sendSession.current = schedule;
    const unsubscribe = useViewerStore.subscribe((state, previous) => {
      if (state.models === previous.models && state.modelPlacement === previous.modelPlacement && state.repositionOpen === previous.repositionOpen && state.showModelBasepoints === previous.showModelBasepoints) return;
      schedule();
    });

    window.addEventListener('message', onMessage);
    reply({ type: 'bimpeil:position-ready' });
    send();
    return () => {
      window.removeEventListener('message', onMessage);
      unsubscribe();
      sendSession.current = () => {};
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
