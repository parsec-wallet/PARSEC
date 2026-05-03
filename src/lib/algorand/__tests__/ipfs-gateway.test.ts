import { describe, it, expect } from 'vitest';
import { parseIpfsUri, resolveIpfsUrl } from '../ipfs-gateway';

describe('ipfs-gateway', () => {
  describe('parseIpfsUri', () => {
    it('parses ipfs:// with v0 CID', () => {
      const r = parseIpfsUri('ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
      expect(r).toEqual({ cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG', path: '' });
    });

    it('parses ipfs:// with v1 base32 CID', () => {
      const r = parseIpfsUri('ipfs://bafybeibwsjr3aoyxjmyzedj2lc4dpaitxw5x5jpiku5n4ovjhuwbb56tre');
      expect(r?.cid).toBe('bafybeibwsjr3aoyxjmyzedj2lc4dpaitxw5x5jpiku5n4ovjhuwbb56tre');
      expect(r?.path).toBe('');
    });

    it('parses ipfs:// with subpath', () => {
      const r = parseIpfsUri('ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/metadata.json');
      expect(r).toEqual({
        cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
        path: 'metadata.json',
      });
    });

    it('parses ipfs://ipfs/<cid> double-prefix variant', () => {
      const r = parseIpfsUri('ipfs://ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
      expect(r?.cid).toBe('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
    });

    it('parses https gateway URLs', () => {
      const r = parseIpfsUri('https://ipfs.io/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/file.png');
      expect(r).toEqual({
        cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
        path: 'file.png',
      });
    });

    it('parses raw CIDs', () => {
      const r = parseIpfsUri('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
      expect(r?.cid).toBe('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
    });

    it('rejects non-IPFS strings', () => {
      expect(parseIpfsUri('https://example.com/foo')).toBeNull();
      expect(parseIpfsUri('not a cid')).toBeNull();
      expect(parseIpfsUri('')).toBeNull();
    });
  });

  describe('resolveIpfsUrl', () => {
    it('returns one URL per gateway in order', () => {
      const urls = resolveIpfsUrl('ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
      expect(urls.length).toBeGreaterThanOrEqual(3);
      expect(urls[0]).toContain('ipfs.algonode.xyz');
      expect(urls[0]).toContain('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG');
    });

    it('preserves subpath across gateways', () => {
      const urls = resolveIpfsUrl('ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/meta.json');
      for (const u of urls) expect(u).toMatch(/\/meta\.json$/);
    });

    it('returns empty for unparseable input', () => {
      expect(resolveIpfsUrl('not-ipfs')).toEqual([]);
    });

    it('uses custom gateways when provided', () => {
      const urls = resolveIpfsUrl('ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG', [
        'https://my-kubo.local/ipfs/',
      ]);
      expect(urls).toEqual(['https://my-kubo.local/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG']);
    });
  });
});
