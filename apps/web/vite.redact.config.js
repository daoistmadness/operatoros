import { redact } from '@tanstack/redact/vite';
import { mergeConfig } from 'vite';
import reactConfig from './vite.config.js';

// Research-only build. The default vite.config.js keeps the production renderer on React.
export default mergeConfig(reactConfig, {
  plugins: [redact()],
  build: { outDir: 'build-redact', manifest: true },
});
