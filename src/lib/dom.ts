// PARSEC Wallet — DOM Helpers
// Minimal utilities for building UI without a framework.

// Resolved by the bundler, so the mark is hashed and cached like any other asset.
import brandMarkUrl from '../assets/brand/parsec-mark.svg';

/** Create an element with optional class, attrs, children */
export function el(
  tag: string,
  opts?: {
    cls?: string;
    attrs?: Record<string, string>;
    text?: string;
    html?: string;
    children?: (HTMLElement | string)[];
    onClick?: (e: Event) => void;
  }
): HTMLElement {
  const elem = document.createElement(tag);

  if (opts?.cls) elem.className = opts.cls;
  if (opts?.text) elem.textContent = opts.text;
  if (opts?.html) elem.innerHTML = opts.html;
  if (opts?.onClick) elem.addEventListener('click', opts.onClick);

  if (opts?.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      elem.setAttribute(k, v);
    }
  }

  if (opts?.children) {
    for (const child of opts.children) {
      if (typeof child === 'string') {
        elem.appendChild(document.createTextNode(child));
      } else {
        elem.appendChild(child);
      }
    }
  }

  return elem;
}

/** Create a text input */
export function input(opts: {
  type?: string;
  placeholder?: string;
  cls?: string;
  value?: string;
  onInput?: (value: string) => void;
  onEnter?: (value: string) => void;
}): HTMLInputElement {
  const inp = document.createElement('input');
  inp.type = opts.type || 'text';
  if (opts.placeholder) inp.placeholder = opts.placeholder;
  if (opts.cls) inp.className = opts.cls;
  if (opts.value) inp.value = opts.value;
  if (opts.onInput) inp.addEventListener('input', () => opts.onInput!(inp.value));
  if (opts.onEnter) {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') opts.onEnter!(inp.value);
    });
  }
  return inp;
}

/** Create a button with Blueprint CSS classes */
export function btn(
  label: string,
  opts?: {
    intent?: 'primary' | 'success' | 'warning' | 'danger' | 'none';
    large?: boolean;
    minimal?: boolean;
    outlined?: boolean;
    icon?: string;
    cls?: string;
    disabled?: boolean;
    onClick?: (e: Event) => void;
  }
): HTMLButtonElement {
  const b = document.createElement('button');
  const classes = ['bp5-button'];

  if (opts?.intent && opts.intent !== 'none') classes.push(`bp5-intent-${opts.intent}`);
  if (opts?.large) classes.push('bp5-large');
  if (opts?.minimal) classes.push('bp5-minimal');
  if (opts?.outlined) classes.push('bp5-outlined');
  if (opts?.cls) classes.push(opts.cls);

  // "Back" buttons render as a stylish circular chevron (see _buttons.scss):
  // the label text + Blueprint icon are hidden, a pure-CSS arrow drawn instead.
  const isBack = label === 'Back' || label.startsWith('Back ');
  if (isBack) classes.push('parsec-back-btn');

  b.className = classes.join(' ');
  if (opts?.disabled) b.disabled = true;
  if (isBack) b.setAttribute('aria-label', label); // text is visually hidden

  if (opts?.icon) {
    const iconSpan = document.createElement('span');
    iconSpan.className = `bp5-icon bp5-icon-${opts.icon}`;
    b.appendChild(iconSpan);
  }

  const textSpan = document.createElement('span');
  textSpan.className = 'bp5-button-text';
  textSpan.textContent = label;
  b.appendChild(textSpan);

  if (opts?.onClick) b.addEventListener('click', opts.onClick);

  return b;
}

/**
 * Show a toast notification.
 *
 * Errors and warnings stay up much longer than a success ping, hovering
 * pauses dismissal so a long message can be read, and clicking copies the
 * full text to the clipboard. `durationMs` overrides the per-intent default.
 */
export function toast(
  message: string,
  intent: 'success' | 'danger' | 'warning' | 'primary' = 'primary',
  durationMs?: number,
): void {
  const existing = document.querySelector('.parsec-toast-container');
  const container = existing || document.createElement('div');
  if (!existing) {
    container.className = 'parsec-toast-container';
    document.body.appendChild(container);
  }

  const t = el('div', {
    cls: `parsec-toast parsec-toast--clickable bp5-intent-${intent}`,
    text: message,
    attrs: { title: 'Click to copy this message' },
  });

  const life = durationMs ?? (
    intent === 'danger' ? 60000
      : intent === 'warning' ? 12000
        : 3500
  );

  let timer: ReturnType<typeof setTimeout> | null = null;
  const dismiss = (): void => {
    if (timer) { clearTimeout(timer); timer = null; }
    t.classList.add('parsec-toast--leaving');
    setTimeout(() => t.remove(), 300);
  };
  const schedule = (ms: number): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(dismiss, ms);
  };

  // Hovering pauses dismissal so a long error can be read in full.
  t.addEventListener('mouseenter', () => { if (timer) { clearTimeout(timer); timer = null; } });
  t.addEventListener('mouseleave', () => schedule(5000));
  // Clicking copies the full message to the clipboard, then dismisses.
  t.addEventListener('click', () => {
    void navigator.clipboard.writeText(message).catch(() => { /* clipboard unavailable */ });
    dismiss();
  });

  container.appendChild(t);
  schedule(life);
}


/**
 * The PARSEC mark, as a clickable element.
 *
 * An `<img>` of the SVG rather than inlined markup: the CSP forbids `unsafe-inline`, and
 * a vector asset served by the bundler costs nothing to cache. `small` is the header
 * size; the full size is for splash and onboarding.
 */
export function brandLogo(opts: { small?: boolean; alt?: string } = {}): HTMLElement {
  const img = document.createElement('img');
  img.src = brandMarkUrl;
  img.alt = opts.alt ?? 'PARSEC';
  img.className = opts.small ? 'parsec-brand parsec-brand--small' : 'parsec-brand';
  img.width = opts.small ? 24 : 96;
  img.draggable = false;
  return img;
}
