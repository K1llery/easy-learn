import { build } from 'vite';
await build({ build: { outDir: 'dist', rollupOptions: { input: { panel: 'panel.html', sidepanel: 'sidepanel.html', options: 'options.html', popup: 'popup.html' } } } });
await build({ publicDir: false, build: { outDir: 'dist', emptyOutDir: false, lib: { entry: 'src/background.ts', formats: ['es'], fileName: () => 'background.js' } } });
await build({ publicDir: false, build: { outDir: 'dist', emptyOutDir: false, lib: { entry: 'src/content/index.ts', name: 'EasyLearn', formats: ['iife'], fileName: () => 'content.js' } } });
