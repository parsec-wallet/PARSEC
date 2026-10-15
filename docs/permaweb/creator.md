# creator.agent — the permanent page creator

> Route `permaweb-create` · view `src/views/permaweb-create.ts` · pure core `src/lib/creator/`.
> Opened from the Permaweb Desk (**Create a permanent page**) or from a name's controller
> (**Create or edit the page** next to *Upload a file or site*, and **Create a page for this
> extension** in the extensions form). Written 2026-10-14.

ar.io's console has a page builder (console.ar.io/pages). Its fields are right; its delivery is
not: an account to sign in to, a separately linked Solana wallet, credits, and nothing filled in
for you. creator.agent keeps the fields and changes the delivery: the wallet already holds the key
that owns the name, already knows the name's identity and extensions, and already uploads to
Turbo and points names. So the page is built where the keys are, filled in from what PARSEC
knows, and released in three steps.

## ① LOAD · ② ARM · ③ DEPLOY

| Step | What the person does | What PARSEC does |
|---|---|---|
| **① LOAD** | Names the address (an ArNS name, optionally an extension), then starts from the page there now, a template, or blank — or loads any page by name, `name_ext`, `ar://…`, gateway link or Target ID | Reads the record (target, extensions, owner), the ANT identity, the page at the target; imports it; autofills every empty field |
| **② ARM** | Edits — every field open — with a live preview and one-click suggestions | Renders the exact files, plans the exact signed sizes, prices them (free when every item ≤ the live Turbo free limit), and states: release type, price, signing key, what the name will point at, and *public and permanent* |
| **③ DEPLOY** | Confirms **3 · 2 · 1** — permanent; price and key; what the name points at — each a click or Enter, then **Sign and deploy** on the offer sheet (✕ leaves cleanly) | Uploads the page as a site (manifest + files) through Turbo, points the name (`setRootRecord`) or extension (`setUndername`), verifies the bytes on the gateways and probes the name |

No step fires on a timer. The offer sheet (`lib/ui/offer.ts`) is the price moment: *PRICE · Buy ·
✕*. A retry after a failed point does not upload again.

**Forever.** The new Target ID is permanent. The previous version stays permanent. Rollback is
pointing the name back at an earlier id — listed under *Versions* — through the same offer sheet.

### Release types

| Type | When |
|---|---|
| **Launch** | The first release to an address that serves nothing of ours: nothing at all, ar.io's placeholder (`T9_V2HfiAq5qlLzObfyayj2-cjPujxpg25TRi4OZbe4`), or a page not made here. Starts at version 1 |
| **Deploy** | A new version of a PARSEC page already served there. Version = served version + 1; the served id joins the head of `previous` |

### Signatures, honestly

Upload items are approved in one PARSEC Keycore dialog; the manifest (whose content depends on the
item ids) is signed after them; pointing the name is one more signed record change with the key
that owns it. On the desktop the Solana key that owns the name pays (its own free allowance and
Turbo credits, ANS-104 type 4); without one, the Arweave key signs. The browser build signs with
the vault key and zeroes it after, as every web-build Arweave write does.

## The document

`PageDoc` (`lib/creator/model.ts`, schema `parsec-page/1`) mirrors ar.io Pages' fields:

- **Profile** — avatar (generated sigil · your PNG/JPG/WebP resized to ≤ 512 px and encoded WebP ·
  `ar://` or https image · initials), display name, tagline (*what you do, in a line*), short intro.
- **Blocks** — link (label, URL or `ar://`, optional emoji icon), heading, text, image (src + alt),
  embed, divider, social row, button, verify badge.
- **Theme** — eight templates (Minimal, Midnight, Aurora, Paper, Terminal, Classic-era internet,
  Modern web, Professional), font (system stacks only), accent and text colour (6-digit hex),
  background solid/gradient, button shape pill/rounded/square, header align, width standard/wide.
- **Page settings** — page title, SEO title, SEO/social description, favicon emoji, social image
  (generated card · none · your image), custom Arweave tags, private labels (kept on this device
  under `parsec:creator-labels:<pageId>`, never uploaded), version note.
- **Address and versions** — name + extension, `pageId` (stable across versions), `version`,
  `previous` (earlier Target IDs, newest first, capped at 32).

## What gets uploaded

`renderPage` (`lib/creator/render.ts`) is pure and deterministic:

- **`index.html`** — self-contained: inline `<style>` (allowed in the generated page; the app's own
  CSP is untouched), system font stacks, no external script, font or stylesheet. The favicon is the
  emoji in an SVG data URI; og/twitter meta point at the card by relative path. The document rides
  along as `<script type="application/json" id="parsec-page">` (`<` `>` `&` escaped) so the page
  re-imports exactly. One ~300-byte inline script repoints `ar://` links at whichever gateway
  serves the page; without it they open on ar.io.
- **`avatar.svg`** / **`avatar.webp`** — the generated sigil, or the person's resized image.
- **`card.svg`** (+ **`card.png`** when the WebView can rasterize it and the PNG is free) — the
  1200×630 social card. Social sites do not read SVG, which is why the PNG is attempted.
- **Tags** on `index.html`: `Content-Type`, `App-Name` (PARSEC's on-chain value, unchanged),
  `Page-Id`, `Page-Title`, `Page-Template`, `Page-Version`, `Render-With: parsec-creator`, then the
  person's own tags (PARSEC's names are reserved). `planUpload` takes them per file through the new
  optional `UploadFile.tags`; Content-Type and App-Name stay PARSEC's.

A typical page is a few kilobytes per item, far under the 107,520-byte free limit (tested).

## Autofill (`lib/creator/autofill.ts`)

Fills only empty fields, never a field the person has typed in (even emptied), never invents. Each
filled field is marked in the editor (*filled from the name's identity* and so on).

| Field | Source |
|---|---|
| Display name | ANT nickname, else the name |
| Page title | ANT nickname, else the NAME in capitals |
| Tagline | ANT description |
| SEO description | the tagline |
| Favicon | the template's emoji |
| Avatar | `ar://<ANT logo>` when it resolves on a gateway; else the generated sigil |
| Social image | the generated card |
| Link blocks | one per extension → `https://<ext>_<name>.ar.io` (root pages only) |
| Receive links | one per chain address (Bitcoin, Ethereum/Base, Solana, Algorand, Litecoin) — **off by default** |
| Everything else | the page found at the target, when one is loaded |

The ANT identity comes from `NamespaceAdapter.getIdentity`; the Solana-era adapter now implements
it read-only (`getAntIdentity` → `ANT.getInfo()`), without `setIdentity`, so the name controller's
identity editor stays hidden as before.

## Importing (`lib/creator/importer.ts`)

1. **A PARSEC page** — the embedded JSON loads exactly (validated by `normalizeDoc`: every string
   clamped, every enum and colour checked); an uploaded avatar's relative path is resolved to its id
   in the old manifest.
2. **An ar.io Pages page** — any JSON blob in the page with a `blocks` array is mapped field by
   field. Their exact format is not published, so this is best effort; it falls back to 3.
3. **Anything else** — extracted: title, meta description, og:image, favicon emoji, first h1 →
   display name, first paragraph → tagline, every link → a link block, h2/h3 → headings, img →
   images. Relative links resolve through the site's manifest when there is one.

The app parses with `DOMParser` (inert: no scripts run, nothing loads); tests and DOM-less
environments use the regex reader `simplifyHtml`, which produces the same `SimplePage`.

## Auto edit suggestions (`lib/creator/suggest.ts`)

Deterministic and explainable — one line, why, and **Apply**:

| Rule | Fires when | Apply |
|---|---|---|
| `launch` | the address serves nothing of ours | arms the Launch (goes to ③) |
| `name-missing` | no display name | the name |
| `title-missing` / `title-long` | no title / over 60 characters | display name / an SEO title cut at a word |
| `desc-missing` / `desc-long` | no description / over 160 | tagline, intro's first sentence, or "a permanent page at ar://name" / cut at a word |
| `og-missing` | no social image | the generated card |
| `avatar-missing` | initials only | the generated sigil |
| `favicon-missing` | no favicon | the template's emoji |
| `alt-missing` | an image without alt text | a plain description |
| `http-links` | `http://` links | `https://` |
| `ar-links` | a link pinned to one gateway (`arweave.net/<id>`, a gateway subdomain) or to a host with a known ar:// mirror | the `ar://` form. `<name>.ar.io` links are ArNS's canonical form and are left alone |
| `duplicate-links` | the same URL twice | keeps the first |
| `empty-blocks` | blocks with nothing in them | removes them |
| `low-contrast` | text vs background < 4.5:1 (WCAG AA; a gradient is judged at both ends) | the template's text colour, else black/white |
| `accent-contrast` | accent vs background < 3:1 | the template's accent, else black/white |
| `over-free` | an item over the live free limit | recompresses the avatar (256 px, WebP q 0.6) |

## iNFT — prepare only

After a deploy: **Prepare iNFT** builds ERC-721 metadata — `name`, `description`,
`image: ar://<card or avatar id>`, `external_url: https://<name>.ar.io`, `animation_url` and
`storageURI: ar://<Target ID>`, attributes (page title, version, template, address). Copy it, or
upload it as `metadata.json` (free, tiny). **The mint button is disabled**: *The iNFT contract is
not deployed yet — its audit is open (DeltaVerse/deploy/iNFT4/audit.json: cleared false). The mint
will be the OVERLORD's signature.* No contract is called.

## The preview and the CSP

The app's CSP (`default-src 'self'`, `img-src 'self' data:`) allows no `blob:` frames and no remote
images, so the preview is DOM inside the view, themed through `--cp-*` custom properties set with
the CSSOM (never a `style` attribute). Arweave images are fetched from the gateways `connect-src`
already allows and shown as `data:` URIs; other remote images show as placeholders. Links do not
navigate from the preview.

## Tests

`src/lib/creator/__tests__/creator.test.ts` (node environment, no DOM library): model defaults,
templates, versioning and release type, `normalizeDoc` on hostile input; autofill fills, marks and
never overwrites; autogen is deterministic, well-formed and small; WCAG contrast reference values;
render tags, the JSON round trip through the importer, no external URLs beyond the person's own,
hostile text; the importer's regex path on a sample page and a page-builder JSON blob; every
suggestion fires and its apply clears it; iNFT metadata shape; a typical page plans free. Plus one
`planUpload` test for per-file tags in `arweave/__tests__/turbo.test.ts`.
