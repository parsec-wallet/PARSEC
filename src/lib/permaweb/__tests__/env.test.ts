import { describe, it, expect } from 'vitest';
import { generateNodeEnv, buildProvisionKit, generatePodmanCompose } from '../gateway/env';
import { ARIO_PROGRAMS } from '../constants';

const input = { fqdn: 'gw.bankon.pythai.net', operator: 'OPERATOR11111111111111111111111111111111111', observer: 'OBSERVER1111111111111111111111111111111111', solanaRpcUrl: 'https://rpc.example', startHeight: 1_800_000, adminApiKey: 'abc' };

describe('provisioning kit', () => {
  it('generates a Solana-era .env with keypair paths and program ids', () => {
    const env = generateNodeEnv(input);
    expect(env).toContain('AR_IO_WALLET=OPERATOR11111111111111111111111111111111111');
    expect(env).toContain('OBSERVER_WALLET=OBSERVER1111111111111111111111111111111111');
    expect(env).toContain('OBSERVER_KEYPAIR_PATH=/app/wallets/observer.json');
    expect(env).toContain('SOLANA_UPLOAD_KEYPAIR_PATH=/app/wallets/observer.json');
    expect(env).not.toContain('OBSERVER_PRIVATE_KEY=');
    expect(env).toContain(`ARIO_GAR_PROGRAM_ID=${ARIO_PROGRAMS.gar}`);
    expect(env).toContain('GRAPHQL_HOST=turbo-gateway.com');
    expect(env).toContain('ARNS_ROOT_HOST=gw.bankon.pythai.net');
    expect(env).toContain('SOLANA_RPC_URL=https://rpc.example');
    expect(env).not.toMatch(/^AO_CU_URL=/m);
  });
  it('never emits both key forms', () => {
    expect(() => generateNodeEnv({ ...input, observerSecretBase58: 'x' })).toThrow();
    expect(() => generateNodeEnv({ ...input, keyMode: 'inline' })).toThrow();
    const inline = generateNodeEnv({ ...input, keyMode: 'inline', observerSecretBase58: 'SECRET58' });
    expect(inline).toContain('OBSERVER_PRIVATE_KEY=SECRET58');
    expect(inline).not.toContain('OBSERVER_KEYPAIR_PATH');
  });
  it('builds the four-file kit with podman semantics', () => {
    const kit = buildProvisionKit(input);
    expect(Object.keys(kit).sort()).toEqual(['.env', 'CHECKLIST.txt', 'compose.yml', 'nginx-gw.bankon.pythai.net.conf']);
    expect(generatePodmanCompose()).toContain('podman-compose');
    expect(kit['compose.yml']).toContain('ghcr.io/ar-io/ar-io-core');
    expect(kit['compose.yml']).not.toContain('parsec-gateway:');
    expect(kit['CHECKLIST.txt']).toContain("*.gw.bankon.pythai.net");
    expect(kit['CHECKLIST.txt']).toContain('release ≥ 82');
  });
});
