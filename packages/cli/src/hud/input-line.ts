/**
 * Raw-mode input line with backspace, arrows, Ctrl+C/D, paste, and scroll keys.
 * STEER submit: Enter inserts newline; Enter again within the window sends.
 */

import * as readline from 'readline';

export type KeyEvent =
  | { type: 'submit'; value: string }
  | { type: 'cancel' }
  | { type: 'interrupt' }
  | { type: 'escape' }
  | { type: 'tab' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'pageup' }
  | { type: 'pagedown' }
  | { type: 'scroll_up' }
  | { type: 'scroll_down' }
  | { type: 'change'; value: string; cursor: number }
  | { type: 'steer_armed' };

function steerEnterWindowMs(): number {
  const n = Number(process.env.CAPRIGO_STEER_ENTER_MS || '500');
  return Number.isFinite(n) && n >= 150 ? Math.min(2000, n) : 500;
}

function doubleEnterSubmitEnabled(): boolean {
  const v = process.env.CAPRIGO_STEER_ENTER;
  if (v === undefined || v === '') return true;
  return !/^(0|false|off|no)$/i.test(v);
}

export class InputLine {
  private buf = '';
  private cursor = 0;
  private history: string[] = [];
  private histIdx = -1;
  private draft = '';
  private onKey: (e: KeyEvent) => void;
  private listening = false;
  /** When true, ↑/↓ always emit navigation (no history). Used by /models picker. */
  private navMode = false;
  /** When true (empty chat input), ↑/↓ scroll the session instead of history. */
  private scrollArrows = false;
  /** Bracketed paste mode (OSC) — treat incoming chunk as literal text. */
  private pasting = false;
  private pasteBuf = '';
  /** Timestamp of last Enter that armed double-Enter submit. */
  private lastEnterAt = 0;

  constructor(onKey: (e: KeyEvent) => void) {
    this.onKey = onKey;
  }

  get value(): string {
    return this.buf;
  }

  get cursorPos(): number {
    return this.cursor;
  }

  getHistory(): string[] {
    return [...this.history];
  }

  setHistory(entries: string[]): void {
    this.history = entries.filter(x => typeof x === 'string' && x.trim()).slice(-200);
    this.histIdx = -1;
  }

  setNavMode(on: boolean): void {
    this.navMode = on;
    if (on) {
      this.histIdx = -1;
      this.draft = '';
      this.lastEnterAt = 0;
    }
  }

  setScrollArrows(on: boolean): void {
    this.scrollArrows = on;
  }

  setValue(v: string): void {
    this.buf = v;
    this.cursor = v.length;
    this.lastEnterAt = 0;
    this.emitChange();
  }

  clear(): void {
    this.buf = '';
    this.cursor = 0;
    this.lastEnterAt = 0;
    this.emitChange();
  }

  start(): void {
    if (this.listening) return;
    this.listening = true;
    if (!process.stdin.isTTY) return;
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', this.handleKey);
    // Enable bracketed paste so large pastes don't trigger accidental submits.
    process.stdout.write('\x1b[?2004h');
  }

  stop(): void {
    if (!this.listening) return;
    this.listening = false;
    process.stdin.off('keypress', this.handleKey);
    try {
      process.stdout.write('\x1b[?2004l');
    } catch {
      /* ignore */
    }
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* ignore */
      }
    }
  }

  private emitChange(): void {
    this.onKey({ type: 'change', value: this.buf, cursor: this.cursor });
  }

  private resolveName(key: readline.Key): string | undefined {
    if (key.name) return key.name;
    const seq = key.sequence || '';
    if (seq === '\x1b[A' || seq === '\x1bOA') return 'up';
    if (seq === '\x1b[B' || seq === '\x1bOB') return 'down';
    if (seq === '\x1b[C' || seq === '\x1bOC') return 'right';
    if (seq === '\x1b[D' || seq === '\x1bOD') return 'left';
    if (seq === '\x1b[5~') return 'pageup';
    if (seq === '\x1b[6~') return 'pagedown';
    if (seq === '\x1b' || seq === '\x1b\x1b') return 'escape';
    return undefined;
  }

  private doSubmit(): void {
    const v = this.buf.replace(/\n+$/, '');
    if (v.trim() && !this.navMode) {
      this.history.push(v);
      if (this.history.length > 200) this.history.shift();
    }
    this.histIdx = -1;
    this.draft = '';
    this.lastEnterAt = 0;
    this.onKey({ type: 'submit', value: v });
    this.buf = '';
    this.cursor = 0;
    this.emitChange();
  }

  private handleKey = (str: string | undefined, key: readline.Key): void => {
    if (!key) return;
    const seq = key.sequence || '';

    // Bracketed paste begin/end (may arrive as keypress sequences)
    if (seq.includes('\x1b[200~')) {
      this.pasting = true;
      this.pasteBuf = '';
      const after = seq.split('\x1b[200~').slice(1).join('\x1b[200~');
      if (after.includes('\x1b[201~')) {
        const [body] = after.split('\x1b[201~');
        this.insertText(body.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
        this.pasting = false;
        this.pasteBuf = '';
      } else if (after) {
        this.pasteBuf += after;
      }
      return;
    }
    if (this.pasting) {
      if (seq.includes('\x1b[201~')) {
        const before = seq.split('\x1b[201~')[0];
        this.pasteBuf += before;
        this.insertText(this.pasteBuf.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
        this.pasting = false;
        this.pasteBuf = '';
      } else {
        this.pasteBuf += seq || str || '';
      }
      return;
    }

    const name = this.resolveName(key);

    if (key.ctrl && (name === 'c' || name === 'C')) {
      this.onKey({ type: 'interrupt' });
      return;
    }
    if (key.ctrl && (name === 'd' || name === 'D')) {
      if (!this.buf) this.onKey({ type: 'cancel' });
      return;
    }
    // Ctrl+J → newline (multi-line draft); never submits
    if (key.ctrl && (name === 'j' || name === 'J')) {
      this.lastEnterAt = 0;
      this.insertText('\n');
      return;
    }
    // Ctrl+Enter / Meta+Enter → always submit (explicit send)
    if ((key.ctrl || key.meta) && (name === 'return' || name === 'enter')) {
      this.doSubmit();
      return;
    }
    // Ctrl+Up / Ctrl+Down → session scroll (Windows often sends as ctrl+up)
    if (key.ctrl && name === 'up') {
      this.onKey({ type: 'scroll_up' });
      return;
    }
    if (key.ctrl && name === 'down') {
      this.onKey({ type: 'scroll_down' });
      return;
    }
    if (name === 'escape') {
      this.lastEnterAt = 0;
      this.onKey({ type: 'escape' });
      return;
    }
    if (name === 'return' || name === 'enter') {
      // Pickers / empty → single Enter (legacy)
      if (this.navMode || !this.buf.trim()) {
        this.doSubmit();
        return;
      }
      // Slash commands stay single-Enter for snappy /cmds
      if (this.buf.trimStart().startsWith('/')) {
        this.doSubmit();
        return;
      }
      // STEER: first Enter = newline + arm; second Enter in window = submit
      if (doubleEnterSubmitEnabled()) {
        const now = Date.now();
        if (this.lastEnterAt && now - this.lastEnterAt <= steerEnterWindowMs()) {
          this.doSubmit();
          return;
        }
        this.lastEnterAt = now;
        this.insertText('\n');
        this.onKey({ type: 'steer_armed' });
        return;
      }
      this.doSubmit();
      return;
    }
    if (name === 'tab') {
      this.onKey({ type: 'tab' });
      return;
    }
    if (name === 'pageup') {
      this.onKey({ type: 'pageup' });
      return;
    }
    if (name === 'pagedown') {
      this.onKey({ type: 'pagedown' });
      return;
    }
    if (name === 'backspace' || key.sequence === '\x7f' || key.sequence === '\b') {
      this.lastEnterAt = 0;
      if (this.cursor > 0) {
        this.buf = this.buf.slice(0, this.cursor - 1) + this.buf.slice(this.cursor);
        this.cursor -= 1;
        this.emitChange();
      }
      return;
    }
    if (name === 'delete') {
      this.lastEnterAt = 0;
      if (this.cursor < this.buf.length) {
        this.buf = this.buf.slice(0, this.cursor) + this.buf.slice(this.cursor + 1);
        this.emitChange();
      }
      return;
    }
    if (name === 'left') {
      this.cursor = Math.max(0, this.cursor - 1);
      this.emitChange();
      return;
    }
    if (name === 'right') {
      this.cursor = Math.min(this.buf.length, this.cursor + 1);
      this.emitChange();
      return;
    }
    if (name === 'home') {
      this.cursor = 0;
      this.emitChange();
      return;
    }
    if (name === 'end') {
      this.cursor = this.buf.length;
      this.emitChange();
      return;
    }
    if (name === 'up') {
      if (this.navMode) {
        this.onKey({ type: 'up' });
        return;
      }
      if (this.scrollArrows && !this.buf) {
        this.onKey({ type: 'scroll_up' });
        return;
      }
      if (!this.history.length) {
        this.onKey({ type: 'scroll_up' });
        return;
      }
      if (this.histIdx === -1) {
        this.draft = this.buf;
        this.histIdx = this.history.length - 1;
      } else if (this.histIdx > 0) {
        this.histIdx -= 1;
      }
      this.buf = this.history[this.histIdx] || '';
      this.cursor = this.buf.length;
      this.lastEnterAt = 0;
      this.emitChange();
      return;
    }
    if (name === 'down') {
      if (this.navMode) {
        this.onKey({ type: 'down' });
        return;
      }
      if (this.scrollArrows && !this.buf) {
        this.onKey({ type: 'scroll_down' });
        return;
      }
      if (this.histIdx === -1) {
        this.onKey({ type: 'scroll_down' });
        return;
      }
      if (this.histIdx >= this.history.length - 1) {
        this.histIdx = -1;
        this.buf = this.draft;
      } else {
        this.histIdx += 1;
        this.buf = this.history[this.histIdx] || '';
      }
      this.cursor = this.buf.length;
      this.lastEnterAt = 0;
      this.emitChange();
      return;
    }

    if (str && !key.ctrl && !key.meta) {
      const insert = str.replace(/\r/g, '');
      if (!insert) return;
      // Ignore lone newline from Enter (handled above); allow pasted newlines via insertText.
      if (insert === '\n') return;
      this.lastEnterAt = 0;
      this.insertText(insert);
    }
  };

  private insertText(text: string): void {
    if (!text) return;
    this.buf = this.buf.slice(0, this.cursor) + text + this.buf.slice(this.cursor);
    this.cursor += text.length;
    this.emitChange();
  }
}
