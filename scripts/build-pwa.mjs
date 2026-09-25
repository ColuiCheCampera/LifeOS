import { build } from 'esbuild';
import { injectManifest } from '@serwist/build';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
await mkdir('public/pwa', { recursive: true });
await mkdir('work', { recursive: true });
const common = {
  bundle: true,
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  tsconfig: 'tsconfig.json',
  define: { 'process.env.NODE_ENV': '"production"' },
};
await build({
  ...common,
  entryPoints: ['src/features/pwa/offline.tsx'],
  outfile: 'public/pwa/offline.js',
});
await copyFile('src/features/pwa/offline.html', 'public/offline.html');
await writeFile(
  'public/pwa/offline.css',
  (await readFile('src/app/globals.css', 'utf8'))
    .replace('@import "tailwindcss";', '')
    .replace("@import 'tailwindcss';", ''),
);
await build({ ...common, entryPoints: ['src/features/pwa/sw.ts'], outfile: 'work/sw.js' });
const { count, size, warnings } = await injectManifest({
  swSrc: 'work/sw.js',
  swDest: 'public/sw.js',
  globDirectory: 'public',
  globPatterns: [
    'offline.html',
    'pwa/offline.{js,css}',
    'pwa/*.{png,svg}',
    'manifest*.webmanifest',
  ],
  injectionPoint: 'self.__SW_MANIFEST',
  maximumFileSizeToCacheInBytes: 2000000,
  modifyURLPrefix: { '': '/' },
});
if (warnings.length) throw new Error(warnings.join('; '));
console.log(
  `PWA built: ${count} public assets (${Math.round(size / 1024)} KiB). Private pages and APIs are never precached.`,
);
