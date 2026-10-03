/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: uit welk bestand en welke versie in BIMpeil een open model komt. IfcLite bewaart het
 * `File` waarmee een model geladen is als `model.sourceFile`; wij koppelen dat object aan onze
 * verwijzing. Een lokaal geopend model heeft er geen. Nodig om een federatie op te slaan (V3).
 */

import type { FederatedModel } from '@/store';

export interface BimpeilModelRef {
  projectId: string;
  fileId: string;
  versionId: string;
}

const refs = new WeakMap<File, BimpeilModelRef>();

export function markBimpeilFile(file: File, ref: BimpeilModelRef): void {
  refs.set(file, ref);
}

export function bimpeilRefOf(model: Pick<FederatedModel, 'sourceFile'>): BimpeilModelRef | null {
  return model.sourceFile ? refs.get(model.sourceFile) ?? null : null;
}

const isObject = (data: unknown): data is Record<string, unknown> => !!data && typeof data === 'object';

/** Verwijzing uit een bericht van de webapp controleren */
export function parseModelRef(data: unknown): BimpeilModelRef | null {
  if (!isObject(data)) return null;
  const { projectId, fileId, versionId } = data;
  return typeof projectId === 'string' && typeof fileId === 'string' && typeof versionId === 'string' ? { projectId, fileId, versionId } : null;
}
