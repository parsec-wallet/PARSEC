import { describe, it, expect } from 'vitest';
import { sanitizeAgent, parseDirectory, cleanText } from '../agenticplace/directory';

const GOOD = {
  agent_id: '10:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:0', token_id: 0, chain_id: 10,
  owner_address: '0x1be93c700ddc596d701e8f2106b8f9166c625adb', name: 'Arca', description: 'An agent.',
  image_url: 'https://tracker.example/pixel.png', is_verified: false, star_count: 3, x402_supported: true,
  total_score: 30, supported_protocols: ['A2A', 'Web'], created_at: '2026-02-09 20:11:06',
};

describe('AgenticPlace directory records are untrusted', () => {
  it('keeps a good record and drops the image URL', () => {
    const a = sanitizeAgent(GOOD)!;
    expect(a).toMatchObject({ id: GOOD.agent_id, chainId: 10, name: 'Arca', x402: true, stars: 3, createdAt: '2026-02-09' });
    expect(JSON.stringify(a)).not.toContain('tracker.example');
  });

  it('strips bidi overrides and control characters so a name cannot impersonate', () => {
    expect(cleanText('Pay‮LAPYAP‬ me\u0000​', 80)).toBe('PayLAPYAP me');
  });

  it('keeps markup as plain text, capped', () => {
    const a = sanitizeAgent({ ...GOOD, name: '<img src=x onerror=alert(1)>'.repeat(10) })!;
    expect([...a.name].length).toBeLessThanOrEqual(80);
    expect(a.name.startsWith('<img')).toBe(true); // shown as text by textContent, never parsed
  });

  it('rejects malformed ids, chains and addresses', () => {
    expect(sanitizeAgent({ ...GOOD, agent_id: 'javascript:alert(1)' })).toBeNull();
    expect(sanitizeAgent({ ...GOOD, chain_id: -5 })).toBeNull();
    expect(sanitizeAgent({ ...GOOD, owner_address: '0xnot-an-address' })!.owner).toBe('');
    expect(sanitizeAgent('string')).toBeNull();
  });

  it('clamps numbers and lists', () => {
    const a = sanitizeAgent({ ...GOOD, star_count: 1e12, supported_protocols: Array(30).fill('x'.repeat(100)) })!;
    expect(a.stars).toBe(0);
    expect(a.protocols).toHaveLength(8);
    expect([...a.protocols[0]].length).toBeLessThanOrEqual(24);
  });

  it('parses a page and refuses a body that is not a list', () => {
    const p = parseDirectory(JSON.stringify({ success: true, data: [GOOD, { bad: 1 }], meta: { page: 1, pages: 2, total: 40, hasMore: true } }));
    expect(p.agents).toHaveLength(1);
    expect(p).toMatchObject({ page: 1, total: 40, hasMore: true });
    expect(() => parseDirectory('{"success":true,"data":"<script>"}')).toThrow();
  });
});
