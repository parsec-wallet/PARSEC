//! Minimal RLP encoder (strings, unsigned integers, lists) — encode only.

/// RLP-encode a byte string.
pub fn encode_bytes(b: &[u8]) -> Vec<u8> {
    if b.len() == 1 && b[0] < 0x80 {
        return vec![b[0]];
    }
    let mut out = encode_len(b.len(), 0x80);
    out.extend_from_slice(b);
    out
}

/// RLP-encode an unsigned integer (minimal big-endian; zero encodes as 0x80).
pub fn encode_uint(n: u128) -> Vec<u8> {
    encode_uint_be(&n.to_be_bytes())
}

/// RLP-encode a big-endian unsigned integer given as bytes; leading zeros are stripped.
pub fn encode_uint_be(be: &[u8]) -> Vec<u8> {
    let start = be.iter().position(|&x| x != 0).unwrap_or(be.len());
    encode_bytes(&be[start..])
}

/// RLP-encode a list of already-encoded items.
pub fn encode_list(items: &[Vec<u8>]) -> Vec<u8> {
    let payload = items.concat();
    let mut out = encode_len(payload.len(), 0xc0);
    out.extend_from_slice(&payload);
    out
}

/// Length prefix: `offset + len` for len <= 55, else `offset + 55 + len_of_len || len`.
fn encode_len(len: usize, offset: u8) -> Vec<u8> {
    if len <= 55 {
        return vec![offset + len as u8];
    }
    let be = (len as u64).to_be_bytes();
    let start = be.iter().position(|&x| x != 0).unwrap_or(be.len());
    let len_bytes = &be[start..];
    let mut out = vec![offset + 55 + len_bytes.len() as u8];
    out.extend_from_slice(len_bytes);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn h(v: &[u8]) -> String {
        hex::encode(v)
    }

    #[test]
    fn canonical_strings() {
        assert_eq!(h(&encode_bytes(b"")), "80");
        assert_eq!(h(&encode_bytes(b"dog")), "83646f67");
        assert_eq!(h(&encode_bytes(&[0x00])), "00");
        assert_eq!(h(&encode_bytes(&[0x7f])), "7f");
        assert_eq!(h(&encode_bytes(&[0x80])), "8180");
    }

    #[test]
    fn canonical_lists() {
        let cat_dog = encode_list(&[encode_bytes(b"cat"), encode_bytes(b"dog")]);
        assert_eq!(h(&cat_dog), "c88363617483646f67");
        assert_eq!(h(&encode_list(&[])), "c0");
    }

    #[test]
    fn canonical_integers() {
        assert_eq!(h(&encode_uint(0)), "80");
        assert_eq!(h(&encode_uint(15)), "0f");
        assert_eq!(h(&encode_uint(1024)), "820400");
        assert_eq!(h(&encode_uint_be(&[0, 0, 4, 0])), "820400");
        assert_eq!(h(&encode_uint(u128::MAX)), format!("90{}", "ff".repeat(16)));
    }

    #[test]
    fn long_string_and_long_list() {
        let s = [b'a'; 56];
        let enc = encode_bytes(&s);
        assert_eq!(&h(&enc)[..4], "b838");
        assert_eq!(enc.len(), 58);
        assert_eq!(&enc[2..], &s[..]);

        // 1024-byte string → 0xb9 0x04 0x00
        let big = vec![0u8; 1024];
        assert_eq!(&h(&encode_bytes(&big))[..6], "b90400");

        // list whose payload is 56 bytes → 0xf8 0x38
        let item = encode_bytes(&[b'b'; 54]); // 55-byte item + a 1-byte item = 56
        let list = encode_list(&[item, encode_bytes(&[0x01])]);
        assert_eq!(&h(&list)[..4], "f838");
    }
}
