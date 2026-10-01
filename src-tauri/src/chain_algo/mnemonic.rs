// chain_algo::mnemonic — Algorand's 25-word account mnemonic.
//
// NOT BIP-39. It borrows BIP-39's English wordlist and nothing else:
//
//   * 25 words, not 12/24. Twenty-four encode a 32-byte seed; the twenty-fifth
//     is a checksum.
//   * The seed is packed into 11-bit groups LSB-first, where BIP-39 packs
//     MSB-first. Getting this backwards produces a valid-looking mnemonic that
//     decodes to the wrong account.
//   * The checksum is the first 11-bit group of SHA-512/256(seed), not a suffix
//     of a SHA-256 over entropy.
//   * There is no passphrase and no PBKDF2 stretching step. The mnemonic IS the
//     seed, reversibly.
//
// `CLAUDE.md` non-negotiable 4: Algorand is first-class and must never be
// collapsed into BIP-39 assumptions. This module is where that is enforced.

use bip39::Language;
use sha2::{Digest, Sha512_256};

pub const SEED_LEN: usize = 32;
pub const WORD_COUNT: usize = 25;
const DATA_WORDS: usize = 24;

fn wordlist() -> &'static [&'static str; 2048] {
    Language::English.word_list()
}

/// Pack bytes into 11-bit groups, least-significant bits first.
fn to_u11(bytes: &[u8]) -> Vec<u16> {
    let mut out = Vec::new();
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for &b in bytes {
        acc |= (b as u32) << bits;
        bits += 8;
        while bits >= 11 {
            out.push((acc & 0x7ff) as u16);
            acc >>= 11;
            bits -= 11;
        }
    }
    if bits > 0 {
        out.push((acc & 0x7ff) as u16);
    }
    out
}

/// Inverse of [`to_u11`].
fn from_u11(groups: &[u16]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for &g in groups {
        acc |= (g as u32) << bits;
        bits += 11;
        while bits >= 8 {
            out.push((acc & 0xff) as u8);
            acc >>= 8;
            bits -= 8;
        }
    }
    out
}

/// The checksum word index for a seed: the first 11-bit group of the first two
/// bytes of SHA-512/256(seed).
fn checksum_index(seed: &[u8]) -> u16 {
    let digest = Sha512_256::digest(seed);
    to_u11(&digest[..2])[0]
}

/// Encode a 32-byte seed as a 25-word mnemonic.
pub fn from_seed(seed: &[u8]) -> Result<String, String> {
    if seed.len() != SEED_LEN {
        return Err(format!("Algorand seed must be {SEED_LEN} bytes, got {}", seed.len()));
    }
    let words = wordlist();
    let mut groups = to_u11(seed);
    groups.truncate(DATA_WORDS);
    if groups.len() != DATA_WORDS {
        return Err("seed did not pack to 24 groups".to_string());
    }

    let mut phrase: Vec<&str> = groups.iter().map(|&g| words[g as usize]).collect();
    phrase.push(words[checksum_index(seed) as usize]);
    Ok(phrase.join(" "))
}

/// Decode a 25-word mnemonic back to its 32-byte seed, verifying the checksum.
pub fn to_seed(phrase: &str) -> Result<[u8; SEED_LEN], String> {
    let words = wordlist();
    let given: Vec<&str> = phrase.split_whitespace().collect();
    if given.len() != WORD_COUNT {
        return Err(format!(
            "Algorand mnemonics are {WORD_COUNT} words, got {}. \
             A 12- or 24-word phrase is BIP-39 and belongs to a different chain.",
            given.len()
        ));
    }

    let mut groups = Vec::with_capacity(WORD_COUNT);
    for w in &given {
        let lower = w.to_lowercase();
        let idx = words
            .iter()
            .position(|c| *c == lower)
            .ok_or_else(|| format!("{w:?} is not in the word list"))?;
        groups.push(idx as u16);
    }

    let bytes = from_u11(&groups[..DATA_WORDS]);
    if bytes.len() < SEED_LEN {
        return Err("mnemonic did not decode to a full seed".to_string());
    }
    let mut seed = [0u8; SEED_LEN];
    seed.copy_from_slice(&bytes[..SEED_LEN]);

    // The 24 data words carry 264 bits but the seed is 256; the surplus 8 must be
    // zero. Without this a mnemonic can be mutated in its last word and still
    // decode to a valid-looking seed.
    if bytes.len() > SEED_LEN && bytes[SEED_LEN..].iter().any(|&b| b != 0) {
        return Err("mnemonic has non-zero padding bits — it is malformed".to_string());
    }

    if groups[DATA_WORDS] != checksum_index(&seed) {
        return Err("mnemonic checksum does not match — check for a mistyped word".to_string());
    }
    Ok(seed)
}

/// Whether a phrase is a well-formed 25-word Algorand mnemonic.
pub fn is_valid(phrase: &str) -> bool {
    to_seed(phrase).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Ground truth generated with algosdk (the JS library PARSEC is replacing
    // here), so these assert cross-implementation agreement rather than merely
    // self-consistency.
    const VECTORS: &[(&str, &str)] = &[
        (
            "0000000000000000000000000000000000000000000000000000000000000000",
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon \
             abandon abandon abandon abandon abandon abandon abandon abandon abandon \
             abandon abandon abandon abandon abandon abandon invest",
        ),
        (
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo \
             zoo zoo zoo zoo zoo abstract adapt",
        ),
        (
            "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
            "cactus amount account expect army achieve embark anxiety lift crouch \
             mandate abstract captain setup party bench tissue gate arrive random \
             deal mansion wedding abandon curtain",
        ),
    ];

    fn norm(s: &str) -> String {
        s.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn matches_algosdk_vectors() {
        for (seed_hex, expected) in VECTORS {
            let seed = hex::decode(seed_hex).unwrap();
            assert_eq!(from_seed(&seed).unwrap(), norm(expected), "seed {seed_hex}");
        }
    }

    #[test]
    fn decodes_algosdk_vectors_back_to_the_seed() {
        for (seed_hex, phrase) in VECTORS {
            let seed = hex::decode(seed_hex).unwrap();
            assert_eq!(to_seed(&norm(phrase)).unwrap().to_vec(), seed, "seed {seed_hex}");
        }
    }

    #[test]
    fn round_trips_random_seeds() {
        for i in 0..64u8 {
            let seed = [i.wrapping_mul(7).wrapping_add(3); SEED_LEN];
            let phrase = from_seed(&seed).unwrap();
            assert_eq!(phrase.split_whitespace().count(), WORD_COUNT);
            assert_eq!(to_seed(&phrase).unwrap(), seed);
        }
    }

    #[test]
    fn rejects_a_bad_checksum_word() {
        let seed = [1u8; SEED_LEN];
        let phrase = from_seed(&seed).unwrap();
        let mut words: Vec<&str> = phrase.split_whitespace().collect();
        words[24] = if words[24] == "zoo" { "abandon" } else { "zoo" };
        let err = to_seed(&words.join(" ")).unwrap_err();
        assert!(err.contains("checksum"), "got: {err}");
    }

    #[test]
    fn rejects_a_mistyped_data_word() {
        let seed = [2u8; SEED_LEN];
        let phrase = from_seed(&seed).unwrap();
        let mut words: Vec<&str> = phrase.split_whitespace().collect();
        words[5] = if words[5] == "zoo" { "abandon" } else { "zoo" };
        assert!(to_seed(&words.join(" ")).is_err());
    }

    /// CLAUDE.md non-negotiable 4: a BIP-39 phrase must not be silently accepted
    /// as an Algorand mnemonic.
    #[test]
    fn refuses_bip39_word_counts_with_a_useful_message() {
        let bip39 = "abandon ".repeat(23) + "art";
        let err = to_seed(bip39.trim()).unwrap_err();
        assert!(err.contains("25 words"), "got: {err}");
        assert!(err.contains("BIP-39"), "should name the confusion: {err}");
        assert!(!is_valid(bip39.trim()));
    }

    #[test]
    fn rejects_words_outside_the_list() {
        let seed = [3u8; SEED_LEN];
        let phrase = from_seed(&seed).unwrap();
        let mut words: Vec<&str> = phrase.split_whitespace().collect();
        words[0] = "notaword";
        assert!(to_seed(&words.join(" ")).unwrap_err().contains("not in the word list"));
    }

    #[test]
    fn accepts_mixed_case_and_extra_whitespace() {
        let seed = [4u8; SEED_LEN];
        let phrase = from_seed(&seed).unwrap();
        let messy = format!("  {}  ", phrase.to_uppercase().replace(' ', "   "));
        assert_eq!(to_seed(&messy).unwrap(), seed);
    }

    #[test]
    fn rejects_a_wrong_length_seed() {
        assert!(from_seed(&[0u8; 31]).is_err());
        assert!(from_seed(&[0u8; 33]).is_err());
    }
}
