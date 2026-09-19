#!/usr/bin/env python3
# Snapshot the docs.ar.io pages the permaweb module relies on into docs/reference/permaweb/docs-ar-io/.
# Usage: python3 scripts/sync-ario-docs.py   (run from anywhere; writes into the repo).
import re,html,subprocess,sys,os,datetime
PAGES = [
 ("what-is-ario","https://docs.ar.io/learn/what-is-ario/"),
 ("token","https://docs.ar.io/learn/token/"),
 ("token-get-the-token","https://docs.ar.io/learn/token/get-the-token/"),
 ("oip-staking","https://docs.ar.io/learn/oip/staking/"),
 ("gateway-registry","https://docs.ar.io/learn/gateways/gateway-registry/"),
 ("solana-developers","https://docs.ar.io/learn/solana-developers/"),
 ("run-a-gateway-quick-start","https://docs.ar.io/build/run-a-gateway/quick-start/"),
 ("run-a-gateway-join-the-network","https://docs.ar.io/build/run-a-gateway/join-the-network/"),
 ("run-a-gateway-solana-migration","https://docs.ar.io/build/run-a-gateway/manage/solana-migration/"),
 ("gateways-x402-payments","https://docs.ar.io/learn/gateways/x402-payments/"),
 ("sdk-gateways","https://docs.ar.io/sdks/ar-io-sdk/gateways/"),
]
def to_md(s):
    m=re.search(r'<main[^>]*>(.*?)</main>',s,re.S) or re.search(r'<article[^>]*>(.*?)</article>',s,re.S) or re.search(r'<body[^>]*>(.*?)</body>',s,re.S)
    t=m.group(1) if m else s
    t=re.sub(r'<(script|style|nav|svg|button|aside)[^>]*>.*?</\1>','',t,flags=re.S)
    t=re.sub(r'<pre[^>]*>(.*?)</pre>',lambda m:'\n```\n'+re.sub(r'<[^>]+>','',m.group(1))+'\n```\n',t,flags=re.S)
    t=re.sub(r'<h([1-6])[^>]*>',lambda m:'\n'+'#'*int(m.group(1))+' ',t); t=re.sub(r'</h[1-6]>','\n',t)
    t=re.sub(r'<li[^>]*>','\n- ',t); t=re.sub(r'<(td|th)[^>]*>',' | ',t); t=re.sub(r'</?(p|div|section|tr|br|table|tbody|thead|ul|ol)[^>]*>','\n',t)
    t=re.sub(r'<code[^>]*>(.*?)</code>',r'`\1`',t,flags=re.S)
    t=re.sub(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>',lambda m:f'{m.group(2)} ({m.group(1)})' if m.group(1).startswith('http') else m.group(2),t,flags=re.S)
    t=re.sub(r'<[^>]+>','',t); t=html.unescape(t)
    t=re.sub(r'\n\s*\n+','\n\n',t); t=re.sub(r'[ \t]+',' ',t).strip()
    return t
out=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),"docs/reference/permaweb/docs-ar-io")
os.makedirs(out,exist_ok=True)
today=datetime.date.today().isoformat()
ok=[]
for name,url in PAGES:
    r=subprocess.run(["curl","-sL","-m","30","-A","Mozilla/5.0","-w","%{http_code}","-o",f"{name}.html",url],capture_output=True,text=True)
    code=r.stdout.strip()[-3:]
    if code!="200": print("skip",url,code); continue
    md=to_md(open(f"{name}.html",encoding="utf-8",errors="ignore").read())
    if len(md)<800: print("thin",url,len(md)); continue
    open(f"{out}/{name}.md","w").write(f"<!-- Source: {url} — fetched {today} by parsec permaweb module docs sync. Text extraction of the live page; see the URL for the canonical version. -->\n\n"+md+"\n")
    ok.append((name,url,len(md))); print("saved",name,len(md))
idx="# docs.ar.io snapshots\n\nText snapshots of the ar.io documentation pages the permaweb module relies on, fetched "+today+". Canonical: the URLs. Re-run `python3 scripts/sync-ario-docs.py` to refresh.\n\n| File | Source | chars |\n|---|---|---|\n"+"".join(f"| `{n}.md` | {u} | {l} |\n" for n,u,l in ok)
open(f"{out}/README.md","w").write(idx)
