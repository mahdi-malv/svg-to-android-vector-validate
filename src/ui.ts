import { FETCH_ERROR_MESSAGE, fetchSvgFromUrl } from './fetch';
import { SAMPLE_SVGS } from './samples';
import { sanitizeSvgForPreview } from './sanitize';
import type { InputMode, Issue, ValidationResult } from './types';
import { downloadTextFile, groupIssues } from './utils';
import { validateSvg } from './validator';

type AppState = {
  lastResult?: ValidationResult;
  lastSanitizedSvg?: string;
};

type RenderCheckLevel = 'pass' | 'warn' | 'fail';
type RenderCheck = {
  level: RenderCheckLevel;
  label: string;
  details: string;
};

const state: AppState = {};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element #${id}`);
  }
  return el;
}

function renderIssues(listEl: HTMLElement, issues: Issue[]): void {
  listEl.innerHTML = '';
  if (issues.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'None';
    listEl.appendChild(li);
    return;
  }

  for (const issue of issues) {
    const li = document.createElement('li');
    li.className = 'issue-card';
    li.innerHTML = `
      <div><strong>${issue.message}</strong></div>
      <div class="issue-code">${issue.code}</div>
      <div class="issue-why">Why it matters: ${issue.whyItMatters}</div>
      ${issue.suggestion ? `<div class="issue-suggestion">Suggestion: ${issue.suggestion}</div>` : ''}
      ${issue.details ? `<div class="issue-suggestion">Details: ${issue.details}</div>` : ''}
    `;
    listEl.appendChild(li);
  }
}

function updateVerdictBadge(verdict: ValidationResult['verdict']): void {
  const badge = $('verdictBadge');
  badge.textContent = verdict;
  badge.className = 'badge';
  if (verdict === 'PASS') {
    badge.classList.add('badge-pass');
  } else if (verdict === 'WARN') {
    badge.classList.add('badge-warn');
  } else {
    badge.classList.add('badge-fail');
  }
}

function renderStats(result: ValidationResult): void {
  const stats = $('stats');
  const s = result.stats;
  stats.innerHTML = `
    <strong>Stats</strong><br>
    width: ${s.width ?? 'n/a'}<br>
    height: ${s.height ?? 'n/a'}<br>
    viewBox: ${s.viewBox ?? 'n/a'}<br>
    elements: ${s.elementCount}<br>
    paths: ${s.pathCount}<br>
    max path d length: ${s.maxPathDLength}<br>
    gradients: ${s.hasGradients ? 'yes' : 'no'} (linear: ${s.hasLinearGradient ? 'yes' : 'no'}, radial: ${s.hasRadialGradient ? 'yes' : 'no'})<br>
    groups: ${s.hasGroups ? 'yes' : 'no'}<br>
    colors: ${s.colorCount}<br>
    max nested transform depth: ${s.nestedTransformDepthMax}
  `;
}

function renderBrowserChecks(result: ValidationResult): void {
  const checks: RenderCheck[] = [];
  const issueCodes = new Set(result.issues.map((issue) => issue.code));
  const hasViewBox = Boolean(result.stats.viewBox);
  const hasSizing = Boolean(result.stats.width || result.stats.height);

  checks.push({
    level: 'pass',
    label: 'SVG parse',
    details: 'SVG XML parsed and <svg> root exists.',
  });

  checks.push({
    level: hasViewBox ? 'pass' : 'fail',
    label: 'Scalable viewport',
    details: hasViewBox ? `viewBox found (${result.stats.viewBox}).` : 'Missing viewBox causes inconsistent browser scaling.',
  });

  checks.push({
    level: hasSizing ? 'pass' : 'warn',
    label: 'Explicit sizing',
    details: hasSizing ? 'At least one of width/height is set.' : 'No width/height. Browser defaults may vary by context.',
  });

  const hasExternalRefs = issueCodes.has('external-reference') || issueCodes.has('unsupported-paint-server-ref');
  checks.push({
    level: hasExternalRefs ? 'fail' : 'pass',
    label: 'External dependency risk',
    details: hasExternalRefs
      ? 'External href/paint references can fail due to CORS/path differences.'
      : 'No risky external references detected.',
  });

  const hasUnsupportedConstructs =
    issueCodes.has('script-or-events') ||
    issueCodes.has('unsupported-foreignObject') ||
    issueCodes.has('unsupported-filter') ||
    issueCodes.has('embedded-raster-image') ||
    issueCodes.has('unsupported-animation') ||
    issueCodes.has('unsupported-mask');
  checks.push({
    level: hasUnsupportedConstructs ? 'warn' : 'pass',
    label: 'Cross-browser feature risk',
    details: hasUnsupportedConstructs
      ? 'Detected constructs known to render inconsistently or unsafely.'
      : 'No high-risk browser feature usage detected.',
  });

  const isComplex =
    result.stats.elementCount > 200 ||
    result.stats.pathCount > 50 ||
    result.stats.maxPathDLength > 5000 ||
    result.stats.nestedTransformDepthMax > 3;
  checks.push({
    level: isComplex ? 'warn' : 'pass',
    label: 'Complexity/performance',
    details: isComplex
      ? 'High complexity may cause jank on lower-end devices.'
      : 'Complexity is within conservative browser-friendly thresholds.',
  });

  const listEl = $('renderChecksList');
  listEl.innerHTML = '';
  for (const check of checks) {
    const li = document.createElement('li');
    li.className = `render-check render-check-${check.level}`;
    li.innerHTML = `<strong>${check.label}:</strong> ${check.details}`;
    listEl.appendChild(li);
  }
}

function renderPreview(svgText: string, result: ValidationResult): void {
  const previewNotice = $('previewNotice');
  const previewContainer = $('previewContainer');
  const exportBtn = $('exportSanitizedBtn') as HTMLButtonElement;

  previewContainer.innerHTML = '';
  renderBrowserChecks(result);

  const sanitizeResult = sanitizeSvgForPreview(svgText);
  state.lastSanitizedSvg = sanitizeResult.sanitizedSvg;

  if (!sanitizeResult.sanitizedSvg.trim()) {
    previewNotice.textContent = 'Unable to render preview from sanitized SVG.';
    exportBtn.disabled = sanitizeResult.sanitizedSvg.length === 0;
    if (sanitizeResult.reasons.length > 0) {
      previewNotice.textContent += ` ${sanitizeResult.reasons[0]}`;
    }
    return;
  }

  previewNotice.textContent = 'Preview rendered from sanitized SVG.';
  if (sanitizeResult.removedCount > 0) {
    previewNotice.textContent += ` Removed ${sanitizeResult.removedCount} risky item(s).`;
  }
  previewContainer.innerHTML = sanitizeResult.sanitizedSvg;
  exportBtn.disabled = sanitizeResult.sanitizedSvg.length === 0;
}

function setActionsEnabled(enabled: boolean): void {
  ($('copyReportBtn') as HTMLButtonElement).disabled = !enabled;
  ($('downloadReportBtn') as HTMLButtonElement).disabled = !enabled;
}

function renderResult(result: ValidationResult, originalSvg: string): void {
  state.lastResult = result;

  const statusLine = $('statusLine');
  if (result.parseError) {
    statusLine.textContent = `Parse error: ${result.parseError}`;
  } else {
    statusLine.textContent = `Validation completed at ${new Date(result.metadata.timestamp).toLocaleString()}.`;
  }

  updateVerdictBadge(result.verdict);

  const grouped = groupIssues(result.issues);
  renderIssues($('errorsList'), grouped.error);
  renderIssues($('warningsList'), grouped.warning);
  renderIssues($('infoList'), grouped.info);

  renderStats(result);
  renderPreview(originalSvg, result);
  setActionsEnabled(true);
}

function onValidationError(message: string): void {
  $('statusLine').textContent = message;
  $('previewNotice').textContent = message;
  $('previewContainer').innerHTML = '';
  $('renderChecksList').innerHTML = '';
  ($('copyReportBtn') as HTMLButtonElement).disabled = true;
  ($('downloadReportBtn') as HTMLButtonElement).disabled = true;
  ($('exportSanitizedBtn') as HTMLButtonElement).disabled = true;
}

function runValidation(svgText: string, mode: InputMode, sourceLabel?: string): void {
  const trimmed = svgText.trim();
  if (!trimmed) {
    onValidationError('No SVG content found.');
    return;
  }

  const result = validateSvg(trimmed, mode, sourceLabel);
  renderResult(result, trimmed);
}

function initSamplePicker(): void {
  const select = $('sampleSelect') as HTMLSelectElement;
  select.innerHTML = '';

  for (const sample of SAMPLE_SVGS) {
    const opt = document.createElement('option');
    opt.value = sample.id;
    opt.textContent = sample.label;
    select.appendChild(opt);
  }

  $('loadSampleBtn').addEventListener('click', () => {
    const picked = SAMPLE_SVGS.find((s) => s.id === select.value);
    if (!picked) {
      return;
    }
    const textarea = $('pasteInput') as HTMLTextAreaElement;
    textarea.value = picked.svg;
    runValidation(picked.svg, 'paste', `sample:${picked.id}`);
  });
}

function wirePasteInput(): void {
  $('pasteValidateBtn').addEventListener('click', () => {
    const svg = ($('pasteInput') as HTMLTextAreaElement).value;
    runValidation(svg, 'paste');
  });
}

function wireFileInput(): void {
  $('fileValidateBtn').addEventListener('click', async () => {
    const fileInput = $('fileInput') as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) {
      onValidationError('Please choose an SVG file first.');
      return;
    }
    const text = await file.text();
    runValidation(text, 'upload', file.name);
  });
}

function wireUrlInput(): void {
  $('urlValidateBtn').addEventListener('click', async () => {
    const url = ($('urlInput') as HTMLInputElement).value.trim();
    if (!url) {
      onValidationError('Please enter an SVG URL.');
      return;
    }

    try {
      const svg = await fetchSvgFromUrl(url);
      runValidation(svg, 'url', url);
    } catch (error) {
      const message = error instanceof Error ? error.message : FETCH_ERROR_MESSAGE;
      onValidationError(message);
    }
  });
}

function wireReportButtons(): void {
  $('copyReportBtn').addEventListener('click', async () => {
    if (!state.lastResult) {
      return;
    }
    const json = JSON.stringify(state.lastResult, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      $('statusLine').textContent = 'Report copied to clipboard.';
    } catch {
      $('statusLine').textContent = 'Failed to copy report to clipboard.';
    }
  });

  $('downloadReportBtn').addEventListener('click', () => {
    if (!state.lastResult) {
      return;
    }
    const json = JSON.stringify(state.lastResult, null, 2);
    downloadTextFile('report.json', json, 'application/json');
  });

  $('exportSanitizedBtn').addEventListener('click', () => {
    if (!state.lastSanitizedSvg) {
      return;
    }
    downloadTextFile('sanitized.svg', state.lastSanitizedSvg, 'image/svg+xml');
  });
}

export function initApp(): void {
  initSamplePicker();
  wirePasteInput();
  wireFileInput();
  wireUrlInput();
  wireReportButtons();
  setActionsEnabled(false);
}
