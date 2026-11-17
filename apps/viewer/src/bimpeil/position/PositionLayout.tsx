/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: the bare viewer for positioning (bimpeil-position.html), like the embed viewer of IfcLite
 * (apps/viewer-embed): only the 3D view with navigating, snapping and the handles of the placement tools, no ribbon,
 * rail, panels or status bar. Every control is on the page around it (usePositionBridge.ts). The empty state of
 * IfcLite is hidden in position.css: the page says what to do.
 */
import { useEffect } from 'react';
import { ViewportContainer } from '@/components/viewer/ViewportContainer';
import { useOverlayCompositor } from '@/components/viewer/schedule/useOverlayCompositor';
import { useThemeDocumentClass } from '@/components/viewer/useThemeDocumentClass';
import { useViewerStore } from '@/store';
import { usePositionBridge } from './usePositionBridge';

export function PositionLayout() {
  // The writer of hidden entities and colours into the renderer, as in the full viewer (ViewerLayout.tsx)
  useOverlayCompositor();
  useThemeDocumentClass();
  usePositionBridge();
  // Light, like the page around it
  useEffect(() => useViewerStore.getState().setTheme('light'), []);
  return (
    <div className="bimpeil-position" style={{ position: 'fixed', inset: 0 }}>
      <ViewportContainer />
    </div>
  );
}
