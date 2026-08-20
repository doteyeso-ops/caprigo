const { formatMarkdownReply } = require('../packages/cli/dist/hud/format-blocks');

const sample = [
  'Intro',
  '',
  '```ts',
  'export const n = 42;',
  'console.log(n);',
  '```',
  '',
  '| Name | Score |',
  '| --- | ---: |',
  '| alpha | 90 |',
  '| beta | 70 |',
].join('\n');

const out = formatMarkdownReply(sample, 56)
  .join('\n')
  .replace(/\x1b\[[0-9;]*m/g, '');
console.log(out);
if (!out.includes('╭─') || !out.includes('ts') || !out.includes('export const')) {
  console.error('FAIL: code card missing');
  process.exit(1);
}
if (!out.includes('alpha') || !out.includes('┬')) {
  console.error('FAIL: table missing');
  process.exit(1);
}
console.log('OK');
