// Parsec Wallet — DOM Helpers
// Minimal utilities for building UI without a framework.

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

  b.className = classes.join(' ');
  if (opts?.disabled) b.disabled = true;

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

/** Show a toast notification */
export function toast(message: string, intent: 'success' | 'danger' | 'warning' | 'primary' = 'primary'): void {
  const existing = document.querySelector('.parsec-toast-container');
  const container = existing || document.createElement('div');
  if (!existing) {
    container.className = 'parsec-toast-container';
    document.body.appendChild(container);
  }

  const t = el('div', {
    cls: `parsec-toast bp5-intent-${intent}`,
    text: message,
  });

  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('parsec-toast--leaving');
    setTimeout(() => t.remove(), 300);
  }, 3000);
}
