// Parsec Wallet — Client-Side Key Encryption
// Keys never leave the device. Mnemonic encrypted with user passphrase via Web Crypto API.

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITERATIONS = 600_000; // OWASP recommendation for PBKDF2-SHA256
const STORAGE_KEY = 'parsec-encrypted-keys';

interface EncryptedVault {
  // Each account's mnemonic encrypted separately
  accounts: {
    address: string;
    cipher: string; // base64 encoded: salt + iv + ciphertext
  }[];
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(passphrase, salt);
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  // Pack: salt(16) + iv(12) + ciphertext
  const packed = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  packed.set(salt, 0);
  packed.set(iv, salt.length);
  packed.set(new Uint8Array(ciphertext), salt.length + iv.length);

  return btoa(String.fromCharCode(...packed));
}

async function decrypt(cipher: string, passphrase: string): Promise<string> {
  const packed = Uint8Array.from(atob(cipher), c => c.charCodeAt(0));
  const salt = packed.slice(0, SALT_LENGTH);
  const iv = packed.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = packed.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);

  return new TextDecoder().decode(decrypted);
}

function loadVault(): EncryptedVault {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { accounts: [] };
  } catch {
    return { accounts: [] };
  }
}

function saveVault(vault: EncryptedVault): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
}

/** Store an encrypted mnemonic for an address */
export async function saveMnemonic(
  address: string,
  mnemonic: string,
  passphrase: string
): Promise<void> {
  const cipher = await encrypt(mnemonic, passphrase);
  const vault = loadVault();
  // Replace if exists, otherwise add
  const idx = vault.accounts.findIndex(a => a.address === address);
  if (idx >= 0) {
    vault.accounts[idx].cipher = cipher;
  } else {
    vault.accounts.push({ address, cipher });
  }
  saveVault(vault);
}

/** Retrieve and decrypt a mnemonic — returns null if wrong passphrase */
export async function loadMnemonic(
  address: string,
  passphrase: string
): Promise<string | null> {
  const vault = loadVault();
  const entry = vault.accounts.find(a => a.address === address);
  if (!entry) return null;

  try {
    return await decrypt(entry.cipher, passphrase);
  } catch {
    return null; // Wrong passphrase or corrupted
  }
}

/** Check if a passphrase can decrypt the first account (passphrase validation) */
export async function verifyPassphrase(passphrase: string): Promise<boolean> {
  const vault = loadVault();
  if (vault.accounts.length === 0) return false;

  try {
    await decrypt(vault.accounts[0].cipher, passphrase);
    return true;
  } catch {
    return false;
  }
}

/** Remove an account from the vault */
export function removeAccount(address: string): void {
  const vault = loadVault();
  vault.accounts = vault.accounts.filter(a => a.address !== address);
  saveVault(vault);
}

/** Check if vault has any accounts */
export function hasVault(): boolean {
  return loadVault().accounts.length > 0;
}
