import { describe, it, expect } from 'vitest';
import { NAME_OPS, describeOrigin, originLabel, renderIntent, type NameIntent } from '../intent';

const TX = 'T9_V2HfiAq5qlLzObfyayj2-cjPujxpg25TRi4OZbe4';
const SOL = 'Dhma3UDUUJGZDKeGAXKi3MjjSQgnQiUbmB47sufymvMg';

const intent = (op: string, params: Record<string, unknown> = {}): NameIntent => ({
  requestId: 1, origin: 'https://bankon.pythai.net', namespace: 'solana-arns', name: 'deltaverse', op, params,
});

describe('name intents', () => {
  it('renders a root repoint with its real consequence', () => {
    const r = renderIntent(intent('set-root', { transactionId: TX, ttlSeconds: 900 }), 'solana');
    expect(r.error).toBeUndefined();
    expect(r.headline).toBe('Point deltaverse at new content');
    expect(r.effect).toContain('within 900 seconds');
    expect(r.detail.find((d) => d.label === 'New target')?.value).toBe(TX);
    expect(r.risk).toBe('routine');
  });

  it('clamps an out-of-range TTL instead of trusting the caller', () => {
    const r = renderIntent(intent('set-root', { transactionId: TX, ttlSeconds: 5 }), 'solana');
    expect(r.effect).toContain('60 seconds');
    const hi = renderIntent(intent('set-root', { transactionId: TX, ttlSeconds: 1e9 }), 'solana');
    expect(hi.effect).toContain('86400 seconds');
  });

  it('refuses a malformed target rather than asking the user to approve it', () => {
    const r = renderIntent(intent('set-root', { transactionId: 'nope' }), 'solana');
    expect(r.error).toContain('43-character');
    expect(r.detail).toHaveLength(0);
  });

  it('names the undername exactly as it will be served', () => {
    const r = renderIntent(intent('set-undername', { undername: 'Docs', transactionId: TX }), 'solana');
    expect(r.headline).toBe('Serve docs_deltaverse from new content');
    expect(r.effect).toContain('docs_deltaverse.ar.io');
    expect(r.detail[0]).toEqual({ label: 'Undername', value: 'docs_deltaverse', mono: true });
  });

  it('rejects "@" as an undername', () => {
    expect(renderIntent(intent('set-undername', { undername: '@', transactionId: TX }), 'solana').error).toBeTruthy();
  });

  it('flags handing a key ongoing write access as elevated, and says what it cannot do', () => {
    const r = renderIntent(intent('add-controller', { controller: SOL }), 'solana');
    expect(r.risk).toBe('elevated');
    expect(r.effect).toContain('cannot transfer the name away');
    expect(r.detail.find((d) => d.label === 'New controller')?.value).toBe(SOL);
  });

  it('validates controller addresses against the namespace chain', () => {
    expect(renderIntent(intent('add-controller', { controller: SOL }), 'solana').error).toBeUndefined();
    expect(renderIntent(intent('add-controller', { controller: SOL }), 'arweave-hd').error).toBeTruthy();
    expect(renderIntent(intent('add-controller', { controller: TX }), 'arweave-hd').error).toBeUndefined();
  });

  it('counts identity changes so the signature count is not a surprise', () => {
    const r = renderIntent(intent('set-identity', { ticker: 'DV', logo: TX }), 'solana');
    expect(r.headline).toBe("Update deltaverse's ticker, logo");
    expect(r.effect).toContain('2 separate transactions');
    expect(renderIntent(intent('set-identity', {}), 'solana').error).toBe('No identity fields were given.');
    expect(renderIntent(intent('set-identity', { logo: 'short' }), 'solana').error).toContain('logo');
  });

  it('refuses an op outside the allowlist', () => {
    const r = renderIntent(intent('transfer-ownership', { to: SOL }), 'solana');
    expect(r.error).toContain('does not support');
    expect(NAME_OPS).not.toContain('transfer-ownership' as never);
  });

  it('labels known PYTHAI origins and marks anything else unknown', () => {
    expect(describeOrigin('https://bankon.pythai.net')).toEqual({ host: 'bankon.pythai.net', label: 'BANKON', known: true });
    expect(describeOrigin('https://mindx.pythai.net').label).toBe('mindX');
    expect(describeOrigin('http://localhost:5173').known).toBe(true);
    expect(describeOrigin('https://evil.example').known).toBe(false);
    expect(originLabel('not a url')).toBe('not a url');
  });
});
