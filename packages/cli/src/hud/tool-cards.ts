/**
 * Compact tool-call cards for the HUD session pane (path + preview).
 */

import { T, paint } from './theme';

export function toolCardOpen(tool: string, argsPreview?: string, filePath?: string): string[] {
  const title = paint(T.amber + T.bold, tool);
  const head = `${paint(T.border, '╭─')} ${title}`;
  const lines = [head];
  if (filePath?.trim()) {
    lines.push(`${paint(T.border, '│')}  ${paint(T.teal, filePath.trim())}`);
  }
  if (argsPreview?.trim() && argsPreview.trim() !== filePath?.trim()) {
    lines.push(`${paint(T.border, '│')}  ${paint(T.gray, argsPreview.trim())}`);
  }
  return lines;
}

export function toolCardClose(ok: boolean, summary?: string, detail?: string): string[] {
  const mark = ok ? paint(T.green, '✓') : paint(T.red, '✕');
  const text = (ok ? summary || 'done' : detail || summary || 'failed').trim();
  return [`${paint(T.border, '╰─')} ${mark} ${paint(ok ? T.green : T.red, text)}`];
}
