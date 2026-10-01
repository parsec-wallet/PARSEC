// IPFS gateway abstraction with sequential fallback. Pattern adapted from
// AlgoNode/algostack's Files module — reimplemented in parsec style.
//
// Default gateways are public; a follow-up Settings hook (TODO) will let the
// participant restrict to AlgoNode-only or point to their own Kubo node
// (parsec_mesh module already has Kubo HTTP integration).

const DEFAULT_GATEWAYS = [
  'https://ipfs.algonode.xyz/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://cf-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
] as const;

const CID_PATTERN = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44,}|b[A-Za-z2-7]{58,}|baf[A-Za-z2-7]{55,})$/;

/** Pull a CID + optional path out of any of the URI shapes we encounter. */
export function parseIpfsUri(uri: string): { cid: string; path: string } | null {
  if (!uri) return null;

  // ipfs://<cid>/<path?>
  if (uri.startsWith('ipfs://')) {
    const rest = uri.slice('ipfs://'.length).replace(/^ipfs\//, '');
    const [cid, ...parts] = rest.split('/');
    if (cid && CID_PATTERN.test(cid)) return { cid, path: parts.join('/') };
    return null;
  }

  // https://<gateway>/ipfs/<cid>/<path?>
  const gatewayMatch = uri.match(/^https?:\/\/[^/]+\/ipfs\/([^/?#]+)(?:\/([^?#]*))?/);
  if (gatewayMatch) {
    const cid = gatewayMatch[1];
    const path = gatewayMatch[2] || '';
    if (CID_PATTERN.test(cid)) return { cid, path };
  }

  // raw CID
  if (CID_PATTERN.test(uri)) return { cid: uri, path: '' };

  return null;
}

/** Build the ordered list of HTTP URLs to try for an IPFS resource. */
export function resolveIpfsUrl(uri: string, gateways: readonly string[] = DEFAULT_GATEWAYS): string[] {
  const parsed = parseIpfsUri(uri);
  if (!parsed) return [];
  const suffix = parsed.path ? `${parsed.cid}/${parsed.path}` : parsed.cid;
  return gateways.map((g) => g.endsWith('/') ? `${g}${suffix}` : `${g}/${suffix}`);
}

/**
 * Fetch an IPFS resource with sequential gateway fallback. Returns the first
 * 2xx/3xx response. Throws if every gateway fails.
 */
export async function fetchIpfs(uri: string, opts?: RequestInit): Promise<Response> {
  const urls = resolveIpfsUrl(uri);
  if (urls.length === 0) throw new Error(`Not an IPFS URI: ${uri}`);

  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, opts);
      if (res.ok || (res.status >= 300 && res.status < 400)) return res;
      lastError = new Error(`HTTP ${res.status} from ${url}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('IPFS fetch failed');
}

export const _testing = { DEFAULT_GATEWAYS };
