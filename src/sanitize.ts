import type { SanitizeResult } from './types';
import { getAttr, normalizeTagName } from './utils';

const DANGEROUS_TAGS = new Set([
  'script',
  'foreignobject',
  'animate',
  'animatetransform',
  'animatemotion',
  'set',
  'image',
  'filter',
  'mask',
]);

function isExternalReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('http:') || normalized.startsWith('https:') || normalized.startsWith('data:');
}

export function detectDangerousConstructs(svgDoc: Document): { dangerous: boolean; reasons: string[] } {
  const reasons = new Set<string>();
  const elements = Array.from(svgDoc.querySelectorAll('*'));

  for (const el of elements) {
    const tag = normalizeTagName(el);

    if (DANGEROUS_TAGS.has(tag)) {
      reasons.add(`Contains <${tag}> which is unsafe or unsupported for preview.`);
    }

    if (el.hasAttribute('filter')) {
      reasons.add('Contains filter attribute which may execute unsupported rendering paths.');
    }

    for (const attr of Array.from(el.attributes)) {
      const attrName = attr.name.toLowerCase();
      const value = attr.value;

      if (attrName.startsWith('on')) {
        reasons.add(`Contains event handler attribute (${attr.name}).`);
      }

      if (attrName === 'href' || attrName === 'xlink:href') {
        if (isExternalReference(value)) {
          reasons.add('Contains external href/xlink:href reference.');
        }
      }
    }
  }

  return { dangerous: reasons.size > 0, reasons: Array.from(reasons) };
}

export function sanitizeSvgForPreview(svgText: string): SanitizeResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');

  if (parseError) {
    return {
      sanitizedSvg: '',
      removedCount: 0,
      blockedPreview: true,
      reasons: ['Unable to parse SVG XML.'],
    };
  }

  const { dangerous, reasons } = detectDangerousConstructs(doc);

  let removedCount = 0;
  const elements = Array.from(doc.querySelectorAll('*'));

  for (const el of elements) {
    const tag = normalizeTagName(el);

    if (DANGEROUS_TAGS.has(tag)) {
      el.remove();
      removedCount += 1;
      continue;
    }

    if (el.hasAttribute('filter')) {
      el.removeAttribute('filter');
      removedCount += 1;
    }

    for (const attr of Array.from(el.attributes)) {
      const attrName = attr.name.toLowerCase();
      const value = attr.value;

      if (attrName.startsWith('on')) {
        el.removeAttribute(attr.name);
        removedCount += 1;
      }

      if (attrName === 'href' || attrName === 'xlink:href') {
        if (isExternalReference(value)) {
          el.removeAttribute(attr.name);
          removedCount += 1;
        }
      }

      if ((attrName === 'fill' || attrName === 'stroke') && value.includes('url(') && !value.includes('#')) {
        el.removeAttribute(attr.name);
        removedCount += 1;
      }
    }

    const href = getAttr(el, 'href');
    if (href && isExternalReference(href)) {
      el.removeAttribute('href');
      el.removeAttribute('xlink:href');
      removedCount += 1;
    }
  }

  const root = doc.documentElement;
  const sanitizedSvg = new XMLSerializer().serializeToString(root);

  return {
    sanitizedSvg,
    removedCount,
    blockedPreview: dangerous,
    reasons,
  };
}
