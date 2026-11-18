/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: clicking points for measuring an angle or choosing a pivot (measure-scene.ts), and drawing them on top of
 * the 3D view: the line on the model in Graphite, the line on the reference in blue and dashed, the pivot as a ring
 * with a cross, and the point the pointer snaps to while clicking.
 *
 * Clicking snaps as the placement tools of IfcLite do (`useRepositionPicking.ts`: `raycastSceneMagnetic` with the same
 * snapping and edge lock), only on the models the step allows, and eats the click so the viewer does not select an
 * element. Escape stops. Drawn once per frame while there is something to draw.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { EdgeLockInput } from '@ifc-lite/renderer';
import { EDGE_LOCK_DEFAULTS } from '@/store/constants';
import { getGlobalRenderer } from '@/hooks/useBCF';
import { resolveEntityRef, useViewerStore } from '@/store';
import { fromRenderTranslation, toRenderTranslation, type Translation } from '@/lib/model-placement/translation';
import { accepts, drawnPoint, measureState, pick, setHover, setMissed, stopPicking, subscribeMeasure, type Hit } from './measure-scene';

const SVG = 'http://www.w3.org/2000/svg';

export function MeasureLayer() {
  const picking = useSyncExternalStore(subscribeMeasure, () => measureState().picking);
  const drawing = useSyncExternalStore(subscribeMeasure, () => {
    const s = measureState();
    return s.picking !== null || s.modelLine.length > 0 || s.referenceLine.length > 0 || s.pivot !== null;
  });
  const layer = useRef<SVGSVGElement>(null);

  // ---- Clicking ----
  useEffect(() => {
    const renderer = getGlobalRenderer();
    const canvas = renderer?.getCanvas();
    if (!picking || !renderer || !canvas) return;
    const state = useViewerStore.getState();
    const allowed = new Set<number>();
    for (const [id, model] of state.models) {
      if (!model.visible || !accepts(id)) continue;
      for (const mesh of model.geometryResult?.meshes ?? []) {
        if (mesh.entityIds) for (const entityId of mesh.entityIds) allowed.add(entityId);
        else allowed.add(mesh.expressId);
      }
      for (const cloud of model.geometryResult?.pointClouds ?? []) allowed.add(cloud.expressId);
    }
    for (const id of renderer.getScene().getInstancedEntityIds()) if (accepts(resolveEntityRef(id).modelId)) allowed.add(id);

    let edgeLock: EdgeLockInput = { edge: null, meshExpressId: null, lockStrength: 0 };
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = 'crosshair';
    const hitAt = (event: PointerEvent | MouseEvent): Hit | null => {
      const current = useViewerStore.getState();
      if (!current.snapEnabled) edgeLock = { edge: null, meshExpressId: null, lockStrength: 0 };
      const rect = canvas.getBoundingClientRect();
      const isolatedIds = current.isolatedEntities === null ? allowed : new Set([...allowed].filter((id) => current.isolatedEntities?.has(id)));
      const result = renderer.raycastSceneMagnetic(event.clientX - rect.left, event.clientY - rect.top, edgeLock, {
        hiddenIds: current.hiddenEntities,
        isolatedIds,
        snapOptions: {
          snapToVertices: current.snapEnabled, snapToEdges: current.snapEnabled, snapToFaces: current.snapEnabled,
          snapToPointClouds: true, screenSnapRadius: 12,
        },
      });
      if (result.edgeLock.shouldRelease) edgeLock = { edge: null, meshExpressId: null, lockStrength: 0 };
      else if (result.edgeLock.shouldLock && result.edgeLock.edge) {
        edgeLock = { edge: result.edgeLock.edge, meshExpressId: result.edgeLock.meshExpressId, lockStrength: EDGE_LOCK_DEFAULTS.INITIAL_STRENGTH };
      }
      const target = result.snapTarget;
      const point = target?.position ?? result.intersection?.point;
      const id = target?.expressId ?? result.intersection?.expressId;
      if (!point || id === undefined) return null;
      const modelId = resolveEntityRef(id).modelId;
      if (!accepts(modelId)) return null;
      const kind = target?.type === 'vertex' ? 'vertex' : target?.type === 'edge' ? 'edge' : target?.type === 'face' || target?.type === 'face_center' ? 'face' : 'point';
      const surface = result.intersection;
      const face = surface
        ? { point: [surface.point.x, surface.point.y, surface.point.z] as [number, number, number], normal: [surface.normal.x, surface.normal.y, surface.normal.z] as [number, number, number] }
        : undefined;
      return { modelId, point: fromRenderTranslation(point), kind, face };
    };
    const move = (event: PointerEvent) => {
      if (event.buttons !== 0) return;
      setHover(hitAt(event));
    };
    // As in IfcLite: decide on pointerdown, eat the whole gesture, so the viewer does not select what is under it
    let hit: Hit | null | undefined;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      hit = hitAt(event);
    };
    const release = (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== 'click' || hit === undefined) return;
      if (hit) pick(hit);
      else setMissed();
      hit = undefined;
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stopPicking();
    };
    canvas.addEventListener('pointermove', move, true);
    canvas.addEventListener('pointerdown', down, true);
    canvas.addEventListener('pointerup', release, true);
    canvas.addEventListener('click', release, true);
    window.addEventListener('keydown', key);
    return () => {
      canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerdown', down, true);
      canvas.removeEventListener('pointerup', release, true);
      canvas.removeEventListener('click', release, true);
      window.removeEventListener('keydown', key);
      canvas.style.cursor = previousCursor;
      setHover(null);
    };
  }, [picking]);

  // ---- Drawing ----
  useEffect(() => {
    if (!drawing) return;
    let frame = 0;
    const parts = new Map<string, SVGElement>();
    const part = (name: string, tag: string, className: string): SVGElement => {
      let element = parts.get(name);
      if (!element) {
        element = document.createElementNS(SVG, tag);
        element.setAttribute('class', className);
        layer.current?.append(element);
        parts.set(name, element);
      }
      return element;
    };
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const project = useViewerStore.getState().cameraCallbacks.projectToScreen;
      if (!layer.current || !project) return;
      const toScreen = (p: Translation | null) => {
        if (!p) return null;
        const [x, y, z] = toRenderTranslation(p);
        const s = project({ x, y, z });
        return s && Number.isFinite(s.x) && Number.isFinite(s.y) ? s : null;
      };
      const s = measureState();
      const hover = s.picking ? toScreen(s.hover?.point ?? null) : null;
      const dot = (name: string, className: string, at: { x: number; y: number } | null, r: number) => {
        const element = part(name, 'circle', className);
        element.style.display = at ? '' : 'none';
        if (at) {
          element.setAttribute('cx', String(at.x));
          element.setAttribute('cy', String(at.y));
          element.setAttribute('r', String(r));
        }
      };
      const line = (name: string, className: string, a: { x: number; y: number } | null, b: { x: number; y: number } | null) => {
        const element = part(name, 'line', className);
        element.style.display = a && b ? '' : 'none';
        if (a && b) {
          element.setAttribute('x1', String(a.x));
          element.setAttribute('y1', String(a.y));
          element.setAttribute('x2', String(b.x));
          element.setAttribute('y2', String(b.y));
        }
      };
      for (const [which, points, step] of [['model', s.modelLine, 'model'], ['reference', s.referenceLine, 'reference']] as const) {
        const [a, b] = points.map((p) => toScreen(drawnPoint(p)));
        // While the second point is clicked, the line follows the pointer
        const end = b ?? (s.picking === step && a ? hover : null);
        line(`${which}-line`, `line ${which}`, a ?? null, end ?? null);
        dot(`${which}-1`, `point ${which}`, a ?? null, 4);
        dot(`${which}-2`, `point ${which}`, b ?? null, 4);
      }
      const pivot = s.pivot ? toScreen(drawnPoint(s.pivot)) : null;
      dot('pivot-ring', 'pivot', pivot, 9);
      line('pivot-h', 'pivot-cross', pivot ? { x: pivot.x - 5, y: pivot.y } : null, pivot ? { x: pivot.x + 5, y: pivot.y } : null);
      line('pivot-v', 'pivot-cross', pivot ? { x: pivot.x, y: pivot.y - 5 } : null, pivot ? { x: pivot.x, y: pivot.y + 5 } : null);
      dot('hover', 'hover', hover, 6);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      for (const element of parts.values()) element.remove();
    };
  }, [drawing]);

  return <svg ref={layer} className="bimpeil-measure" aria-hidden="true" />;
}
