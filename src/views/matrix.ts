// PARSEC Wallet — Matrix Entry Gate
// WebGL shader rain with 3D depth, crypto icon glyphs, live price on hover.
// Blue pill (left) = diagnostics. Red pill (right) = live wallet.
// Matrix wall = safe to walk away. Password never remembered.

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { bindGlobal, bindInterval, onCleanup } from '../lib/lifecycle';
import { formatPercent, describeChange, isFlat } from '../lib/percent';
import { changeFor, CHANGE_PERIODS, type ChangePeriod } from '../lib/prices';
import * as events from '../lib/events';
import { fetchChains, searchChains, CHAINMARKETCAP_URL, type EvmChain } from '../lib/chainmarketcap';
import { getChainDescriptor } from '../lib/chains';
import {
  cloudZones, cloudWeather, isSurging, driftSeconds, findSpot, capacity,
  makeBody, stepCloud, relaxHomes, avoidObstacles, setLift, CLOUD_GAP, type CloudBody,
  type Box as CloudBox,
  type Zone as CloudZone,
} from '../lib/cryptocloud';
import { keystoreUnlock, keystoreStatus } from '../lib/keystore';
import { profileChooser } from '../lib/ui/profile-chooser';
import { passphraseField } from '../lib/passphrase-field';
import { recoverKeys, mergeRecovered } from '../lib/recovery';
// Loaded at call time. `nfd/login` reaches `nfd/resolve` -> `nfd/client` ->
// `@txnlab/nfd-sdk` -> algosdk + algokit-utils. As a static import from this
// eager view, that alone put ~490 kB of chain SDK on the first-paint critical
// path — for a name lookup that only runs when someone types an identity into
// the login field.
import { provenanceLine } from '../lib/ui/provenance';
import type { SourceKind, Reach } from '../lib/ui/provenance';
import type { Status } from '../lib/ui/status';
import { hasVault } from '../lib/crypto';
import { getPermawebSettings } from '../lib/permaweb/settings';
import { isTauri } from '../lib/vault';
// See dashboard.ts: Algorand network helpers load at call time so algosdk stays
// off the first-paint path.
import { microAlgosToAlgo } from '../lib/algorand/format';
import { formatAssetAmount } from '../lib/algorand/format';
import { layoutPyramid, classify } from '../lib/pyramid-layout';
import { summarizeStables, shipList, formatBps, PEG_HELD_BPS, PEG_DEPEG_BPS } from '../lib/stablecoins';
import { startPriceUpdates, fetchPricesByIds, formatPrice, formatMarketCap, getMarketActivity, getMarketSentiment, getMarketBreadth, getFeedStatus } from '../lib/prices';
import type { CoinPrice } from '../lib/prices';
import * as mg from '../lib/market-global';
import * as profiles from '../lib/diag-profiles';
import { FOCUS_CATALOG, focusAsset, type DiagProfile } from '../lib/diag-profiles';
import * as watch from '../lib/watch';
import { sanitizeWatched, type WatchedWallet } from '../lib/watch';
import { logout, hasLiveSession } from '../lib/session';
import { arm, disarm } from '../lib/mode';

// Favourites strip — coins the wallet pins under the TOP 10 column. Some
// of these sit outside CoinGecko's top-100 mcap window (0g, ARIO, …) so
// they need a separate by-id fetch. The list is the diagnostics focus
// catalog, so a profile's emphasis and the landing's favourites are one set.
/** Display names for the chooser, keyed by CoinGecko slug. */
const FAVOURITE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  FOCUS_CATALOG.map((a) => [a.id, `${a.symbol} · ${a.name}`]),
);

const FAVOURITE_COINS: ReadonlyArray<string> = FOCUS_CATALOG.map((a) => a.id);
import type { NetworkId, WalletState } from '../types/wallet';

type PillChoice = 'none' | 'choose' | 'red' | 'blue';

// Crypto icon positions — scattered across the matrix rain
interface CryptoGlyph {
  coin: CoinPrice;
  x: number; y: number; // normalized 0-1
  size: number;
  /** Its physics: collides with the others so none ever overlap. */
  body: CloudBody;
  /** The figure line, rewritten in place when the period changes. */
  changeEl?: HTMLElement;
  /** The glyph element and its price line, recoloured in place on a re-class. */
  el?: HTMLElement;
  priceEl?: HTMLElement;
  /** Opacity its colour is drawn at. */
  alpha?: number;
  isFeatured?: boolean;
}

/** The cloud's colour for a class: green rises, red falls, grey hangs. */
function cloudColor(side: 'rise' | 'fall' | 'flat', alpha: number): string {
  return side === 'rise'
    ? `rgba(16,255,90,${alpha})`
    : side === 'fall'
      ? `rgba(255,80,80,${alpha})`
      : `rgba(200,210,220,${alpha * 0.5})`;
}

export function matrixView(): HTMLElement {
  let choice: PillChoice = 'none';
  // Does the vault hold accounts the frontend has not seen? Probed when the
  // red pill opens; the pill re-renders if the answer changes what it offers.
  // Declared with the rest of the view state so no render path can read it
  // before initialization.
  let vaultHasAccounts = false;
  // The Red Pill's profile panel: closed (just the profile line), open (the
  // chooser), or forgot (the chooser opened on "new vault", with the reason).
  let profilePanel: 'closed' | 'open' | 'forgot' = 'closed';
  // A fresh Matrix with no wallet session open is viewing mode.
  if (!hasLiveSession()) disarm();

  // Which overlays are on the wall is a preference the participant holds,
  // persisted per device.
  //
  // These live outside the render on purpose: renderPyramid() wipes and rebuilds
  // the whole layer on every price tick, so anything set on the old elements —
  // an inline style, a hidden attribute — is lost with them. State out here plus
  // a decision at build time survives the rebuild.
  //
  // Default is on for everything, so an existing participant sees no change
  // until they choose one.
  interface OverlayPref {
    readonly on: boolean;
    toggle(): void;
    /** Set outright — how a diagnostics profile is applied. */
    set(on: boolean): void;
  }

  function overlayPref(storageKey: string, fallback = true): OverlayPref {
    let on = fallback;
    try {
      const stored = localStorage.getItem(storageKey);
      // Only a stored value overrides the default. An absent key means the
      // participant has never expressed a preference, so the default stands —
      // which is what makes "matrix only, first run" possible without also
      // overriding the choices of someone who has already set them.
      if (stored === 'on') on = true;
      else if (stored === 'off') on = false;
    } catch { /* default stands */ }
    return {
      get on() { return on; },
      toggle() {
        on = !on;
        try { localStorage.setItem(storageKey, on ? 'on' : 'off'); } catch { /* best effort */ }
      },
      set(next: boolean) {
        on = next;
        try { localStorage.setItem(storageKey, on ? 'on' : 'off'); } catch { /* best effort */ }
      },
    };
  }

  // Defaults: the matrix, and the matrix only.
  //
  // A first run opens on the rain alone — the wall as it is meant to be seen,
  // with the market layers available rather than imposed. Anyone who has already
  // chosen keeps their choice; only an absent key takes the default.
  // Which favourites are shown. Absent means "all of them", so an existing
  // participant who has never opened the chooser sees no change.
  const FAVOURITES_SELECTION_KEY = 'parsec:matrix-favourites-selection';

  function loadFavouriteSelection(): Set<string> {
    try {
      const raw = localStorage.getItem(FAVOURITES_SELECTION_KEY);
      if (raw === null) return new Set(FAVOURITE_COINS);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set(FAVOURITE_COINS);
      // Intersect with the known list: a coin dropped from FAVOURITE_COINS in a
      // later build must not linger in a stored selection.
      return new Set(FAVOURITE_COINS.filter((id) => parsed.includes(id)));
    } catch {
      return new Set(FAVOURITE_COINS);
    }
  }

  let favouriteSelection = loadFavouriteSelection();

  function saveFavouriteSelection(): void {
    try {
      localStorage.setItem(FAVOURITES_SELECTION_KEY, JSON.stringify([...favouriteSelection]));
    } catch { /* best effort */ }
  }

  // Algorand and 0G joined the favourites on 2026-09-30. Added once, on top of
  // whatever the participant already chose -- never replacing it -- and only
  // once, so unticking either later sticks.
  const FAVOURITES_ADDED_KEY = 'parsec:matrix-favourites-added-2026-09-30';
  try {
    if (localStorage.getItem(FAVOURITES_ADDED_KEY) === null) {
      favouriteSelection.add('algorand');
      favouriteSelection.add('zero-gravity');
      saveFavouriteSelection();
      localStorage.setItem(FAVOURITES_ADDED_KEY, '1');
    }
  } catch { /* best effort */ }

  // Which period every percentage on the wall is measured over.
  //
  // 24h by default: it is the figure CoinGecko gives directly and the only one
  // available the instant the wallet opens. The shorter periods are ours and
  // need observation time before they can say anything.
  // How much of the instrument panel to show.
  //
  // The blue pill is diagnostics, and diagnostics that open on everything are
  // not diagnostics, they are noise. The participant picks a depth on arrival
  // and can change it from the panel; the choice is remembered.
  type DiagLevel = 'basic' | 'scientific' | 'advanced';
  const DIAG_LEVEL_KEY = 'parsec:diag-level';
  let diagLevel: DiagLevel | null = (() => {
    try {
      const v = localStorage.getItem(DIAG_LEVEL_KEY);
      if (v === 'basic' || v === 'scientific' || v === 'advanced') return v;
    } catch { /* fall through to the landing */ }
    // null means "not yet chosen" — show the landing.
    return null;
  })();

  function setDiagLevel(level: DiagLevel | null): void {
    diagLevel = level;
    try {
      if (level) localStorage.setItem(DIAG_LEVEL_KEY, level);
      else localStorage.removeItem(DIAG_LEVEL_KEY);
    } catch { /* best effort */ }
    events.record({ kind: 'participant', label: `diag-level:${level ?? 'landing'}`, outcome: 'ok' });
    renderPanel();
  }

  const PERIOD_KEY = 'parsec:matrix-period';
  let pricePeriod: ChangePeriod = (() => {
    try {
      const stored = localStorage.getItem(PERIOD_KEY);
      if (stored && (CHANGE_PERIODS as readonly string[]).includes(stored)) {
        return stored as ChangePeriod;
      }
    } catch { /* default stands */ }
    return '24h';
  })();

  /** The change to display for a coin, under the currently selected period. */
  function shownChange(coin: CoinPrice): { pct: number | null; observedMinutes?: number } {
    return changeFor(coin, pricePeriod);
  }

  /**
   * Colour for a change under the selected period.
   *
   * Follows the number actually on screen — a red figure on a green glyph would
   * be worse than no colour at all. An unknown is muted rather than green: we
   * are not claiming a direction we do not have. A value that rounds to flat at
   * the displayed precision gets the neutral tone, so a market drifting by
   * hundredths does not light up.
   */
  function changeTone(pct: number | null): string {
    if (pct === null) return 'rgba(200,210,220,0.45)';
    if (isFlat(pct)) return 'rgba(200,210,220,0.75)';
    return pct > 0 ? '#10b981' : '#ef4444';
  }

  /** Tooltip text naming the period, and the real span for derived figures. */
  function changeTitle(coin: CoinPrice): string {
    const { pct, observedMinutes } = shownChange(coin);
    return describeChange(coin.symbol, pct, pricePeriod, observedMinutes);
  }

  // Extending PARSEC to chainmarketcap is opt-in.
  //
  // Off by default because the wallet is complete without it: switching it on
  // is a decision to reach a service PARSEC does not need, and it is also the
  // gate on the modular contract deployer, which is OVERLORD-controlled in
  // /DeltaVerse and signed by bankon.eth. A capability that can deploy contracts
  // should never arrive switched on.
  const chainmarketcapPref = overlayPref('parsec:matrix-chainmarketcap', false);

  const matrixPref = overlayPref('parsec:matrix-rain', true);
  const cryptocloudPref = overlayPref('parsec:matrix-cryptocloud', false);
  const pyramidPref = overlayPref('parsec:matrix-pyramid', false);
  // How many brick rows the pyramid shows between the apex and the base (+/−
  // on the PYRAMID switch). More rows, more coins on the wall; the rest wait
  // in the base row.
  const PYRAMID_ROWS_KEY = 'parsec:matrix-pyramid-rows';
  const PYRAMID_ROWS_MIN = 2;
  const PYRAMID_ROWS_MAX = 14;
  let pyramidRows = (() => {
    try {
      const n = Number(localStorage.getItem(PYRAMID_ROWS_KEY));
      return Number.isInteger(n) && n >= PYRAMID_ROWS_MIN && n <= PYRAMID_ROWS_MAX ? n : 7;
    } catch { return 7; }
  })();
  const top10Pref = overlayPref('parsec:matrix-top10', false);
  const favouritesPref = overlayPref('parsec:matrix-favourites', false);
  const stablecoinsPref = overlayPref('parsec:matrix-stablecoins', false);
  // Permaweb diagnostics switches. These live INSIDE the blue pill rather than
  // on the overlay stack: they add instruments, they do not change the scene,
  // and a control that only does anything once you are already in diagnostics
  // belongs where its effect is visible. Two switches rather than one because
  // Arweave is the chain (height, consensus, node census) and AR.IO is the
  // gateway layer in front of it (reachability, nodetime, ArNS, the Solana
  // control plane). They fail independently -- every gateway can be down while
  // the chain is perfectly healthy -- so one combined panel would hide which
  // half broke. Persisted through overlayPref for the same localStorage
  // treatment every other switch gets.
  const arweavePref = overlayPref('parsec:matrix-arweave', false);
  const arioPref = overlayPref('parsec:matrix-ario', false);

  // Tab to open on the next blue-pill render. Flipping a switch on jumps to the
  // panel it just revealed; without this the re-render would drop you back on
  // Global and you would have to go find what you turned on.
  let blueInitialTab: string | null = null;

  // The six the operator watches: the chains PARSEC settles on plus the two
  // permaweb assets. Default ON, and the default rendering is the cloud --
  // these are pinned INTO the existing cryptocloud rather than given a second
  // renderer, so there is one price surface, not two that can disagree.
  const pricesPref = overlayPref('parsec:matrix-prices', true);
  // Newsfeed, default OFF. Ingestion is deliberately slow (see NEWS_MIN_INTERVAL)
  // and it reaches a third party, so it is opt-in rather than on by default.
  const newsPref = overlayPref('parsec:matrix-news', false);

  // ── Diagnostics profile ──
  //
  // A profile is a named snapshot of every choice above plus the assets the
  // diagnostics emphasise. The switches stay individually adjustable; the
  // profile bar in the Blue Pill marks the state "unsaved" when they drift from
  // the active profile, and saving captures them again.
  const FOCUS_KEY = 'parsec:diag-focus';
  let activeProfile: DiagProfile = profiles.getActiveProfile();
  let currentFocus: string[] = (() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(FOCUS_KEY) ?? 'null');
      if (Array.isArray(raw)) {
        const ids = raw.filter((id): id is string => typeof id === 'string' && focusAsset(id) !== undefined);
        if (ids.length > 0) return ids;
      }
    } catch { /* fall back to the profile */ }
    return [...activeProfile.focus];
  })();

  function saveFocus(): void {
    try { localStorage.setItem(FOCUS_KEY, JSON.stringify(currentFocus)); } catch { /* best effort */ }
  }

  // Wallets the Blue Pill watches. Public addresses only — watching reads
  // balances and never signs, sends or connects (lib/watch.ts).
  const WATCH_KEY = 'parsec:diag-watch';
  let currentWatch: WatchedWallet[] = (() => {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(WATCH_KEY) ?? 'null');
      if (Array.isArray(raw)) {
        return raw.map(sanitizeWatched).filter((w): w is WatchedWallet => w !== null);
      }
    } catch { /* fall back to the profile */ }
    return activeProfile.watch.map((w) => ({ ...w }));
  })();

  function saveWatch(): void {
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(currentWatch)); } catch { /* best effort */ }
  }

  /** The participant's current choices, in profile shape. */
  function captureChoices(): Omit<DiagProfile, 'id' | 'name' | 'builtin'> {
    return {
      focus: [...currentFocus],
      depth: diagLevel ?? activeProfile.depth,
      period: pricePeriod,
      scene: {
        matrix: matrixPref.on, cryptocloud: cryptocloudPref.on, top10: top10Pref.on,
        favourites: favouritesPref.on, stablecoins: stablecoinsPref.on, pyramid: pyramidPref.on,
      },
      panels: {
        arweave: arweavePref.on, ario: arioPref.on, chainmarketcap: chainmarketcapPref.on,
        prices: pricesPref.on, news: newsPref.on,
      },
      watch: currentWatch.map((w) => ({ ...w })),
    };
  }

  /**
   * Write a profile's choices into the live state. No rendering here: this also
   * runs during setup, before the layers it would repaint exist.
   */
  function adoptChoices(p: DiagProfile): void {
    matrixPref.set(p.scene.matrix);
    cryptocloudPref.set(p.scene.cryptocloud);
    top10Pref.set(p.scene.top10);
    favouritesPref.set(p.scene.favourites);
    stablecoinsPref.set(p.scene.stablecoins);
    pyramidPref.set(p.scene.pyramid);
    arweavePref.set(p.panels.arweave);
    arioPref.set(p.panels.ario);
    chainmarketcapPref.set(p.panels.chainmarketcap);
    pricesPref.set(p.panels.prices);
    newsPref.set(p.panels.news);
    diagLevel = p.depth;
    try { localStorage.setItem(DIAG_LEVEL_KEY, p.depth); } catch { /* best effort */ }
    pricePeriod = p.period;
    try { localStorage.setItem(PERIOD_KEY, p.period); } catch { /* best effort */ }
    currentFocus = [...p.focus];
    saveFocus();
    currentWatch = p.watch.map((w) => ({ ...w }));
    saveWatch();
    // The favourites selection is the participant's own landing choice and is
    // deliberately not part of a profile: applying one never rewrites it.
  }

  // First run of profiles on this device: the PARSEC profile is seeded from the
  // participant's own selections as they stand — the landing toggles, the
  // extension switches, the depth and the period — plus the PARSEC emphasis
  // assets. Nothing the participant already chose is overwritten.
  if (!profiles.isParsecSeeded()) {
    activeProfile = profiles.seedParsecProfile(captureChoices());
  }
  const PINNED_PRICES: ReadonlyArray<{ id: string; symbol: string }> = [
    { id: 'bitcoin', symbol: 'BTC' },
    { id: 'ethereum', symbol: 'ETH' },
    { id: 'solana', symbol: 'SOL' },
    { id: 'algorand', symbol: 'ALGO' },
    { id: 'arweave', symbol: 'AR' },
    { id: 'ar-io-network', symbol: 'ARIO' },
  ];
  const PINNED_SYMBOLS = new Set(PINNED_PRICES.map(p => p.symbol));

  /**
   * Pinned coins the main feed does not carry.
   *
   * `fetchPrices()` reads the top 100 by market cap, which covers five of the
   * six; ARIO sits far below that cut, so it has to be fetched by id. Held
   * separately rather than merged into `prices` because the 5-minute refresh
   * replaces that array wholesale and would drop them every cycle.
   */
  let pinnedExtras: CoinPrice[] = [];

  async function refreshPinnedExtras(): Promise<void> {
    if (!pricesPref.on) { pinnedExtras = []; return; }
    const missing = PINNED_PRICES.filter(
      p => !prices.some(c => c.symbol === p.symbol),
    );
    if (missing.length === 0) { pinnedExtras = []; return; }
    try {
      // fetchPricesByIds is cached on the same 5-minute TTL as the main feed,
      // so this does not add a call per refresh -- which matters, because the
      // free CoinGecko tier 429s readily.
      pinnedExtras = await fetchPricesByIds(missing.map(p => p.id));
    } catch {
      pinnedExtras = []; // a missing price is a blank row, not a broken panel
    }
  }

  /** The cloud's source: the live feed plus any pinned coins it lacks. */
  function pricePool(): CoinPrice[] {
    if (!pricesPref.on) return prices;
    return [...prices, ...pinnedExtras.filter(e => !prices.some(p => p.symbol === e.symbol))];
  }

  // Identity typed into the red pill ('mindx.algo' or a raw address). It only
  // SELECTS which local key to open — the passphrase still authenticates.
  // Re-resolved at unlock time rather than cached here, so account recovery
  // running first cannot leave a stale index behind.
  let identityInput = '';
  let passphrase = '';
  let zoom = 1.0;
  let prices: CoinPrice[] = [];
  let cryptoGlyphs: CryptoGlyph[] = [];
  /** The zones the current cloud was laid out in; the frame loop hands them to the physics. */
  let cloudZoneList: CloudZone[] = [];
  /** Where each coin's glyph last was, by coin id. */
  const cloudLastPos = new Map<string, { x: number; y: number; vx: number; vy: number }>();

  const container = el('div', { cls: 'parsec-matrix' });
  const canvas = document.createElement('canvas');
  canvas.className = 'parsec-matrix__canvas';
  container.appendChild(canvas);
  container.appendChild(el('div', { cls: 'parsec-matrix__overlay' }));

  // Pyramid — top winners and losers of the hour
  const pyramidLayer = el('div', { cls: 'parsec-matrix__pyramid' });
  container.appendChild(pyramidLayer);

  // Left-hand column layer — TOP 10 and FAVOURITES. Separate from pyramidLayer
  // so a pyramid rebuild cannot wipe it.
  const fleetLayer = el('div', { cls: 'parsec-fleet-layer' });
  container.appendChild(fleetLayer);

  // Crypto glyph overlay layer (HTML on top of WebGL)
  const glyphLayer = el('div', { cls: 'parsec-matrix__glyph-layer' });
  container.appendChild(glyphLayer);

  // Price tooltip
  const tooltip = el('div', { cls: 'parsec-matrix__tooltip' });
  container.appendChild(tooltip);

  // ── Drag-and-drop utility for floating matrix elements ──
  // Where the participant has dragged things.
  //
  // The ship, the fleet column and the pyramid are rebuilt from scratch on every
  // price tick, which threw away any position the participant had chosen — drag
  // the top-10 column somewhere useful and it snapped back within the minute.
  // Keyed by role rather than element identity, because the element itself is a
  // different object after each rebuild.
  const dragPositions = new Map<string, { left: string; top: string }>();

  /** Re-apply a remembered position, if this role has one. */
  function restoreDragPosition(element: HTMLElement, key: string): void {
    const saved = dragPositions.get(key);
    if (!saved) return;
    element.style.left = saved.left;
    element.style.top = saved.top;
    element.style.right = 'auto';
    element.style.bottom = 'auto';
    element.style.transform = 'none';
  }

  // One set of window drag listeners for the whole view, dispatching to the
  // element being dragged. makeDraggable runs on every fleet and ship rebuild —
  // every price tick, toggle and period change — and used to register four
  // window listeners each time. Tied to the view with bindGlobal, those still
  // piled up for as long as the landing stayed open: eight per minute, each
  // holding a discarded element, all of them running on every mousemove.
  let activeDrag: { move(x: number, y: number): void; up(): void } | null = null;
  const onWindowDragMove = (e: MouseEvent) => activeDrag?.move(e.clientX, e.clientY);
  const onWindowDragTouch = (e: TouchEvent) => {
    const t = e.touches[0];
    if (t) activeDrag?.move(t.clientX, t.clientY);
  };
  const onWindowDragUp = () => { activeDrag?.up(); activeDrag = null; };
  bindGlobal(window, 'mousemove', onWindowDragMove);
  bindGlobal(window, 'mouseup', onWindowDragUp);
  bindGlobal(window, 'touchmove', onWindowDragTouch, { passive: true });
  bindGlobal(window, 'touchend', onWindowDragUp);

  function makeDraggable(element: HTMLElement, key?: string) {
    let dragOffsetX = 0, dragOffsetY = 0;
    let elemDragging = false;
    if (key) restoreDragPosition(element, key);

    const onDown = (clientX: number, clientY: number) => {
      elemDragging = true;
      const rect = element.getBoundingClientRect();
      dragOffsetX = clientX - rect.left;
      dragOffsetY = clientY - rect.top;
      element.style.cursor = 'grabbing';
      element.style.zIndex = '50';
      activeDrag = { move: onMove, up: onUp };
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
      if (elemDragging && key) {
        dragPositions.set(key, { left: element.style.left, top: element.style.top });
      }
      elemDragging = false;
      element.style.cursor = '';
      element.style.zIndex = '';
    };

    // Listeners on `element` die with the element; the window side is the
    // shared set above, which only ever points at the element being dragged.
    element.addEventListener('mousedown', (e) => { e.stopPropagation(); onDown(e.clientX, e.clientY); });
    element.addEventListener('touchstart', (e) => { e.stopPropagation(); const t = e.touches[0]; onDown(t.clientX, t.clientY); }, { passive: true });
  }

  // ── PARSEC brand — click opens pill choice screen ──
  const brandEl = el('div', { cls: 'parsec-matrix__brand parsec-matrix__brand--floating', children: [
    el('span', { text: 'PARSEC' }),
  ]});
  brandEl.addEventListener('click', () => setPill('choose'));

  /**
   * The favourites chooser, opened by pressing and holding FAVOURITES.
   *
   * A small panel rather than a route: choosing which coins to watch is a
   * setting on the control you are already touching, and sending someone to a
   * different screen to tick eight boxes would be worse than the problem.
   *
   * Closes on Escape, on a click outside, and on Done — and every one of those
   * listeners is registered through the view lifecycle so nothing outlives it.
   */
  // The open chooser's full close — panel and its document listeners together.
  // Toggling the chooser shut used to remove only the panel.
  let closeChooser: (() => void) | null = null;
  onCleanup(() => closeChooser?.());

  function openFavouritesChooser(): void {
    if (closeChooser) { closeChooser(); return; }

    const panel = el('div', { cls: 'parsec-favchooser' });
    panel.appendChild(el('div', { cls: 'parsec-favchooser__title', text: 'SHOW WHICH FAVOURITES' }));

    const list = el('div', { cls: 'parsec-favchooser__list' });
    for (const id of FAVOURITE_COINS) {
      const label = FAVOURITE_LABELS[id] ?? id;
      const row = el('label', { cls: 'parsec-favchooser__row' });

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'parsec-favchooser__box';
      box.checked = favouriteSelection.has(id);
      box.addEventListener('change', () => {
        if (box.checked) favouriteSelection.add(id);
        else favouriteSelection.delete(id);
        saveFavouriteSelection();
        renderFleet();
      });

      row.appendChild(box);
      row.appendChild(el('span', { cls: 'parsec-favchooser__label', text: label }));
      list.appendChild(row);
    }
    panel.appendChild(list);

    const actions = el('div', { cls: 'parsec-favchooser__actions' });
    const setAll = (on: boolean) => {
      favouriteSelection = on ? new Set(FAVOURITE_COINS) : new Set();
      saveFavouriteSelection();
      for (const b of list.querySelectorAll('input')) (b as HTMLInputElement).checked = on;
      renderFleet();
    };
    actions.appendChild(btn('All', { minimal: true, onClick: () => setAll(true) }));
    actions.appendChild(btn('None', { minimal: true, onClick: () => setAll(false) }));
    actions.appendChild(btn('Done', {
      minimal: true, intent: 'primary',
      onClick: () => { close(); },
    }));
    panel.appendChild(actions);

    function close(): void {
      panel.remove();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside, true);
      if (closeChooser === close) closeChooser = null;
    }
    closeChooser = close;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    }
    function onOutside(e: PointerEvent): void {
      if (!panel.contains(e.target as Node)) close();
    }

    document.addEventListener('keydown', onKey);
    // Deferred: the pointerup that ended the long press would otherwise be seen
    // as the click-outside that closes the panel we just opened.
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
    // View teardown closes it through the single onCleanup registered above.

    container.appendChild(panel);
  }

  // ── Overlay toggles ─────────────────────────────────────────
  // Controls the participant holds, not scroll tricks: each overlay is either on
  // the wall or it isn't, and the choice is remembered.
  //
  // Stacked bottom-right, in the order set below.
  const toggleStack = el('div', { cls: 'parsec-matrix__toggles' });
  /** Repaint every landing toggle — after a profile rewrites their state. */
  const toggleRepaints: Array<() => void> = [];

  function makeToggle(
    label: string,
    pref: OverlayPref,
    noun: string,
    onHold?: () => void,
  ): HTMLElement {
    const b = el('button', { cls: 'parsec-matrix__toggle', attrs: { type: 'button' } });
    const paint = () => {
      b.textContent = `${label} ${pref.on ? 'ON' : 'OFF'}`;
      b.setAttribute('aria-pressed', String(pref.on));
      b.title = onHold
        ? `${pref.on ? `Hide ${noun}` : `Show ${noun}`} — press and hold to choose which`
        : (pref.on ? `Hide ${noun}` : `Show ${noun}`);
      b.classList.toggle('parsec-matrix__toggle--off', !pref.on);
      b.classList.toggle('parsec-matrix__toggle--holdable', Boolean(onHold));
    };

    // Press and hold opens the chooser; a normal click still toggles.
    //
    // `held` suppresses the click that a mouseup would otherwise fire, so the
    // hold does not also flip the switch it was opened from.
    if (onHold) {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let held = false;
      const HOLD_MS = 450;

      const start = () => {
        held = false;
        timer = setTimeout(() => {
          held = true;
          b.classList.remove('parsec-matrix__toggle--holding');
          onHold();
        }, HOLD_MS);
        b.classList.add('parsec-matrix__toggle--holding');
      };
      const cancel = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        b.classList.remove('parsec-matrix__toggle--holding');
      };

      b.addEventListener('pointerdown', start);
      b.addEventListener('pointerup', cancel);
      b.addEventListener('pointerleave', cancel);
      b.addEventListener('pointercancel', cancel);
      // Keyboard parity: a long press is not reachable by keyboard, so give the
      // chooser its own key rather than leaving it mouse-only.
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); onHold(); }
      });
      b.addEventListener('click', (e) => {
        if (held) { e.stopImmediatePropagation(); e.preventDefault(); held = false; }
      }, true);
    }

    b.addEventListener('click', () => {
      pref.toggle();
      paint();
      applyOverlays();
      // The fleet and ship live in renderPyramid, the cloud in createGlyphs, so
      // toggling rebuilds rather than restyles. Both redraw from `prices`
      // already in memory — no network call, which matters on a feed we are
      // deliberately only polling every five minutes.
      renderPyramid();
      createGlyphs();
    });
    paint();
    toggleRepaints.push(paint);
    return b;
  }

  // Period selector. Cycles rather than toggles, so it needs its own builder.
  const periodToggle = el('button', {
    cls: 'parsec-matrix__toggle parsec-matrix__toggle--period',
    attrs: { type: 'button' },
  });
  function paintPeriod(): void {
    periodToggle.textContent = `CHANGE ${pricePeriod.toUpperCase()}`;
    periodToggle.title =
      'Period every percentage is measured over. 1h, 24h, 7d and 30d come from the feed; '
      + '4h is measured here and shows a dash until about two hours have been watched.';
  }
  periodToggle.addEventListener('click', () => {
    const i = CHANGE_PERIODS.indexOf(pricePeriod);
    pricePeriod = CHANGE_PERIODS[(i + 1) % CHANGE_PERIODS.length];
    try { localStorage.setItem(PERIOD_KEY, pricePeriod); } catch { /* best effort */ }
    paintPeriod();
    // Redraw from prices already in memory — changing the period must never
    // cost a request on a feed we poll every five minutes. The pyramid re-forms
    // (its order IS the period); the cloud only rewrites its figures -- its
    // placement follows the 24h move, so rebuilding it would reshuffle and
    // re-measure every glyph for nothing.
    renderPyramid();
    refreshCloudFigures();
  });
  paintPeriod();
  toggleRepaints.push(paintPeriod);
  /** + PYRAMID ON − : the switch, with a row more on the left and a row fewer on the right. */
  function pyramidToggleGroup(): HTMLElement {
    const toggle = makeToggle('PYRAMID', pyramidPref, 'the market pyramid');
    const step = (sign: 1 | -1, text: string, what: string) => {
      const b = el('button', { cls: 'parsec-matrix__toggle parsec-matrix__toggle-step', text, attrs: { type: 'button', 'aria-label': what } });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = Math.min(PYRAMID_ROWS_MAX, Math.max(PYRAMID_ROWS_MIN, pyramidRows + sign));
        if (next === pyramidRows) return;
        pyramidRows = next;
        try { localStorage.setItem(PYRAMID_ROWS_KEY, String(next)); } catch { /* best effort */ }
        // Switching on through the switch itself repaints its label and shows the layer.
        if (!pyramidPref.on) toggle.click();
        renderPyramid();
        paintSteps();
      });
      return b;
    };
    const plus = step(1, '+', 'Show one more pyramid row');
    const minus = step(-1, '−', 'Show one fewer pyramid row');
    const paintSteps = () => {
      plus.toggleAttribute('disabled', pyramidRows >= PYRAMID_ROWS_MAX);
      minus.toggleAttribute('disabled', pyramidRows <= PYRAMID_ROWS_MIN);
      plus.title = `${pyramidRows} rows — add one`;
      minus.title = `${pyramidRows} rows — remove one`;
    };
    paintSteps();
    return el('div', { cls: 'parsec-matrix__toggle-group', children: [plus, toggle, minus] });
  }

  // Top to bottom: CHANGE, MATRIX, PYRAMID, TOP 10, CRYPTOCLOUD, STABLECOINS,
  // FAVOURITES. Broadly short to long so the stack widens toward its corner,
  // with TOP 10 kept under PYRAMID and FAVOURITES last -- the participant's
  // arrangement, not a computed one.
  toggleStack.append(
    periodToggle,
    makeToggle('MATRIX', matrixPref, 'the matrix rain'),
    pyramidToggleGroup(),
    makeToggle('TOP 10', top10Pref, 'the top 10 by market cap'),
    makeToggle('CRYPTOCLOUD', cryptocloudPref, 'the winds of change — the drifting price cloud, where gainers float and losers fall'),
    makeToggle('STABLECOINS', stablecoinsPref, 'the stablecoin liquidity ship'),
    makeToggle('FAVOURITES', favouritesPref, 'your favourites', openFavouritesChooser),
  );
  container.appendChild(toggleStack);

  // Assert the initial state now that the brand and every layer exist. Without
  // this the first paint would show whatever the markup happened to default to
  // until the participant touched a toggle.
  applyOverlays();

  // Market-feed state. The pyramid needs 10+ coins to draw; when the feed is
  // down it used to vanish with no explanation, which reads as a broken app
  // rather than an unreachable endpoint. Say which it is.
  const feedNote = el('div', { cls: 'parsec-matrix__feednote' });
  container.appendChild(feedNote);

  function paintFeed(): void {
    const { status, detail } = getFeedStatus();
    const dead = prices.length < 10;
    feedNote.textContent = dead ? `Market feed ${status} — ${detail}` : '';
    feedNote.dataset.tone = status === 'live' ? 'ok' : status === 'stale' ? 'warn' : 'alert';
  }
  brandEl.style.cursor = 'pointer';
  makeDraggable(brandEl, 'brand');
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
    scheduleCloudRebuild();
  }, { passive: false });

  // The cloud's collision boxes are measured at build time, so anything that
  // changes a glyph's size on screen -- zoom, a window resize -- rebuilds it
  // once the change settles. Rescaling fonts in place left the boxes at the old
  // size, and the glyphs grew into each other.
  let cloudRebuildTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleCloudRebuild() {
    if (cloudRebuildTimer) clearTimeout(cloudRebuildTimer);
    cloudRebuildTimer = setTimeout(() => { cloudRebuildTimer = undefined; createGlyphs(); }, 250);
  }
  bindGlobal(window, 'resize', scheduleCloudRebuild);

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
    // Pyramid first: the cloud measures it (and the ship) as obstacles.
    renderPyramid();
    createGlyphs();
    paintFeed();
    // Re-resolve pinned coins the top-100 feed does not carry, then redraw.
    // Without this ARIO would only ever appear after someone clicked the
    // switch, and would vanish again on the next 5-minute refresh.
    void refreshPinnedExtras().then(() => {
      if (pinnedExtras.length > 0) createGlyphs();
    });
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

    resize(); bindGlobal(window, 'resize', resize);
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
    // Blue pill: slow contemplative drift — barely responds to market noise
    // Sentiment color still shows direction, but the pace is meditative
    const effectiveActivity = choice === 'blue' ? 0.04 + activityUniform * 0.06 : activityUniform;
    setUniform('u_activity', effectiveActivity);
    setUniform('u_sentiment', sentimentUniform);
    setUniform('u_dragX', dragRotX);
    setUniform('u_dragY', dragRotY);
    setUniform('u_breadth', breadth.greenPct / 100.0);
    setUniform('u_glitch', glitchUniform);
    setUniform('u_spin', spinAngle);
    // Rain off: clear once and skip the draw. Hiding the canvas with CSS would
    // leave the shader running every frame for pixels nobody sees, which is a
    // real cost on a laptop battery.
    if (matrixPref.on) {
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

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
    stopPrices();
    if (glyphRotationTimer) clearInterval(glyphRotationTimer);
    glyphRotationTimer = null;
  }

  // Teardown was previously wired only to specific navigation buttons — seven of
  // them — so leaving the matrix any other way (back, command palette, a keyboard
  // shortcut, a store.navigate from elsewhere) left the animation loop, the glyph
  // rotation timer and the price poller running for the life of the process.
  // Registering it here means the router always runs it, however the view is left.
  // The explicit calls below are now redundant but harmless: every operation in
  // cancelAnimation is idempotent.
  onCleanup(cancelAnimation);
  // Release the GPU context with the view. Without this every visit to the
  // Matrix left a WebGL context alive until the browser reclaimed it, and
  // browsers cap live contexts — the oldest are lost without warning.
  onCleanup(() => {
    try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already gone */ }
    gl = null;
  });

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
    // Its anchors are about to be rebuilt; a panel pinned to one would orphan.
    dropCoinPanel();
    glyphLayer.innerHTML = '';
    glyphLayer.classList.remove('parsec-matrix__glyph-layer--storm');
    cryptoGlyphs = [];
    if (pricePool().length === 0 || !cryptocloudPref.on) return;

    // Where the cloud may draw, given what else is on the wall. Top-right when
    // the columns and the pyramid are up; the whole screen when it is alone.
    // One rectangle with the pyramid down; a left and a right channel per
    // height tier with it up. The channels never meet, so a glyph cannot cross
    // the pyramid -- and each tier keeps its own slice of the full height, so
    // price still reads as height on both sides.
    // The toggle menu, the brand and the stablecoin ship are obstacles exactly
    // as the pyramid is: their measured footprints are cut out of the zones, so no
    // glyph drifts in behind them. Measured, not assumed -- both change size
    // with their content, and the ship can be dragged anywhere.
    const layerRect = glyphLayer.getBoundingClientRect();
    const obstacles: CloudZone[] = [];
    // The pyramid's rows too, as they actually rendered. The fixed pyramid
    // model in cloudZones matches one screen shape; on a smaller window the
    // real pyramid sits lower and wider and glyphs landed on its cards.
    const blockers = [
      toggleStack,
      // The brand sits at the top centre -- exactly where gainers float to.
      brandEl,
      ...Array.from(container.querySelectorAll<HTMLElement>('.parsec-ship, .parsec-fleet-column')),
      ...(pyramidPref.on ? Array.from(container.querySelectorAll<HTMLElement>('.parsec-pyramid__row')) : []),
    ];
    for (const b of blockers) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || layerRect.width === 0) continue;
      obstacles.push({
        x0: (r.left - layerRect.left) / layerRect.width,
        x1: (r.right - layerRect.left) / layerRect.width,
        y0: (r.top - layerRect.top) / layerRect.height,
        y1: (r.bottom - layerRect.top) / layerRect.height,
      });
    }
    const zones = cloudZoneList = avoidObstacles(cloudZones({
      top10: top10Pref.on,
      favourites: favouritesPref.on,
      stablecoins: stablecoinsPref.on,
      pyramid: pyramidPref.on,
    }), obstacles);
    // The wall the buoyancy scale is measured over. Taken across every channel
    // rather than per channel: a coin's height must mean the same thing on the
    // left of the pyramid as on the right.
    const wallY0 = Math.min(...zones.map((z: CloudZone) => z.y0));
    const wallY1 = Math.max(...zones.map((z: CloudZone) => z.y1));

    // Pixel sizes have to become normalized units to reason about overlap, so
    // the placement needs the layer's real dimensions.
    const layerW = glyphLayer.clientWidth || container.clientWidth || 1200;
    const layerH = glyphLayer.clientHeight || container.clientHeight || 800;

    const pool = pricePool();
    const selected: CoinPrice[] = [];

    // "Just because" — always featured, separate from algorithm
    FEATURED_SYMBOLS.clear();

    // Pinned six first. They bypass the market-cap floor further down on
    // purpose: ARIO's cap is well under it, and a switch labelled with an asset
    // that then refuses to draw it would be lying.
    if (pricesPref.on) {
      for (const c of pool.filter(c => PINNED_SYMBOLS.has(c.symbol))) {
        FEATURED_SYMBOLS.add(c.symbol);
        if (!selected.includes(c)) selected.push(c);
      }
    }
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

    // Size-aware placement.
    //
    // The previous rule was a flat 14%-of-screen gap between glyph CENTRES,
    // which cannot be right for both a 12px background glyph and a 42px featured
    // one: it let large glyphs collide while small ones wasted the zone. Each
    // glyph now carries its own measured extent and `findSpot` clears them by
    // area, so every currency stays readable.
    const occupied: CloudBox[] = [];

    /** A glyph's footprint in normalized units, from its font size. */
    function glyphBox(sizePx: number): { w: number; h: number } {
      // Three stacked lines (symbol, price, change); the price is the widest.
      return { w: (sizePx * 4.6) / layerW, h: (sizePx * 3.1) / layerH };
    }

    /** How many glyphs each channel already holds, for left/right balance. */
    const zoneLoad = new Array(zones.length).fill(0);

    function findOpenSpot(
      sizePx: number,
      zoneIdx: number,
      preferred?: { x: number; y: number },
    ): CloudBox {
      const { w, h } = glyphBox(sizePx);
      const z = zones[zoneIdx];
      // Clamp the preference into THIS channel. A buoyancy y computed over the
      // whole wall can land outside the tier that was chosen for it, and an
      // out-of-range preference would be clamped to the channel's corner.
      const pref = preferred
        ? {
            x: Math.min(Math.max(preferred.x, z.x0), z.x1),
            y: Math.min(Math.max(preferred.y, z.y0), z.y1),
          }
        : undefined;
      const spot = findSpot(
        z, { x: pref?.x ?? 0, y: pref?.y ?? 0, w, h }, occupied,
        Math.random, CLOUD_GAP, pref,
      );
      occupied.push(spot);
      zoneLoad[zoneIdx]++;
      return spot;
    }

    /**
     * Which channel a glyph belongs in, given the height its price earned it.
     *
     * Height wins: the tiers containing that y are the candidates. Only the
     * side is free, and that goes to whichever channel is emptier, so gainers
     * do not all pile up on one flank of the pyramid.
     */
    function zoneFor(y: number): number {
      let candidates: number[] = [];
      for (let i = 0; i < zones.length; i++) {
        if (y >= zones[i].y0 && y <= zones[i].y1) candidates.push(i);
      }
      if (candidates.length === 0) {
        // Above the top tier or below the bottom one — take the nearest.
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < zones.length; i++) {
          const d = Math.min(Math.abs(y - zones[i].y0), Math.abs(y - zones[i].y1));
          if (d < bestD) { bestD = d; best = i; }
        }
        candidates = [best];
      }
      return candidates.reduce((a, b) => (zoneLoad[a] <= zoneLoad[b] ? a : b));
    }

    /**
     * The winds of change: a coin's move, turned into how it floats.
     *
     * Reads `change24h` rather than the selected display period because it is
     * the one figure always present -- the short-horizon changes are null until
     * the wallet has sampled long enough, and an unknown must not read as
     * sinking. Normalized against a 5% day, which is where a move stops being
     * noise; beyond that the glyph is already pinned to the top or bottom of
     * the zone and further movement shows up as speed instead of height.
     */
    // The pyramid's hierarchy classes the cloud: the same ranking over the
    // selected period decides who floats and who sinks, and rank sets how hard.
    const classes = classify(pool, (c) => shownChange(c).pct);
    function buoyancy(coin: CoinPrice) {
      const pct = shownChange(coin).pct ?? 0;
      const k = classes.get(coin) ?? { side: 'flat' as const, strength: 0 };
      const norm = k.side === 'rise' ? k.strength : k.side === 'fall' ? -k.strength : 0;
      const zh = wallY1 - wallY0;
      // y grows downward, so a rising coin takes a SMALLER y. 0.12..0.88 keeps
      // the extremes off the zone edge, where a glyph would sit half-clipped.
      const y = wallY0 + (0.5 - norm * 0.38) * zh;
      const strength = Math.abs(norm);
      return {
        pct,
        norm,
        y,
        side: k.side,
        rising: k.side === 'rise',
        falling: k.side === 'fall',
        // Bigger moves float faster. Gravity is not symmetric with lift: a drop
        // accelerates harder than a rise floats, which is what makes a falling
        // price read as falling rather than as drifting downward.
        speed: norm < 0 ? strength * 1.35 : strength,
        // How far it travels per cycle, in em. A flat coin barely stirs.
        lift: 0.35 + strength * 1.15,
      };
    }

    // Trim the cloud to what the zone can actually display.
    //
    // GLYPH_SLOTS is a wish, not a guarantee: the same ten glyphs that sit
    // comfortably on the whole wall collide in a top-right corner. Sizing the
    // count to the area is what makes "each currency can be viewed" true rather
    // than aspirational — and it means switching the other overlays off genuinely
    // reveals more of the market, instead of just spreading the same ten out.
    // Size the capacity estimate on the FEATURED glyphs, not an average.
    // They render at roughly 24-42px against 12-28px for background glyphs, and
    // they are the ones that collide — an average-sized cell over-counts how
    // many of the big ones fit, which is what left POL sitting on ETH.
    const typicalSize = 36 * zoom;
    // The gap is part of each glyph's cell: the motion keeps CLOUD_GAP clear
    // around every glyph, so a count that ignored it would pack the zone
    // tighter than the bodies can hold apart.
    const cell = {
      w: (typicalSize * 4.6) / layerW + CLOUD_GAP,
      h: (typicalSize * 3.1) / layerH + CLOUD_GAP,
    };
    // Summed across channels: with the pyramid up the wall is several narrow
    // rectangles, and measuring only the largest would cull glyphs that the
    // other channels had room for.
    const fits = zones.reduce(
      (n: number, z: CloudZone) => n + capacity(z, cell, selected.length),
      0,
    );
    if (selected.length > fits) selected.length = fits;

    // The cloud's weather, read once for the whole layer.
    const weather = cloudWeather(selected);
    // Drift speed comes from the same market-activity figure that drives the
    // rain, so the cloud and the rain never disagree about how busy the market
    // is. A storm shortens it further.
    const drift = driftSeconds(activityUniform, weather.storm);
    glyphLayer.classList.toggle('parsec-matrix__glyph-layer--storm', weather.storm);
    cloudStorm = weather.storm;
    glyphLayer.style.setProperty('--parsec-cloud-drift', `${drift.toFixed(2)}s`);

    for (let i = 0; i < selected.length; i++) {
      const coin = selected[i];
      const vol = Math.abs(coin.change24h);
      const volFactor = Math.min(1.0, vol / 5.0);
      const isFeatured = FEATURED_SYMBOLS.has(coin.symbol);

      // Size before position: placement is size-aware, so the footprint has to
      // be known before a spot can be chosen for it.
      const depth = isFeatured ? 0.8 + Math.random() * 0.2 : 0.3 + Math.random() * 0.7;
      const baseSize = isFeatured
        ? (24 + volFactor * 12 + depth * 6) * zoom
        : (12 + volFactor * 10 + depth * 6) * zoom;

      // Featured coins prefer a zigzag down the zone; the placer honours that
      // when it is free and moves them when it is not. Expressed as fractions of
      // the zone rather than fixed coordinates, so it still reads correctly when
      // the cloud has the whole wall.
      // Height is the price move. Featured coins keep their zigzag across the
      // zone so they stay legible as a set, but their HEIGHT now comes from the
      // same buoyancy every other glyph obeys -- otherwise the featured ones
      // would be the only glyphs on the wall whose position meant nothing.
      const buoy = buoyancy(coin);
      const zi = zoneFor(buoy.y);
      const z = zones[zi];
      const zw = z.x1 - z.x0;
      let pos: CloudBox;
      if (isFeatured) {
        const fIdx = [...FEATURED_SYMBOLS].indexOf(coin.symbol);
        const fx = z.x0 + (fIdx % 2 === 0 ? 0.25 : 0.72) * zw;
        pos = findOpenSpot(baseSize, zi, { x: fx, y: buoy.y });
      } else {
        pos = findOpenSpot(baseSize, zi, {
          x: z.x0 + (0.08 + Math.random() * 0.84) * zw,
          y: buoy.y,
        });
      }
      // The geometry reasons about CENTRES; CSS `left`/`top` position the top-left
      // EDGE. Converting here is what keeps a glyph from being clipped at the
      // zone's right edge — and it is what makes the overlap test describe where
      // the glyph actually lands rather than where its corner does.
      const x = pos.x - pos.w / 2;
      const y = pos.y - pos.h / 2;
      const baseOpacity = isFeatured
        ? 0.25 + volFactor * 0.35 + depth * 0.15
        : 0.06 + volFactor * 0.25 + depth * 0.1;

      const glyph: CryptoGlyph = {
        coin, x, y, size: baseSize,
        // Lift from the hierarchy: gainers rise, losers sink, flat coins hang.
        // The last-ranked mover still gets a quarter-strength lift, so it floats
        // (or sinks) all the way; a higher rank rises faster and hits harder.
        body: makeBody(
          pos, z, i * 0.37 + Math.random(), buoy.speed, isFeatured,
          buoy.norm,
        ),
      };
      cryptoGlyphs.push(glyph);

      // Color — blue pill = red glyphs (selling), otherwise normal market colors
      const featuredBoost = isFeatured ? 1.4 : 1.0;
      let color: string;
      if (choice === 'blue') {
        // Blue pill = selling/diagnostics = red glyphs
        color = `rgba(255,80,80,${baseOpacity * featuredBoost})`;
      } else {
        // Landing + red pill = normal market color (green if up, red if down)
        color = cloudColor(buoy.side, baseOpacity * featuredBoost);
      }
      glyph.alpha = baseOpacity * featuredBoost;
      glyph.isFeatured = isFeatured;

      // A coin moving 1% or more in fifteen minutes gets the candle border. It
      // is a statement about right now, so it is deliberately not shown while
      // change15m is still null — an unknown is not a calm market.
      const surging = isSurging(coin);
      const hourlyVolatile = Math.abs(coin.change1h) >= 1;

      // Drift duration per glyph: the layer's market-wide figure is the calm
      // baseline, and a coin's own move shortens it. Floored at 4s so a violent
      // mover agitates rather than strobing.
      const glyphDrift = Math.max(4, drift * (1 - buoy.speed * 0.62));

      const glyphEl = el('div', {
        cls: [
          'parsec-matrix__crypto-glyph',
          volFactor > 0.3 ? 'parsec-matrix__crypto-glyph--volatile' : '',
          hourlyVolatile ? 'parsec-matrix__crypto-glyph--hourly' : '',
          surging ? 'parsec-matrix__crypto-glyph--surge' : '',
          // Direction of travel, from the actual number: up floats, down falls.
          buoy.rising ? 'parsec-matrix__crypto-glyph--rising' : '',
          buoy.falling ? 'parsec-matrix__crypto-glyph--falling' : '',
        ].filter(Boolean).join(' '),
        attrs: {
          'data-coin': coin.id,
          // Per-glyph drift phase so they do not all breathe in lockstep.
          style: `left:${x * 100}%;top:${y * 100}%;font-size:${baseSize}px;color:${color};text-shadow:0 0 ${4 + volFactor * 16}px ${color};z-index:${Math.round(depth * 10)};--parsec-cloud-phase:${(i * 0.37).toFixed(2)}s;--parsec-glyph-drift:${glyphDrift.toFixed(2)}s;--parsec-glyph-lift:${buoy.lift.toFixed(2)}em`,
        },
        children: [
          el('span', { cls: 'parsec-matrix__glyph-symbol', text: coin.symbol }),
          glyph.priceEl = el('span', { cls: 'parsec-matrix__glyph-price', text: formatPrice(coin.usd), attrs: { style: `color:${color}` } }),
          glyph.changeEl = el('span', {
            cls: 'parsec-matrix__glyph-change',
            text: formatPercent(shownChange(coin).pct),
            attrs: {
              style: `color:${choice === 'blue' ? '#ef4444' : changeTone(shownChange(coin).pct)}`,
              title: changeTitle(coin),
            },
          }),
        ],
      });

      // Hover info panel on floating glyphs too
      glyphEl.addEventListener('mouseenter', () => showCoinPanel(coin, glyphEl));
      glyphEl.addEventListener('mouseleave', () => hideCoinPanel());

      glyph.el = glyphEl;
      glyphLayer.appendChild(glyphEl);
    }

    settleCloud(layerW, layerH);

    // Rotate selection every 20 seconds — new random coins surface
    if (glyphRotationTimer) clearInterval(glyphRotationTimer);
    glyphRotationTimer = setInterval(() => {
      if (prices.length > GLYPH_SLOTS) createGlyphs();
    }, 20000);
  }

  /**
   * Give every body its real, rendered size, then spread the homes so none
   * overlap at that size. Whatever still cannot fit is removed -- least
   * important first (featured coins are kept) -- because a glyph that has no
   * room is better off the wall than stacked on another.
   */
  /** Rewrite each cloud glyph's percentage for the current period, in place. */
  function refreshCloudFigures() {
    // Re-class by the new period: a coin that was a gainer over 24h can be a
    // loser over 4h. Its lift, weight and colour change where it is -- the
    // physics then carries it up or down from there.
    const classes = classify(pricePool(), (c) => shownChange(c).pct);
    const byId = new Map([...classes].map(([c, k]) => [c.id, k]));
    for (const g of cryptoGlyphs) {
      const pct = shownChange(g.coin).pct;
      const k = byId.get(g.coin.id) ?? { side: 'flat' as const, strength: 0 };
      setLift(g.body, k.side === 'rise' ? k.strength : k.side === 'fall' ? -k.strength : 0);
      if (g.changeEl) {
        g.changeEl.textContent = formatPercent(pct);
        g.changeEl.style.color = choice === 'blue' ? '#ef4444' : changeTone(pct);
        g.changeEl.title = changeTitle(g.coin);
      }
      if (g.el && choice !== 'blue') {
        const color = cloudColor(k.side, g.alpha ?? 0.5);
        g.el.style.color = color;
        g.el.style.textShadow = g.el.style.textShadow.replace(/rgba?\([^)]*\)/, color);
        if (g.priceEl) g.priceEl.style.color = color;
        g.el.classList.toggle('parsec-matrix__crypto-glyph--rising', k.side === 'rise');
        g.el.classList.toggle('parsec-matrix__crypto-glyph--falling', k.side === 'fall');
      }
    }
  }

  function settleCloud(layerW: number, layerH: number) {
    const els = Array.from(glyphLayer.querySelectorAll<HTMLElement>('.parsec-matrix__crypto-glyph'));
    cryptoGlyphs.forEach((g, i) => {
      const e = els[i];
      if (!e) return;
      // offsetWidth ignores transforms, so the hover scale cannot inflate it.
      // Zero means the layer is hidden; keep the estimate then.
      if (e.offsetWidth > 0 && e.offsetHeight > 0) {
        g.body.w = e.offsetWidth / layerW;
        g.body.h = e.offsetHeight / layerH;
      }
    });

    // A glyph bigger than its zone cannot be held inside it: the walls pin it
    // to the zone's centre, on top of whatever else is there. Move it to the
    // nearest zone it fits, or take it off the wall.
    for (let i = cryptoGlyphs.length - 1; i >= 0; i--) {
      const b = cryptoGlyphs[i].body;
      const fits = (z: CloudZone) => z.x1 - z.x0 >= b.w && z.y1 - z.y0 >= b.h;
      if (fits(b.zone)) continue;
      let best: CloudZone | null = null;
      let bestD = Infinity;
      for (const z of cloudZoneList) {
        if (!fits(z)) continue;
        const cx = Math.min(Math.max(b.hx, z.x0 + b.w / 2), z.x1 - b.w / 2);
        const cy = Math.min(Math.max(b.hy, z.y0 + b.h / 2), z.y1 - b.h / 2);
        const d = Math.hypot(cx - b.hx, cy - b.hy);
        if (d < bestD) { bestD = d; best = z; }
      }
      if (best) {
        b.zone = best;
        b.hx = Math.min(Math.max(b.hx, best.x0 + b.w / 2), best.x1 - b.w / 2);
        b.hy = Math.min(Math.max(b.hy, best.y0 + b.h / 2), best.y1 - b.h / 2);
      } else {
        els[i]?.remove();
        els.splice(i, 1);
        cryptoGlyphs.splice(i, 1);
      }
    }

    for (let guard = 0; guard < 40 && cryptoGlyphs.length > 1; guard++) {
      const bad = relaxHomes(cryptoGlyphs.map((g) => g.body));
      if (bad.length === 0) break;
      // Drop the least important of the overlapping glyphs: a non-featured one
      // if there is any, the smallest otherwise.
      const victim = bad
        .map((i) => ({ i, g: cryptoGlyphs[i] }))
        .sort((a, b) =>
          Number(FEATURED_SYMBOLS.has(a.g.coin.symbol)) - Number(FEATURED_SYMBOLS.has(b.g.coin.symbol))
          || a.g.size - b.g.size)[0].i;
      els[victim]?.remove();
      els.splice(victim, 1);
      cryptoGlyphs.splice(victim, 1);
    }

    // A coin that was already on the wall resumes where it had floated or
    // sunk to -- the cloud rotates every 20 s, and restarting every glyph from
    // its starting height would undo the lingering. Only if that spot is
    // inside a zone it now belongs to; the layout may have changed since.
    const seen = new Set<string>();
    for (const g of cryptoGlyphs) {
      seen.add(g.coin.id);
      const last = cloudLastPos.get(g.coin.id);
      if (!last) continue;
      const b = g.body;
      const home = cloudZoneList.find((z) =>
        last.x - b.w / 2 >= z.x0 && last.x + b.w / 2 <= z.x1 && last.y - b.h / 2 >= z.y0 && last.y + b.h / 2 <= z.y1);
      if (!home) continue;
      b.zone = home;
      b.x = last.x; b.y = last.y; b.vx = last.vx; b.vy = last.vy;
    }
    for (const id of cloudLastPos.keys()) if (!seen.has(id)) cloudLastPos.delete(id);

    // Anchor each element at its home (geometry is centres; CSS is corners);
    // the frame loop then draws the body's offset from there.
    const layerW2 = glyphLayer.clientWidth || layerW;
    const layerH2 = glyphLayer.clientHeight || layerH;
    cryptoGlyphs.forEach((g, i) => {
      const e = els[i];
      if (!e) return;
      g.x = g.body.hx - g.body.w / 2;
      g.y = g.body.hy - g.body.h / 2;
      e.style.left = `${g.x * 100}%`;
      e.style.top = `${g.y * 100}%`;
      e.style.translate = `${((g.body.x - g.body.hx) * layerW2).toFixed(1)}px ${((g.body.y - g.body.hy) * layerH2).toFixed(1)}px`;
    });
  }

  /**
   * Move the cloud one frame.
   *
   * Each glyph is a body anchored where placement put it -- its height already
   * encodes the 24h move -- and the bodies collide, bouncing off one another and
   * off their channel's walls, storm or calm. The offset is written to the CSS
   * `translate` property rather than `transform`, so the hover `scale` still
   * applies on top of it instead of snapping the glyph back home.
   */
  let cloudStorm = false;
  let lastDriftT = 0;
  function driftGlyphs(t: number) {
    const dt = lastDriftT ? t - lastDriftT : 0;
    lastDriftT = t;
    if (cryptoGlyphs.length === 0) return;
    stepCloud(cryptoGlyphs.map((g) => g.body), { dt, t, storm: cloudStorm, zones: cloudZoneList });
    // Remember where each coin has got to, so the next rebuild picks it up
    // there instead of dropping it back to its starting height.
    for (const g of cryptoGlyphs) {
      const b = g.body;
      cloudLastPos.set(g.coin.id, { x: b.x, y: b.y, vx: b.vx, vy: b.vy });
    }

    const glyphs = glyphLayer.querySelectorAll('.parsec-matrix__crypto-glyph');
    const layerW = glyphLayer.clientWidth || 1;
    const layerH = glyphLayer.clientHeight || 1;
    cryptoGlyphs.forEach((cg, i) => {
      const glyphEl = glyphs[i] as HTMLElement;
      if (!glyphEl) return;
      const b = cg.body;
      const ox = (b.x - b.hx) * layerW;
      const oy = (b.y - b.hy) * layerH;
      glyphEl.style.translate = `${ox.toFixed(1)}px ${oy.toFixed(1)}px`;
    });
  }

  // ── Pyramid — top coin at apex, winners right, losers left ──

  /**
   * The left-hand column: TOP 10 and FAVOURITES.
   *
   * Lives in its own layer and its own function, deliberately. It used to be
   * built inside renderPyramid, behind that function's `prices.length < 10`
   * guard — so whenever the top-100 feed was empty, slow or rate-limited, the
   * FAVOURITES strip vanished too, even though favourites come from a SEPARATE
   * CoinGecko request that had succeeded. Two independent feeds should not share
   * one failure mode, and `pyramidLayer.innerHTML = ''` was also wiping the strip
   * on every price tick.
   */
  // Which renderFleet call is current. The favourites column arrives on a
  // promise; one that resolves after a newer render must not attach a second,
  // stale column (and its drag handlers) beside the new one.
  let fleetGen = 0;

  function renderFleet() {
    const gen = ++fleetGen;
    fleetLayer.innerHTML = '';
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

    // All 10 assets in one vertical column on the left side.
    //
    // TOP 10 and FAVOURITES share this column, so it is built when EITHER is on
    // and each section decides for itself whether to draw. With both off the
    // column is never created and never appended.
    // Build the column when EITHER section has something to say. Requiring
    // `fleetCoins.length > 0` gated the whole column — favourites included — on
    // the top-100 feed, which is the coupling this function exists to remove.
    const showTop10 = top10Pref.on && fleetCoins.length > 0;
    if (showTop10 || favouritesPref.on) {
      const fleet = el('div', { cls: 'parsec-fleet-column' });
      let fleetAttached = false;
      const attachFleet = () => {
        if (fleetAttached || fleet.childElementCount === 0) return;
        fleetAttached = true;
        makeDraggable(fleet, 'fleet');
        fleetLayer.appendChild(fleet);
      };

      if (showTop10) {
        fleet.appendChild(el('div', {
          cls: 'parsec-fleet-column__header',
          text: 'TOP 10',
          // Label the period once on the header rather than on ten rows.
          children: [el('span', { cls: 'parsec-fleet-column__period', text: pricePeriod })],
        }));
      }

      (showTop10 ? fleetCoins : []).forEach((coin, i) => {
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
            el('span', {
              cls: 'parsec-fleet-column__change',
              text: formatPercent(shownChange(coin).pct),
              attrs: { style: `color:${changeTone(shownChange(coin).pct)}`, title: changeTitle(coin) },
            }),
          ],
        });

        // Hover: show coin panel
        row.addEventListener('mouseenter', () => showCoinPanel(coin, row));
        row.addEventListener('mouseleave', () => hideCoinPanel());

        fleet.appendChild(row);
      });

      // ── Favourites strip — appended after the TOP 10 rows ──
      // Fire-and-forget: render rows as soon as CoinGecko responds.
      // A slug that fails to resolve (e.g. a coin not on CoinGecko)
      // is silently filtered out by fetchPricesByIds.
      //
      // When favourites are off the request is not made at all. Fetching prices
      // for a strip nobody asked to see would be spending someone's bandwidth on
      // a preference they already declined.
      // Only the chosen favourites are requested — a coin the participant has
      // switched off should not cost them a lookup either.
      const wanted = FAVOURITE_COINS.filter((id) => favouriteSelection.has(id));
      const favourites = favouritesPref.on && wanted.length > 0
        ? fetchPricesByIds(wanted)
        : Promise.resolve([] as CoinPrice[]);
      favourites.then((favs) => {
        if (gen !== fleetGen) return;
        if (favs.length === 0) return;
        // The profile's emphasis order first, then any other chosen coin in
        // catalog order — never CoinGecko's mcap-desc ordering.
        const byId = new Map(favs.map((c) => [c.id, c] as const));
        const ordered = [...currentFocus, ...FAVOURITE_COINS.filter((id) => !currentFocus.includes(id))]
          .filter((id) => favouriteSelection.has(id))
          .map((id) => byId.get(id))
          .filter((c): c is CoinPrice => Boolean(c));
        if (ordered.length === 0) return;

        fleet.appendChild(el('div', {
          cls: 'parsec-fleet-column__header parsec-fleet-column__header--favs',
          text: 'FAVOURITES',
          children: [el('span', { cls: 'parsec-fleet-column__period', text: pricePeriod })],
        }));

        for (const coin of ordered) {

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
            cls: 'parsec-fleet-column__coin parsec-fleet-column__coin--fav',
            children: [
              // No rank cell for favourites — keeps the row aligned via the
              // existing flex layout. A blank span preserves the column.
              el('span', { cls: 'parsec-fleet-column__rank parsec-fleet-column__rank--blank' }),
              iconEl,
              el('span', { cls: 'parsec-fleet-column__symbol', text: coin.symbol }),
              el('span', { cls: 'parsec-fleet-column__price', text: formatPrice(coin.usd) }),
              el('span', { cls: 'parsec-fleet-column__mcap', text: formatMarketCap(coin.marketCap) }),
              el('span', {
              cls: 'parsec-fleet-column__change',
              text: formatPercent(shownChange(coin).pct),
              attrs: { style: `color:${changeTone(shownChange(coin).pct)}`, title: changeTitle(coin) },
            }),
            ],
          });

          row.addEventListener('mouseenter', () => showCoinPanel(coin, row));
          row.addEventListener('mouseleave', () => hideCoinPanel());

          fleet.appendChild(row);
        }
        attachFleet();
      }).catch(() => { /* favourites are best-effort; ignore */ });

      // Attach only once the column has something in it.
      //
      // With TOP 10 off and FAVOURITES on there are no rows yet — the strip
      // arrives with the CoinGecko response — so attaching here unconditionally
      // would put an empty draggable box on the wall, and leave it there
      // permanently if the request failed. attachFleet is idempotent and is
      // called from both paths.
      attachFleet();
    }
  }

  function renderPyramid() {
    // Its anchors are about to be rebuilt; a panel pinned to one would orphan.
    dropCoinPanel();
    pyramidLayer.innerHTML = '';
    // Before the guard below: the column has its own data sources and must not
    // be held hostage by the top-100 feed.
    renderFleet();
    if (prices.length < 10) return;

    // Filter out stablecoins, wrapped tokens, and junk from the pyramid
    const pyramidExclude = new Set([
      'USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'FDUSD', 'PYUSD', 'USDP', 'GUSD', 'FRAX', 'LUSD', 'USDS', 'USDE',
      'PAXG', 'XAUT', 'WBTC', 'WETH', 'STETH', 'WSTETH', 'CBETH', 'RETH', 'WEETH',
      'LEO', 'OKB', 'CRO', 'KCS', 'HT', 'GT', 'FTT', 'FIGR_HELOC',
    ]);
    const pyramidPrices = prices.filter(c => !pyramidExclude.has(c.symbol) && c.marketCap > 100_000_000);
    // Ranked by the SELECTED period, so switching CHANGE re-forms the pyramid:
    // the apex is the largest gain over that period, not always over 24h. A coin
    // with no figure for the period (4h for a coin the exchange feed does not
    // list, before this session has watched it long enough) is neither a gainer
    // nor a loser -- it goes last, rather than posing as flat.
    const periodPct = new Map(pyramidPrices.map((c) => [c.id, shownChange(c).pct]));
    const layout = layoutPyramid(pyramidPrices, (c) => periodPct.get(c.id) ?? null, pyramidRows);
    if (!layout.apex) return;
    const { winners, losers } = layout;

    // Nothing to build while the pyramid is hidden: 86 cards laid out for no
    // one was most of what a toggle or a price tick cost. The ship below does
    // not depend on it.
    const pyramidShown = pyramidPref.on && (choice === 'none' || choice === 'blue');
    if (pyramidShown) {
      // ── Pyramid — brick steps from single apex to wide base ──
      //
      // The hierarchy (lib/pyramid-layout.ts): gainers only on the right, largest
      // gain nearest the apex; losers only on the left, largest loss nearest the
      // apex -- the largest move down, and so the largest potential correction. The
      // triangle keeps its shape in a lopsided period because the dividing line
      // moves within each row, never because a side crosses over. The middle of
      // the ranking, and coins with no figure for the period, form the base strip.
      const pyramid = el('div', { cls: 'parsec-pyramid__body' });
      const usedCards = new Set<string>();
      const card = (coin: CoinPrice, isApex: boolean) => {
        usedCards.add(coin.id);
        return pyramidCoinCard(coin, isApex);
      };

      const apexRow = el('div', { cls: 'parsec-pyramid__row parsec-pyramid__row--apex' });
      apexRow.appendChild(card(layout.apex, true));
      pyramid.appendChild(apexRow);

      layout.rows.forEach(({ left, right }, k) => {
        const r = k + 1;
        const row = el('div', { cls: 'parsec-pyramid__row' });
        // Width scales from narrow (top) to wide (base) — ~26 % to ~95 % for any row count.
        const widthPct = 14 + r * (81 / pyramidRows);
        row.style.width = `${widthPct}%`;
        row.style.maxWidth = `${widthPct}%`;
        for (const coin of left) row.appendChild(card(coin, false));
        for (const coin of right) row.appendChild(card(coin, false));
        pyramid.appendChild(row);
      });

      if (layout.base.length > 0) {
        const baseRow = el('div', { cls: 'parsec-pyramid__row parsec-pyramid__row--base' });
        baseRow.style.width = '96%';
        baseRow.style.maxWidth = '96%';
        for (const coin of layout.base) baseRow.appendChild(card(coin, false));
        pyramid.appendChild(baseRow);
      }

      // Cards not on the wall this time are forgotten, so the cache tracks the
      // feed rather than growing with every coin that ever passed through.
      for (const id of cardCache.keys()) if (!usedCards.has(id)) cardCache.delete(id);

      pyramidLayer.appendChild(pyramid);

      // Triangle edge lines behind the rows
      pyramidLayer.appendChild(pyramidLine(50, 0, 96, 58, 'rgba(16,185,129,0.1)'));
      pyramidLayer.appendChild(pyramidLine(50, 0, 4, 58, 'rgba(239,68,68,0.1)'));

      // This function wiped and rebuilt the layer, so re-assert visibility —
      // otherwise a price tick would silently bring a hidden pyramid back.
      applyOverlays();

      // Icons streaming along the pyramid diagonals — winners climb right, losers slide left
      renderEdgeStreams(pyramid, winners, losers);
    } else {
      applyOverlays();
    }

    // ── Stablecoin Ship — liquidity vessel floating at the bottom ──
    //
    // Two things per coin: how much there is (the hold's width) and whether it
    // is doing its one job, holding $1 (the peg chip). The hull lists when the
    // fleet's cap-weighted peg slips, so a depeg is visible from across the room.
    const stable = stablecoinsPref.on ? summarizeStables(prices) : null;
    if (stable && stable.usd.length + stable.gold.length > 0) {
      const ship = el('div', { cls: 'parsec-ship' });
      const list = shipList(stable.weightedBps);
      const hull = el('div', {
        cls: `parsec-ship__hull${stable.depegged > 0 ? ' parsec-ship__hull--alarm' : ''}`,
        attrs: { style: `--parsec-ship-list:${list.toFixed(2)}deg` },
      });

      // Mast — dollar liquidity, where money is going, its share of the market,
      // and the peg roll call.
      const counted = stable.held + stable.drifting + stable.depegged;
      const pegText = stable.depegged > 0 && stable.largestDeviation
        ? `DEPEG ${stable.largestDeviation.coin.symbol} ${formatBps(stable.largestDeviation.peg!.bps)}`
        : stable.drifting > 0 && stable.largestDeviation
          ? `DRIFT ${stable.largestDeviation.coin.symbol} ${formatBps(stable.largestDeviation.peg!.bps)}`
          : `PEGS ${stable.held}/${counted}`;
      const pegState = stable.depegged > 0 ? 'depeg' : stable.drifting > 0 ? 'drift' : 'held';
      const flowWord = stable.flow === 'inflow' ? 'INFLOW' : stable.flow === 'outflow' ? 'OUTFLOW' : 'FLAT';
      const flowArrow = stable.flow === 'inflow' ? '\u25B2' : stable.flow === 'outflow' ? '\u25BC' : '\u25C6';
      hull.appendChild(el('div', {
        cls: 'parsec-ship__mast',
        children: [
          el('div', { cls: 'parsec-ship__flag', text: formatMarketCap(stable.usdLiquidity) }),
          el('div', { cls: 'parsec-ship__flag-label', text: 'STABLECOIN LIQUIDITY' }),
          el('div', {
            cls: `parsec-ship__flow parsec-ship__flow--${stable.flow}`,
            text: `${flowArrow} ${formatPercent(stable.flowPct, 2)} 24H \u00B7 ${flowWord}`,
            attrs: {
              title: 'Change in dollar-stablecoin market cap over 24h. Stablecoins hold $1, so this is net minting '
                + 'less redemption: positive is money arriving to invest, negative is money leaving the market.',
            },
          }),
          el('div', {
            cls: 'parsec-ship__mast-row',
            children: [
              el('span', {
                cls: 'parsec-ship__powder',
                text: stable.shareOfMarket === null ? '—' : `${(stable.shareOfMarket * 100).toFixed(1)}% DRY`,
                attrs: { title: 'Dollar stablecoins as a share of the top-100 market cap — capital parked on the sidelines' },
              }),
              el('span', {
                cls: `parsec-ship__peg-call parsec-ship__peg-call--${pegState}`,
                text: pegText,
                attrs: { title: `Held within ±${PEG_HELD_BPS} bp of $1 · drifting to ±${PEG_DEPEG_BPS} bp · depegged beyond` },
              }),
            ],
          }),
        ],
      }));

      // Deck — stablecoins as cargo, each block as wide as its share. The block
      // carries its 24h supply change; its keel line carries its peg.
      const deck = el('div', { cls: 'parsec-ship__deck' });
      // The biggest few ride as blocks; the rest are listed one per row below,
      // so every coin keeps its own peg and share rather than vanishing into a
      // "+N". Gold rides at the stern in its own colour.
      const OWN_BLOCKS = 3;
      const addCargo = (o: {
        cls: string; symbol: string; cap: number; share: number; showShare: boolean;
        detail: string; detailCls: string; flow: number | null; title: string;
      }) => {
        deck.appendChild(el('div', {
          cls: `parsec-ship__cargo ${o.cls}`,
          attrs: { style: `flex-basis:${Math.max(4, Math.round(o.share * 100))}%`, title: o.title },
          children: [
            // Share of its liquidity, as a bar along the top of the block.
            el('span', {
              cls: 'parsec-ship__cargo-share',
              children: [el('span', { attrs: { style: `width:${Math.max(2, o.share * 100).toFixed(1)}%` } })],
            }),
            el('span', { cls: 'parsec-ship__cargo-symbol', text: o.symbol }),
            el('span', {
              cls: 'parsec-ship__cargo-cap',
              text: o.showShare ? `${formatMarketCap(o.cap)} · ${(o.share * 100).toFixed(o.share < 0.1 ? 1 : 0)}%` : formatMarketCap(o.cap),
            }),
            el('span', { cls: `parsec-ship__cargo-peg ${o.detailCls}`, text: o.detail }),
            el('span', {
              cls: 'parsec-ship__cargo-flow',
              text: formatPercent(o.flow, 2),
              attrs: { style: `color:${changeTone(o.flow)}` },
            }),
          ],
        }));
      };
      const pegTitle = (row: typeof stable.usd[number]) => {
        const c = row.coin;
        return `${c.symbol} — ${formatMarketCap(c.marketCap)} · ${(row.share * 100).toFixed(1)}% of dollar stablecoin liquidity · `
          + (row.peg ? `$${c.usd.toFixed(4)} (${formatBps(row.peg.bps)} from $1)` : 'no price')
          + ` · market cap ${formatPercent(row.flowPct, 2)} in 24h`;
      };
      for (const row of stable.usd.slice(0, OWN_BLOCKS)) {
        addCargo({
          cls: `parsec-ship__cargo--${row.peg?.state ?? 'unknown'}`,
          symbol: row.coin.symbol, cap: row.coin.marketCap, share: row.share, showShare: true,
          detail: row.peg ? formatBps(row.peg.bps) : '—',
          detailCls: `parsec-ship__cargo-peg--${row.peg?.state ?? 'unknown'}`,
          flow: row.flowPct, title: pegTitle(row),
        });
      }
      for (const row of stable.gold) {
        const c = row.coin;
        addCargo({
          cls: 'parsec-ship__cargo--gold',
          // Sized against the dollar fleet so a gold block is not drawn as big
          // as USDT; its own share is of gold, which would mislead beside them.
          symbol: c.symbol, cap: c.marketCap, share: c.marketCap / (stable.usdLiquidity || 1), showShare: false,
          detail: `${formatPrice(c.usd)}/oz`, detailCls: '',
          flow: row.flowPct,
          title: `${c.symbol} — ${formatMarketCap(c.marketCap)} · ${formatPrice(c.usd)} per troy ounce · market cap ${formatPercent(row.flowPct, 2)} in 24h`,
        });
      }

      // The rest of the dollar fleet, one row each: symbol · share bar · cap ·
      // peg · 24h flow -- the per-coin reading the earlier row layout carried.
      const tail = stable.usd.slice(OWN_BLOCKS);
      if (tail.length > 0) {
        const tailMax = Math.max(...tail.map((r) => r.share), 0.0001);
        const list = el('div', { cls: 'parsec-ship__tail' });
        for (const row of tail) {
          list.appendChild(el('div', {
            cls: `parsec-ship__tail-row parsec-ship__tail-row--${row.peg?.state ?? 'unknown'}`,
            attrs: { title: pegTitle(row) },
            children: [
              el('span', { cls: 'parsec-ship__tail-symbol', text: row.coin.symbol }),
              el('span', {
                cls: 'parsec-ship__tail-bar',
                children: [el('span', { attrs: { style: `width:${Math.max(3, (row.share / tailMax) * 100).toFixed(1)}%` } })],
              }),
              el('span', { cls: 'parsec-ship__tail-cap', text: formatMarketCap(row.coin.marketCap) }),
              el('span', { cls: 'parsec-ship__tail-peg', text: row.peg ? formatBps(row.peg.bps) : '—' }),
              el('span', {
                cls: 'parsec-ship__tail-flow',
                text: formatPercent(row.flowPct, 2),
                attrs: { style: `color:${changeTone(row.flowPct)}` },
              }),
            ],
          }));
        }
        deck.appendChild(list);
      }
      hull.appendChild(deck);

      // Water line
      hull.appendChild(el('div', { cls: 'parsec-ship__waterline' }));

      ship.appendChild(hull);
      makeDraggable(ship, 'ship');
      pyramidLayer.appendChild(ship);
    }


  }

  /**
   * Cards by coin id, kept across renders and updated in place.
   *
   * Every price tick and every CHANGE click used to rebuild all 86 cards --
   * elements, four listeners and an <img> each -- when all that differs is a
   * price, a percentage and its colour. A card is now built once per coin and
   * its text and tint are rewritten; its icon never reloads. It is rebuilt
   * only if what it IS changes: apex or not, symbol, icon.
   */
  interface CachedCard {
    key: string;
    el: HTMLElement;
    price: HTMLElement;
    change: HTMLElement;
    icon: HTMLElement;
    /** Read by the listeners, so an updated card hovers with its current figures. */
    ref: { coin: CoinPrice; color: string };
  }
  const cardCache = new Map<string, CachedCard>();

  function pyramidCoinCard(coin: CoinPrice, isApex: boolean): HTMLElement {
    // The card's own tint follows the selected period, like its figure does.
    const shown = shownChange(coin);
    const color = changeTone(shown.pct);
    const priceText = formatPrice(coin.usd);
    const pctText = formatPercent(shown.pct);
    const title = changeTitle(coin);
    const key = `${isApex ? 1 : 0}|${coin.symbol}|${coin.image}`;

    const hit = cardCache.get(coin.id);
    if (hit && hit.key === key) {
      hit.ref.coin = coin;
      hit.ref.color = color;
      // Write only what differs: an unchanged write still dirties layout.
      if (hit.price.textContent !== priceText) hit.price.textContent = priceText;
      if (hit.change.textContent !== pctText) hit.change.textContent = pctText;
      if (hit.change.style.color !== color) hit.change.style.color = color;
      if (hit.change.title !== title) hit.change.title = title;
      if (!coin.image) {
        hit.icon.style.background = `${color}33`;
        hit.icon.style.color = color;
      }
      return hit.el;
    }

    const ref = { coin, color };
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
      img.decoding = 'async';
      img.onerror = () => { img.style.display = 'none'; };
      iconEl = img;
    } else {
      iconEl = el('div', {
        cls: 'parsec-pyramid__card-icon parsec-pyramid__card-icon--fallback',
        text: coin.symbol.charAt(0),
        attrs: { style: `background:${color}33;color:${color};width:${isApex ? 24 : 16}px;height:${isApex ? 24 : 16}px` },
      });
    }

    const priceEl = el('div', { cls: 'parsec-pyramid__card-price', text: priceText });
    const changeEl = el('div', {
      cls: 'parsec-pyramid__card-change',
      text: pctText,
      attrs: { style: `color:${color}`, title },
    });
    const cardEl = el('div', {
      cls,
      children: [
        iconEl,
        el('div', { cls: 'parsec-pyramid__card-symbol', text: coin.symbol }),
        priceEl,
        changeEl,
      ],
    });

    // Hover: scale up + glow
    cardEl.addEventListener('mouseenter', () => {
      showCoinPanel(ref.coin, cardEl);
      cardEl.style.transform = 'scale(1.3)';
      cardEl.style.zIndex = '50';
      cardEl.style.boxShadow = `0 0 20px ${ref.color}40`;
      cardEl.style.borderColor = `${ref.color}60`;
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
      showCoinPanel(ref.coin, cardEl);
      cardEl.style.transform = 'scale(1.3)';
      cardEl.style.boxShadow = `0 0 20px ${ref.color}40`;
    }, { passive: false });
    cardEl.addEventListener('touchend', () => {
      hideCoinPanel();
      cardEl.style.transform = '';
      cardEl.style.boxShadow = '';
    });

    cardCache.set(coin.id, { key, el: cardEl, price: priceEl, change: changeEl, icon: iconEl, ref });
    return cardEl;
  }

  // ── Edge streaming — icons glide along the pyramid diagonals ──

  function renderEdgeStreams(pyramidBody: HTMLElement, winners: CoinPrice[], losers: CoinPrice[]) {
    requestAnimationFrame(() => {
      const apexCard = pyramidBody.querySelector('.parsec-pyramid__row--apex .parsec-pyramid__card') as HTMLElement | null;
      // Card rows only. The `--base` strip of small icons wraps and can run
      // below the screen; aiming a stream at it made the line so steep it cut
      // straight across the cards.
      const rows = Array.from(pyramidBody.querySelectorAll<HTMLElement>('.parsec-pyramid__row:not(.parsec-pyramid__row--base)'));
      const lastRow = rows[rows.length - 1];
      if (!apexCard || !lastRow) return;

      const layerRect = pyramidLayer.getBoundingClientRect();
      const apexRect = apexCard.getBoundingClientRect();
      const baseRect = lastRow.getBoundingClientRect();
      const rowRects = rows.map((r) => r.getBoundingClientRect());

      // Run each stream OUTSIDE the staircase. Start at the apex card's outer
      // top corner and end at the last row's outer bottom corner, then push the
      // whole line outward until every row's outer top corner is on the inside
      // of it -- rows are not all the same height, so a straight corner-to-corner
      // line alone still clips the middle rows.
      const ICON = 14;
      // Half the icon (it is centred on the line) plus breathing room.
      const CLEAR = ICON / 2 + 4;
      const y0 = apexRect.top;
      const y1 = baseRect.bottom;
      const along = (xa: number, xb: number, y: number) => xa + ((xb - xa) * (y - y0)) / (y1 - y0 || 1);
      let rightA = apexRect.right + CLEAR;
      let rightB = baseRect.right + CLEAR;
      let leftA = apexRect.left - CLEAR;
      let leftB = baseRect.left - CLEAR;
      let pushR = 0;
      let pushL = 0;
      for (const r of rowRects) {
        pushR = Math.max(pushR, r.right + CLEAR - along(rightA, rightB, r.top));
        pushL = Math.max(pushL, along(leftA, leftB, r.top) - (r.left - CLEAR));
      }
      rightA += pushR; rightB += pushR;
      leftA -= pushL; leftB -= pushL;

      // Item positions are its top-left corner; centre the icon on the line.
      const apexY = y0 - layerRect.top - ICON / 2;
      const baseY = y1 - layerRect.top - ICON / 2;
      const apexRightX = rightA - layerRect.left;
      const baseRightX = rightB - layerRect.left;
      const apexLeftX = leftA - layerRect.left - ICON;
      const baseLeftX = leftB - layerRect.left - ICON;

      pyramidLayer.appendChild(buildEdgeStream(winners.slice(0, 8), apexRightX, apexY, baseRightX, baseY, 'up'));
      pyramidLayer.appendChild(buildEdgeStream(losers.slice(0, 8), apexLeftX, apexY, baseLeftX, baseY, 'down'));
    });
  }

  function buildEdgeStream(coins: CoinPrice[], apexX: number, apexY: number, baseX: number, baseY: number, direction: 'up' | 'down'): HTMLElement {
    const stream = el('div', { cls: `parsec-pyramid__stream parsec-pyramid__stream--${direction}` });
    if (coins.length === 0) return stream;

    const baseDuration = 14; // full traversal seconds at normal pace
    coins.forEach((coin, i) => {
      // Higher magnitude change = faster along the edge
      // Edge-stream pace stays on the 24h move deliberately. It expresses how
      // significant a coin is over the day; tying it to the selected period
      // would make the whole pyramid change tempo on a display preference.
      const speed = Math.max(0.6, Math.min(2.2, Math.abs(coin.change24h) / 8));
      const duration = baseDuration / speed;
      const color = changeTone(shownChange(coin).pct);
      const stagger = (i / coins.length) * baseDuration;

      const item = el('div', { cls: 'parsec-pyramid__stream-item' });

      if (coin.image) {
        const img = document.createElement('img');
        img.src = coin.image;
        img.alt = coin.symbol;
        img.width = 14;
        img.height = 14;
        img.loading = 'lazy';
        img.onerror = () => { img.style.display = 'none'; };
        item.appendChild(img);
      } else {
        item.appendChild(el('div', {
          cls: 'parsec-pyramid__stream-fallback',
          text: coin.symbol.charAt(0),
          attrs: { style: `background:${color}33;color:${color}` },
        }));
      }

      // 'up' = climbing toward apex (base → apex); 'down' = falling to base (apex → base)
      const fromX = direction === 'up' ? baseX : apexX;
      const fromY = direction === 'up' ? baseY : apexY;
      const toX = direction === 'up' ? apexX : baseX;
      const toY = direction === 'up' ? apexY : baseY;

      item.style.setProperty('--from-x', `${fromX}px`);
      item.style.setProperty('--from-y', `${fromY}px`);
      item.style.setProperty('--to-x', `${toX}px`);
      item.style.setProperty('--to-y', `${toY}px`);
      item.style.animationDuration = `${duration}s`;
      item.style.animationDelay = `-${stagger}s`;

      stream.appendChild(item);
    });
    return stream;
  }

  // ── Hover info panel — detailed coin card ──────────────────
  //
  // The panel sits a few pixels above the trigger and stays up while the
  // cursor is over EITHER the trigger or the panel. Trigger `mouseleave`
  // schedules a 180ms hide; entering the panel cancels it. This is what
  // makes the CoinGecko / Chart links reachable — without the deferral
  // the panel is torn down the instant the cursor leaves the trigger.

  let activeCoinPanel: HTMLElement | null = null;
  let pendingHide: ReturnType<typeof setTimeout> | null = null;

  function cancelPendingHide() {
    if (pendingHide) { clearTimeout(pendingHide); pendingHide = null; }
  }

  function showCoinPanel(coin: CoinPrice, anchor: HTMLElement) {
    cancelPendingHide();
    if (activeCoinPanel) { activeCoinPanel.remove(); activeCoinPanel = null; }

    const panel = el('div', {
      cls: 'parsec-coinpanel',
      children: [
        el('div', { cls: 'parsec-coinpanel__header', children: [
          el('span', { cls: 'parsec-coinpanel__symbol', text: coin.symbol }),
          el('span', { cls: 'parsec-coinpanel__name', text: coin.id.replace(/-/g, ' ') }),
        ]}),
        el('div', { cls: 'parsec-coinpanel__price', text: formatPrice(coin.usd) }),
        el('div', {
          cls: 'parsec-coinpanel__change',
          // A detail panel earns two decimals and states its period outright.
          text: `${formatPercent(shownChange(coin).pct, 2)} ${pricePeriod}`,
          attrs: { style: `color:${changeTone(shownChange(coin).pct)}`, title: changeTitle(coin) },
        }),
        el('div', { cls: 'parsec-coinpanel__cap', text: `Market Cap: ${formatMarketCap(coin.marketCap)}` }),
        el('div', { cls: 'parsec-coinpanel__links', children: [
          el('a', { text: 'CoinGecko', cls: 'parsec-asset-link', attrs: { href: `https://www.coingecko.com/en/coins/${coin.id}`, target: '_blank', rel: 'noopener' } }),
          el('a', { text: 'Chart', cls: 'parsec-asset-link', attrs: { href: `https://www.coingecko.com/en/coins/${coin.id}#panel`, target: '_blank', rel: 'noopener' } }),
        ]}),
      ],
    });

    // Append first so offsetHeight is real, then position 8px above the
    // trigger. Fallback to a 120px offset when the layout hasn't run yet.
    const rect = anchor.getBoundingClientRect();
    document.body.appendChild(panel);
    activeCoinPanel = panel;

    const h = panel.offsetHeight || 120;
    const panelX = Math.min(rect.left, window.innerWidth - 200);
    const panelY = Math.max(rect.top - h - 8, 10);
    panel.style.left = `${panelX}px`;
    panel.style.top = `${panelY}px`;

    // Keep the panel alive while the cursor is over it.
    panel.addEventListener('mouseenter', cancelPendingHide);
    panel.addEventListener('mouseleave', () => hideCoinPanel());
  }

  function hideCoinPanel(delay = 180) {
    cancelPendingHide();
    pendingHide = setTimeout(() => {
      if (activeCoinPanel) { activeCoinPanel.remove(); activeCoinPanel = null; }
      pendingHide = null;
    }, delay);
  }
  /**
   * Remove the coin panel now. It lives on document.body, outside the view, so
   * the router's teardown never saw it: leaving the Matrix with a panel open
   * left it there for good. And the glyph or tile it is anchored to is rebuilt
   * on every rotation and price tick; a removed anchor never fires mouseleave,
   * so the panel used to stay until another coin was hovered.
   */
  function dropCoinPanel(): void {
    cancelPendingHide();
    activeCoinPanel?.remove();
    activeCoinPanel = null;
  }
  onCleanup(dropCoinPanel);


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
    tooltip.innerHTML = `
      <div class="parsec-matrix__tooltip-symbol">${coin.symbol}</div>
      <div class="parsec-matrix__tooltip-price">${formatPrice(coin.usd)}</div>
      <div class="parsec-matrix__tooltip-change" style="color:${changeTone(shownChange(coin).pct)}">${formatPercent(shownChange(coin).pct, 2)} <span class="parsec-matrix__tooltip-period">${pricePeriod}</span></div>
      <div class="parsec-matrix__tooltip-cap">${formatMarketCap(coin.marketCap)}</div>
    `;
    tooltip.style.left = `${x + 16}px`;
    tooltip.style.top = `${y - 20}px`;
    tooltip.style.opacity = '1';
  }

  /**
   * Decide what the matrix overlays show, from the pill context and the
   * participant's pyramid preference. Called on every pill change AND at the
   * end of renderPyramid(), so a rebuild can never lose the current state.
   *
   * The pyramid rides on the landing screen and inside the blue pill (it is
   * market observation, which is what the blue pill is for). It steps aside
   * for the pill choice and the red pill, where the decision is the subject.
   */
  function applyOverlays(): void {
    const showBody = pyramidPref.on && (choice === 'none' || choice === 'blue');
    pyramidLayer.classList.toggle('parsec-matrix__pyramid--bodyoff', !showBody);
    container.classList.toggle('parsec-matrix--withpyramid', choice === 'blue' && showBody);
    container.classList.toggle('parsec-matrix--norain', !matrixPref.on);
    // The toggle stack belongs to the landing. With a pill open it would float
    // over the panel's own controls, and the Blue Pill's Settings carries the
    // same switches.
    toggleStack.style.display = choice === 'none' ? '' : 'none';

    // The brand is prominent and centred when the rain has the wall to itself,
    // and steps up out of the way once a market layer needs the middle. A
    // position the participant dragged always wins — see dragPositions.
    const soloMatrix = matrixPref.on
      && !cryptocloudPref.on && !top10Pref.on && !favouritesPref.on
      && !stablecoinsPref.on && !pyramidPref.on;
    const placed = dragPositions.has('brand');
    brandEl.classList.toggle('parsec-matrix__brand--hero', soloMatrix && !placed && choice === 'none');
  }

  function setPill(p: PillChoice) {
    // The pills are two modes (lib/mode.ts). The Red Pill arms; everything
    // else is viewing. Taking the Blue Pill with a wallet session open ends the
    // session completely first: diagnostics never run beside live keys.
    if (p === 'red') {
      arm();
    } else if (p === 'blue' && hasLiveSession()) {
      void logout().then((report) => {
        disarm();
        toast(report.ok ? 'Wallet logged out. Blue Pill runs view-only.' : 'Wallet logged out with warnings. Blue Pill runs view-only.', report.ok ? 'primary' : 'warning');
        setPill('blue');
      });
      return;
    } else if (!hasLiveSession()) {
      disarm();
    }
    choice = p;
    // Release the Blue Pill's panel closures whenever it is not the open pill.
    if (p !== 'blue') { blueTabImpl = null; blueTickImpl = null; }
    // Shader pill tint: 0 = green (landing/choose), 1 = red, 2 = blue
    pillUniform = p === 'red' ? 1.0 : p === 'blue' ? 2.0 : 0.0;
    // Glitch spin on every transition
    triggerGlitchSpin(0.8);
    // Re-render glyphs so colors update for pill context
    createGlyphs();

    if (p === 'none') {
      // Landing — the matrix screen. Panel hidden, everything else on show.
      panel.style.display = 'none';
      panel.classList.remove('parsec-matrix__panel--fullscreen');
      brandEl.style.display = '';
      pyramidLayer.style.display = '';
      glyphLayer.style.display = '';
    } else if (p === 'blue') {
      // Blue pill — observation. The pyramid stays: reading the market is the
      // whole point of this pill. Glyphs step aside so the panel can be read.
      panel.style.display = '';
      panel.classList.add('parsec-matrix__panel--fullscreen');
      brandEl.style.display = 'none';
      pyramidLayer.style.display = '';
      glyphLayer.style.display = 'none';
    } else {
      // Pill choice / red — the decision is the subject; market furniture
      // recedes. Top 10, ship and glyphs stay as ambient context.
      panel.style.display = '';
      panel.classList.add('parsec-matrix__panel--fullscreen');
      brandEl.style.display = 'none';
      pyramidLayer.style.display = '';
      glyphLayer.style.display = '';
    }

    // The pyramid is only built while it can be seen, so a pill that reveals
    // it has to build it rather than just unhide it.
    renderPyramid();
    applyOverlays();
    renderPanel();
  }

  // ── Panel Rendering ─────────────────────────────────────────

  function renderPanel() {
    panel.innerHTML = '';

    if (choice === 'none') return; // landing — panel is hidden
    if (choice === 'choose') return renderPillChoice();
    if (choice === 'blue') return renderBluePill();
    if (choice === 'red') { void probeVault(); return renderRedPill(); }
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

  /**
   * The blue pill's choice-of-depth landing.
   *
   * Deliberately a separate screen rather than a dropdown: it is the first thing
   * the blue pill says, and the three levels describe genuinely different jobs
   * rather than three densities of the same one.
   */
  function renderDiagLanding(): void {
    const wrap = el('div', { cls: 'parsec-diaglanding' });
    wrap.appendChild(el('p', {
      cls: 'parsec-diaglanding__lede',
      text: 'How deep should the instruments go? You can change this at any time.',
    }));

    const levels: { id: DiagLevel; title: string; blurb: string }[] = [
      {
        id: 'basic',
        title: 'BASIC',
        blurb: 'Your wallets and the market around them. What you hold, on which chain, and where to verify it.',
      },
      {
        id: 'scientific',
        title: 'SCIENTIFIC',
        blurb: 'Adds the readings behind the numbers — fees, chain health, network reachability, DeFi liquidity — each naming the source it came from.',
      },
      {
        id: 'advanced',
        title: 'ADVANCED',
        blurb: 'Adds the instrument that measures the instruments: how fast events completed, how stale the data was when used, and what this session actually did.',
      },
    ];

    const grid = el('div', { cls: 'parsec-diaglanding__grid' });
    for (const lv of levels) {
      const card = el('button', {
        cls: 'parsec-diaglanding__card',
        attrs: { type: 'button' },
        children: [
          el('div', { cls: 'parsec-diaglanding__title', text: lv.title }),
          el('div', { cls: 'parsec-diaglanding__blurb', text: lv.blurb }),
        ],
      });
      card.addEventListener('click', () => setDiagLevel(lv.id));
      grid.appendChild(card);
    }
    wrap.appendChild(grid);
    panel.appendChild(wrap);
  }

  /**
   * Per-wallet diagnostics: each account as it was created, on every chain it
   * holds an address for, with a link out to that chain's explorer.
   *
   * Explorers are EXTERNAL — a third party learns which address you asked about.
   * The links are therefore never followed automatically; they are offered, and
   * the panel says plainly that using one leaves the client.
   */
  function loadWalletsTab(box: HTMLElement, state: WalletState): void {
    if (state.accounts.length === 0) {
      box.appendChild(el('p', { cls: 'bp5-text-muted', text: 'No wallets yet.' }));
      return;
    }

    for (const account of state.accounts) {
      const section = el('div', { cls: 'parsec-matrix__diag-subsection', text: account.name });
      box.appendChild(section);

      box.appendChild(diagRow('Created', new Date(account.createdAt).toISOString().slice(0, 16).replace('T', ' ')));
      box.appendChild(diagRow('Custody', account.watchOnly ? 'watch-only — cannot sign' : 'holds keys'));

      const chainMap = account.chains ?? {};
      const chainIds = Object.keys(chainMap);
      if (chainIds.length === 0) {
        box.appendChild(diagRow('Chains', 'none derived yet'));
        continue;
      }

      for (const chainId of chainIds) {
        const addr = chainMap[chainId];
        if (!addr) continue;
        const chain = getChainDescriptor(chainId);
        const row = el('div', { cls: 'parsec-matrix__diag-row' });
        row.appendChild(el('span', { cls: 'parsec-matrix__diag-label', text: chain.label }));

        const value = el('span', { cls: 'parsec-matrix__diag-value' });
        value.appendChild(el('span', { text: chain.truncate(addr) }));

        const url = chain.explorerUrl(addr);
        if (url && url !== '#') {
          const link = el('a', {
            cls: 'parsec-matrix__diag-link',
            text: 'blockscan ↗',
            attrs: { href: url, target: '_blank', rel: 'noreferrer noopener',
                     title: `Opens ${new URL(url).hostname} — an external service that will see this address` },
          });
          value.appendChild(link);
        }
        row.appendChild(value);
        box.appendChild(row);
      }
    }

    box.appendChild(el('p', {
      cls: 'parsec-matrix__diag-note',
      text: 'Everything above is read from this device. Explorer links are external — following one tells that service which address you asked about.',
    }));
  }

  /**
   * The Advanced instrument: how fast this session's events completed, and how
   * stale the data was when it was used.
   *
   * Latency and accuracy are reported separately on purpose. A cached price
   * returns in a millisecond and may be five minutes old; a panel that showed
   * only speed would call that an excellent result.
   */
  function loadEventsTab(box: HTMLElement): void {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Timing by kind' }));

    const kinds: events.EventKind[] = ['participant', 'vault', 'network', 'render'];
    let any = false;
    for (const kind of kinds) {
      const s = events.stats(kind);
      if (s.count === 0) continue;
      any = true;
      const parts = [`${s.count} events`];
      if (s.medianMs !== undefined) parts.push(`median ${s.medianMs}ms`);
      if (s.p95Ms !== undefined) parts.push(`p95 ${s.p95Ms}ms`);
      if (s.medianAgeMs !== undefined) parts.push(`data age ${Math.round(s.medianAgeMs / 1000)}s`);
      if (s.failed > 0) parts.push(`${s.failed} failed`);
      box.appendChild(diagRow(kind, parts.join(' · '), s.failed > 0 ? 'deficient' : 'ok'));
    }
    if (!any) {
      box.appendChild(el('p', {
        cls: 'bp5-text-muted',
        text: 'Nothing recorded yet this session.',
      }));
    }

    // ── Participant control of viewing ──
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Session log' }));

    const shown = new Set<events.EventKind>(kinds);
    const logBox = el('div', { cls: 'parsec-matrix__eventlog' });

    function paintLog(): void {
      logBox.innerHTML = '';
      const rows = events.filter(shown, 60);
      if (rows.length === 0) {
        logBox.appendChild(el('p', { cls: 'bp5-text-muted', text: 'No events match the current filter.' }));
        return;
      }
      for (const e of rows) {
        const when = new Date(e.at).toISOString().slice(11, 19);
        const dur = e.durationMs !== undefined ? ` ${e.durationMs}ms` : '';
        const age = e.ageMs !== undefined ? ` · age ${Math.round(e.ageMs / 1000)}s` : '';
        logBox.appendChild(el('div', {
          cls: `parsec-matrix__eventrow parsec-matrix__eventrow--${e.outcome}`,
          text: `${when}  ${e.kind.padEnd(11)} ${e.label}${dur}${age}${e.detail ? ` — ${e.detail}` : ''}`,
        }));
      }
    }

    const filters = el('div', { cls: 'parsec-matrix__eventfilters' });
    for (const kind of kinds) {
      const b = btn(kind, {
        minimal: true,
        onClick: () => {
          if (shown.has(kind)) shown.delete(kind); else shown.add(kind);
          b.classList.toggle('parsec-matrix__eventfilter--off', !shown.has(kind));
          paintLog();
        },
      });
      filters.appendChild(b);
    }
    filters.appendChild(btn('Clear', {
      minimal: true, intent: 'danger',
      onClick: () => { events.clear(); paintLog(); },
    }));
    box.appendChild(filters);
    box.appendChild(logBox);
    paintLog();

    box.appendChild(el('p', {
      cls: 'parsec-matrix__diag-note',
      text: 'Held in memory for this session only, never written to disk and never sent anywhere. Metadata only — no addresses, no key material.',
    }));
  }

  /**
   * The EVM chain reference, from the registry chainmarketcap itself reads.
   *
   * Read-only. Everything here is public chain metadata — ids, tickers, RPCs,
   * explorers — and nothing about the participant is sent to fetch it.
   *
   * The modular contract DEPLOYER that this extension also gates is not wired
   * here. It is OVERLORD-controlled in /DeltaVerse and signed by bankon.eth, and
   * a capability that deploys contracts should not be reachable until that
   * signing path can be exercised end to end. The panel says so rather than
   * offering a button that cannot honour its promise.
   */
  async function loadEvmChainsTab(box: HTMLElement, netLog: HTMLElement): Promise<void> {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'EVM chain registry' }));
    const status = el('p', { cls: 'bp5-text-muted', text: 'Loading chain registry…' });
    box.appendChild(status);

    const results = el('div', { cls: 'parsec-matrix__evmlist' });
    let chains: EvmChain[] = [];

    function paint(query: string): void {
      results.innerHTML = '';
      const found = searchChains(chains, query).slice(0, 40);
      if (found.length === 0) {
        results.appendChild(el('p', { cls: 'bp5-text-muted', text: 'No chain matches that.' }));
        return;
      }
      for (const c of found) {
        const line = `${c.chainId} · ${c.name}${c.symbol ? ` (${c.symbol})` : ''}`;
        const row = el('div', { cls: 'parsec-matrix__diag-row' });
        row.appendChild(el('span', { cls: 'parsec-matrix__diag-label', text: line }));
        const value = el('span', { cls: 'parsec-matrix__diag-value' });
        value.appendChild(el('span', { text: c.rpc.length ? `${c.rpc.length} public RPC` : 'no open RPC' }));
        if (c.explorer) {
          value.appendChild(el('a', {
            cls: 'parsec-matrix__diag-link',
            text: 'explorer ↗',
            attrs: { href: c.explorer, target: '_blank', rel: 'noreferrer noopener' },
          }));
        }
        row.appendChild(value);
        results.appendChild(row);
      }
    }

    const search = input({
      type: 'text',
      placeholder: 'Search 2,500+ chains by name, ticker or id',
      cls: 'bp5-input parsec-matrix__evmsearch',
      onInput: (v) => paint(v),
    });
    box.appendChild(search);
    box.appendChild(results);

    try {
      logNet(netLog, 'FETCH', 'EVM chain registry');
      chains = await events.timed('network', 'fetch-chain-registry', () => fetchChains());
      status.textContent = `${chains.length} chains available.`;
      logNet(netLog, 'OK', `${chains.length} chains`);
      paint('');
    } catch (err) {
      status.textContent = `Chain registry unavailable — ${err instanceof Error ? err.message : 'failed'}`;
      logNet(netLog, 'ERR', 'chain registry');
    }

    box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Contract deployer' }));
    box.appendChild(el('p', {
      cls: 'parsec-matrix__diag-note',
      text: 'The modular contract deployer this extension gates is OVERLORD-controlled in /DeltaVerse and signed by bankon.eth. It is not wired into this build: a capability that deploys contracts should not be reachable until its signing path can be exercised end to end.',
    }));
    box.appendChild(el('a', {
      cls: 'parsec-matrix__diag-link',
      text: 'chainmarketcap ↗',
      attrs: { href: CHAINMARKETCAP_URL, target: '_blank', rel: 'noreferrer noopener' },
    }));
  }

  // One Tab-key listener and one refresh timer for the Blue Pill, registered
  // once per view. Each render only repoints them at its own panel, so a
  // re-render (a switch flip, a profile change) adds nothing: no second
  // listener, no second timer, no cleanup entry holding the discarded panel.
  // They are pointed at nothing whenever the Blue Pill is not open.
  let blueTabImpl: ((e: KeyboardEvent) => void) | null = null;
  let blueTickImpl: (() => void) | null = null;
  const onBlueKey = (e: KeyboardEvent) => blueTabImpl?.(e);
  bindGlobal(window, 'keydown', onBlueKey);
  bindInterval(() => blueTickImpl?.(), 20000);

  function renderBluePill() {
    const state = store.get();

    // Header + back always visible
    panel.appendChild(el('div', { cls: 'parsec-matrix__choice-label parsec-matrix__choice-label--blue', text: 'BLUE PILL — DIAGNOSTICS' }));
    panel.appendChild(el('div', {
      cls: 'parsec-modebadge parsec-modebadge--viewing',
      text: 'VIEWING MODE · no keys · cannot sign',
      attrs: { title: 'The Blue Pill cannot reach the vault, sign, or connect dApps. Take the Red Pill for a live wallet.' },
    }));

    // The active profile, then the whole market — both on entry, before a
    // depth is chosen.
    panel.appendChild(renderProfileBar());
    panel.appendChild(renderMarketPulse());

    // Landing: pick a depth first. Opening straight onto every instrument is
    // not diagnostics, it is noise.
    if (diagLevel === null) { renderDiagLanding(); return; }

    // Network log — always visible at top, compact
    const netLog = el('div', { cls: 'parsec-matrix__netlog' });
    const netFeed = el('div', { cls: 'parsec-matrix__netfeed parsec-matrix__netfeed--compact' });
    netFeed.appendChild(el('div', { cls: 'parsec-matrix__netfeed-header', children: [
      el('span', { cls: 'parsec-matrix__netfeed-dot' }),
      el('span', { text: 'Network' }),
    ]}));
    netFeed.appendChild(netLog);
    panel.appendChild(netFeed);

    logNet(netLog, 'INIT', `PARSEC v0.1.0 — ${state.settings.network}`);
    logNet(netLog, 'NODE', `${state.settings.network}-api.algonode.cloud`);

    // ── Tabs ──
    // What each panel actually reads, named in its provenance line.
    const TAB_SOURCE: Record<string, string> = {
      global: 'coingecko.com (coinpaprika.com fallback) · alternative.me · llama.fi · bybit.com · algonode.cloud',
      gas: 'coingecko.com · algonode.cloud',
      chains: 'public RPC endpoints',
      network: `${state.settings.network}-api.algonode.cloud`,
      defi: 'llama.fi',
      portfolio: 'local wallet state',
      wallets: 'local wallet state · public explorers',
      events: 'this session, in memory',
      evm: 'chainid.network · via deltaverse',
      arweave: 'arweave.net · permagate.io (/info)',
      ario: 'AR.IO gateway peers (/ar-io/peers, /ar-io/info) · Solana RPC (Permaweb settings)',
      prices: 'api.coingecko.com (cached 5m)',
      standard: 'this repo — CLAUDE.md, docs/cypherpunk4096.md, QUANTUM.md',
      news: 'coinmarketcap.com/community via parsec.pythai.net proxy',
      watch: 'algonode.cloud · publicnode.com · arweave.net · mempool.space · rpc.hyperliquid.xyz',
      settings: 'this device — profiles and preferences, no wallet data',
    };

    // INTERNAL vs EXTERNAL, stated per panel.
    //
    // The distinction the participant actually cares about is not how fresh a
    // number is but whether obtaining it told anyone that they asked. Wallets,
    // portfolio and the event log are computed here and reach nobody; the market
    // and chain panels are third-party reads.
    const TAB_REACH: Record<string, Reach> = {
      global: 'external',
      gas: 'external',
      chains: 'external',
      network: 'external',
      defi: 'external',
      evm: 'external',
      arweave: 'external',
      ario: 'external',
      prices: 'external',
      standard: 'internal',
      news: 'external',
      watch: 'external',
      settings: 'internal',
      portfolio: 'internal',
      wallets: 'internal',
      events: 'internal',
    };

    // Tabs by depth. Each level is a superset of the one before, so moving up
    // adds instruments rather than rearranging the ones already learned.
    const TABS_BY_LEVEL: Record<DiagLevel, ReadonlyArray<{ id: string; label: string }>> = {
      basic: [
        { id: 'global', label: 'Global' },
        { id: 'watch', label: 'Watching' },
        { id: 'wallets', label: 'Wallets' },
        { id: 'portfolio', label: 'Portfolio' },
        { id: 'standard', label: 'Standard' },
      ],
      scientific: [
        { id: 'global', label: 'Global' },
        { id: 'watch', label: 'Watching' },
        { id: 'wallets', label: 'Wallets' },
        { id: 'portfolio', label: 'Portfolio' },
        { id: 'gas', label: 'Gas & Fees' },
        { id: 'chains', label: 'Chain Health' },
        { id: 'network', label: 'Network' },
        { id: 'defi', label: 'DeFi TVL' },
        { id: 'standard', label: 'Standard' },
      ],
      advanced: [
        { id: 'global', label: 'Global' },
        { id: 'watch', label: 'Watching' },
        { id: 'wallets', label: 'Wallets' },
        { id: 'portfolio', label: 'Portfolio' },
        { id: 'gas', label: 'Gas & Fees' },
        { id: 'chains', label: 'Chain Health' },
        { id: 'network', label: 'Network' },
        { id: 'defi', label: 'DeFi TVL' },
        { id: 'events', label: 'Events' },
        { id: 'standard', label: 'Standard' },
      ],
    };

    // Extension tabs exist only while their switch is on: a tab that explains
    // it is switched off is still a tab you have to read past.
    const tabs = [
      ...TABS_BY_LEVEL[diagLevel ?? 'basic'],
      ...(chainmarketcapPref.on ? [{ id: 'evm', label: 'EVM Chains' }] : []),
      ...(arweavePref.on ? [{ id: 'arweave', label: 'Arweave' }] : []),
      ...(arioPref.on ? [{ id: 'ario', label: 'AR.IO' }] : []),
      ...(pricesPref.on ? [{ id: 'prices', label: 'Prices' }] : []),
      ...(newsPref.on ? [{ id: 'news', label: 'News' }] : []),
      { id: 'settings', label: 'Settings' },
    ];

    // Permaweb switches — in the panel, above the tabs they control.
    const switches = el('div', { cls: 'parsec-matrix__blue-switches' });
    switches.appendChild(el('span', {
      cls: 'parsec-matrix__blue-switches-label', text: 'EXTENSIONS',
    }));
    const blueSwitch = (label: string, pref: OverlayPref, tabId: string) => {
      const b = el('button', {
        cls: `parsec-matrix__blue-switch${pref.on ? '' : ' parsec-matrix__blue-switch--off'}`,
        text: `${label} ${pref.on ? 'ON' : 'OFF'}`,
        attrs: { type: 'button', 'aria-pressed': String(pref.on) },
      });
      b.title = pref.on ? `Hide the ${label} panel` : `Show the ${label} panel`;
      b.addEventListener('click', () => {
        pref.toggle();
        // Land on the panel just revealed; on switch-off fall back to Global.
        blueInitialTab = pref.on ? tabId : null;
        renderPanel();
      });
      return b;
    };
    switches.appendChild(blueSwitch('ARWEAVE', arweavePref, 'arweave'));
    switches.appendChild(blueSwitch('AR.IO', arioPref, 'ario'));
    // CHAINMARKETCAP moved here from the overlay stack. It gates a blue-pill
    // tab, not a scene overlay, and on the stack it was effectively broken:
    // makeToggle's handler repaints the overlays but never calls renderPanel(),
    // so flipping it while the blue pill was open left the tab bar stale and
    // the EVM Chains tab simply never appeared. blueSwitch re-renders.
    switches.appendChild(blueSwitch('CHAINMARKETCAP', chainmarketcapPref, 'evm'));

    // PRICES is the odd one out: its default rendering is the cloud on the
    // wall, not a tab. Switching it on therefore also switches the cloud on --
    // otherwise the switch would appear to do nothing. The tab it reveals is
    // the list view, the exact-figures alternative to the cloud.
    const pricesBtn = el('button', {
      cls: `parsec-matrix__blue-switch${pricesPref.on ? '' : ' parsec-matrix__blue-switch--off'}`,
      text: `PRICES ${pricesPref.on ? 'ON' : 'OFF'}`,
      attrs: { type: 'button', 'aria-pressed': String(pricesPref.on) },
    });
    pricesBtn.title = pricesPref.on
      ? 'Hide the pinned prices (BTC ETH SOL ALGO AR ARIO)'
      : 'Pin BTC ETH SOL ALGO AR ARIO into the price cloud';
    pricesBtn.addEventListener('click', () => {
      pricesPref.toggle();
      if (pricesPref.on && !cryptocloudPref.on) cryptocloudPref.toggle();
      blueInitialTab = pricesPref.on ? 'prices' : null;
      void refreshPinnedExtras().then(() => {
        createGlyphs();
        renderPanel();
      });
    });
    switches.appendChild(pricesBtn);
    switches.appendChild(blueSwitch('NEWSFEED', newsPref, 'news'));
    panel.appendChild(switches);

    const tabBar = el('div', { cls: 'parsec-matrix__blue-tabs' });
    const tabContent = el('div', { cls: 'parsec-matrix__blue-content' });
    // A switch may have been flipped off while its tab was open, so validate
    // the request against the tabs that actually exist before honouring it.
    const requested = blueInitialTab;
    blueInitialTab = null;
    let activeTab = requested && tabs.some(t => t.id === requested) ? requested : 'global';

    function renderTab(tabId: string) {
      activeTab = tabId;
      tabContent.innerHTML = '';

      // Update tab active states
      tabBar.querySelectorAll('.parsec-matrix__blue-tab').forEach(t => {
        (t as HTMLElement).classList.toggle('parsec-matrix__blue-tab--active', t.getAttribute('data-tab') === tabId);
      });

      const box = el('div', { cls: `parsec-matrix__diag parsec-matrix__diag--defi${tabId === 'global' ? ' parsec-matrix__diag--global' : ''}` });
      tabContent.appendChild(box);

      if (tabId === 'global') loadGlobalTab(box, netLog);
      else if (tabId === 'gas') loadGasTab(box, netLog);
      else if (tabId === 'chains') loadChainsTab(box, netLog);
      else if (tabId === 'network') loadNetworkTab(box, netLog);
      else if (tabId === 'defi') loadDefiTab(box, netLog);
      else if (tabId === 'portfolio') loadPortfolioTab(box, netLog, state);
      else if (tabId === 'wallets') loadWalletsTab(box, state);
      else if (tabId === 'events') loadEventsTab(box);
      else if (tabId === 'evm') void loadEvmChainsTab(box, netLog);
      else if (tabId === 'arweave') void loadArweaveTab(box, netLog);
      else if (tabId === 'ario') void loadArioTab(box, netLog);
      else if (tabId === 'prices') void loadPricesTab(box, netLog);
      else if (tabId === 'standard') loadStandardTab(box);
      else if (tabId === 'news') void loadNewsTab(box, netLog);
      else if (tabId === 'watch') void loadWatchTab(box, netLog);
      else if (tabId === 'settings') loadSettingsTab(box);

      // Every panel says where its figures came from and when they were read.
      const reach = TAB_REACH[tabId] ?? 'external';
      box.appendChild(diagProvenance(
        TAB_SOURCE[tabId] ?? 'parsec',
        reach === 'internal' ? 'cached' : 'live',
        reach,
      ));
    }

    tabs.forEach(tab => {
      tabBar.appendChild(el('div', {
        cls: `parsec-matrix__blue-tab ${tab.id === activeTab ? 'parsec-matrix__blue-tab--active' : ''}`,
        text: tab.label,
        attrs: { 'data-tab': tab.id },
        onClick: () => renderTab(tab.id),
      }));
    });

    panel.appendChild(tabBar);
    panel.appendChild(tabContent);

    // Tab key cycles through tabs
    const tabHandler = (e: KeyboardEvent) => {
      // Inside a form field Tab moves between fields, as it should.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON')) return;
      if (e.key === 'Tab' && choice === 'blue') {
        e.preventDefault();
        const idx = tabs.findIndex(t => t.id === activeTab);
        const next = tabs[(idx + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length];
        renderTab(next.id);
      }
    };
    blueTabImpl = tabHandler;

    // Auto-refresh: reload active tab every 20s.
    //
    // This used to clear itself only if the interval happened to fire while
    // `choice !== 'blue'`. Navigating away from the matrix left it running for
    // the life of the process — still firing network refreshes every 20 seconds,
    // once per visit to this view, against a tab that is no longer on screen.
    // bindInterval ties it to the view; the guard below is now just a fast exit.
    blueTickImpl = () => {
      if (choice !== 'blue') return;
      // Settings is a form: refreshing it would throw away what is being typed.
      if (activeTab === 'settings') return;
      logNet(netLog, 'SYNC', `refreshing ${activeTab}`);
      renderTab(activeTab);
    };

    // Load initial tab — Global overview, or whatever a switch just revealed.
    renderTab(activeTab);

    // Back button always at bottom
    backButton();
  }

  // ── Blue Pill: profile, settings and watching ──
  //
  // The Blue Pill is diagnostics and the control of diagnostics. Everything the
  // participant can set lives in its Settings tab, and a profile saves it all
  // under a name. The Watching tab reads the balances of the profile's watched
  // wallets — read only. Signing, sending and dApp sessions belong to the Red
  // Pill, where wallets are logged into.

  /** Whether the live choices have drifted from the active profile. */
  function profileDirty(): boolean {
    return profiles.differsFrom(activeProfile, captureChoices());
  }

  /** Repaint the landing and reopen the Blue Pill on `tab` after a change. */
  function afterChoiceChange(tab = 'settings'): void {
    for (const paint of toggleRepaints) paint();
    applyOverlays();
    renderFleet();
    renderPyramid();
    createGlyphs();
    blueInitialTab = tab;
    renderPanel();
  }

  function applyProfile(p: DiagProfile): void {
    activeProfile = profiles.setActiveProfile(p.id);
    adoptChoices(activeProfile);
    events.record({ kind: 'participant', label: `profile:${activeProfile.id}`, outcome: 'ok' });
    void refreshPinnedExtras().then(() => afterChoiceChange());
  }

  /** One line under the Blue Pill header: which profile, and whether it is saved. */
  function renderProfileBar(): HTMLElement {
    const dirty = profileDirty();
    const bar = el('div', { cls: 'parsec-bp-profilebar' });
    bar.appendChild(el('span', { cls: 'parsec-bp-profilebar__label', text: 'PROFILE' }));
    bar.appendChild(el('span', { cls: 'parsec-bp-profilebar__name', text: activeProfile.name }));
    if (dirty) {
      bar.appendChild(el('span', {
        cls: 'parsec-bp-profilebar__dirty',
        text: '● unsaved changes',
        attrs: { title: 'Your settings differ from this profile. Save them in Settings.' },
      }));
    }
    const focusSyms = currentFocus.map((id) => focusAsset(id)?.symbol ?? id).join(' · ');
    bar.appendChild(el('span', { cls: 'parsec-bp-profilebar__focus', text: focusSyms }));
    if (currentWatch.length > 0) {
      bar.appendChild(el('span', { cls: 'parsec-bp-profilebar__focus', text: `watching ${currentWatch.length}` }));
    }
    const open = el('button', { cls: 'parsec-matrix__blue-switch', text: 'SETTINGS', attrs: { type: 'button' } });
    open.addEventListener('click', () => {
      // Settings sits behind the tab bar, which the depth landing does not
      // show; opening Settings from the landing takes the profile's depth.
      if (diagLevel === null) {
        diagLevel = activeProfile.depth;
        try { localStorage.setItem(DIAG_LEVEL_KEY, diagLevel); } catch { /* best effort */ }
      }
      blueInitialTab = 'settings';
      renderPanel();
    });
    bar.appendChild(open);
    return bar;
  }

  /** A labelled on/off switch bound to an overlay pref. */
  function settingsSwitch(label: string, pref: OverlayPref, tab = 'settings'): HTMLElement {
    const b = el('button', {
      cls: `parsec-matrix__blue-switch${pref.on ? '' : ' parsec-matrix__blue-switch--off'}`,
      text: `${label} ${pref.on ? 'ON' : 'OFF'}`,
      attrs: { type: 'button', 'aria-pressed': String(pref.on) },
    });
    b.addEventListener('click', () => {
      pref.toggle();
      if (pref === pricesPref && pricesPref.on && !cryptocloudPref.on) cryptocloudPref.toggle();
      void refreshPinnedExtras().then(() => afterChoiceChange(tab));
    });
    return b;
  }

  function settingsGroup(title: string, note?: string): { wrap: HTMLElement; body: HTMLElement } {
    const wrap = el('section', { cls: 'parsec-bp-settings__group' });
    wrap.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: title }));
    if (note) wrap.appendChild(el('p', { cls: 'parsec-matrix__diag-note', text: note }));
    const body = el('div', { cls: 'parsec-bp-settings__row' });
    wrap.appendChild(body);
    return { wrap, body };
  }

  function loadSettingsTab(box: HTMLElement): void {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'SETTINGS — CONTROL OF DIAGNOSTICS' }));
    const settings = el('div', { cls: 'parsec-bp-settings' });
    box.appendChild(settings);

    // Profile
    {
      const { wrap, body } = settingsGroup(
        'Profile',
        'A profile saves every choice on this page under a name. PARSEC is the default, seeded from your own selections; it can be saved over but not deleted.',
      );
      const all = profiles.listProfiles();
      const select = document.createElement('select');
      select.className = 'parsec-bp-settings__select';
      select.setAttribute('aria-label', 'Active profile');
      for (const p of all) {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.builtin ? `${p.name} (default)` : p.name;
        o.selected = p.id === activeProfile.id;
        select.appendChild(o);
      }
      select.addEventListener('change', () => {
        const next = all.find((p) => p.id === select.value);
        if (next) applyProfile(next);
      });
      body.appendChild(select);

      const dirty = profileDirty();
      body.appendChild(btn(dirty ? 'Save' : 'Saved', {
        minimal: true, intent: dirty ? 'primary' : 'none', disabled: !dirty,
        onClick: () => {
          try {
            activeProfile = profiles.updateProfile(activeProfile.id, captureChoices());
            toast(`Saved to ${activeProfile.name}`, 'success');
          } catch (e) { toast(e instanceof Error ? e.message : 'Save failed', 'danger'); }
          afterChoiceChange();
        },
      }));

      const nameInput = input({
        type: 'text', placeholder: 'New profile name', cls: 'bp5-input parsec-bp-settings__name',
        onEnter: () => saveAs(),
      }) as HTMLInputElement;
      const saveAs = () => {
        const name = nameInput.value.trim();
        if (!name) { toast('Name the profile first', 'warning'); nameInput.focus(); return; }
        activeProfile = profiles.saveProfileAs(name, captureChoices());
        toast(`Saved as ${activeProfile.name}`, 'success');
        afterChoiceChange();
      };
      body.appendChild(nameInput);
      body.appendChild(btn('Save as new', { minimal: true, onClick: saveAs }));

      if (!activeProfile.builtin) {
        body.appendChild(btn('Delete', {
          minimal: true, intent: 'danger',
          onClick: () => {
            const gone = activeProfile.name;
            profiles.deleteProfile(activeProfile.id);
            toast(`Deleted ${gone}. PARSEC is active.`, 'primary');
            applyProfile(profiles.getActiveProfile());
          },
        }));
      }
      if (dirty) {
        body.appendChild(btn('Revert', {
          minimal: true,
          onClick: () => applyProfile(activeProfile),
        }));
      }
      settings.appendChild(wrap);
    }

    // Landing — the same controls as the toggle stack, here as well.
    {
      const { wrap, body } = settingsGroup('Landing', 'What the Matrix screen shows. Mirrors the toggles in its bottom-right corner.');
      body.appendChild(settingsSwitch('MATRIX', matrixPref));
      body.appendChild(settingsSwitch('CRYPTOCLOUD', cryptocloudPref));
      body.appendChild(settingsSwitch('TOP 10', top10Pref));
      body.appendChild(settingsSwitch('FAVOURITES', favouritesPref));
      body.appendChild(settingsSwitch('STABLECOINS', stablecoinsPref));
      body.appendChild(settingsSwitch('PYRAMID', pyramidPref));
      const period = document.createElement('select');
      period.className = 'parsec-bp-settings__select';
      period.setAttribute('aria-label', 'Change period');
      for (const p of CHANGE_PERIODS) {
        const o = document.createElement('option');
        o.value = p; o.textContent = `CHANGE ${p.toUpperCase()}`; o.selected = p === pricePeriod;
        period.appendChild(o);
      }
      period.addEventListener('change', () => {
        pricePeriod = period.value as ChangePeriod;
        try { localStorage.setItem(PERIOD_KEY, pricePeriod); } catch { /* best effort */ }
        afterChoiceChange();
      });
      body.appendChild(period);
      settings.appendChild(wrap);
    }

    // Diagnostics depth and extensions
    {
      const { wrap, body } = settingsGroup('Diagnostics', 'How deep the instruments go, and which extension panels are on.');
      for (const lv of ['basic', 'scientific', 'advanced'] as const) {
        const b = el('button', {
          cls: `parsec-matrix__blue-switch${diagLevel === lv ? '' : ' parsec-matrix__blue-switch--off'}`,
          text: lv.toUpperCase(),
          attrs: { type: 'button', 'aria-pressed': String(diagLevel === lv) },
        });
        b.addEventListener('click', () => {
          diagLevel = lv;
          try { localStorage.setItem(DIAG_LEVEL_KEY, lv); } catch { /* best effort */ }
          afterChoiceChange();
        });
        body.appendChild(b);
      }
      body.appendChild(el('span', { cls: 'parsec-bp-settings__sep' }));
      body.appendChild(settingsSwitch('ARWEAVE', arweavePref));
      body.appendChild(settingsSwitch('AR.IO', arioPref));
      body.appendChild(settingsSwitch('CHAINMARKETCAP', chainmarketcapPref));
      body.appendChild(settingsSwitch('PRICES', pricesPref));
      body.appendChild(settingsSwitch('NEWSFEED', newsPref));
      settings.appendChild(wrap);
    }

    // Emphasis
    {
      const { wrap, body } = settingsGroup(
        'Emphasis',
        'The assets the diagnostics put first — the pulse strip, the Focus section and the derivatives. Order is the order you switch them on.',
      );
      for (const a of FOCUS_CATALOG) {
        const on = currentFocus.includes(a.id);
        const chip = el('button', {
          cls: `parsec-matrix__blue-switch${on ? '' : ' parsec-matrix__blue-switch--off'}`,
          text: a.symbol,
          attrs: { type: 'button', 'aria-pressed': String(on), title: a.name },
        });
        chip.addEventListener('click', () => {
          currentFocus = on ? currentFocus.filter((id) => id !== a.id) : [...currentFocus, a.id];
          saveFocus();
          afterChoiceChange();
        });
        body.appendChild(chip);
      }
      settings.appendChild(wrap);
    }

    // Watched wallets
    {
      const { wrap, body } = settingsGroup(
        'Wallets to watch',
        'Read only. The Blue Pill reads public balances for these addresses and never signs, sends or connects for them. Each read tells that chain\'s public endpoint which address was asked about.',
      );
      body.classList.add('parsec-bp-settings__row--stack');
      const list = el('div', { cls: 'parsec-bp-watchlist' });
      if (currentWatch.length === 0) {
        list.appendChild(el('p', { cls: 'bp5-text-muted', text: 'Not watching any wallet.' }));
      }
      currentWatch.forEach((w, i) => {
        const row = el('div', { cls: 'parsec-matrix__diag-row' });
        row.appendChild(el('span', { cls: 'parsec-matrix__diag-row-label', text: `${w.label || watch.WATCH_CHAIN_LABEL[w.chain]} · ${watch.WATCH_CHAIN_LABEL[w.chain]}` }));
        const v = el('span', { cls: 'parsec-matrix__diag-row-value' });
        v.appendChild(el('span', { text: watch.shortAddress(w.address), attrs: { title: w.address } }));
        v.appendChild(btn('Remove', {
          minimal: true, intent: 'danger',
          onClick: () => { currentWatch = currentWatch.filter((_, j) => j !== i); saveWatch(); afterChoiceChange(); },
        }));
        row.appendChild(v);
        list.appendChild(row);
      });
      body.appendChild(list);

      // Add by address. The format suggests the chain; Rust confirms it.
      const form = el('div', { cls: 'parsec-bp-settings__row' });
      const addr = input({ type: 'text', placeholder: 'Address to watch', cls: 'bp5-input parsec-bp-settings__addr' }) as HTMLInputElement;
      const label = input({ type: 'text', placeholder: 'Label (optional)', cls: 'bp5-input parsec-bp-settings__name' }) as HTMLInputElement;
      const chainSel = document.createElement('select');
      chainSel.className = 'parsec-bp-settings__select';
      chainSel.setAttribute('aria-label', 'Chain');
      const status = el('p', { cls: 'parsec-matrix__diag-note' });
      const suggest = () => {
        const cands = watch.classifyAddress(addr.value);
        chainSel.innerHTML = '';
        for (const c of cands) {
          const o = document.createElement('option');
          o.value = c; o.textContent = watch.WATCH_CHAIN_LABEL[c];
          chainSel.appendChild(o);
        }
        chainSel.disabled = cands.length === 0;
        status.textContent = addr.value.trim() === '' ? ''
          : cands.length === 0 ? 'Not an address format PARSEC can watch.'
          : cands.length > 1 ? 'This fits more than one chain. Pick which.' : '';
      };
      addr.addEventListener('input', suggest);
      suggest();
      const add = async () => {
        const address = addr.value.trim();
        const chain = chainSel.value as watch.WatchChain;
        if (!address || !chain) { status.textContent = 'Enter an address first.'; return; }
        if (currentWatch.length >= profiles.MAX_WATCHED) { status.textContent = `A profile watches at most ${profiles.MAX_WATCHED} wallets.`; return; }
        if (currentWatch.some((w) => w.chain === chain && w.address === address)) { status.textContent = 'Already watching that wallet.'; return; }
        status.textContent = 'Checking…';
        const v = await import('../lib/validate');
        const verdict = await watch.confirmChain(chain, address, {
          algorand: v.validateAlgorandAddress, solana: v.validateSolanaAddress,
          bitcoin: v.validateBitcoinAddress, evm: v.validateEvmAddress,
        });
        if (!verdict.ok) { status.textContent = `Not added: ${verdict.reason}`; return; }
        const clean = sanitizeWatched({ chain, address, label: label.value });
        if (!clean) { status.textContent = 'Not added: that address could not be stored.'; return; }
        currentWatch = [...currentWatch, clean];
        saveWatch();
        afterChoiceChange('watch');
      };
      form.appendChild(addr);
      form.appendChild(chainSel);
      form.appendChild(label);
      form.appendChild(btn('Watch', { minimal: true, intent: 'primary', onClick: () => { void add(); } }));
      body.appendChild(form);
      body.appendChild(status);

      // Quick add: this device's own wallets, by their public addresses.
      const own: WatchedWallet[] = [];
      for (const acct of store.get().accounts) {
        for (const [chainId, a] of Object.entries(acct.chains ?? {})) {
          const chain: watch.WatchChain | null =
            chainId === 'algorand' ? 'algorand'
            : chainId === 'solana' ? 'solana'
            : chainId.startsWith('arweave') ? 'arweave'
            : chainId === 'bitcoin' ? 'bitcoin'
            : chainId === 'evm' || chainId === 'base' || chainId === 'ethereum' ? 'evm' : null;
          const w = chain ? sanitizeWatched({ chain, address: a, label: acct.name }) : null;
          if (w && !own.some((o) => o.chain === w.chain && o.address === w.address)
              && !currentWatch.some((c) => c.chain === w.chain && c.address === w.address)) own.push(w);
        }
      }
      if (own.length > 0) {
        const quick = el('div', { cls: 'parsec-bp-settings__row' });
        quick.appendChild(el('span', { cls: 'parsec-bp-settings__hint', text: 'This device:' }));
        for (const w of own) {
          const b = el('button', {
            cls: 'parsec-matrix__blue-switch parsec-matrix__blue-switch--off',
            text: `+ ${w.label} · ${watch.WATCH_CHAIN_LABEL[w.chain]}`,
            attrs: { type: 'button', title: w.address },
          });
          b.addEventListener('click', () => {
            if (currentWatch.length >= profiles.MAX_WATCHED) return;
            currentWatch = [...currentWatch, w];
            saveWatch();
            afterChoiceChange();
          });
          quick.appendChild(b);
        }
        body.appendChild(quick);
      }
      settings.appendChild(wrap);
    }
  }

  /** Read-only balances of the profile's watched wallets. */
  async function loadWatchTab(box: HTMLElement, netLog: HTMLElement): Promise<void> {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'WATCHING — READ ONLY' }));
    box.appendChild(el('p', {
      cls: 'parsec-matrix__diag-note',
      text: 'Balances only. Nothing here can sign, send or connect — for that, take the Red Pill and log in.',
    }));
    if (currentWatch.length === 0) {
      box.appendChild(el('p', { cls: 'bp5-text-muted', text: 'Not watching any wallet. Add one in Settings.' }));
      return;
    }
    const sections = currentWatch.map((w) => {
      const wrap = el('div');
      const desc = getChainDescriptor(w.chain === 'evm' ? 'ethereum' : w.chain === 'arweave' ? 'arweave' : w.chain);
      const head = el('div', { cls: 'parsec-matrix__diag-subsection', text: `${w.label || watch.WATCH_CHAIN_LABEL[w.chain]} · ${watch.WATCH_CHAIN_LABEL[w.chain]} · ${watch.shortAddress(w.address)}` });
      wrap.appendChild(head);
      const url = w.chain === 'evm' ? `https://blockscan.com/address/${w.address}`
        : w.chain === 'bitcoin' ? `https://mempool.space/address/${w.address}`
        : desc.explorerUrl(w.address);
      if (url && url !== '#') {
        wrap.appendChild(el('a', {
          cls: 'parsec-matrix__diag-link', text: 'explorer ↗',
          attrs: { href: url, target: '_blank', rel: 'noreferrer noopener', title: `Opens ${new URL(url).hostname} — it will see this address` },
        }));
      }
      const body = el('div');
      body.appendChild(el('p', { cls: 'parsec-matrix__diag-loading', text: 'Reading…' }));
      wrap.appendChild(body);
      box.appendChild(wrap);
      return { w, body };
    });
    logNet(netLog, 'FETCH', `watching ${currentWatch.length} wallet(s)`);
    await Promise.all(sections.map(async ({ w, body }) => {
      const readings = await watch.readWatched(w);
      body.innerHTML = '';
      const shown = w.chain === 'evm' ? readings.filter((r) => r.raw === null || r.raw > 0n) : readings;
      for (const r of shown) {
        body.appendChild(diagRow(r.network, r.raw === null ? `— ${r.error ?? 'unavailable'}` : watch.formatReading(r)));
      }
      if (w.chain === 'evm' && shown.length < readings.length) {
        body.appendChild(el('p', { cls: 'parsec-matrix__diag-note', text: `Empty on ${readings.filter((r) => r.raw === 0n).map((r) => r.network).join(', ')}.` }));
      }
    }));
    logNet(netLog, 'OK', 'watch balances');
  }

  // ── Blue Pill: market pulse ──
  //
  // The first thing the blue pill shows, before a depth is chosen: the whole
  // market in one line. Every cell starts as "…" and stays "—" if its source
  // cannot be read; nothing here renders a confident zero for a missing figure.
  function renderMarketPulse(): HTMLElement {
    const strip = el('div', { cls: 'parsec-pulse', attrs: { role: 'group', 'aria-label': 'Market pulse' } });
    const cell = (label: string) => {
      const value = el('span', { cls: 'parsec-pulse__value', text: '…' });
      const sub = el('span', { cls: 'parsec-pulse__sub' });
      strip.appendChild(el('div', { cls: 'parsec-pulse__cell', children: [
        el('span', { cls: 'parsec-pulse__label', text: label }), value, sub,
      ]}));
      return (v: string, s = '', tone: Status = 'unknown') => {
        value.textContent = v;
        sub.textContent = s;
        if (tone !== 'unknown') sub.dataset.tone = tone; else delete sub.dataset.tone;
      };
    };
    const moveTone = (p: number | null): Status => (p === null ? 'unknown' : p >= 0 ? 'ok' : 'deficient');

    const cap = cell('Market cap');
    const vol = cell('24h volume');
    const dom = cell('BTC dom');
    const fng = cell('Fear & Greed');
    const funding = cell('BTC funding');

    void mg.fetchGlobalMarket().then((g) => {
      if (!g) { cap('—'); vol('—'); dom('—'); return; }
      cap(mg.compactUsd(g.totalMarketCapUsd), mg.signedPct(g.marketCapChange24hPct), moveTone(g.marketCapChange24hPct));
      vol(mg.compactUsd(g.totalVolumeUsd), mg.signedPct(g.volumeChange24hPct));
      const split = mg.dominanceSplit(g.dominance);
      dom(g.dominance.btc === undefined ? '—' : `${split.btc.toFixed(1)}%`,
        g.dominance.eth === undefined ? '' : `ETH ${split.eth.toFixed(1)}%`);
    });
    void mg.fetchFearGreed().then((f) => {
      if (!f) { fng('—'); return; }
      const d = f.yesterday ? f.now.value - f.yesterday.value : null;
      fng(String(f.now.value), `${f.now.label}${d === null || d === 0 ? '' : ` · ${d > 0 ? '+' : '−'}${Math.abs(d)} 1d`}`);
    });
    void mg.fetchPerps(['BTC']).then(([p]) => {
      if (!p) { funding('—'); return; }
      funding(`${(p.fundingRate * 100).toFixed(4)}%`, mg.fundingBias(p.fundingRate));
    });

    // The profile's emphasis, in its order: one compact cell per asset.
    const wrap = el('div', { cls: 'parsec-pulse-wrap' });
    wrap.appendChild(strip);
    if (currentFocus.length > 0) {
      const focus = el('div', { cls: 'parsec-pulse parsec-pulse--focus', attrs: { role: 'group', 'aria-label': `Focus — ${activeProfile.name}` } });
      const fills = new Map<string, (v: string, s: string, t: Status) => void>();
      for (const id of currentFocus) {
        const a = focusAsset(id);
        const value = el('span', { cls: 'parsec-pulse__value', text: '…' });
        const sub = el('span', { cls: 'parsec-pulse__sub' });
        focus.appendChild(el('div', { cls: 'parsec-pulse__cell', children: [
          el('span', { cls: 'parsec-pulse__label', text: a?.symbol ?? id }), value, sub,
        ]}));
        fills.set(id, (v, sText, tone) => {
          value.textContent = v; sub.textContent = sText;
          if (tone !== 'unknown') sub.dataset.tone = tone;
        });
      }
      wrap.appendChild(focus);
      void mg.fetchCoinsDetail(currentFocus).then((coins) => {
        const byId = new Map(coins.map((c) => [c.id, c]));
        for (const [id, fill] of fills) {
          const c = byId.get(id);
          if (!c) fill('—', '', 'unknown');
          else fill(formatPrice(c.priceUsd), mg.signedPct(c.change24hPct), moveTone(c.change24hPct));
        }
      });
    }
    return wrap;
  }

  // ── Blue Pill Tab: Global Overview (The Tank View) ──
  //
  // Whole-market readings a trader starts from, then the same questions asked
  // of Algorand. Sections are laid out first and filled as each source answers,
  // so a slow feed never reorders the page.
  async function loadGlobalTab(box: HTMLElement, netLog: HTMLElement) {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'GLOBAL CRYPTO MARKET' }));
    box.appendChild(diagRow('Timestamp', new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'));

    const moveTone = (p: number | null | undefined): Status =>
      p === null || p === undefined || !Number.isFinite(p) ? 'unknown' : p >= 0 ? 'ok' : 'deficient';

    /** A titled section whose rows arrive later. `fill` replaces the placeholder. */
    const section = (title: string) => {
      const wrap = el('div');
      wrap.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: title }));
      const body = el('div');
      body.appendChild(el('p', { cls: 'parsec-matrix__diag-loading', text: 'Reading…' }));
      wrap.appendChild(body);
      box.appendChild(wrap);
      return {
        fill(rows: HTMLElement[]) {
          body.innerHTML = '';
          if (rows.length === 0) body.appendChild(el('p', { cls: 'bp5-text-muted', text: 'Source unavailable right now.' }));
          rows.forEach((r) => body.appendChild(r));
        },
      };
    };

    const sMarket = section('Market');
    const sDominance = section('Dominance');
    const sSentiment = section('Sentiment');
    const focusAssets = currentFocus.map((id) => focusAsset(id)).filter((a): a is NonNullable<typeof a> => a !== undefined);
    const sFocus = section(`Focus — ${activeProfile.name} profile`);
    const withAlgo = currentFocus.includes('algorand');
    const sAlgo = withAlgo ? section('Algorand') : null;
    const sDerivs = section('Derivatives — perpetual funding & open interest (Bybit)');
    const sLiquidity = section('Liquidity');
    const sInfra = section('Infrastructure');

    logNet(netLog, 'FETCH', `global market · sentiment · perps · DEX · focus ${focusAssets.length}`);
    const perpBases = focusAssets.map((a) => a.perp).filter((b): b is string => Boolean(b));
    const [g, f, perps, dex, focusCoins, algoDex, focusTvl] = await Promise.all([
      mg.fetchGlobalMarket(),
      mg.fetchFearGreed(),
      mg.fetchPerps(perpBases.length > 0 ? perpBases : ['BTC', 'ETH']),
      mg.fetchDexVolume(),
      mg.fetchCoinsDetail(currentFocus),
      withAlgo ? mg.fetchDexVolume('algorand') : Promise.resolve(null),
      mg.fetchChainTvls(focusAssets.map((a) => a.llamaChain).filter((n): n is string => Boolean(n))),
    ]);
    const algo = focusCoins.find((c) => c.id === 'algorand')
      ?? (withAlgo ? await mg.fetchCoinDetail('algorand') : null);
    const algoTvl = focusTvl.get('Algorand') ?? null;

    // Focus: one row per emphasised asset, in the profile's order.
    {
      const byId = new Map(focusCoins.map((c) => [c.id, c]));
      sFocus.fill(focusAssets.map((a) => {
        const c = byId.get(a.id);
        if (!c) return diagRow(a.symbol, '— not returned by the price source');
        const turnover = mg.turnoverPct(c.volume24hUsd, c.marketCapUsd);
        const tvl = a.llamaChain ? focusTvl.get(a.llamaChain) : undefined;
        const parts = [
          formatPrice(c.priceUsd),
          `1h ${mg.signedPct(c.change1hPct, 1)} · 24h ${mg.signedPct(c.change24hPct, 1)} · 7d ${mg.signedPct(c.change7dPct, 1)}`,
          `cap ${mg.compactUsd(c.marketCapUsd)}${c.rank ? ` #${c.rank}` : ''}`,
          `vol ${mg.compactUsd(c.volume24hUsd)}${turnover === null ? '' : ` (${turnover.toFixed(1)}%)`}`,
        ];
        if (tvl !== undefined) parts.push(`TVL ${mg.compactUsd(tvl)}`);
        return diagRow(a.symbol, parts.join('  ·  '), moveTone(c.change24hPct));
      }));
    }

    // Market
    if (g) {
      const turnover = mg.turnoverPct(g.totalVolumeUsd, g.totalMarketCapUsd);
      sMarket.fill([
        diagRow('Total market cap', `${mg.compactUsd(g.totalMarketCapUsd)}  (${mg.signedPct(g.marketCapChange24hPct)} 24h)`, moveTone(g.marketCapChange24hPct)),
        diagRow('24h volume', `${mg.compactUsd(g.totalVolumeUsd)}  (${mg.signedPct(g.volumeChange24hPct)} vs prior day)`),
        diagRow('Volume / market cap', turnover === null ? '—' : `${turnover.toFixed(2)}% turnover`),
        diagRow('Active coins · markets', `${g.activeCryptocurrencies?.toLocaleString() ?? '—'} · ${g.markets?.toLocaleString() ?? '—'}`),
        diagRow('Source', g.source === 'coingecko' ? 'CoinGecko' : 'CoinPaprika (CoinGecko rate-limited)'),
      ]);
      const split = mg.dominanceSplit(g.dominance);
      const bar = (pct: number) => '█'.repeat(Math.round(pct / 5)).padEnd(20, '░');
      const domRows = [diagRow('Bitcoin', g.dominance.btc === undefined ? '—' : `${split.btc.toFixed(2)}%  ${bar(split.btc)}`)];
      // The fallback source reports BTC only. The rest stays unknown rather
      // than rendering as 0 % and an inflated "altcoins" remainder.
      if (g.dominance.eth !== undefined) {
        domRows.push(
          diagRow('Ethereum', `${split.eth.toFixed(2)}%  ${bar(split.eth)}`),
          diagRow('Stablecoins', `${split.stables.toFixed(2)}%  ${bar(split.stables)}`),
          diagRow('Altcoins (rest)', `${split.alts.toFixed(2)}%  ${bar(split.alts)}`),
          diagRow('ETH / BTC dominance', split.btc > 0 ? (split.eth / split.btc).toFixed(3) : '—'),
        );
      } else {
        domRows.push(diagRow('ETH · stables · alts', '— (not in the fallback source)'));
      }
      sDominance.fill(domRows);
      logNet(netLog, 'OK', `Market ${mg.compactUsd(g.totalMarketCapUsd)} · vol ${mg.compactUsd(g.totalVolumeUsd)}`);
    } else {
      sMarket.fill([]); sDominance.fill([]);
      logNet(netLog, 'ERR', 'coingecko /global');
    }

    // Sentiment
    const sentimentRows: HTMLElement[] = [];
    if (f) {
      const vs = (p: mg.FearGreedPoint | null, label: string) => {
        if (!p) return;
        const d = f.now.value - p.value;
        sentimentRows.push(diagRow(`  vs ${label}`, `${p.value} ${p.label}  (${d >= 0 ? '+' : '−'}${Math.abs(d)})`));
      };
      sentimentRows.push(diagRow('Fear & Greed', `${f.now.value} / 100 — ${f.now.label}`));
      vs(f.yesterday, 'yesterday');
      vs(f.weekAgo, 'last week');
      vs(f.monthAgo, 'last month');
      if (f.nextUpdateSec !== null) sentimentRows.push(diagRow('Next reading in', `${Math.round(f.nextUpdateSec / 3600)}h`));
      logNet(netLog, 'OK', `F&G ${f.now.value} ${f.now.label}`);
    }
    if (prices.length > 0) {
      const breadth = getMarketBreadth(prices);
      const avgMove = prices.reduce((s, c) => s + Math.abs(c.change24h), 0) / prices.length;
      sentimentRows.push(diagRow('Breadth (top 100)', `${breadth.greenPct}% up · ${breadth.redPct}% down · ${breadth.flatPct}% flat`, breadth.greenPct >= breadth.redPct ? 'ok' : 'deficient'));
      sentimentRows.push(diagRow('Avg 24h move (top 100)', `${avgMove.toFixed(2)}%`));
      for (const sym of ['BTC', 'ETH', 'SOL']) {
        const c = prices.find((p) => p.symbol === sym);
        if (c) sentimentRows.push(diagRow(sym, `${formatPrice(c.usd)}  (${mg.signedPct(c.change24h)})`, moveTone(c.change24h)));
      }
    }
    sSentiment.fill(sentimentRows);

    // Derivatives
    sDerivs.fill(perps.map((p) => {
      const base = p.symbol.replace(/USDT$/, '');
      return diagRow(
        base,
        `funding ${(p.fundingRate * 100).toFixed(4)}%/8h (${mg.fundingAnnualPct(p.fundingRate).toFixed(1)}% APR, ${mg.fundingBias(p.fundingRate)}) · OI ${mg.compactUsd(p.openInterestUsd)} · 24h turnover ${mg.compactUsd(p.turnover24hUsd)}`,
      );
    }));
    if (perps.length) logNet(netLog, 'OK', `perps ${perps.length}`);

    // Liquidity
    const liqRows: HTMLElement[] = [];
    if (dex) {
      liqRows.push(diagRow('DEX spot volume 24h', `${mg.compactUsd(dex.total24hUsd)}  (${mg.signedPct(dex.change1dPct)} 1d · ${mg.signedPct(dex.change7dPct)} 7d)`));
      if (g) {
        const share = dex.total24hUsd / g.totalVolumeUsd * 100;
        if (Number.isFinite(share)) liqRows.push(diagRow('DEX share of volume', `${share.toFixed(1)}%`));
      }
    }
    if (g && g.dominance.usdt !== undefined) {
      const stables = mg.dominanceSplit(g.dominance).stables;
      liqRows.push(diagRow('Stablecoin cap (est.)', `${mg.compactUsd(g.totalMarketCapUsd * stables / 100)}  — dry powder`));
    }
    try {
      const res = await fetch('https://api.llama.fi/v2/historicalChainTvl', { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json() as Array<{ date: number; tvl: number }>;
        const latest = data[data.length - 1];
        const week = data[data.length - 8];
        const month = data[data.length - 31];
        const ch = (a?: { tvl: number }) => (a ? ((latest.tvl - a.tvl) / a.tvl) * 100 : null);
        liqRows.push(diagRow('DeFi TVL', `${mg.compactUsd(latest.tvl)}  (${mg.signedPct(ch(week), 1)} 7d · ${mg.signedPct(ch(month), 1)} 30d)`, moveTone(ch(week))));
      }
    } catch { /* the row is simply absent */ }
    sLiquidity.fill(liqRows);

    // Algorand
    const algoRows: HTMLElement[] = [];
    if (algo) {
      const pos = mg.rangePosition(algo.priceUsd, algo.low24h, algo.high24h);
      const turnover = mg.turnoverPct(algo.volume24hUsd, algo.marketCapUsd);
      const btc = prices.find((p) => p.symbol === 'BTC');
      algoRows.push(diagRow('Price', `${formatPrice(algo.priceUsd)}${algo.rank ? `  · rank #${algo.rank}` : ''}${algo.source === 'coinpaprika' ? '  (CoinPaprika)' : ''}`));
      algoRows.push(diagRow('Change 1h · 24h', `${mg.signedPct(algo.change1hPct)} · ${mg.signedPct(algo.change24hPct)}`, moveTone(algo.change24hPct)));
      algoRows.push(diagRow('Change 7d · 30d', `${mg.signedPct(algo.change7dPct)} · ${mg.signedPct(algo.change30dPct)}`, moveTone(algo.change7dPct)));
      if (algo.low24h !== null && algo.high24h !== null) {
        algoRows.push(diagRow('24h range', `${formatPrice(algo.low24h)} – ${formatPrice(algo.high24h)}${pos === null ? '' : `  (at ${pos.toFixed(0)}% of range)`}`));
      }
      algoRows.push(diagRow('Market cap · volume', `${mg.compactUsd(algo.marketCapUsd)} · ${mg.compactUsd(algo.volume24hUsd)}${turnover === null ? '' : `  (${turnover.toFixed(1)}% turnover)`}`));
      if (btc && btc.usd > 0) algoRows.push(diagRow('ALGO / BTC', `${Math.round((algo.priceUsd / btc.usd) * 1e8).toLocaleString()} sats`));
      if (algo.athUsd !== null) algoRows.push(diagRow('From all-time high', `${mg.signedPct(algo.athChangePct, 1)}  (ATH ${formatPrice(algo.athUsd)})`));
      if (algo.circulatingSupply !== null) {
        const of = algo.maxSupply ? ` of ${(algo.maxSupply / 1e9).toFixed(1)}B (${((algo.circulatingSupply / algo.maxSupply) * 100).toFixed(1)}%)` : '';
        algoRows.push(diagRow('Circulating supply', `${(algo.circulatingSupply / 1e9).toFixed(2)}B${of}`));
      }
    }
    if (algoTvl !== null) algoRows.push(diagRow('Algorand DeFi TVL', mg.compactUsd(algoTvl)));
    if (algoDex) algoRows.push(diagRow('Algorand DEX volume 24h', `${mg.compactUsd(algoDex.total24hUsd)}  (${mg.signedPct(algoDex.change1dPct)} 1d)`));
    const algoPerp = perps.find((p) => p.symbol === 'ALGOUSDT');
    if (algoPerp) algoRows.push(diagRow('ALGO perp', `funding ${(algoPerp.fundingRate * 100).toFixed(4)}%/8h · OI ${mg.compactUsd(algoPerp.openInterestUsd)}`));
    try {
      const res = await fetch(`https://${store.get().settings.network}-api.algonode.cloud/v2/status`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const status = await res.json() as Record<string, unknown>;
        algoRows.push(diagRow('Round', Number(status['last-round'] || 0).toLocaleString(), 'ok'));
      }
    } catch { /* absent, not zero */ }
    algoRows.push(diagRow('Min tx fee', '0.001 ALGO'));
    sAlgo?.fill(algoRows);
    if (algo) logNet(netLog, 'OK', `ALGO ${formatPrice(algo.priceUsd)} ${mg.signedPct(algo.change24hPct)}`);

    // Infrastructure
    const infraRows: HTMLElement[] = [];
    const ethRpc = async (method: string): Promise<number | null> => {
      try {
        const res = await fetch('https://ethereum-rpc.publicnode.com', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method, params: [], id: 1 }),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return null;
        const data = await res.json() as { result?: string };
        return data.result ? parseInt(data.result, 16) : null;
      } catch { return null; }
    };
    const [gas, block] = await Promise.all([ethRpc('eth_gasPrice'), ethRpc('eth_blockNumber')]);
    if (gas !== null) infraRows.push(diagRow('ETH gas', `${(gas / 1e9).toFixed(2)} gwei`));
    if (block !== null) infraRows.push(diagRow('ETH block', block.toLocaleString()));
    try {
      const res = await fetch('https://api.llama.fi/v2/chains', { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const chains = await res.json() as Array<{ name: string; tvl: number }>;
        chains.filter((c) => c.tvl > 0).sort((a, b) => b.tvl - a.tvl).slice(0, 5)
          .forEach((c, i) => infraRows.push(diagRow(`TVL #${i + 1} ${c.name}`, mg.compactUsd(c.tvl))));
      }
    } catch { /* absent */ }
    sInfra.fill(infraRows);
  }

  // ── Blue Pill Tab: Gas & Fees ──
  async function loadGasTab(box: HTMLElement, netLog: HTMLElement) {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'GAS FEES ACROSS CHAINS' }));
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-loading', text: 'Querying gas prices...' }));

    const chains: Array<{ name: string; rpc: string; unit: string; decimals: number }> = [
      { name: 'Ethereum', rpc: 'https://eth.llamarpc.com', unit: 'gwei', decimals: 1 },
      { name: 'Polygon', rpc: 'https://polygon-rpc.com', unit: 'gwei', decimals: 1 },
      { name: 'Base', rpc: 'https://mainnet.base.org', unit: 'gwei', decimals: 3 },
      { name: 'Arbitrum', rpc: 'https://arb1.arbitrum.io/rpc', unit: 'gwei', decimals: 3 },
      { name: 'Optimism', rpc: 'https://mainnet.optimism.io', unit: 'gwei', decimals: 3 },
      { name: 'BSC', rpc: 'https://bsc-dataseed1.binance.org', unit: 'gwei', decimals: 1 },
    ];

    // Clear loading
    const results: HTMLElement[] = [];

    for (const chain of chains) {
      try {
        logNet(netLog, 'FETCH', `${chain.name} gas`);
        const res = await fetch(chain.rpc, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json() as { result?: string };
          if (data.result) {
            const gwei = parseInt(data.result, 16) / 1e9;
            results.push(diagRow(chain.name, `${gwei.toFixed(chain.decimals)} ${chain.unit}`));
            logNet(netLog, 'OK', `${chain.name}: ${gwei.toFixed(chain.decimals)} gwei`);
          }
        }
      } catch {
        results.push(diagRow(chain.name, 'unavailable'));
      }
    }

    // Algorand fixed fee
    results.push(diagRow('Algorand', '0.001 ALGO (fixed)'));
    logNet(netLog, 'OK', 'Algorand: 0.001 ALGO (fixed)');

    box.innerHTML = '';
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'GAS FEES ACROSS CHAINS' }));
    results.forEach(r => box.appendChild(r));

    // ETH transaction cost estimates
    const ethPrice = prices.find(p => p.symbol === 'ETH');
    if (ethPrice && results.length > 0) {
      const ethGasText = results[0]?.querySelector('.parsec-matrix__diag-row-value')?.textContent || '';
      const ethGwei = parseFloat(ethGasText);
      if (ethGwei > 0) {
        box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Ethereum Cost Estimates' }));
        const transfer = (ethGwei * 21000 / 1e9) * ethPrice.usd;
        const swap = (ethGwei * 150000 / 1e9) * ethPrice.usd;
        const mint = (ethGwei * 250000 / 1e9) * ethPrice.usd;
        box.appendChild(diagRow('Simple Transfer (21k)', `$${transfer.toFixed(2)}`));
        box.appendChild(diagRow('DEX Swap (150k)', `$${swap.toFixed(2)}`));
        box.appendChild(diagRow('NFT Mint (250k)', `$${mint.toFixed(2)}`));
      }
    }
  }

  // ── Blue Pill Tab: Chain Health ──
  async function loadChainsTab(box: HTMLElement, netLog: HTMLElement) {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'CHAIN TVL RANKINGS' }));
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-loading', text: 'Querying DeFi Llama...' }));

    try {
      logNet(netLog, 'FETCH', 'Chain TVL rankings');
      const res = await fetch('https://api.llama.fi/v2/chains', { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const chains = await res.json() as Array<{ name: string; tvl: number }>;
        const top = chains.filter(c => c.tvl > 0).sort((a, b) => b.tvl - a.tvl).slice(0, 15);
        box.innerHTML = '';
        box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'CHAIN TVL RANKINGS' }));
        top.forEach((c, i) => box.appendChild(diagRow(`${i + 1}. ${c.name}`, formatMarketCap(c.tvl))));
        logNet(netLog, 'OK', `${top.length} chains ranked`);
      }
    } catch {
      box.innerHTML = '';
      box.appendChild(diagRow('Chain data', 'unavailable'));
    }

    // Algorand protocols
    try {
      logNet(netLog, 'FETCH', 'Algorand protocols');
      const res = await fetch('https://api.llama.fi/protocols', { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const protocols = await res.json() as Array<{ name: string; tvl: number; chains: string[]; category: string }>;
        const algoProtos = protocols
          .filter(p => p.chains && p.chains.includes('Algorand') && p.tvl > 0)
          .sort((a, b) => b.tvl - a.tvl).slice(0, 8);
        if (algoProtos.length > 0) {
          box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Algorand Protocols' }));
          algoProtos.forEach(p => box.appendChild(diagRow(`${p.name} (${p.category})`, formatMarketCap(p.tvl))));
          logNet(netLog, 'OK', `${algoProtos.length} Algorand protocols`);
        }
      }
    } catch { /* skip */ }
  }

  // ── Blue Pill Tab: News (CoinMarketCap community articles) ──
  //
  // Ingested SLOWLY and through a proxy, for two independent reasons.
  //
  // 1. CoinMarketCap serves no `access-control-allow-origin` on
  //    coinmarketcap.com or api.coinmarketcap.com (checked 2026-08-31), so a
  //    browser cannot read the response however often it asks. The desktop
  //    build could go direct via `tauri-plugin-http`, but the JS side of that
  //    plugin is not installed and adding it is a new runtime dependency --
  //    the exact thing CLAUDE.md says not to do without knowing you are
  //    widening the commitment-II gap. So the source is a proxy PARSEC serves
  //    itself, which is where this data was always going to come from.
  // 2. Slowly is the requirement, not a fallback: one request per interval, one
  //    at a time, cached in between. A newsfeed on a 20s panel refresh would
  //    hammer whatever serves it.
  const NEWS_SOURCE = 'https://parsec.pythai.net/api/cmc/community/articles';
  /** Floor between ingestions. The panel refreshes far faster; this does not. */
  const NEWS_MIN_INTERVAL_MS = 15 * 60 * 1000;

  interface NewsItem { title: string; url: string; author?: string; at?: string }
  let newsCache: { at: number; items: NewsItem[] } | null = null;
  let newsInFlight: Promise<NewsItem[]> | null = null;

  async function ingestNews(): Promise<NewsItem[]> {
    if (newsCache && Date.now() - newsCache.at < NEWS_MIN_INTERVAL_MS) {
      return newsCache.items;
    }
    // One at a time: a second caller joins the first request rather than
    // starting another.
    if (newsInFlight) return newsInFlight;

    newsInFlight = (async () => {
      try {
        const res = await fetch(NEWS_SOURCE, { signal: AbortSignal.timeout(9000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw: unknown = await res.json();
        const list = Array.isArray(raw) ? raw : (raw as { items?: unknown[] })?.items;
        if (!Array.isArray(list)) throw new Error('unexpected shape');
        const items: NewsItem[] = [];
        for (const r of list) {
          const o = r as Record<string, unknown>;
          // Only take entries that carry both a title and an http(s) link:
          // this is third-party text, and a link is the one field that must
          // never be half-trusted.
          if (typeof o.title !== 'string' || typeof o.url !== 'string') continue;
          if (!/^https:\/\//.test(o.url)) continue;
          items.push({
            title: o.title.slice(0, 160),
            url: o.url,
            author: typeof o.author === 'string' ? o.author.slice(0, 60) : undefined,
            at: typeof o.at === 'string' ? o.at.slice(0, 40) : undefined,
          });
        }
        newsCache = { at: Date.now(), items: items.slice(0, 12) };
        return newsCache.items;
      } finally {
        newsInFlight = null;
      }
    })();
    return newsInFlight;
  }

  async function loadNewsTab(box: HTMLElement, netLog: HTMLElement) {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'NEWSFEED' }));
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-loading', text: 'Reading feed…' }));

    let items: NewsItem[] | null = null;
    let err = '';
    try {
      logNet(netLog, 'FETCH', 'CMC community articles');
      items = await ingestNews();
    } catch (e) {
      err = e instanceof Error ? e.message : 'failed';
    }

    box.innerHTML = '';
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'NEWSFEED' }));

    if (items === null) {
      box.appendChild(diagRow('Feed', 'unavailable', 'deficient'));
      box.appendChild(diagRow('Reason', err));
      box.appendChild(el('p', {
        cls: 'parsec-matrix__diag-note',
        text: 'CoinMarketCap sends no CORS header, so this reads a PARSEC-served proxy rather than the site directly. Until that endpoint is live the panel stays empty — deliberately, instead of showing figures it did not fetch.',
      }));
      logNet(netLog, 'ERR', `newsfeed: ${err}`);
    } else if (items.length === 0) {
      box.appendChild(diagRow('Feed', 'reachable, no articles'));
      logNet(netLog, 'OK', 'newsfeed empty');
    } else {
      const age = newsCache ? Math.round((Date.now() - newsCache.at) / 60000) : 0;
      box.appendChild(diagRow('Articles', String(items.length), 'ok'));
      box.appendChild(diagRow('Ingested', age === 0 ? 'just now' : `${age} min ago`));
      for (const it of items) {
        const row = el('div', { cls: 'parsec-matrix__diag-row' });
        row.appendChild(el('span', {
          cls: 'parsec-matrix__diag-row-label',
          text: it.author ? `${it.title} — ${it.author}` : it.title,
        }));
        const v = el('span', { cls: 'parsec-matrix__diag-row-value' });
        v.appendChild(el('a', {
          cls: 'parsec-matrix__diag-link', text: 'read ↗',
          attrs: { href: it.url, target: '_blank', rel: 'noreferrer noopener' },
        }));
        row.appendChild(v);
        box.appendChild(row);
      }
      logNet(netLog, 'OK', `newsfeed ${items.length}`);
    }

    box.appendChild(diagRow('Interval', `${NEWS_MIN_INTERVAL_MS / 60000} min minimum`));
  }

  // ── Blue Pill Tab: Standard (what PARSEC is, and what it is not yet) ──
  //
  // States the lineage and the per-commitment position rather than a badge.
  // CLAUDE.md is explicit: cp4096 conformance is BINARY -- all five commitments
  // or none -- and `docs/cypherpunk4096.md` closes with "nothing here should be
  // described as conformant until it is." Commitment II is still a hard no.
  // A diagnostics panel is the last place a claim should outrun the code, so
  // this renders the real table; the destination is labelled a destination.
  //
  // Figures are transcribed from the repo's own documents, not restated from
  // memory: CLAUDE.md (destination, binary conformance), docs/cypherpunk4096.md
  // (the commitment table), QUANTUM.md (Tier-Q self-certification, Algorand PQ
  // roadmap), SECURITY.md and docs/announcement.md (vault internals). If those
  // move, this panel is stale — it is a mirror, not a source.
  /**
   * THE OPEN LIST.
   *
   * Every entry is something PARSEC has said it will do and has not done. It
   * lives in diagnostics rather than a roadmap slide because an open commitment
   * is a question a reader is entitled to ask, and a list you can check is the
   * only kind worth publishing.
   *
   * Each states what is true today, what has to happen, and what will prove it
   * — so nobody has to take the status on faith, and the day it flips there is
   * an artifact to point at rather than an announcement.
   *
   * Transcribed from CLAUDE.md, docs/cypherpunk4096.md and QUANTUM.md. cp4096
   * conformance is BINARY — all five or none — so nothing here is described as
   * conformant until it is. This panel is a mirror; when those documents move,
   * it is stale.
   */
  interface OpenItem {
    glyph: string;
    id: string;
    title: string;
    today: string;
    needs: string;
    proof: string;
    done: boolean;
  }

  const OPEN_LIST: ReadonlyArray<OpenItem> = [
    {
      glyph: '⏳', id: 'II', title: 'Zero dependencies — the last hard no',
      today: 'Algorand, Solana and Arweave key generation and signing already live in Rust (chain_algo, chain_sol, chain_ar). Two audited crates replaced three large JS SDKs in the key path, and key material left a heap it could not be wiped from.',
      needs: 'The remaining chain SDK surface — RPC and encoding — vendored or hand-rolled. Each SDK replaced is one step; @noble and @scure stay.',
      proof: 'The dependency list itself, short enough to read in one screen and compile offline.',
      done: false,
    },
    {
      glyph: '⏳', id: 'IV', title: 'Precision without approximation',
      today: 'The x402 money path is exact — bigint smallest-units end to end, landed 2026-08-30 in src/lib/money.ts. No float touches it.',
      needs: 'The same audit through SpinTrade, ASA amounts, NFD and ArNS pricing, and marketplace listings.',
      proof: 'Not one float in any value path, anywhere in the tree.',
      done: false,
    },
    {
      glyph: '⏳', id: 'I', title: 'Determinism as identity',
      today: 'The DeltaVerse/OVERLORD deploys already carry one deterministic address across every chain — CREATE2, fixed salt, fixed constructor.',
      needs: 'The aORC suite and the spawned AO processes (BNR, BMR) have a different identity model. It needs its own argument, not an assumed pass.',
      proof: 'A stated identity model for the AO side that survives being checked.',
      done: false,
    },
    {
      glyph: '⏳', id: 'III', title: 'Verification over trust',
      today: 'Open source, client-side, nothing to take on faith that cannot be read.',
      needs: 'Per-artifact reproducible verification — not paid audits and screenshots, which commitment III explicitly refuses.',
      proof: 'A build anyone can reproduce to the same hash.',
      done: false,
    },
    {
      glyph: '🟣', id: 'V', title: 'Quantum compliance — Tier-Q, on Algorand',
      today: 'The gate that actually blocked this is CLOSED: bankon_vault stores raw bytes, never (v,r,s), so a signature scheme can change without touching the container. Symmetric side is already Grover-survivable — AES-256-GCM, SHA-512, Argon2id.',
      needs: 'Falcon-1024 alongside ed25519. Signatures stay bytes, scheme migratable behind a timelock.',
      proof: 'A PARSEC account signing post-quantum on Algorand. Q3 2026 — ahead of Algorand’s own 2027 target.',
      done: true,
    },
  ];

  function loadStandardTab(box: HTMLElement) {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'PARSEC — THE OPEN LIST' }));

    box.appendChild(el('p', {
      cls: 'parsec-matrix__diag-note',
      text: 'PARSEC is an Algorand-first wallet built to cypherpunk4096 — a standard where conformance is binary: all five commitments or none. These are the ones still open. Each says what is true today, what has to happen, and what will prove it.',
    }));

    box.appendChild(diagRow('Wallet', 'Algorand-first, multi-chain packs', 'ok'));
    box.appendChild(diagRow('Lineage', 'CP2048-QR → cypherpunk4096'));
    box.appendChild(diagRow('Open', `${OPEN_LIST.filter(i => !i.done).length} of ${OPEN_LIST.length} commitments`));

    for (const item of OPEN_LIST) {
      box.appendChild(el('div', {
        cls: 'parsec-matrix__openitem',
        children: [
          el('div', {
            cls: `parsec-matrix__openitem-head${item.done ? ' parsec-matrix__openitem-head--done' : ''}`,
            text: `${item.glyph} ${item.id} — ${item.title}`,
          }),
          el('div', { cls: 'parsec-matrix__openitem-line', children: [
            el('span', { cls: 'parsec-matrix__openitem-key', text: 'TODAY' }),
            el('span', { text: item.today }),
          ]}),
          el('div', { cls: 'parsec-matrix__openitem-line', children: [
            el('span', { cls: 'parsec-matrix__openitem-key', text: 'NEEDS' }),
            el('span', { text: item.needs }),
          ]}),
          el('div', { cls: 'parsec-matrix__openitem-line', children: [
            el('span', { cls: 'parsec-matrix__openitem-key parsec-matrix__openitem-key--proof', text: 'PROOF' }),
            el('span', { text: item.proof }),
          ]}),
        ],
      }));
    }

    box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'bankon_vault — shipped' }));
    box.appendChild(diagRow('Backend', 'Rust via Tauri · Web Crypto in browser', 'ok'));
    box.appendChild(diagRow('KDF', 'Argon2id (desktop) · PBKDF2-600k (web)', 'ok'));
    box.appendChild(diagRow('Cipher', 'AES-256-GCM', 'ok'));
    box.appendChild(diagRow('Secrets', 'raw bytes, never (v,r,s) — bankon-vault/2', 'ok'));
    box.appendChild(diagRow('Keys after signing', 'zeroized', 'ok'));
    box.appendChild(diagRow('Per-connection keypairs', 'CP2048-QR §3 conformant', 'ok'));

    box.appendChild(el('a', {
      cls: 'parsec-matrix__diag-link',
      text: "Algorand's post-quantum roadmap ↗",
      attrs: {
        href: 'https://algorand.co/blog/algorand-post-quantum-cryptography-roadmap',
        target: '_blank', rel: 'noreferrer noopener',
      },
    }));
  }

  // ── Blue Pill Tab: Prices (list view of the pinned six) ──
  //
  // The cloud is the default rendering; this is the same six as exact figures.
  // Same source, same cache -- deliberately, so the two can never disagree.
  async function loadPricesTab(box: HTMLElement, netLog: HTMLElement) {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'PINNED PRICES' }));

    logNet(netLog, 'FETCH', 'pinned prices');
    await refreshPinnedExtras();
    const pool = pricePool();

    box.innerHTML = '';
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'PINNED PRICES' }));

    let missing = 0;
    for (const pin of PINNED_PRICES) {
      const c = pool.find(x => x.symbol === pin.symbol);
      if (!c) {
        missing++;
        box.appendChild(diagRow(pin.symbol, 'unavailable'));
        continue;
      }
      const d = c.change24h;
      box.appendChild(diagRow(
        pin.symbol,
        `${formatPrice(c.usd)}   ${d >= 0 ? '+' : ''}${d.toFixed(2)}% 24h`,
        d >= 0 ? 'ok' : 'deficient',
      ));
    }

    box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Rendering' }));
    box.appendChild(diagRow('Cloud view', cryptocloudPref.on ? 'on' : 'off',
      cryptocloudPref.on ? 'ok' : 'unknown'));
    if (!cryptocloudPref.on) {
      // Say it plainly rather than leaving a switched-on panel with no cloud.
      box.appendChild(diagRow('Note', 'CRYPTOCLOUD is off — list only'));
    }
    logNet(netLog, missing ? 'WARN' : 'OK',
      `pinned prices ${PINNED_PRICES.length - missing}/${PINNED_PRICES.length}`);
  }

  // ── Blue Pill Tab: Arweave (the chain) ──
  //
  // Height and consensus, read through HTTPS AR.IO gateways rather than from
  // Arweave nodes directly. That is not a shortcut: the ~176 nodes in the peer
  // registry publish `http://<ip>:1984` only, so a page served over HTTPS
  // cannot fetch them at all (mixed content). Gateways proxy the same `/info`
  // over TLS with `access-control-allow-origin: *`. Per-node probing needs a
  // non-browser runtime -- see arweave-node-diagnostics.mjs in the warbridge
  // reference folder, which probes every node and keeps nodetime history.
  const ARWEAVE_INFO_GATEWAYS = [
    'https://arweave.net',
    'https://permagate.io',
  ] as const;

  interface ArweaveInfo {
    height: number;
    blocks: number;
    peers: number;
    release: number | null;
    network: string | null;
    ttfbMs: number;
  }

  async function readArweaveInfo(base: string): Promise<ArweaveInfo | null> {
    const started = performance.now();
    try {
      const res = await fetch(`${base}/info`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const d = await res.json() as Record<string, unknown>;
      if (typeof d.height !== 'number') return null;
      return {
        height: d.height,
        blocks: typeof d.blocks === 'number' ? d.blocks : 0,
        peers: typeof d.peers === 'number' ? d.peers : 0,
        release: typeof d.release === 'number' ? d.release : null,
        network: typeof d.network === 'string' ? d.network : null,
        ttfbMs: Math.round(performance.now() - started),
      };
    } catch {
      return null;
    }
  }

  async function loadArweaveTab(box: HTMLElement, netLog: HTMLElement) {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'ARWEAVE CHAIN' }));
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-loading', text: 'Reading chain height...' }));

    logNet(netLog, 'FETCH', 'Arweave /info');
    const reads = await Promise.all(ARWEAVE_INFO_GATEWAYS.map(readArweaveInfo));
    const live = reads
      .map((r, i) => (r ? { base: ARWEAVE_INFO_GATEWAYS[i], ...r } : null))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    box.innerHTML = '';
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'ARWEAVE CHAIN' }));

    if (live.length === 0) {
      box.appendChild(diagRow('Chain', 'unreachable', 'deficient'));
      logNet(netLog, 'ERR', 'no Arweave gateway answered');
      return;
    }

    // Highest height wins as the tip; a source more than 2 blocks behind is
    // lagging, which is a different fault from being unreachable.
    const tip = Math.max(...live.map(r => r.height));
    const top = live.find(r => r.height === tip)!;

    box.appendChild(diagRow('Height', String(tip), 'ok'));
    box.appendChild(diagRow('Blocks', top.blocks.toLocaleString()));
    box.appendChild(diagRow('Network', top.network ?? 'unknown'));
    box.appendChild(diagRow('Sources agreeing', `${live.filter(r => r.height === tip).length}/${live.length}`,
      live.every(r => r.height === tip) ? 'ok' : 'deficient'));

    box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Sources' }));
    for (const r of live) {
      const lag = tip - r.height;
      box.appendChild(diagRow(
        r.base.replace(/^https:\/\//, ''),
        `${r.height}${lag > 0 ? ` (-${lag})` : ''} · ${r.ttfbMs}ms · ${r.peers} peers`,
        lag > 2 ? 'deficient' : 'ok',
      ));
    }
    for (const [i, r] of reads.entries()) {
      if (r === null) {
        box.appendChild(diagRow(
          ARWEAVE_INFO_GATEWAYS[i].replace(/^https:\/\//, ''), 'unreachable', 'deficient',
        ));
      }
    }

    box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Node census' }));
    try {
      const peers = await readArioPeers();
      box.appendChild(diagRow('Arweave nodes known', String(peers.arweaveNodes.length)));
      box.appendChild(diagRow('Direct probe', 'CLI only — nodes are http://:1984'));
    } catch {
      box.appendChild(diagRow('Arweave nodes known', 'unavailable'));
    }

    logNet(netLog, 'OK', `Arweave height ${tip}`);
  }

  // ── Blue Pill Tab: AR.IO (the gateway layer) ──
  //
  // The gateway set is large (~640) and every gateway is HTTPS with permissive
  // CORS, so unlike the chain panel this one really can probe. It samples
  // rather than sweeps: a browser panel that opened 640 sockets on every 20s
  // refresh would be a denial-of-service tool pointed at the network it is
  // meant to be observing.
  const ARIO_SEED_GATEWAY = 'https://permagate.io';
  const ARIO_MAINNET_CORE = '73YoECm6NKXpVRoe5f1Q9BcP5DJGPFUjnFy6AxBE5Nvh';
  const ARIO_PROBE_SAMPLE = 8;
  const ARIO_NODETIME_KEY = 'parsec:matrix-ario-nodetime';

  interface ArioPeer { host: string; url: string; dataWeight: number }

  async function readArioPeers(): Promise<{ gateways: ArioPeer[]; arweaveNodes: ArioPeer[] }> {
    const res = await fetch(`${ARIO_SEED_GATEWAY}/ar-io/peers`, { signal: AbortSignal.timeout(9000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json() as Record<string, Record<string, { url?: string; dataWeight?: number }>>;
    const toList = (o: Record<string, { url?: string; dataWeight?: number }> | undefined): ArioPeer[] =>
      Object.entries(o ?? {})
        .map(([host, v]) => ({ host, url: v?.url ?? '', dataWeight: v?.dataWeight ?? 0 }))
        .filter(p => /^https?:\/\//.test(p.url));
    return { gateways: toList(d.gateways), arweaveNodes: toList(d.arweaveNodes) };
  }

  /**
   * Nodetime: share of observed refreshes in which a gateway answered.
   *
   * Kept in localStorage so the figure survives a reload and actually means
   * something by the second visit. Counters only, not a sample log — an
   * unbounded history in localStorage would grow until it threw.
   */
  function bumpNodetime(results: Array<{ host: string; up: boolean }>): Record<string, { runs: number; up: number }> {
    let store: Record<string, { runs: number; up: number }> = {};
    try {
      const raw = localStorage.getItem(ARIO_NODETIME_KEY);
      if (raw) store = JSON.parse(raw) as typeof store;
    } catch { /* corrupt or unavailable — start fresh rather than fail the panel */ }
    for (const r of results) {
      const e = store[r.host] ?? { runs: 0, up: 0 };
      e.runs++;
      if (r.up) e.up++;
      store[r.host] = e;
    }
    try {
      localStorage.setItem(ARIO_NODETIME_KEY, JSON.stringify(store));
    } catch { /* best effort */ }
    return store;
  }

  async function probeArioGateway(p: ArioPeer) {
    const started = performance.now();
    try {
      const res = await fetch(`${p.url.replace(/\/$/, '')}/ar-io/info`, { signal: AbortSignal.timeout(8000) });
      const ttfbMs = Math.round(performance.now() - started);
      if (!res.ok) return { ...p, up: false, ttfbMs, core: null as string | null };
      const d = await res.json() as { programIds?: { core?: string } };
      return { ...p, up: true, ttfbMs, core: d.programIds?.core ?? null };
    } catch {
      return { ...p, up: false, ttfbMs: Math.round(performance.now() - started), core: null as string | null };
    }
  }

  // AR.IO's control plane is Solana now, not AO. Program ids are taken from
  // `@ar.io/sdk` lib/esm/solana/constants.js -- the authoritative list; the
  // published docs page has at least one transcription error in it (an
  // `ario-arns` id one character short, which the RPC rejects as WrongSize).
  // All seven verified executable on mainnet-beta.
  const ARIO_SOLANA_PROGRAMS: ReadonlyArray<{ label: string; id: string }> = [
    { label: 'ario-core', id: '73YoECm6NKXpVRoe5f1Q9BcP5DJGPFUjnFy6AxBE5Nvh' },
    { label: 'ario-gar', id: '89fNiiwgpFSPHKuqfNUkgYTYjtAJAhyqHjXmgXeppGpf' },
    { label: 'ario-arns', id: '2yCUx5edFvUrkibYaUa2ZXWyx9kuJkS8CwyzsgHPWdZZ' },
    { label: 'ario-ant', id: '2MWexMHfMhGJwMHv9Qm9YAVCqjUFUJwDJAysW4oCUGk5' },
    { label: 'ario-ant-escrow', id: '5HZhe9UqKL5zAsdz81nuuaxV41h8bFhudzxxBigAQndM' },
    { label: 'ANT core', id: 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d' },
  ];
  const ARIO_MINT = 'DcNnMuFxwhgV4WY1HVSaSEgr92bv2b1vUvEKiNxWqHdF';
  // The participant's Solana RPC (Permaweb settings; solana-rpc.publicnode.com by default). The
  // Solana Foundation's public api.mainnet-beta.solana.com answers this panel's batch with HTTP 403
  // "Access forbidden" (checked 2026-09-10), which read as a false "control plane unreachable".
  const solanaRpc = (): string => getPermawebSettings().rpcUrl;

  /**
   * Batch the whole program set into one getMultipleAccounts call.
   *
   * Six separate getAccountInfo calls would be six round trips against a public
   * RPC that rate-limits, on a panel that refreshes every 20 seconds.
   */
  async function probeArioSolana(): Promise<{
    slot: number | null;
    programs: Array<{ label: string; id: string; executable: boolean }>;
    mintSupply: string | null;
  }> {
    const body = [
      { jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts',
        params: [ARIO_SOLANA_PROGRAMS.map(p => p.id), { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }] },
      { jsonrpc: '2.0', id: 2, method: 'getAccountInfo', params: [ARIO_MINT, { encoding: 'jsonParsed' }] },
    ];
    const res = await fetch(solanaRpc(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const out = await res.json() as Array<{ id: number; result?: any }>;
    const accounts = out.find(r => r.id === 1)?.result;
    const mint = out.find(r => r.id === 2)?.result;
    return {
      slot: accounts?.context?.slot ?? null,
      programs: ARIO_SOLANA_PROGRAMS.map((p, i) => ({
        ...p,
        executable: accounts?.value?.[i]?.executable === true,
      })),
      mintSupply: mint?.value?.data?.parsed?.info?.supply ?? null,
    };
  }

  async function loadArioTab(box: HTMLElement, netLog: HTMLElement) {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'AR.IO GATEWAYS' }));
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-loading', text: 'Discovering gateways...' }));

    let peers: { gateways: ArioPeer[]; arweaveNodes: ArioPeer[] };
    try {
      logNet(netLog, 'FETCH', 'AR.IO /ar-io/peers');
      peers = await readArioPeers();
    } catch {
      box.innerHTML = '';
      box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'AR.IO GATEWAYS' }));
      box.appendChild(diagRow('Registry', 'unreachable', 'deficient'));
      logNet(netLog, 'ERR', 'gateway discovery failed');
      return;
    }

    // Highest data weight first: sample the gateways actually carrying traffic.
    const sample = [...peers.gateways]
      .sort((a, b) => b.dataWeight - a.dataWeight)
      .slice(0, ARIO_PROBE_SAMPLE);
    const probes = await Promise.all(sample.map(probeArioGateway));
    const store = bumpNodetime(probes.map(p => ({ host: p.host, up: p.up })));

    const up = probes.filter(p => p.up);
    const mainnet = up.filter(p => p.core === ARIO_MAINNET_CORE);
    const lat = up.map(p => p.ttfbMs).sort((a, b) => a - b);
    const p50 = lat.length ? lat[Math.floor(lat.length / 2)] : null;

    box.innerHTML = '';
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'AR.IO GATEWAYS' }));
    box.appendChild(diagRow('Gateways in registry', String(peers.gateways.length)));
    box.appendChild(diagRow('Sampled', `${up.length}/${probes.length} up`,
      up.length === probes.length ? 'ok' : 'deficient'));
    box.appendChild(diagRow('On mainnet program', `${mainnet.length}/${up.length}`,
      mainnet.length === up.length ? 'ok' : 'deficient'));
    box.appendChild(diagRow('Latency p50', p50 === null ? 'n/a' : `${p50}ms`));

    box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Sampled gateways (nodetime)' }));
    for (const p of probes) {
      const e = store[p.host];
      // Uptime only earns a number once there is more than one observation of
      // it; before that "100%" would just be restating this single probe.
      const pct = e && e.runs > 1 ? ` · ${Math.round((e.up / e.runs) * 100)}% of ${e.runs}` : '';
      box.appendChild(diagRow(
        p.host,
        p.up ? `${p.ttfbMs}ms${pct}` : `down${pct}`,
        p.up ? 'ok' : 'deficient',
      ));
    }

    // The Solana control plane. AR.IO's registry, name system and ANTs are
    // Solana programs now, and domain publishing is a Solana wallet signature --
    // so a gateway panel that stopped at HTTP reachability would be reporting
    // only the read path and none of the write path.
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Solana control plane' }));
    try {
      logNet(netLog, 'FETCH', 'AR.IO Solana programs');
      const sol = await probeArioSolana();
      const liveCount = sol.programs.filter(p => p.executable).length;
      box.appendChild(diagRow('Slot', sol.slot === null ? 'n/a' : String(sol.slot)));
      box.appendChild(diagRow('Programs executable', `${liveCount}/${sol.programs.length}`,
        liveCount === sol.programs.length ? 'ok' : 'deficient'));
      for (const pr of sol.programs) {
        box.appendChild(diagRow(pr.label, pr.executable ? 'live' : 'MISSING',
          pr.executable ? 'ok' : 'deficient'));
      }
      if (sol.mintSupply !== null) {
        // ARIO is 6-decimal (mARIO); show whole tokens.
        const whole = (BigInt(sol.mintSupply) / 1000000n).toLocaleString();
        box.appendChild(diagRow('ARIO mint supply', `${whole} ARIO`));
      }
      logNet(netLog, 'OK', `Solana ${liveCount}/${sol.programs.length} programs live`);
    } catch {
      box.appendChild(diagRow('Solana control plane', 'unreachable', 'deficient'));
      logNet(netLog, 'ERR', 'Solana RPC unreachable');
    }

    logNet(netLog, 'OK', `AR.IO ${up.length}/${probes.length} up, p50 ${p50 ?? 'n/a'}ms`);
  }

  // ── Blue Pill Tab: Network Status ──
  async function loadNetworkTab(box: HTMLElement, netLog: HTMLElement) {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'NETWORK STATUS' }));

    // Algorand
    try {
      logNet(netLog, 'FETCH', 'Algorand status');
      const algodUrl = `https://${store.get().settings.network}-api.algonode.cloud`;
      const res = await fetch(`${algodUrl}/v2/status`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const status = await res.json() as Record<string, unknown>;
        const round = Number(status['last-round'] || 0);
        const blockTime = Number(status['time-since-last-round'] || 0) / 1e9;
        const catchupTime = Number(status['catchup-time'] || 0) / 1e9;
        box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Algorand' }));
        box.appendChild(diagRow('Latest Round', round.toLocaleString()));
        box.appendChild(diagRow('Last Block', `${blockTime.toFixed(1)}s ago`));
        box.appendChild(diagRow('Consensus', 'Pure Proof-of-Stake'));
        box.appendChild(diagRow('Finality', 'Instant (~3.3s, no forks)'));
        box.appendChild(diagRow('Tx Fee', '0.001 ALGO'));
        if (catchupTime > 0) box.appendChild(diagRow('Catchup', `${catchupTime.toFixed(0)}s remaining`));
        logNet(netLog, 'OK', `Round ${round.toLocaleString()}`);
      }
    } catch { box.appendChild(diagRow('Algorand', 'unavailable')); }

    // Ethereum block
    try {
      logNet(netLog, 'FETCH', 'Ethereum block');
      const res = await fetch('https://eth.llamarpc.com', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as { result?: string };
        if (data.result) {
          const block = parseInt(data.result, 16);
          box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Ethereum' }));
          box.appendChild(diagRow('Latest Block', block.toLocaleString()));
          box.appendChild(diagRow('Block Time', '~12s'));
          box.appendChild(diagRow('Consensus', 'Proof-of-Stake (post-Merge)'));
          box.appendChild(diagRow('Finality', '~15 min (2 epochs)'));
          logNet(netLog, 'OK', `ETH block ${block.toLocaleString()}`);
        }
      }
    } catch { /* skip */ }

    // Fear & Greed
    try {
      logNet(netLog, 'FETCH', 'Fear & Greed');
      const res = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json() as { data: Array<{ value: string; value_classification: string }> };
        if (data.data?.[0]) {
          box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Sentiment' }));
          box.appendChild(diagRow('Fear & Greed', `${data.data[0].value} — ${data.data[0].value_classification}`));
          logNet(netLog, 'OK', `F&G: ${data.data[0].value}`);
        }
      }
    } catch { /* skip */ }
  }

  // ── Blue Pill Tab: DeFi TVL ──
  async function loadDefiTab(box: HTMLElement, netLog: HTMLElement) {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'DEFI TOTAL VALUE LOCKED' }));
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-loading', text: 'Querying DeFi Llama...' }));

    // Global TVL
    try {
      logNet(netLog, 'FETCH', 'Global TVL');
      const res = await fetch('https://api.llama.fi/v2/historicalChainTvl', { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json() as Array<{ date: number; tvl: number }>;
        const latest = data[data.length - 1];
        const prev = data[data.length - 2];
        const week = data[data.length - 8];
        const month = data[data.length - 31];
        box.innerHTML = '';
        box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'DEFI TOTAL VALUE LOCKED' }));
        box.appendChild(diagRow('Global TVL', formatMarketCap(latest.tvl)));
        if (prev) {
          const d = ((latest.tvl - prev.tvl) / prev.tvl * 100);
          box.appendChild(diagRow('24h Change', `${d >= 0 ? '+' : ''}${d.toFixed(2)}%`));
        }
        if (week) {
          const w = ((latest.tvl - week.tvl) / week.tvl * 100);
          box.appendChild(diagRow('7d Change', `${w >= 0 ? '+' : ''}${w.toFixed(2)}%`));
        }
        if (month) {
          const m = ((latest.tvl - month.tvl) / month.tvl * 100);
          box.appendChild(diagRow('30d Change', `${m >= 0 ? '+' : ''}${m.toFixed(2)}%`));
        }
        logNet(netLog, 'OK', `Global TVL: ${formatMarketCap(latest.tvl)}`);
      }
    } catch { box.appendChild(diagRow('TVL', 'unavailable')); }

    // Algorand TVL
    try {
      logNet(netLog, 'FETCH', 'Algorand TVL');
      const res = await fetch('https://api.llama.fi/v2/historicalChainTvl/Algorand', { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json() as Array<{ date: number; tvl: number }>;
        const latest = data[data.length - 1];
        const week = data[data.length - 8];
        box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Algorand' }));
        box.appendChild(diagRow('Algorand TVL', formatMarketCap(latest.tvl)));
        if (week) {
          const w = ((latest.tvl - week.tvl) / week.tvl * 100);
          box.appendChild(diagRow('7d Change', `${w >= 0 ? '+' : ''}${w.toFixed(2)}%`));
        }
        logNet(netLog, 'OK', `Algorand TVL: ${formatMarketCap(latest.tvl)}`);
      }
    } catch { /* skip */ }

    // Stablecoin infrastructure
    try {
      logNet(netLog, 'FETCH', 'Stablecoin supply');
      const res = await fetch('https://stablecoins.llama.fi/stablecoins?includePrices=true', { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json() as { peggedAssets: Array<{ name: string; symbol: string; circulating: { peggedUSD?: number } | null }> };
        let total = 0;
        const list: Array<{ symbol: string; mcap: number }> = [];
        for (const s of data.peggedAssets) {
          const mcap = (s.circulating && typeof s.circulating.peggedUSD === 'number') ? s.circulating.peggedUSD : 0;
          if (mcap > 0) { total += mcap; list.push({ symbol: s.symbol, mcap }); }
        }
        if (total > 0) {
          box.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Stablecoin Liquidity' }));
          box.appendChild(diagRow('Total Supply', formatMarketCap(total)));
          list.sort((a, b) => b.mcap - a.mcap);
          list.slice(0, 5).forEach(s => box.appendChild(diagRow(s.symbol, formatMarketCap(s.mcap))));
          logNet(netLog, 'OK', `Stablecoins: ${formatMarketCap(total)}`);
        }
      }
    } catch { /* skip */ }

    // Deep diagnostics button — expands to full macro view (gas, chains, sentiment, predictions)
    box.appendChild(btn('Deep Diagnostics', {
      minimal: true, cls: 'parsec-matrix__action',
      onClick: () => loadDefiDiagnostics(box, netLog),
    }));
  }

  // ── Blue Pill Tab: Portfolio ──
  async function loadPortfolioTab(box: HTMLElement, netLog: HTMLElement, state: ReturnType<typeof store.get>) {
    box.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'ON-CHAIN PORTFOLIO' }));

    if (state.accounts.length === 0) {
      box.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'No accounts. Import a public address.' }));
      box.appendChild(btn('Import Watch-Only Address', { outlined: true, cls: 'parsec-matrix__action', onClick: () => { cancelAnimation(); store.navigate('import-wallet'); } }));
      return;
    }

    loadDiagnostics(box, state.accounts, state.settings.network, netLog);
  }

  /**
   * One diagnostics line.
   *
   * `tone` carries a tri-state reading (lib/ui/status.ts): a value is only
   * green when it is genuinely good, and a figure we could not fetch reads as
   * `unknown` rather than being rendered as a confident zero. The dot means
   * the row is legible without relying on colour alone.
   */
  function diagRow(label: string, value: string, tone: Status = 'unknown'): HTMLElement {
    const row = el('div', { cls: 'parsec-matrix__diag-row', children: [
      el('span', { cls: 'parsec-matrix__diag-row-label', text: label }),
      el('span', { cls: 'parsec-matrix__diag-row-value', text: value }),
    ]});
    if (tone !== 'unknown') row.dataset.tone = tone;
    return row;
  }

  /**
   * Where a panel's numbers came from and when — TIMELESS rule 4: an estimate
   * is labelled an estimate, in place, every time. Reading market data without
   * knowing whether it is live or three minutes stale is how people get hurt.
   */
  function diagProvenance(
    origin: string,
    source: SourceKind = 'live',
    reach: Reach = 'external',
  ): HTMLElement {
    // The reach class is what carries the visual separation — an internal panel
    // should not look like one that just told a third party what you asked.
    return el('div', {
      cls: `parsec-matrix__diag-provenance parsec-matrix__diag-provenance--${reach}`,
      text: provenanceLine({ source, origin, readAt: Date.now(), reach }),
    });
  }

  // DeFi diagnostics — full macro perspective: liquidity, volume, sentiment, gas, predictions
  // Called from DeFi tab "Deep Diagnostics" button or standalone
  // Uses DeFi Llama free API for TVL, protocols, stablecoins, gas, Fear & Greed
  async function loadDefiDiagnostics(container: HTMLElement, netLog: HTMLElement) {
    container.innerHTML = '';
    container.appendChild(el('div', { cls: 'parsec-matrix__diag-section-title', text: 'BLOCKCHAIN DIAGNOSTICS' }));

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
          container.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Stablecoin Liquidity Infrastructure' }));
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

    // ── DeFi Llama: Top chains by TVL ──
    try {
      logNet(netLog, 'FETCH', 'DeFi Llama — chain TVL rankings');
      const chainsRes = await fetch('https://api.llama.fi/v2/chains', { signal: AbortSignal.timeout(8000) });
      if (chainsRes.ok) {
        const chains = await chainsRes.json() as Array<{ name: string; tvl: number }>;
        const top = chains.filter(c => c.tvl > 0).sort((a, b) => b.tvl - a.tvl).slice(0, 8);
        if (top.length > 0) {
          container.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Chain TVL Rankings' }));
          top.forEach((c, i) => container.appendChild(diagRow(`${i + 1}. ${c.name}`, formatMarketCap(c.tvl))));
          logNet(netLog, 'OK', `Top chain: ${top[0].name} (${formatMarketCap(top[0].tvl)})`);
        }
      }
    } catch { logNet(netLog, 'WARN', 'Chain rankings unavailable'); }

    // ── Multi-Chain Gas Fees ──
    // Polygon
    try {
      logNet(netLog, 'FETCH', 'Polygon gas price');
      const polyRes = await fetch('https://polygon-rpc.com', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
        signal: AbortSignal.timeout(5000),
      });
      if (polyRes.ok) {
        const polyData = await polyRes.json() as { result?: string };
        if (polyData.result) {
          const gwei = parseInt(polyData.result, 16) / 1e9;
          container.appendChild(diagRow('Polygon Gas', `${gwei.toFixed(1)} gwei`));
          logNet(netLog, 'OK', `Polygon gas: ${gwei.toFixed(1)} gwei`);
        }
      }
    } catch { /* skip */ }

    // Base
    try {
      const baseRes = await fetch('https://mainnet.base.org', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
        signal: AbortSignal.timeout(5000),
      });
      if (baseRes.ok) {
        const baseData = await baseRes.json() as { result?: string };
        if (baseData.result) {
          const gwei = parseInt(baseData.result, 16) / 1e9;
          container.appendChild(diagRow('Base Gas', `${gwei.toFixed(3)} gwei`));
          logNet(netLog, 'OK', `Base gas: ${gwei.toFixed(3)} gwei`);
        }
      }
    } catch { /* skip */ }

    // Algorand tx fee (fixed)
    container.appendChild(diagRow('Algorand Tx Fee', '0.001 ALGO (~$0.0002)'));

    // ── ETH Gas Price ──
    try {
      logNet(netLog, 'FETCH', 'Ethereum gas price');
      const gasRes = await fetch('https://eth.llamarpc.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
        signal: AbortSignal.timeout(5000),
      });
      if (gasRes.ok) {
        const gasData = await gasRes.json() as { result?: string };
        if (gasData.result) {
          const gweiPrice = parseInt(gasData.result, 16) / 1e9;
          container.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Ethereum Gas' }));
          container.appendChild(diagRow('Gas Price', `${gweiPrice.toFixed(1)} gwei`));
          const ethPrice = prices.find(p => p.symbol === 'ETH');
          if (ethPrice) {
            const txCostUsd = (gweiPrice * 21000 / 1e9) * ethPrice.usd;
            container.appendChild(diagRow('Simple Transfer', `$${txCostUsd.toFixed(2)}`));
            const swapCostUsd = (gweiPrice * 150000 / 1e9) * ethPrice.usd;
            container.appendChild(diagRow('DEX Swap (~150k gas)', `$${swapCostUsd.toFixed(2)}`));
          }
          logNet(netLog, 'OK', `ETH gas: ${gweiPrice.toFixed(1)} gwei`);
        }
      }
    } catch { logNet(netLog, 'WARN', 'ETH gas unavailable'); }

    // ── Bitcoin Fear & Greed Index ──
    try {
      logNet(netLog, 'FETCH', 'Fear & Greed Index');
      const fgRes = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(5000) });
      if (fgRes.ok) {
        const fgData = await fgRes.json() as { data: Array<{ value: string; value_classification: string }> };
        if (fgData.data && fgData.data[0]) {
          const fg = fgData.data[0];
          container.appendChild(el('div', { cls: 'parsec-matrix__diag-subsection', text: 'Market Sentiment' }));
          container.appendChild(diagRow('Fear & Greed Index', `${fg.value} — ${fg.value_classification}`));
          logNet(netLog, 'OK', `Fear & Greed: ${fg.value} (${fg.value_classification})`);
        }
      }
    } catch { logNet(netLog, 'WARN', 'Fear & Greed unavailable'); }
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
        const [{ fetchAccountInfo }, { enrichAssets }] = await Promise.all([
          import('../lib/algorand/account'),
          import('../lib/algorand/assets'),
        ]);
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

  async function probeVault(): Promise<void> {
    try {
      const status = await keystoreStatus();
      const found = status.exists && status.accounts.length > 0;
      if (found && !vaultHasAccounts) {
        vaultHasAccounts = true;
        if (choice === 'red') setPill('red');  // re-render with the unlock field
      }
    } catch {
      /* no vault, or IPC unavailable — the localStorage answer stands */
    }
  }

  /**
   * After unlocking, rebuild the account list from the keystore — the keys on
   * disk are the authority, not the localStorage mirror. This is what lets a
   * passphrase alone reopen a wallet whose 'parsec-wallet-state' was lost.
   */
  async function adoptVaultAccounts(): Promise<void> {
    const keys = await recoverKeys();
    if (keys.length === 0) return;

    const { accounts, added, attached } = mergeRecovered(store.get().accounts, keys);
    if (added === 0 && attached === 0) return;

    store.set({ accounts });
    const parts: string[] = [];
    if (added) parts.push(`${added} account${added === 1 ? '' : 's'}`);
    if (attached) parts.push(`${attached} chain address${attached === 1 ? '' : 'es'}`);
    toast(`Recovered ${parts.join(' and ')} from the keystore`, 'success');
  }

  let identityTimer: ReturnType<typeof setTimeout> | null = null;
  /** The identity status line of the current Red Pill render. */
  let identityStatusEl: HTMLElement | null = null;

  /** Switch to the profile whose vault holds the typed identity's key, and say so. */
  async function openProfile(name: string, label: string): Promise<void> {
    try {
      await store.useProfile(name);
    } catch (e) {
      toast(`Could not open profile “${name}”: ${e instanceof Error ? e.message : String(e)}`, 'danger', 8000);
      return;
    }
    vaultHasAccounts = false;
    profilePanel = 'closed';
    renderPanel();
    toast(`${label}: its key is in vault “${name}” — that profile is now open`, 'primary', 6000);
    if (identityStatusEl) scheduleIdentityLookup(identityStatusEl);
  }


  /**
   * Resolve the typed identity to one of this device's accounts.
   *
   * Debounced, and every outcome is stated plainly — a name that resolves to
   * an address we hold no key for is a dead end, and must say so rather than
   * quietly opening some other account.
   */
  function scheduleIdentityLookup(statusEl: HTMLElement): void {
    if (identityTimer) clearTimeout(identityTimer);
    const typed = identityInput.trim();
    if (!typed) { statusEl.textContent = ''; statusEl.dataset.tone = ''; return; }

    statusEl.textContent = 'Resolving…';
    statusEl.dataset.tone = 'pending';

    identityTimer = setTimeout(() => {
      void (async () => {
        const network = store.get().settings.network;
        const { resolveIdentity, matchAccount } = await import('../lib/nfd/login');
        const resolved = await resolveIdentity(network, typed).catch(() => null);
        if (identityInput.trim() !== typed) return;   // superseded by newer input

        if (!resolved) {
          statusEl.textContent = `Could not resolve “${typed}”`;
          statusEl.dataset.tone = 'alert';
          return;
        }

        // Which vault holds this key? Open that profile, not whichever is open.
        const { listProfiles, profileFor } = await import('../lib/profiles');
        const pick = profileFor(await listProfiles(), resolved.addresses);
        if (identityInput.trim() !== typed) return;
        const label = resolved.name ?? resolved.addresses[0];

        if (pick.ambiguous.length > 0) {
          statusEl.dataset.tone = 'pending';
          statusEl.replaceChildren(`${label} · key in ${pick.ambiguous.length} vaults — open `);
          pick.ambiguous.forEach((name, i) => {
            if (i > 0) statusEl.append(' or ');
            statusEl.append(el('a', { text: `“${name}”`, attrs: { href: '#' }, onClick: (e) => { e.preventDefault(); void openProfile(name, label); } }));
          });
          return;
        }
        if (pick.name && pick.name !== store.profile) { void openProfile(pick.name, label); return; }

        const idx = matchAccount(store.get().accounts, resolved.addresses);
        if (idx === -1 && !pick.name) {
          const addr = resolved.addresses[0];
          statusEl.textContent = `${label} → ${addr.slice(0, 6)}…${addr.slice(-4)} · no key on this device`;
          statusEl.dataset.tone = 'alert';
        } else {
          statusEl.textContent = `${label} · key in vault “${store.profile}” — enter its passphrase`;
          statusEl.dataset.tone = 'done';
        }
      })();
    }, 450);
  }

  /** After the chooser switched or made a profile: forget what the old
   *  vault said and ask the new one. */
  function afterProfileChange(): void {
    vaultHasAccounts = false;
    profilePanel = 'closed';
    renderPanel();
  }

  /**
   * Which vault this door opens, and the way to another one. With a session
   * open the line is read-only: switching would end the session, which is
   * what "Log Out Completely" is for.
   */
  function renderProfileLine(live: boolean): void {
    const toggle = el('a', {
      text: profilePanel === 'closed' ? 'change · new vault' : 'close',
      attrs: { href: '#' },
      onClick: (e) => { e.preventDefault(); profilePanel = profilePanel === 'closed' ? 'open' : 'closed'; renderPanel(); },
    });
    panel.appendChild(el('p', { cls: 'parsec-matrix__profile', children: [
      'Profile', el('strong', { text: store.profile }), ...(live ? [] : ['·', toggle]),
    ]}));
  }

  function renderProfilePanel(): void {
    if (profilePanel === 'forgot') {
      panel.appendChild(el('p', {
        cls: 'parsec-matrix__nowallet',
        text: 'A vault passphrase cannot be recovered or reset: it is what decrypts the vault, and PARSEC keeps no copy. '
            + 'Your wallets are not lost if you have their recovery phrases. Create a new vault here, then restore each '
            + `wallet into it. Profile “${store.profile}” stays on this device untouched; if the passphrase comes back, choose it again.`,
      }));
    }
    panel.appendChild(profileChooser({
      compact: true,
      startCreating: profilePanel === 'forgot',
      onChanged: () => afterProfileChange(),
    }));
    backButton();
  }

  function renderRedPill() {
    // Red pill = wallet login + create new wallet
    const state = store.get();
    // The vault on disk is the real record; store.accounts is only the
    // localStorage mirror of it. Offer unlock when EITHER knows about a
    // wallet, so a cleared profile or a fresh install pointed at an existing
    // vault can still get in. `vaultHasAccounts` is filled by the probe below.
    const hasAccounts = state.accounts.length > 0 || vaultHasAccounts;
    const hasKeys = isTauri() || hasVault();

    panel.appendChild(el('div', { cls: 'parsec-matrix__pill-screen', children: [
      el('div', { cls: 'parsec-matrix__choice-label parsec-matrix__choice-label--red', text: 'RED PILL — LIVE WALLET' }),
      el('div', {
        cls: 'parsec-modebadge parsec-modebadge--armed',
        text: 'ARMED · signing authority',
        attrs: { title: 'The Red Pill can open the vault and sign. Leaving it logs out completely.' },
      }),
      el('p', { cls: 'parsec-matrix__lead', text: 'Sovereign access. Signing authority.' }),
    ]}));

    const live = hasLiveSession();
    renderProfileLine(live);
    if (!live && profilePanel !== 'closed') { renderProfilePanel(); return; }

    // A session is already open: the Red Pill is the logged-in perspective on
    // every wallet this vault holds. Offer the way in, and the way fully out.
    if (live) {
      panel.appendChild(el('p', { cls: 'parsec-matrix__recover', text: 'Session open. Your wallets are unlocked.' }));
      const list = el('div', { cls: 'parsec-redsession' });
      state.accounts.forEach((acct, i) => {
        const chains = Object.keys(acct.chains ?? {}).map((c) => getChainDescriptor(c).label).join(' · ');
        list.appendChild(el('div', { cls: `parsec-redsession__row${i === state.activeAccountIndex ? ' parsec-redsession__row--active' : ''}`, children: [
          el('span', { cls: 'parsec-redsession__name', text: acct.name + (acct.watchOnly ? ' (watch-only)' : '') }),
          el('span', { cls: 'parsec-redsession__chains', text: chains || 'no chains yet' }),
        ]}));
      });
      panel.appendChild(list);
      panel.appendChild(btn('Enter Wallet', {
        intent: 'primary', large: true, cls: 'parsec-matrix__action parsec-matrix__action--red',
        onClick: () => { void partAndEnter(); },
      }));
      panel.appendChild(btn('Log Out Completely', {
        outlined: true, large: true, intent: 'danger', cls: 'parsec-matrix__action',
        onClick: () => { void doLogout(); },
      }));
      panel.appendChild(el('p', {
        cls: 'parsec-matrix__diag-note',
        text: 'Logging out locks the vault, closes every dApp and Arweave connection, and clears secrets, cached reads and session storage. Your wallets stay on this device.',
      }));
      backButton();
      return;
    }

    if (hasAccounts && hasKeys) {
      // The keystore knows about a wallet this session does not — say so, so
      // the passphrase field reads as "open my wallet" rather than a dead end.
      const recovering = state.accounts.length === 0 && vaultHasAccounts;
      if (recovering) {
        panel.appendChild(el('p', {
          cls: 'parsec-matrix__recover',
          text: 'Existing wallet found on this device. Enter your passphrase to open it.',
        }));
      }

      // Identity field — name or address. Optional: leaving it blank opens the
      // active account exactly as before.
      const idStatus = el('p', { cls: 'parsec-matrix__identity-status' });
      identityStatusEl = idStatus;
      const idInput = input({
        type: 'text',
        value: identityInput,
        placeholder: 'mindx.algo  ·  or address (optional)',
        cls: 'parsec-matrix__input parsec-matrix__input--identity',
        onInput: (v) => { identityInput = v; scheduleIdentityLookup(idStatus); },
        onEnter: () => doUnlock(),
      });
      panel.appendChild(idInput);
      panel.appendChild(idStatus);

      // Returning user — passphrase unlock
      const passField = passphraseField({ placeholder: 'Enter passphrase', current: true, inputCls: 'parsec-matrix__input', onInput: (v) => { passphrase = v; }, onEnter: () => doUnlock() });
      const passInput = passField.input;
      passField.el.classList.add('parsec-matrix__pass');
      panel.appendChild(passField.el);
      panel.appendChild(btn(recovering ? 'Open Wallet' : 'Unlock Wallet', { intent: 'primary', large: true, cls: 'parsec-matrix__action parsec-matrix__action--red', onClick: doUnlock }));
      setTimeout(() => passInput.focus(), 100);
      panel.appendChild(el('p', { cls: 'parsec-matrix__profile', children: [
        el('a', {
          text: 'Forgot the passphrase? Create a new vault',
          attrs: { href: '#' },
          onClick: (e) => { e.preventDefault(); passphrase = ''; profilePanel = 'forgot'; renderPanel(); },
        }),
      ]}));

      // Divider + create/import options
      panel.appendChild(el('div', { cls: 'parsec-matrix__divider', text: 'or' }));
    }

    // No wallet on this device. Be explicit that a passphrase alone cannot
    // conjure one: the passphrase decrypts keys, it does not derive them. The
    // recovery phrase is the only way to bring an existing wallet here.
    if (!hasAccounts) {
      panel.appendChild(el('p', {
        cls: 'parsec-matrix__nowallet',
        text: (store.profile === 'default' ? 'No wallet on this device. ' : `No wallet in profile “${store.profile}” yet. `)
            + 'A passphrase alone cannot restore one — '
            + 'it decrypts keys, it does not recreate them. Bring your wallet here '
            + 'with its 25-word recovery phrase.',
      }));
      panel.appendChild(btn('Restore Existing Wallet', {
        intent: 'primary', large: true, cls: 'parsec-matrix__action parsec-matrix__action--red',
        onClick: () => { cancelAnimation(); store.navigate('import-wallet'); },
      }));
      panel.appendChild(el('div', { cls: 'parsec-matrix__divider', text: 'or' }));
      panel.appendChild(btn('Create New Wallet', { outlined: true, large: true, cls: 'parsec-matrix__action', onClick: () => { cancelAnimation(); store.navigate('create-select'); } }));
    } else {
      panel.appendChild(btn('Create New Wallet', { outlined: true, large: true, cls: 'parsec-matrix__action', onClick: () => { cancelAnimation(); store.navigate('create-select'); } }));
      panel.appendChild(btn('Restore Another Wallet', { outlined: true, cls: 'parsec-matrix__action', onClick: () => { cancelAnimation(); store.navigate('import-wallet'); } }));
    }

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
    if (!passphrase) { toast('Enter your passphrase', 'danger'); return; }
    store.set({ isLoading: true });

    let switchedTo: string | null = null;
    // A typed identity decides which vault the passphrase is for. Checked here
    // too, in case Enter came before the lookup above finished.
    if (identityInput.trim()) {
      const network = store.get().settings.network;
      const [{ resolveIdentity }, { listProfiles, profileFor }] = await Promise.all([import('../lib/nfd/login'), import('../lib/profiles')]);
      const resolved = await resolveIdentity(network, identityInput.trim()).catch(() => null);
      if (resolved) {
        const pick = profileFor(await listProfiles(), resolved.addresses);
        if (pick.ambiguous.length > 0) {
          store.set({ isLoading: false });
          toast(`That key is in several vaults (${pick.ambiguous.join(', ')}). Choose one above, then unlock.`, 'warning', 8000);
          return;
        }
        if (pick.name && pick.name !== store.profile) {
          await store.useProfile(pick.name);
          vaultHasAccounts = false;
          switchedTo = pick.name;
        }
      }
    }

    const ok = await keystoreUnlock(passphrase);
    store.set({ isLoading: false });
    if (ok) {
      store.setPassphrase(passphrase);
      await adoptVaultAccounts();

      // A resolved identity selects which recovered account to open. Done
      // after recovery so a name can point at an account we just rebuilt.
      if (identityInput.trim()) {
        const network = store.get().settings.network;
        const { resolveIdentity, matchAccount } = await import('../lib/nfd/login');
        const resolved = await resolveIdentity(network, identityInput.trim()).catch(() => null);
        const idx = resolved ? matchAccount(store.get().accounts, resolved.addresses) : -1;
        if (idx !== -1) {
          store.set({ activeAccountIndex: idx, accountInfo: null, transactions: [] });
          if (resolved?.name) toast(`Opened as ${resolved.name}`, 'success');
        } else if (resolved) {
          toast(`No key on this device for ${resolved.name ?? identityInput.trim()}`, 'warning');
        }
      }
      identityInput = '';
      // Overwrite the local copy with null bytes before clearing the
      // reference — the GC will eventually free the original string but
      // we want the bytes in memory to be zeroed in the meantime.
      passphrase = '\0'.repeat(passphrase.length);
      passphrase = '';
      await partAndEnter();
    } else {
      toast(switchedTo ? `Wrong passphrase for vault “${switchedTo}”, which holds that key` : 'Wrong passphrase', 'danger');
      passphrase = '\0'.repeat(passphrase.length);
      passphrase = '';
      if (switchedTo) renderPanel();  // show the profile that was actually tried
    }
  }

  async function doLogout(): Promise<void> {
    const report = await logout();
    const failed = report.steps.filter((x) => !x.ok);
    if (failed.length === 0) toast('Logged out. Nothing left in this session.', 'success');
    else toast(`Logged out, but ${failed.map((x) => x.step).join(', ')} reported a problem.`, 'warning', 8000);
    // store.lock() routes to the matrix; if we are already on it, re-render.
    choice = 'red';
    renderPanel();
  }

  // Animate the matrix screen apart, then hand off to the dashboard.
  // The CSS animation runs 700ms; we keep WebGL rendering during the
  // animation (so the rain visibly parts) and only cancel once we
  // navigate so we never leave the canvas in an inconsistent state.
  async function partAndEnter(): Promise<void> {
    container.classList.add('parsec-matrix--parting');
    await new Promise<void>((resolve) => setTimeout(resolve, 700));
    cancelAnimation();
    store.navigate('dashboard');
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
