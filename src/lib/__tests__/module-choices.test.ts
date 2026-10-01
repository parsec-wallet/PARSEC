import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHOICES,
  PRIVILEGE_RANK,
  PrivilegeError,
  assertPrivilege,
  describeChoices,
  hasPrivilege,
} from '../module-choices';

describe('module choices — the privilege ladder', () => {
  it('ranks observe < sign < vault < system', () => {
    expect(PRIVILEGE_RANK.observe).toBeLessThan(PRIVILEGE_RANK.sign);
    expect(PRIVILEGE_RANK.sign).toBeLessThan(PRIVILEGE_RANK.vault);
    expect(PRIVILEGE_RANK.vault).toBeLessThan(PRIVILEGE_RANK.system);
  });

  it('defaults are the cautious side: observe-only, assumed external', () => {
    expect(DEFAULT_CHOICES.privilege).toBe('observe');
    expect(DEFAULT_CHOICES.reach).toBe('external');
    expect(DEFAULT_CHOICES.persistence).toBe('none');
  });

  it('a module may act at or below its declaration, never above', () => {
    const signer = { ...DEFAULT_CHOICES, privilege: 'sign' as const };
    expect(hasPrivilege(signer, 'observe')).toBe(true);
    expect(hasPrivilege(signer, 'sign')).toBe(true);
    expect(hasPrivilege(signer, 'vault')).toBe(false);
    expect(() => assertPrivilege('x', signer, 'sign')).not.toThrow();
    expect(() => assertPrivilege('x', signer, 'system')).toThrow(PrivilegeError);
  });

  it('the error names the module, what it declared and what it tried', () => {
    try {
      assertPrivilege('lightspeed', DEFAULT_CHOICES, 'sign');
      expect.unreachable();
    } catch (e) {
      const err = e as PrivilegeError;
      expect(err.moduleId).toBe('lightspeed');
      expect(err.declared).toBe('observe');
      expect(err.needed).toBe('sign');
      expect(err.message).toContain('"observe"');
      expect(err.message).toContain('"sign"');
    }
  });

  it('describes all four choices in plain words', () => {
    const lines = describeChoices({ privilege: 'observe', reach: 'internal', persistence: 'device', provider: 'local' });
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('never sees a key');
    expect(lines[1]).toContain('this device');
    expect(lines[2]).toContain('preference');
    expect(lines[3]).toContain('local default');
  });
});
