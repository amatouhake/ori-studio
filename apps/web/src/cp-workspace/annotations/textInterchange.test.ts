import { expect, it } from 'vitest';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { createTextAnnotation, textDocFromPlainText } from './textAnnotation';
import { flattenDocumentTexts, normalizeDocumentTexts } from './textInterchange';

it('matches overlapping representations one-to-one without collapsing distinct entries', () => {
  const t = { x: 3, y: 4, text: 'same' };
  const annotation = createTextAnnotation({ center: { x: 3, y: 4 }, doc: textDocFromPlainText(t.text) });
  const document = createStarterOristudioCpDocument('overlap');
  document.crease_pattern.texts = [t, t, { ...t, x: 3.000001 }];
  expect(flattenDocumentTexts(document.crease_pattern.texts, [annotation])).toEqual([t, { ...t, x: 3.000001 }, t]);
  const normalized = normalizeDocumentTexts(document, [annotation]);
  expect(normalized.annotations).toHaveLength(3);
  expect(normalized.annotations[0]).toBe(annotation);
  expect(normalized.document.crease_pattern.texts).toEqual([]);
  expect(document.crease_pattern.texts).toHaveLength(3);
  expect(normalizeDocumentTexts(normalized.document, normalized.annotations).annotations).toBe(normalized.annotations);
});
