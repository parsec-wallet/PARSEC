// Parsec Wallet — Matrix Entry Gate
// WebGL shader rain with 3D depth, crypto icon glyphs, live price on hover.
// Blue pill (left) = diagnostics. Red pill (right) = live wallet.
// Matrix wall = safe to walk away. Password never remembered.

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { keystoreUnlock } from '../lib/keystore';
import { hasVault } from '../lib/crypto';
import { isTauri } from '../lib/vault';
import { fetchAccountInfo, microAlgosToAlgo } from '../lib/algorand/account';
import { enrichAssets, formatAssetAmount } from '../lib/algorand/assets';
import { startPriceUpdates, formatPrice, formatMarketCap } from '../lib/prices';
import type { CoinPrice } from '../lib/prices';
import type { NetworkId } from '../types/wallet';

type PillChoice = 'none' | 'red' | 'blue';

interface ChainDef { id: string; name: string; enabled: boolean; }
const CHAINS: ChainDef[] = [
  { id: 'algorand', name: 'Algorand', enabled: true },
  { id: 'solana', name: 'Solana', enabled: false },
  { id: 'bitcoin', name: 'Bitcoin', enabled: false },
  { id: 'ethereum', name: 'Ethereum', enabled: false },
];

// Crypto icon positions — scattered across the matrix rain
interface CryptoGlyph {
  coin: CoinPrice;
  x: number; y: number; // normalized 0-1
  size: number;
}

export function matrixView(): HTMLElement {
  let choice: PillChoice = 'none';
  let passphrase = '';
  let zoom = 1.0;
  let prices: CoinPrice[] = [];
  let cryptoGlyphs: CryptoGlyph[] = [];

  const container = el('div', { cls: 'parsec-matrix' });
  const canvas = document.createElement('canvas');
  canvas.className = 'parsec-matrix__canvas';
  container.appendChild(canvas);
  container.appendChild(el('div', { cls: 'parsec-matrix__overlay' }));

  // Crypto glyph overlay layer (HTML on top of WebGL)
  const glyphLayer = el('div', { cls: 'parsec-matrix__glyph-layer' });
  container.appendChild(glyphLayer);

  // Price tooltip
  const tooltip = el('div', { cls: 'parsec-matrix__tooltip' });
  container.appendChild(tooltip);

  const panel = el('div', { cls: 'parsec-matrix__panel' });
  container.appendChild(panel);

  // Zoom
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.max(0.3, Math.min(3.0, zoom + e.deltaY * -0.003));
    if (gl) setUniform('u_zoom', zoom);
    updateGlyphSizes();
  }, { passive: false });

  // Mouse
  let mouseX = 0.5, mouseY = 0.5;
  container.addEventListener('mousemove', (e) => {
    mouseX = e.clientX / window.innerWidth;
    mouseY = 1.0 - e.clientY / window.innerHeight;
    if (gl) setUniform('u_mouse', mouseX, mouseY);
    checkGlyphHover(e.clientX, e.clientY);
  });
  container.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    mouseX = t.clientX / window.innerWidth;
    mouseY = 1.0 - t.clientY / window.innerHeight;
    if (gl) setUniform('u_mouse', mouseX, mouseY);
  }, { passive: true });

  container.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });

  // Casual realtime price updates — auto-refreshes within free tier limits
  const stopPrices = startPriceUpdates(p => {
    prices = p;
    createGlyphs();
  });

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
    // Drift glyphs slowly
    driftGlyphs(t);
    raf = requestAnimationFrame(frame);
  }

  function cancelAnimation() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    stopPrices();
  }

  // ── Crypto Glyphs ───────────────────────────────────────────

  function createGlyphs() {
    glyphLayer.innerHTML = '';
    cryptoGlyphs = [];
    if (prices.length === 0) return;

    // Scatter crypto icons across the screen — avoid center panel area
    for (let i = 0; i < prices.length && i < 10; i++) {
      const coin = prices[i];
      // Place in the margins (left 25% or right 25%, varied vertically)
      const side = i % 2 === 0 ? 0.05 + Math.random() * 0.2 : 0.75 + Math.random() * 0.2;
      const y = 0.1 + (i / 10) * 0.8 + (Math.random() - 0.5) * 0.1;
      const depth = 0.6 + Math.random() * 0.4;
      const size = 24 * depth * zoom;

      const glyph: CryptoGlyph = { coin, x: side, y, size };
      cryptoGlyphs.push(glyph);

      const glyphEl = el('div', {
        cls: 'parsec-matrix__crypto-glyph',
        text: coin.symbol,
        attrs: {
          'data-coin': coin.id,
          style: `left:${side * 100}%;top:${y * 100}%;font-size:${size}px;opacity:${0.15 + depth * 0.25}`,
        },
      });
      glyphLayer.appendChild(glyphEl);
    }
  }

  function updateGlyphSizes() {
    const glyphs = glyphLayer.querySelectorAll('.parsec-matrix__crypto-glyph');
    cryptoGlyphs.forEach((g, i) => {
      const el = glyphs[i] as HTMLElement;
      if (el) el.style.fontSize = `${g.size * zoom}px`;
    });
  }

  function driftGlyphs(t: number) {
    const glyphs = glyphLayer.querySelectorAll('.parsec-matrix__crypto-glyph');
    cryptoGlyphs.forEach((_cg, i) => {
      const glyphEl = glyphs[i] as HTMLElement;
      if (!glyphEl) return;
      const drift = Math.sin(t * 0.3 + i * 1.7) * 8;
      glyphEl.style.transform = `translateY(${drift}px)`;
    });
  }

  function checkGlyphHover(mx: number, my: number) {
    let hit = false;
    for (const g of cryptoGlyphs) {
      const gx = g.x * window.innerWidth;
      const gy = g.y * window.innerHeight;
      const dist = Math.sqrt((mx - gx) ** 2 + (my - gy) ** 2);
      if (dist < 50 * zoom) {
        showTooltip(g.coin, mx, my);
        hit = true;
        break;
      }
    }
    if (!hit) tooltip.style.opacity = '0';
  }

  function showTooltip(coin: CoinPrice, x: number, y: number) {
    const changeColor = coin.change24h >= 0 ? '#10b981' : '#ef4444';
    const changeSign = coin.change24h >= 0 ? '+' : '';
    tooltip.innerHTML = `
      <div class="parsec-matrix__tooltip-symbol">${coin.symbol}</div>
      <div class="parsec-matrix__tooltip-price">${formatPrice(coin.usd)}</div>
      <div class="parsec-matrix__tooltip-change" style="color:${changeColor}">${changeSign}${coin.change24h.toFixed(2)}%</div>
      <div class="parsec-matrix__tooltip-cap">${formatMarketCap(coin.marketCap)}</div>
    `;
    tooltip.style.left = `${x + 16}px`;
    tooltip.style.top = `${y - 20}px`;
    tooltip.style.opacity = '1';
  }

  function setPill(p: PillChoice) {
    choice = p;
    pillUniform = p === 'red' ? 1.0 : p === 'blue' ? 2.0 : 0.0;
    renderPanel();
  }

  // ── Panel Rendering ─────────────────────────────────────────

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
    pills.appendChild(el('div', {
      cls: 'parsec-matrix__pill parsec-matrix__pill--blue',
      onClick: () => setPill('blue'),
      children: [
        el('div', { cls: 'parsec-matrix__pill-capsule' }),
        el('div', { cls: 'parsec-matrix__pill-label', text: 'Blue Pill' }),
        el('div', { cls: 'parsec-matrix__pill-desc', text: 'Diagnostics' }),
      ],
    }));
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

  function renderBluePill() {
    panel.appendChild(el('div', { cls: 'parsec-matrix__choice-label parsec-matrix__choice-label--blue', text: 'BLUE PILL — DIAGNOSTICS' }));
    const state = store.get();
    if (!state.accounts.length) {
      panel.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'No accounts. Import a public address to view diagnostics.' }));
      panel.appendChild(btn('Import Watch-Only Address', { large: true, outlined: true, cls: 'parsec-matrix__action', onClick: () => { cancelAnimation(); store.navigate('import-wallet'); } }));
    } else {
      panel.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'Read-only portfolio intelligence. No signing authority.' }));
      const diagBox = el('div', { cls: 'parsec-matrix__diag' });
      panel.appendChild(diagBox);
      loadDiagnostics(diagBox, state.accounts, state.settings.network);
    }
    backButton();
  }

  async function loadDiagnostics(container: HTMLElement, accounts: { address: string; name: string }[], network: NetworkId) {
    container.innerHTML = '';
    container.appendChild(el('div', { cls: 'parsec-matrix__diag-loading', text: 'Reading blockchain...' }));
    for (const acct of accounts) {
      try {
        const info = await fetchAccountInfo(acct.address, network);
        info.assets = await enrichAssets(info.assets, network);
        const assetRows = info.assets.map(a => el('div', { cls: 'parsec-matrix__diag-asset', children: [
          el('span', { text: a.unitName || a.name || `ASA #${a.assetId}` }),
          el('span', { text: formatAssetAmount(a.amount, a.decimals) }),
        ]}));
        container.innerHTML = '';
        container.appendChild(el('div', { cls: 'parsec-matrix__diag-card', children: [
          el('div', { cls: 'parsec-matrix__diag-header', children: [
            el('span', { cls: 'parsec-matrix__diag-name', text: acct.name }),
            el('span', { cls: 'parsec-matrix__diag-addr', text: `${acct.address.slice(0, 6)}...${acct.address.slice(-4)}` }),
          ]}),
          el('div', { cls: 'parsec-matrix__diag-balance', text: `${microAlgosToAlgo(info.amount)} ALGO` }),
          el('div', { cls: 'parsec-matrix__diag-meta', text: `Min: ${microAlgosToAlgo(info.minBalance)} · ${info.assets.length} assets · Round ${info.round}` }),
          ...assetRows,
        ]}));
      } catch { container.innerHTML = ''; container.appendChild(el('div', { cls: 'parsec-matrix__diag-error', text: 'Could not fetch data.' })); }
    }
  }

  function renderRedPill() {
    panel.appendChild(el('div', { cls: 'parsec-matrix__choice-label parsec-matrix__choice-label--red', text: 'RED PILL — LIVE WALLET' }));
    panel.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'Sovereign access. Signing authority. Full control.' }));
    const hasAccounts = store.get().accounts.length > 0;
    const hasKeys = isTauri() || hasVault();
    if (hasAccounts && hasKeys) {
      const passInput = input({ type: 'password', placeholder: 'Enter passphrase', cls: 'parsec-matrix__input', onInput: (v) => { passphrase = v; }, onEnter: () => doUnlock() });
      panel.appendChild(passInput);
      panel.appendChild(btn('Unlock Wallet', { intent: 'primary', large: true, cls: 'parsec-matrix__action parsec-matrix__action--red', onClick: doUnlock }));
      setTimeout(() => passInput.focus(), 100);
    } else {
      panel.appendChild(el('div', { cls: 'parsec-matrix__chain-section', children: [
        el('div', { cls: 'parsec-matrix__chain-title', text: 'Select Chain' }),
        el('div', { cls: 'parsec-matrix__chain-list', children: CHAINS.map(chain => el('div', {
          cls: `parsec-matrix__chain-item ${chain.enabled ? '' : 'parsec-matrix__chain-item--disabled'}`,
          onClick: chain.enabled ? () => { cancelAnimation(); store.navigate('onboarding'); } : undefined,
          children: [
            el('span', { cls: 'parsec-matrix__chain-name', text: chain.name }),
            el('span', { cls: 'parsec-matrix__chain-format', text: chain.enabled ? 'Active' : 'Coming soon' }),
          ],
        })) }),
      ]}));
    }
    backButton();
  }

  function backButton() {
    panel.appendChild(el('div', { cls: 'parsec-matrix__back', children: [
      el('a', { text: 'Return to Matrix', attrs: { href: '#' }, onClick: (e) => { e.preventDefault(); passphrase = ''; setPill('none'); } }),
    ]}));
  }

  async function doUnlock() {
    if (!passphrase || passphrase.length < 8) { toast('Enter your passphrase', 'danger'); return; }
    store.set({ isLoading: true });
    const ok = await keystoreUnlock(passphrase);
    store.set({ isLoading: false });
    if (ok) { store.setPassphrase(passphrase); passphrase = ''; cancelAnimation(); store.navigate('dashboard'); }
    else { toast('Wrong passphrase', 'danger'); passphrase = ''; }
  }

  requestAnimationFrame(() => initGL());
  return container;
}

// ── WebGL Shaders ────────────────────────────────────────────────

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Enhanced matrix rain — 3D depth, intricate glyphs, perspective
const FRAG = `
precision mediump float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pill;
uniform float u_zoom;
uniform vec2 u_mouse;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash1(float p) { return fract(sin(p * 127.1) * 43758.5453); }

// 3D perspective glyph with depth
float glyph(vec2 uv, float seed, float depth) {
  // Higher depth = more complex glyph
  vec2 grid = vec2(5.0, 7.0) + depth * vec2(2.0, 3.0);
  vec2 cell = floor(uv * grid);
  if (cell.x < 0.0 || cell.x >= grid.x || cell.y < 0.0 || cell.y >= grid.y) return 0.0;
  float id = floor(seed * 96.0);
  float bit = hash(cell + id + depth * 17.0);
  float threshold = 0.32 + 0.15 * sin(seed * 6.28 + depth);
  // Add serifs and cross-strokes based on depth
  float serif = step(0.85, bit) * step(cell.y, 1.0) * 0.5;
  float stroke = step(threshold, bit) * step(0.12, fract(uv.x * grid.x)) * step(0.1, fract(uv.y * grid.y));
  return stroke + serif;
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 res = u_resolution;
  float t = u_time;
  float z = u_zoom;

  // 3D perspective warp — subtle vanishing point
  vec2 centered = (fragCoord / res - 0.5) * 2.0;
  float perspZ = 1.0 + centered.y * 0.15; // depth from top to bottom
  vec2 warped = fragCoord / perspZ;

  float cellSize = 16.0 * z;
  vec2 grid = warped / cellSize;
  vec2 cellId = floor(grid);
  vec2 cellUv = fract(grid);

  // Column properties with depth layering
  float colSeed = hash(vec2(cellId.x, 0.0));
  float depth = 0.3 + colSeed * 0.7; // each column at different z-depth
  float speed = (0.4 + colSeed * 2.0) * (0.5 + depth * 0.8);
  float offset = colSeed * 100.0;

  // Scrolling
  float scroll = t * speed + offset;
  float rowId = cellId.y + floor(scroll);
  float charSeed = hash(vec2(cellId.x, rowId));

  // Change characters over time — some columns faster than others
  float charFlicker = floor(t * (2.0 + colSeed * 8.0) + cellId.x * 0.7);
  float flickerSeed = charSeed + charFlicker * 0.01;

  // Rain trail with 3D depth-based falloff
  float head = fract(scroll);
  float dist = fract(cellId.y / res.y * cellSize + head);
  float trailLen = 0.3 + depth * 0.4;
  float trail = smoothstep(0.0, trailLen, dist) * smoothstep(1.0, 1.0 - trailLen, dist);
  float brightness = trail * (0.3 + 0.7 * charSeed) * (0.5 + depth * 0.5);

  // Glyph with depth complexity
  float g = glyph(cellUv, flickerSeed, depth);
  brightness *= g;

  // Head glow — brighter at high depth (foreground)
  float headGlow = smoothstep(0.04, 0.0, abs(dist - 0.98)) * (1.5 + depth);

  // Base color — green with depth-based saturation
  float greenIntensity = 0.8 + depth * 0.2;
  vec3 col = vec3(0.08, greenIntensity, 0.3) * brightness;
  col += vec3(0.6, 1.0, 0.7) * headGlow * g * depth;

  // Depth fog — far columns dimmer
  col *= depth;

  // Pill tinting
  if (u_pill > 0.5 && u_pill < 1.5) {
    col = mix(col, vec3(1.0, 0.25, 0.12) * brightness * depth + vec3(1.0, 0.5, 0.3) * headGlow * g, 0.5);
  } else if (u_pill > 1.5) {
    col = mix(col, vec3(0.12, 0.45, 1.0) * brightness * depth + vec3(0.3, 0.6, 1.0) * headGlow * g, 0.5);
  }

  // Mouse proximity — 3D-aware glow
  vec2 mousePos = u_mouse * res;
  float mouseDist = length(fragCoord - mousePos) / max(res.x, res.y);
  float mouseGlow = smoothstep(0.2, 0.0, mouseDist) * 0.2 * depth;
  if (u_pill > 0.5 && u_pill < 1.5) { col += vec3(1.0, 0.15, 0.05) * mouseGlow; }
  else if (u_pill > 1.5) { col += vec3(0.05, 0.3, 1.0) * mouseGlow; }
  else { col += vec3(0.05, 0.7, 0.25) * mouseGlow; }

  // Perspective vignette — darker at edges, brighter center
  vec2 uv = fragCoord / res;
  float vig = 1.0 - 0.5 * pow(length(uv - 0.5) * 1.4, 2.0);
  col *= vig;

  // Scanlines with depth variation
  col *= 0.9 + 0.1 * sin(fragCoord.y * (2.0 + depth));

  // CRT curvature subtle hint
  float crt = 1.0 - 0.03 * (centered.x * centered.x + centered.y * centered.y);
  col *= crt;

  gl_FragColor = vec4(col, 1.0);
}
`;
