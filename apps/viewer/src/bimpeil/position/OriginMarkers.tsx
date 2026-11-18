/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: a marker with the name of the file at the origin of every model, while the page shows the origins
 * (origin-scene.ts). In the style of the page (position.css): a ring in Graphite, filled for the model that moves.
 * The markers move with the model, also while it is dragged. Models that share their origin, the usual case before
 * aligning, get one ring each on the same spot and their names under each other.
 *
 * Drawn on top of the 3D view with the projection of IfcLite, once per frame and only while shown: a few points, set
 * straight on the elements, without React in between.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useViewerStore } from '@/store';
import { currentOrigins, originsShown, subscribeOriginsShown } from './origin-scene';

export function OriginMarkers() {
  const shown = useSyncExternalStore(subscribeOriginsShown, originsShown);
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!shown) return;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const element = layer.current;
      const project = useViewerStore.getState().cameraCallbacks.projectToScreen;
      if (!element || !project) return;
      const seen = new Set<string>();
      const placed: { x: number; y: number }[] = [];
      for (const origin of currentOrigins()) {
        seen.add(origin.modelId);
        let marker = [...element.children].find((child) => (child as HTMLElement).dataset.model === origin.modelId) as HTMLElement | undefined;
        if (!marker) {
          marker = document.createElement('div');
          marker.className = 'bimpeil-origin';
          marker.dataset.model = origin.modelId;
          const dot = document.createElement('span');
          dot.className = 'dot';
          const name = document.createElement('span');
          name.className = 'name';
          marker.append(dot, name);
          element.append(marker);
        }
        const name = marker.querySelector('.name');
        if (name && name.textContent !== origin.name) name.textContent = origin.name;
        marker.classList.toggle('moving', origin.moving);
        const screen = project(origin.render);
        if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
          marker.style.display = 'none';
          continue;
        }
        marker.style.display = '';
        marker.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
        // Names of markers on (almost) the same spot under each other
        const stack = placed.filter((p) => Math.abs(p.x - screen.x) < 6 && Math.abs(p.y - screen.y) < 6).length;
        marker.style.setProperty('--stack', String(stack));
        placed.push(screen);
      }
      for (const child of [...element.children]) {
        if (!seen.has((child as HTMLElement).dataset.model ?? '')) child.remove();
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [shown]);

  return shown ? <div ref={layer} className="bimpeil-origins" aria-hidden="true" /> : null;
}
