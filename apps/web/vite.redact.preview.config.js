import { mergeConfig } from 'vite';
import previewConfig from './vite.preview.config.js';

export default mergeConfig(previewConfig, {
  build: { outDir: 'build-redact/client', manifest: true },
});
