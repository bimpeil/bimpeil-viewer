/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: the section of the bare viewer for positioning, worked from the 3D view only (PositionLayout.tsx).
 *
 * A right click on a model opens a small menu: a section through the clicked face, or a horizontal one at that
 * point; while a section cuts, also flip and remove. The plane has a handle: drag it to move the plane along its
 * normal, with where the plane is in metres next to it; the arrow keys move it by 0,1 m (with Shift 1 m); a right
 * click on the handle opens the menu; Delete removes the section while it is selected (after making it, or a click on
 * the handle). The page sends the texts (section-texts.ts). The plane itself is the one of section-scene.ts.
 *
 * A right click, not a right drag: the menu opens when the button comes up without moving, so a drag with the right
 * button stays IfcLite's. On macOS and Linux the browser fires `contextmenu` on the press, so the menu waits for the
 * release there; on Windows it comes after the release.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { getGlobalRenderer } from '@/hooks/useBCF';
import { useViewerStore } from '@/store';
import { dragMetres, sectionMenu, type ScreenXY, type Triple } from './section';
import { applyPickedSection, flipSection, horizontalSectionAt, moveSectionTo, removeSection, sectionHandle } from './section-scene';
import { sectionAtText, sectionTexts, subscribeSectionTexts } from './section-texts';

/** The arrow of the handle on the screen, along the normal */
const ARROW_PX = 56;
/** A right press that moves further than this is a drag, not a click */
const MOVED_PX = 4;

interface Menu {
  x: number;
  y: number;
  face: { point: Triple; normal: Triple } | null;
}

const finite = (p: ScreenXY | null): p is ScreenXY => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

export function SectionLayer() {
  const texts = useSyncExternalStore(subscribeSectionTexts, sectionTexts);
  const cutting = useViewerStore((s) => s.sectionPlane.enabled && !!s.sectionPlane.custom);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [selected, setSelected] = useState(false);
  const selectedRef = useRef(false);
  selectedRef.current = selected;
  const layer = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLDivElement>(null);
  const arrow = useRef<SVGLineElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** Where the handle and one metre along the normal are on the screen now, and the plane: for dragging */
  const screen = useRef<{ foot: ScreenXY; tip: ScreenXY; distance: number } | null>(null);
  const drag = useRef<{ pointer: number; from: ScreenXY; foot: ScreenXY; tip: ScreenXY; distance: number } | null>(null);

  useEffect(() => {
    if (!cutting) setSelected(false);
  }, [cutting]);

  // ---- The right click, Delete and Escape ----
  useEffect(() => {
    let down: ScreenXY | null = null;
    let dragged = false;
    let released = false;
    let waiting: ScreenXY | null = null;
    const inView = (target: EventTarget | null) => target instanceof Element && !!target.closest('[data-viewport]');
    const open = (at: ScreenXY) => {
      const renderer = getGlobalRenderer();
      const canvas = renderer?.getCanvas();
      if (!renderer || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const state = useViewerStore.getState();
      const hit = renderer.raycastScene(at.x - rect.left, at.y - rect.top, { hiddenIds: state.hiddenEntities, isolatedIds: state.isolatedEntities });
      const surface = hit?.intersection;
      const face = surface
        ? { point: [surface.point.x, surface.point.y, surface.point.z] as Triple, normal: [surface.normal.x, surface.normal.y, surface.normal.z] as Triple }
        : null;
      const active = state.sectionPlane.enabled && !!state.sectionPlane.custom;
      if (sectionMenu(!!face, active).length) setMenu({ x: at.x, y: at.y, face });
    };
    const pointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
      if (event.button === 2 && inView(event.target)) {
        down = { x: event.clientX, y: event.clientY };
        dragged = false;
        released = false;
        waiting = null;
      }
      if (event.button === 0 && !grip.current?.contains(event.target as Node)) setSelected(false);
    };
    const pointerMove = (event: PointerEvent) => {
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > MOVED_PX) dragged = true;
    };
    const pointerUp = (event: PointerEvent) => {
      if (event.button !== 2 || !down) return;
      released = true;
      down = null;
      if (waiting && !dragged) open(waiting);
      waiting = null;
    };
    const contextMenu = (event: MouseEvent) => {
      if (!inView(event.target)) return;
      // Our menu, not that of the browser nor the selection of IfcLite
      event.preventDefault();
      event.stopImmediatePropagation();
      if (dragged) return;
      const at = { x: event.clientX, y: event.clientY };
      if (released) open(at);
      else waiting = at;
      released = false;
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedRef.current && !typing) {
        event.preventDefault();
        removeSection();
        setSelected(false);
        setMenu(null);
      }
    };
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('pointermove', pointerMove, true);
    window.addEventListener('pointerup', pointerUp, true);
    window.addEventListener('contextmenu', contextMenu, true);
    window.addEventListener('keydown', key);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointermove', pointerMove, true);
      window.removeEventListener('pointerup', pointerUp, true);
      window.removeEventListener('contextmenu', contextMenu, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('wheel', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  // The first item takes the focus, so the menu also works with the keyboard
  useEffect(() => {
    if (menu) menuRef.current?.querySelector('button')?.focus();
  }, [menu]);

  // ---- The handle, drawn every frame where the plane is ----
  useEffect(() => {
    if (!cutting) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = layer.current;
      const project = useViewerStore.getState().cameraCallbacks.projectToScreen;
      if (!element || !project) return;
      const state = useViewerStore.getState();
      const handle = sectionHandle(state.modelPlacement.preview?.modelIds[0] ?? null);
      const foot = handle ? project(handle.foot) : null;
      const tip = handle ? project(handle.tip) : null;
      if (!handle || !finite(foot) || !finite(tip)) {
        element.style.display = 'none';
        screen.current = null;
        return;
      }
      element.style.display = '';
      screen.current = { foot, tip, distance: handle.distance };
      const dx = tip.x - foot.x;
      const dy = tip.y - foot.y;
      const length = Math.hypot(dx, dy);
      const [ux, uy] = length > 1e-6 ? [dx / length, dy / length] : [0, -1];
      arrow.current?.setAttribute('x1', String(foot.x));
      arrow.current?.setAttribute('y1', String(foot.y));
      arrow.current?.setAttribute('x2', String(foot.x + ux * ARROW_PX));
      arrow.current?.setAttribute('y2', String(foot.y + uy * ARROW_PX));
      if (grip.current) grip.current.style.transform = `translate(${foot.x}px, ${foot.y}px)`;
      const text = sectionAtText(handle.direction, handle.value);
      if (label.current && label.current.textContent !== text) label.current.textContent = text;
      if (grip.current) grip.current.setAttribute('aria-valuetext', text);
      // For the smoke test of BIMpeil-ifc: what cuts, and whether the renderer cut its last frame
      element.dataset.direction = handle.direction;
      element.dataset.flipped = String(handle.flipped);
      element.dataset.clipped = String(getGlobalRenderer()?.hasActiveClipping() ?? false);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [cutting]);

  const choose = (item: ReturnType<typeof sectionMenu>[number]) => {
    const face = menu?.face;
    setMenu(null);
    if (item === 'throughFace' && face) applyPickedSection(face);
    else if (item === 'horizontalHere' && face) horizontalSectionAt(face.point);
    else if (item === 'flip') flipSection();
    else if (item === 'remove') {
      removeSection();
      setSelected(false);
      return;
    }
    setSelected(true);
  };

  const onGripDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(true);
    grip.current?.focus();
    const now = screen.current;
    if (!now) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, from: { x: event.clientX, y: event.clientY }, foot: now.foot, tip: now.tip, distance: now.distance };
  };
  const onGripMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    const metres = dragMetres(d.foot, d.tip, d.from, { x: event.clientX, y: event.clientY });
    if (metres !== null) moveSectionTo(d.distance + metres);
  };
  const onGripUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onGripKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 1 : 0.1;
    const by = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? step : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -step : 0;
    // From the plane itself, not from the last frame: two keys within one frame are two steps
    const distance = useViewerStore.getState().sectionPlane.custom?.distance;
    if (!by || distance === undefined) return;
    event.preventDefault();
    moveSectionTo(distance + by);
  };
  const onGripMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSelected(true);
    setMenu({ x: event.clientX, y: event.clientY, face: null });
  };

  const items = menu ? sectionMenu(!!menu.face, cutting) : [];
  const left = menu ? Math.max(4, Math.min(menu.x, window.innerWidth - 240)) : 0;
  const top = menu ? Math.max(4, Math.min(menu.y, window.innerHeight - 8 - items.length * 34)) : 0;
  return (
    <>
      {cutting && (
        <div ref={layer} className="bimpeil-section" data-selected={selected ? '' : undefined}>
          <svg className="arrow" aria-hidden="true">
            <defs>
              <marker id="bimpeil-section-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" />
              </marker>
            </defs>
            <line ref={arrow} markerEnd="url(#bimpeil-section-head)" />
          </svg>
          <div
            ref={grip}
            className="grip"
            role="slider"
            tabIndex={0}
            aria-label={texts.handle}
            onPointerDown={onGripDown}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
            onKeyDown={onGripKey}
            onContextMenu={onGripMenu}
          >
            <span ref={label} className="label" />
          </div>
        </div>
      )}
      {menu && items.length > 0 && (
        <div ref={menuRef} className="bimpeil-section-menu" role="menu" aria-label={texts.menu} style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
          {items.map((item) => (
            <button key={item} type="button" role="menuitem" onClick={() => choose(item)}>
              {texts[item]}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
