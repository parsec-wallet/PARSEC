import { describe, it, expect } from 'vitest';
import { looksLikePhrase, normalizePhrase } from '../phrase-input';

const words25 = Array.from({ length: 25 }, (_, i) => ['abandon', 'ability', 'able', 'about', 'above'][i % 5]).join(' ');

describe('recovery phrases as typed on a phone', () => {
  it('lower-cases and single-spaces a word phrase', () => {
    const typed = '  Abandon  ' + words25.split(' ').slice(1).join('   ') + ' ';
    expect(normalizePhrase(typed)).toBe(words25);
  });

  it('leaves keys exactly as typed', () => {
    const b64 = 'aGVsbG8gV29ybGQ+/AbCdEf=='; // base64: case matters
    const b58 = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3';
    const json = '[12, 34, 56]';
    for (const k of [b64, b58, json]) expect(normalizePhrase(k)).toBe(k);
  });

  it('knows a phrase from a sentence-length non-phrase', () => {
    expect(looksLikePhrase(words25)).toBe(true);
    expect(looksLikePhrase('only three words')).toBe(false);
    expect(looksLikePhrase(words25.replace('able', 'ab1e'))).toBe(false);
  });
});
