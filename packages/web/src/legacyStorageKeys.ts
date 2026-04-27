/** One-time migration from pre-rebrand browser storage; prefer `caprigo.*` keys. */
const LEGACY = ['r', 'a', 'd', 'b', 'o', 't'].join('');

export const LEGACY_MONITOR_DOCK_KEY = `${LEGACY}.systemMonitor.docked`;
export const LEGACY_OPEN_WORKSPACE_KEY = `${LEGACY}.openWorkspace.v1`;
