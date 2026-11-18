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
 *   a view (all models, from above), and the origins of the models on or off; measure an angle (two points on the
 *   model, two on the reference), choose a pivot by clicking, stop clicking, and clear what was measured.
 *
 * Moving starts at the origin of the model (the point 0,0,0 of its file) when it lies near the model, so the handles
 * of IfcLite stand there and not in the middle: the bridge sets that origin as the source point of the move, until a
 * point is picked on the model (origin.ts, origin-scene.ts). The origins on the page are BIMpeil's own markers
 * (OriginMarkers.tsx), and All and From above take them in while they are shown.
 *
 * A turn is about the pivot as it is drawn: that point stays where it is, also on a model that is turned already
 * (turn.ts). Measuring and choosing the pivot click with their own picking (measure-scene.ts, MeasureLayer.tsx), not
 * with the one of IfcLite for moving, which would move the model.
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
import { rotationRefusal } from '@/lib/model-placement/rotation-refusal';
import { useRepositionRuntime } from '@/lib/model-placement/reposition-runtime';
import { modelBounds, modelCenter } from '@/lib/model-placement/scene';
import { addTranslation } from '@/lib/model-placement/translation';
import { fileToWorkspace } from './correction';
import { clearMeasure, drawnPlacement, drawnPoint, measureSession, measureState, startMeasure, startPivot, stopPicking, subscribeMeasure } from './measure-scene';
import { positionModels } from './models';
import { renderBoxAround } from './origin';
import { currentOrigins, originsShown, setOriginsShown, subscribeOriginsShown } from './origin-scene';
import { positionSession } from './session';
import { turnAbout } from './turn';

export type MoveCommand =
  | { action: 'start'; modelId: string }
  | { action: 'stop' }
  | { action: 'reference'; modelId: string }
  | { action: 'pick'; role: 'source' | 'target' | null }
  | { action: 'delta'; delta: [number, number, number] }
  | { action: 'apply' }
  | { action: 'cancel' }
  /**
   * Absolute heading in radians about a pivot as it is drawn: the origin of the file, the centre of the model, the
   * point chosen by clicking (`picked`), or a point of the file in metres
   */
  | { action: 'rotate'; angle: number; pivot: 'origin' | 'centre' | 'picked' | [number, number, number] }
  | { action: 'undo' }
  | { action: 'redo' }
  | { action: 'reset' }
  | { action: 'view'; view: 'all' | 'top' }
  /** The origins of the models (the basepoints of IfcLite) on or off */
  | { action: 'basepoints'; show: boolean }
  /** Measure the angle between a line on the model and one on the reference the page shows: four clicks */
  | { action: 'measure'; reference: string }
  /** Choose the pivot of a turn: one click */
  | { action: 'pickPivot' }
  /** Stop clicking for measuring or the pivot */
  | { action: 'stopPick' }
  /** The measured lines and the chosen pivot go */
  | { action: 'clearMeasure' };

const isObject = (data: unknown): data is Record<string, unknown> => !!data && typeof data === 'object';
const isTriple = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** A move command from a message, or null when it is not one */
export function parseMoveCommand(data: Record<string, unknown>): MoveCommand | null {
  const a = data.action;
  if (a === 'start' || a === 'reference') return typeof data.modelId === 'string' ? { action: a, modelId: data.modelId } : null;
  if (a === 'stop' || a === 'apply' || a === 'cancel' || a === 'undo' || a === 'redo' || a === 'reset') return { action: a };
  if (a === 'measure') return typeof data.reference === 'string' ? { action: a, reference: data.reference } : null;
  if (a === 'pickPivot' || a === 'stopPick' || a === 'clearMeasure') return { action: a };
  if (a === 'pick') return data.role === 'source' || data.role === 'target' || data.role === null ? { action: a, role: data.role } : null;
  if (a === 'delta') return isTriple(data.delta) ? { action: a, delta: data.delta } : null;
  if (a === 'rotate') {
    const pivot = data.pivot === 'origin' || data.pivot === 'centre' || data.pivot === 'picked' ? data.pivot : isTriple(data.pivot) ? data.pivot : null;
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

    const reopen = (moving: readonly string[]) => {
      const now = useViewerStore.getState();
      if (now.repositionOpen && !now.modelPlacement.preview && moving.length) now.openReposition([...moving]);
    };

    const move = (command: MoveCommand) => {
      const store = useViewerStore.getState();
      const rt = live.current.runtime;
      const moving = store.modelPlacement.preview?.modelIds ?? rt?.selected ?? [];
      switch (command.action) {
        case 'start':
          // Another model: what was measured belongs to the one before
          if (moving[0] !== command.modelId) clearMeasure();
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
          stopPicking();
          rt.setRole(command.role);
          return;
        case 'measure': {
          // The reference as the page shows it: IfcLite knows one only after it was chosen in the list
          if (!moving[0] || !store.models.has(command.reference) || command.reference === moving[0]) throw new Error('Choose a model to move and a reference first.');
          rt?.setRole(null);
          startMeasure(moving[0], command.reference);
          return;
        }
        case 'pickPivot':
          rt?.setRole(null);
          startPivot();
          return;
        case 'stopPick':
          stopPicking();
          return;
        case 'clearMeasure':
          clearMeasure();
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
          const refusal = rotationRefusal(store, [id]);
          if (refusal) throw new Error(refusal);
          // The pivot as drawn now, with a move that is shown
          const chosen = measureState().pivot;
          const pivot =
            command.pivot === 'centre'
              ? modelCenter(id)
              : command.pivot === 'picked'
                ? chosen && drawnPoint(chosen)
                : fileToWorkspace(command.pivot === 'origin' ? [0, 0, 0] : command.pivot, model.geometryResult?.coordinateInfo, drawnPlacement(store.modelPlacement, id));
          if (!pivot) throw new Error(command.pivot === 'picked' ? 'Choose a pivot first.' : 'Model bounds are not available yet.');
          useViewerStore.setState((current) => ({ modelPlacement: turnAbout(current.modelPlacement, id, command.angle, [...pivot]) }));
          if (!useViewerStore.getState().modelPlacement.preview) useViewerStore.getState().openReposition([id]);
          return;
        }
        // Undo and redo end the move in IfcLite (no handles until the next command): start a new, empty one for the
        // same model, as after Apply; the history stays
        case 'undo':
          store.undoModelTranslation();
          reopen(moving);
          return;
        case 'redo':
          store.redoModelTranslation();
          reopen(moving);
          return;
        case 'reset':
          if (moving.length) store.resetModelTranslations(moving);
          reopen(moving);
          return;
        case 'basepoints':
          // BIMpeil's own markers; the basepoints of IfcLite stay off (origin-scene.ts)
          if (store.showModelBasepoints) store.toggleShowModelBasepoints();
          setOriginsShown(command.show);
          return;
        case 'view': {
          const ids = [...store.models.keys()];
          if (!ids.length) return;
          const boxes = ids.map(modelBounds).filter((b) => b !== null);
          if (!boxes.length) throw new Error('Model bounds are not available yet.');
          const box = renderBoxAround(boxes, originsShown() ? currentOrigins().map((o) => o.render) : []);
          if (!box) return;
          const camera = getGlobalRenderer()?.getCamera();
          camera?.fitToBounds(box.min, box.max);
          if (command.view === 'top') camera?.setPresetView('top', box);
          getGlobalRenderer()?.requestRender();
          // A camera move without a pointer under it does not wake the layer with the handles of IfcLite (its
          // projector, SceneProjectorProvider.tsx): the handles would stay where the old view had them. That layer
          // wakes on pointer moves over the canvas, so one is sent, not bubbling; not while a point is picked, when
          // the handles are hidden anyway and a move would be a hover
          if (!rt?.role) {
            for (const canvas of document.querySelectorAll('.bimpeil-position canvas')) canvas.dispatchEvent(new PointerEvent('pointermove', { bubbles: false }));
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

    // Moving starts at the origin of the model when it lies near it: the source point of the move, as long as no
    // point was picked on the model. Again after Apply, Discard, a turn or an undo, which start a new move or move
    // the origin. While the bounds of the model are not there yet, look again shortly.
    let retry = 0;
    const startAtOrigin = () => {
      const state = useViewerStore.getState();
      const preview = state.modelPlacement.preview;
      if (!state.repositionOpen || !preview || preview.modelIds.length !== 1) return;
      if (preview.source && preview.source.kind !== 'origin') return;
      const id = preview.modelIds[0];
      const origin = currentOrigins({ near: true }).find((o) => o.modelId === id);
      if (!origin) return;
      if (origin.near === null) {
        if (!retry) retry = window.setTimeout(() => ((retry = 0), schedule()), 300);
        return;
      }
      if (!origin.near) return;
      const shownAt = preview.source ? addTranslation(preview.source.point, preview.delta) : null;
      if (shownAt && shownAt.every((v, i) => Math.abs(v - origin.workspace[i]) < 1e-6)) return;
      try {
        state.setMoveAnchor('source', { modelId: id, point: origin.workspace, kind: 'origin' });
      } catch {
        // The move closed in between: the next change starts again
      }
    };

    // One message per frame at most, and only when something the page shows has changed (not every drag step)
    let lastModels = '';
    let lastSession = '';
    let frame = 0;
    const send = () => {
      frame = 0;
      startAtOrigin();
      const state = useViewerStore.getState();
      const models = positionModels(state.models as ReadonlyMap<string, FederatedModel>, state.modelPlacement);
      const modelsKey = JSON.stringify(models.map(({ file, ...rest }) => ({ ...rest, file: !!file })));
      if (modelsKey !== lastModels) {
        lastModels = modelsKey;
        reply({ type: 'bimpeil:position-models', models });
      }
      const session = positionSession(state.repositionOpen, state.modelPlacement, live.current.runtime, originsShown(), measureSession());
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
      if (state.models === previous.models && state.modelPlacement === previous.modelPlacement && state.repositionOpen === previous.repositionOpen) return;
      schedule();
    });
    const unsubscribeOrigins = subscribeOriginsShown(schedule);
    const unsubscribeMeasure = subscribeMeasure(schedule);

    window.addEventListener('message', onMessage);
    reply({ type: 'bimpeil:position-ready' });
    send();
    return () => {
      window.removeEventListener('message', onMessage);
      unsubscribe();
      unsubscribeOrigins();
      unsubscribeMeasure();
      sendSession.current = () => {};
      if (frame) cancelAnimationFrame(frame);
      if (retry) clearTimeout(retry);
    };
  }, []);
}
