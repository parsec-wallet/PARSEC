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
    if (glyphRotationTimer) clearInterval(glyphRotationTimer);
  }

  // ── Crypto Glyphs — riding the rain, entropy-selected from top 100 ──

  // How many icons visible at once — scales with volatility
  const GLYPH_SLOTS = 16;
  let glyphRotationTimer: ReturnType<typeof setInterval> | null = null;

  function createGlyphs() {
    glyphLayer.innerHTML = '';
    cryptoGlyphs = [];
    if (prices.length === 0) return;

    // Entropy-driven random selection from the full pool
    const pool = [...prices];
    const selected: CoinPrice[] = [];

    // Always include top 5 by market cap
    for (let i = 0; i < Math.min(5, pool.length); i++) selected.push(pool[i]);

    // Fill remaining slots randomly — like paper wallet entropy, the randomness IS the selection
    while (selected.length < GLYPH_SLOTS && pool.length > 0) {
      const idx = Math.floor(Math.random() * pool.length);
      const coin = pool.splice(idx, 1)[0];
      if (!selected.includes(coin)) selected.push(coin);
    }

    // Place glyphs — riding rain columns across the full screen
    for (let i = 0; i < selected.length; i++) {
      const coin = selected[i];
      const vol = Math.abs(coin.change24h);
      const volFactor = Math.min(1.0, vol / 5.0);

      // Spread across the full width, varied depth
      const x = 0.03 + (i / selected.length) * 0.94 + (Math.random() - 0.5) * 0.06;
      const y = Math.random() * 0.9 + 0.05;
      const depth = 0.4 + Math.random() * 0.6;
      const baseSize = (14 + volFactor * 14 + depth * 8) * zoom;
      const baseOpacity = (0.06 + volFactor * 0.3 + depth * 0.12);

      const glyph: CryptoGlyph = { coin, x, y, size: baseSize };
      cryptoGlyphs.push(glyph);

      // Color from change direction
      const color = coin.change24h > 0.5
        ? `rgba(16,255,90,${baseOpacity})`
        : coin.change24h < -0.5
          ? `rgba(255,80,80,${baseOpacity})`
          : `rgba(180,180,200,${baseOpacity * 0.4})`;

      const glyphEl = el('div', {
        cls: `parsec-matrix__crypto-glyph ${volFactor > 0.3 ? 'parsec-matrix__crypto-glyph--volatile' : ''}`,
        text: coin.symbol,
        attrs: {
          'data-coin': coin.id,
          style: `left:${x * 100}%;top:${y * 100}%;font-size:${baseSize}px;color:${color};text-shadow:0 0 ${4 + volFactor * 16}px ${color};z-index:${Math.round(depth * 10)}`,
        },
      });
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

      const vol = Math.abs(cg.coin.change24h);
      const volFactor = Math.min(1.0, vol / 5.0);

      // Rain speed — icons fall with the matrix columns
      const fallSpeed = 0.08 + activityUniform * 0.3 + volFactor * 0.15;
      const fallY = ((cg.y * 100 + t * fallSpeed * 3.0 + i * 7) % 110) - 5;

      // Dangle — pendulum swing, stronger for volatile
      const dangleAmp = 3 + volFactor * 15;
      const dangleSpeed = 0.3 + volFactor * 0.7;
      const dangle = Math.sin(t * dangleSpeed + i * 1.9) * dangleAmp;

      // Depth perspective — scale and opacity shift with 3D rotation
      const rotPhase = t * 0.015; // matches shader rotation
      const depthShift = Math.sin(rotPhase + cg.x * 3.14) * 0.15;
      const perspScale = 0.85 + depthShift + volFactor * 0.1;

      // Bounce for volatile — damped spring
      const bounce = volFactor > 0.2
        ? Math.sin(t * 2.5 + i * 2.7) * volFactor * 8 * Math.exp(-((t % 10) * 0.15))
        : 0;

      glyphEl.style.top = `${fallY}%`;
      glyphEl.style.transform = `translateX(${dangle}px) translateY(${bounce}px) scale(${perspScale})`;
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

// Matrix rain shader — glitch from interaction, 3D rotation, market-driven
const FRAG = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pill;
uniform float u_zoom;
uniform vec2 u_mouse;
uniform float u_activity;
uniform float u_sentiment;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float glyph(vec2 uv, float seed, float depth) {
  vec2 grid = vec2(5.0, 8.0);
  vec2 cell = floor(uv * grid);
  if (cell.x < 0.0 || cell.x >= grid.x || cell.y < 0.0 || cell.y >= grid.y) return 0.0;
  float id = floor(seed * 128.0);
  float r = hash(cell + id + depth * 13.0);
  float pattern = 0.0;
  float cx = fract(uv.x * grid.x);
  float cy = fract(uv.y * grid.y);
  if (r > 0.3) pattern += smoothstep(0.35, 0.38, cx) * smoothstep(0.65, 0.62, cx);
  if (r > 0.55) pattern += smoothstep(0.3, 0.33, cy) * smoothstep(0.7, 0.67, cy) * 0.7;
  float dot1 = 1.0 - smoothstep(0.12, 0.18, length(vec2(cx, cy) - vec2(0.2, 0.2)));
  float dot2 = 1.0 - smoothstep(0.12, 0.18, length(vec2(cx, cy) - vec2(0.8, 0.8)));
  if (r > 0.7) pattern += (dot1 + dot2) * 0.6;
  if (r > 0.8) pattern += smoothstep(0.08, 0.0, abs(cx - cy)) * 0.5;
  if (r < 0.25) {
    pattern += smoothstep(0.42, 0.45, cx) * smoothstep(0.58, 0.55, cx);
    pattern += smoothstep(0.42, 0.45, cy) * smoothstep(0.58, 0.55, cy);
  }
  float pad = smoothstep(0.04, 0.1, cx) * smoothstep(0.96, 0.9, cx)
            * smoothstep(0.04, 0.1, cy) * smoothstep(0.96, 0.9, cy);
  return clamp(pattern * pad, 0.0, 1.0);
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 res = u_resolution;
  float z = u_zoom;
  float act = u_activity;
  float timeScale = 0.15 + act * 0.85;
  float t = u_time * timeScale;

  // ── 3D rotation + axis spin ──────────────────────────────
  vec2 centered = (fragCoord / res - 0.5) * 2.0;

  // Slow world rotation from time — gentle spin on Y axis
  float rotAngle = u_time * 0.015;
  float cosR = cos(rotAngle);
  float sinR = sin(rotAngle);

  // Mouse-driven tilt — interaction tilts the perspective
  float tiltX = (u_mouse.x - 0.5) * 0.08;
  float tiltY = (u_mouse.y - 0.5) * 0.06;

  // Apply rotation + tilt as pseudo-3D projection
  float perspZ = 1.0 + centered.y * (0.12 + tiltY) + centered.x * tiltX;
  vec2 rotated = vec2(
    centered.x * cosR - centered.y * sinR * 0.03,
    centered.y + centered.x * sinR * 0.02
  );
  vec2 warped = (rotated * 0.5 + 0.5) * res / perspZ;

  // ── Glitch from proximity to interaction point ───────────
  vec2 mousePos = u_mouse * res;
  float mouseDist = length(fragCoord - mousePos) / max(res.x, res.y);
  float glitchZone = smoothstep(0.2, 0.0, mouseDist); // 0-1 intensity near cursor

  // Glitch: horizontal tear — shifts scan lines near cursor
  float glitchTear = 0.0;
  if (glitchZone > 0.05) {
    float tearLine = step(0.92, hash(vec2(floor(fragCoord.y * 0.1), floor(u_time * 8.0))));
    glitchTear = tearLine * glitchZone * 30.0; // pixel shift magnitude
  }
  warped.x += glitchTear;

  // Glitch: character shimmer — between two states near cursor
  float shimmer = glitchZone * sin(u_time * 15.0 + fragCoord.y * 0.5) * 0.5;

  float cellSize = 18.0 * z;
  vec2 grid = warped / cellSize;
  vec2 cellId = floor(grid);
  vec2 cellUv = fract(grid);

  float colSeed = hash(vec2(cellId.x, 0.0));
  float depth = 0.25 + colSeed * 0.75;
  float colSpeed = (0.3 + colSeed * 1.2) * depth;
  float offset = colSeed * 200.0;
  float scroll = t * colSpeed + offset;
  float rowId = cellId.y + floor(scroll);
  float charSeed = hash(vec2(cellId.x, rowId));

  // Character flicker — glitch zone forces rapid change
  float flickerRate = 0.5 + act * 4.0 + glitchZone * 20.0;
  float charFlicker = floor(u_time * flickerRate * (0.3 + colSeed * 0.7));
  float flickerSeed = charSeed + charFlicker * 0.007 + shimmer * 0.1;

  float head = fract(scroll);
  float dist = fract(cellId.y / res.y * cellSize + head);
  float trailLen = 0.4 + (1.0 - act) * 0.3 + depth * 0.2;
  float trail = smoothstep(0.0, trailLen * 0.6, dist) * smoothstep(1.0, 1.0 - trailLen, dist);
  float pulse = 0.85 + 0.15 * sin(u_time * 0.4 + colSeed * 6.28);
  float brightness = trail * (0.25 + 0.75 * charSeed) * (0.4 + depth * 0.6) * pulse;

  float g = glyph(cellUv, flickerSeed, depth);
  brightness *= g;

  // Glitch brightness spike — flashes near cursor
  brightness += glitchZone * step(0.85, hash(fragCoord * 0.01 + u_time * 3.0)) * 0.6;

  float headGlow = smoothstep(0.06, 0.0, abs(dist - 0.97)) * (1.2 + depth * 0.8);
  float afterglow = smoothstep(0.15, 0.0, abs(dist - 0.92)) * 0.3 * depth;

  // ── Color ────────────────────────────────────────────────
  float sent = u_sentiment;
  float hueShift = colSeed * 0.12;
  float bearMix = max(0.0, -sent);
  float bullMix = max(0.0, sent);

  vec3 greenBase = vec3(0.06, 0.85 + depth * 0.15, 0.25 + hueShift);
  vec3 bearBase = vec3(0.85 + depth * 0.15, 0.08, 0.06);
  vec3 bullBase = vec3(0.04, 0.95 + depth * 0.05, 0.35 + hueShift);
  vec3 baseColor = mix(greenBase, bearBase, bearMix * 0.7);
  baseColor = mix(baseColor, bullBase, bullMix * 0.4);
  vec3 col = baseColor * brightness;

  vec3 headColor = mix(vec3(0.5, 1.0, 0.65), vec3(1.0, 0.5, 0.3), bearMix * 0.6);
  headColor = mix(headColor, vec3(0.4, 1.0, 0.6), bullMix * 0.3);
  col += headColor * headGlow * g * depth;
  col += mix(vec3(0.03, 0.4, 0.15), vec3(0.4, 0.08, 0.03), bearMix * 0.5) * afterglow;
  col *= depth * (0.7 + depth * 0.3);

  // Glitch color aberration — RGB split near cursor
  if (glitchZone > 0.1) {
    float aberration = glitchZone * 3.0;
    vec2 rOff = vec2(aberration, 0.0) / res;
    vec2 bOff = vec2(-aberration, 0.0) / res;
    float rShift = hash(fragCoord + rOff * res + u_time) * glitchZone * 0.3;
    float bShift = hash(fragCoord + bOff * res + u_time * 1.1) * glitchZone * 0.3;
    col.r += rShift;
    col.b += bShift;
  }

  // Pill tinting
  if (u_pill > 0.5 && u_pill < 1.5) {
    col = mix(col, vec3(0.9, 0.15, 0.08) * brightness * depth + vec3(1.0, 0.4, 0.25) * headGlow * g, 0.45);
  } else if (u_pill > 1.5) {
    col = mix(col, vec3(0.08, 0.35, 0.95) * brightness * depth + vec3(0.25, 0.55, 1.0) * headGlow * g, 0.45);
  }

  // Mouse glow + glitch halo
  float mouseGlow = smoothstep(0.22, 0.0, mouseDist) * 0.18 * depth;
  float mouseRing = smoothstep(0.002, 0.0, abs(mouseDist - 0.12)) * 0.06 * depth;
  float glitchHalo = smoothstep(0.15, 0.0, mouseDist) * step(0.7, hash(vec2(u_time * 5.0, fragCoord.y * 0.02))) * 0.15;
  if (u_pill > 0.5 && u_pill < 1.5) { col += vec3(0.8, 0.1, 0.03) * (mouseGlow + mouseRing + glitchHalo); }
  else if (u_pill > 1.5) { col += vec3(0.03, 0.25, 0.8) * (mouseGlow + mouseRing + glitchHalo); }
  else {
    vec3 neutralGlow = mix(vec3(0.03, 0.6, 0.2), vec3(0.6, 0.08, 0.03), bearMix * 0.6);
    col += neutralGlow * (mouseGlow + mouseRing + glitchHalo);
  }

  // Vignette
  vec2 uv = fragCoord / res;
  col *= 1.0 - 0.45 * pow(length(uv - 0.5) * 1.5, 2.2);

  // Scanlines + CRT
  col *= 0.94 + 0.06 * sin(fragCoord.y * 3.0);
  col *= 1.0 - 0.02 * dot(centered, centered);

  // Film grain
  col += hash(fragCoord + u_time * 100.0) * 0.02;

  gl_FragColor = vec4(col, 1.0);
}
`;
