import fs from 'node:fs';
import path from 'node:path';
const forbidden = new RegExp(
  'https://(?:www\\.googleapis\\.com/auth/(?:' +
    ['gmail', 'drive'].join('|') +
    ')|mail\\.google\\.com/)',
  'i',
);
const skip = new Set([
  'node_modules',
  '.git',
  'coverage',
  'playwright-report',
  'test-results',
  'work',
]);
let failed = false;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (
      /\.(?:[cm]?[jt]sx?|json|md|html|ya?ml)$/.test(file) &&
      forbidden.test(fs.readFileSync(file, 'utf8'))
    ) {
      console.error('Forbidden resource scope in', file);
      failed = true;
    }
  }
}
walk('.');
if (failed) process.exit(1);
console.log('Scope audit passed.');
