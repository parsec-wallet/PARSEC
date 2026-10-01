#!/usr/bin/env python3
# Snapshot toon.ar.io — the TOON Protocol's own published docs, served from Arweave over ArNS —
# into docs/reference/permaweb/toon-ar-io/.
# Companion to sync-ario-docs.py; kept separate because the source is one hand-written page
# (with <details> panels carrying the operator guide, the RFC delta table, two ADRs and the
# revision-1 receipts) rather than a docs generator.
# Usage: python3 scripts/sync-toon-docs.py   (run from anywhere; writes into the repo).
import re, html, subprocess, os, datetime, tempfile

PAGES = [("toon-protocol", "https://toon.ar.io/")]

# The <details> appendices embed whole markdown files (README, ADRs) that carry their own ```
# fences, so the snapshot wraps them in a longer fence.
FENCE = "``````"

# ar.io response headers worth keeping: they are the provenance of the snapshot (which ArNS name,
# which Arweave data item, which ANT) and the reason this page belongs in the permaweb corpus.
PROVENANCE_HEADERS = [
    "x-arns-name", "x-arns-resolved-id", "x-arns-ant-id", "x-arns-ant-program-id",
    "x-arns-ttl-seconds", "x-ar-io-data-id", "x-ar-io-digest", "x-ar-io-trusted",
]


def to_md(s):
    m = re.search(r'<main[^>]*>(.*?)</main>', s, re.S) or re.search(r'<body[^>]*>(.*?)</body>', s, re.S)
    t = m.group(1) if m else s
    t = re.sub(r'<(script|style|svg|nav|button)[^>]*>.*?</\1>', '', t, flags=re.S)
    # <details> panels: summary becomes a heading, the <pre> body a fenced block.
    t = re.sub(r'<summary[^>]*>(.*?)</summary>', lambda m: '\n\n### ' + m.group(1) + '\n', t, flags=re.S)
    t = re.sub(r'</?details[^>]*>', '\n', t)
    t = re.sub(r'<pre[^>]*>(.*?)</pre>',
               lambda m: f'\n{FENCE}\n' + html.unescape(re.sub(r'<[^>]+>', '', m.group(1))).strip('\n') + f'\n{FENCE}\n',
               t, flags=re.S)
    # A table row is one line, not one line per cell.
    t = re.sub(r'<tr[^>]*>(.*?)</tr>',
               lambda m: '\n| ' + ' | '.join(
                   c.strip() for c in re.findall(r'<(?:td|th)[^>]*>(.*?)</(?:td|th)>', m.group(1), re.S)) + ' |',
               t, flags=re.S)
    t = re.sub(r'<h([1-6])[^>]*>', lambda m: '\n' + '#' * int(m.group(1)) + ' ', t)
    t = re.sub(r'</h[1-6]>', '\n', t)
    t = re.sub(r'<hr[^>]*>', '\n\n---\n\n', t)
    t = re.sub(r'<li[^>]*>', '\n- ', t)
    t = re.sub(r'</?(p|div|section|header|footer|tr|br|table|tbody|thead|ul|ol)[^>]*>', '\n', t)
    t = re.sub(r'<code[^>]*>(.*?)</code>', r'`\1`', t, flags=re.S)
    t = re.sub(r'<(strong|b)[^>]*>(.*?)</\1>', r'**\2**', t, flags=re.S)
    t = re.sub(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>',
               lambda m: f'[{m.group(2)}]({m.group(1)})' if m.group(1).startswith('http') else m.group(2),
               t, flags=re.S)
    t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t)
    t = re.sub(r'[ \t]+\n', '\n', t)
    t = re.sub(r'\n\s*\n+', '\n\n', t)
    return t.strip()


def fenced_spans(md):
    """Line ranges inside the snapshot's own fences — verbatim upstream, never reflowed.
    Only the long FENCE toggles: the appendices contain ``` fences of their own."""
    inside, spans = False, set()
    for i, line in enumerate(md.split('\n')):
        if line.rstrip() == FENCE:
            inside = not inside
        elif inside:
            spans.add(i)
    return spans


def knit_tables(md):
    """Rows arrive one per line with blank lines between them; close the gaps and give each run
    the header separator a markdown table needs. Fenced appendices are left untouched."""
    code = fenced_spans(md)
    lines = md.split('\n')
    out, i = [], 0
    while i < len(lines):
        if i in code or not lines[i].startswith('|'):
            out.append(lines[i]); i += 1; continue
        run = []
        while i < len(lines) and i not in code and (lines[i].startswith('|') or not lines[i].strip()):
            if lines[i].startswith('|'):
                run.append(lines[i])
            elif run and not (i + 1 < len(lines) and lines[i + 1].startswith('|')):
                break
            i += 1
        out.append(run[0])
        out.append('|' + '---|' * max(1, run[0].count('|') - 1))
        out.extend(run[1:])
        out.append('')
    return '\n'.join(out)


def squeeze_prose(md):
    """Collapse the run-on spacing the tag stripper leaves in prose, leaving code fences alone."""
    code = fenced_spans(md)
    out = []
    for i, line in enumerate(md.split('\n')):
        out.append(line if i in code else re.sub(r'[ \t]{2,}', ' ', line).rstrip())
    return '\n'.join(out)


out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "docs/reference/permaweb/toon-ar-io")
os.makedirs(out, exist_ok=True)
today = datetime.date.today().isoformat()
ok = []
with tempfile.TemporaryDirectory() as tmp:
    for name, url in PAGES:
        raw = os.path.join(tmp, f"{name}.html")
        hdr = os.path.join(tmp, f"{name}.headers")
        r = subprocess.run(["curl", "-sL", "-m", "40", "-A", "Mozilla/5.0",
                            "-D", hdr, "-o", raw, "-w", "%{http_code}", url],
                           capture_output=True, text=True)
        code = r.stdout.strip()[-3:]
        if code != "200":
            print("skip", url, code)
            continue
        headers = {}
        for line in open(hdr, encoding="utf-8", errors="ignore"):
            if ":" in line:
                k, _, v = line.partition(":")
                headers[k.strip().lower()] = v.strip()
        md = knit_tables(squeeze_prose(to_md(open(raw, encoding="utf-8", errors="ignore").read())))
        if len(md) < 800:
            print("thin", url, len(md))
            continue
        prov = "\n".join(f"       {h}: {headers[h]}" for h in PROVENANCE_HEADERS if h in headers)
        head = (
            f"<!-- Source: {url} — fetched {today} by `scripts/sync-toon-docs.py`.\n"
            f"     Text extraction of the live page; the URL is canonical. The page is served from\n"
            f"     Arweave through the ar.io gateway network under the ArNS name `toon`:\n"
            f"{prov}\n"
            f"     Upstream licence: MIT for the connector code, CC BY-SA 4.0 for the docs and RFCs\n"
            f"     (github.com/toon-protocol/connector). The quoted operator guide, ADRs and RFC\n"
            f"     delta table below are that CC BY-SA 4.0 material, reproduced with attribution and\n"
            f"     redistributed under the same licence — NOT under the PARSEC/BANKON licence. -->\n"
        )
        open(f"{out}/{name}.md", "w").write(head + "\n" + md + "\n")
        ok.append((name, url, len(md)))
        print("saved", name, len(md))

idx = ("# toon.ar.io snapshot\n\n"
       "The TOON Protocol's own published documentation, fetched " + today + ". Canonical: the URL.\n"
       "Re-run `python3 scripts/sync-toon-docs.py` to refresh.\n\n"
       "Why it is in the permaweb corpus and not only in `docs/integration/`: the page is itself an\n"
       "ar.io artefact — an Arweave-stored site under the ArNS name `toon`, paid for through the very\n"
       "connector it documents, with the ANT lease and the per-hop receipts published on the page.\n"
       "It is the clearest worked example we have of paid permaweb writes end to end.\n\n"
       "Licence: MIT (connector code) / **CC BY-SA 4.0** (docs, ADRs, RFCs). The snapshot reproduces\n"
       "CC BY-SA 4.0 material with attribution and stays under that licence — see the header comment\n"
       "in the file. Do not fold it into PARSEC-licensed docs; link to it instead.\n\n"
       "| File | Source | chars |\n|---|---|---|\n"
       + "".join(f"| `{n}.md` | {u} | {l} |\n" for n, u, l in ok)
       + "\nRelated: [`../../integration/toon-connector.md`](../../integration/toon-connector.md) — the\n"
         "PARSEC-side review and integration plan (payer-only, `enabled: false` while upstream is testnet).\n")
open(f"{out}/README.md", "w").write(idx)
