#!/usr/bin/env node
/*!
 * EGIC · Edge Agent — connects on-site cameras to an online EGIC server (Railway)
 * POWERED BY DELMON & DEV SMART X
 *
 * Runs on any PC (or Raspberry Pi) inside the factory network. It asks the online server which cameras are needed,
 * reads them on the local network (RTSP via ffmpeg · MJPEG · JPEG snapshot, Basic/Digest auth) and pushes JPEG frames
 * to the server over HTTPS. Only outgoing connections — no port forwarding, works behind any router / CGNAT.
 * A camera only streams while someone is watching it on the platform.
 *
 *   node edge-agent.js --server https://your-app.up.railway.app --key <agent key>
 *   (or EGIC_SERVER / EGIC_AGENT_KEY environment variables)
 *
 * Needs Node.js 18+. RTSP cameras need ffmpeg: ffmpeg.exe next to this file, on PATH, or FFMPEG_PATH.
 * The same file is the camera reader used by the EGIC server itself (require('./edge-agent.js')).
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const VERSION = '1.0.1';
const SOI = Buffer.from([0xff, 0xd8]), EOI = Buffer.from([0xff, 0xd9]);

/* ------------------------------------------------------------------ */
/* Camera reader                                                         */
/* ------------------------------------------------------------------ */
function findFfmpeg(dirs) {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  for (const d of dirs) for (const n of ['ffmpeg.exe', 'ffmpeg']) { const p = path.join(d, n); if (fs.existsSync(p)) return p; }
  return 'ffmpeg';
}
function protoOf(u) { const s = (/^(\w+):/.exec(u) || [])[1]; return s ? s.toLowerCase() : ''; }
function maskUrl(u) { return String(u).replace(/(\/\/[^:@/]*):[^@/]*@/, '$1:****@'); }

// Readable error for the people who wire the cameras
function errAr(msg) {
  const m = String(msg || '');
  if (/ENOENT/.test(m)) return 'ffmpeg غير مثبت — مطلوب لكاميرات RTSP (حط ffmpeg.exe جنب البرنامج أو على الـ PATH)';
  if (/401|Unauthorized|authorization failed/i.test(m)) return 'اسم المستخدم أو كلمة المرور غلط (401)';
  if (/403|Forbidden/i.test(m)) return 'الكاميرا رفضت الطلب (403) — راجع صلاحيات المستخدم';
  if (/404|Not Found/i.test(m)) return 'مسار البث غلط (404) — راجع رابط القناة';
  if (/ECONNREFUSED|refused/i.test(m)) return 'الكاميرا رفضت الاتصال — تأكد من الـ IP ورقم البورت';
  if (/ETIMEDOUT|timed? ?out|EHOSTUNREACH|ENETUNREACH/i.test(m)) return 'مفيش رد من الكاميرا — مش ظاهرة على الشبكة (راجع الـ IP)';
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return 'اسم الجهاز (Host) مش معروف';
  return m.slice(0, 240);
}

function jpegSplitter(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      const s = buf.indexOf(SOI);
      if (s < 0) { buf = buf.subarray(Math.max(0, buf.length - 1)); return; }
      const e = buf.indexOf(EOI, s + 2);
      if (e < 0) { if (s > 0) buf = buf.subarray(s); if (buf.length > 12 * 1024 * 1024) buf = Buffer.alloc(0); return; }
      onFrame(Buffer.from(buf.subarray(s, e + 2)));
      buf = buf.subarray(e + 2);
    }
  };
}

function digestAuth(challenge, user, pass, method, uri) {
  const p = {};
  challenge.replace(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g, (_, k, a, b) => { p[k.toLowerCase()] = a !== undefined ? a : b; return ''; });
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const qops = String(p.qop || '').split(',').map((s) => s.trim()).filter(Boolean);
  const qop = qops.length ? (qops.includes('auth') ? 'auth' : qops[0]) : null;
  const nc = '00000001', cnonce = crypto.randomBytes(8).toString('hex');
  const ha1 = md5(user + ':' + p.realm + ':' + pass), ha2 = md5(method + ':' + uri);
  const response = qop ? md5([ha1, p.nonce, nc, cnonce, qop, ha2].join(':')) : md5(ha1 + ':' + p.nonce + ':' + ha2);
  let h = 'Digest username="' + user + '", realm="' + p.realm + '", nonce="' + p.nonce + '", uri="' + uri + '", response="' + response + '"';
  if (p.opaque) h += ', opaque="' + p.opaque + '"';
  if (p.algorithm) h += ', algorithm=' + p.algorithm;
  if (qop) h += ', qop=' + qop + ', nc=' + nc + ', cnonce="' + cnonce + '"';
  return h;
}
// GET with Basic auth from the URL, retried once with Digest when the camera asks for it (Hikvision / Dahua)
function httpOpen(u, ctx, onRes, onErr, auth) {
  let x;
  try { x = new URL(u); } catch (e) { return onErr(new Error('رابط غير صالح')); }
  const user = decodeURIComponent(x.username), pass = decodeURIComponent(x.password), uri = x.pathname + x.search;
  const headers = { 'User-Agent': 'EGIC-Platform/1.0', Accept: '*/*' };
  if (auth) headers.Authorization = auth;
  else if (user) headers.Authorization = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
  const req = (x.protocol === 'https:' ? https : http).request({ method: 'GET', hostname: x.hostname, port: x.port || undefined, path: uri, headers, rejectUnauthorized: false, timeout: 10000 }, (res) => {
    const wa = String(res.headers['www-authenticate'] || '');
    if (res.statusCode === 401 && user && !auth && /^digest/i.test(wa)) { res.resume(); return httpOpen(u, ctx, onRes, onErr, digestAuth(wa, user, pass, 'GET', uri)); }
    onRes(res);
  });
  req.on('timeout', () => req.destroy(new Error('ETIMEDOUT')));
  req.on('error', onErr);
  req.end();
  ctx.req = req;
}

/**
 * Read a camera as a sequence of JPEG frames.
 * opts: { fps, width, ffmpeg, onFrame(buf), onError(rawMessage), onKind(kind) } → { stop(), kind }
 * onError fires once; the reader is dead afterwards (callers decide whether to retry).
 */
function createReader(url, opts) {
  const r = { stopped: false, kind: null, proc: null, ctx: null, pollT: null };
  const fps = opts.fps || 10, width = opts.width || 1280;
  const frame = (b) => { if (!r.stopped) opts.onFrame(b); };
  const fail = (m) => { if (r.stopped) return; r.stop(); opts.onError(m); };
  const kind = (k) => { r.kind = k; if (opts.onKind) opts.onKind(k); };
  r.stop = () => {
    r.stopped = true; clearTimeout(r.pollT); clearTimeout(switchT);
    if (r.proc) { try { r.proc.kill('SIGKILL'); } catch (e) { } r.proc = null; }
    if (r.ctx && r.ctx.req) { try { r.ctx.req.destroy(); } catch (e) { } }
  };
  // RTSP: try TCP first; many cheap cameras only answer over UDP (VLC falls back silently) → switch if no frame in 7 s
  let transport = 'tcp', gotFrame = false, switchT = null;
  function viaFfmpeg() {
    kind('ffmpeg');
    const isRtsp = /^rtsps?:/i.test(url);
    const args = ['-hide_banner', '-loglevel', 'error', '-fflags', 'nobuffer', '-flags', 'low_delay'];
    if (isRtsp) args.push('-rtsp_transport', transport);
    // optional image enhancement before scaling — denoise + exposure/contrast + sharpen, so the picture (and the AI) see a cleaner image
    var vf = 'fps=' + fps + ",scale='min(" + width + ",iw)':-2";
    // model-friendly default: denoise + mild exposure/contrast only. Heavy sharpen/saturation pushes the image off the model's
    // training distribution and MEASURABLY lowers detection count + confidence, so it is deliberately avoided. Best for dark/noisy scenes.
    if (opts.enhance) vf += ',' + (typeof opts.enhance === 'string' ? opts.enhance : 'hqdn3d=2:1.5:3:3,eq=contrast=1.12:brightness=0.04:gamma=1.04');
    args.push('-i', url, '-an', '-vf', vf, '-q:v', '3', '-f', 'mjpeg', 'pipe:1');
    let proc, stderr = '';
    try { proc = spawn(opts.ffmpeg || 'ffmpeg', args, { windowsHide: true }); } catch (e) { return fail(e.code || e.message); }
    r.proc = proc;
    if (isRtsp && transport === 'tcp') {
      clearTimeout(switchT);
      switchT = setTimeout(() => {
        if (gotFrame || r.stopped || r.proc !== proc) return;
        transport = 'udp'; r.proc = null; proc.removeAllListeners('exit'); try { proc.kill('SIGKILL'); } catch (e) { }
        viaFfmpeg();
      }, 7000);
    }
    const split = jpegSplitter((b) => { gotFrame = true; frame(b); });
    proc.stdout.on('data', (d) => split(d));
    proc.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-600); });
    proc.on('error', (e) => fail(e.code === 'ENOENT' ? 'ENOENT' : e.message));
    proc.on('exit', (code) => {
      if (r.proc !== proc) return;
      // TCP refused by the camera → retry once over UDP before giving up
      if (isRtsp && transport === 'tcp' && !gotFrame && !r.stopped) { clearTimeout(switchT); transport = 'udp'; r.proc = null; return viaFfmpeg(); }
      fail(stderr.trim().split('\n').pop() || ('ffmpeg exit ' + code));
    });
  }
  function snapshot(res, t0) {
    const chunks = [];
    res.on('data', (d) => chunks.push(d));
    res.on('error', (e) => fail(e.message));
    res.on('end', () => {
      if (r.stopped) return;
      const buf = Buffer.concat(chunks);
      if (buf[0] !== 0xff || buf[1] !== 0xd8) return fail('الصورة من الكاميرا مش JPEG');
      frame(buf);
      // poll the snapshot URL again (≈ 4 fps, slower if the camera is slow)
      r.pollT = setTimeout(() => {
        if (r.stopped) return;
        r.ctx = {};
        httpOpen(url, r.ctx, (r2) => { if (r.stopped) return r2.destroy(); if (r2.statusCode !== 200) { r2.resume(); return fail('HTTP ' + r2.statusCode); } snapshot(r2, Date.now()); }, (e) => fail(e.message));
      }, Math.max(30, Math.max(250, 1000 / fps) - (Date.now() - t0)));
    });
  }
  const p = protoOf(url);
  if (p !== 'http' && p !== 'https') { viaFfmpeg(); return r; }
  r.ctx = {};
  httpOpen(url, r.ctx, (res) => {
    if (r.stopped) return res.destroy();
    if (res.statusCode !== 200) { res.resume(); return fail('HTTP ' + res.statusCode); }
    const ct = String(res.headers['content-type'] || '').toLowerCase();
    if (ct.includes('multipart')) {
      kind('mjpeg');
      const split = jpegSplitter(frame);
      res.on('data', (d) => { if (!r.stopped) split(d); });
      res.on('end', () => fail('انقطع البث من الكاميرا'));
      res.on('error', (e) => fail(e.message));
      return;
    }
    if (ct.includes('image/')) { kind('snapshot'); return snapshot(res, Date.now()); }
    // anything else (HLS, FLV, MP4 …) → let ffmpeg decode it
    res.destroy(); viaFfmpeg();
  }, (e) => fail(e.message));
  return r;
}

/* ------------------------------------------------------------------ */
/* Agent                                                                 */
/* ------------------------------------------------------------------ */
function arg(name) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; }

function runAgent() {
  const SERVER = String(arg('server') || process.env.EGIC_SERVER || '').replace(/\/+$/, '');
  const KEY = arg('key') || process.env.EGIC_AGENT_KEY || '';
  if (!/^https?:\/\//.test(SERVER) || !KEY) {
    console.log('Usage: node edge-agent.js --server https://your-app.up.railway.app --key <agent key>');
    process.exit(1);
  }
  const FFMPEG = findFfmpeg([__dirname, path.join(__dirname, 'bin'), path.join(__dirname, '..', 'bin'), process.cwd()]);
  const C = { dim: '\x1b[2m', g: '\x1b[32m', r: '\x1b[31m', c: '\x1b[36m', o: '\x1b[38;5;208m', b: '\x1b[1m', x: '\x1b[0m' };
  const log = (...a) => console.log(C.dim + new Date().toLocaleTimeString('en-GB') + C.x, ...a);
  const H = { 'X-Agent-Key': KEY, 'X-Agent-Version': VERSION, 'X-Agent-Host': require('os').hostname() };
  const cams = new Map(); // id → { url, reader, busy, last, lastSent, retryT, state, frames }
  let cfg = { fps: 8, width: 960 }, online = false, polling = false;

  console.log('');
  console.log(C.b + '  EGIC · Edge Agent ' + VERSION + C.x + '   ' + C.o + 'POWERED BY DELMON & DEV SMART X' + C.x);
  console.log('  ● Server   ' + C.c + SERVER + C.x);
  console.log('  ● ffmpeg   ' + C.dim + FFMPEG + C.x);
  console.log(C.dim + '  Keep this window open. Cameras stream only while someone watches them on the platform.' + C.x);
  console.log('');

  function post(p, body, type) {
    return fetch(SERVER + p, { method: 'POST', headers: Object.assign({ 'Content-Type': type || 'application/json' }, H), body: type ? body : JSON.stringify(body) });
  }
  function send(id, c) {
    // one upload at a time per camera; while it is in flight only the newest frame is kept
    if (c.busy || !c.pending) return;
    const buf = c.pending; c.pending = null; c.busy = true;
    post('/api/v1/agent/frame/' + encodeURIComponent(id), buf, 'image/jpeg').then((r) => { if (r.status === 404 || r.status === 410) stopCam(id); r.arrayBuffer().catch(() => { }); }, () => { }).then(() => { c.busy = false; send(id, c); });
  }
  function startCam(id, url) {
    let c = cams.get(id);
    if (c && c.reader && c.url === url) return;
    if (c && !c.reader && c.url === url && Date.now() - c.failedAt < 5000) return; // wait a little after a failure
    if (c) stopCam(id);
    c = { url, reader: null, busy: false, pending: null, lastSent: 0, frames: 0 };
    cams.set(id, c);
    log(C.c + '▶' + C.x, id, C.dim + maskUrl(url) + C.x);
    c.reader = createReader(url, {
      fps: cfg.fps, width: cfg.width, ffmpeg: FFMPEG,
      onFrame: (b) => {
        const now = Date.now();
        if (now - c.lastSent < 1000 / cfg.fps - 5) return;
        c.lastSent = now; c.pending = b;
        if (!c.frames++) log(C.g + '● streaming' + C.x, id);
        send(id, c);
      },
      onError: (m) => {
        log(C.r + '✗' + C.x, id, errAr(m));
        post('/api/v1/agent/error/' + encodeURIComponent(id), { error: m }).catch(() => { });
        c.reader = null; c.failedAt = Date.now(); // the next poll after 5 s restarts it if still wanted
      }
    });
  }
  function stopCam(id) {
    const c = cams.get(id); if (!c) return;
    if (c.reader) { c.reader.stop(); log(C.dim + '■ stopped ' + id + C.x); }
    cams.delete(id);
  }
  function runTest(t) {
    log(C.c + '? test' + C.x, C.dim + maskUrl(t.url) + C.x);
    let done = false;
    const finish = (out) => { if (done) return; done = true; clearTimeout(tm); rd.stop(); post('/api/v1/agent/test/' + encodeURIComponent(t.tid), out).catch(() => { }); log(out.ok ? C.g + '✓ test ok' + C.x : C.r + '✗ test: ' + errAr(out.error) + C.x); };
    const rd = createReader(t.url, { fps: 2, width: cfg.width, ffmpeg: FFMPEG, onFrame: (b) => finish({ ok: true, kind: rd.kind, image: b.toString('base64') }), onError: (m) => finish({ ok: false, kind: rd.kind, error: m }) });
    const tm = setTimeout(() => finish({ ok: false, kind: rd.kind, error: 'ETIMEDOUT' }), 27000);
  }
  async function poll() {
    if (polling) return; polling = true;
    try {
      const r = await fetch(SERVER + '/api/v1/agent/poll', { headers: H, cache: 'no-store' });
      if (r.status === 401) { if (online !== 'denied') log(C.r + '✗ مفتاح الوسيط غير صحيح أو اتمسح من المنصة' + C.x); online = 'denied'; return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (online !== true) log(C.g + '● connected' + C.x, 'agent «' + j.agent.name + '»', C.dim + j.cams.length + ' camera(s)' + C.x);
      online = true;
      cfg.fps = j.fps || cfg.fps; cfg.width = j.width || cfg.width;
      const wanted = new Set();
      for (const c of j.cams) if (c.want) { wanted.add(c.id); startCam(c.id, c.url); }
      for (const id of [...cams.keys()]) if (!wanted.has(id)) stopCam(id);
      for (const t of j.tests || []) runTest(t);
    } catch (e) {
      if (online !== false) log(C.r + '✗ server unreachable' + C.x, C.dim + (e.cause && e.cause.code || e.message) + C.x);
      online = false;
    } finally { polling = false; }
  }
  poll(); setInterval(poll, 2000);
  process.on('SIGINT', () => { for (const id of [...cams.keys()]) stopCam(id); process.exit(0); });
}

module.exports = { createReader, errAr, maskUrl, protoOf, findFfmpeg, jpegSplitter, VERSION };
if (require.main === module) runAgent();
