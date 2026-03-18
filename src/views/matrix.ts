// Parsec Wallet — Matrix Entry Gate
// WebGL matrix rain. Blue pill (left) = diagnostics. Red pill (right) = live wallet.
// Matrix wall = safe to walk away. Password never remembered.

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { keystoreUnlock } from '../lib/keystore';
import { hasVault } from '../lib/crypto';
import { isTauri } from '../lib/vault';
import { fetchAccountInfo, microAlgosToAlgo } from '../lib/algorand/account';
import { enrichAssets, formatAssetAmount } from '../lib/algorand/assets';
import type { NetworkId } from '../types/wallet';

type PillChoice = 'none' | 'red' | 'blue';

// Chain registry — Algorand active, others ready to plug in
interface ChainDef {
  id: string;
  name: string;
  enabled: boolean;
  addressFormat: string;
}

const CHAINS: ChainDef[] = [
  { id: 'algorand', name: 'Algorand', enabled: true, addressFormat: '58-char base32' },
  { id: 'solana', name: 'Solana', enabled: false, addressFormat: 'base58' },
  { id: 'bitcoin', name: 'Bitcoin', enabled: false, addressFormat: 'Bech32' },
  { id: 'ethereum', name: 'Ethereum', enabled: false, addressFormat: '0x + 40 hex' },
];

export function matrixView(): HTMLElement {
  let choice: PillChoice = 'none';
  let passphrase = '';
  let zoom = 1.0;

  const container = el('div', { cls: 'parsec-matrix' });

  const canvas = document.createElement('canvas');
  canvas.className = 'parsec-matrix__canvas';
  container.appendChild(canvas);
  container.appendChild(el('div', { cls: 'parsec-matrix__overlay' }));

  const panel = el('div', { cls: 'parsec-matrix__panel' });
  container.appendChild(panel);

  // Zoom from scroll/pinch
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.max(0.3, Math.min(3.0, zoom + e.deltaY * -0.002));
    if (gl) setUniform('u_zoom', zoom);
  }, { passive: false });

  // Mouse/touch interaction
  let mouseX = 0.5, mouseY = 0.5;
  container.addEventListener('mousemove', (e) => {
    mouseX = e.clientX / window.innerWidth;
    mouseY = 1.0 - e.clientY / window.innerHeight;
    if (gl) setUniform('u_mouse', mouseX, mouseY);
  });
  container.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    mouseX = t.clientX / window.innerWidth;
    mouseY = 1.0 - t.clientY / window.innerHeight;
    if (gl) setUniform('u_mouse', mouseX, mouseY);
  }, { passive: true });

  renderPanel();

  // WebGL
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let startTime = performance.now();
  let raf = 0;
  let pillUniform = 0;

  function setUniform(name: string, ...values: number[]) {
    if (!gl || !program) return;
    const loc = gl.getUniformLocation(program, name);
    if (!loc) return;
    if (values.length === 1) gl.uniform1f(loc, values[0]);
    else if (values.length === 2) gl.uniform2f(loc, values[0], values[1]);
  }

  function initGL() {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERT); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, FRAG); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return;
    program = gl.createProgram()!;
    gl.attachShader(program, vs); gl.attachShader(program, fs);
    gl.linkProgram(program); gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    resize(); window.addEventListener('resize', resize);
    startTime = performance.now(); frame();
  }

  function resize() {
    if (!gl) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px'; canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
    setUniform('u_resolution', canvas.width, canvas.height);
  }

  function frame() {
    if (!gl || !program) return;
    const t = (performance.now() - startTime) * 0.001;
    setUniform('u_time', t); setUniform('u_pill', pillUniform);
    setUniform('u_zoom', zoom); setUniform('u_mouse', mouseX, mouseY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(frame);
  }

  function setPill(p: PillChoice) {
    choice = p;
    pillUniform = p === 'red' ? 1.0 : p === 'blue' ? 2.0 : 0.0;
    renderPanel();
  }

  function cancelAnimation() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  }

  // ── Panel Rendering ──────────────────────────────────────────

  function renderPanel() {
    panel.innerHTML = '';
    panel.appendChild(el('div', { cls: 'parsec-matrix__brand', text: 'PARSEC' }));

    if (choice === 'none') return renderPillChoice();
    if (choice === 'blue') return renderBluePill();
    if (choice === 'red') return renderRedPill();
  }

  function renderPillChoice() {
    panel.appendChild(el('p', { cls: 'parsec-matrix__tagline', text: 'Choose your path' }));

    const pills = el('div', { cls: 'parsec-matrix__pills' });

    // Blue pill on LEFT (participant's left = safe/diagnostics first)
    pills.appendChild(el('div', {
      cls: 'parsec-matrix__pill parsec-matrix__pill--blue',
      onClick: () => setPill('blue'),
      children: [
        el('div', { cls: 'parsec-matrix__pill-capsule' }),
        el('div', { cls: 'parsec-matrix__pill-label', text: 'Blue Pill' }),
        el('div', { cls: 'parsec-matrix__pill-desc', text: 'Diagnostics' }),
      ],
    }));

    // Red pill on RIGHT (privileged access)
    pills.appendChild(el('div', {
      cls: 'parsec-matrix__pill parsec-matrix__pill--red',
      onClick: () => setPill('red'),
      children: [
        el('div', { cls: 'parsec-matrix__pill-capsule' }),
        el('div', { cls: 'parsec-matrix__pill-label', text: 'Red Pill' }),
        el('div', { cls: 'parsec-matrix__pill-desc', text: 'Live wallet' }),
      ],
    }));

    panel.appendChild(pills);
    panel.appendChild(el('p', { cls: 'parsec-matrix__footer-text', text: 'Safe to walk away. No session active.' }));
  }

  // ── Blue Pill: Diagnostics ─────────────────────────────────

  function renderBluePill() {
    panel.appendChild(el('div', { cls: 'parsec-matrix__choice-label parsec-matrix__choice-label--blue', text: 'BLUE PILL — DIAGNOSTICS' }));

    const state = store.get();
    const hasAccounts = state.accounts.length > 0;

    if (!hasAccounts) {
      panel.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'No accounts found. Import a public address to view diagnostics.' }));
      panel.appendChild(btn('Import Watch-Only Address', {
        large: true, outlined: true, cls: 'parsec-matrix__action',
        onClick: () => { cancelAnimation(); store.navigate('import-wallet'); },
      }));
    } else {
      panel.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'Read-only portfolio intelligence. No signing authority.' }));

      // Diagnostics container — load async
      const diagBox = el('div', { cls: 'parsec-matrix__diag' });
      panel.appendChild(diagBox);
      loadDiagnostics(diagBox, state.accounts, state.settings.network);

      panel.appendChild(el('p', { cls: 'parsec-matrix__note', text: 'View only. Transactions and signing disabled.' }));
    }

    backButton();
  }

  async function loadDiagnostics(
    container: HTMLElement,
    accounts: { address: string; name: string; watchOnly?: boolean }[],
    network: NetworkId,
  ) {
    container.innerHTML = '';
    container.appendChild(el('div', { cls: 'parsec-matrix__diag-loading', text: 'Fetching on-chain data...' }));

    for (const acct of accounts) {
      try {
        const info = await fetchAccountInfo(acct.address, network);
        info.assets = await enrichAssets(info.assets, network);

        const assetRows = info.assets.map(a =>
          el('div', {
            cls: 'parsec-matrix__diag-asset',
            children: [
              el('span', { text: a.unitName || a.name || `ASA #${a.assetId}` }),
              el('span', { text: formatAssetAmount(a.amount, a.decimals) }),
            ],
          })
        );

        const card = el('div', {
          cls: 'parsec-matrix__diag-card',
          children: [
            el('div', { cls: 'parsec-matrix__diag-header', children: [
              el('span', { cls: 'parsec-matrix__diag-name', text: acct.name }),
              el('span', { cls: 'parsec-matrix__diag-addr', text: `${acct.address.slice(0, 6)}...${acct.address.slice(-4)}` }),
            ]}),
            el('div', { cls: 'parsec-matrix__diag-balance', text: `${microAlgosToAlgo(info.amount)} ALGO` }),
            el('div', { cls: 'parsec-matrix__diag-meta', text: `Min Balance: ${microAlgosToAlgo(info.minBalance)} · ${info.assets.length} assets · Round ${info.round}` }),
            ...assetRows,
            info.assets.some(a => a.isFrozen) ? el('div', { cls: 'parsec-matrix__diag-warn', text: 'Some assets are frozen' }) : el('span'),
          ],
        });

        container.innerHTML = '';
        container.appendChild(card);
      } catch {
        container.innerHTML = '';
        container.appendChild(el('div', { cls: 'parsec-matrix__diag-error', text: 'Could not fetch account data. Check network.' }));
      }
    }
  }

  // ── Red Pill: Live Wallet ──────────────────────────────────

  function renderRedPill() {
    panel.appendChild(el('div', { cls: 'parsec-matrix__choice-label parsec-matrix__choice-label--red', text: 'RED PILL — LIVE WALLET' }));
    panel.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'Sovereign access. Signing authority. Full control.' }));

    const hasAccounts = store.get().accounts.length > 0;
    const hasKeys = isTauri() || hasVault();

    if (hasAccounts && hasKeys) {
      // Returning user — unlock
      const passInput = input({
        type: 'password',
        placeholder: 'Enter passphrase',
        cls: 'parsec-matrix__input',
        onInput: (v) => { passphrase = v; },
        onEnter: () => doUnlock(),
      });
      panel.appendChild(passInput);
      panel.appendChild(btn('Unlock Wallet', {
        intent: 'primary', large: true, cls: 'parsec-matrix__action parsec-matrix__action--red',
        onClick: doUnlock,
      }));
      setTimeout(() => passInput.focus(), 100);
    } else {
      // New user — chain-aware create/import
      panel.appendChild(el('div', { cls: 'parsec-matrix__chain-section', children: [
        el('div', { cls: 'parsec-matrix__chain-title', text: 'Select Chain' }),
        el('div', { cls: 'parsec-matrix__chain-list', children:
          CHAINS.map(chain => el('div', {
            cls: `parsec-matrix__chain-item ${chain.enabled ? '' : 'parsec-matrix__chain-item--disabled'}`,
            onClick: chain.enabled ? () => {
              cancelAnimation();
              store.navigate('onboarding');
            } : undefined,
            children: [
              el('span', { cls: 'parsec-matrix__chain-name', text: chain.name }),
              el('span', { cls: 'parsec-matrix__chain-format', text: chain.enabled ? chain.addressFormat : 'Coming soon' }),
            ],
          })),
        }),
      ]}));
    }

    backButton();
  }

  function backButton() {
    panel.appendChild(el('div', {
      cls: 'parsec-matrix__back',
      children: [
        el('a', { text: 'Return to Matrix', attrs: { href: '#' }, onClick: (e) => { e.preventDefault(); passphrase = ''; setPill('none'); } }),
      ],
    }));
  }

  async function doUnlock() {
    if (!passphrase || passphrase.length < 8) { toast('Enter your passphrase', 'danger'); return; }
    store.set({ isLoading: true });
    const ok = await keystoreUnlock(passphrase);
    store.set({ isLoading: false });
    if (ok) {
      store.setPassphrase(passphrase);
      passphrase = '';
      cancelAnimation();
      store.navigate('dashboard');
    } else {
      toast('Wrong passphrase', 'danger');
      passphrase = '';
    }
  }

  requestAnimationFrame(() => initGL());
  return container;
}

// ── WebGL Shaders ────────────────────────────────────────────────

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pill;
uniform float u_zoom;
uniform vec2 u_mouse;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float glyph(vec2 uv, float seed) {
  vec2 cell = floor(uv * vec2(5.0, 7.0));
  if (cell.x < 0.0 || cell.x > 4.0 || cell.y < 0.0 || cell.y > 6.0) return 0.0;
  float id = floor(seed * 64.0);
  float bit = hash(cell + id);
  float threshold = 0.38 + 0.12 * sin(seed * 6.28);
  return step(threshold, bit) * step(0.15, fract(uv.x * 5.0)) * step(0.12, fract(uv.y * 7.0));
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 res = u_resolution;
  float t = u_time;
  float z = u_zoom;
  float cellSize = 16.0 * z;
  vec2 grid = fragCoord / cellSize;
  vec2 cellId = floor(grid);
  vec2 cellUv = fract(grid);
  float colSeed = hash(vec2(cellId.x, 0.0));
  float speed = 0.6 + colSeed * 1.8;
  float offset = colSeed * 100.0;
  float scroll = t * speed + offset;
  float rowId = cellId.y + floor(scroll);
  float charSeed = hash(vec2(cellId.x, rowId));
  float head = fract(scroll);
  float dist = fract(cellId.y / res.y * cellSize + head);
  float trail = smoothstep(0.0, 0.6, dist) * smoothstep(1.0, 0.35, dist);
  float brightness = trail * (0.4 + 0.6 * charSeed);
  float g = glyph(cellUv, charSeed + floor(t * 3.0 + cellId.x * 0.7) * 0.01);
  brightness *= g;
  float headGlow = smoothstep(0.04, 0.0, abs(dist - 0.98)) * 2.0;
  vec3 col = vec3(0.1, 1.0, 0.35) * brightness;
  col += vec3(0.7, 1.0, 0.8) * headGlow * g;
  if (u_pill > 0.5 && u_pill < 1.5) {
    col = mix(col, vec3(1.0, 0.3, 0.15) * brightness + vec3(1.0, 0.6, 0.4) * headGlow * g, 0.55);
  } else if (u_pill > 1.5) {
    col = mix(col, vec3(0.15, 0.5, 1.0) * brightness + vec3(0.4, 0.7, 1.0) * headGlow * g, 0.55);
  }
  vec2 mousePos = u_mouse * res;
  float mouseDist = length(fragCoord - mousePos) / max(res.x, res.y);
  float mouseGlow = smoothstep(0.25, 0.0, mouseDist) * 0.15;
  if (u_pill > 0.5 && u_pill < 1.5) { col += vec3(1.0, 0.2, 0.1) * mouseGlow; }
  else if (u_pill > 1.5) { col += vec3(0.1, 0.4, 1.0) * mouseGlow; }
  else { col += vec3(0.1, 0.8, 0.3) * mouseGlow; }
  vec2 uv = fragCoord / res;
  float vig = 1.0 - 0.4 * length(uv - 0.5);
  col *= vig;
  col *= 0.92 + 0.08 * sin(fragCoord.y * 2.5);
  gl_FragColor = vec4(col, 1.0);
}
`;
