import { describe, expect, it } from 'vitest';
import { sanitizeSvgForPreview } from '../src/sanitize';
import { validateSvg } from '../src/validator';

function codes(svg: string): string[] {
  return validateSvg(svg, 'paste').issues.map((i) => i.code);
}

describe('validator', () => {
  it('handles parse errors', () => {
    const result = validateSvg('<svg><path></svg', 'paste');
    expect(result.verdict).toBe('FAIL');
    expect(result.parseError).toBeTruthy();
    expect(result.issues.some((i) => i.code === 'invalid-svg-xml')).toBe(true);
  });

  it('emits error rules', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <defs>
        <filter id="f"><feGaussianBlur stdDeviation="2"/></filter>
        <pattern id="p" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="red"/></pattern>
      </defs>
      <script>alert(1)</script>
      <foreignObject><div>bad</div></foreignObject>
      <animate attributeName="x" from="0" to="1"/>
      <mask id="m"></mask>
      <image href="https://example.com/x.png" width="10" height="10"/>
      <rect width="24" height="24" filter="url(#f)" fill="url(#p)" onclick="x()"/>
      <use href="https://example.com/remote.svg#id"/>
    </svg>`;

    const found = codes(svg);
    expect(found).toContain('unsupported-filter');
    expect(found).toContain('unsupported-foreignObject');
    expect(found).toContain('unsupported-animation');
    expect(found).toContain('unsupported-mask');
    expect(found).toContain('embedded-raster-image');
    expect(found).toContain('script-or-events');
    expect(found).toContain('external-reference');
    expect(found).toContain('unsupported-paint-server-ref');
    expect(validateSvg(svg, 'paste').verdict).toBe('FAIL');
  });

  it('emits warning rules', () => {
    const bigPath = 'M' + '1 '.repeat(5100);
    const manyElements = Array.from({ length: 202 }, (_, i) => `<g id="g${i}"></g>`).join('');
    const manyPaths = Array.from({ length: 51 }, () => '<path d="M0 0L1 1"/>').join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24.5 24.5">
      <style>.a{fill:red;}</style>
      <defs>
        <clipPath id="c"><rect width="10" height="10"/></clipPath>
        <linearGradient id="g"><stop offset="0%" stop-color="#f00"/><stop offset="100%" stop-color="#00f"/></linearGradient>
      </defs>
      <g opacity="0.4" transform="translate(1 1)">
        <g transform="scale(2)">
          <g transform="rotate(45)">
            <g transform="translate(1 1)">
              <text class="a" x="2" y="2">Hi</text>
              <path stroke="#111" stroke-width="1" d="${bigPath}"/>
              ${manyPaths}
            </g>
          </g>
        </g>
      </g>
      ${manyElements}
    </svg>`;

    const found = codes(svg);
    expect(found).toContain('clipPath-present');
    expect(found).toContain('text-present');
    expect(found).toContain('stroke-present');
    expect(found).toContain('gradient-present');
    expect(found).toContain('group-opacity-or-complex-transform');
    expect(found).toContain('style-or-class-usage');
    expect(found).toContain('nested-transform-depth-high');
    expect(found).toContain('complexity-elements-high');
    expect(found).toContain('complexity-path-count-high');
    expect(found).toContain('complexity-path-d-long');
    expect(found).toContain('non-integer-viewBox');
    expect(validateSvg(svg, 'paste').verdict).toBe('WARN');
  });

  it('warns for missing dimensions', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>`;
    const found = codes(svg);
    expect(found).toContain('missing-viewBox-or-size');
  });

  it('emits info rules and PASS verdict', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#111" d="M0 0L2 2"/></svg>`;
    const result = validateSvg(svg, 'paste');
    expect(result.verdict).toBe('PASS');
    expect(result.issues.some((i) => i.code === 'suggest-artboard-size')).toBe(true);
  });

  it('tracks stats', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g><path d="M0 0L1 1"/></g></svg>`;
    const result = validateSvg(svg, 'paste');
    expect(result.stats.width).toBe('32');
    expect(result.stats.height).toBe('32');
    expect(result.stats.viewBox).toBe('0 0 32 32');
    expect(result.stats.pathCount).toBe(1);
    expect(result.stats.hasGroups).toBe(true);
  });

  it('detects dangerous content for preview', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;
    const result = validateSvg(svg, 'paste');
    expect(result.dangerousForPreview).toBe(true);

    const sanitized = sanitizeSvgForPreview(svg);
    expect(sanitized.blockedPreview).toBe(true);
    expect(sanitized.sanitizedSvg.includes('<script')).toBe(false);
  });

  it('handles href and xlink:href external refs', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="24" height="24" viewBox="0 0 24 24"><use href="data:image/png;base64,abc"/><use xlink:href="https://example.com/a.svg"/></svg>`;
    const found = codes(svg);
    expect(found).toContain('external-reference');
  });

  it('flags unsupported paint server URLs', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="url(https://example.com/pattern.svg#x)"/></svg>`;
    const found = codes(svg);
    expect(found).toContain('unsupported-paint-server-ref');
  });
});
