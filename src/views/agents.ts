// Parsec Wallet — Agent Discovery View
// Browse 70,000+ agents from AgenticPlace discovery API across 15+ EVM chains.

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { AgenticPlaceClient } from '../lib/x402/agenticplace-client';
import type { AgentSearchResult } from '../lib/x402/agenticplace-client';

const client = new AgenticPlaceClient();
let searchResults: AgentSearchResult[] = [];
let totalCount = 0;
let isSearching = false;

export function agentsView(): HTMLElement {
  const container = el('div', {
    cls: 'parsec-view parsec-agents',
    children: [
      // Header
      el('div', {
        cls: 'parsec-view__header',
        children: [
          btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
          el('h2', { cls: 'parsec-view__title', text: 'Agent Discovery' }),
        ],
      }),

      // Stats bar
      el('div', {
        cls: 'parsec-agents__stats',
        attrs: { id: 'agents-stats' },
        text: 'Loading agent count...',
      }),

      // Search
      el('div', {
        cls: 'parsec-agents__search',
        children: [
          input({
            placeholder: 'Search agents by name or description...',
            cls: 'parsec-agents__input',
            onEnter: (query) => doSearch(query, container),
          }),
          btn('Search', {
            intent: 'primary',
            onClick: () => {
              const inp = container.querySelector<HTMLInputElement>('.parsec-agents__input');
              if (inp?.value) doSearch(inp.value, container);
            },
          }),
        ],
      }),

      // Results container
      el('div', {
        cls: 'parsec-agents__results',
        attrs: { id: 'agents-results' },
      }),
    ],
  });

  // Fetch agent count on mount
  loadStats();

  return container;
}

async function loadStats(): Promise<void> {
  try {
    const data = await client.getAgentCount();
    totalCount = data.total;
    const statsEl = document.getElementById('agents-stats');
    if (statsEl) {
      const chainCount = Object.keys(data.chains).length;
      statsEl.textContent = `${totalCount.toLocaleString()} agents indexed across ${chainCount} chains`;
    }
  } catch {
    const statsEl = document.getElementById('agents-stats');
    if (statsEl) statsEl.textContent = 'AgenticPlace offline — cached data only';
  }
}

async function doSearch(query: string, container: HTMLElement): Promise<void> {
  if (isSearching || !query.trim()) return;
  isSearching = true;

  const resultsEl = container.querySelector('#agents-results');
  if (!resultsEl) return;
  resultsEl.innerHTML = '';
  resultsEl.appendChild(el('div', { cls: 'parsec-agents__loading', text: 'Searching...' }));

  try {
    searchResults = await client.searchAgents(query, 30);
    resultsEl.innerHTML = '';

    if (searchResults.length === 0) {
      resultsEl.appendChild(el('div', { cls: 'parsec-agents__empty', text: 'No agents found.' }));
    } else {
      resultsEl.appendChild(
        el('div', { cls: 'parsec-agents__count', text: `${searchResults.length} results` }),
      );
      for (const agent of searchResults) {
        resultsEl.appendChild(renderAgentCard(agent));
      }
    }
  } catch (err) {
    resultsEl.innerHTML = '';
    toast('Search failed. Check connection.', 'danger');
    resultsEl.appendChild(
      el('div', { cls: 'parsec-agents__error', text: 'Failed to search. Is AgenticPlace online?' }),
    );
  } finally {
    isSearching = false;
  }
}

function renderAgentCard(agent: AgentSearchResult): HTMLElement {
  const truncOwner = `${agent.owner.slice(0, 6)}...${agent.owner.slice(-4)}`;

  return el('div', {
    cls: 'parsec-agents__card',
    children: [
      el('div', {
        cls: 'parsec-agents__card-header',
        children: [
          el('strong', { text: agent.name || `Agent #${agent.agentId}` }),
          el('span', {
            cls: 'parsec-agents__chain-pill',
            text: agent.chainName || `Chain ${agent.chainId}`,
          }),
        ],
      }),
      agent.description
        ? el('p', { cls: 'parsec-agents__card-desc', text: agent.description.slice(0, 200) })
        : el('p', { cls: 'parsec-agents__card-desc parsec-agents__no-desc', text: 'No description' }),
      el('div', {
        cls: 'parsec-agents__card-footer',
        children: [
          el('span', { cls: 'parsec-agents__card-id', text: `#${agent.agentId}` }),
          el('span', { cls: 'parsec-agents__card-owner', text: truncOwner }),
        ],
      }),
    ],
  });
}
