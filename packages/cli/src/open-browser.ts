import { spawn } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

export function openInBrowser(url: string): void {
  const platform = os.platform();
  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

/** Reveal a local file/folder in the OS file manager, or open it with the default app. */
export function openLocalPath(target: string, opts?: { reveal?: boolean }): void {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Path not found: ${resolved}`);
  }
  const platform = os.platform();
  const reveal = !!opts?.reveal || fs.statSync(resolved).isDirectory();
  if (platform === 'win32') {
    if (reveal && fs.statSync(resolved).isFile()) {
      spawn('explorer.exe', [`/select,${resolved}`], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('cmd', ['/c', 'start', '', resolved], { detached: true, stdio: 'ignore' }).unref();
    }
  } else if (platform === 'darwin') {
    if (reveal && fs.statSync(resolved).isFile()) {
      spawn('open', ['-R', resolved], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('open', [resolved], { detached: true, stdio: 'ignore' }).unref();
    }
  } else {
    spawn('xdg-open', [fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved)], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  }
}
