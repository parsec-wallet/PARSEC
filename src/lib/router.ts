// Parsec Wallet — View Router
// Only re-renders when the view actually changes.

import type { AppView } from '../types/wallet';
import { store } from './store';

type ViewFactory = () => HTMLElement;

const views = new Map<AppView, ViewFactory>();
let container: HTMLElement;
let currentView: AppView | null = null;

export function registerView(name: AppView, factory: ViewFactory): void {
  views.set(name, factory);
}

export function mountRouter(el: HTMLElement): void {
  container = el;
  store.subscribe((state) => {
    if (state.view !== currentView) {
      render(state.view);
    }
  });
  render(store.get().view);
}

function render(view: AppView): void {
  currentView = view;
  const factory = views.get(view);
  if (!factory) {
    container.innerHTML = `<div class="parsec-error">Unknown view: ${view}</div>`;
    return;
  }
  container.innerHTML = '';
  container.appendChild(factory());
}
