import type { OristudioCpDocumentSnapshot, OristudioCpTextElement } from '../../engine/oristudioCpTypes';
import { textCoordinate } from '../../lib/creasePatternViewport';
import { flattenTextAnnotations, type CanvasAnnotation, type FlatText } from './annotation';
import { createTextAnnotation, textDocFromPlainText } from './textAnnotation';

/** Match only exact interchange values. Consume matches one-to-one so repeated
 * texts within either representation remain distinct. Canvas annotations own
 * richer state and win a match; proximity is not evidence of duplicate text. */
function unmatchedKernelTexts(texts: readonly OristudioCpTextElement[], canvas: readonly FlatText[]): FlatText[] {
  const key = (t: FlatText) => JSON.stringify([t.x, t.y, t.text]);
  const remaining = new Map<string, number>();
  for (const t of canvas) remaining.set(key(t), (remaining.get(key(t)) ?? 0) + 1);
  return texts.map(t => ({ x: textCoordinate(t.x), y: textCoordinate(t.y), text: t.text })).filter(t => {
    const count = remaining.get(key(t)) ?? 0;
    if (!count) return true;
    remaining.set(key(t), count - 1);
    return false;
  });
}

/** One plain-text projection for serialization and format-loss accounting. */
export function flattenDocumentTexts(texts: readonly OristudioCpTextElement[], annotations: readonly CanvasAnnotation[]): FlatText[] {
  const canvas = flattenTextAnnotations(annotations);
  return [...unmatchedKernelTexts(texts, canvas), ...canvas];
}

/** The live canvas owns text. Inflate interchange-only entries and clear the
 * kernel snapshot before installing it, retaining existing annotation objects.
 * Does not mutate the input document or any companions. */
export function normalizeDocumentTexts(document: OristudioCpDocumentSnapshot, annotations: CanvasAnnotation[] = []): {
  document: OristudioCpDocumentSnapshot; annotations: CanvasAnnotation[];
} {
  const texts = document.crease_pattern.texts;
  if (!texts.length) return { document, annotations };
  const imported = unmatchedKernelTexts(texts, flattenTextAnnotations(annotations)).map(t => createTextAnnotation({
    center: { x: t.x, y: t.y }, doc: textDocFromPlainText(t.text), plainText: t.text,
  }));
  return {
    document: { ...document, crease_pattern: { ...document.crease_pattern, texts: [] } },
    annotations: imported.length ? [...annotations, ...imported] : annotations,
  };
}
