// bankon_vault::msgpack — a small, bounded MessagePack reader.
//
// Enough to read an Algorand transaction (canonical msgpack: maps with string keys,
// unsigned and signed integers, byte strings, strings, arrays, booleans) so the Keycore can
// say what it is about to sign without trusting the app's description. No dependency; no
// floats (Algorand transactions carry none — a float is refused, not approximated).

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Nil,
    Bool(bool),
    Uint(u64),
    Int(i64),
    Bin(Vec<u8>),
    Str(String),
    Array(Vec<Value>),
    Map(Vec<(String, Value)>),
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Map(m) => m.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn as_u64(&self) -> Option<u64> {
        match self {
            Value::Uint(n) => Some(*n),
            Value::Int(n) if *n >= 0 => Some(*n as u64),
            _ => None,
        }
    }
    pub fn as_bin(&self) -> Option<&[u8]> {
        match self {
            Value::Bin(b) => Some(b),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }
}

const MAX_DEPTH: usize = 16;

/// Decode exactly one value spanning all of `bytes`.
pub fn decode(bytes: &[u8]) -> Result<Value, String> {
    let mut r = Reader { b: bytes, i: 0 };
    let v = r.value(0)?;
    if r.i != bytes.len() {
        return Err("trailing bytes after the msgpack value".to_string());
    }
    Ok(v)
}

struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}

impl Reader<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], String> {
        let end = self.i.checked_add(n).ok_or("length overflow")?;
        if end > self.b.len() {
            return Err("truncated msgpack".to_string());
        }
        let s = &self.b[self.i..end];
        self.i = end;
        Ok(s)
    }
    fn uint(&mut self, n: usize) -> Result<u64, String> {
        Ok(self.take(n)?.iter().fold(0u64, |acc, &x| (acc << 8) | x as u64))
    }
    fn len(&mut self, n: usize) -> Result<usize, String> {
        let l = self.uint(n)? as usize;
        // No container or string can be longer than what is left of the input.
        if l > self.b.len() - self.i.min(self.b.len()) + 1 {
            return Err("msgpack length exceeds the input".to_string());
        }
        Ok(l)
    }
    fn value(&mut self, depth: usize) -> Result<Value, String> {
        if depth > MAX_DEPTH {
            return Err("msgpack nested too deeply".to_string());
        }
        let t = self.take(1)?[0];
        Ok(match t {
            0x00..=0x7f => Value::Uint(t as u64),
            0x80..=0x8f => self.map((t & 0x0f) as usize, depth)?,
            0x90..=0x9f => self.array((t & 0x0f) as usize, depth)?,
            0xa0..=0xbf => self.str((t & 0x1f) as usize)?,
            0xc0 => Value::Nil,
            0xc2 => Value::Bool(false),
            0xc3 => Value::Bool(true),
            0xc4 => { let l = self.len(1)?; Value::Bin(self.take(l)?.to_vec()) }
            0xc5 => { let l = self.len(2)?; Value::Bin(self.take(l)?.to_vec()) }
            0xc6 => { let l = self.len(4)?; Value::Bin(self.take(l)?.to_vec()) }
            0xcc => Value::Uint(self.uint(1)?),
            0xcd => Value::Uint(self.uint(2)?),
            0xce => Value::Uint(self.uint(4)?),
            0xcf => Value::Uint(self.uint(8)?),
            0xd0 => Value::Int(self.take(1)?[0] as i8 as i64),
            0xd1 => Value::Int(self.uint(2)? as u16 as i16 as i64),
            0xd2 => Value::Int(self.uint(4)? as u32 as i32 as i64),
            0xd3 => Value::Int(self.uint(8)? as i64),
            0xd9 => { let l = self.len(1)?; self.str(l)? }
            0xda => { let l = self.len(2)?; self.str(l)? }
            0xdb => { let l = self.len(4)?; self.str(l)? }
            0xdc => { let l = self.len(2)?; self.array(l, depth)? }
            0xdd => { let l = self.len(4)?; self.array(l, depth)? }
            0xde => { let l = self.len(2)?; self.map(l, depth)? }
            0xdf => { let l = self.len(4)?; self.map(l, depth)? }
            0xe0..=0xff => Value::Int(t as i8 as i64),
            _ => return Err(format!("unsupported msgpack type 0x{t:02x}")),
        })
    }
    fn str(&mut self, l: usize) -> Result<Value, String> {
        let s = std::str::from_utf8(self.take(l)?).map_err(|_| "msgpack string is not utf-8")?;
        Ok(Value::Str(s.to_string()))
    }
    fn array(&mut self, l: usize, depth: usize) -> Result<Value, String> {
        let mut v = Vec::with_capacity(l.min(1024));
        for _ in 0..l {
            v.push(self.value(depth + 1)?);
        }
        Ok(Value::Array(v))
    }
    fn map(&mut self, l: usize, depth: usize) -> Result<Value, String> {
        let mut m = Vec::with_capacity(l.min(1024));
        for _ in 0..l {
            let k = match self.value(depth + 1)? {
                Value::Str(s) => s,
                Value::Uint(n) => n.to_string(),
                _ => return Err("msgpack map key is not a string".to_string()),
            };
            let v = self.value(depth + 1)?;
            m.push((k, v));
        }
        Ok(Value::Map(m))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_types_an_algorand_transaction_uses() {
        // {"amt": 1000000, "rcv": bin(2), "type": "pay", "neg": -1, "ok": true}
        let bytes = [
            0x85, 0xa3, b'a', b'm', b't', 0xce, 0x00, 0x0f, 0x42, 0x40,
            0xa3, b'r', b'c', b'v', 0xc4, 0x02, 0xab, 0xcd,
            0xa4, b't', b'y', b'p', b'e', 0xa3, b'p', b'a', b'y',
            0xa3, b'n', b'e', b'g', 0xff,
            0xa2, b'o', b'k', 0xc3,
        ];
        let v = decode(&bytes).unwrap();
        assert_eq!(v.get("amt").and_then(Value::as_u64), Some(1_000_000));
        assert_eq!(v.get("rcv").and_then(Value::as_bin), Some(&[0xab, 0xcd][..]));
        assert_eq!(v.get("type").and_then(Value::as_str), Some("pay"));
        assert_eq!(v.get("neg"), Some(&Value::Int(-1)));
        assert_eq!(v.get("ok"), Some(&Value::Bool(true)));
    }

    #[test]
    fn refuses_truncated_trailing_float_and_oversized_input() {
        assert!(decode(&[0xa3, b'a']).is_err());
        assert!(decode(&[0x01, 0x02]).is_err());
        assert!(decode(&[0xcb, 0, 0, 0, 0, 0, 0, 0, 0]).is_err());
        assert!(decode(&[0xc6, 0xff, 0xff, 0xff, 0xff]).is_err());
        let deep = [0x91u8; 40];
        assert!(decode(&deep).is_err());
    }
}
