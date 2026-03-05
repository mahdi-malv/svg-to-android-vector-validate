import { defineConfig } from 'vitest/config';

function getBasePath(): string {
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
  if (!repo) {
    return '/';
  }
  return `/${repo}/`;
}

export default defineConfig({
  base: getBasePath(),
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
