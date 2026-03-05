import type { Issue, Severity, Verdict } from './types';

export function getAttr(el: Element, name: string): string | null {
  return el.getAttribute(name) ?? el.getAttributeNS('http://www.w3.org/1999/xlink', name);
}

export function normalizeTagName(el: Element): string {
  const raw = el.tagName || '';
  const noPrefix = raw.includes(':') ? raw.split(':').pop() ?? raw : raw;
  return noPrefix.toLowerCase();
}

export function pushIssue(
  issues: Issue[],
  severity: Severity,
  code: string,
  message: string,
  whyItMatters: string,
  details?: string,
  suggestion?: string,
): void {
  if (issues.some((issue) => issue.code === code)) {
    return;
  }
  issues.push({ severity, code, message, whyItMatters, details, suggestion });
}

export function computeVerdict(issues: Issue[]): Verdict {
  if (issues.some((issue) => issue.severity === 'error')) {
    return 'FAIL';
  }
  if (issues.some((issue) => issue.severity === 'warning')) {
    return 'WARN';
  }
  return 'PASS';
}

export function groupIssues(issues: Issue[]): Record<Severity, Issue[]> {
  return {
    error: issues.filter((i) => i.severity === 'error'),
    warning: issues.filter((i) => i.severity === 'warning'),
    info: issues.filter((i) => i.severity === 'info'),
  };
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function parseViewBox(viewBox?: string): { width?: number; height?: number } {
  if (!viewBox) {
    return {};
  }
  const values = viewBox
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number(part));
  if (values.length !== 4 || values.some((part) => Number.isNaN(part))) {
    return {};
  }
  return { width: values[2], height: values[3] };
}
