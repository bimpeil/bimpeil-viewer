/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: an error while drawing the bare viewer goes to the page around it (`bimpeil:position-crashed`
 * `{ message }`), which shows it in its own style; the viewer itself then shows nothing.
 */
import { Component, type ReactNode } from 'react';

export class CrashReport extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: unknown) {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'bimpeil:position-crashed', message: error instanceof Error ? error.message : String(error) }, window.location.origin);
    }
  }

  render() {
    return this.state.crashed ? null : this.props.children;
  }
}
