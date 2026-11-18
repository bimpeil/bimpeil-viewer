/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BIMpeil: the texts of the section in the bare viewer (SectionLayer.tsx). The viewer has no texts of its own: the
 * page sends them in its language (`bimpeil:position-texts`), so every text stays with the page and its translations.
 * Until then, English.
 */

export interface SectionTexts {
  /** A locale for numbers, such as nl-NL */
  locale: string;
  menu: string;
  throughFace: string;
  horizontalHere: string;
  flip: string;
  remove: string;
  /** The handle: drag, arrow keys, Delete */
  handle: string;
  /** Where the plane is, with {{value}} for the number in metres */
  at: { z: string; x: string; y: string; picked: string };
}

const ENGLISH: SectionTexts = {
  locale: 'en-GB',
  menu: 'Section',
  throughFace: 'Section through this face',
  horizontalHere: 'Horizontal section here',
  flip: 'Flip',
  remove: 'Remove',
  handle: 'Move the section',
  at: { z: 'Height {{value}}', x: 'X {{value}}', y: 'Y {{value}}', picked: 'From the face {{value}}' },
};

let texts = ENGLISH;
const listeners = new Set<() => void>();

export const sectionTexts = (): SectionTexts => texts;

export function subscribeSectionTexts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 200;

/** Take the texts of the page; anything that is not a short text keeps the English one */
export function setSectionTexts(data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const d = data as Record<string, unknown>;
  const at = d.at && typeof d.at === 'object' ? (d.at as Record<string, unknown>) : {};
  texts = {
    locale: isText(d.locale) ? d.locale : ENGLISH.locale,
    menu: isText(d.menu) ? d.menu : ENGLISH.menu,
    throughFace: isText(d.throughFace) ? d.throughFace : ENGLISH.throughFace,
    horizontalHere: isText(d.horizontalHere) ? d.horizontalHere : ENGLISH.horizontalHere,
    flip: isText(d.flip) ? d.flip : ENGLISH.flip,
    remove: isText(d.remove) ? d.remove : ENGLISH.remove,
    handle: isText(d.handle) ? d.handle : ENGLISH.handle,
    at: {
      z: isText(at.z) ? at.z : ENGLISH.at.z,
      x: isText(at.x) ? at.x : ENGLISH.at.x,
      y: isText(at.y) ? at.y : ENGLISH.at.y,
      picked: isText(at.picked) ? at.picked : ENGLISH.at.picked,
    },
  };
  for (const listener of listeners) listener();
}

/** Where the plane is, as the page writes numbers: three decimals in the locale of the page, in metres */
export function sectionAtText(direction: keyof SectionTexts['at'], value: number): string {
  let number: string;
  try {
    number = value.toLocaleString(texts.locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  } catch (error) {
    console.warn('[BIMpeil] section: unknown locale, numbers in English', error);
    number = value.toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  return texts.at[direction].replace('{{value}}', `${number} m`);
}
