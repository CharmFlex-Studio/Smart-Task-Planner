import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@shared': path.resolve(import.meta.dirname, 'src/shared') },
  },
  test: {
    globals: true,
    environment: 'node',
    // .tsx too: the markdown renderer is a component, and its escaping behaviour is the
    // security boundary, so it is tested by rendering it rather than by reading it.
    // esbuild picks the JSX transform up from tsconfig, so no plugin is needed here.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
