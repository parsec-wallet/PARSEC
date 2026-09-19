# PARSEC — `allchainz` Globe, Three.js Architecture

*For PARSEC specifically (the Tauri host shell, not BANKON's clean-house Qt globe).
This explores the Three.js path as the lighter, MIT-licensed, React-native
alternative to the CesiumJS globe, rendering the full multi-chain `allchain`
topology inside PARSEC's React/TypeScript frontend, fed by the canonical Rust
geodesy core over Tauri IPC.*

---

## 1. Why Three.js for PARSEC, and the one tradeoff that defines it

PARSEC is already a Tauri + React/TypeScript + Vite application, so a Three.js
globe is *native to the architecture* in a way CesiumJS is not: it lives inside the
same React tree, shares the same WebGL canvas as any other 3D the host renders,
composes with React state and the Tauri IPC layer directly, and adds only MIT
dependencies on top of an already-loaded renderer. CesiumJS, by contrast, is a
heavyweight self-contained globe with its own asset pipeline; it remains the right
choice when geodetic authority is the priority, but it sits beside React rather than
within it.

The tradeoff that defines the Three.js path is geometric: **three.js globes are a
spherical projection, not a WGS84 ellipsoid.** The `three-globe` package states this
plainly — it represents layers "on a globe, using a spherical projection." Cesium
models the true ellipsoid (the ~21 km equatorial-vs-polar difference); three.js
models a sphere. At globe-view zoom this difference is sub-pixel and invisible, so
the practical consequence is not visual error but a division of labor: **PARSEC's
Three.js globe is the lighter, React-native, spherical view; CesiumJS stays the
scientific WGS84 option** for when ellipsoidal precision must be exact. The Rust
geodesy core (below) is still the source of truth for coordinates, arc sampling, and
distances; the Three.js frontend simply renders them on a sphere.

This also keeps the licence footprint clean against PARSEC's Apache-2.0 posture:
`three` (MIT), `@react-three/fiber` (MIT), `@react-three/drei` (MIT),
`@react-three/postprocessing` (MIT), and Vasco Asturiano's globe family — `three-globe`,
`globe.gl`, `react-globe.gl`, and `r3f-globe` (all MIT) — carry no copyleft.

---

## 2. The library decision: `r3f-globe`, not `react-globe.gl`

There are four packages in this family and choosing correctly is the single most
important architectural decision, because three of them will fight React Three Fiber
and one is built for it.

- **`three-globe`** ([github](https://github.com/vasturiano/three-globe)) — the core: a reusable `ThreeJS` `Object3D` exposing all the data layers (points, arcs, polygons, paths, heatmaps, hex-bins, rings, labels, custom). Imperative, framework-agnostic.
- **`globe.gl`** ([globe.gl](https://globe.gl/)) — a vanilla-JS convenience wrapper that creates and owns its own `WebGLRenderer`, scene, camera, and canvas.
- **`react-globe.gl`** ([github](https://github.com/vasturiano/react-globe.gl)) — a React wrapper around `globe.gl`. It still owns its own canvas and render loop. Dropped into an R3F app it runs a *second*, parallel three.js context that does not compose with R3F's scene, drei controls, or post-processing.
- **`r3f-globe`** ([github](https://github.com/vasturiano/r3f-globe)) — "React-Three-Fiber bindings for the three-globe ThreeJS component." It renders *inside* an existing `<Canvas>` as a normal R3F object, sharing PARSEC's renderer, camera, lights, drei `OrbitControls`, and any `@react-three/postprocessing` effects.

For PARSEC, **`r3f-globe` is the correct choice** (with raw `three-globe` in a custom
R3F component as the fallback if you need to bypass the bindings). It is the only
option that composes with the rest of the React/R3F host instead of standing up a
rival WebGL context. A minimal integration:

```tsx
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import R3fGlobe from 'r3f-globe';

function NetworkGlobe({ nodes, edges }: { nodes: GlobeNode[]; edges: GlobeEdge[] }) {
  return (
    <Canvas camera={{ position: [0, 0, 350], fov: 50 }} dpr={[1, 2]} frameloop="demand">
      <ambientLight intensity={0.6} />
      <directionalLight position={[1, 1, 1]} />
      <Stars radius={300} depth={60} count={6000} factor={4} fade />
      <R3fGlobe
        globeImageUrl="/assets/blue_marble.jpg"   // NASA public domain
        showAtmosphere atmosphereColor="#3a86ff" atmosphereAltitude={0.18}
        pointsData={nodes}
        pointLat="latitude" pointLng="longitude"
        pointColor={(d) => CHAIN_PALETTE[d.chain_id]}
        pointAltitude={(d) => CHAIN_ALTITUDE[d.chain_id]}  // separate per-chain shells
        pointRadius={0.18}
        arcsData={edges}
        arcStartLat="src_lat" arcStartLng="src_lon"
        arcEndLat="dst_lat" arcEndLng="dst_lon"
        arcColor={(d) => EDGE_KIND_COLOR[d.kind]}
        arcDashLength={0.5} arcDashGap={0.3} arcDashAnimateTime={2000}
      />
      <OrbitControls enablePan={false} minDistance={120} maxDistance={600} />
    </Canvas>
  );
}
```

Useful `three-globe` utilities cross the spherical boundary explicitly:
`getCoords(lat, lng, alt) → {x, y, z}` and `toGeoCoords({x, y, z}) → {lat, lng, altitude}`,
plus `getGlobeRadius()` — these are how a custom layer places arbitrary three.js
objects in the globe's coordinate frame.

---

## 3. The architecture seam: Rust geodesy → Tauri IPC → R3F render

The established decision holds: **WGS84 geodesy is canonical in Rust**
(`geographiclib-rs`), and the frontend is a pure renderer. What crosses the Tauri IPC
boundary is precomputed and chain-tagged — the same `GlobeNode` / `GlobeEdge` records
defined for the BANKON `allchainz` work — so the React side never does geodesy, only
binds data to layers.

The transport split matters. Tauri's **event system** is for discrete, low-frequency
signals — "a new snapshot arrived for chain X" — while Tauri's **Channels** are the
ordered, high-throughput path for streaming large or frequent payloads (Tauri's own
docs note the event system "is not designed for low latency or high throughput
situations"). PARSEC therefore emits an event when a chain's adapter produces a fresh
node set, and the React side pulls (or receives over a Channel) the typed array. With
`tauri-specta` generating the TypeScript types from the Rust structs, the IPC contract
is compile-time checked end to end.

On the spherical-vs-ellipsoidal question, the seam is where honesty lives: Rust can
compute *true geodesic* arc samples and distances on the WGS84 ellipsoid, but
three-globe will render arcs as spherical great circles regardless. Two coherent
choices follow. Either accept three-globe's built-in spherical arcs (correct to
sub-pixel at globe zoom, and far simpler), using Rust only for node normalization,
ASN/health enrichment, and distance-based arc-height scaling; or, when you want the
Rust geodesy to be authoritative down to the arc curvature, bypass the arcs layer and
feed precomputed sample points into a **custom layer** (Section 5b). For PARSEC the
first is the default and the second is reserved for cases that demand it — and if the
requirement is genuinely ellipsoidal rendering, that is the signal to switch this view
to the CesiumJS backend rather than fight three.js's sphere.

---

## 4. The React performance trap — and how to beat it

This is the heart of a Three.js-in-React architecture, because R3F's friendly
declarative API hides an imperative, frame-by-frame engine, and the mismatch is where
multi-chain globes die. The failure mode is universal: developers drive per-frame or
per-update changes through React state, and "most R3F performance problems aren't
really R3F problems — they're WebGL fundamentals leaking through a friendly React
API." The rules that keep an `allchainz`-scale globe at 60fps:

**Never call `setState` in the render loop or for per-frame data.** Driving positions
through `useState` "schedules React updates every frame" and is a performance killer;
mutate three.js objects directly through refs instead. High-frequency IPC updates
(live heights, health flips) are written into refs/instanced buffers, not React state.

**Render on demand, not continuously.** Set `<Canvas frameloop="demand">` and call
`invalidate()` only when data actually changes (drei's controls do this automatically
on camera move). A diagnostic globe is mostly static between 10-minute Bitnodes
snapshots; continuous rendering wastes the GPU.

**Instance everything repeated, in a single draw call per chain.** Each distinct mesh
is a draw call and the practical ceiling is "no more than 1000 as the very maximum,
and optimally a few hundred or less"; instancing collapses "hundreds of thousands of
objects in a single draw call." With tens of thousands of nodes across `allchainz`,
non-instanced markers are not an option.

**Update instance matrices imperatively via refs**, using a single reusable
`THREE.Object3D` scratch and flagging `instanceMatrix.needsUpdate = true` after writing
(`setMatrixAt`) — never allocating inside the loop. Allocate the `InstancedMesh` at a
fixed `MAX_INSTANCES` capacity; a known R3F pitfall is that changing an
`InstancedMesh`'s count forces re-creation (and a very high fixed cap is itself
laggy), so size capacity per chain and use `count`/`instanceCountOverride`-style
gating rather than reallocating.

**Reuse geometries and materials, cap `dpr`, dispose on unmount.** Two markers that
share a sphere should share one `BufferGeometry`; `<Canvas dpr={[1, 2]}>` stops Retina
from quietly rendering at 3×; and every geometry/material/texture must be `.dispose()`-d
on unmount to avoid leaks. Test on mid-range hardware, since "your M-series Mac is
lying to you about how the [scene] performs on a five-year-old Windows laptop."

Within `r3f-globe`, the corresponding performance lever is
**`customThreeObjectUpdate((obj, data) => {…})`** — the documented hook for *updating*
an existing custom three.js object with new data "so the objects don't need to be
removed and recreated at each update." This is how an IPC snapshot diff mutates the
globe in place rather than churning the scene graph.

---

## 5. Rendering `allchainz` multi-chain in Three.js

The multi-chain model is identical to the clean-house Qt design — one merged
`GlobeNode` stream tagged by `chain_id` and `role`, plus a `GlobeEdge` stream of
cross-chain bridge/settlement routes — and the Tier-1/2/3 node-source asymmetry
(Bitcoin via Bitnodes; Ethereum via `node-crawler`/ethernodes/nodewatch; most L2s and
app-chains via RPC/sequencer/WaaS-infra endpoints) carries over unchanged. Three.js
gives two rendering strategies.

**5a. Built-in layers (simple, declarative).** Feed one `pointsData` array for all
chains, with `pointColor` and `pointAltitude` as accessor functions keyed on
`chain_id` so each chain is a distinct colour on its own slightly-raised shell, and
one `arcsData` array for cross-chain edges with `arcColor` keyed on `kind`
(SATPAY / XCM / Wormhole / anchor) and dash-animation conveying direction. This is the
fastest path to a working multi-chain globe and is appropriate up to moderate node
counts. Its limit is that the built-in points layer renders each point as its own
small cylinder, so very large Tier-1 sets (Bitcoin's tens of thousands) will pressure
draw calls.

**5b. Custom instanced layers (high performance).** For scale, render each chain as a
single `THREE.InstancedMesh` and let `r3f-globe`'s custom layer host it: return the
per-chain instanced object from `customThreeObject` and mutate it in
`customThreeObjectUpdate` on each snapshot. Equivalently, compose raw R3F
`<instancedMesh>` siblings *alongside* `<R3fGlobe>` inside the same `<Canvas>`, using
`three-globe`'s `getCoords(lat, lng, alt)` to place each instance in the globe's frame
and the globe ref to keep them aligned under rotation. One `InstancedMesh` per chain
keeps each chain independently updatable and colour-batched, and collapses each chain
to one draw call. This is the architecture that holds 60fps across the full `allchain`
union plus animated cross-chain arcs.

The **chain filter and legend are generated from the `allchain` registry**, so toggling
a chain hides its instanced layer and its arcs — also the mechanism for managing
Tier-1 density (isolate Bitcoin's crowd) against Tier-3 sparsity (a handful of sequencer
dots). Per-chain altitude offsets prevent overlapping shells from z-fighting, and
marker brightness or scale encodes `healthy`, turning the globe into the WaaS health
surface rather than a static census.

---

## 6. Atmosphere and aesthetics, the cheap React-native way

`r3f-globe` ships atmosphere built in (`showAtmosphere`, `atmosphereColor`,
`atmosphereAltitude`), which covers the characteristic halo with zero shader work. For
more, because the globe lives inside R3F you get the whole pmndrs ecosystem for free:
glowing arcs via **`@react-three/postprocessing`** `Bloom`, a custom fresnel
`ShaderMaterial` for a richer atmosphere, drei `<Stars>` for the skybox, and a NASA
Blue Marble equirectangular texture passed as `globeImageUrl` (or a fully custom
`globeMaterial`). All MIT or public-domain, all composing in the same canvas — the
payoff of choosing `r3f-globe` over the standalone wrappers.

---

## 7. How it sits inside the PARSEC Tauri shell

The globe is a React component (`<NetworkGlobe>`) in PARSEC's frontend, fed entirely by
the Rust core: the `bitnodes_client` and the per-chain node-source adapters produce
`GlobeNode`/`GlobeEdge` records, the `geographiclib-rs` geodesy normalizes and samples
them, and the result reaches React over Tauri events/Channels with `tauri-specta`
types. Two host concerns apply. The **capabilities ACL** must scope the HTTP plugin to
exactly the data sources (`https://bitnodes.io/*`, the Ethereum crawler/API hosts, the
chain RPC endpoints) and nothing else. The **CSP** in `tauri.conf.json` must permit
WebGL — `img-src` for `blob: data:` textures, `worker-src blob:` if any layer spins up
workers, and `connect-src` for the imagery/data hosts — kept as tight as Tauri's
guidance allows.

The clean delineation from BANKON: **BANKON's globe is clean-house Qt** (native Qt
Quick 3D / QRhi, no web engine) serving the WaaS directly; **PARSEC's globe is
`r3f-globe` inside the Tauri/React host** that envelopes BANKON among many wallets.
They can share the *data layer* — the same `allchain` registry and the same node-source
outputs — but the renderers are deliberately separate, which is what lets each keep its
own dependency and threat surface.

---

## 8. Project structure, dependencies, roadmap, caveats

**Frontend structure (snake_case), within PARSEC's `src/`:**
```
src/
  globe/
    network_globe.tsx        # <Canvas> + <R3fGlobe>, demand frameloop
    chain_instances.tsx      # per-chain InstancedMesh custom layer (5b)
    arc_layer.tsx            # cross-chain edges (built-in or custom)
    globe_palette.ts         # chain_id -> color/altitude; edge kind -> color
    use_globe_feed.ts        # subscribes to Tauri events/Channel, writes refs
  bindings.ts                # tauri-specta generated types (GlobeNode/GlobeEdge)
```
Rust side (`src_tauri/`) is unchanged from the PARSEC guide: `bitnodes_client.rs`,
per-chain `node_source_*.rs` adapters, `geodesy.rs` (`geographiclib-rs`),
`node_model.rs` (merge + snapshot diff), emitting over events/Channels.

**npm dependencies:** [`three`](https://www.npmjs.com/package/three),
[`@react-three/fiber`](https://www.npmjs.com/package/@react-three/fiber),
[`@react-three/drei`](https://www.npmjs.com/package/@react-three/drei),
[`@react-three/postprocessing`](https://www.npmjs.com/package/@react-three/postprocessing),
[`r3f-globe`](https://www.npmjs.com/package/r3f-globe),
[`@tauri-apps/api`](https://www.npmjs.com/package/@tauri-apps/api).

**Roadmap.** (1) Static globe — `<R3fGlobe>` with Blue Marble texture + atmosphere +
OrbitControls, `frameloop="demand"`. (2) Single-chain points from the Rust Bitnodes
feed via the built-in layer (5a), proving the IPC seam. (3) Multi-chain merge — all
`allchain` adapters, per-chain colour/altitude, chain filter from the registry.
(4) Cross-chain arcs with kind-coloured dash animation. (5) Performance pass — convert
dense chains to instanced custom layers (5b), demand rendering, dpr cap, disposal.
(6) Health surface — `health_check` rollup drives legend and marker styling; Bitcoin
Core height as the anchor reference.

**Caveats.** three.js is spherical, not WGS84-ellipsoidal — for true ellipsoidal
rendering use the CesiumJS backend, not this one. `r3f-globe`/`three-globe` are
maintained by a single author (Vasco Asturiano); pin versions and be ready to fall
back to raw `three-globe` in a custom R3F component. R3F performance is entirely a
function of discipline (refs over state, instancing, demand rendering, disposal); the
friendly API will not save an undisciplined implementation. Bitnodes and other
crawlers impose rate limits and only ever see a partial network; IP geolocation is
approximate; and most non-Bitcoin chains have no full node census, so the Tier-3
endpoint/infra model is the truthful unit for them.

---

## Source references

**Three.js / R3F globe libraries (all MIT)**
- r3f-globe (R3F bindings — the recommended choice): <https://github.com/vasturiano/r3f-globe>
- three-globe (core Object3D): <https://github.com/vasturiano/three-globe> · npm: <https://www.npmjs.com/package/three-globe>
- globe.gl (vanilla wrapper): <https://globe.gl/>
- react-globe.gl (standalone React wrapper): <https://github.com/vasturiano/react-globe.gl>
- Three.js: <https://threejs.org/> · InstancedMesh: <https://threejs.org/docs/#api/en/objects/InstancedMesh>

**React Three Fiber performance**
- R3F Scaling Performance (instancing, on-demand `invalidate`): <https://r3f.docs.pmnd.rs/advanced/scaling-performance>
- R3F instancing discussion (#761): <https://github.com/pmndrs/react-three-fiber/discussions/761>
- R3F high-cap InstancedMesh discussion (#416): <https://github.com/pmndrs/react-three-fiber/discussions/416>
- Codrops — R3F Instances: <https://tympanus.net/codrops/2025/07/10/three-js-instances-rendering-multiple-objects-simultaneously/>
- Debugging R3F FPS drops (refs over state, draw calls, disposal): <https://dev.to/alanwest/why-your-react-three-fiber-gallery-drops-to-5-fps-and-how-to-fix-it-4661>
- @react-three/drei: <https://github.com/pmndrs/drei> · @react-three/postprocessing: <https://github.com/pmndrs/react-postprocessing>

**Multi-chain node data (carried from the allchainz model)**
- Bitnodes API: <https://bitnodes.io/api/> · crawler: <https://github.com/ayeowch/bitnodes>
- Ethereum node-crawler: <https://github.com/ethereum/node-crawler> · ethernodes: <https://ethernodes.org/> · NodeWatch: <https://github.com/ChainSafe/nodewatch-api>
- MaxMind GeoLite2: <https://dev.maxmind.com/geoip/geolite2-free-geolocation-data>

**Tauri seam**
- Calling the frontend (events): <https://v2.tauri.app/develop/calling-frontend/>
- State management: <https://v2.tauri.app/develop/state-management/>
- CSP: <https://v2.tauri.app/security/csp/>
- tauri-specta (typed IPC): <https://github.com/specta-rs/tauri-specta>

**Geodesy / imagery**
- geographiclib-rs: <https://github.com/georust/geographiclib-rs>
- NASA Visible Earth (Blue Marble, public domain): <https://visibleearth.nasa.gov/>

*PARSEC, BANKON, the `allchain` registry, and per-chain node-source descriptors are
proprietary to you; this guide supplies the Three.js architecture and you fill in the
registry and WaaS endpoints.*
