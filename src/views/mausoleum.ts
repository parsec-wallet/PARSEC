// PARSEC Mausoleum — Graphical Vault Manager + Encryption Reality Visualizer
// Tomb-inspired: LUKS volumes, USB key separation, cold storage lifecycle.
// Shows every encryption threshold from AES-256 to quantum horizon.
// 3D visualization of key space exhaustion probability over time.
// (c) 2026 BANKON — GPL-3.0

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../lib/vault';

// ── Types from Rust IPC ──────────────────────────────────────

interface TombAvailability {
  available: boolean;
  tomb_path: string | null;
  version: string | null;
  missing_deps: string[];
}

interface UsbDrive {
  mount_path: string;
  label: string;
  available_mb: number;
  total_mb: number;
}

interface TombStatus {
  exists: boolean;
  open: boolean;
  tomb_path: string;
}

// ── Encryption Threshold Data ────────────────────────────────
// Every cipher in PARSEC, its key space, and its quantum resistance.

interface CipherThreshold {
  name: string;
  family: string;
  keyBits: number;
  classicalBits: number;   // effective security bits (classical)
  quantumBits: number;     // effective security bits (post-Grover/Shor)
  algorithm: string;
  usage: string;
  quantumVulnerable: boolean;  // true = Shor breaks it entirely
  yearsSafe: number;       // estimated years of classical safety at 10^18 ops/sec
  collisionBits: number;   // birthday bound: keyBits/2
  notes: string;
}

const THRESHOLDS: CipherThreshold[] = [
  {
    name: 'AES-256-GCM',
    family: 'Symmetric',
    keyBits: 256,
    classicalBits: 256,
    quantumBits: 128,      // Grover halves symmetric security
    algorithm: 'AES-256 in GCM mode (authenticated encryption)',
    usage: 'bankon_vault key encryption, Tomb LUKS inner cipher',
    quantumVulnerable: false,
    yearsSafe: Infinity,   // 2^256 at 10^18/sec = 3.7×10^57 years
    collisionBits: 128,
    notes: 'Post-quantum safe. Grover reduces to 2^128 — still beyond all computation.',
  },
  {
    name: 'Argon2id',
    family: 'KDF',
    keyBits: 256,
    classicalBits: 256,
    quantumBits: 128,
    algorithm: 'Argon2id (memory-hard KDF, 256-bit output)',
    usage: 'Vault passphrase → session key derivation',
    quantumVulnerable: false,
    yearsSafe: Infinity,
    collisionBits: 128,
    notes: 'Memory-hard: 64MB RAM per hash. Resists GPU/ASIC brute force. Grover-safe.',
  },
  {
    name: 'LUKS2 (XTS-AES-256)',
    family: 'Symmetric',
    keyBits: 512,
    classicalBits: 256,    // XTS uses 256-bit for encryption + 256-bit for tweak
    quantumBits: 128,
    algorithm: 'AES-256-XTS (full-disk encryption)',
    usage: 'Tomb encrypted volume (.tomb file)',
    quantumVulnerable: false,
    yearsSafe: Infinity,
    collisionBits: 128,
    notes: 'Tomb default cipher. XTS mode prevents sector-level pattern analysis.',
  },
  {
    name: 'Ed25519',
    family: 'Asymmetric (Algorand)',
    keyBits: 256,
    classicalBits: 128,    // ~2^128 classical security
    quantumBits: 0,        // Shor breaks it completely
    algorithm: 'EdDSA over Curve25519',
    usage: 'Algorand account signing (admin key, all wallets)',
    quantumVulnerable: true,
    yearsSafe: 1e15,       // classically safe, quantum-vulnerable
    collisionBits: 126,
    notes: 'Shor\'s algorithm on a fault-tolerant QC (~4000 logical qubits) breaks this entirely. Timeline: 15-30 years.',
  },
  {
    name: 'secp256k1 (ECDSA)',
    family: 'Asymmetric (EVM/BTC)',
    keyBits: 256,
    classicalBits: 128,
    quantumBits: 0,
    algorithm: 'ECDSA over secp256k1',
    usage: 'Ethereum, Bitcoin, Litecoin signing',
    quantumVulnerable: true,
    yearsSafe: 1e15,
    collisionBits: 128,
    notes: 'Same Shor vulnerability as Ed25519. All ECC falls to quantum. Migrate to post-quantum when available.',
  },
  {
    name: 'secp256k1 (Schnorr)',
    family: 'Asymmetric (Zilliqa)',
    keyBits: 256,
    classicalBits: 128,
    quantumBits: 0,
    algorithm: 'Schnorr signatures over secp256k1',
    usage: 'Zilliqa native signing',
    quantumVulnerable: true,
    yearsSafe: 1e15,
    collisionBits: 128,
    notes: 'Schnorr is more efficient than ECDSA but same quantum vulnerability. Same curve, same risk.',
  },
  {
    name: 'Ed25519-BIP32',
    family: 'Asymmetric (Cardano)',
    keyBits: 256,
    classicalBits: 128,
    quantumBits: 0,
    algorithm: 'Ed25519 with BIP32 HD derivation',
    usage: 'Cardano wallet signing',
    quantumVulnerable: true,
    yearsSafe: 1e15,
    collisionBits: 126,
    notes: 'Extended keys (96 bytes) but same Ed25519 curve underneath. Same quantum timeline.',
  },
  {
    name: 'RSA-4096 (PSS)',
    family: 'Asymmetric (Arweave)',
    keyBits: 4096,
    classicalBits: 140,    // ~140-bit equivalent security
    quantumBits: 0,
    algorithm: 'RSA-PSS with SHA-256',
    usage: 'Arweave transaction signing, data permanence',
    quantumVulnerable: true,
    yearsSafe: 1e12,
    collisionBits: 70,     // birthday bound on 140-bit security
    notes: 'RSA is the FIRST to fall to quantum (Shor). Requires fewer qubits than ECC. ~2000 logical qubits.',
  },
  {
    name: 'SHA-256',
    family: 'Hash',
    keyBits: 256,
    classicalBits: 256,
    quantumBits: 128,
    algorithm: 'SHA-2 family (256-bit digest)',
    usage: 'Algorand address derivation, HMAC, integrity',
    quantumVulnerable: false,
    yearsSafe: Infinity,
    collisionBits: 128,
    notes: 'Collision resistance: 2^128 (birthday). Preimage: 2^256. Grover: 2^128. All safe.',
  },
  {
    name: 'Keccak-256',
    family: 'Hash',
    keyBits: 256,
    classicalBits: 256,
    quantumBits: 128,
    algorithm: 'SHA-3 family (Keccak, 256-bit)',
    usage: 'Ethereum address derivation, EVM operations',
    quantumVulnerable: false,
    yearsSafe: Infinity,
    collisionBits: 128,
    notes: 'Sponge construction. Same quantum profile as SHA-256. Used in all EVM address computation.',
  },
];

// ── WebGL 3D Visualization: Crypto Horizon ───────────────────
// Minimalistic mathematical expression. WebGL security surface.
// X = time (years), Y = probability of break, Z = compute tier.
// Background: procedural grid field with depth fog.

const VERT_SRC = `
  attribute vec2 a_pos;
  uniform float u_time;
  uniform float u_aspect;
  varying vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const FRAG_SRC = `
  precision mediump float;
  varying vec2 v_uv;
  uniform float u_time;
  uniform float u_bits;
  uniform float u_qbits;
  uniform float u_collBits;
  uniform float u_qvuln;

  // Perspective grid with fog — mathematical minimalism
  float grid(vec2 p, float s) {
    vec2 g = abs(fract(p * s) - 0.5);
    float d = min(g.x, g.y);
    return smoothstep(0.0, 0.02, d);
  }

  // Probability curve: P(break) over log-time at given compute tier
  float probCurve(float logYears, float opsLog2, float secBits) {
    float totalOps = opsLog2 + logYears * 3.32 + 24.9; // log2(10^logYears * 3.15e7) * ops
    float p = totalOps - secBits;
    return clamp(p / 10.0, 0.0, 1.0); // soft sigmoid
  }

  void main() {
    vec2 uv = v_uv;
    float t = u_time * 0.15;

    // Background: infinite perspective grid receding to horizon
    float horizon = 0.35;
    float depth = 1.0 / max(uv.y - horizon + 0.001, 0.001);
    vec2 gridUV = vec2((uv.x - 0.5) * depth * 2.0 + t * 0.3, depth * 0.5 + t * 0.1);
    float g = grid(gridUV, 1.0) * grid(gridUV, 0.1);
    float fog = exp(-depth * 0.03);

    // Base color: deep void
    vec3 col = vec3(0.02, 0.02, 0.04);

    // Grid glow (green for safe, shift to red near quantum threshold)
    float safety = u_qvuln > 0.5 ? 0.3 : 1.0;
    vec3 gridColor = mix(vec3(0.0, 0.6, 0.3), vec3(0.6, 0.0, 0.2), 1.0 - safety);
    col += (1.0 - g) * gridColor * 0.08 * fog;

    // Security surface curves (5 compute tiers)
    float logTime = uv.x * 30.0; // 0 → 10^30 years
    float secBits = u_bits;
    float qSecBits = u_qbits;

    // Each tier maps to a vertical band in the visualization
    float tiers[5];
    tiers[0] = probCurve(logTime, 30.0, secBits);  // Desktop
    tiers[1] = probCurve(logTime, 50.0, secBits);  // Supercomputer
    tiers[2] = probCurve(logTime, 60.0, secBits);  // Global
    tiers[3] = probCurve(logTime, 70.0, u_qvuln > 0.5 ? max(qSecBits, 1.0) : qSecBits); // Quantum
    tiers[4] = probCurve(logTime, 80.0, u_qvuln > 0.5 ? max(qSecBits, 1.0) : qSecBits); // Theoretical

    // Map Y to probability space (bottom = P=0, top = P=1)
    float py = 1.0 - uv.y;

    // Draw curves as luminous lines
    vec3 tierColors[5];
    tierColors[0] = vec3(0.0, 0.7, 0.35);   // green
    tierColors[1] = vec3(1.0, 0.7, 0.0);     // amber
    tierColors[2] = vec3(1.0, 0.3, 0.0);     // orange
    tierColors[3] = vec3(1.0, 0.0, 0.3);     // magenta
    tierColors[4] = vec3(0.7, 0.0, 1.0);     // violet

    for (int i = 0; i < 5; i++) {
      float curve = tiers[i];
      float dist = abs(py - curve);
      float line = exp(-dist * dist * 2000.0);
      float glow = exp(-dist * dist * 200.0) * 0.3;
      col += tierColors[i] * (line + glow);
    }

    // Collision horizon (birthday bound) — dashed white
    float collCurve = probCurve(logTime, 60.0, u_collBits * 2.0);
    float collDist = abs(py - collCurve);
    float dash = step(0.5, fract(uv.x * 40.0));
    col += vec3(0.5) * exp(-collDist * collDist * 1500.0) * dash * 0.5;

    // P=0.5 danger line
    float halfDist = abs(py - 0.5);
    col += vec3(0.4, 0.0, 0.0) * exp(-halfDist * halfDist * 800.0) * 0.3;

    // Vignette
    float vig = 1.0 - length((uv - 0.5) * 1.4);
    col *= smoothstep(0.0, 0.7, vig);

    // Subtle scan line
    col *= 0.95 + 0.05 * sin(uv.y * 800.0 + t * 2.0);

    gl_FragColor = vec4(col, 1.0);
  }
`;

function renderCryptoHorizon(canvas: HTMLCanvasElement, cipher: CipherThreshold) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
  if (!gl) {
    // Fallback: simple text
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#fff';
      ctx.font = '14px monospace';
      ctx.fillText('WebGL unavailable — upgrade browser', 20, 30);
    }
    return;
  }

  // Compile shaders
  function compileShader(type: number, src: string): WebGLShader | null {
    const s = gl!.createShader(type);
    if (!s) return null;
    gl!.shaderSource(s, src);
    gl!.compileShader(s);
    if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
      gl!.deleteShader(s);
      return null;
    }
    return s;
  }

  const vs = compileShader(gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return;

  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  // Full-screen quad
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Uniforms
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uBits = gl.getUniformLocation(prog, 'u_bits');
  const uQbits = gl.getUniformLocation(prog, 'u_qbits');
  const uCollBits = gl.getUniformLocation(prog, 'u_collBits');
  const uQvuln = gl.getUniformLocation(prog, 'u_qvuln');

  gl.uniform1f(uBits, cipher.classicalBits);
  gl.uniform1f(uQbits, cipher.quantumBits);
  gl.uniform1f(uCollBits, cipher.collisionBits);
  gl.uniform1f(uQvuln, cipher.quantumVulnerable ? 1.0 : 0.0);

  let frame = 0;
  let animId = 0;

  function draw() {
    if (!gl) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(uTime, frame * 0.016);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frame++;
    animId = requestAnimationFrame(draw);
  }

  draw();

  // Cleanup when canvas leaves DOM
  const observer = new MutationObserver(() => {
    if (!document.contains(canvas)) {
      cancelAnimationFrame(animId);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Draw 2D overlay labels on top
  const overlay = document.createElement('canvas');
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none';
  canvas.parentElement?.style.setProperty('position', 'relative');
  canvas.parentElement?.appendChild(overlay);

  const ctx = overlay.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px monospace';
    ctx.fillText(`${cipher.name} — Security Horizon`, 12, 22);
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.fillText(`Classical: 2^${cipher.classicalBits} | Quantum: ${cipher.quantumBits > 0 ? '2^' + cipher.quantumBits : 'BROKEN (Shor)'} | Collision: 2^${cipher.collisionBits}`, 12, 38);

    // Axis labels
    ctx.fillStyle = '#555';
    ctx.font = '9px monospace';
    ctx.fillText('1 yr', 8, canvas.height - 8);
    ctx.fillText('10^15 yr', canvas.width / 2 - 20, canvas.height - 8);
    ctx.fillText('10^30 yr', canvas.width - 55, canvas.height - 8);
    ctx.fillText('P=1', 8, 56);
    ctx.fillText('P=0', 8, canvas.height - 20);
    ctx.fillText('P=0.5 (danger)', canvas.width - 100, canvas.height / 2);

    // Tier labels (right side)
    const tierLabels = ['Desktop', 'Supercomputer', 'Global', 'Quantum', 'Max'];
    const tierColors = ['#00b459', '#ffb300', '#ff4d00', '#ff0050', '#b300ff'];
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = tierColors[i];
      ctx.fillText(tierLabels[i], canvas.width - 80, 60 + i * 14);
    }
  }
}

// ── View Builder ─────────────────────────────────────────────

export function mausoleumView(): HTMLElement {
  let tombStatus: TombStatus | null = null;
  let tombAvail: TombAvailability | null = null;
  let usbDrives: UsbDrive[] = [];
  let selectedCipher = THRESHOLDS[0]; // AES-256-GCM default
  let tab: 'vault' | 'thresholds' | 'horizon' = 'vault';

  const root = el('div', { cls: 'parsec-view parsec-mausoleum' });

  async function loadTombState() {
    if (!isTauri()) return;
    try {
      tombAvail = await invoke<TombAvailability>('tomb_check');
      tombStatus = await invoke<TombStatus>('tomb_status');
      usbDrives = await invoke<UsbDrive[]>('tomb_detect_usb');
    } catch { /* not available */ }
  }

  function render() {
    root.innerHTML = '';

    // Header
    root.appendChild(el('div', {
      cls: 'parsec-mausoleum__header',
      children: [
        btn('Back', {
          minimal: true, icon: 'arrow-left',
          onClick: () => store.navigate('settings'),
        }),
        el('h2', { cls: 'parsec-mausoleum__title', text: 'Mausoleum' }),
        el('span', { cls: 'parsec-mausoleum__subtitle', text: 'Vault & Encryption Observatory' }),
      ],
    }));

    // Tab bar
    const tabs = el('div', { cls: 'parsec-mausoleum__tabs' });
    for (const t of [
      { id: 'vault' as const, label: 'Tomb Vault', icon: 'lock' },
      { id: 'thresholds' as const, label: 'Cipher Thresholds', icon: 'shield' },
      { id: 'horizon' as const, label: '3D Crypto Horizon', icon: 'globe' },
    ]) {
      tabs.appendChild(btn(t.label, {
        minimal: tab !== t.id,
        intent: tab === t.id ? 'primary' : 'none',
        icon: t.icon,
        onClick: () => { tab = t.id; render(); },
      }));
    }
    root.appendChild(tabs);

    // Tab content
    switch (tab) {
      case 'vault': renderVaultTab(); break;
      case 'thresholds': renderThresholdsTab(); break;
      case 'horizon': renderHorizonTab(); break;
    }
  }

  // ── Tab: Tomb Vault ──────────────────────────────────────

  function renderVaultTab() {
    const panel = el('div', { cls: 'parsec-mausoleum__panel' });

    if (!isTauri()) {
      panel.appendChild(el('div', {
        cls: 'parsec-admin-keygen__alert parsec-admin-keygen__alert--danger',
        children: [
          el('strong', { text: 'Tomb requires Tauri desktop environment' }),
          el('p', { text: 'Tomb integration uses Linux dm-crypt via the Tauri backend. Not available in browser mode.' }),
        ],
      }));
      root.appendChild(panel);
      return;
    }

    // Tomb availability
    if (tombAvail) {
      const avail = tombAvail;
      panel.appendChild(el('div', {
        cls: `parsec-mausoleum__status-card ${avail.available ? 'parsec-mausoleum__status-card--ok' : 'parsec-mausoleum__status-card--error'}`,
        children: [
          el('div', {
            cls: 'parsec-mausoleum__status-head',
            children: [
              el('span', { cls: `bp5-icon bp5-icon-${avail.available ? 'tick-circle' : 'error'}` }),
              el('strong', { text: avail.available ? 'Tomb Available' : 'Tomb Not Available' }),
            ],
          }),
          avail.version ? el('div', { cls: 'parsec-mausoleum__status-detail', text: `Version: ${avail.version}` }) : el('span'),
          avail.missing_deps.length > 0
            ? el('div', { cls: 'parsec-mausoleum__status-detail', text: `Missing: ${avail.missing_deps.join(', ')}` })
            : el('span'),
        ],
      }));
    }

    // Tomb status
    if (tombStatus) {
      const s = tombStatus;
      panel.appendChild(el('div', {
        cls: `parsec-mausoleum__tomb-card ${s.open ? 'parsec-mausoleum__tomb-card--open' : s.exists ? 'parsec-mausoleum__tomb-card--closed' : 'parsec-mausoleum__tomb-card--none'}`,
        children: [
          el('h4', { text: s.open ? 'Tomb OPEN' : s.exists ? 'Tomb SEALED' : 'No Tomb Created' }),
          el('div', { cls: 'parsec-mausoleum__tomb-path', text: s.tomb_path }),
          el('div', {
            cls: 'parsec-mausoleum__tomb-controls',
            children: s.open
              ? [
                btn('Close', { intent: 'warning', icon: 'lock', onClick: () => closeTomb() }),
                btn('Slam', { intent: 'danger', icon: 'delete', onClick: () => slamTomb() }),
              ]
              : s.exists
                ? [renderOpenForm()]
                : [renderCreateForm()],
          }),
        ],
      }));
    }

    // USB drives
    if (usbDrives.length > 0) {
      panel.appendChild(el('h4', { text: 'USB Key Storage' }));
      for (const drive of usbDrives) {
        panel.appendChild(el('div', {
          cls: 'parsec-mausoleum__usb-card',
          children: [
            el('span', { cls: 'bp5-icon bp5-icon-floppy-disk' }),
            el('div', {
              children: [
                el('strong', { text: drive.label }),
                el('div', {
                  cls: 'parsec-mausoleum__usb-detail',
                  text: `${drive.mount_path} — ${drive.available_mb}MB free / ${drive.total_mb}MB`,
                }),
              ],
            }),
          ],
        }));
      }
    }

    // Admin key gen link
    panel.appendChild(el('div', {
      cls: 'parsec-mausoleum__divider',
    }));
    panel.appendChild(btn('Admin Key Ceremony (Airgapped)', {
      intent: 'primary', icon: 'key', large: true,
      onClick: () => store.navigate('admin-keygen'),
    }));

    root.appendChild(panel);
  }

  function renderOpenForm(): HTMLElement {
    const form = el('div', { cls: 'parsec-mausoleum__form' });
    const keyInput = input({ placeholder: 'Key file path (e.g. /media/usb/bankon.tomb.key)', cls: 'bp5-input bp5-fill' });
    const passInput = input({ type: 'password', placeholder: 'Tomb passphrase', cls: 'bp5-input bp5-fill' });
    form.appendChild(keyInput);
    form.appendChild(passInput);
    form.appendChild(btn('Open Tomb', {
      intent: 'success', icon: 'unlock',
      onClick: async () => {
        try {
          await invoke('tomb_open', { passphrase: passInput.value, keyPath: keyInput.value });
          passInput.value = '\0'.repeat(passInput.value.length); passInput.value = '';
          toast('Tomb opened', 'success');
          await loadTombState();
          render();
        } catch (e) {
          toast(`${e}`, 'danger');
        }
      },
    }));
    return form;
  }

  function renderCreateForm(): HTMLElement {
    const form = el('div', { cls: 'parsec-mausoleum__form' });
    const keyInput = input({ placeholder: 'Key file destination (USB preferred)', cls: 'bp5-input bp5-fill' });
    const passInput = input({ type: 'password', placeholder: 'New tomb passphrase', cls: 'bp5-input bp5-fill' });
    const sizeInput = input({ placeholder: 'Size in MB (default: 128)', cls: 'bp5-input', value: '128' });
    form.appendChild(keyInput);
    form.appendChild(passInput);
    form.appendChild(sizeInput);
    form.appendChild(btn('Create Tomb', {
      intent: 'primary', icon: 'build',
      onClick: async () => {
        try {
          const sizeMb = parseInt(sizeInput.value) || 128;
          await invoke('tomb_create', { passphrase: passInput.value, keyPath: keyInput.value, sizeMb });
          passInput.value = '\0'.repeat(passInput.value.length); passInput.value = '';
          toast('Tomb created and locked', 'success');
          await loadTombState();
          render();
        } catch (e) {
          toast(`${e}`, 'danger');
        }
      },
    }));
    return form;
  }

  async function closeTomb() {
    try {
      await invoke('tomb_close');
      toast('Tomb closed', 'success');
      await loadTombState();
      render();
    } catch (e) { toast(`${e}`, 'danger'); }
  }

  async function slamTomb() {
    try {
      await invoke('tomb_slam');
      toast('Tomb slammed (force-closed)', 'warning');
      await loadTombState();
      render();
    } catch (e) { toast(`${e}`, 'danger'); }
  }

  // ── Tab: Cipher Thresholds ───────────────────────────────

  function renderThresholdsTab() {
    const panel = el('div', { cls: 'parsec-mausoleum__panel' });

    panel.appendChild(el('p', {
      cls: 'parsec-mausoleum__intro',
      text: 'Every encryption primitive in PARSEC, its classical and quantum security, collision bounds, and real-world timeline.',
    }));

    for (const cipher of THRESHOLDS) {
      const isSelected = cipher.name === selectedCipher.name;
      const card = el('div', {
        cls: `parsec-mausoleum__cipher-card ${isSelected ? 'parsec-mausoleum__cipher-card--selected' : ''} ${cipher.quantumVulnerable ? 'parsec-mausoleum__cipher-card--quantum-warn' : ''}`,
        onClick: () => { selectedCipher = cipher; render(); },
      });

      // Header row
      card.appendChild(el('div', {
        cls: 'parsec-mausoleum__cipher-head',
        children: [
          el('strong', { text: cipher.name }),
          el('span', { cls: 'parsec-mausoleum__cipher-family', text: cipher.family }),
        ],
      }));

      // Security bars
      const barsRow = el('div', { cls: 'parsec-mausoleum__cipher-bars' });

      // Classical bar
      barsRow.appendChild(renderBar('Classical', cipher.classicalBits, 256, '#00cc88'));
      // Quantum bar
      barsRow.appendChild(renderBar('Quantum', cipher.quantumBits, 256,
        cipher.quantumVulnerable ? '#ff0050' : '#00aaff'));
      // Collision bar
      barsRow.appendChild(renderBar('Collision', cipher.collisionBits, 128, '#ffaa00'));

      card.appendChild(barsRow);

      // Usage line
      card.appendChild(el('div', { cls: 'parsec-mausoleum__cipher-usage', text: cipher.usage }));

      // Expanded detail
      if (isSelected) {
        card.appendChild(el('div', {
          cls: 'parsec-mausoleum__cipher-detail',
          children: [
            el('div', { text: `Algorithm: ${cipher.algorithm}` }),
            el('div', { text: `Key size: ${cipher.keyBits} bits` }),
            el('div', { text: `Classical security: 2^${cipher.classicalBits} operations` }),
            el('div', { text: `Quantum security: ${cipher.quantumBits > 0 ? '2^' + cipher.quantumBits + ' (Grover-reduced)' : 'BROKEN by Shor\'s algorithm'}` }),
            el('div', { text: `Birthday bound: 2^${cipher.collisionBits} (50% collision probability)` }),
            el('div', { text: `Time to brute force (10^18 ops/sec): ${cipher.yearsSafe === Infinity ? 'heat death of universe' : cipher.yearsSafe.toExponential(0) + ' years'}` }),
            el('div', { cls: 'parsec-mausoleum__cipher-notes', text: cipher.notes }),
          ],
        }));
      }

      panel.appendChild(card);
    }

    root.appendChild(panel);
  }

  function renderBar(label: string, bits: number, maxBits: number, color: string): HTMLElement {
    const pct = bits > 0 ? Math.min(100, (bits / maxBits) * 100) : 0;
    const bar = el('div', { cls: 'parsec-mausoleum__bar-row' });
    bar.appendChild(el('span', { cls: 'parsec-mausoleum__bar-label', text: label }));
    const track = el('div', { cls: 'parsec-mausoleum__bar-track' });
    const fill = el('div', { cls: 'parsec-mausoleum__bar-fill' });
    fill.style.width = `${pct}%`;
    fill.style.background = bits === 0 ? '#ff0050' : color;
    track.appendChild(fill);
    bar.appendChild(track);
    bar.appendChild(el('span', { cls: 'parsec-mausoleum__bar-value', text: bits > 0 ? `${bits}b` : 'BROKEN' }));
    return bar;
  }

  // ── Tab: 3D Crypto Horizon ───────────────────────────────

  function renderHorizonTab() {
    const panel = el('div', { cls: 'parsec-mausoleum__panel' });

    panel.appendChild(el('p', {
      cls: 'parsec-mausoleum__intro',
      text: 'Security surface: probability of key compromise over time, across computational tiers from desktop to quantum. Select a cipher below.',
    }));

    // Cipher selector
    const selector = el('div', { cls: 'parsec-mausoleum__cipher-selector' });
    for (const c of THRESHOLDS) {
      selector.appendChild(btn(c.name, {
        minimal: c.name !== selectedCipher.name,
        intent: c.name === selectedCipher.name ? 'primary' : 'none',
        onClick: () => {
          selectedCipher = c;
          render();
        },
      }));
    }
    panel.appendChild(selector);

    // Canvas
    const canvas = document.createElement('canvas');
    canvas.width = 700;
    canvas.height = 420;
    canvas.className = 'parsec-mausoleum__horizon-canvas';
    panel.appendChild(canvas);

    // Legend
    const legend = el('div', { cls: 'parsec-mausoleum__legend' });
    const items = [
      ['Desktop (2^30 ops/s)', '#00b450'],
      ['Supercomputer (2^50)', '#ffb400'],
      ['Global Network (2^60)', '#ff5000'],
      ['Quantum Grover (2^70)', '#ff0050'],
      ['Theoretical Max (2^80)', '#c800ff'],
      ['Collision horizon', '#ffffff44'],
    ];
    for (const [label, color] of items) {
      legend.appendChild(el('div', {
        cls: 'parsec-mausoleum__legend-item',
        children: [
          el('span', { cls: 'parsec-mausoleum__legend-dot', attrs: { style: `background:${color}` } }),
          el('span', { text: label }),
        ],
      }));
    }
    panel.appendChild(legend);

    // Key stats
    const stats = el('div', { cls: 'parsec-mausoleum__stats' });
    stats.appendChild(el('div', {
      children: [
        el('div', { cls: 'parsec-mausoleum__stat-label', text: 'Key Space' }),
        el('div', { cls: 'parsec-mausoleum__stat-value', text: `2^${selectedCipher.keyBits}` }),
      ],
    }));
    stats.appendChild(el('div', {
      children: [
        el('div', { cls: 'parsec-mausoleum__stat-label', text: 'Classical Security' }),
        el('div', { cls: 'parsec-mausoleum__stat-value', text: `2^${selectedCipher.classicalBits}` }),
      ],
    }));
    stats.appendChild(el('div', {
      children: [
        el('div', { cls: 'parsec-mausoleum__stat-label', text: 'Quantum Resistance' }),
        el('div', {
          cls: `parsec-mausoleum__stat-value ${selectedCipher.quantumVulnerable ? 'parsec-mausoleum__stat-value--danger' : ''}`,
          text: selectedCipher.quantumBits > 0 ? `2^${selectedCipher.quantumBits}` : 'NONE (Shor)',
        }),
      ],
    }));
    stats.appendChild(el('div', {
      children: [
        el('div', { cls: 'parsec-mausoleum__stat-label', text: 'Duplication Threshold' }),
        el('div', { cls: 'parsec-mausoleum__stat-value', text: `2^${selectedCipher.collisionBits} samples` }),
      ],
    }));
    panel.appendChild(stats);

    root.appendChild(panel);

    // Render 3D after DOM attachment
    requestAnimationFrame(() => renderCryptoHorizon(canvas, selectedCipher));
  }

  // ── Initialize ─────────────────────────────────────────────

  loadTombState().then(render);
  render();
  return root;
}
