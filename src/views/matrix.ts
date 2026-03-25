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
import { startPriceUpdates, formatPrice, formatMarketCap, getMarketActivity, getMarketSentiment, getMarketBreadth } from '../lib/prices';
import type { CoinPrice } from '../lib/prices';
import type { NetworkId } from '../types/wallet';
import { PriceOracle } from '../lib/x402/oracle';
import { truncateAddress } from '../lib/algorand/account';

type PillChoice = 'none' | 'choose' | 'red' | 'blue';

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

  // Pyramid — top winners and losers of the hour
  const pyramidLayer = el('div', { cls: 'parsec-matrix__pyramid' });
  container.appendChild(pyramidLayer);

  // Crypto glyph overlay layer (HTML on top of WebGL)
  const glyphLayer = el('div', { cls: 'parsec-matrix__glyph-layer' });
  container.appendChild(glyphLayer);

  // Price tooltip
  const tooltip = el('div', { cls: 'parsec-matrix__tooltip' });
  container.appendChild(tooltip);

  // ── Drag-and-drop utility for floating matrix elements ──
  function makeDraggable(element: HTMLElement) {
    let dragOffsetX = 0, dragOffsetY = 0;
    let elemDragging = false;

    const onDown = (clientX: number, clientY: number) => {
      elemDragging = true;
      const rect = element.getBoundingClientRect();
      dragOffsetX = clientX - rect.left;
      dragOffsetY = clientY - rect.top;
      element.style.cursor = 'grabbing';
      element.style.zIndex = '50';
    };

    const onMove = (clientX: number, clientY: number) => {
      if (!elemDragging) return;
      const x = clientX - dragOffsetX;
      const y = clientY - dragOffsetY;
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.right = 'auto';
      element.style.bottom = 'auto';
      element.style.transform = 'none';
    };

    const onUp = () => {
      elemDragging = false;
      element.style.cursor = '';
      element.style.zIndex = '';
    };

    element.addEventListener('mousedown', (e) => { e.stopPropagation(); onDown(e.clientX, e.clientY); });
    window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', onUp);
    element.addEventListener('touchstart', (e) => { e.stopPropagation(); const t = e.touches[0]; onDown(t.clientX, t.clientY); }, { passive: true });
    window.addEventListener('touchmove', (e) => { const t = e.touches[0]; onMove(t.clientX, t.clientY); }, { passive: true });
    window.addEventListener('touchend', onUp);
  }

  // ── PARSEC brand — click opens pill choice screen ──
  const brandEl = el('div', { cls: 'parsec-matrix__brand parsec-matrix__brand--floating', children: [
    el('span', { text: 'PARSEC' }),
  ]});
  brandEl.addEventListener('click', () => setPill('choose'));
  brandEl.style.cursor = 'pointer';
  makeDraggable(brandEl);
  container.appendChild(brandEl);

  // Panel — used for pill choice screen, diagnostics, and wallet login
  // Hidden on landing (choice === 'none'). Full-screen when active.
  const panel = el('div', { cls: 'parsec-matrix__panel' });
  container.appendChild(panel);

  // Zoom
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.max(0.3, Math.min(3.0, zoom + e.deltaY * -0.003));
    if (gl) setUniform('u_zoom', zoom);
    updateGlyphSizes();
  }, { passive: false });

  // Mouse + drag for bullet-time full rotation
  let mouseX = 0.5, mouseY = 0.5;
  let isDragging = false;
  let dragRotX = 0, dragRotY = 0; // accumulated rotation from drag
  let dragVelX = 0, dragVelY = 0; // momentum
  let lastDragMX = 0, lastDragMY = 0;

  container.addEventListener('mousemove', (e) => {
    mouseX = e.clientX / window.innerWidth;
    mouseY = 1.0 - e.clientY / window.innerHeight;
    if (gl) setUniform('u_mouse', mouseX, mouseY);
    checkGlyphHover(e.clientX, e.clientY);

    if (isDragging) {
      const dx = (e.clientX - lastDragMX) / window.innerWidth;
      const dy = (e.clientY - lastDragMY) / window.innerHeight;
      dragRotX += dx * 4.0;
      dragRotY += dy * 3.0;
      dragVelX = dx * 4.0;
      dragVelY = dy * 3.0;
      lastDragMX = e.clientX;
      lastDragMY = e.clientY;
    }
  });
  container.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('.parsec-matrix__panel')) return; // don't drag on UI
    isDragging = true;
    lastDragMX = e.clientX;
    lastDragMY = e.clientY;
    container.style.cursor = 'grabbing';
  });
  container.addEventListener('mouseup', () => { isDragging = false; container.style.cursor = ''; });
  container.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    mouseX = t.clientX / window.innerWidth;
    mouseY = 1.0 - t.clientY / window.innerHeight;
    if (gl) setUniform('u_mouse', mouseX, mouseY);
  }, { passive: true });

  container.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; isDragging = false; });

  // Casual realtime price updates — market activity drives shader speed
  const stopPrices = startPriceUpdates(p => {
    prices = p;
    activityUniform = getMarketActivity(p);
    sentimentUniform = getMarketSentiment(p);
    createGlyphs();
    renderPyramid();
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
  let glitchUniform = 0.0;    // 0 = normal, >0 = glitch intensity (spin + distort)
  let spinAngle = 0.0;        // current spin angle (radians, 0 to 2π for full spin)

  function setUniform(name: string, ...values: number[]) {
    if (!gl || !program) return;
    const loc = gl.getUniformLocation(program, name);
    if (!loc) return;
    if (values.length === 1) gl.uniform1f(loc, values[0]);
    else if (values.length === 2) gl.uniform2f(loc, values[0], values[1]);
  }

  function loadTexture(glCtx: WebGLRenderingContext, url: string, unit: number): WebGLTexture | null {
    const tex = glCtx.createTexture();
    if (!tex) return null;
    glCtx.activeTexture(glCtx.TEXTURE0 + unit);
    glCtx.bindTexture(glCtx.TEXTURE_2D, tex);
    // Placeholder 1x1 pixel until image loads
    glCtx.texImage2D(glCtx.TEXTURE_2D, 0, glCtx.RGBA, 1, 1, 0, glCtx.RGBA, glCtx.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      glCtx.activeTexture(glCtx.TEXTURE0 + unit);
      glCtx.bindTexture(glCtx.TEXTURE_2D, tex);
      glCtx.texImage2D(glCtx.TEXTURE_2D, 0, glCtx.RGBA, glCtx.RGBA, glCtx.UNSIGNED_BYTE, img);
      glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_S, glCtx.REPEAT);
      glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_T, glCtx.REPEAT);
      glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, glCtx.LINEAR);
      glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MAG_FILTER, glCtx.LINEAR);
    };
    img.src = url;
    return tex;
  }

  function initGL() {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERT); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, FRAG); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.warn('Fragment shader error:', gl.getShaderInfoLog(fs));
      return;
    }
    program = gl.createProgram()!;
    gl.attachShader(program, vs); gl.attachShader(program, fs);
    gl.linkProgram(program); gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    // Load glyph atlas (iChannel0) and noise texture (iChannel1)
    const glyphsUrl = new URL('../assets/matrix/glyphs.png', import.meta.url).href;
    const noiseUrl = new URL('../assets/matrix/noise.png', import.meta.url).href;
    loadTexture(gl, glyphsUrl, 0);
    loadTexture(gl, noiseUrl, 1);
    // Bind texture units to sampler uniforms
    const glyphLoc = gl.getUniformLocation(program, 'u_glyphs');
    const noiseLoc = gl.getUniformLocation(program, 'u_noise');
    if (glyphLoc) gl.uniform1i(glyphLoc, 0);
    if (noiseLoc) gl.uniform1i(noiseLoc, 1);

    resize(); window.addEventListener('resize', resize);
    startTime = performance.now(); frame();
    // Intro: glitch spin on first load
    triggerGlitchSpin(1.5);
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

    // Momentum decay when not dragging — bullet-time spin continues then slows
    if (!isDragging) {
      dragRotX += dragVelX;
      dragRotY += dragVelY;
      dragVelX *= 0.96; // friction
      dragVelY *= 0.96;
      if (Math.abs(dragVelX) < 0.0001) dragVelX = 0;
      if (Math.abs(dragVelY) < 0.0001) dragVelY = 0;
    }

    // Market breadth for shader
    const breadth = prices.length > 0 ? getMarketBreadth(prices) : { greenPct: 50, redPct: 50, flatPct: 0 };

    setUniform('u_time', t);
    setUniform('u_pill', pillUniform);
    setUniform('u_zoom', zoom);
    setUniform('u_mouse', mouseX, mouseY);
    setUniform('u_activity', activityUniform);
    setUniform('u_sentiment', sentimentUniform);
    setUniform('u_dragX', dragRotX);
    setUniform('u_dragY', dragRotY);
    setUniform('u_breadth', breadth.greenPct / 100.0);
    setUniform('u_glitch', glitchUniform);
    setUniform('u_spin', spinAngle);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    driftGlyphs(t);
    raf = requestAnimationFrame(frame);
  }

  // ── Glitch Spin Sequence ──────────────────────────────────────
  // Full 360° spin of the rain, then glitch flash to snap back.
  // Triggered on load (intro) and on pill choice transitions.
  function triggerGlitchSpin(duration = 1.2) {
    const spinStart = performance.now();
    const spinDuration = duration * 1000; // ms for full spin
    const glitchStart = spinDuration * 0.85; // glitch begins at 85% of spin
    const glitchDuration = spinDuration * 0.15;

    function animateSpin() {
      const elapsed = performance.now() - spinStart;
      const progress = Math.min(elapsed / spinDuration, 1.0);

      // Spin: ease-in-out full rotation (0 → 2π)
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      spinAngle = eased * Math.PI * 2;

      // Glitch: intense distortion at the end of spin, then snap to zero
      if (elapsed >= glitchStart) {
        const glitchProgress = (elapsed - glitchStart) / glitchDuration;
        // Sharp peak then decay: triangle wave
        glitchUniform = glitchProgress < 0.5
          ? glitchProgress * 2.0   // ramp up to 1.0
          : (1.0 - glitchProgress) * 2.0; // ramp down to 0.0
      } else {
        glitchUniform = 0.0;
      }

      if (progress < 1.0) {
        requestAnimationFrame(animateSpin);
      } else {
        // Reset — clean landing
        spinAngle = 0.0;
        glitchUniform = 0.0;
      }
    }
    requestAnimationFrame(animateSpin);
  }

  function cancelAnimation() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    stopPrices();
    if (glyphRotationTimer) clearInterval(glyphRotationTimer);
  }

  // ── Crypto Glyphs — riding the rain, entropy-selected from top 100 ──

  // How many icons visible at once
  const GLYPH_SLOTS = 10;
  let glyphRotationTimer: ReturnType<typeof setInterval> | null = null;

  // ── Featured assets: algorithm-driven majors + "just because" from config ──
  // Majors: top movers selected by algorithm (highest 24h gain)
  const MAJOR_SYMBOLS = new Set(['BTC', 'ETH', 'AVAX', 'ADA', 'ALGO', 'POL', 'XRP', 'SOL', 'DOT']);

  // "Just because": user's personal picks, configurable via VITE_JUST_BECAUSE env var
  // Default: POL,ALGO,ETH,BEAM,ZIL — override in .env: VITE_JUST_BECAUSE=POL,ALGO,ETH,BEAM,ZIL,LINK
  const JUST_BECAUSE_DEFAULT = 'POL,ALGO,ETH,BEAM,ZIL';
  const justBecauseEnv = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_JUST_BECAUSE || JUST_BECAUSE_DEFAULT;
  const JUST_BECAUSE = new Set(justBecauseEnv.split(',').map(s => s.trim().toUpperCase()).filter(Boolean));

  const FEATURED_SYMBOLS = new Set<string>();

  function createGlyphs() {
    glyphLayer.innerHTML = '';
    cryptoGlyphs = [];
    if (prices.length === 0) return;

    const pool = [...prices];
    const selected: CoinPrice[] = [];

    // "Just because" — always featured, separate from algorithm
    FEATURED_SYMBOLS.clear();
    const justBecauseCoins = pool.filter(c => JUST_BECAUSE.has(c.symbol));
    for (const c of justBecauseCoins) FEATURED_SYMBOLS.add(c.symbol);

    // Algorithm: top movers from majors (excluding "just because" to avoid duplicates)
    const otherMajors = pool.filter(c => MAJOR_SYMBOLS.has(c.symbol) && !JUST_BECAUSE.has(c.symbol))
      .sort((a, b) => b.change24h - a.change24h).slice(0, 3);
    for (const m of otherMajors) FEATURED_SYMBOLS.add(m.symbol);
    const majors = [...justBecauseCoins, ...otherMajors];

    // Always include all featured
    for (const coin of majors) {
      if (!selected.includes(coin)) selected.push(coin);
    }

    // Fill remaining slots randomly — exclude junk tokens
    const glyphExclude = new Set([
      'USDS', 'USDE', 'FIGR_HELOC', 'WBTC', 'WETH', 'STETH', 'WSTETH', 'CBETH', 'RETH', 'WEETH',
      'LEO', 'OKB', 'CRO', 'KCS', 'HT', 'GT', 'FTT',
    ]);
    const remaining = pool.filter(c => !selected.includes(c) && !glyphExclude.has(c.symbol) && c.marketCap > 50_000_000);
    while (selected.length < GLYPH_SLOTS && remaining.length > 0) {
      const idx = Math.floor(Math.random() * remaining.length);
      selected.push(remaining.splice(idx, 1)[0]);
    }

    // Grid-based placement — track occupied zones to prevent overlap
    const occupied: { x: number; y: number }[] = [];
    const minGap = 0.14; // 14% of screen between icons — generous spacing

    function findOpenSpot(preferred?: { x: number; y: number }): { x: number; y: number } {
      if (preferred) {
        const tooClose = occupied.some(o => Math.abs(o.x - preferred.x) < minGap && Math.abs(o.y - preferred.y) < minGap);
        if (!tooClose) { occupied.push(preferred); return preferred; }
      }
      for (let attempt = 0; attempt < 50; attempt++) {
        // Right side only (65%-97%) — left side reserved for top 10 + stablecoin basket
        const tx = 0.65 + Math.random() * 0.32;
        const ty = 0.06 + Math.random() * 0.64; // 6%-70%
        // Skip if too close to any existing glyph
        const collision = occupied.some(o => Math.abs(o.x - tx) < minGap && Math.abs(o.y - ty) < minGap);
        if (!collision) { occupied.push({ x: tx, y: ty }); return { x: tx, y: ty }; }
      }
      // Fallback — right column
      const fx = 0.80 + Math.random() * 0.17;
      const fy = 0.06 + Math.random() * 0.55;
      occupied.push({ x: fx, y: fy });
      return { x: fx, y: fy };
    }

    for (let i = 0; i < selected.length; i++) {
      const coin = selected[i];
      const vol = Math.abs(coin.change24h);
      const volFactor = Math.min(1.0, vol / 5.0);
      const isFeatured = FEATURED_SYMBOLS.has(coin.symbol);

      // Featured: spread down the right side column with generous spacing
      // Staggered: alternate between x=0.72 and x=0.88, descend vertically
      let pos: { x: number; y: number };
      if (isFeatured) {
        const fIdx = [...FEATURED_SYMBOLS].indexOf(coin.symbol);
        const fx = fIdx % 2 === 0 ? 0.73 : 0.88; // zigzag left-right within right zone
        const fy = 0.06 + fIdx * 0.11;            // 11% vertical gap between each
        pos = findOpenSpot({ x: fx, y: fy });
      } else {
        pos = findOpenSpot();
      }
      const x = pos.x;
      const y = pos.y;
      const depth = isFeatured ? 0.8 + Math.random() * 0.2 : 0.3 + Math.random() * 0.7;
      // Featured coins are significantly larger
      const baseSize = isFeatured
        ? (24 + volFactor * 12 + depth * 6) * zoom
        : (12 + volFactor * 10 + depth * 6) * zoom;
      const baseOpacity = isFeatured
        ? 0.25 + volFactor * 0.35 + depth * 0.15
        : 0.06 + volFactor * 0.25 + depth * 0.1;

      const glyph: CryptoGlyph = { coin, x, y, size: baseSize };
      cryptoGlyphs.push(glyph);

      // Color — featured coins get richer color, others subtle
      const featuredBoost = isFeatured ? 1.4 : 1.0;
      const color = coin.change24h > 0.3
        ? `rgba(16,255,90,${baseOpacity * featuredBoost})`
        : coin.change24h < -0.3
          ? `rgba(255,80,80,${baseOpacity * featuredBoost})`
          : `rgba(200,210,220,${baseOpacity * 0.5 * featuredBoost})`;

      // Price display inline with symbol
      const changeSign = coin.change24h >= 0 ? '+' : '';
      const changeColor = coin.change24h >= 0 ? '#10b981' : '#ef4444';

      const glyphEl = el('div', {
        cls: `parsec-matrix__crypto-glyph ${volFactor > 0.3 ? 'parsec-matrix__crypto-glyph--volatile' : ''}`,
        attrs: {
          'data-coin': coin.id,
          style: `left:${x * 100}%;top:${y * 100}%;font-size:${baseSize}px;color:${color};text-shadow:0 0 ${4 + volFactor * 16}px ${color};z-index:${Math.round(depth * 10)}`,
        },
        children: [
          el('span', { cls: 'parsec-matrix__glyph-symbol', text: coin.symbol }),
          el('span', { cls: 'parsec-matrix__glyph-price', text: formatPrice(coin.usd), attrs: { style: `color:${color}` } }),
          el('span', { cls: 'parsec-matrix__glyph-change', text: `${changeSign}${coin.change24h.toFixed(1)}%`, attrs: { style: `color:${changeColor}` } }),
        ],
      });

      // Hover info panel on floating glyphs too
      glyphEl.addEventListener('mouseenter', () => showCoinPanel(coin, glyphEl));
      glyphEl.addEventListener('mouseleave', () => hideCoinPanel());

      glyphLayer.appendChild(glyphEl);
    }

    // Rotate selection every 20 seconds — new random coins surface
    if (glyphRotationTimer) clearInterval(glyphRotationTimer);
    glyphRotationTimer = setInterval(() => {
      if (prices.length > GLYPH_SLOTS) createGlyphs();
    }, 20000);
  }

  function updateGlyphSizes() {
    const glyphs = glyphLayer.querySelectorAll('.parsec-matrix__crypto-glyph');
    cryptoGlyphs.forEach((g, i) => {
      const glyphEl = glyphs[i] as HTMLElement;
      if (glyphEl) glyphEl.style.fontSize = `${g.size * zoom}px`;
    });
  }

  function driftGlyphs(t: number) {
    const glyphs = glyphLayer.querySelectorAll('.parsec-matrix__crypto-glyph');
    cryptoGlyphs.forEach((cg, i) => {
      const glyphEl = glyphs[i] as HTMLElement;
      if (!glyphEl) return;

      const change = cg.coin.change24h;
      const absChange = Math.abs(change);

      // Y position driven by price change:
      // Up = floats higher on screen, down = sinks lower
      // Flat = hangs at original position, drifting sideways
      const changeClamped = Math.max(-15, Math.min(15, change));
      const baseY = cg.y * 100; // original slot
      const priceY = baseY - changeClamped * 1.5; // up = higher, down = lower
      // Coins stay above the ship/buy zone (max 72%)
      const targetY = Math.max(5, Math.min(72, priceY));

      // Gentle sideways float — all coins drift horizontally
      const sway = Math.sin(t * 0.15 + i * 2.3) * (3 + absChange * 0.5);

      // Depth perspective
      const rotPhase = t * 0.008;
      const depthShift = Math.sin(rotPhase + cg.x * 3.14) * 0.1;
      const perspScale = 0.9 + depthShift;

      // Gentle vertical bob — not a bounce, a breath
      const bob = Math.sin(t * 0.2 + i * 1.7) * 2;

      glyphEl.style.top = `${targetY}%`;
      glyphEl.style.transform = `translateX(${sway}px) translateY(${bob}px) scale(${perspScale})`;
    });
  }

  // ── Pyramid — top coin at apex, winners right, losers left ──

  function renderPyramid() {
    pyramidLayer.innerHTML = '';
    if (prices.length < 10) return;

    // Filter out stablecoins, wrapped tokens, and junk from the pyramid
    const pyramidExclude = new Set([
      'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD', 'USDP', 'GUSD', 'FRAX', 'LUSD', 'USDS', 'USDE',
      'PAXG', 'XAUT', 'WBTC', 'WETH', 'STETH', 'WSTETH', 'CBETH', 'RETH', 'WEETH',
      'LEO', 'OKB', 'CRO', 'KCS', 'HT', 'GT', 'FTT', 'FIGR_HELOC',
    ]);
    const pyramidPrices = prices.filter(c => !pyramidExclude.has(c.symbol) && c.marketCap > 100_000_000);
    const sorted = [...pyramidPrices].sort((a, b) => b.change24h - a.change24h);
    if (sorted.length === 0) return;
    const topWinner = sorted[0];

    const winners = sorted.filter(c => c.change24h > 0);
    const losers = sorted.filter(c => c.change24h <= 0).reverse();

    // ── Pyramid — brick steps from single apex to wide base ──
    // Apex = #1 daily gainer (single point at top)
    // Right side = top gainers descending (best → least gain)
    // Left side = top losers descending (worst → least loss)
    // Each row is one step wider — like bricks of a pyramid
    //
    // Visual:
    //                  [#1 GAINER]               ← apex (1 brick)
    //              [LOSER1] [GAINER2]            ← row 1 (2 bricks)
    //           [L2] [GAINER3] [GAINER4]         ← row 2 (3 bricks)
    //        [L3] [L4] [GAIN5] [GAIN6]           ← row 3 (4 bricks)
    //     [L5] [L6] [L7] [GAIN7] [GAIN8]        ← row 4 (5 bricks)
    //  [L8] [L9] [remaining...] [GAIN9] [G10]   ← base (widest)

    const pyramid = el('div', { cls: 'parsec-pyramid__body' });

    // Top 4 gainers (sorted best first) and top 4 losers (sorted worst first)
    const top4Gainers = winners.slice(0, 4);
    const top4Losers = losers.slice(0, 4);
    const remainWinners = winners.slice(4);
    const remainLosers = losers.slice(4);

    // Row 0: APEX — single brick, #1 daily gainer
    const apexRow = el('div', { cls: 'parsec-pyramid__row parsec-pyramid__row--apex' });
    apexRow.appendChild(pyramidCoinCard(topWinner, true));
    pyramid.appendChild(apexRow);

    // Rows 1-7: Each row adds one more brick, expanding from apex to base
    // Right side fills with gainers (descending rank), left side with losers
    let lIdx = 0; // index into top4Losers
    let rgIdx = 0; // remaining gainers
    let rlIdx = 0; // remaining losers

    // Skip the apex gainer (already placed)
    const gainersForRows = top4Gainers.slice(1);
    let giIdx = 0;

    const totalRows = 7;
    for (let r = 1; r <= totalRows; r++) {
      const bricksInRow = r + 1; // row 1 = 2 bricks, row 2 = 3, ... row 7 = 8
      const row = el('div', { cls: 'parsec-pyramid__row' });

      // Width scales from narrow (top) to wide (base)
      // Row 1 = 20%, row 7 = 92%
      const widthPct = 14 + r * 11.5;
      row.style.width = `${widthPct}%`;
      row.style.maxWidth = `${widthPct}%`;

      // Split: left half = losers, right half = gainers
      // Losers go on the left, gainers on the right
      const leftCount = Math.floor(bricksInRow / 2);
      const rightCount = bricksInRow - leftCount;

      // Fill left side with losers
      for (let i = 0; i < leftCount; i++) {
        let coin: CoinPrice | undefined;
        if (lIdx < top4Losers.length) {
          coin = top4Losers[lIdx++];
        } else if (rlIdx < remainLosers.length) {
          coin = remainLosers[rlIdx++];
        }
        if (coin) {
          row.appendChild(pyramidCoinCard(coin, false));
        }
      }

      // Fill right side with gainers
      for (let i = 0; i < rightCount; i++) {
        let coin: CoinPrice | undefined;
        if (giIdx < gainersForRows.length) {
          coin = gainersForRows[giIdx++];
        } else if (rgIdx < remainWinners.length) {
          coin = remainWinners[rgIdx++];
        }
        if (coin) {
          row.appendChild(pyramidCoinCard(coin, false));
        }
      }

      pyramid.appendChild(row);
    }

    // Base row — any remaining coins that didn't fit
    const baseCoins: CoinPrice[] = [];
    while (rgIdx < remainWinners.length) baseCoins.push(remainWinners[rgIdx++]);
    while (rlIdx < remainLosers.length) baseCoins.push(remainLosers[rlIdx++]);

    if (baseCoins.length > 0) {
      const baseRow = el('div', { cls: 'parsec-pyramid__row parsec-pyramid__row--base' });
      baseRow.style.width = '96%';
      baseRow.style.maxWidth = '96%';
      baseCoins.forEach(coin => baseRow.appendChild(pyramidCoinCard(coin, false)));
      pyramid.appendChild(baseRow);
    }

    pyramidLayer.appendChild(pyramid);

    // Triangle edge lines behind the rows
    pyramidLayer.appendChild(pyramidLine(50, 0, 96, 58, 'rgba(16,185,129,0.1)'));
    pyramidLayer.appendChild(pyramidLine(50, 0, 4, 58, 'rgba(239,68,68,0.1)'));

    // ── Stablecoin Ship — liquidity vessel floating at the bottom ──
    const stableNames = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD', 'USDP', 'GUSD', 'FRAX', 'LUSD', 'PAXG', 'XAUT']);
    const stables = prices.filter(c => stableNames.has(c.symbol));
    if (stables.length > 0) {
      // Total liquidity across all stablecoins
      const totalLiquidity = stables.reduce((s, c) => s + c.marketCap, 0);

      const ship = el('div', { cls: 'parsec-ship' });

      // Ship hull — the vessel
      const hull = el('div', { cls: 'parsec-ship__hull' });

      // Mast — total liquidity display
      hull.appendChild(el('div', {
        cls: 'parsec-ship__mast',
        children: [
          el('div', { cls: 'parsec-ship__flag', text: formatMarketCap(totalLiquidity) }),
          el('div', { cls: 'parsec-ship__flag-label', text: 'STABLECOIN LIQUIDITY' }),
        ],
      }));

      // Deck — stablecoins as cargo
      const deck = el('div', { cls: 'parsec-ship__deck' });
      stables.sort((a, b) => b.marketCap - a.marketCap);
      stables.forEach(coin => {
        const isGold = coin.symbol === 'PAXG' || coin.symbol === 'XAUT';
        // Width proportional to market cap share
        const share = coin.marketCap / totalLiquidity;
        const widthPct = Math.max(4, Math.round(share * 100));

        deck.appendChild(el('div', {
          cls: `parsec-ship__cargo ${isGold ? 'parsec-ship__cargo--gold' : ''}`,
          attrs: {
            style: `flex-basis:${widthPct}%`,
            title: `${coin.symbol} — ${formatMarketCap(coin.marketCap)} (${(share * 100).toFixed(1)}% of stablecoin liquidity)`,
          },
          children: [
            el('span', { cls: 'parsec-ship__cargo-symbol', text: coin.symbol }),
            el('span', { cls: 'parsec-ship__cargo-cap', text: formatMarketCap(coin.marketCap) }),
          ],
        }));
      });
      hull.appendChild(deck);

      // Water line
      hull.appendChild(el('div', { cls: 'parsec-ship__waterline' }));

      ship.appendChild(hull);
      makeDraggable(ship);
      pyramidLayer.appendChild(ship);
    }

    // ── Top 10 by market cap — vertical column down the left side ──
    const excludeFromFleet = new Set([
      'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD', 'USDP', 'GUSD', 'FRAX', 'LUSD', 'USDS', 'USDE',
      'PAXG', 'XAUT', 'WBTC', 'WETH', 'STETH', 'WSTETH', 'CBETH', 'RETH', 'WEETH',
      'LEO', 'OKB', 'CRO', 'KCS', 'HT', 'GT', 'FTT', 'FIGR_HELOC',
    ]);
    const fleetCoins = prices
      .filter(c => !excludeFromFleet.has(c.symbol))
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, 10);

    // All 10 assets in one vertical column on the left side
    if (fleetCoins.length > 0) {
      const fleet = el('div', { cls: 'parsec-fleet-column' });
      fleet.appendChild(el('div', { cls: 'parsec-fleet-column__header', text: 'TOP 10' }));

      fleetCoins.forEach((coin, i) => {
        const sign = coin.change24h >= 0 ? '+' : '';
        const color = coin.change24h >= 0 ? '#10b981' : '#ef4444';
        const isAlgo = coin.symbol === 'ALGO';
        const rank = i + 1;

        // Icon
        let iconEl: HTMLElement;
        if (coin.image) {
          const img = document.createElement('img');
          img.className = 'parsec-fleet-column__icon';
          img.src = coin.image;
          img.alt = coin.symbol;
          img.width = 18;
          img.height = 18;
          img.loading = 'lazy';
          img.onerror = () => { img.style.display = 'none'; };
          iconEl = img;
        } else {
          iconEl = el('div', {
            cls: 'parsec-fleet-column__icon parsec-fleet-column__icon--fallback',
            text: coin.symbol.charAt(0),
          });
        }

        const row = el('div', {
          cls: `parsec-fleet-column__coin ${isAlgo ? 'parsec-fleet-column__coin--algo' : ''}`,
          children: [
            el('span', { cls: 'parsec-fleet-column__rank', text: `${rank}` }),
            iconEl,
            el('span', { cls: 'parsec-fleet-column__symbol', text: coin.symbol }),
            el('span', { cls: 'parsec-fleet-column__price', text: formatPrice(coin.usd) }),
            el('span', { cls: 'parsec-fleet-column__mcap', text: formatMarketCap(coin.marketCap) }),
            el('span', { cls: 'parsec-fleet-column__change', text: `${sign}${coin.change24h.toFixed(1)}%`, attrs: { style: `color:${color}` } }),
          ],
        });

        // Hover: show coin panel
        row.addEventListener('mouseenter', () => showCoinPanel(coin, row));
        row.addEventListener('mouseleave', () => hideCoinPanel());

        fleet.appendChild(row);
      });

      makeDraggable(fleet);
      pyramidLayer.appendChild(fleet);
    }

  }

  function pyramidCoinCard(coin: CoinPrice, isApex: boolean): HTMLElement {
    const isUp = coin.change24h >= 0;
    const color = isUp ? '#10b981' : '#ef4444';
    const sign = isUp ? '+' : '';
    const cls = isApex ? 'parsec-pyramid__card parsec-pyramid__card--apex' : 'parsec-pyramid__card';

    // Icon: CoinGecko image or fallback colored circle
    let iconEl: HTMLElement;
    if (coin.image) {
      const img = document.createElement('img');
      img.className = 'parsec-pyramid__card-icon';
      img.src = coin.image;
      img.alt = coin.symbol;
      img.width = isApex ? 24 : 16;
      img.height = isApex ? 24 : 16;
      img.loading = 'lazy';
      img.onerror = () => { img.style.display = 'none'; };
      iconEl = img;
    } else {
      iconEl = el('div', {
        cls: 'parsec-pyramid__card-icon parsec-pyramid__card-icon--fallback',
        text: coin.symbol.charAt(0),
        attrs: { style: `background:${color}33;color:${color};width:${isApex ? 24 : 16}px;height:${isApex ? 24 : 16}px` },
      });
    }

    const cardEl = el('div', {
      cls,
      children: [
        iconEl,
        el('div', { cls: 'parsec-pyramid__card-symbol', text: coin.symbol }),
        el('div', { cls: 'parsec-pyramid__card-price', text: formatPrice(coin.usd) }),
        el('div', { cls: 'parsec-pyramid__card-change', text: `${sign}${coin.change24h.toFixed(1)}%`, attrs: { style: `color:${color}` } }),
      ],
    });

    // Hover: scale up + glow
    cardEl.addEventListener('mouseenter', () => {
      showCoinPanel(coin, cardEl);
      cardEl.style.transform = 'scale(1.3)';
      cardEl.style.zIndex = '50';
      cardEl.style.boxShadow = `0 0 20px ${color}40`;
      cardEl.style.borderColor = `${color}60`;
    });
    cardEl.addEventListener('mouseleave', () => {
      hideCoinPanel();
      cardEl.style.transform = '';
      cardEl.style.zIndex = '';
      cardEl.style.boxShadow = '';
      cardEl.style.borderColor = '';
    });

    // Touch support
    cardEl.addEventListener('touchstart', (e) => {
      e.preventDefault();
      showCoinPanel(coin, cardEl);
      cardEl.style.transform = 'scale(1.3)';
      cardEl.style.boxShadow = `0 0 20px ${color}40`;
    }, { passive: false });
    cardEl.addEventListener('touchend', () => {
      hideCoinPanel();
      cardEl.style.transform = '';
      cardEl.style.boxShadow = '';
    });

    return cardEl;
  }

  function pyramidCoin(coin: CoinPrice, xPct: number, yPct: number, scale: number, isApex: boolean, opacity = 1): HTMLElement {
    const isUp = coin.change24h >= 0;
    const color = isUp ? '#10b981' : '#ef4444';
    const sign = isUp ? '+' : '';
    const cls = isApex ? 'parsec-pyramid__coin parsec-pyramid__coin--apex' : 'parsec-pyramid__coin';

    const coinEl = el('div', {
      cls,
      attrs: {
        style: `left:${xPct}%;top:${yPct}%;transform:translate(-50%,-50%) scale(${scale});opacity:${opacity}`,
      },
      children: [
        el('div', { cls: 'parsec-pyramid__symbol', text: coin.symbol }),
        el('div', { cls: 'parsec-pyramid__price', text: formatPrice(coin.usd) }),
        el('div', { cls: 'parsec-pyramid__change', text: `${sign}${coin.change24h.toFixed(1)}%`, attrs: { style: `color:${color}` } }),
      ],
    });

    // Hover info panel — expands on hover, pushes neighbors away
    coinEl.addEventListener('mouseenter', () => {
      // Show expanded info card
      showCoinPanel(coin, coinEl);
      // Push nearby pyramid coins away for isolation
      coinEl.style.zIndex = '50';
      coinEl.style.transform = `translate(-50%,-50%) scale(${scale * 1.5})`;
    });
    coinEl.addEventListener('mouseleave', () => {
      hideCoinPanel();
      coinEl.style.zIndex = '';
      coinEl.style.transform = `translate(-50%,-50%) scale(${scale})`;
    });

    return coinEl;
  }

  // ── Hover info panel — detailed coin card ──────────────────

  let activeCoinPanel: HTMLElement | null = null;

  function showCoinPanel(coin: CoinPrice, anchor: HTMLElement) {
    hideCoinPanel();
    const isUp = coin.change24h >= 0;
    const sign = isUp ? '+' : '';
    const color = isUp ? '#10b981' : '#ef4444';

    const panel = el('div', {
      cls: 'parsec-coinpanel',
      children: [
        el('div', { cls: 'parsec-coinpanel__header', children: [
          el('span', { cls: 'parsec-coinpanel__symbol', text: coin.symbol }),
          el('span', { cls: 'parsec-coinpanel__name', text: coin.id.replace(/-/g, ' ') }),
        ]}),
        el('div', { cls: 'parsec-coinpanel__price', text: formatPrice(coin.usd) }),
        el('div', { cls: 'parsec-coinpanel__change', text: `${sign}${coin.change24h.toFixed(2)}%`, attrs: { style: `color:${color}` } }),
        el('div', { cls: 'parsec-coinpanel__cap', text: `Market Cap: ${formatMarketCap(coin.marketCap)}` }),
        el('div', { cls: 'parsec-coinpanel__links', children: [
          el('a', { text: 'CoinGecko', cls: 'parsec-asset-link', attrs: { href: `https://www.coingecko.com/en/coins/${coin.id}`, target: '_blank', rel: 'noopener' } }),
          el('a', { text: 'Chart', cls: 'parsec-asset-link', attrs: { href: `https://www.coingecko.com/en/coins/${coin.id}#panel`, target: '_blank', rel: 'noopener' } }),
        ]}),
      ],
    });

    // Position near the anchor
    const rect = anchor.getBoundingClientRect();
    const panelX = Math.min(rect.left, window.innerWidth - 200);
    const panelY = Math.max(rect.top - 120, 10);
    panel.style.left = `${panelX}px`;
    panel.style.top = `${panelY}px`;

    document.body.appendChild(panel);
    activeCoinPanel = panel;
  }

  function hideCoinPanel() {
    if (activeCoinPanel) {
      activeCoinPanel.remove();
      activeCoinPanel = null;
    }
  }

  function pyramidLine(x1: number, y1: number, x2: number, y2: number, color: string): HTMLElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'parsec-pyramid__line');
    svg.setAttribute('viewBox', '0 0 100 50');
    svg.setAttribute('preserveAspectRatio', 'none');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(x1));
    line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2));
    line.setAttribute('y2', String(y2));
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '0.15');
    line.setAttribute('stroke-opacity', '0.3');
    svg.appendChild(line);
    return svg as unknown as HTMLElement;
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
    // Shader pill tint: 0 = green (landing/choose), 1 = red, 2 = blue
    pillUniform = p === 'red' ? 1.0 : p === 'blue' ? 2.0 : 0.0;
    // Glitch spin on every transition
    triggerGlitchSpin(0.8);

    if (p === 'none') {
      // Landing — hide panel, show everything
      panel.style.display = 'none';
      panel.classList.remove('parsec-matrix__panel--fullscreen');
      brandEl.style.display = '';
      pyramidLayer.style.display = '';
      glyphLayer.style.display = '';
      // Restore pyramid bricks that were hidden
      const pyramidBody = pyramidLayer.querySelector('.parsec-pyramid__body') as HTMLElement;
      const pyramidLines = pyramidLayer.querySelectorAll('.parsec-pyramid__line');
      if (pyramidBody) pyramidBody.style.display = '';
      pyramidLines.forEach(l => (l as HTMLElement).style.display = '');
    } else {
      // Pill choice / blue / red — panel over rain
      // Hide pyramid but keep floating glyphs (right side) and top 10 column (left side)
      panel.style.display = '';
      panel.classList.add('parsec-matrix__panel--fullscreen');
      brandEl.style.display = 'none';
      // Hide pyramid bricks only — keep top 10 column, ship, and glyphs
      const pyramidBody = pyramidLayer.querySelector('.parsec-pyramid__body') as HTMLElement;
      const pyramidLines = pyramidLayer.querySelectorAll('.parsec-pyramid__line');
      if (pyramidBody) pyramidBody.style.display = 'none';
      pyramidLines.forEach(l => (l as HTMLElement).style.display = 'none');
      // Glyphs (floating assets) and top 10 column stay visible
      glyphLayer.style.display = '';
    }

    renderPanel();
  }

  // ── Panel Rendering ─────────────────────────────────────────

  function renderPanel() {
    panel.innerHTML = '';

    if (choice === 'none') return; // landing — panel is hidden
    if (choice === 'choose') return renderPillChoice();
    if (choice === 'blue') return renderBluePill();
    if (choice === 'red') return renderRedPill();
  }

  function renderPillChoice() {
    // Full-screen: blue pill and red pill, nothing else, with return to landing
    panel.appendChild(el('div', { cls: 'parsec-matrix__pill-screen', children: [
      el('div', { cls: 'parsec-matrix__pill-screen-brand', text: 'PARSEC' }),
      el('p', { cls: 'parsec-matrix__tagline', text: 'Choose your path' }),
      el('div', { cls: 'parsec-matrix__pills', children: [
        el('div', {
          cls: 'parsec-matrix__pill parsec-matrix__pill--blue',
          onClick: () => setPill('blue'),
          children: [
            el('div', { cls: 'parsec-matrix__pill-capsule' }),
            el('div', { cls: 'parsec-matrix__pill-label', text: 'Blue Pill' }),
            el('div', { cls: 'parsec-matrix__pill-desc', text: 'Diagnostics' }),
          ],
        }),
        el('div', {
          cls: 'parsec-matrix__pill parsec-matrix__pill--red',
          onClick: () => setPill('red'),
          children: [
            el('div', { cls: 'parsec-matrix__pill-capsule' }),
            el('div', { cls: 'parsec-matrix__pill-label', text: 'Red Pill' }),
            el('div', { cls: 'parsec-matrix__pill-desc', text: 'Live wallet' }),
          ],
        }),
      ]}),
      el('p', { cls: 'parsec-matrix__footer-text', text: 'Safe to walk away. No session active.' }),
      el('div', { cls: 'parsec-matrix__back', children: [
        el('a', { text: 'Return to Matrix', attrs: { href: '#' }, onClick: (e) => { e.preventDefault(); setPill('none'); } }),
      ]}),
    ]}));
  }

  function renderBluePill() {
    panel.appendChild(el('div', { cls: 'parsec-matrix__choice-label parsec-matrix__choice-label--blue', text: 'BLUE PILL — DIAGNOSTICS' }));
    panel.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'Network intelligence. DeFi liquidity. No signing authority.' }));
    const state = store.get();

    // ── Network Activity Feed ──
    const netFeed = el('div', { cls: 'parsec-matrix__netfeed' });
    const netLog = el('div', { cls: 'parsec-matrix__netlog' });
    netFeed.appendChild(el('div', { cls: 'parsec-matrix__netfeed-header', children: [
      el('span', { cls: 'parsec-matrix__netfeed-dot' }),
      el('span', { text: 'Network Activity' }),
    ]}));
    netFeed.appendChild(netLog);
    panel.appendChild(netFeed);

    logNet(netLog, 'INIT', `Parsec v0.1.0 — ${state.settings.network}`);
    logNet(netLog, 'NODE', `Algod: ${state.settings.network}-api.algonode.cloud`);
    logNet(netLog, 'NODE', `Indexer: ${state.settings.network}-idx.algonode.cloud`);

    // ── DeFi Llama + Market Diagnostics ──
    const defiBox = el('div', { cls: 'parsec-matrix__diag parsec-matrix__diag--defi' });
    defiBox.appendChild(el('div', { cls: 'parsec-matrix__diag-loading', text: 'Fetching DeFi data...' }));
    panel.appendChild(defiBox);
    loadDefiDiagnostics(defiBox, netLog);

    // ── Market Overview (from CoinGecko prices already loaded) ──
    if (prices.length > 0) {
      logNet(netLog, 'PRICE', `${prices.length} coins tracked — CoinGecko free tier`);
      const topMover = [...prices].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))[0];
      if (topMover) {
        const dir = topMover.change24h >= 0 ? '+' : '';
        logNet(netLog, 'MOVER', `${topMover.symbol} ${dir}${topMover.change24h.toFixed(2)}% (24h)`);
      }

      const marketBox = el('div', { cls: 'parsec-matrix__diag parsec-matrix__diag--market' });
      const breadth = getMarketBreadth(prices);
      const totalCap = prices.reduce((s, c) => s + c.marketCap, 0);
      const btc = prices.find(p => p.symbol === 'BTC');
      const btcDom = btc ? ((btc.marketCap / totalCap) * 100).toFixed(1) : '—';

      marketBox.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'MARKET OVERVIEW' }));
      marketBox.appendChild(diagRow('Total Market Cap', formatMarketCap(totalCap)));
      marketBox.appendChild(diagRow('BTC Dominance', `${btcDom}%`));
      marketBox.appendChild(diagRow('Green / Red / Flat', `${breadth.greenPct}% / ${breadth.redPct}% / ${breadth.flatPct}%`));
      marketBox.appendChild(diagRow('Volatility Index', `${(getMarketActivity(prices) * 100).toFixed(0)}%`));
      marketBox.appendChild(diagRow('Sentiment', sentimentUniform > 0 ? `Bullish (${(sentimentUniform * 100).toFixed(0)}%)` : sentimentUniform < 0 ? `Bearish (${(Math.abs(sentimentUniform) * 100).toFixed(0)}%)` : 'Neutral'));

      panel.appendChild(marketBox);
    }

    // ── Portfolio Diagnostics (if accounts exist) ──
    if (state.accounts.length > 0) {
      const diagBox = el('div', { cls: 'parsec-matrix__diag' });
      diagBox.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'PORTFOLIO DIAGNOSTICS' }));
      panel.appendChild(diagBox);
      loadDiagnostics(diagBox, state.accounts, state.settings.network, netLog);

      const diagRefresh = setInterval(() => {
        if (choice !== 'blue') { clearInterval(diagRefresh); return; }
        logNet(netLog, 'SYNC', 'auto-refresh');
        loadDiagnostics(diagBox, state.accounts, state.settings.network, netLog);
      }, 30000);
    } else {
      logNet(netLog, 'WAIT', 'No accounts — import a public address for portfolio data');
      panel.appendChild(btn('Import Watch-Only Address', { outlined: true, cls: 'parsec-matrix__action', onClick: () => { cancelAnimation(); store.navigate('import-wallet'); } }));
    }

    backButton();
  }

  function diagRow(label: string, value: string): HTMLElement {
    return el('div', { cls: 'parsec-matrix__diag-row', children: [
      el('span', { cls: 'parsec-matrix__diag-row-label', text: label }),
      el('span', { cls: 'parsec-matrix__diag-row-value', text: value }),
    ]});
  }

  async function loadDefiDiagnostics(container: HTMLElement, netLog: HTMLElement) {
    container.innerHTML = '';
    container.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'DEFI LIQUIDITY' }));

    // ── DeFi Llama: Total TVL ──
    try {
      logNet(netLog, 'FETCH', 'DeFi Llama — global TVL');
      const tvlRes = await fetch('https://api.llama.fi/v2/historicalChainTvl', { signal: AbortSignal.timeout(8000) });
      if (tvlRes.ok) {
        const tvlData = await tvlRes.json() as Array<{ date: number; tvl: number }>;
        const latest = tvlData[tvlData.length - 1];
        const prev = tvlData[tvlData.length - 2];
        const tvlChange = prev ? ((latest.tvl - prev.tvl) / prev.tvl * 100).toFixed(2) : '—';
        container.appendChild(diagRow('Global TVL', formatMarketCap(latest.tvl)));
        container.appendChild(diagRow('TVL 24h Change', `${Number(tvlChange) >= 0 ? '+' : ''}${tvlChange}%`));
        logNet(netLog, 'OK', `Global TVL: ${formatMarketCap(latest.tvl)}`);
      }
    } catch { logNet(netLog, 'WARN', 'DeFi Llama TVL unavailable'); }

    // ── DeFi Llama: Algorand TVL ──
    try {
      logNet(netLog, 'FETCH', 'DeFi Llama — Algorand TVL');
      const algoRes = await fetch('https://api.llama.fi/v2/historicalChainTvl/Algorand', { signal: AbortSignal.timeout(8000) });
      if (algoRes.ok) {
        const algoData = await algoRes.json() as Array<{ date: number; tvl: number }>;
        const latest = algoData[algoData.length - 1];
        container.appendChild(diagRow('Algorand TVL', formatMarketCap(latest.tvl)));
        logNet(netLog, 'OK', `Algorand TVL: ${formatMarketCap(latest.tvl)}`);
      }
    } catch { logNet(netLog, 'WARN', 'Algorand TVL unavailable'); }

    // ── DeFi Llama: Top protocols on Algorand ──
    try {
      logNet(netLog, 'FETCH', 'DeFi Llama — Algorand protocols');
      const protoRes = await fetch('https://api.llama.fi/protocols', { signal: AbortSignal.timeout(10000) });
      if (protoRes.ok) {
        const protocols = await protoRes.json() as Array<{ name: string; tvl: number; chain: string; chains: string[]; category: string }>;
        const algoProtos = protocols
          .filter(p => p.chains && p.chains.includes('Algorand') && p.tvl > 0)
          .sort((a, b) => b.tvl - a.tvl)
          .slice(0, 5);

        if (algoProtos.length > 0) {
          container.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Top Algorand Protocols' }));
          algoProtos.forEach(p => {
            container.appendChild(diagRow(`${p.name} (${p.category})`, formatMarketCap(p.tvl)));
          });
          logNet(netLog, 'OK', `${algoProtos.length} Algorand protocols loaded`);
        }
      }
    } catch { logNet(netLog, 'WARN', 'Protocol data unavailable'); }

    // ── DeFi Llama: Stablecoin market cap ──
    try {
      logNet(netLog, 'FETCH', 'DeFi Llama — Stablecoins');
      const stableRes = await fetch('https://stablecoins.llama.fi/stablecoins?includePrices=true', { signal: AbortSignal.timeout(8000) });
      if (stableRes.ok) {
        const stableData = await stableRes.json() as { peggedAssets: Array<{ name: string; symbol: string; circulating: { peggedUSD?: number } | null }> };
        let totalStable = 0;
        const stableList: Array<{ name: string; symbol: string; mcap: number }> = [];

        for (const s of stableData.peggedAssets) {
          const mcap = (s.circulating && typeof s.circulating.peggedUSD === 'number') ? s.circulating.peggedUSD : 0;
          if (mcap > 0) {
            totalStable += mcap;
            stableList.push({ name: s.name, symbol: s.symbol, mcap });
          }
        }

        if (totalStable > 0) {
          container.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Stablecoin Supply' }));
          container.appendChild(diagRow('Total Stablecoins', formatMarketCap(totalStable)));

          stableList.sort((a, b) => b.mcap - a.mcap);
          stableList.slice(0, 3).forEach(s => container.appendChild(diagRow(s.symbol, formatMarketCap(s.mcap))));
          logNet(netLog, 'OK', `Stablecoin supply: ${formatMarketCap(totalStable)}`);
        }
      }
    } catch { logNet(netLog, 'WARN', 'Stablecoin data unavailable'); }

    // ── Algorand Network Diagnostics ──
    try {
      logNet(netLog, 'FETCH', 'Algorand network status');
      const algodUrl = `https://${store.get().settings.network}-api.algonode.cloud`;
      const statusRes = await fetch(`${algodUrl}/v2/status`, { signal: AbortSignal.timeout(5000) });
      if (statusRes.ok) {
        const status = await statusRes.json() as Record<string, unknown>;
        const round = Number(status['last-round'] || 0);
        const blockTime = Number(status['time-since-last-round'] || 0) / 1e9;
        container.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Algorand Network' }));
        container.appendChild(diagRow('Latest Round', round.toLocaleString()));
        container.appendChild(diagRow('Block Time', `${blockTime.toFixed(1)}s`));
        container.appendChild(diagRow('Consensus', 'Pure Proof-of-Stake'));
        container.appendChild(diagRow('Finality', '~3.3s (instant, no forks)'));
        logNet(netLog, 'OK', `Round ${round.toLocaleString()} · ${blockTime.toFixed(1)}s block`);
      }
    } catch { logNet(netLog, 'WARN', 'Algorand status unavailable'); }
  }

  async function loadDiagnostics(container: HTMLElement, accounts: { address: string; name: string }[], network: NetworkId, netLog?: HTMLElement) {
    container.innerHTML = '';
    container.appendChild(el('div', { cls: 'parsec-matrix__diag-loading', text: 'Reading blockchain...' }));

    // Get prices for USD valuation
    const coinPrices = prices.length > 0 ? prices : [];
    const algoPrice = coinPrices.find(p => p.id === 'algorand');
    const usdcId = 31566704;

    for (const acct of accounts) {
      const addrShort = `${acct.address.slice(0, 6)}...${acct.address.slice(-4)}`;
      const t0 = performance.now();
      if (netLog) logNet(netLog, 'FETCH', `accountInfo ${addrShort}`);

      try {
        const info = await fetchAccountInfo(acct.address, network);
        const fetchMs = Math.round(performance.now() - t0);
        if (netLog) logNet(netLog, 'OK', `${microAlgosToAlgo(info.amount)} ALGO · ${fetchMs}ms · round ${info.round}`);

        const t1 = performance.now();
        if (netLog) logNet(netLog, 'FETCH', `enriching ${info.assets.length} assets`);
        info.assets = await enrichAssets(info.assets, network);
        const enrichMs = Math.round(performance.now() - t1);
        if (netLog) logNet(netLog, 'OK', `${info.assets.length} assets resolved · ${enrichMs}ms`);

        // Calculate USD portfolio value
        const algoUsd = algoPrice ? algoPrice.usd : 0;
        const algoValue = (info.amount / 1_000_000) * algoUsd;
        let totalUsd = algoValue;

        const frozenCount = info.assets.filter(a => a.isFrozen).length;
        if (frozenCount > 0 && netLog) logNet(netLog, 'WARN', `${frozenCount} frozen asset(s)`);

        // Available vs locked
        const available = Math.max(0, info.amount - info.minBalance);
        const locked = info.minBalance;

        // Build asset rows with USD values
        const assetRows = info.assets.map(a => {
          const decimals = a.decimals ?? 6;
          const displayAmount = formatAssetAmount(a.amount, decimals);
          const badges: string[] = [];
          if (a.isFrozen) badges.push('FROZEN');
          if (a.hasFreezeAddr) badges.push('freezable');
          if (a.hasClawbackAddr) badges.push('clawback');

          // USD estimate for known stablecoins
          let usdValue = '';
          if (a.assetId === usdcId || (a.unitName && a.unitName.toUpperCase() === 'USDC')) {
            const val = a.amount / Math.pow(10, decimals);
            totalUsd += val;
            usdValue = `≈ $${val.toFixed(2)}`;
          } else if (a.unitName && a.unitName.toUpperCase() === 'USDT') {
            const val = a.amount / Math.pow(10, decimals);
            totalUsd += val;
            usdValue = `≈ $${val.toFixed(2)}`;
          }

          return el('div', { cls: 'parsec-matrix__diag-asset', children: [
            el('div', { children: [
              el('span', { text: a.unitName || a.name || `ASA #${a.assetId}` }),
              badges.length > 0 ? el('span', { cls: 'parsec-matrix__diag-badge', text: ` ${badges.join(' · ')}` }) : el('span'),
            ]}),
            el('div', { cls: 'parsec-matrix__diag-asset-right', children: [
              el('span', { text: displayAmount }),
              usdValue ? el('span', { cls: 'parsec-matrix__diag-usd', text: usdValue }) : el('span'),
            ]}),
          ]});
        });

        if (netLog && algoPrice) {
          logNet(netLog, 'PRICE', `ALGO ${formatPrice(algoPrice.usd)} · portfolio ≈ $${totalUsd.toFixed(2)}`);
        }

        container.innerHTML = '';
        container.appendChild(el('div', { cls: 'parsec-matrix__diag-card', children: [
          // Account header
          el('div', { cls: 'parsec-matrix__diag-header', children: [
            el('span', { cls: 'parsec-matrix__diag-name', text: acct.name }),
            el('span', { cls: 'parsec-matrix__diag-addr', text: addrShort }),
          ]}),

          // Balance with USD
          el('div', { cls: 'parsec-matrix__diag-balance', text: `${microAlgosToAlgo(info.amount)} ALGO` }),
          algoPrice ? el('div', { cls: 'parsec-matrix__diag-usd-total', text: `≈ $${algoValue.toFixed(2)} USD` }) : el('span'),

          // Available / Locked / Rewards breakdown
          el('div', { cls: 'parsec-matrix__diag-breakdown', children: [
            el('div', { cls: 'parsec-matrix__diag-breakdown-row', children: [
              el('span', { text: 'Available' }),
              el('span', { text: `${microAlgosToAlgo(available)} ALGO` }),
            ]}),
            el('div', { cls: 'parsec-matrix__diag-breakdown-row', children: [
              el('span', { text: 'Locked (min balance)' }),
              el('span', { text: `${microAlgosToAlgo(locked)} ALGO` }),
            ]}),
            info.pendingRewards > 0 ? el('div', { cls: 'parsec-matrix__diag-breakdown-row parsec-matrix__diag-breakdown-row--reward', children: [
              el('span', { text: 'Pending Rewards' }),
              el('span', { text: `${microAlgosToAlgo(info.pendingRewards)} ALGO` }),
            ]}) : el('span'),
          ]}),

          // Chain metadata
          el('div', { cls: 'parsec-matrix__diag-meta', text: `${info.assets.length} assets · Round ${info.round} · ${network}` }),

          // Portfolio total (if priced)
          totalUsd > 0 ? el('div', { cls: 'parsec-matrix__diag-portfolio', text: `Portfolio ≈ $${totalUsd.toFixed(2)}` }) : el('span'),

          // Asset list
          ...assetRows,
        ]}));

      } catch (err) {
        const failMs = Math.round(performance.now() - t0);
        if (netLog) logNet(netLog, 'ERR', `${addrShort} — ${err instanceof Error ? err.message : 'failed'} · ${failMs}ms`);
        container.innerHTML = '';
        container.appendChild(el('div', { cls: 'parsec-matrix__diag-error', text: `Could not fetch data: ${err instanceof Error ? err.message : 'network error'}` }));
      }
    }
  }

  function logNet(log: HTMLElement, tag: string, msg: string) {
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    const tagColors: Record<string, string> = {
      INIT: '#10b981', NODE: '#3b82f6', FETCH: '#f59e0b', OK: '#10b981',
      WARN: '#f59e0b', ERR: '#ef4444', PRICE: '#8b5cf6', MOVER: '#8b5cf6', WAIT: '#6b7280',
    };
    const color = tagColors[tag] || '#6b7280';
    const line = el('div', {
      cls: 'parsec-matrix__netlog-line',
      html: `<span style="color:#555">${ts}</span> <span style="color:${color};font-weight:600">${tag}</span> <span>${msg}</span>`,
    });
    log.appendChild(line);
    // Keep last 12 lines
    while (log.childNodes.length > 12) log.removeChild(log.firstChild!);
    log.scrollTop = log.scrollHeight;
  }

  function renderRedPill() {
    // Red pill = wallet login + create new wallet
    const state = store.get();
    const hasAccounts = state.accounts.length > 0;
    const hasKeys = isTauri() || hasVault();

    panel.appendChild(el('div', { cls: 'parsec-matrix__pill-screen', children: [
      el('div', { cls: 'parsec-matrix__choice-label parsec-matrix__choice-label--red', text: 'RED PILL — LIVE WALLET' }),
      el('p', { cls: 'parsec-matrix__lead', text: 'Sovereign access. Signing authority.' }),
    ]}));

    if (hasAccounts && hasKeys) {
      // Returning user — passphrase unlock
      const passInput = input({ type: 'password', placeholder: 'Enter passphrase', cls: 'parsec-matrix__input', onInput: (v) => { passphrase = v; }, onEnter: () => doUnlock() });
      panel.appendChild(passInput);
      panel.appendChild(btn('Unlock Wallet', { intent: 'primary', large: true, cls: 'parsec-matrix__action parsec-matrix__action--red', onClick: doUnlock }));
      setTimeout(() => passInput.focus(), 100);

      // Divider + create/import options
      panel.appendChild(el('div', { cls: 'parsec-matrix__divider', text: 'or' }));
    }

    // Always show create + import (new and returning users)
    panel.appendChild(btn('Create New Wallet', { outlined: true, large: true, cls: 'parsec-matrix__action', onClick: () => { cancelAnimation(); store.navigate('onboarding'); } }));
    panel.appendChild(btn('Import Wallet', { outlined: true, cls: 'parsec-matrix__action', onClick: () => { cancelAnimation(); store.navigate('import-wallet'); } }));

    backButton();
  }

  function backButton() {
    panel.appendChild(el('div', { cls: 'parsec-matrix__back', children: [
      el('a', { text: 'Return to Matrix', attrs: { href: '#' }, onClick: (e) => { e.preventDefault(); passphrase = ''; setPill('none'); } }),
    ]}));
  }

  // Initialize: landing state — panel hidden, brand visible
  panel.style.display = 'none';

  async function doUnlock() {
    if (!passphrase || passphrase.length < 8) { toast('Enter your passphrase', 'danger'); return; }
    store.set({ isLoading: true });
    const ok = await keystoreUnlock(passphrase);
    store.set({ isLoading: false });
    if (ok) {
      store.setPassphrase(passphrase);
      passphrase = '';
      // Show compact wallet summary in the matrix instead of navigating away
      renderWalletSummary();
    } else {
      toast('Wrong passphrase', 'danger');
      passphrase = '';
    }
  }

  async function renderWalletSummary() {
    const state = store.get();
    const account = state.accounts[state.activeAccountIndex];
    if (!account) { cancelAnimation(); store.navigate('dashboard'); return; }

    panel.innerHTML = '';
    panel.appendChild(el('div', { cls: 'parsec-matrix__choice-label parsec-matrix__choice-label--red', text: 'RED PILL — LIVE' }));

    // Logged in indicator
    panel.appendChild(el('div', { cls: 'parsec-matrix__wallet-status', children: [
      el('span', { cls: 'parsec-matrix__wallet-dot' }),
      el('span', { text: 'LOGGED IN' }),
    ]}));

    // Address (click to copy)
    const addrEl = el('div', {
      cls: 'parsec-matrix__wallet-address',
      text: truncateAddress(account.address),
      attrs: { title: account.address },
      onClick: () => { navigator.clipboard.writeText(account.address); toast('Address copied', 'success'); },
    });
    panel.appendChild(addrEl);

    // Loading indicator
    const summaryEl = el('div', { cls: 'parsec-matrix__wallet-summary', text: 'Loading balance...' });
    panel.appendChild(summaryEl);

    // Enter Wallet button
    panel.appendChild(btn('Enter Wallet', {
      intent: 'primary', large: true, cls: 'parsec-matrix__action parsec-matrix__action--red',
      onClick: () => { cancelAnimation(); store.navigate('dashboard'); },
    }));

    backButton();

    // Fetch balance + prices asynchronously
    try {
      const oracle = new PriceOracle();
      const [info, algoUsd] = await Promise.all([
        fetchAccountInfo(account.address, state.settings.network),
        oracle.getAlgoUsd(),
      ]);

      const algoBalance = Number(info.amount) / 1_000_000;
      const balanceUsd = algoBalance * algoUsd;

      summaryEl.innerHTML = '';
      summaryEl.appendChild(el('div', { cls: 'parsec-matrix__wallet-balance', children: [
        el('div', { cls: 'parsec-matrix__wallet-balance-label', text: 'BALANCE' }),
        el('div', { cls: 'parsec-matrix__wallet-balance-value', text: `${algoBalance.toFixed(6)} ALGO` }),
        el('div', { cls: 'parsec-matrix__wallet-balance-usd', text: `≈ $${balanceUsd.toFixed(2)} USD` }),
      ]}));

      // Assets
      if (info.assets && info.assets.length > 0) {
        const enriched = await enrichAssets(info.assets, state.settings.network);
        const assetList = el('div', { cls: 'parsec-matrix__wallet-assets' });
        assetList.appendChild(el('div', { cls: 'parsec-matrix__wallet-assets-label', text: 'ASSETS' }));

        for (const asset of enriched.slice(0, 8)) {
          const name = asset.unitName || asset.name || `ASA #${asset.assetId}`;
          const amount = asset.decimals
            ? (asset.amount / Math.pow(10, asset.decimals)).toFixed(asset.decimals > 4 ? 4 : asset.decimals)
            : String(asset.amount);

          // Try to get USD price for this ASA
          let usdStr = '';
          try {
            const price = await oracle.getAssetPrice(asset.assetId);
            if (price.usd > 0) {
              const val = (asset.amount / Math.pow(10, asset.decimals || 0)) * price.usd;
              usdStr = `≈ $${val.toFixed(2)}`;
            }
          } catch { /* no price available */ }

          assetList.appendChild(el('div', { cls: 'parsec-matrix__wallet-asset-row', children: [
            el('span', { cls: 'parsec-matrix__wallet-asset-name', text: name }),
            el('span', { cls: 'parsec-matrix__wallet-asset-amount', text: amount }),
            usdStr ? el('span', { cls: 'parsec-matrix__wallet-asset-usd', text: usdStr }) : el('span'),
          ]}));
        }

        if (enriched.length > 8) {
          assetList.appendChild(el('div', { cls: 'parsec-matrix__wallet-asset-more', text: `+${enriched.length - 8} more` }));
        }

        summaryEl.appendChild(assetList);
      }
    } catch {
      summaryEl.textContent = 'Could not fetch balance. Enter wallet for full view.';
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

// Matrix rain shader — faithful to the original Shadertoy expression
// iChannel0 = glyph atlas (16x16 katakana), iChannel1 = noise texture
// Enhanced with market-driven speed, sentiment color, pill tinting
const FRAG = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pill;
uniform float u_zoom;
uniform vec2 u_mouse;
uniform float u_activity;
uniform float u_sentiment;
uniform float u_dragX;
uniform float u_dragY;
uniform float u_breadth;
uniform sampler2D u_glyphs;
uniform sampler2D u_noise;
uniform float u_glitch;   // 0 = normal, 0-1 = glitch intensity
uniform float u_spin;     // 0-2π spin rotation angle

// ── Text: sample a random character from the 16x16 glyph atlas ──
// Faithful to Shadertoy ldccW4 text() function
float text(vec2 fragCoord) {
  vec2 uv = mod(fragCoord, 16.0) * 0.0625;        // position within 16px cell
  vec2 block = fragCoord * 0.0625 - uv;             // which cell
  uv = uv * 0.8 + 0.1;                              // scale letters up
  // Randomize letter using noise texture + time scroll
  uv += floor(texture2D(u_noise, block / 256.0 + u_time * 0.002).xy * 16.0);
  uv *= 0.0625;                                     // back to atlas UV range
  uv.x = 1.0 - uv.x;                               // flip horizontal
  return texture2D(u_glyphs, uv).r;
}

// ── Rain: per-column falling green streaks ──
// Faithful to Shadertoy ldccW4 rain() function
// Enhanced: speed driven by market activity, color by sentiment
vec3 rain(vec2 fragCoord) {
  fragCoord.x -= mod(fragCoord.x, 16.0);            // snap to column grid

  float offset = sin(fragCoord.x * 15.0);            // per-column phase offset
  float speed = cos(fragCoord.x * 3.0) * 0.3 + 0.7; // per-column speed variation

  // Market activity drives overall rain speed
  float act = 0.5 + u_activity * 1.5;
  float y = fract(fragCoord.y / u_resolution.y + u_time * speed * act + offset);

  // Base color: green matrix, shifted by sentiment
  float sent = u_sentiment;
  float bear = max(0.0, -sent);
  float bull = max(0.0, sent);
  vec3 rainColor = vec3(0.1, 1.0, 0.35);             // classic matrix green
  rainColor = mix(rainColor, vec3(1.0, 0.15, 0.1), bear * 0.5);  // red when bearish
  rainColor = mix(rainColor, vec3(0.1, 1.0, 0.5), bull * 0.2);   // brighter green when bullish

  // Pill tinting
  if (u_pill > 0.5 && u_pill < 1.5) {
    rainColor = mix(rainColor, vec3(1.0, 0.2, 0.1), 0.6);   // red pill
  } else if (u_pill > 1.5) {
    rainColor = mix(rainColor, vec3(0.1, 0.4, 1.0), 0.6);   // blue pill
  }

  return rainColor / (y * 20.0);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 res = u_resolution;
  float z = u_zoom;

  // ── Spin: rotate rain coordinates around screen center ──
  vec2 center = res * 0.5;
  vec2 p = fc - center;
  float cs = cos(u_spin), sn = sin(u_spin);
  vec2 rotated = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs) + center;

  // Scale coordinates by zoom
  vec2 scaled = rotated / z;

  // ── Glitch: chromatic split + scanline tear ──
  float g = u_glitch;
  vec3 col;
  if (g > 0.01) {
    // Chromatic aberration — split RGB channels
    float shift = g * 12.0;
    float r = text(scaled + vec2(shift, 0.0)) * rain(scaled + vec2(shift, 0.0)).r;
    float gn = text(scaled) * rain(scaled).g;
    float b = text(scaled - vec2(shift, 0.0)) * rain(scaled - vec2(shift, 0.0)).b;
    col = vec3(r, gn, b);

    // Scanline tear — horizontal displacement
    float tearLine = fract(u_time * 3.7 + g * 5.0);
    float tearDist = abs(fc.y / res.y - tearLine);
    if (tearDist < 0.02 * g) {
      col = col.grb; // channel swap on tear line
      scaled.x += g * 40.0; // horizontal shift
      col += text(scaled) * rain(scaled) * 0.3;
    }

    // Flash — bright pulse at peak glitch
    col += vec3(g * g * 0.4);

    // Character scramble — extra noise in glyph selection
    col *= 0.7 + 0.3 * fract(sin(dot(fc, vec2(12.9898, 78.233)) + u_time * 100.0) * 43758.5453);
  } else {
    // Normal: the classic matrix expression
    col = text(scaled) * rain(scaled);
  }

  // Mouse glow — subtle cursor awareness
  vec2 mp = u_mouse * res;
  float md = length(fc - mp) / max(res.x, res.y);
  float mglow = smoothstep(0.2, 0.0, md) * 0.08;
  col += col * mglow * 3.0;

  // Vignette — darken edges
  vec2 uv = fc / res;
  col *= 1.0 - 0.5 * pow(length(uv - 0.5) * 1.5, 2.5);

  // Subtle scanlines
  col *= 0.95 + 0.05 * sin(fc.y * 3.0);

  gl_FragColor = vec4(col, 1.0);
}
`;
