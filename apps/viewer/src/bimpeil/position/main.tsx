/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: entry of the bare viewer for positioning (bimpeil-position.html). The same start as the full viewer
 * (bootstrap.tsx: the side effect imports in that order, the user content, the WASM warm up), with PositionLayout
 * instead of ViewerLayout and without the privacy notice and analytics of the full viewer.
 */
import '../../disable-react-dev-perf-track';
import '../../harden-dom-mutations';
import '../fonts';
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../index.css';
import './position.css';
import '../../lib/placement-edit.boot';
import '../../i18n/locales.boot';
import { initializeUserContent } from '../../lib/storage/content-boot';
import { scheduleWasmPrewarm } from '../../lib/wasm-prewarm';
import { BimProvider } from '../../sdk/BimProvider';
import { ExtensionHostProvider } from '../../sdk/ExtensionHostProvider';
import { TooltipProvider } from '../../components/ui/tooltip';
import { CrashReport } from './CrashReport';
import { PositionLayout } from './PositionLayout';

initializeUserContent();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CrashReport>
      <BimProvider>
        <ExtensionHostProvider>
          <TooltipProvider delayDuration={300}>
            <PositionLayout />
          </TooltipProvider>
        </ExtensionHostProvider>
      </BimProvider>
    </CrashReport>
  </React.StrictMode>,
);
scheduleWasmPrewarm();
