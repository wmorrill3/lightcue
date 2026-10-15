// Fetch a remote audio file for an agent: https only, public IPs only (re-checked on every redirect), size-capped.
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs';

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

async function checkHost(u) {
  if (u.protocol !== 'https:') throw new Error('audio_url must be https');
  if (u.username || u.password) throw new Error('audio_url must not contain credentials');
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((x) => privateIp(x.address))) throw new Error('audio_url host is not public');
}

export async function fetchToFile(url, dest, maxBytes = 40e6) {
  let u = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    await checkHost(u);
    const r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(30e3), headers: { 'user-agent': 'showpack/1.0' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { u = new URL(r.headers.get('location'), u); continue; }
    if (!r.ok) throw new Error(`audio_url returned ${r.status}`);
    const len = Number(r.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error('audio file is larger than 40 MB');
    const out = fs.createWriteStream(dest);
    let n = 0;
    for await (const chunk of r.body) {
      n += chunk.length;
      if (n > maxBytes) { out.destroy(); fs.rmSync(dest, { force: true }); throw new Error('audio file is larger than 40 MB'); }
      if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
    }
    await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    return n;
  }
  throw new Error('too many redirects');
}

export { privateIp };
