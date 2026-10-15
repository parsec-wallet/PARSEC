// The offer sheet: one price, Buy or ✕. The suite runs in vitest's node environment (no DOM
// library is installed, and none is added for this), so a small fake document stands in —
// just the surface dom.ts and offer.ts touch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type Listener = (e: FakeEvent) => void;

interface FakeEvent {
  type: string;
  key?: string;
  shiftKey?: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
}

function event(type: string, init: { key?: string; shiftKey?: boolean } = {}): FakeEvent {
  return { type, ...init, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

class Target {
  listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  dispatch(e: FakeEvent): void {
    for (const fn of this.listeners.get(e.type) ?? []) fn(e);
  }
  count(type: string): number { return (this.listeners.get(type) ?? []).length; }
}

let doc: FakeDocument;

class FakeElement extends Target {
  tagName: string;
  className = '';
  hidden = false;
  disabled = false;
  parent: FakeElement | null = null;
  kids: (FakeElement | FakeText)[] = [];
  attrs = new Map<string, string>();
  private ownText = '';
  constructor(tag: string) { super(); this.tagName = tag.toUpperCase(); }
  get textContent(): string { return this.ownText + this.kids.map((k) => k.textContent).join(''); }
  set textContent(v: string) { this.kids = []; this.ownText = v; }
  setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null; }
  appendChild<T extends FakeElement | FakeText>(c: T): T {
    if (c instanceof FakeElement) { c.parent?.removeChild(c); c.parent = this; }
    this.kids.push(c);
    return c;
  }
  append(...cs: (FakeElement | FakeText)[]): void { for (const c of cs) this.appendChild(c); }
  replaceChildren(...cs: (FakeElement | FakeText)[]): void { this.kids = []; this.ownText = ''; this.append(...cs); }
  removeChild(c: FakeElement): void { this.kids = this.kids.filter((k) => k !== c); c.parent = null; }
  remove(): void { this.parent?.removeChild(this); }
  get isConnected(): boolean {
    let n: FakeElement | null = this;
    while (n) { if (n === doc.body) return true; n = n.parent; }
    return false;
  }
  focus(): void { doc.activeElement = this; }
  click(): void { if (!this.disabled) this.dispatch(event('click')); }
  /** Every descendant element, depth first. */
  all(): FakeElement[] {
    return this.kids.flatMap((k) => (k instanceof FakeElement ? [k, ...k.all()] : []));
  }
  find(cls: string): FakeElement | undefined {
    return this.all().find((e) => e.className.split(' ').includes(cls));
  }
}

class FakeText {
  constructor(public textContent: string) {}
}

class FakeDocument extends Target {
  body = new FakeElement('body');
  activeElement: FakeElement | null = null;
  createElement(tag: string): FakeElement { return new FakeElement(tag); }
  createTextNode(t: string): FakeText { return new FakeText(t); }
}

class FakeStorage {
  m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
}

const HANDOFF_KEYS = ['parsec:upload-return', 'parsec:upload-target', 'parsec:upload-undername'];
let storage: FakeStorage;

beforeEach(() => {
  doc = new FakeDocument();
  storage = new FakeStorage();
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLElement', FakeElement);
  vi.stubGlobal('sessionStorage', storage);
  for (const k of HANDOFF_KEYS) storage.setItem(k, 'x');
});
afterEach(() => { vi.unstubAllGlobals(); });

async function open(over: Partial<import('../offer').OfferOptions> = {}) {
  const { openOffer } = await import('../offer');
  const onLeave = vi.fn();
  const handle = openOffer({
    kicker: 'Price',
    price: '12.5 ARIO',
    detail: '10 more extension slots for bankon · 10 → 20',
    fine: '1.25 ARIO a slot, live from ar.io',
    onBuy: async () => {},
    onLeave,
    ...over,
  });
  const root = doc.body.find('parsec-offer')!;
  const sheet = root.find('parsec-offer__sheet')!;
  return {
    handle, onLeave, root, sheet,
    close: sheet.find('parsec-offer__close')!,
    buy: sheet.find('parsec-offer__buy')!,
    error: sheet.find('parsec-offer__error')!,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('offer sheet', () => {
  it('renders the price, the detail, the fine print and a ✕ that says what it does', async () => {
    const { sheet, close, buy } = await open();
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.find('parsec-offer__kicker')!.textContent).toBe('Price');
    expect(sheet.find('parsec-offer__price')!.textContent).toBe('12.5 ARIO');
    expect(sheet.find('parsec-offer__detail')!.textContent).toContain('extension slots');
    expect(sheet.find('parsec-offer__fine')!.textContent).toContain('a slot, live from ar.io');
    expect(close.textContent).toBe('✕');
    expect(close.getAttribute('aria-label')).toBe('Close and leave nothing behind');
    expect(buy.textContent).toBe('Buy');
    expect(doc.activeElement).toBe(buy);
  });

  it('✕ removes the sheet, its listener, calls onLeave and forgets the hand-offs', async () => {
    const opener = doc.body.appendChild(new FakeElement('button'));
    opener.focus();
    const { close, onLeave } = await open();
    expect(doc.count('keydown')).toBe(1);
    close.click();
    expect(doc.body.find('parsec-offer')).toBeUndefined();
    expect(doc.count('keydown')).toBe(0);
    expect(onLeave).toHaveBeenCalledOnce();
    for (const k of HANDOFF_KEYS) expect(storage.getItem(k)).toBeNull();
    expect(doc.activeElement).toBe(opener);
  });

  it('Escape leaves the same way', async () => {
    const { onLeave } = await open();
    const e = event('keydown', { key: 'Escape' });
    doc.dispatch(e);
    expect(e.defaultPrevented).toBe(true);
    expect(doc.body.find('parsec-offer')).toBeUndefined();
    expect(doc.count('keydown')).toBe(0);
    expect(onLeave).toHaveBeenCalledOnce();
    for (const k of HANDOFF_KEYS) expect(storage.getItem(k)).toBeNull();
  });

  it('Buy runs the purchase, disables itself meanwhile, then closes without wiping', async () => {
    let finish: () => void = () => {};
    const onBuy = vi.fn(() => new Promise<void>((r) => { finish = r; }));
    const { buy, close, onLeave } = await open({ onBuy });
    buy.click();
    expect(onBuy).toHaveBeenCalledOnce();
    expect(buy.disabled).toBe(true);
    // ✕ and Escape wait while a purchase is being signed.
    close.click();
    doc.dispatch(event('keydown', { key: 'Escape' }));
    expect(doc.body.find('parsec-offer')).toBeDefined();
    finish();
    await flush();
    expect(doc.body.find('parsec-offer')).toBeUndefined();
    expect(doc.count('keydown')).toBe(0);
    expect(onLeave).not.toHaveBeenCalled();
    for (const k of HANDOFF_KEYS) expect(storage.getItem(k)).toBe('x');
  });

  it('a failed Buy stays open and shows the error inline', async () => {
    const { buy, error, onLeave } = await open({ onBuy: async () => { throw new Error('The owner\'s ARIO does not cover that many slots'); } });
    expect(error.hidden).toBe(true);
    buy.click();
    await flush();
    expect(doc.body.find('parsec-offer')).toBeDefined();
    expect(error.hidden).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('does not cover');
    expect(buy.disabled).toBe(false);
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('close() from the handle is the same clean exit', async () => {
    const { handle, onLeave } = await open();
    handle.close();
    handle.close();
    expect(doc.body.find('parsec-offer')).toBeUndefined();
    expect(onLeave).toHaveBeenCalledOnce();
  });
});
