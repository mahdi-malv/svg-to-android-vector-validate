import type { InputMode, Issue, SvgStats, ValidationResult } from './types';
import { detectDangerousConstructs } from './sanitize';
import { computeVerdict, getAttr, normalizeTagName, parseViewBox, pushIssue } from './utils';

const ANIMATION_TAGS = new Set(['animate', 'animatetransform', 'animatemotion', 'set']);
const UNSUPPORTED_PAINT_SERVER_TAGS = new Set(['pattern', 'filter', 'mask', 'clippath']);
const NESTED_TRANSFORM_WARN_THRESHOLD = 3;
const ELEMENT_COUNT_WARN_THRESHOLD = 200;
const PATH_COUNT_WARN_THRESHOLD = 50;
const PATH_D_LENGTH_WARN_THRESHOLD = 5000;

function isExternalRef(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.startsWith('http:') || v.startsWith('https:') || v.startsWith('data:');
}

function extractPaintServerId(value: string): string | undefined {
  const match = value.match(/url\(([^)]+)\)/i);
  if (!match) {
    return undefined;
  }
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function hasTag(elements: Element[], tagName: string): boolean {
  return elements.some((el) => normalizeTagName(el) === tagName);
}

function computeNestedTransformDepth(root: Element): number {
  let maxDepth = 0;

  const walk = (node: Element, activeDepth: number): void => {
    const hasTransform = node.hasAttribute('transform');
    const nextDepth = hasTransform ? activeDepth + 1 : activeDepth;
    maxDepth = Math.max(maxDepth, nextDepth);

    for (const child of Array.from(node.children)) {
      walk(child, nextDepth);
    }
  };

  walk(root, 0);
  return maxDepth;
}

function collectStats(svg: Element): SvgStats {
  const descendants = Array.from(svg.querySelectorAll('*'));
  const paths = descendants.filter((el) => normalizeTagName(el) === 'path');
  const hasLinearGradient = descendants.some((el) => normalizeTagName(el) === 'lineargradient');
  const hasRadialGradient = descendants.some((el) => normalizeTagName(el) === 'radialgradient');
  const hasGroups = descendants.some((el) => normalizeTagName(el) === 'g');

  const colors = new Set<string>();
  let maxPathDLength = 0;

  for (const el of descendants) {
    const fill = el.getAttribute('fill');
    const stroke = el.getAttribute('stroke');
    if (fill && fill !== 'none' && !fill.startsWith('url(')) {
      colors.add(fill.trim().toLowerCase());
    }
    if (stroke && stroke !== 'none' && !stroke.startsWith('url(')) {
      colors.add(stroke.trim().toLowerCase());
    }
  }

  for (const path of paths) {
    const d = path.getAttribute('d') ?? '';
    if (d.length > maxPathDLength) {
      maxPathDLength = d.length;
    }
  }

  return {
    width: svg.getAttribute('width') ?? undefined,
    height: svg.getAttribute('height') ?? undefined,
    viewBox: svg.getAttribute('viewBox') ?? undefined,
    elementCount: descendants.length + 1,
    pathCount: paths.length,
    hasLinearGradient,
    hasRadialGradient,
    hasGradients: hasLinearGradient || hasRadialGradient,
    hasGroups,
    colorCount: colors.size,
    maxPathDLength,
    nestedTransformDepthMax: computeNestedTransformDepth(svg),
  };
}

function validateReferences(elements: Element[], issues: Issue[]): void {
  for (const el of elements) {
    const href = getAttr(el, 'href');
    if (href && isExternalRef(href)) {
      pushIssue(
        issues,
        'error',
        'external-reference',
        'External href/xlink:href reference detected.',
        'External dependencies are brittle and often unsupported in Android vector assets.',
        `Reference: ${href}`,
        'Inline or embed referenced assets and use internal fragment refs when possible.',
      );
    }

    for (const attrName of ['fill', 'stroke']) {
      const value = el.getAttribute(attrName);
      if (!value || !value.includes('url(')) {
        continue;
      }

      const extracted = extractPaintServerId(value);
      if (!extracted) {
        continue;
      }

      if (isExternalRef(extracted) || (!extracted.startsWith('#') && !extracted.startsWith('data:'))) {
        pushIssue(
          issues,
          'error',
          'unsupported-paint-server-ref',
          'Paint server reference points to an external or unsupported URL.',
          'External or unsupported paint servers will not map cleanly to VectorDrawable.',
          `Value: ${value}`,
          'Use flat colors or supported internal gradients.',
        );
        continue;
      }

      if (extracted.startsWith('#')) {
        const target = el.ownerDocument.querySelector(extracted);
        if (target) {
          const tag = normalizeTagName(target);
          if (UNSUPPORTED_PAINT_SERVER_TAGS.has(tag)) {
            pushIssue(
              issues,
              'error',
              'unsupported-paint-server-ref',
              'Paint server references an unsupported element type.',
              'Pattern/filter/mask/clip paint servers are not reliably supported in VectorDrawable conversion.',
              `Target element: <${tag}>`,
              'Replace with plain fills, flat paths, or simplified gradients.',
            );
          }
        }
      }
    }
  }
}

function addInfoIssues(stats: SvgStats, issues: Issue[]): void {
  pushIssue(
    issues,
    'info',
    'suggest-artboard-size',
    'Consider common icon artboard sizes (24/32/48).',
    'Using standard viewport sizes improves scaling consistency in Android.',
    undefined,
    'Align source artwork to a common baseline size before export.',
  );

  if (stats.colorCount > 1 || stats.hasGradients) {
    pushIssue(
      issues,
      'info',
      'multi-color-or-gradient-tinting-note',
      'Multiple colors or gradients detected.',
      'Complex color usage can make runtime tinting harder in Android.',
      `Color count: ${stats.colorCount}, gradients: ${stats.hasGradients ? 'yes' : 'no'}`,
      'Prefer a single-color icon if runtime tinting is required.',
    );
  }

  if (stats.hasGroups) {
    pushIssue(
      issues,
      'info',
      'groups-present',
      'Group elements (<g>) are present.',
      'Nested groups can increase transformation complexity during conversion.',
      undefined,
      'Flatten groups when possible.',
    );
  }
}

function emptyStats(): SvgStats {
  return {
    elementCount: 0,
    pathCount: 0,
    hasLinearGradient: false,
    hasRadialGradient: false,
    hasGradients: false,
    hasGroups: false,
    colorCount: 0,
    maxPathDLength: 0,
    nestedTransformDepthMax: 0,
  };
}

export function validateSvg(svgText: string, inputMode: InputMode, sourceLabel?: string): ValidationResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const parserError = doc.querySelector('parsererror');

  if (parserError) {
    const issues: Issue[] = [
      {
        severity: 'error',
        code: 'invalid-svg-xml',
        message: 'Invalid SVG XML. Parsing failed.',
        whyItMatters: 'Malformed XML cannot be reliably converted or rendered.',
        details: parserError.textContent?.slice(0, 300),
        suggestion: 'Fix malformed tags/attributes and validate the SVG XML syntax.',
      },
    ];

    return {
      verdict: 'FAIL',
      issues,
      stats: emptyStats(),
      parseError: parserError.textContent?.trim() || 'Unable to parse SVG',
      dangerousForPreview: true,
      metadata: {
        timestamp: new Date().toISOString(),
        inputMode,
        sourceLabel,
      },
    };
  }

  const svg = doc.querySelector('svg');
  if (!svg) {
    const issues: Issue[] = [
      {
        severity: 'error',
        code: 'missing-svg-root',
        message: 'No <svg> root element found.',
        whyItMatters: 'A missing root SVG element means the input is not valid SVG content.',
        suggestion: 'Provide a complete SVG document beginning with <svg ...>.',
      },
    ];

    return {
      verdict: 'FAIL',
      issues,
      stats: emptyStats(),
      parseError: 'No <svg> root element found',
      dangerousForPreview: true,
      metadata: {
        timestamp: new Date().toISOString(),
        inputMode,
        sourceLabel,
      },
    };
  }

  const issues: Issue[] = [];
  const elements = Array.from(svg.querySelectorAll('*'));
  const stats = collectStats(svg);
  const dangerous = detectDangerousConstructs(doc);

  if (hasTag(elements, 'filter') || elements.some((el) => el.hasAttribute('filter'))) {
    pushIssue(
      issues,
      'error',
      'unsupported-filter',
      'Filter usage detected (<filter> or filter="...").',
      'Android VectorDrawable does not support SVG filter effects like blur/drop shadow.',
      undefined,
      'Flatten visual effects into paths before export.',
    );
  }

  if (hasTag(elements, 'foreignobject')) {
    pushIssue(
      issues,
      'error',
      'unsupported-foreignObject',
      '<foreignObject> detected.',
      'foreignObject embeds non-SVG content that VectorDrawable cannot represent.',
      undefined,
      'Convert embedded content to pure vector paths.',
    );
  }

  if (elements.some((el) => ANIMATION_TAGS.has(normalizeTagName(el)))) {
    pushIssue(
      issues,
      'error',
      'unsupported-animation',
      'Animation elements detected.',
      'VectorDrawable conversion does not preserve generic SVG animation tags.',
      undefined,
      'Remove animation or create Android-specific animated drawable resources.',
    );
  }

  if (hasTag(elements, 'mask')) {
    pushIssue(
      issues,
      'error',
      'unsupported-mask',
      '<mask> detected.',
      'Masks usually do not convert reliably to Android vector assets.',
      undefined,
      'Replace masked output with flattened geometry.',
    );
  }

  if (hasTag(elements, 'image')) {
    pushIssue(
      issues,
      'error',
      'embedded-raster-image',
      '<image> element detected.',
      'Embedded raster content breaks the pure-vector conversion path.',
      undefined,
      'Replace raster elements with vector paths.',
    );
  }

  if (
    hasTag(elements, 'script') ||
    elements.some((el) => Array.from(el.attributes).some((attr) => attr.name.toLowerCase().startsWith('on')))
  ) {
    pushIssue(
      issues,
      'error',
      'script-or-events',
      'Script tag or event-handler attributes detected.',
      'Scripts/events are unsafe and not part of Android vector asset conversion.',
      undefined,
      'Remove scripts and inline event handlers.',
    );
  }

  validateReferences(elements, issues);

  if (hasTag(elements, 'clippath')) {
    pushIssue(
      issues,
      'warning',
      'clipPath-present',
      '<clipPath> detected.',
      'Clipping can convert inconsistently depending on shape complexity.',
      undefined,
      'Flatten clipped results into explicit paths when possible.',
    );
  }

  if (hasTag(elements, 'text')) {
    pushIssue(
      issues,
      'warning',
      'text-present',
      '<text> detected.',
      'Text rendering depends on fonts and may not convert faithfully.',
      undefined,
      'Outline text to paths before exporting SVG.',
    );
  }

  if (elements.some((el) => el.hasAttribute('stroke') || el.hasAttribute('stroke-width'))) {
    pushIssue(
      issues,
      'warning',
      'stroke-present',
      'Stroke usage detected.',
      'Stroke joins/caps may differ after conversion.',
      undefined,
      'Expand strokes to filled outlines.',
    );
  }

  if (stats.hasGradients) {
    pushIssue(
      issues,
      'warning',
      'gradient-present',
      'Gradient elements detected.',
      'Gradient rendering may not exactly match Android output.',
      undefined,
      'Verify rendered result in Android Studio after import.',
    );
  }

  const groupWithOpacity = elements.some((el) => normalizeTagName(el) === 'g' && el.hasAttribute('opacity'));
  if (groupWithOpacity || stats.nestedTransformDepthMax > 1) {
    pushIssue(
      issues,
      'warning',
      'group-opacity-or-complex-transform',
      'Group opacity or transform stacking detected.',
      'Nested alpha/transforms can produce visual differences post-conversion.',
      `Max nested transform depth: ${stats.nestedTransformDepthMax}`,
      'Flatten groups/transforms before export.',
    );
  }

  if (hasTag(elements, 'style') || elements.some((el) => el.hasAttribute('class'))) {
    pushIssue(
      issues,
      'warning',
      'style-or-class-usage',
      'Stylesheet/class usage detected.',
      'CSS-based styling is often ignored or flattened unpredictably during conversion.',
      undefined,
      'Inline style attributes directly on each element.',
    );
  }

  if (stats.nestedTransformDepthMax > NESTED_TRANSFORM_WARN_THRESHOLD) {
    pushIssue(
      issues,
      'warning',
      'nested-transform-depth-high',
      `Nested transform depth is high (${stats.nestedTransformDepthMax}).`,
      'Deep transform stacks are difficult to convert accurately.',
      undefined,
      'Apply transforms and flatten geometry in authoring tool.',
    );
  }

  if (stats.elementCount > ELEMENT_COUNT_WARN_THRESHOLD) {
    pushIssue(
      issues,
      'warning',
      'complexity-elements-high',
      `Element count is high (${stats.elementCount}).`,
      'Highly complex vectors can increase rendering cost and conversion risk.',
      undefined,
      'Simplify the SVG by merging or reducing nodes.',
    );
  }

  if (stats.pathCount > PATH_COUNT_WARN_THRESHOLD) {
    pushIssue(
      issues,
      'warning',
      'complexity-path-count-high',
      `Path count is high (${stats.pathCount}).`,
      'Many paths can bloat VectorDrawable output and reduce performance.',
      undefined,
      'Simplify and merge path geometry where possible.',
    );
  }

  if (stats.maxPathDLength > PATH_D_LENGTH_WARN_THRESHOLD) {
    pushIssue(
      issues,
      'warning',
      'complexity-path-d-long',
      `At least one path is very long (${stats.maxPathDLength} chars).`,
      'Very long path commands are harder to maintain and can cause conversion issues.',
      undefined,
      'Optimize or split very complex paths.',
    );
  }

  if (!stats.viewBox || !stats.width || !stats.height) {
    pushIssue(
      issues,
      'warning',
      'missing-viewBox-or-size',
      'Missing viewBox or width/height attributes.',
      'Android vector viewport sizing is more predictable with explicit dimensions and viewBox.',
      `viewBox=${stats.viewBox ?? 'missing'}, width=${stats.width ?? 'missing'}, height=${stats.height ?? 'missing'}`,
      'Set explicit width, height, and viewBox.',
    );
  }

  const viewBoxParsed = parseViewBox(stats.viewBox);
  if (
    typeof viewBoxParsed.width === 'number' &&
    typeof viewBoxParsed.height === 'number' &&
    (!Number.isInteger(viewBoxParsed.width) || !Number.isInteger(viewBoxParsed.height))
  ) {
    pushIssue(
      issues,
      'warning',
      'non-integer-viewBox',
      'Non-integer viewBox dimensions detected.',
      'Fractional viewport sizes can lead to subtle scaling differences on Android.',
      `viewBox dimensions: ${viewBoxParsed.width} x ${viewBoxParsed.height}`,
      'Use integer viewport dimensions when practical.',
    );
  }

  addInfoIssues(stats, issues);

  return {
    verdict: computeVerdict(issues),
    issues,
    stats,
    dangerousForPreview: dangerous.dangerous,
    metadata: {
      timestamp: new Date().toISOString(),
      inputMode,
      sourceLabel,
    },
  };
}
