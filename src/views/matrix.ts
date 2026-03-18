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

type PillChoice = 'none' | 'red' | 'blue';

interface ChainDef { id: string; name: string; symbol: string; enabled: boolean; }
const CHAINS: ChainDef[] = [
  { id: 'algorand', name: 'Algorand', symbol: 'ALGO', enabled: true },
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', enabled: false },
  { id: 'litecoin', name: 'Litecoin', symbol: 'LTC', enabled: false },
  { id: 'monero', name: 'Monero', symbol: 'XMR', enabled: false },
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', enabled: false },
  { id: 'solana', name: 'Solana', symbol: 'SOL', enabled: false },
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

  // Pyramid — top winners and losers of the hour
  const pyramidLayer = el('div', { cls: 'parsec-matrix__pyramid' });
  container.appendChild(pyramidLayer);

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
    setUniform('u_breadth', breadth.greenPct / 100.0); // 0=all red, 1=all green
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    driftGlyphs(t);
    raf = requestAnimationFrame(frame);
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

  // Featured chains — top 3 by market cap from the major set, displayed prominently
  const MAJOR_SYMBOLS = new Set(['BTC', 'ETH', 'AVAX', 'ADA', 'ALGO', 'POL', 'XRP', 'SOL', 'DOT']);
  const FEATURED_SYMBOLS = new Set<string>();

  function createGlyphs() {
    glyphLayer.innerHTML = '';
    cryptoGlyphs = [];
    if (prices.length === 0) return;

    const pool = [...prices];
    const selected: CoinPrice[] = [];

    // Top 3 gainers from the major set — the ones moving right now
    FEATURED_SYMBOLS.clear();
    const majors = pool.filter(c => MAJOR_SYMBOLS.has(c.symbol)).sort((a, b) => b.change24h - a.change24h).slice(0, 3);
    for (const m of majors) FEATURED_SYMBOLS.add(m.symbol);

    // Always include the top 3 featured
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
    function findOpenSpot(preferred?: { x: number; y: number }): { x: number; y: number } {
      const minGap = 0.1; // 10% of screen between icons — no overlap
      if (preferred) {
        const tooClose = occupied.some(o => Math.abs(o.x - preferred.x) < minGap && Math.abs(o.y - preferred.y) < minGap);
        if (!tooClose) { occupied.push(preferred); return preferred; }
      }
      for (let attempt = 0; attempt < 50; attempt++) {
        const tx = 0.03 + Math.random() * 0.94;
        const ty = Math.random() * 0.72 + 0.05; // cap at 77% — below is ship/buy zone
        // Skip center panel
        if (tx > 0.28 && tx < 0.72 && ty > 0.15 && ty < 0.72) continue;
        // Skip bottom zone (ship + buy zone area)
        if (ty > 0.72) continue;
        // Skip if too close to any existing glyph
        const collision = occupied.some(o => Math.abs(o.x - tx) < minGap && Math.abs(o.y - ty) < minGap);
        if (!collision) { occupied.push({ x: tx, y: ty }); return { x: tx, y: ty }; }
      }
      // Fallback — edges only
      const fx = Math.random() > 0.5 ? 0.02 + Math.random() * 0.15 : 0.83 + Math.random() * 0.15;
      const fy = 0.05 + Math.random() * 0.5;
      occupied.push({ x: fx, y: fy });
      return { x: fx, y: fy };
    }

    for (let i = 0; i < selected.length; i++) {
      const coin = selected[i];
      const vol = Math.abs(coin.change24h);
      const volFactor = Math.min(1.0, vol / 5.0);
      const isFeatured = FEATURED_SYMBOLS.has(coin.symbol);

      // Featured: top-left area. Others: find open spot.
      let pos: { x: number; y: number };
      if (isFeatured) {
        const fIdx = [...FEATURED_SYMBOLS].indexOf(coin.symbol);
        pos = findOpenSpot({ x: 0.04 + fIdx * 0.09, y: 0.06 });
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

    // Triangle geometry: apex at top, bases stop ABOVE the ship/fleet zone
    const apexX = 50, apexY = 2;
    const rightBaseX = 92, rightBaseY = 68;
    const leftBaseX = 8, leftBaseY = 68;

    // ── Apex — #1 gainer, large and clear ──
    pyramidLayer.appendChild(pyramidCoin(topWinner, apexX, apexY, 1.8, true));

    // ── Top 5 winners — each gets their own clear space on the right ──
    const topWinners = winners.slice(1, 6); // positions 2-6
    const restWinners = winners.slice(6);
    topWinners.forEach((coin, i) => {
      // Evenly spaced down the right side with generous gaps
      const t = (i + 1) * 0.15; // 15%, 30%, 45%, 60%, 75%
      const x = apexX + (rightBaseX - apexX) * t;
      const y = apexY + (rightBaseY - apexY) * t;
      const scale = 1.4 - i * 0.12; // 1.4, 1.28, 1.16, 1.04, 0.92
      pyramidLayer.appendChild(pyramidCoin(coin, x, y, scale, false, 1.0));
    });
    // Remaining winners — smaller, trailing down
    const maxRestW = Math.min(restWinners.length, 4);
    for (let i = 0; i < maxRestW; i++) {
      const t = 0.8 + i * 0.05;
      const x = apexX + (rightBaseX - apexX) * t;
      const y = apexY + (rightBaseY - apexY) * t;
      pyramidLayer.appendChild(pyramidCoin(restWinners[i], x, y, 0.65, false, 0.5));
    }

    // ── Top 5 losers — each gets their own clear space on the left ──
    const topLosers = losers.slice(0, 5);
    const restLosers = losers.slice(5);
    topLosers.forEach((coin, i) => {
      const t = (i + 1) * 0.15;
      const x = apexX + (leftBaseX - apexX) * t;
      const y = apexY + (leftBaseY - apexY) * t;
      const scale = 1.4 - i * 0.12;
      pyramidLayer.appendChild(pyramidCoin(coin, x, y, scale, false, 1.0));
    });
    const maxRestL = Math.min(restLosers.length, 4);
    for (let i = 0; i < maxRestL; i++) {
      const t = 0.8 + i * 0.05;
      const x = apexX + (leftBaseX - apexX) * t;
      const y = apexY + (leftBaseY - apexY) * t;
      pyramidLayer.appendChild(pyramidCoin(restLosers[i], x, y, 0.65, false, 0.5));
    }

    // Triangle lines
    pyramidLayer.appendChild(pyramidLine(apexX, apexY + 2, rightBaseX, rightBaseY, 'rgba(16,185,129,0.15)'));
    pyramidLayer.appendChild(pyramidLine(apexX, apexY + 2, leftBaseX, leftBaseY, 'rgba(239,68,68,0.15)'));

    // ── Buy zone — biggest losers hang at the bottom, waiting for rebound ──
    const buyZone = el('div', { cls: 'parsec-pyramid__buyzone' });
    const bottomLosers = losers.slice(-8); // 8 deepest losers
    bottomLosers.forEach((coin) => {
      const changeSign = coin.change24h >= 0 ? '+' : '';
      buyZone.appendChild(el('div', {
        cls: 'parsec-pyramid__buyzone-coin',
        attrs: {
          title: `${coin.symbol} ${formatPrice(coin.usd)} ${changeSign}${coin.change24h.toFixed(1)}% — potential rebound`,
        },
        children: [
          el('span', { cls: 'parsec-pyramid__buyzone-symbol', text: coin.symbol }),
          el('span', { cls: 'parsec-pyramid__buyzone-price', text: formatPrice(coin.usd) }),
          el('span', { cls: 'parsec-pyramid__buyzone-change', text: `${changeSign}${coin.change24h.toFixed(1)}%` }),
        ],
      }));
    });
    pyramidLayer.appendChild(buyZone);

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

      pyramidLayer.appendChild(ship);
    }

    // ── Top 10 by market cap — real chains only, no stables/wrapped ──
    const excludeFromFleet = new Set([
      'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD', 'USDP', 'GUSD', 'FRAX', 'LUSD',
      'PAXG', 'XAUT', 'WBTC', 'WETH', 'STETH', 'WSTETH', 'CBETH', 'RETH',
      'LEO', 'OKB', 'CRO', 'KCS', 'HT', 'GT', 'FTT',
    ]);
    const fleetCoins = prices
      .filter(c => !excludeFromFleet.has(c.symbol))
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, 10);
    if (fleetCoins.length > 0) {
      const fleet = el('div', { cls: 'parsec-fleet' });
      fleetCoins.forEach(coin => {
        const sign = coin.change24h >= 0 ? '+' : '';
        const color = coin.change24h >= 0 ? '#10b981' : '#ef4444';
        const isAlgo = coin.symbol === 'ALGO';
        fleet.appendChild(el('div', {
          cls: `parsec-fleet__coin ${isAlgo ? 'parsec-fleet__coin--algo' : ''}`,
          children: [
            isAlgo ? el('div', { cls: 'parsec-fleet__parsec', text: 'PARSEC' }) : el('span'),
            el('div', { cls: 'parsec-fleet__symbol', text: coin.symbol }),
            el('div', { cls: 'parsec-fleet__price', text: formatPrice(coin.usd) }),
            el('div', { cls: 'parsec-fleet__change', text: `${sign}${coin.change24h.toFixed(1)}%`, attrs: { style: `color:${color}` } }),
          ],
        }));
      });
      pyramidLayer.appendChild(fleet);
    }

    // ── Top winners featured — right side with extra detail ──
    const winnerFeature = el('div', { cls: 'parsec-pyramid__feature parsec-pyramid__feature--right' });
    winners.slice(0, 4).forEach(coin => {
      const sign = coin.change24h >= 0 ? '+' : '';
      winnerFeature.appendChild(el('div', {
        cls: 'parsec-pyramid__feature-coin',
        children: [
          el('span', { cls: 'parsec-pyramid__feature-symbol', text: coin.symbol }),
          el('span', { text: ` ${formatPrice(coin.usd)} ` }),
          el('span', { cls: 'parsec-pyramid__feature-change', text: `${sign}${coin.change24h.toFixed(1)}%`, attrs: { style: 'color:#10b981' } }),
        ],
      }));
    });
    pyramidLayer.appendChild(winnerFeature);
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
    pillUniform = p === 'red' ? 1.0 : p === 'blue' ? 2.0 : 0.0;
    renderPanel();
  }

  // ── Panel Rendering ─────────────────────────────────────────

  function renderPanel() {
    panel.innerHTML = '';

    // PARSEC brand — hover reveals "Create New Wallet"
    const brand = el('div', { cls: 'parsec-matrix__brand', text: 'PARSEC' });
    const brandHint = el('div', { cls: 'parsec-matrix__brand-hint', text: 'Create New Wallet' });
    brandHint.style.display = 'none';
    brand.addEventListener('mouseenter', () => { brandHint.style.display = 'block'; });
    brand.addEventListener('mouseleave', () => { brandHint.style.display = 'none'; });
    brand.addEventListener('click', () => { cancelAnimation(); store.navigate('onboarding'); });
    brand.style.cursor = 'pointer';
    panel.appendChild(brand);
    panel.appendChild(brandHint);

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

    // Network activity feed — always shown
    const netFeed = el('div', { cls: 'parsec-matrix__netfeed' });
    const netLog = el('div', { cls: 'parsec-matrix__netlog' });
    netFeed.appendChild(el('div', { cls: 'parsec-matrix__netfeed-header', children: [
      el('span', { cls: 'parsec-matrix__netfeed-dot' }),
      el('span', { text: 'Network Activity' }),
    ]}));
    netFeed.appendChild(netLog);
    panel.appendChild(netFeed);

    // Start network activity monitor
    logNet(netLog, 'INIT', `Parsec v0.1.0 — ${state.settings.network}`);
    logNet(netLog, 'NODE', `Algod: ${state.settings.network}-api.algonode.cloud`);
    logNet(netLog, 'NODE', `Indexer: ${state.settings.network}-idx.algonode.cloud`);

    if (!state.accounts.length) {
      logNet(netLog, 'WAIT', 'No accounts — import a public address');
      panel.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'No accounts. Import a public address to view diagnostics.' }));
      panel.appendChild(btn('Import Watch-Only Address', { large: true, outlined: true, cls: 'parsec-matrix__action', onClick: () => { cancelAnimation(); store.navigate('import-wallet'); } }));
    } else {
      panel.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'Read-only portfolio intelligence. No signing authority.' }));
      const diagBox = el('div', { cls: 'parsec-matrix__diag' });
      panel.appendChild(diagBox);

      // Dynamic: refresh diagnostics every 30s while blue pill is active
      loadDiagnostics(diagBox, state.accounts, state.settings.network, netLog);
      const diagRefresh = setInterval(() => {
        if (choice !== 'blue') { clearInterval(diagRefresh); return; }
        logNet(netLog, 'SYNC', 'auto-refresh');
        loadDiagnostics(diagBox, state.accounts, state.settings.network, netLog);
      }, 30000);
    }

    // Show live price feed status
    if (prices.length > 0) {
      logNet(netLog, 'PRICE', `${prices.length} coins tracked — CoinGecko free tier`);
      const topMover = [...prices].sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))[0];
      if (topMover) {
        const dir = topMover.change24h >= 0 ? '+' : '';
        logNet(netLog, 'MOVER', `${topMover.symbol} ${dir}${topMover.change24h.toFixed(2)}% (24h)`);
      }
    }

    backButton();
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
    panel.appendChild(el('div', { cls: 'parsec-matrix__choice-label parsec-matrix__choice-label--red', text: 'RED PILL — LIVE WALLET' }));
    panel.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'Sovereign access. Signing authority. Full control.' }));

    const state = store.get();
    const hasAccounts = state.accounts.length > 0;
    const hasKeys = isTauri() || hasVault();

    if (hasAccounts && hasKeys) {
      // Returning user — unlock existing wallet
      const passInput = input({ type: 'password', placeholder: 'Enter passphrase', cls: 'parsec-matrix__input', onInput: (v) => { passphrase = v; }, onEnter: () => doUnlock() });
      panel.appendChild(passInput);
      panel.appendChild(btn('Unlock Wallet', { intent: 'primary', large: true, cls: 'parsec-matrix__action parsec-matrix__action--red', onClick: doUnlock }));
      setTimeout(() => passInput.focus(), 100);

      // Add new wallet to existing Parsec
      panel.appendChild(el('div', { cls: 'parsec-matrix__add-wallet', children: [
        el('div', { cls: 'parsec-matrix__add-wallet-divider', text: 'or add another wallet' }),
        renderChainSelector(),
      ]}));
    } else {
      // New user — chain selector to create first wallet
      panel.appendChild(renderChainSelector());
    }

    backButton();
  }

  function renderChainSelector(): HTMLElement {
    return el('div', { cls: 'parsec-matrix__chain-section', children: [
      el('div', { cls: 'parsec-matrix__chain-list', children: [
        // Import existing wallet (any chain)
        el('div', {
          cls: 'parsec-matrix__chain-item parsec-matrix__chain-item--import',
          onClick: () => { cancelAnimation(); store.navigate('import-wallet'); },
          children: [
            el('span', { cls: 'parsec-matrix__chain-name', text: 'Import' }),
            el('span', { cls: 'parsec-matrix__chain-format', text: 'Private key or mnemonic' }),
          ],
        }),
        // Chain-specific create
        ...CHAINS.map(chain => el('div', {
          cls: `parsec-matrix__chain-item ${chain.enabled ? '' : 'parsec-matrix__chain-item--disabled'}`,
          onClick: chain.enabled ? () => { cancelAnimation(); store.navigate('onboarding'); } : undefined,
          children: [
            el('span', { cls: 'parsec-matrix__chain-name', text: chain.symbol }),
            el('span', { cls: 'parsec-matrix__chain-format', text: chain.enabled ? `Create ${chain.name} wallet` : `${chain.name} — coming soon` }),
          ],
        })),
      ]}),
    ]});
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

// Matrix rain shader — calm, deep 3D, smooth, market-driven
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

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float glyph(vec2 uv, float seed, float depth) {
  vec2 grid = vec2(5.0, 8.0);
  vec2 cell = floor(uv * grid);
  if (cell.x < 0.0 || cell.x >= grid.x || cell.y < 0.0 || cell.y >= grid.y) return 0.0;
  float id = floor(seed * 128.0);
  float r = hash(cell + id + depth * 13.0);
  float cx = fract(uv.x * grid.x), cy = fract(uv.y * grid.y);
  float pattern = 0.0;
  if (r > 0.3) pattern += smoothstep(0.33, 0.37, cx) * smoothstep(0.67, 0.63, cx);
  if (r > 0.55) pattern += smoothstep(0.28, 0.32, cy) * smoothstep(0.72, 0.68, cy) * 0.6;
  float d1 = 1.0 - smoothstep(0.1, 0.17, length(vec2(cx, cy) - vec2(0.2, 0.2)));
  float d2 = 1.0 - smoothstep(0.1, 0.17, length(vec2(cx, cy) - vec2(0.8, 0.8)));
  if (r > 0.7) pattern += (d1 + d2) * 0.5;
  if (r > 0.8) pattern += smoothstep(0.06, 0.0, abs(cx - cy)) * 0.4;
  if (r < 0.25) {
    pattern += smoothstep(0.42, 0.46, cx) * smoothstep(0.58, 0.54, cx);
    pattern += smoothstep(0.42, 0.46, cy) * smoothstep(0.58, 0.54, cy);
  }
  float pad = smoothstep(0.05, 0.12, cx) * smoothstep(0.95, 0.88, cx)
            * smoothstep(0.05, 0.12, cy) * smoothstep(0.95, 0.88, cy);
  return clamp(pattern * pad, 0.0, 1.0);
}

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 res = u_resolution;
  float z = u_zoom;
  float act = u_activity;
  float t = u_time * (0.12 + act * 0.6); // calmer base speed

  // ── Deep 3D — parallax layers + drag rotation ────────────
  vec2 c = (fc / res - 0.5) * 2.0;

  // Smooth rotation: auto-spin + drag with gentle influence
  float yaw = u_time * 0.008 + u_dragX; // slower auto-spin
  float pitch = u_dragY * 0.25;
  float cy = cos(yaw), sy = sin(yaw);
  float cp = cos(pitch), sp = sin(pitch);

  // Mouse parallax — subtle depth shift
  float mx = (u_mouse.x - 0.5) * 0.04;
  float my = (u_mouse.y - 0.5) * 0.03;

  // 3D perspective with depth
  float pz = 1.0 + c.y * (0.15 + my + sp * 0.12) + c.x * (mx + sy * 0.03);
  pz = max(pz, 0.4);
  vec2 rot = vec2(c.x * cy - c.y * sy * 0.04, c.y * cp + c.x * sy * 0.03);
  vec2 w = (rot * 0.5 + 0.5) * res / pz;

  float cellSz = 18.0 * z;
  vec2 gr = w / cellSz;
  vec2 cid = floor(gr);
  vec2 cuv = fract(gr);

  // Column properties — 5 depth layers for parallax
  float cs = hash(vec2(cid.x, 0.0));
  float depth = 0.15 + cs * 0.85;
  float spd = (0.2 + cs * 0.8) * depth;
  float off = cs * 200.0;
  float scr = t * spd + off;
  float rid = cid.y + floor(scr);
  float chs = hash(vec2(cid.x, rid));

  // Slow deliberate character change
  float fRate = 0.3 + act * 2.0;
  float flick = floor(u_time * fRate * (0.2 + cs * 0.5));
  float fs = chs + flick * 0.005;

  // Long graceful trails
  float hd = fract(scr);
  float dst = fract(cid.y / res.y * cellSz + hd);
  float tl = 0.5 + (1.0 - act) * 0.3 + depth * 0.15;
  float trail = smoothstep(0.0, tl * 0.5, dst) * smoothstep(1.0, 1.0 - tl, dst);
  float pulse = 0.9 + 0.1 * sin(u_time * 0.3 + cs * 6.28);
  float br = trail * (0.2 + 0.8 * chs) * (0.3 + depth * 0.7) * pulse;

  float g = glyph(cuv, fs, depth);
  br *= g;

  // Soft head glow
  float hg = smoothstep(0.07, 0.0, abs(dst - 0.97)) * (1.0 + depth * 0.6);
  float ag = smoothstep(0.18, 0.0, abs(dst - 0.91)) * 0.2 * depth;

  // ── Color — smooth sentiment blending ───────────────────
  float sent = u_sentiment;
  float hs = cs * 0.1;
  float bear = max(0.0, -sent), bull = max(0.0, sent);

  vec3 gBase = vec3(0.05, 0.8 + depth * 0.15, 0.22 + hs);
  vec3 rBase = vec3(0.75 + depth * 0.15, 0.07, 0.05);
  vec3 bBase = vec3(0.04, 0.9 + depth * 0.08, 0.3 + hs);
  vec3 base = mix(gBase, rBase, bear * 0.6);
  base = mix(base, bBase, bull * 0.35);
  vec3 col = base * br;

  // Head + afterglow
  vec3 hc = mix(vec3(0.45, 0.95, 0.6), vec3(0.95, 0.45, 0.25), bear * 0.5);
  hc = mix(hc, vec3(0.35, 0.95, 0.55), bull * 0.25);
  col += hc * hg * g * depth;
  col += mix(vec3(0.02, 0.3, 0.12), vec3(0.3, 0.06, 0.02), bear * 0.4) * ag;

  // Depth fog — far columns recede smoothly
  col *= depth * depth; // squared for more dramatic depth separation

  // Pill tinting — gentle
  if (u_pill > 0.5 && u_pill < 1.5) {
    col = mix(col, vec3(0.8, 0.12, 0.06) * br * depth + vec3(0.9, 0.35, 0.2) * hg * g, 0.35);
  } else if (u_pill > 1.5) {
    col = mix(col, vec3(0.06, 0.3, 0.9) * br * depth + vec3(0.2, 0.5, 0.95) * hg * g, 0.35);
  }

  // Mouse glow — soft, no glitch
  vec2 mp = u_mouse * res;
  float md = length(fc - mp) / max(res.x, res.y);
  float mglow = smoothstep(0.25, 0.0, md) * 0.12 * depth;
  float mring = smoothstep(0.003, 0.0, abs(md - 0.1)) * 0.04 * depth;
  if (u_pill > 0.5 && u_pill < 1.5) col += vec3(0.6, 0.08, 0.02) * (mglow + mring);
  else if (u_pill > 1.5) col += vec3(0.02, 0.2, 0.6) * (mglow + mring);
  else col += mix(vec3(0.02, 0.5, 0.18), vec3(0.5, 0.06, 0.02), bear * 0.5) * (mglow + mring);

  // Elegant vignette
  vec2 uv = fc / res;
  col *= 1.0 - 0.4 * pow(length(uv - 0.5) * 1.4, 2.5);

  // Fine scanlines — barely visible
  col *= 0.96 + 0.04 * sin(fc.y * 2.5);

  // Subtle barrel
  col *= 1.0 - 0.015 * dot(c, c);

  // Whisper grain
  col += hash(fc + u_time * 80.0) * 0.012;

  gl_FragColor = vec4(col, 1.0);
}
`;
