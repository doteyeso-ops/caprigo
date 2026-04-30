import React, { useCallback, useEffect, useState } from 'react';

export interface SystemMonitorPayload {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  uptimeHostSec: number;
  uptimeProcessSec: number;
  loadavg: number[] | null;
  cpus: number;
  cpuModel: string;
  memory: {
    totalMb: number;
    freeMb: number;
    usedMb: number;
    usedPct: number;
    processRssMb: number;
    processHeapMb: number;
  };
  disk: { path: string; totalGb: number; freeGb: number; usedPct: number } | null;
  gatewayPid: number;
  fetchedAt: string;
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface Props {
  /** embedded = details dialog; docked = floating panel */
  layout: 'embedded' | 'docked';
  pollMs?: number;
  /** Shown in embedded layout — opens the docked panel */
  onPin?: () => void;
}

export function SystemMonitorWidget({ layout, pollMs = 10000, onPin }: Props) {
  const [data, setData] = useState<SystemMonitorPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/system-monitor');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = (await r.json()) as SystemMonitorPayload;
      setData(d);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const tick = async () => {
      if (cancelled) return;
      await load();
      if (cancelled) return;
      const nextMs = document.visibilityState === 'visible' ? pollMs : pollMs * 4;
      timer = window.setTimeout(() => void tick(), nextMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [load, pollMs]);

  const cls = layout === 'docked' ? 'rb-monitor rb-monitor--docked' : 'rb-monitor rb-monitor--embedded';

  if (err && !data) {
    return (
      <div className={`${cls} rb-monitor--err`}>
        <p className="rb-muted">{err}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={cls}>
        <p className="rb-muted rb-monitor__loading">Loading stats…</p>
      </div>
    );
  }

  const loadStr = data.loadavg?.length
    ? data.loadavg.map(x => x.toFixed(2)).join(' · ')
    : '—';

  return (
    <div className={cls}>
      <div className="rb-monitor__grid">
        <div className="rb-monitor__cell">
          <span className="rb-monitor__label">Host</span>
          <span className="rb-monitor__val rb-mono">{data.hostname}</span>
        </div>
        <div className="rb-monitor__cell">
          <span className="rb-monitor__label">OS</span>
          <span className="rb-monitor__val">
            {data.platform} {data.release} · {data.arch}
          </span>
        </div>
        <div className="rb-monitor__cell">
          <span className="rb-monitor__label">CPU</span>
          <span className="rb-monitor__val">{data.cpus} × {data.cpuModel.slice(0, 48)}{data.cpuModel.length > 48 ? '…' : ''}</span>
        </div>
        <div className="rb-monitor__cell">
          <span className="rb-monitor__label">Load (1/5/15)</span>
          <span className="rb-monitor__val rb-mono">{loadStr}</span>
        </div>
        <div className="rb-monitor__cell rb-monitor__cell--wide">
          <span className="rb-monitor__label">Memory</span>
          <span className="rb-monitor__val">
            {data.memory.usedMb} / {data.memory.totalMb} MB ({data.memory.usedPct}% used) · gateway RSS{' '}
            {data.memory.processRssMb} MB
          </span>
        </div>
        {data.disk && (
          <div className="rb-monitor__cell rb-monitor__cell--wide">
            <span className="rb-monitor__label">Disk (cwd)</span>
            <span className="rb-monitor__val">
              {data.disk.freeGb} / {data.disk.totalGb} GB free · {data.disk.usedPct}% used
            </span>
          </div>
        )}
        <div className="rb-monitor__cell">
          <span className="rb-monitor__label">Uptime</span>
          <span className="rb-monitor__val">
            host {formatUptime(data.uptimeHostSec)} · process {formatUptime(data.uptimeProcessSec)}
          </span>
        </div>
        <div className="rb-monitor__cell">
          <span className="rb-monitor__label">Gateway PID</span>
          <span className="rb-monitor__val rb-mono">{data.gatewayPid}</span>
        </div>
      </div>
      {err && <p className="rb-monitor__stale rb-muted">Stale data — {err}</p>}
      <p className="rb-monitor__foot rb-muted">
        Tool: <span className="rb-mono">system_monitor</span> · Updated {new Date(data.fetchedAt).toLocaleTimeString()}
      </p>
      {layout === 'embedded' && onPin && (
        <button type="button" className="rb-btn rb-btn--ghost rb-monitor__pin" onClick={() => onPin()}>
          Pin monitor panel
        </button>
      )}
    </div>
  );
}
