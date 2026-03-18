// Parsec Wallet — Matrix Entry Gate
// WebGL matrix rain with red pill / blue pill choice.
// Red pill = live wallet (passphrase required). Blue pill = diagnostics (read-only).
// Matrix wall = safe to walk away. Password never remembered.

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import { keystoreUnlock } from '../lib/keystore';
import { hasVault } from '../lib/crypto';
import { isTauri } from '../lib/vault';

type PillChoice = 'none' | 'red' | 'blue';

export function matrixView(): HTMLElement {
  let choice: PillChoice = 'none';
  let passphrase = '';
  let zoom = 1.0;

  const container = el('div', { cls: 'parsec-matrix' });

  // WebGL canvas for matrix rain
  const canvas = document.createElement('canvas');
  canvas.className = 'parsec-matrix__canvas';
  container.appendChild(canvas);

  // Overlay darkener
  container.appendChild(el('div', { cls: 'parsec-matrix__overlay' }));

  // Content panel
  const panel = el('div', { cls: 'parsec-matrix__panel' });
  container.appendChild(panel);

  // Zoom from scroll/pinch
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.max(0.3, Math.min(3.0, zoom + e.deltaY * -0.002));
    if (gl) setUniform('u_zoom', zoom);
  }, { passive: false });

  // Mouse position for interactive glow
  let mouseX = 0.5, mouseY = 0.5;
  container.addEventListener('mousemove', (e) => {
    mouseX = e.clientX / window.innerWidth;
    mouseY = 1.0 - e.clientY / window.innerHeight;
    if (gl) {
      setUniform('u_mouse', mouseX, mouseY);
    }
  });

  // Touch support
  container.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    mouseX = t.clientX / window.innerWidth;
    mouseY = 1.0 - t.clientY / window.innerHeight;
    if (gl) setUniform('u_mouse', mouseX, mouseY);
  }, { passive: true });

  renderPanel();

  // WebGL setup
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let startTime = performance.now();
  let raf = 0;
  let pillUniform = 0; // 0=none, 1=red, 2=blue

  function setUniform(name: string, ...values: number[]) {
    if (!gl || !program) return;
    const loc = gl.getUniformLocation(program, name);
    if (!loc) return;
    if (values.length === 1) gl.uniform1f(loc, values[0]);
    else if (values.length === 2) gl.uniform2f(loc, values[0], values[1]);
  }

  function initGL() {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return;

    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERT);
    gl.compileShader(vs);

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, FRAG);
    gl.compileShader(fs);

    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.warn('Matrix shader failed:', gl.getShaderInfoLog(fs));
      return;
    }

    program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    // Fullscreen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    resize();
    window.addEventListener('resize', resize);
    startTime = performance.now();
    frame();
  }

  function resize() {
    if (!gl) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
    setUniform('u_resolution', canvas.width, canvas.height);
  }

  function frame() {
    if (!gl || !program) return;
    const t = (performance.now() - startTime) * 0.001;
    setUniform('u_time', t);
    setUniform('u_pill', pillUniform);
    setUniform('u_zoom', zoom);
    setUniform('u_mouse', mouseX, mouseY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(frame);
  }

  function setPill(p: PillChoice) {
    choice = p;
    pillUniform = p === 'red' ? 1.0 : p === 'blue' ? 2.0 : 0.0;
    renderPanel();
  }

  function renderPanel() {
    panel.innerHTML = '';

    // PARSEC branding
    panel.appendChild(el('div', { cls: 'parsec-matrix__brand', text: 'PARSEC' }));

    if (choice === 'none') {
      // Pill selection
      panel.appendChild(el('p', { cls: 'parsec-matrix__tagline', text: 'Choose your path' }));

      const pills = el('div', { cls: 'parsec-matrix__pills' });

      pills.appendChild(el('div', {
        cls: 'parsec-matrix__pill parsec-matrix__pill--red',
        onClick: () => setPill('red'),
        children: [
          el('div', { cls: 'parsec-matrix__pill-capsule' }),
          el('div', { cls: 'parsec-matrix__pill-label', text: 'Red Pill' }),
          el('div', { cls: 'parsec-matrix__pill-desc', text: 'Live wallet access' }),
        ],
      }));

      pills.appendChild(el('div', {
        cls: 'parsec-matrix__pill parsec-matrix__pill--blue',
        onClick: () => setPill('blue'),
        children: [
          el('div', { cls: 'parsec-matrix__pill-capsule' }),
          el('div', { cls: 'parsec-matrix__pill-label', text: 'Blue Pill' }),
          el('div', { cls: 'parsec-matrix__pill-desc', text: 'Diagnostics only' }),
        ],
      }));

      panel.appendChild(pills);
      panel.appendChild(el('p', { cls: 'parsec-matrix__footer-text', text: 'Safe to walk away. No session active.' }));
      return;
    }

    if (choice === 'red') {
      // Red pill — passphrase required for live wallet
      panel.appendChild(el('div', { cls: 'parsec-matrix__choice-label parsec-matrix__choice-label--red', text: 'RED PILL — LIVE WALLET' }));
      panel.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'Sovereign access. Signing authority. Full control.' }));

      const hasAccounts = store.get().accounts.length > 0;
      const hasKeys = isTauri() || hasVault();

      if (hasAccounts && hasKeys) {
        // Returning user — unlock
        const passInput = input({
          type: 'password',
          placeholder: 'Enter passphrase',
          cls: 'parsec-matrix__input',
          onInput: (v) => { passphrase = v; },
          onEnter: () => doUnlock(),
        });
        panel.appendChild(passInput);
        panel.appendChild(btn('Unlock Wallet', {
          intent: 'primary', large: true, cls: 'parsec-matrix__action parsec-matrix__action--red',
          onClick: doUnlock,
        }));

        // Focus the input
        setTimeout(() => passInput.focus(), 100);
      } else {
        // New user — create or import
        panel.appendChild(btn('Create New Wallet', {
          intent: 'primary', large: true, cls: 'parsec-matrix__action parsec-matrix__action--red',
          onClick: () => { cancelAnimation(); store.navigate('create-wallet'); },
        }));
        panel.appendChild(btn('Import Existing Wallet', {
          large: true, outlined: true, cls: 'parsec-matrix__action',
          onClick: () => { cancelAnimation(); store.navigate('import-wallet'); },
        }));
      }

      panel.appendChild(el('div', {
        cls: 'parsec-matrix__back',
        children: [
          el('a', { text: 'Go back', attrs: { href: '#' }, onClick: (e) => { e.preventDefault(); passphrase = ''; setPill('none'); } }),
        ],
      }));
      return;
    }

    if (choice === 'blue') {
      // Blue pill — diagnostics, no wallet control
      panel.appendChild(el('div', { cls: 'parsec-matrix__choice-label parsec-matrix__choice-label--blue', text: 'BLUE PILL — DIAGNOSTICS' }));
      panel.appendChild(el('p', { cls: 'parsec-matrix__lead', text: 'Read-only observation. No signing authority. No wallet control.' }));

      const hasAccounts = store.get().accounts.length > 0;
      if (hasAccounts) {
        panel.appendChild(btn('Enter Diagnostics', {
          large: true, cls: 'parsec-matrix__action parsec-matrix__action--blue',
          onClick: () => {
            cancelAnimation();
            // Set a watch-only session — no passphrase, no signing
            store.setPassphrase(null);
            store.navigate('dashboard');
          },
        }));
        panel.appendChild(el('p', { cls: 'parsec-matrix__note', text: 'View balances and assets. Transactions and signing disabled.' }));
      } else {
        panel.appendChild(el('p', { cls: 'parsec-matrix__note', text: 'No accounts found. Create or import a wallet first.' }));
        panel.appendChild(btn('Import Watch-Only Address', {
          large: true, outlined: true, cls: 'parsec-matrix__action',
          onClick: () => { cancelAnimation(); store.navigate('import-wallet'); },
        }));
      }

      panel.appendChild(el('div', {
        cls: 'parsec-matrix__back',
        children: [
          el('a', { text: 'Go back', attrs: { href: '#' }, onClick: (e) => { e.preventDefault(); setPill('none'); } }),
        ],
      }));
    }
  }

  async function doUnlock() {
    if (!passphrase || passphrase.length < 8) {
      toast('Enter your passphrase', 'danger');
      return;
    }

    store.set({ isLoading: true });
    const ok = await keystoreUnlock(passphrase);
    store.set({ isLoading: false });

    if (ok) {
      store.setPassphrase(passphrase);
      passphrase = ''; // clear immediately
      cancelAnimation();
      store.navigate('dashboard');
    } else {
      toast('Wrong passphrase', 'danger');
      passphrase = '';
    }
  }

  function cancelAnimation() {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
  }

  // Init WebGL after DOM mount
  requestAnimationFrame(() => initGL());

  return container;
}

// ── WebGL Shaders ────────────────────────────────────────────────

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Matrix rain shader — procedural glyphs, no external textures
// Inspired by Shadertoy ldccW4, fully self-contained
const FRAG = `
precision mediump float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_pill;   // 0=none, 1=red, 2=blue
uniform float u_zoom;
uniform vec2 u_mouse;

// Hash for pseudo-random
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Procedural glyph — no texture needed
float glyph(vec2 uv, float seed) {
  // 5x7 dot matrix character
  vec2 cell = floor(uv * vec2(5.0, 7.0));
  if (cell.x < 0.0 || cell.x > 4.0 || cell.y < 0.0 || cell.y > 6.0) return 0.0;
  float id = floor(seed * 64.0);
  float bit = hash(cell + id);
  // Threshold creates glyph-like patterns
  float threshold = 0.38 + 0.12 * sin(seed * 6.28);
  return step(threshold, bit) * step(0.15, fract(uv.x * 5.0)) * step(0.12, fract(uv.y * 7.0));
}

void main() {
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 res = u_resolution;
  float t = u_time;
  float z = u_zoom;

  // Scale by zoom
  float cellSize = 16.0 * z;
  vec2 grid = fragCoord / cellSize;
  vec2 cellId = floor(grid);
  vec2 cellUv = fract(grid);

  // Column properties
  float colSeed = hash(vec2(cellId.x, 0.0));
  float speed = 0.6 + colSeed * 1.8;
  float offset = colSeed * 100.0;

  // Scrolling
  float scroll = t * speed + offset;
  float rowId = cellId.y + floor(scroll);
  float charSeed = hash(vec2(cellId.x, rowId));

  // Rain trail
  float head = fract(scroll);
  float dist = fract(cellId.y / res.y * cellSize + head);
  float trail = smoothstep(0.0, 0.6, dist) * smoothstep(1.0, 0.35, dist);
  float brightness = trail * (0.4 + 0.6 * charSeed);

  // Glyph
  float g = glyph(cellUv, charSeed + floor(t * 3.0 + cellId.x * 0.7) * 0.01);
  brightness *= g;

  // Head glow (leading character)
  float headGlow = smoothstep(0.04, 0.0, abs(dist - 0.98)) * 2.0;

  // Base color — green matrix
  vec3 col = vec3(0.1, 1.0, 0.35) * brightness;
  col += vec3(0.7, 1.0, 0.8) * headGlow * g;

  // Pill tinting
  if (u_pill > 0.5 && u_pill < 1.5) {
    // Red pill — warm tint
    col = mix(col, vec3(1.0, 0.3, 0.15) * brightness + vec3(1.0, 0.6, 0.4) * headGlow * g, 0.55);
  } else if (u_pill > 1.5) {
    // Blue pill — cool tint
    col = mix(col, vec3(0.15, 0.5, 1.0) * brightness + vec3(0.4, 0.7, 1.0) * headGlow * g, 0.55);
  }

  // Mouse proximity glow
  vec2 mousePos = u_mouse * res;
  float mouseDist = length(fragCoord - mousePos) / max(res.x, res.y);
  float mouseGlow = smoothstep(0.25, 0.0, mouseDist) * 0.15;
  if (u_pill > 0.5 && u_pill < 1.5) {
    col += vec3(1.0, 0.2, 0.1) * mouseGlow;
  } else if (u_pill > 1.5) {
    col += vec3(0.1, 0.4, 1.0) * mouseGlow;
  } else {
    col += vec3(0.1, 0.8, 0.3) * mouseGlow;
  }

  // Vignette
  vec2 uv = fragCoord / res;
  float vig = 1.0 - 0.4 * length(uv - 0.5);
  col *= vig;

  // Scanlines
  col *= 0.92 + 0.08 * sin(fragCoord.y * 2.5);

  gl_FragColor = vec4(col, 1.0);
}
`;
