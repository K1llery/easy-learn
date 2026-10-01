import {build} from 'vite';
import {cp,mkdir} from 'node:fs/promises';
await build({define:{'process.env.NODE_ENV':JSON.stringify('production')},build:{outDir:'dist-workbench',rollupOptions:{input:{reader:'reader.html'}}}});
await mkdir('dist-workbench/pdfjs',{recursive:true});
await cp('node_modules/pdfjs-dist/cmaps','dist-workbench/pdfjs/cmaps',{recursive:true});
await cp('node_modules/pdfjs-dist/standard_fonts','dist-workbench/pdfjs/standard-fonts',{recursive:true});
await build({publicDir:false,build:{ssr:'src/workbench/server.ts',outDir:'dist-workbench-server',rollupOptions:{output:{entryFileNames:'server.mjs'}}}});
