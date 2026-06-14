import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // GitHub Pages (https://nyu1791-collab.github.io/auto/) はリポジトリ名の
  // サブパスで配信されるため、ビルド時のみ base を切り替える。
  base: command === 'build' ? '/auto/' : '/',
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
}));
