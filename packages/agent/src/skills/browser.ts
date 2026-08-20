/**
 * Playwright browser computer-use skills (lazy-loaded via createRequire).
 * Optional: `npm i playwright` then `npx playwright install chromium`.
 */

import type { Skill } from '@caprigo/shared';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';
import { caprigoDataRoot } from '@caprigo/shared';

const nodeRequire = createRequire(__filename);

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyPage = any;
type AnyBrowser = any;

let browserPromise: Promise<AnyBrowser> | null = null;
let page: AnyPage | null = null;

function browserDisabled(): boolean {
  return /^(1|true|yes)$/i.test(String(process.env.CAPRIGO_DISABLE_BROWSER || ''));
}

function loadPlaywright(): any {
  try {
    return nodeRequire('playwright');
  } catch {
    throw new Error(
      'Playwright is not installed. Run: npm i playwright && npx playwright install chromium'
    );
  }
}

async function getPage(): Promise<AnyPage> {
  if (browserDisabled()) {
    throw new Error('Browser tools disabled (CAPRIGO_DISABLE_BROWSER)');
  }
  const pw = loadPlaywright();
  if (!browserPromise) {
    const headless = !/^(0|false|no)$/i.test(String(process.env.CAPRIGO_BROWSER_HEADLESS ?? '1'));
    browserPromise = pw.chromium.launch({ headless });
  }
  const browser = await browserPromise;
  if (!page || page.isClosed?.()) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Caprigo/2',
    });
    page = await context.newPage();
  }
  return page;
}

function clipText(s: string, max = 12000): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`;
}

async function accessibilitySnapshot(p: AnyPage): Promise<string> {
  try {
    const snap = await p.accessibility.snapshot();
    return clipText(JSON.stringify(snap, null, 2), 16000);
  } catch {
    const text = await p.innerText('body').catch(() => '');
    return clipText(text || '(empty page)', 12000);
  }
}

export async function closeBrowserSession(): Promise<void> {
  try {
    if (page && !page.isClosed?.()) await page.close().catch(() => undefined);
  } catch {
    /* ignore */
  }
  page = null;
  if (browserPromise) {
    try {
      const b = await browserPromise;
      await b.close().catch(() => undefined);
    } catch {
      /* ignore */
    }
    browserPromise = null;
  }
}

export const browserSkills: Skill[] = [
  {
    name: 'browser_navigate',
    description:
      'Open a URL in the Caprigo browser (computer use). Returns title + accessibility snapshot.',
    toolParameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'https URL to open' },
      },
      required: ['url'],
    },
    execute: async params => {
      try {
        const url = String(params.url || '').trim();
        if (!/^https?:\/\//i.test(url)) {
          return { success: false, error: 'url must start with http:// or https://' };
        }
        const p = await getPage();
        await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        const title = await p.title();
        const snapshot = await accessibilitySnapshot(p);
        return { success: true, result: { url: p.url(), title, snapshot } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  {
    name: 'browser_snapshot',
    description: 'Capture accessibility tree / visible text of the current browser page.',
    toolParameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const p = await getPage();
        const title = await p.title();
        const snapshot = await accessibilitySnapshot(p);
        return { success: true, result: { url: p.url(), title, snapshot } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element by CSS selector or by visible text.',
    toolParameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        text: { type: 'string', description: 'Visible text to click (alternative to selector)' },
      },
    },
    execute: async params => {
      try {
        const p = await getPage();
        const selector = String(params.selector || '').trim();
        const text = String(params.text || '').trim();
        if (selector) {
          await p.click(selector, { timeout: 15000 });
        } else if (text) {
          await p.getByText(text, { exact: false }).first().click({ timeout: 15000 });
        } else {
          return { success: false, error: 'Provide selector or text' };
        }
        await p.waitForLoadState('domcontentloaded').catch(() => undefined);
        return {
          success: true,
          result: { url: p.url(), title: await p.title(), snapshot: await accessibilitySnapshot(p) },
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input matched by CSS selector. Optionally press Enter after.',
    toolParameters: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        text: { type: 'string' },
        submit: { type: 'boolean', description: 'Press Enter after typing' },
        clear: { type: 'boolean', description: 'Clear field first (default true)' },
      },
      required: ['selector', 'text'],
    },
    execute: async params => {
      try {
        const p = await getPage();
        const selector = String(params.selector || '').trim();
        const text = String(params.text ?? '');
        const clear = params.clear !== false;
        if (!selector) return { success: false, error: 'selector required' };
        if (clear) await p.fill(selector, text, { timeout: 15000 });
        else await p.type(selector, text, { timeout: 15000 });
        if (params.submit) await p.press(selector, 'Enter');
        await p.waitForLoadState('domcontentloaded').catch(() => undefined);
        return {
          success: true,
          result: { url: p.url(), title: await p.title(), snapshot: await accessibilitySnapshot(p) },
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  {
    name: 'browser_press',
    description: 'Press a keyboard key on the page (e.g. Enter, Escape, Tab).',
    toolParameters: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        selector: { type: 'string', description: 'Optional focus target before keypress' },
      },
      required: ['key'],
    },
    execute: async params => {
      try {
        const p = await getPage();
        const key = String(params.key || '').trim();
        if (!key) return { success: false, error: 'key required' };
        const selector = String(params.selector || '').trim();
        if (selector) await p.press(selector, key, { timeout: 15000 });
        else await p.keyboard.press(key);
        return {
          success: true,
          result: { url: p.url(), title: await p.title(), snapshot: await accessibilitySnapshot(p) },
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Save a PNG screenshot of the current page under Caprigo data dir; returns the path.',
    toolParameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Optional filename (png)' },
        fullPage: { type: 'boolean' },
      },
    },
    execute: async params => {
      try {
        const p = await getPage();
        const dir = path.join(caprigoDataRoot(), 'screenshots');
        fs.mkdirSync(dir, { recursive: true });
        const name = String(params.filename || '').trim() || `shot-${Date.now()}.png`;
        const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(dir, safe.endsWith('.png') ? safe : `${safe}.png`);
        await p.screenshot({
          path: filePath,
          fullPage: !!params.fullPage,
        });
        return { success: true, result: { path: filePath, url: p.url() } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
  {
    name: 'browser_wait',
    description:
      'Wait for a CSS selector to appear, or wait a fixed number of milliseconds. Use after navigate/click on slow pages (speedtest, SPAs).',
    toolParameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeout_ms: {
          type: 'number',
          description: 'Max wait for selector (default 30000) or fixed delay if no selector',
        },
        state: {
          type: 'string',
          description: 'visible | attached | hidden (default visible)',
        },
      },
    },
    execute: async params => {
      try {
        const p = await getPage();
        const selector = String(params.selector || '').trim();
        const timeout = Math.min(
          120_000,
          Math.max(100, Number(params.timeout_ms) || (selector ? 30_000 : 2000))
        );
        if (selector) {
          const state = String(params.state || 'visible').trim() || 'visible';
          await p.waitForSelector(selector, { timeout, state });
        } else {
          await p.waitForTimeout(timeout);
        }
        return {
          success: true,
          result: {
            url: p.url(),
            title: await p.title(),
            waited_for: selector || `${timeout}ms`,
            snapshot: await accessibilitySnapshot(p),
          },
        };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  },
];
