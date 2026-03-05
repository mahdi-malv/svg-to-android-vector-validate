export type SampleSvg = {
  id: string;
  label: string;
  svg: string;
};

export const SAMPLE_SVGS: SampleSvg[] = [
  {
    id: 'good-basic',
    label: 'Good: Simple icon',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="#222" d="M12 2l8 8-8 12L4 10z"/></svg>`,
  },
  {
    id: 'warn-text-gradient',
    label: 'Warn: Text + gradient',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><defs><linearGradient id="g"><stop offset="0%" stop-color="#f00"/><stop offset="100%" stop-color="#00f"/></linearGradient></defs><text x="10" y="50" fill="url(#g)">Hi</text></svg>`,
  },
  {
    id: 'fail-dangerous',
    label: 'Fail: Script + image + filter',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><script>alert(1)</script><defs><filter id="f"><feGaussianBlur stdDeviation="2"/></filter></defs><image href="https://example.com/a.png" x="0" y="0" width="24" height="24"/><rect x="4" y="4" width="40" height="40" filter="url(#f)"/></svg>`,
  },
];
