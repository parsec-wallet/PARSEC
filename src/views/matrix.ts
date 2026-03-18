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
import { startPriceUpdates, formatPrice, formatMarketCap, getMarketActivity, getMarketSentiment } from '../lib/prices';
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

  // Casual realtime price updates — market activity drives shader speed
  const stopPrices = startPriceUpdates(p => {
    prices = p;
    activityUniform = getMarketActivity(p);
    sentimentUniform = getMarketSentiment(p);
    createGlyphs();
  });

  renderPanel();

  // WebGL
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let startTime = performance.now();
  let raf = 0;
  let pillUniform = 0;
  let activityUniform = 0.15; // calm default — mesmerizing slow
  let sentimentUniform = 0.0; // -1 bear/red to +1 bull/green

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
    setUniform('u_activity', activityUniform);
    setUniform('u_sentiment', sentimentUniform);
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

// Matrix rain shader — market-driven speed, 3D depth, elegant glyphs
const FRAG = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pill;
uniform float u_zoom;
uniform vec2 u_mouse;
uniform float u_activity;  // 0.0=frozen, 0.15=calm, 0.5=normal, 0.9=volatile
uniform float u_sentiment; // -1.0=bear/red, 0.0=neutral/green, +1.0=bull/bright green

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// Smooth glyph with anti-aliased strokes and elegant structure
float glyph(vec2 uv, float seed, float depth) {
  vec2 grid = vec2(5.0, 8.0);
  vec2 cell = floor(uv * grid);
  if (cell.x < 0.0 || cell.x >= grid.x || cell.y < 0.0 || cell.y >= grid.y) return 0.0;

  float id = floor(seed * 128.0);
  float r = hash(cell + id + depth * 13.0);

  // Structural patterns — horizontals, verticals, diagonals, dots
  float pattern = 0.0;
  float cx = fract(uv.x * grid.x);
  float cy = fract(uv.y * grid.y);

  // Vertical strokes
  if (r > 0.3) pattern += smoothstep(0.35, 0.38, cx) * smoothstep(0.65, 0.62, cx);
  // Horizontal bars
  if (r > 0.55) pattern += smoothstep(0.3, 0.33, cy) * smoothstep(0.7, 0.67, cy) * 0.7;
  // Corner dots (kanji-like)
  float dot1 = 1.0 - smoothstep(0.12, 0.18, length(vec2(cx, cy) - vec2(0.2, 0.2)));
  float dot2 = 1.0 - smoothstep(0.12, 0.18, length(vec2(cx, cy) - vec2(0.8, 0.8)));
  if (r > 0.7) pattern += (dot1 + dot2) * 0.6;
  // Diagonal
  if (r > 0.8) pattern += smoothstep(0.08, 0.0, abs(cx - cy)) * 0.5;
  // Cross
  if (r < 0.25) {
    pattern += smoothstep(0.42, 0.45, cx) * smoothstep(0.58, 0.55, cx);
    pattern += smoothstep(0.42, 0.45, cy) * smoothstep(0.58, 0.55, cy);
  }

  // Outer padding — clean edges
  float pad = smoothstep(0.04, 0.1, cx) * smoothstep(0.96, 0.9, cx)
            * smoothstep(0.04, 0.1, cy) * smoothstep(0.96, 0.9, cy);

  return clamp(pattern * pad, 0.0, 1.0);
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 res = u_resolution;
  float z = u_zoom;
  float act = u_activity;

  // Market-driven time — calm markets = slow mesmerizing flow
  // Base speed 0.15 (very slow) scaled up by activity
  float timeScale = 0.15 + act * 0.85;
  float t = u_time * timeScale;

  // 3D perspective
  vec2 centered = (fragCoord / res - 0.5) * 2.0;
  float perspZ = 1.0 + centered.y * 0.12;
  vec2 warped = fragCoord / perspZ;

  float cellSize = 18.0 * z;
  vec2 grid = warped / cellSize;
  vec2 cellId = floor(grid);
  vec2 cellUv = fract(grid);

  // Column depth — 3 distinct layers
  float colSeed = hash(vec2(cellId.x, 0.0));
  float depthRaw = colSeed;
  float depth = 0.25 + depthRaw * 0.75;

  // Speed per column — slower base, scaled by market activity
  float colSpeed = (0.3 + colSeed * 1.2) * depth;
  float offset = colSeed * 200.0;

  float scroll = t * colSpeed + offset;
  float rowId = cellId.y + floor(scroll);
  float charSeed = hash(vec2(cellId.x, rowId));

  // Character change rate — slow and deliberate at low activity
  float flickerRate = 0.5 + act * 4.0;
  float charFlicker = floor(u_time * flickerRate * (0.3 + colSeed * 0.7));
  float flickerSeed = charSeed + charFlicker * 0.007;

  // Rain trail — longer, more graceful trails at low activity
  float head = fract(scroll);
  float dist = fract(cellId.y / res.y * cellSize + head);
  float trailLen = 0.4 + (1.0 - act) * 0.3 + depth * 0.2;
  float trail = smoothstep(0.0, trailLen * 0.6, dist) * smoothstep(1.0, 1.0 - trailLen, dist);

  // Brightness with gentle pulsing
  float pulse = 0.85 + 0.15 * sin(u_time * 0.4 + colSeed * 6.28);
  float brightness = trail * (0.25 + 0.75 * charSeed) * (0.4 + depth * 0.6) * pulse;

  // Elegant glyph
  float g = glyph(cellUv, flickerSeed, depth);
  brightness *= g;

  // Head glow — soft bloom
  float headGlow = smoothstep(0.06, 0.0, abs(dist - 0.97)) * (1.2 + depth * 0.8);
  // Secondary afterglow trail
  float afterglow = smoothstep(0.15, 0.0, abs(dist - 0.92)) * 0.3 * depth;

  // Color — sentiment-driven: green (bull) ↔ red (bear) gradience
  float sent = u_sentiment; // -1 to +1
  float hueShift = colSeed * 0.12;

  // Bull: rich green. Bear: deep red. Neutral: classic matrix green.
  float bearMix = max(0.0, -sent); // 0 when bull, 1 when deep bear
  float bullMix = max(0.0, sent);  // 0 when bear, 1 when strong bull

  vec3 greenBase = vec3(0.06, 0.85 + depth * 0.15, 0.25 + hueShift);
  vec3 bearBase = vec3(0.85 + depth * 0.15, 0.08, 0.06);
  vec3 bullBase = vec3(0.04, 0.95 + depth * 0.05, 0.35 + hueShift);

  vec3 baseColor = mix(greenBase, bearBase, bearMix * 0.7);
  baseColor = mix(baseColor, bullBase, bullMix * 0.4);

  vec3 col = baseColor * brightness;

  // Head glow follows sentiment
  vec3 greenGlow = vec3(0.5, 1.0, 0.65);
  vec3 bearGlow = vec3(1.0, 0.5, 0.3);
  vec3 bullGlow = vec3(0.4, 1.0, 0.6);
  vec3 headColor = mix(greenGlow, bearGlow, bearMix * 0.6);
  headColor = mix(headColor, bullGlow, bullMix * 0.3);
  col += headColor * headGlow * g * depth;

  vec3 afterColor = mix(vec3(0.03, 0.4, 0.15), vec3(0.4, 0.08, 0.03), bearMix * 0.5);
  col += afterColor * afterglow;

  // Depth atmosphere
  col *= depth * (0.7 + depth * 0.3);

  // Pill tinting — preserves elegance
  if (u_pill > 0.5 && u_pill < 1.5) {
    vec3 redBase = vec3(0.9, 0.15, 0.08) * brightness * depth;
    vec3 redGlow = vec3(1.0, 0.4, 0.25) * headGlow * g;
    col = mix(col, redBase + redGlow, 0.45);
  } else if (u_pill > 1.5) {
    vec3 blueBase = vec3(0.08, 0.35, 0.95) * brightness * depth;
    vec3 blueGlow = vec3(0.25, 0.55, 1.0) * headGlow * g;
    col = mix(col, blueBase + blueGlow, 0.45);
  }

  // Mouse glow — soft and organic
  vec2 mousePos = u_mouse * res;
  float mouseDist = length(fragCoord - mousePos) / max(res.x, res.y);
  float mouseGlow = smoothstep(0.22, 0.0, mouseDist) * 0.18 * depth;
  float mouseRing = smoothstep(0.002, 0.0, abs(mouseDist - 0.12)) * 0.06 * depth;
  if (u_pill > 0.5 && u_pill < 1.5) { col += vec3(0.8, 0.1, 0.03) * (mouseGlow + mouseRing); }
  else if (u_pill > 1.5) { col += vec3(0.03, 0.25, 0.8) * (mouseGlow + mouseRing); }
  else {
    vec3 neutralGlow = mix(vec3(0.03, 0.6, 0.2), vec3(0.6, 0.08, 0.03), bearMix * 0.6);
    col += neutralGlow * (mouseGlow + mouseRing);
  }

  // Vignette — elegant darkening
  vec2 uv = fragCoord / res;
  float vig = 1.0 - 0.45 * pow(length(uv - 0.5) * 1.5, 2.2);
  col *= vig;

  // Fine scanlines
  col *= 0.94 + 0.06 * sin(fragCoord.y * 3.0);

  // Subtle CRT barrel
  float crt = 1.0 - 0.02 * dot(centered, centered);
  col *= crt;

  // Film grain — very subtle
  float grain = hash(fragCoord + u_time * 100.0) * 0.02;
  col += grain;

  gl_FragColor = vec4(col, 1.0);
}
`;
