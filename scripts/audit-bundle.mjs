import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
let total = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (file.endsWith('.js')) total += gzipSync(fs.readFileSync(file)).length;
  }
}
walk('.next/static');
for (const file of ['public/pwa/offline.js', 'public/sw.js'])
  total += gzipSync(fs.readFileSync(file)).length;
const budget = 1200 * 1024;
console.log(
  `All shared and route JavaScript: ${Math.round(total / 1024)} KiB gzip (budget ${budget / 1024} KiB)`,
);
if (total > budget) process.exit(1);
