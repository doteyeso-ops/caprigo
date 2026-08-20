/**
 * If the model dumped code in chat instead of write_file, save fenced blocks to cwd/generated/.
 */

import * as fs from 'fs';
import * as path from 'path';

const FENCE_RE = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;

const EXT: Record<string, string> = {
  js: '.js',
  javascript: '.js',
  ts: '.ts',
  typescript: '.ts',
  py: '.py',
  python: '.py',
  ps1: '.ps1',
  powershell: '.ps1',
  bash: '.sh',
  sh: '.sh',
  shell: '.sh',
  json: '.json',
  html: '.html',
  htm: '.html',
  css: '.css',
  md: '.md',
  markdown: '.md',
  sql: '.sql',
  go: '.go',
  rs: '.rs',
  rust: '.rs',
  java: '.java',
  c: '.c',
  cpp: '.cpp',
  csharp: '.cs',
  cs: '.cs',
};

function looksLikeHtml(body: string, lang: string): boolean {
  if (lang === 'html' || lang === 'htm') return true;
  const t = body.trim();
  if (/^<!DOCTYPE\s+html/i.test(t) || /^<html[\s>]/i.test(t)) return true;
  if (/<\s*script[\s>]/i.test(t) && (/THREE\.|three\.js|<\/script>/i.test(t) || /<\s*(?:div|canvas|body)/i.test(t))) {
    return true;
  }
  return false;
}

function wrapHtmlFragment(body: string): string {
  const t = body.trim();
  if (/^<!DOCTYPE\s+html/i.test(t) || /^<html[\s>]/i.test(t)) return t.endsWith('\n') ? t : `${t}\n`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Caprigo scene</title>
  <style>html,body{margin:0;height:100%;overflow:hidden;background:#0b1020}</style>
</head>
<body>
${t}
</body>
</html>
`;
}

function guessSlug(body: string): string {
  const lower = body.toLowerCase();
  if (/three\.|THREE\./.test(body)) return 'three-scene';
  if (/sunset|mountain|cloud/.test(lower)) return 'scene';
  if (/express|http\.createServer/.test(body)) return 'server';
  if (/def main|if __name__/.test(body)) return 'script';
  return 'snippet';
}

export function autosaveCodeFences(
  response: string,
  workspace: string,
  toolsUsed: string[]
): string[] {
  // If the agent already wrote files, don't double-save chat dumps.
  if (toolsUsed.some(t => /write_file|search_replace|hash_edit/.test(t))) return [];

  const saved: string[] = [];
  const dir = path.join(workspace, 'generated');
  let match: RegExpExecArray | null;
  const re = new RegExp(FENCE_RE.source, 'g');
  let i = 0;
  while ((match = re.exec(response)) !== null) {
    const lang = (match[1] || '').toLowerCase();
    let body = match[2] || '';
    if (body.trim().length < 40) continue; // skip tiny snippets
    if (!lang && body.trim().split(/\n/).length < 4) continue;
    i += 1;

    const html = looksLikeHtml(body, lang);
    if (html) body = wrapHtmlFragment(body);

    const ext = html ? '.html' : EXT[lang] || (lang ? `.${lang}` : '.txt');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = guessSlug(body);
    const file = path.join(dir, `${slug}-${stamp}-${i}${ext}`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, body.replace(/\n$/, '') + '\n', 'utf8');
      saved.push(file);
    } catch {
      /* ignore */
    }
  }

  // Unfenced HTML/Three.js dumps (common with small local models)
  if (i === 0 && looksLikeHtml(response, '') && response.trim().length >= 80) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = path.join(dir, `${guessSlug(response)}-${stamp}-1.html`);
      fs.writeFileSync(file, wrapHtmlFragment(response), 'utf8');
      saved.push(file);
    } catch {
      /* ignore */
    }
  }

  return saved;
}
