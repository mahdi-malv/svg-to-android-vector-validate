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

function renderPreview(svgText: string, result: ValidationResult): void {
  const previewNotice = $('previewNotice');
  const previewContainer = $('previewContainer');
  const exportBtn = $('exportSanitizedBtn') as HTMLButtonElement;

  previewContainer.innerHTML = '';

  const sanitizeResult = sanitizeSvgForPreview(svgText);
  state.lastSanitizedSvg = sanitizeResult.sanitizedSvg;

  if (result.dangerousForPreview || sanitizeResult.blockedPreview) {
    previewNotice.textContent = 'Preview disabled for safety.';
    exportBtn.disabled = sanitizeResult.sanitizedSvg.length === 0;
    if (sanitizeResult.reasons.length > 0) {
      previewNotice.textContent += ` ${sanitizeResult.reasons[0]}`;
    }
    return;
  }

  previewNotice.textContent = 'Preview rendered from sanitized SVG.';
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
