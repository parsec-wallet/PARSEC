// BANKON Names resolver — standalone permaweb SPA.
//
// Permaweb-deployable, no PARSEC wallet dependency. Reads a name from
// ?name=, the URL hash, or the path, calls the BNR's Resolve handler on
// AR.IO's CU, and either redirects to the resolved @ target or shows
// the record details inline.
//
// Build: vite build --config apps/bankon-resolver/vite.config.ts
// Deploy: permaweb-deploy deploy --deploy-folder apps/bankon-resolver/dist

import { BNR_PROCESS_ID, isBnrConfigured } from '../../src/lib/bankon-names/process-id';

const CU_URL = 'https://cu.ardrive.io';

interface ResolveResult {
  target?: string;
  ttlSeconds: number;
  undernames: Record<string, { transactionId: string; ttlSeconds: number }>;
  owner: string;
  type: 'lease' | 'permabuy';
  endTimestamp?: number;
}

const form = document.getElementById('form') as HTMLFormElement;
const input = document.getElementById('name') as HTMLInputElement;
const result = document.getElementById('result') as HTMLDivElement;
const bnrLink = document.getElementById('bnr-link') as HTMLAnchorElement;

bnrLink.href = `https://www.ao.link/#/entity/${BNR_PROCESS_ID}`;

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = input.value.trim().toLowerCase();
  void resolveAndRender(name);
});

// Auto-resolve from URL.
const urlName = readNameFromUrl();
if (urlName) {
  input.value = urlName;
  void resolveAndRender(urlName);
}

function readNameFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('name') || params.get('n');
  if (q) return q.toLowerCase();
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (hash) return hash.toLowerCase();
  const path = window.location.pathname.replace(/^\//, '').replace(/\/$/, '');
  if (path && !path.endsWith('.html') && !path.includes('/')) return path.toLowerCase();
  return null;
}

async function resolveAndRender(name: string): Promise<void> {
  if (!name) {
    result.innerHTML = '<div class="result error">Enter a name.</div>';
    return;
  }
  if (!isBnrConfigured()) {
    result.innerHTML = '<div class="result error">BANKON Names Registry not yet spawned. Try again later.</div>';
    return;
  }
  result.innerHTML = '<div class="result">Resolving...</div>';

  try {
    const r = await dryRunResolve(name);
    if (!r) {
      result.innerHTML = `<div class="result error">"<b>${escapeHtml(name)}</b>" is not registered on BANKON.</div>`;
      return;
    }
    renderResolved(name, r);
    // If a root @ target is set, automatically redirect after 2 seconds —
    // but let the user see the data first.
    if (r.target) {
      setTimeout(() => {
        window.location.href = `https://${r.target}.arweave.net`;
      }, 2000);
    }
  } catch (e) {
    result.innerHTML = `<div class="result error">Resolve failed: ${escapeHtml(e instanceof Error ? e.message : String(e))}</div>`;
  }
}

function renderResolved(name: string, r: ResolveResult): void {
  const target = r.target ? `<a href="https://${r.target}.arweave.net">${escapeHtml(r.target)}.arweave.net</a>` : '<i>not set</i>';
  const expires = r.endTimestamp ? new Date(r.endTimestamp).toLocaleDateString() : '—';
  const subs = Object.entries(r.undernames);
  const subRows = subs.length === 0 ? '' : `
    <div class="key">Undernames</div>
    ${subs.map(([s, v]) => `<div class="val"><b>${escapeHtml(s)}</b>: <a href="https://${v.transactionId}.arweave.net">${escapeHtml(v.transactionId)}</a></div>`).join('')}
  `;
  result.innerHTML = `
    <div class="result success">
      <div class="key">Name</div>
      <div class="val"><b>${escapeHtml(name)}</b></div>
      <div class="key">Root (@)</div>
      <div class="val">${target}</div>
      <div class="key">Owner</div>
      <div class="val">${escapeHtml(r.owner)}</div>
      <div class="key">Type</div>
      <div class="val">${r.type}${r.type === 'lease' ? ` &middot; expires ${expires}` : ''}</div>
      ${subRows}
      ${r.target ? '<div class="val" style="margin-top:1rem;color:#888;font-size:0.8rem;">Redirecting in 2s...</div>' : ''}
    </div>
  `;
}

async function dryRunResolve(name: string): Promise<ResolveResult | null> {
  const body = {
    Id: '0000000000000000000000000000000000000000000',
    Owner: '0000000000000000000000000000000000000000000',
    Target: BNR_PROCESS_ID,
    Anchor: '0',
    Data: '',
    Tags: [
      { name: 'Action', value: 'Resolve' },
      { name: 'Name', value: name },
    ],
  };
  const res = await fetch(`${CU_URL}/dry-run?process-id=${encodeURIComponent(BNR_PROCESS_ID)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`CU rejected dry-run: ${res.status}`);
  const json = await res.json() as { Data?: string };
  if (!json.Data || json.Data === 'null') return null;
  try {
    return JSON.parse(json.Data) as ResolveResult;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
