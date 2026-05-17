import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { worker: 'worker/index.ts' },
  outDir: 'dist',
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  // Keep dist/ contents from the old Express build (script/build.ts writes
  // dist/index.cjs + dist/public/). PR 15 will flip this to true once the
  // old build pipeline is deleted.
  clean: false,
  sourcemap: true,
  splitting: false,
});
