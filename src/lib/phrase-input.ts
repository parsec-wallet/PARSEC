// PARSEC Wallet — recovery phrases as people actually type them.
//
// A phone keyboard capitalises the first word, may autocorrect, and leaves double or
// trailing spaces; recovery-phrase checks are exact. A word phrase is normalised to the
// form every wordlist uses (lower case, single spaces). Anything that is not plainly a
// list of words — a base64 or base58 key, a JSON byte array — is left exactly as typed,
// because those are case-sensitive.
//
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: Apache-2.0

/** 12–25 words of letters only: the shape of every BIP-39 and Algorand phrase. */
export function looksLikePhrase(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.length >= 12 && words.length <= 25 && words.every((w) => /^[a-zA-Z]+$/.test(w));
}

/** Lower case and single spaces, for a word phrase; anything else unchanged. */
export function normalizePhrase(text: string): string {
  return looksLikePhrase(text) ? text.trim().toLowerCase().split(/\s+/).join(' ') : text;
}

/** Turn off what a phone keyboard does to text that must be exact. */
export function exactTextField(field: HTMLInputElement | HTMLTextAreaElement): void {
  field.spellcheck = false;
  field.autocomplete = 'off';
  field.setAttribute('autocapitalize', 'none');
  field.setAttribute('autocorrect', 'off');
}
