export type Severity = 'error' | 'warning' | 'info';

export type Verdict = 'PASS' | 'WARN' | 'FAIL';

export type IssueCode = string;

export type Issue = {
  severity: Severity;
  code: IssueCode;
  message: string;
  details?: string;
  suggestion?: string;
  whyItMatters: string;
};

export type SvgStats = {
  width?: string;
  height?: string;
  viewBox?: string;
  elementCount: number;
  pathCount: number;
  hasLinearGradient: boolean;
  hasRadialGradient: boolean;
  hasGradients: boolean;
  hasGroups: boolean;
  colorCount: number;
  maxPathDLength: number;
  nestedTransformDepthMax: number;
};

export type InputMode = 'paste' | 'upload' | 'url';

export type ValidationResult = {
  verdict: Verdict;
  issues: Issue[];
  stats: SvgStats;
  parseError?: string;
  dangerousForPreview: boolean;
  metadata: {
    timestamp: string;
    inputMode: InputMode;
    sourceLabel?: string;
  };
};

export type SanitizeResult = {
  sanitizedSvg: string;
  removedCount: number;
  blockedPreview: boolean;
  reasons: string[];
};
