// pmVPN Module — Types
// SPDX-FileCopyrightText: 2026 BANKON
// SPDX-License-Identifier: GPL-3.0-or-later

export interface PmvpnHost {
  id: string;
  name: string;
  host: string;
  basePort: number;
  walletAddress: string;
  fingerprint: string | null;
}

export interface PmvpnSession {
  id: string;
  hostId: string;
  connected: boolean;
  connectedAt: number;
}

export interface PmvpnPortStatus {
  offset: number;
  name: string;
  active: boolean;
}

export interface ChallengeResponse {
  nonce: string;
  message: string;
  expires: number;
}

export type PmvpnConnectionState = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'error';

export interface PmvpnState {
  hosts: PmvpnHost[];
  activeHostId: string | null;
  sessions: Map<string, PmvpnSession>;
  connectionState: PmvpnConnectionState;
  error: string | null;
}
