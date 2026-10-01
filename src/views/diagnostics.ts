// Diagnostics — an opt-in, no-storage view of the machine's network and
// system state, plus reachability of the services PARSEC depends on.
//
// Every aspect is OFF by default; the participant lights a shield to begin.
// Nothing is cached or persisted — readings live only in this closure for
// the current render and are replaced wholesale on each poll. Leaving the
// view stops all polling and disables the Rust monitor.

import { el, btn, toast } from '../lib/dom';
import { store } from '../lib/store';
import {
  ASPECTS,
  anySystemAspectOn,
  isAspectOn,
  setAspect,
  type Aspect,
} from '../lib/diagnostics/aspects';
import {
  fetchNetworkInfo,
  isTauri,
  randomMac,
  setNetworkMonitorEnabled,
  spoofMac,
} from '../lib/diagnostics/system';
import { ENDPOINTS, probeEndpoint } from '../lib/diagnostics/endpoints';
import type { EndpointStatus, InterfaceInfo, NetworkInfo } from '../lib/diagnostics/types';
import { bindInterval, onCleanup } from '../lib/lifecycle';

type Tab = 'connection' | 'system' | 'services';
const POLL_MS = 5000;
const SHIELD = '\u{1F6E1}';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'connection', label: 'Connection', icon: 'globe-network' },
  { id: 'system', label: 'System', icon: 'desktop' },
  { id: 'services', label: 'Services', icon: 'data-connection' },
];

interface NavConnection { effectiveType?: string; downlink?: number; rtt?: number; }

export function diagnosticsView(): HTMLElement {
  const root = el('div', { cls: 'parsec-view parsec-diag' });

  function header(): HTMLElement {
    return el('div', { cls: 'parsec-view__header', children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
      el('h2', { cls: 'parsec-view__title', text: 'Diagnostics' }),
    ]});
  }

  // ── Master gate ─────────────────────────────────────────────────────────
  if (!store.get().settings.enableDiagnostics) {
    root.append(
      header(),
      el('div', { cls: 'parsec-callout bp5-callout bp5-intent-warning', children: [
        el('p', { text: 'Diagnostics is turned off. Enable it in Settings to use this screen.' }),
        btn('Open Settings', { intent: 'primary', icon: 'cog', onClick: () => store.navigate('settings') }),
      ]}),
    );
    return root;
  }

  // ── Live state — closure only, never persisted ──────────────────────────
  let snapshot: NetworkInfo | null = null;
  let snapshotErr: string | null = null;
  let baseline: string | null = null;
  let tamperChanged = false;
  let endpoints: EndpointStatus[] = [];
  let publicIp: string | null = null;
  let rustEnabled = false;
  let activeTab: Tab = 'connection';

  const shieldsRow = el('div', { cls: 'parsec-diag__shields' });
  const bodyEl = el('div', { cls: 'parsec-diag__body' });
  const tabButtons: Record<Tab, HTMLButtonElement> = {} as Record<Tab, HTMLButtonElement>;

  // ── Shields — one per aspect, all start OFF ─────────────────────────────
  function renderShields(): void {
    shieldsRow.innerHTML = '';
    for (const a of ASPECTS) {
      const on = isAspectOn(a.id);
      const shield = el('button', {
        cls: `parsec-diag__shield ${on ? 'parsec-diag__shield--on' : ''}`,
        attrs: { type: 'button', title: a.desc },
        children: [
          el('span', { cls: 'parsec-diag__shield-glyph', text: SHIELD }),
          el('span', { cls: 'parsec-diag__shield-label', text: a.label }),
          el('span', { cls: 'parsec-diag__shield-state', text: on ? 'ON' : 'OFF' }),
        ],
      }) as HTMLButtonElement;
      shield.addEventListener('click', () => { void toggleAspect(a.id); });
      shieldsRow.appendChild(shield);
    }
  }

  async function toggleAspect(id: Aspect): Promise<void> {
    const next = !isAspectOn(id);
    setAspect(id, next);
    if (id === 'network') {
      baseline = null;
      tamperChanged = false;
      if (next) void fetchPublicIp();
    }
    renderShields();
    await poll();
  }

  // ── Poll — only lit aspects do anything ─────────────────────────────────
  async function poll(): Promise<void> {
    if (anySystemAspectOn() && isTauri) {
      try {
        if (!rustEnabled) { await setNetworkMonitorEnabled(true); rustEnabled = true; }
        snapshot = await fetchNetworkInfo();
        snapshotErr = null;
        if (isAspectOn('network') && snapshot) {
          const sig = interfaceSignature(snapshot.interfaces);
          if (baseline === null) baseline = sig;
          else if (sig !== baseline) tamperChanged = true;
        }
      } catch (e) {
        snapshot = null;
        snapshotErr = (e as Error).message;
      }
    } else {
      snapshot = null;
      snapshotErr = null;
      if (rustEnabled && isTauri) {
        try { await setNetworkMonitorEnabled(false); } catch { /* ignore */ }
        rustEnabled = false;
      }
    }
    endpoints = isAspectOn('services')
      ? await Promise.all(ENDPOINTS.map(probeEndpoint))
      : [];
    renderBody();
  }

  async function fetchPublicIp(): Promise<void> {
    publicIp = null;
    try {
      const res = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
      const j = (await res.json()) as { ip?: string };
      publicIp = j.ip ?? 'unknown';
    } catch {
      publicIp = 'unavailable';
    }
    if (activeTab === 'connection') renderBody();
  }

  // ── Tab rendering ───────────────────────────────────────────────────────
  function renderBody(): void {
    bodyEl.innerHTML = '';
    bodyEl.appendChild(
      activeTab === 'connection' ? connectionTab()
        : activeTab === 'system' ? systemTab()
          : servicesTab(),
    );
    for (const t of TABS) {
      tabButtons[t.id].classList.toggle('parsec-diag__tab--active', t.id === activeTab);
    }
  }

  function connectionTab(): HTMLElement {
    if (!isAspectOn('network')) return offNotice('Network');
    const wrap = el('div', { cls: 'parsec-diag__panel' });
    if (tamperChanged) {
      wrap.appendChild(el('div', {
        cls: 'parsec-callout bp5-callout bp5-intent-danger',
        text: 'Network configuration changed since monitoring began — possible outside tampering.',
      }));
    } else {
      wrap.appendChild(el('p', {
        cls: 'parsec-diag__hint',
        text: 'Network monitoring is a live protection layer — interface or address changes are flagged here.',
      }));
    }
    wrap.appendChild(kv('Status', navigator.onLine ? 'Online' : 'Offline'));
    const conn = (navigator as unknown as { connection?: NavConnection }).connection;
    if (conn) {
      wrap.appendChild(kv('Connection type', conn.effectiveType ?? '—'));
      wrap.appendChild(kv('Downlink', conn.downlink != null ? `${conn.downlink} Mbps` : '—'));
      wrap.appendChild(kv('Round-trip', conn.rtt != null ? `${conn.rtt} ms` : '—'));
    } else {
      wrap.appendChild(el('p', { cls: 'parsec-diag__hint', text: 'Connection speed is not reported by this platform.' }));
    }
    wrap.appendChild(kv('Public IP', publicIp ?? 'checking…'));
    wrap.appendChild(btn('Re-check public IP', { minimal: true, icon: 'refresh', onClick: () => { void fetchPublicIp(); } }));
    return wrap;
  }

  function systemTab(): HTMLElement {
    const wrap = el('div', { cls: 'parsec-diag__panel' });
    if (!isTauri) {
      wrap.appendChild(el('div', {
        cls: 'parsec-callout bp5-callout',
        text: 'Local hardware details (CPU, GPU, MAC) are available in the PARSEC desktop app.',
      }));
      return wrap;
    }
    if (!anySystemAspectOn()) return offNotice('CPU, GPU or MAC');
    if (snapshotErr) {
      wrap.appendChild(el('div', { cls: 'parsec-callout bp5-callout bp5-intent-warning', text: `Snapshot unavailable: ${snapshotErr}` }));
      return wrap;
    }
    if (!snapshot) { wrap.appendChild(el('p', { cls: 'parsec-diag__hint', text: 'Reading…' })); return wrap; }

    if (isAspectOn('cpu')) {
      wrap.appendChild(sectionTitle('CPU'));
      wrap.appendChild(kv('Model', snapshot.cpu.model || '—'));
      wrap.appendChild(kv('Cores', `${snapshot.cpu.physicalCores} physical · ${snapshot.cpu.logicalCores} logical`));
      wrap.appendChild(kv('Live load', `${snapshot.cpu.usagePercent.toFixed(1)} %`));
      wrap.appendChild(kv('Frequency', snapshot.cpu.frequencyMhz ? `${snapshot.cpu.frequencyMhz} MHz` : '—'));
    }
    if (isAspectOn('gpu')) {
      wrap.appendChild(sectionTitle('GPU'));
      if (snapshot.gpu) {
        wrap.appendChild(kv('Adapter', snapshot.gpu.name));
        wrap.appendChild(kv('Vendor', snapshot.gpu.vendor));
      } else {
        wrap.appendChild(el('p', { cls: 'parsec-diag__hint', text: 'GPU not detected on this platform.' }));
      }
    }
    if (isAspectOn('network') || isAspectOn('mac')) {
      wrap.appendChild(sectionTitle('Network interfaces'));
      for (const itf of snapshot.interfaces) wrap.appendChild(interfaceCard(itf));
    }
    return wrap;
  }

  function interfaceCard(itf: InterfaceInfo): HTMLElement {
    const rows: HTMLElement[] = [
      el('div', { cls: 'parsec-diag__if-name', text: itf.name }),
      kv('IPv4', itf.ipv4.join(', ') || '—'),
    ];
    if (itf.ipv6.length) rows.push(kv('IPv6', itf.ipv6.join(', ')));
    if (isAspectOn('mac')) {
      rows.push(kv('MAC', itf.mac ?? '—'));
      rows.push(btn('Spoof / randomize MAC', {
        minimal: true, icon: 'random',
        onClick: () => { void doSpoof(itf.name); },
      }));
    } else {
      rows.push(el('p', { cls: 'parsec-diag__hint', text: 'MAC hidden — light the MAC shield to reveal and spoof.' }));
    }
    return el('div', { cls: 'parsec-diag__if-card', children: rows });
  }

  async function doSpoof(iface: string): Promise<void> {
    const mac = randomMac();
    if (!confirm(
      `Spoof the MAC of ${iface} to ${mac}?\n\n`
      + 'This needs OS privilege (root / admin). If PARSEC is not elevated it '
      + 'fails harmlessly. Your real MAC returns on the next network restart.',
    )) return;
    try {
      const msg = await spoofMac(iface, mac);
      toast(msg, 'success');
      await poll();
    } catch (e) {
      toast(`MAC spoof failed: ${(e as Error).message}`, 'danger');
    }
  }

  function servicesTab(): HTMLElement {
    if (!isAspectOn('services')) return offNotice('Services');
    const wrap = el('div', { cls: 'parsec-diag__panel' });
    wrap.appendChild(el('p', { cls: 'parsec-diag__hint', text: 'Live reachability of the IPFS, Arweave and Algorand/.algo services PARSEC relies on.' }));
    if (!endpoints.length) { wrap.appendChild(el('p', { cls: 'parsec-diag__hint', text: 'Probing…' })); return wrap; }
    for (const e of endpoints) {
      wrap.appendChild(el('div', {
        cls: `parsec-diag__svc parsec-diag__svc--${e.state}`,
        children: [
          el('span', { cls: 'parsec-diag__svc-group', text: e.group }),
          el('span', { cls: 'parsec-diag__svc-label', text: e.label }),
          el('span', {
            cls: 'parsec-diag__svc-stat',
            text: e.state === 'down' ? 'unreachable'
              : `${e.latencyMs} ms${e.state === 'slow' ? ' · slow' : ''}`,
          }),
        ],
      }));
    }
    return wrap;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────
  function offNotice(name: string): HTMLElement {
    return el('div', { cls: 'parsec-diag__off', children: [
      el('span', { cls: 'parsec-diag__off-glyph', text: SHIELD }),
      el('p', { text: `${name} monitoring is off. Light its shield above to begin — nothing runs until you do.` }),
    ]});
  }

  // ── Tab bar + assembly ──────────────────────────────────────────────────
  const tabBar = el('div', {
    cls: 'parsec-diag__tabs',
    children: TABS.map((t) => {
      const b = btn(t.label, {
        minimal: true, icon: t.icon, cls: 'parsec-diag__tab',
        onClick: () => { activeTab = t.id; renderBody(); },
      });
      tabButtons[t.id] = b;
      return b;
    }),
  });

  renderShields();

  // ── Live auto-poll with self-cleanup ────────────────────────────────────
  // Bound to the view: stops the moment the view is left, rather than on the
  // next tick that notices, and turns the Rust network monitor off with it.
  bindInterval(() => { void poll(); }, POLL_MS);
  onCleanup(() => {
    if (rustEnabled && isTauri) { void setNetworkMonitorEnabled(false); }
  });

  root.append(
    header(),
    el('p', { cls: 'parsec-view__desc', text: 'Live network and system readings. Nothing is stored — every value is fetched fresh and discarded.' }),
    shieldsRow,
    tabBar,
    bodyEl,
  );

  renderBody();
  void poll();

  return root;
}

function kv(label: string, value: string): HTMLElement {
  return el('div', { cls: 'parsec-diag__kv', children: [
    el('span', { cls: 'parsec-diag__kv-label', text: label }),
    el('span', { cls: 'parsec-diag__kv-value', text: value }),
  ]});
}

function sectionTitle(text: string): HTMLElement {
  return el('h3', { cls: 'parsec-diag__section', text });
}

function interfaceSignature(interfaces: InterfaceInfo[]): string {
  return interfaces
    .map((i) => `${i.name}|${i.mac ?? ''}|${[...i.ipv4].sort().join(',')}`)
    .sort()
    .join(';');
}
