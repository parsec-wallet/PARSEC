// Optional: push the provisioning kit to a host over the existing pmVPN wallet-authenticated SSH
// session. Files are written with quoted heredocs so content is never shell-expanded. The observer
// keypair is only included when the caller passes it explicitly (the UI gates that behind a typed
// confirmation).

import { sendTerminalData } from '../../pmvpn/connector';
import type { ProvisionKit } from './env';

function heredoc(path: string, content: string, mode?: string): string {
  const marker = `PARSEC_EOF_${Math.random().toString(36).slice(2, 10)}`;
  const body = content.endsWith('\n') ? content : content + '\n';
  return `cat > '${path}' <<'${marker}'\n${body}${marker}\n` + (mode ? `chmod ${mode} '${path}'\n` : '');
}

export async function pushKitOverPmvpn(
  sessionId: string,
  kit: ProvisionKit,
  remoteDir = '~/ar-io-node',
  extras: { observerKeypairJson?: string; uploadKeypairJson?: string } = {},
): Promise<string[]> {
  const written: string[] = [];
  await sendTerminalData(sessionId, `mkdir -p ${remoteDir}/data ${remoteDir}/wallets && cd ${remoteDir}\n`);
  for (const [name, content] of Object.entries(kit)) {
    await sendTerminalData(sessionId, heredoc(name, content, name === '.env' ? '600' : undefined));
    written.push(`${remoteDir}/${name}`);
  }
  if (extras.observerKeypairJson) {
    await sendTerminalData(sessionId, heredoc('wallets/observer.json', extras.observerKeypairJson, '600'));
    written.push(`${remoteDir}/wallets/observer.json`);
  }
  if (extras.uploadKeypairJson) {
    await sendTerminalData(sessionId, heredoc('wallets/upload.json', extras.uploadKeypairJson, '600'));
    written.push(`${remoteDir}/wallets/upload.json`);
  }
  return written;
}
