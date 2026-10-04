import { build } from 'vite';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildMetadata, writeMetadata } from './version.mjs';
const metadata = await buildMetadata();
// Content scripts and extension pages have no Node `process`; pin the React
// production guard even inside pre-bundled CommonJS interop modules.
const define = { 'process.env.NODE_ENV': JSON.stringify('production') };
await build({
  define,
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        panel: 'panel.html',
        sidepanel: 'sidepanel.html',
        options: 'options.html',
        popup: 'popup.html',
        pdf: 'pdf.html',
        reader: 'reader.html',
      },
    },
  },
});
await build({
  define,
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: { entry: 'src/background.ts', formats: ['es'], fileName: () => 'background.js' },
  },
});
await build({
  define,
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'src/content/index.ts',
      name: 'EasyLearn',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
// pdf.js needs its character maps and standard fonts at runtime (CJK PDFs).
await mkdir('dist/pdfjs', { recursive: true });
await cp('node_modules/pdfjs-dist/cmaps', 'dist/pdfjs/cmaps', { recursive: true });
await cp('node_modules/pdfjs-dist/standard_fonts', 'dist/pdfjs/standard-fonts', {
  recursive: true,
});
await cp('node_modules/pdfjs-dist/wasm', 'dist/pdfjs/wasm', { recursive: true });
await cp('node_modules/pdfjs-dist/iccs', 'dist/pdfjs/iccs', { recursive: true });
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
manifest.version_name = metadata.version;
await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
await writeMetadata('dist', metadata);
