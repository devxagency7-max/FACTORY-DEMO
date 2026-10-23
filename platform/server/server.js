#!/usr/bin/env node
/*!
 * EGIC · AI Safety & Smart Access Platform — Local Backend
 * Powered by DELMON & DEV SMART X
 *
 * Zero-dependency Node.js server:
 *   • serves the web application (index.html, console, assets, models)
 *   • REST API  →  /api/v1/*        (same contract as the embedded engine)
 *   • Live SSE  →  /api/v1/stream   (events · gate reads · attendance · health · KPIs)
 *   • persists live AI evidence (PPE screenshots, plate snapshots, attendance photos) under ./data
 *
 * Run:   node server/server.js            → http://localhost:8080
 *        PORT=9000 node server/server.js
 *        HOST=0.0.0.0 node server/server.js   (to open it from another device on the same network)
 *
 * Phone camera: the console shows a QR → phone.html opens the camera and connects to the console with
 *   WebRTC (peer-to-peer video, ~30 fps, low latency). This server only relays the SDP offer/answer:
 *   POST|GET /api/v1/cam/:session/offer · POST|GET /api/v1/cam/:session/answer.
 *   Fallback when WebRTC can't connect: JPEG frames → POST /api/v1/cam/:session/frame, read back as
 *   MJPEG (/api/v1/cam/:session/mjpeg).
 *   Phones only open the camera over HTTPS: locally put a cert in .certs/ (key.pem + cert.pem, see
 *   scripts/make-local-cert.sh) and the server also listens on HTTPS_PORT (default 8443).
 *
 * IP cameras: /api/v1/ipcams — the server reads the camera (RTSP through ffmpeg, MJPEG or JPEG snapshot URLs,
 *   Basic/Digest auth) and re-serves it as same-origin MJPEG (/api/v1/ipcams/:id/mjpeg) so the browser models can
 *   read the pixels. Cameras are saved in DATA_DIR/ipcams.json (contains credentials — keep it private).
 *   RTSP needs ffmpeg (on PATH, or FFMPEG_PATH, or platform/bin/ffmpeg[.exe]). The camera only streams while
 *   someone is watching it.
 *   Cameras on a factory network the cloud server can't reach go through an Edge Agent (agent/edge-agent.js) running
 *   on a PC inside that network: it polls /api/v1/agent/poll and pushes frames to /api/v1/agent/frame/:id.
 *
 * Cloud (Railway): PORT is injected → binds 0.0.0.0. CORS_ORIGIN restricts which web origins may call the API
 * (default '*', so the UI can be hosted on Vercel while this server runs on Railway). DATA_DIR moves evidence +
 * journals to a mounted volume so they survive redeploys. ADMIN_TOKEN protects data wipes and camera changes.
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');
const crypto = require('crypto');
const { Engine } = require('../js/engine.js');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const EVID = path.join(DATA, 'evidence');
const JOURNAL = path.join(DATA, 'journal.ndjson');    // live AI events, gate reads, vehicles — «test data»
const REGISTRY = path.join(DATA, 'registry.ndjson');  // employees, face templates, attendance — kept on «clear test data»
const IPCAMS_FILE = path.join(DATA, 'ipcams.json');  // camera URLs incl. credentials — never served
const REVIEWS_FILE = path.join(DATA, 'learning-reviews.ndjson'); // supervisor decisions on engine detections → AI training labels
const PORT = +process.env.PORT || 8080;
const HOST = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const CORS = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token, X-Agent-Key, X-Agent-Version, X-Agent-Host',
  'Access-Control-Max-Age': '86400'
};
const REGISTRY_KINDS = new Set(['worker', 'worker_del', 'face', 'att', 'attset']);

fs.mkdirSync(EVID, { recursive: true });

const C = { dim: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', b: '\x1b[1m', o: '\x1b[38;5;208m', x: '\x1b[0m' };
const log = (...a) => console.log(C.dim + new Date().toLocaleTimeString('en-GB') + C.x, ...a);

/* ------------------------------------------------------------------ */
/* Engine + journals (live records survive restarts)                   */
/* ------------------------------------------------------------------ */
// EGIC_DEMO=0 on the factory server: no simulated sites, history or live sim events
const DEMO = process.env.EGIC_DEMO !== '0';
let engine = new Engine({ mode: 'server', demo: DEMO }); // replaced on POST /api/v1/admin/reset

function saveDataUrl(dataUrl, name) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const file = name.replace(/[^A-Za-z0-9_-]/g, '_') + '.' + ext;
  fs.writeFileSync(path.join(EVID, file), Buffer.from(m[2], 'base64'));
  return 'data/evidence/' + file;
}

function journal(kind, payload) {
  try { fs.appendFileSync(REGISTRY_KINDS.has(kind) ? REGISTRY : JOURNAL, JSON.stringify({ kind, ts: Date.now(), payload }) + '\n'); } catch (e) { /* non-fatal */ }
}

// ---- AI referee: a vision LLM (OpenRouter) re-judges every PPE alarm by THIS foundry's gear rules before it can land
// on a worker. A clear "false alarm" (e.g. a welding shield read as "no helmet") is closed automatically — reopenable
// by any supervisor; "real" / "unclear" stay pending for a human, with the referee's note attached. The referee's
// decisions are NOT written to the training reviews (only a human's are ground truth).
// REFEREE=auto (default when a key exists) | note (annotate only) | off. Key: OPENROUTER_API_KEY or the repo's .env.
const REFEREE_TYPES = new Set(['NO_HELMET', 'NO_VEST', 'NO_GLOVES', 'NO_GLASSES', 'NO_EARMUFFS']);
const REFEREE_WHAT = { NO_HELMET: 'the worker has NO head protection', NO_VEST: 'the worker has NO body protection (no vest / apron)', NO_GLOVES: 'the worker has NO gloves', NO_GLASSES: 'the worker has NO safety glasses', NO_EARMUFFS: 'the worker has NO ear protection' };
const REFEREE_POLICY = 'Compliant protective gear in THIS brass foundry:\n'
  + '- head: a hard hat OR a welding / face shield of any kind worn on the head (black, green-tinted or clear; flipped up still counts)\n'
  + '- body: a hi-vis vest OR an aluminized silver thermal apron OR a heavy leather/cloth work apron OR a coverall\n'
  + '- hands: any work gloves (leather, cloth, striped)\n'
  + '- eyes: safety glasses OR a face shield covering the eyes\n'
  + '- ears: ear muffs or ear plugs\n';
function openRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  for (const f of [path.join(ROOT, '..', '.env'), path.join(ROOT, '.env')]) {
    try { const m = /^OPENROUTER_API_KEY=(.+)$/m.exec(fs.readFileSync(f, 'utf8')); if (m) return m[1].trim(); } catch (e) { /* no file */ }
  }
  return null;
}
const REFEREE_KEY = openRouterKey();
const REFEREE_MODE = process.env.REFEREE || (REFEREE_KEY ? 'auto' : 'off');
const REFEREE_MODEL = process.env.REFEREE_MODEL || 'google/gemini-2.5-flash';
const refereeFrames = new Map(); // incident → raw frame data URL (sibling events of one incident share the frame)
let refereeBusy = 0, refereeWindow = [];
function refereeImage(ev, learn) {
  if (learn && learn.frame) return learn.frame;
  if (ev.incident && refereeFrames.has(ev.incident) && refereeFrames.get(ev.incident).frame) return refereeFrames.get(ev.incident).frame;
  const f = ev.evidence && ev.evidence.image && path.join(EVID, path.basename(ev.evidence.image)); // fallback: the annotated snapshot
  try { return 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64'); } catch (e) { return null; }
}
async function askReferee(image, alarm, subject) {
  // with a crop of the flagged worker the referee judges THAT person only (the scene is context); without one it can only
  // judge the scene, so it must not clear the alarm because someone ELSE in view is dressed correctly
  const prompt = subject
    ? `An automated camera system in a brass FOUNDRY raised this alarm about ONE worker: "${REFEREE_WHAT[alarm] || alarm}".\n`
      + 'IMAGE 1 is a crop of exactly that worker. IMAGE 2 is the full scene, for context only.\n'
      + REFEREE_POLICY
      + 'Judge ONLY the worker in IMAGE 1 — ignore every other person in the scene. Is the alarm TRUE for that worker, judged by the '
      + 'foundry rules above? If the relevant body part of that worker is not clearly visible, answer unclear — never guess.\n'
      + 'Answer ONLY JSON: {"verdict": "real" | "false_alarm" | "unclear", "reason": "<one short sentence in Arabic about that worker>"}'
    : `An automated camera system in a brass FOUNDRY raised this alarm on the photo: "${REFEREE_WHAT[alarm] || alarm}".\n`
      + REFEREE_POLICY
      + 'We do not know which worker it was raised about. Answer false_alarm ONLY if EVERY clearly visible worker complies; if any '
      + 'visible worker breaks the rule answer real; if you cannot tell, answer unclear — never guess.\n'
      + 'Answer ONLY JSON: {"verdict": "real" | "false_alarm" | "unclear", "reason": "<one short sentence in Arabic>"}';
  const content = [{ type: 'text', text: prompt }];
  if (subject) content.push({ type: 'image_url', image_url: { url: subject } });
  content.push({ type: 'image_url', image_url: { url: image } });
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + REFEREE_KEY, 'Content-Type': 'application/json', 'X-Title': 'EGIC PPE referee' },
      body: JSON.stringify({ model: REFEREE_MODEL, temperature: 0, messages: [{ role: 'user', content: content }] })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = (await r.json()).choices[0].message.content || '';
    const m = /\{[\s\S]*\}/.exec(txt); const j = m ? JSON.parse(m[0]) : {};
    return { verdict: ['real', 'false_alarm', 'unclear'].includes(j.verdict) ? j.verdict : 'unclear', reason: String(j.reason || ''), model: REFEREE_MODEL };
  } finally { clearTimeout(t); }
}
// an internal event action — same path + journal as a supervisor's, but never counted as a training review
function internalAction(id, body) {
  const pathname = '/api/v1/events/' + id + '/action';
  const out = engine.handle('POST', pathname, {}, body);
  if (out.status === 200) { const j = engine.journalEntry(pathname, body, out.body); if (j) journal(j[0], j[1]); }
  return out;
}
function refereeEvent(ev, learn, subject) {
  if (REFEREE_MODE === 'off' || !REFEREE_KEY || !ev || !REFEREE_TYPES.has(ev.type)) return;
  if (ev.incident && ((learn && learn.frame) || subject)) {
    const c = refereeFrames.get(ev.incident) || {};
    if (learn && learn.frame) c.frame = learn.frame;
    if (subject) c.subject = subject;
    c.t = Date.now(); refereeFrames.set(ev.incident, c);
  }
  // a little delay so the sibling event that carries the raw frame has arrived; cap the rate so a glitch can't run up a bill
  setTimeout(async () => {
    const now = Date.now();
    refereeWindow = refereeWindow.filter((t) => now - t < 60000);
    if (refereeBusy >= 3 || refereeWindow.length >= 40) return log(C.y + '● REFEREE' + C.x, C.dim + 'skipped (rate cap) ' + ev.id + C.x);
    const image = refereeImage(ev, learn); if (!image) return;
    const subj = subject || (ev.incident && refereeFrames.has(ev.incident) && refereeFrames.get(ev.incident).subject) || null;
    refereeBusy++; refereeWindow.push(now);
    try {
      const v = await askReferee(image, ev.type, subj);
      v.subject = !!subj; // was the referee shown WHO the alarm is about?
      internalAction(ev.id, { action: 'referee', referee: v });
      if (v.verdict === 'false_alarm' && REFEREE_MODE === 'auto') internalAction(ev.id, { action: 'false_positive', actor: 'الحَكَم الآلي (AI)', note: v.reason });
      log(C.c + '● REFEREE' + C.x, ev.type, '→', (v.verdict === 'false_alarm' ? C.g : v.verdict === 'real' ? C.r : C.y) + v.verdict + C.x, C.dim + ev.id + ' · ' + v.reason.slice(0, 80) + C.x);
    } catch (e) { log(C.y + '● REFEREE' + C.x, C.dim + 'error ' + ev.id + ' · ' + e.message + C.x); }
    finally { refereeBusy--; }
    for (const [k, f] of refereeFrames) if (Date.now() - f.t > 120000) refereeFrames.delete(k);
  }, 1500);
}

// The learning notebook for the browser models: save the RAW frame + its detection boxes behind an alarm, keyed by the
// event id. scripts/learn.py pairs it with the supervisor's confirm / "false alarm" (REVIEWS_FILE) to train a student.
const LEARN_EVENTS_DIR = path.join(DATA, 'learning', 'events');
function saveLearnEvent(id, learn) {
  try {
    if (!id || !learn || !learn.task) return;
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(learn.frame || '');
    if (!m) return;
    fs.mkdirSync(LEARN_EVENTS_DIR, { recursive: true });
    const safe = String(id).replace(/[^A-Za-z0-9_.-]/g, '_');
    fs.writeFileSync(path.join(LEARN_EVENTS_DIR, safe + '.jpg'), Buffer.from(m[2], 'base64'));
    fs.writeFileSync(path.join(LEARN_EVENTS_DIR, safe + '.json'), JSON.stringify({ id, task: learn.task, type: learn.type || null, size: learn.size || null, dets: learn.dets || [], ts: Date.now() }));
  } catch (e) { /* non-fatal */ }
}

function readJournal(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []; }
function replayJournal() {
  const quiet = engine.listeners; engine.listeners = [];
  let n = 0;
  // employees first (events and attendance reference them); 'worker' lines in the old single journal belonged to the removed demo workforce
  for (const [file, skip] of [[REGISTRY, null], [JOURNAL, 'worker']]) {
    for (const line of readJournal(file)) {
      try { const j = JSON.parse(line); if (j.kind !== skip) { engine.replay(j.kind, j.payload, j.ts); n++; } } catch (e) { /* skip corrupt line */ }
    }
  }
  engine.listeners = quiet;
  return n;
}

/* ------------------------------------------------------------------ */
/* SSE                                                                  */
/* ------------------------------------------------------------------ */
const clients = new Set();
function broadcast(msg) {
  const data = 'event: ' + msg.type + '\ndata: ' + JSON.stringify(msg.data) + '\n\n';
  for (const res of clients) { try { res.write(data); } catch (e) { clients.delete(res); } }
  if (msg.type === 'event' && String(msg.data.source || '').indexOf('live') === 0) log(C.o + '● LIVE AI' + C.x, msg.data.typeAr, '→', msg.data.workerName || 'غير معروف', C.dim + msg.data.id + C.x);
  if (msg.type === 'gate' && String(msg.data.source || '').indexOf('live') === 0) log(C.c + '● LIVE ANPR' + C.x, msg.data.plate, msg.data.lane, msg.data.decision);
  if (msg.type === 'attendance' && msg.data.kind === 'IN') log(C.g + '● ATTENDANCE' + C.x, 'check-in', msg.data.record.workerName, C.dim + msg.data.record.workerId + C.x);
}

function bootEngine() {
  engine.on(broadcast);
  const n = replayJournal();
  registerIpcams();
  engine.start();
  return n;
}

// Wipe recorded test data (evidence snapshots + live journal) and restart the engine on a clean state.
// people=true also wipes employees, face templates and attendance. Set ADMIN_TOKEN to require X-Admin-Token.
function resetData(people) {
  let files = 0;
  for (const f of fs.readdirSync(EVID)) {
    if (f === 'README.txt' || (!people && /^(worker|att)_/.test(f))) continue;
    try { fs.unlinkSync(path.join(EVID, f)); files++; } catch (e) { }
  }
  let records = 0;
  for (const file of people ? [JOURNAL, REGISTRY] : [JOURNAL]) {
    if (fs.existsSync(file)) { records += readJournal(file).length; fs.unlinkSync(file); }
  }
  engine.stop();
  engine = new Engine({ mode: 'server', demo: DEMO });
  bootEngine();
  log(C.y + '● RESET' + C.x, people ? 'test data + employees wiped' : 'test data wiped', C.dim + files + ' evidence files · ' + records + ' journal records' + C.x);
  broadcast({ type: 'reset', data: { ts: Date.now(), files, records, people: !!people } });
  return { ok: true, files, records };
}
setInterval(() => { for (const res of clients) { try { res.write(': ping\n\n'); } catch (e) { clients.delete(res); } } }, 15000);

function adminOk(req) { return !process.env.ADMIN_TOKEN || req.headers['x-admin-token'] === process.env.ADMIN_TOKEN; }

/* ------------------------------------------------------------------ */
/* Phone camera relay (JPEG in → MJPEG out)                              */
/* ------------------------------------------------------------------ */
const cams = new Map(); // session → { frame, ts, seq, viewers:Set, fps, n, fpsT, ua }
const CAM_ID = /^[a-z0-9]{8,40}$/i;
function camSession(id) {
  let c = cams.get(id);
  if (!c) { c = { frame: null, ts: 0, seq: 0, viewers: new Set(), fps: 0, n: 0, fpsT: Date.now(), born: Date.now() }; cams.set(id, c); }
  return c;
}
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (b) => { size += b.length; if (size > limit) { reject(new Error('frame_too_large')); req.destroy(); } else chunks.push(b); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function pushFrame(c, buf) {
  const head = Buffer.from('--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ' + buf.length + '\r\n\r\n');
  for (const res of c.viewers) {
    if (res.writableLength > 2 * 1024 * 1024) continue; // slow viewer: drop this frame
    try { res.write(head); res.write(buf); res.write('\r\n'); } catch (e) { c.viewers.delete(res); }
  }
}
function mjpegHead(res) {
  res.writeHead(200, Object.assign({ 'Content-Type': 'multipart/x-mixed-replace; boundary=frame', 'Cache-Control': 'no-cache, no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }, CORS));
}
async function camApi(req, res, id, action) {
  if (!CAM_ID.test(id)) return send(res, 400, { error: 'bad_session' });
  // WebRTC signalling (non-trickle: each side posts one SDP with its ICE candidates already gathered)
  if (action === 'offer' || action === 'answer') {
    const c = camSession(id);
    if (req.method === 'POST') {
      let j;
      try { j = JSON.parse((await readRaw(req, 256 * 1024)).toString('utf8')); } catch (e) { return send(res, 400, { error: 'bad_json' }); }
      if (!j || typeof j.sdp !== 'string' || !/^(offer|answer)$/.test(j.type)) return send(res, 400, { error: 'bad_sdp' });
      if (action === 'offer') { c.offer = { type: j.type, sdp: j.sdp, ts: Date.now() }; c.answer = null; log(C.c + '● PHONE CAM' + C.x, 'WebRTC offer', C.dim + id + C.x); }
      else c.answer = { type: j.type, sdp: j.sdp, ts: Date.now() };
      c.ts = c.ts || 0; c.born = Date.now();
      return send(res, 200, { ok: true });
    }
    const v = action === 'offer' ? c.offer : c.answer;
    return v ? send(res, 200, v) : send(res, 204, '');
  }
  if (action === 'frame' && req.method === 'POST') {
    let buf;
    try { buf = await readRaw(req, 4 * 1024 * 1024); } catch (e) { return send(res, 413, { error: e.message }); }
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return send(res, 415, { error: 'jpeg_only' });
    const c = camSession(id), first = !c.frame;
    c.frame = buf; c.ts = Date.now(); c.seq++; c.n++;
    if (c.ts - c.fpsT >= 1000) { c.fps = Math.round(c.n * 1000 / (c.ts - c.fpsT)); c.n = 0; c.fpsT = c.ts; }
    pushFrame(c, buf);
    if (first) { log(C.c + '● PHONE CAM' + C.x, 'connected', C.dim + id + C.x); engine.emit('phonecam', { session: id, state: 'connected', ts: c.ts }); }
    return send(res, 200, { ok: true, seq: c.seq, viewers: c.viewers.size });
  }
  if (action === 'mjpeg') {
    const c = camSession(id);
    mjpegHead(res);
    c.viewers.add(res);
    if (c.frame) pushFrame({ viewers: new Set([res]) }, c.frame);
    req.on('close', () => c.viewers.delete(res));
    return;
  }
  if (action === 'frame' && req.method === 'GET') {
    const c = cams.get(id);
    if (!c || !c.frame) return send(res, 404, { error: 'no_frame' });
    return send(res, 200, c.frame, { 'Content-Type': 'image/jpeg' });
  }
  const c = cams.get(id);
  return send(res, 200, { session: id, connected: !!(c && c.frame && Date.now() - c.ts < 5000), lastFrameAgoMs: c && c.ts ? Date.now() - c.ts : null, fps: c ? c.fps : 0, viewers: c ? c.viewers.size : 0, offer: !!(c && c.offer), answered: !!(c && c.answer) });
}
setInterval(() => { const now = Date.now(); for (const [id, c] of cams) if (now - Math.max(c.ts, c.born) > 15 * 60 * 1000) { for (const r of c.viewers) try { r.end(); } catch (e) { } cams.delete(id); } }, 60 * 1000);

/* ------------------------------------------------------------------ */
/* IP cameras → MJPEG. Read directly by this server, or pushed by an     */
/* Edge Agent inside the factory network (agent/edge-agent.js)          */
/* ------------------------------------------------------------------ */
const CAM = require('../agent/edge-agent.js');
const { errAr, maskUrl, protoOf } = CAM;
// JPEG fallback only (the normal path is WebRTC video): keep it as sharp as the camera allows
const IPCAM_FPS = Math.max(1, +process.env.IPCAM_FPS || 20);      // frames/s sent to the browser (camera native max)
const IPCAM_WIDTH = Math.max(320, +process.env.IPCAM_WIDTH || 1920); // RTSP frames are scaled down to this width
const AGENT_FPS = Math.max(1, +process.env.AGENT_FPS || 8);        // agents upload over the factory's internet line
const AGENT_WIDTH = Math.max(320, +process.env.AGENT_WIDTH || 960);
const FFMPEG = CAM.findFfmpeg([path.join(ROOT, 'bin')]);
// real video (WebRTC) for directly reachable cameras; the JPEG path below stays as the fallback and for agent cameras
const STREAM = require('./stream.js').createStreamer({ binDirs: [path.join(ROOT, 'bin')], dataDir: DATA, ffmpeg: FFMPEG, log: (m) => log(C.y + '● STREAM' + C.x, C.dim + m + C.x) });
const AGENTS_FILE = path.join(DATA, 'agents.json');
const ipcams = new Map(); // id → camera (saved fields + runtime state)
const agents = new Map(); // id → { id, name, keyHash, created, lastSeen, host, version, tests:Map }

function ipcamRuntime() { return { viewers: new Set(), frame: null, ts: 0, fps: 0, n: 0, fpsT: Date.now(), lastPush: 0, state: 'idle', error: null, gen: 0, running: false, startedAt: 0, lastViewer: 0, kind: null, waiters: [], reader: null }; }
function loadIpcams() {
  try { for (const c of JSON.parse(fs.readFileSync(IPCAMS_FILE, 'utf8'))) ipcams.set(c.id, Object.assign(ipcamRuntime(), c)); } catch (e) { /* no cameras yet */ }
  try { for (const a of JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'))) agents.set(a.id, Object.assign({ lastSeen: 0, tests: new Map() }, a)); } catch (e) { /* no agents yet */ }
}
function saveIpcams() {
  const list = [...ipcams.values()].filter((c) => !c.temp).map((c) => ({ id: c.id, name: c.name, url: c.url, siteId: c.siteId, agentId: c.agentId || null, enhance: !!c.enhance, created: c.created }));
  fs.writeFileSync(IPCAMS_FILE, JSON.stringify(list, null, 2));
}
function saveAgents() { fs.writeFileSync(AGENTS_FILE, JSON.stringify([...agents.values()].map((a) => ({ id: a.id, name: a.name, keyHash: a.keyHash, created: a.created })), null, 2)); }
const agentOnline = (a) => !!a && Date.now() - a.lastSeen < 10000;
function agentPublic(a) { return { id: a.id, name: a.name, online: agentOnline(a), lastSeen: a.lastSeen || null, host: a.host || null, version: a.version || null, cams: [...ipcams.values()].filter((c) => c.agentId === a.id).length, created: a.created }; }
function ipcamPublic(c) {
  const a = c.agentId ? agents.get(c.agentId) : null;
  return { id: c.id, name: c.name, url: maskUrl(c.url), siteId: c.siteId, protocol: protoOf(c.url).toUpperCase(), kind: c.kind, state: c.state, error: c.error, fps: c.fps, viewers: c.viewers.size, lastFrameAgoMs: c.ts ? Date.now() - c.ts : null, created: c.created, agentId: c.agentId || null, agentName: a ? a.name : null, agentOnline: a ? agentOnline(a) : null, enhance: !!c.enhance, webrtc: STREAM.available && !c.agentId };
}
function registerIpcams() { for (const c of ipcams.values()) if (!c.temp) engine.upsertCamera({ id: c.id, name: c.name, siteId: c.siteId, protocol: protoOf(c.url).toUpperCase() + (c.agentId ? ' · عبر وسيط الشبكة' : ' · عبر السيرفر'), ip: (/\/\/(?:[^@/]*@)?([^/:?]+)/.exec(c.url) || [])[1] || '' }); }

function ipcamFrame(c, buf) {
  const now = Date.now();
  c.frame = buf; c.ts = now; c.n++;
  if (c.state !== 'live') { c.state = 'live'; c.error = null; log(C.c + '● IP CAM' + C.x, 'streaming', c.name, C.dim + c.id + ' · ' + (c.agentId ? 'agent' : c.kind) + C.x); }
  if (now - c.fpsT >= 1000) { c.fps = Math.round(c.n * 1000 / (now - c.fpsT)); c.n = 0; c.fpsT = now; }
  c.waiters.splice(0).forEach((fn) => fn(buf));
  if (now - c.lastPush < 1000 / IPCAM_FPS - 5) return; // pace what goes to browsers
  c.lastPush = now;
  pushFrame(c, buf);
}
function ipcamFail(c, gen, msg) {
  if (gen !== c.gen || !c.running) return;
  if (c.reader) { c.reader.stop(); c.reader = null; }
  c.state = 'error'; c.error = errAr(msg);
  log(C.r + '● IP CAM' + C.x, c.name, C.dim + c.error + C.x);
  c.waiters.splice(0).forEach((fn) => fn(null));
  if (c.agentId) return; // the agent retries on its side
  // keep retrying while someone is watching
  clearTimeout(c.retryT);
  c.retryT = setTimeout(() => { if (gen === c.gen && c.running && (c.viewers.size || Date.now() - c.lastViewer < 15000)) { c.running = false; ipcamStart(c); } }, 5000);
}
function ipcamStop(c) { c.gen++; c.running = false; clearTimeout(c.retryT); if (c.reader) { c.reader.stop(); c.reader = null; } c.state = 'idle'; c.fps = 0; }
function ipcamStart(c) {
  if (c.running) return;
  c.running = true; c.gen++; c.state = 'connecting'; c.error = null; c.startedAt = Date.now(); c.lastViewer = Date.now();
  if (c.agentId) return; // frames arrive from the agent once its next poll sees a viewer
  const gen = c.gen;
  c.reader = CAM.createReader(c.url, { fps: IPCAM_FPS, width: IPCAM_WIDTH, ffmpeg: FFMPEG, enhance: c.enhance, onKind: (k) => { c.kind = k; }, onFrame: (b) => { if (gen === c.gen) ipcamFrame(c, b); }, onError: (m) => ipcamFail(c, gen, m) });
}
// watchdog: stalled streams reconnect, unwatched cameras stop
setInterval(() => {
  const now = Date.now();
  for (const c of ipcams.values()) {
    if (c.viewers.size) c.lastViewer = now;
    if (!c.running) continue;
    if (!c.viewers.size && now - c.lastViewer > 15000) { ipcamStop(c); if (c.temp) ipcams.delete(c.id); else log(C.dim + '● IP CAM idle → stopped ' + c.name + C.x); continue; }
    const a = c.agentId ? agents.get(c.agentId) : null;
    if (c.agentId && !agentOnline(a) && c.state !== 'error') { c.state = 'error'; c.error = 'وسيط الشبكة «' + (a ? a.name : '?') + '» مش متصل — شغّل برنامج الوسيط على كمبيوتر المصنع'; c.waiters.splice(0).forEach((fn) => fn(null)); continue; }
    if (c.state === 'live' && now - c.ts > 15000) ipcamFail(c, c.gen, 'توقف وصول الصور من الكاميرا');
    else if (c.state === 'connecting' && now - c.startedAt > 25000) ipcamFail(c, c.gen, 'ETIMEDOUT');
    else if (c.agentId && c.state === 'error' && agentOnline(a) && now - c.ts < 3000) c.state = 'live';
  }
}, 3000);
function firstFrame(c, ms) {
  return new Promise((resolve) => {
    if (c.frame && Date.now() - c.ts < 3000) return resolve(c.frame);
    const t = setTimeout(() => resolve(null), ms);
    c.waiters.push((b) => { clearTimeout(t); resolve(b); });
  });
}
function validCamUrl(u) { return typeof u === 'string' && u.length < 2048 && /^(rtsps?|https?|rtmp):\/\/[^\s]+$/i.test(u.trim()); }

/* ---------------- ONVIF PTZ (pan / tilt / zoom) — control a moving camera from the platform ---------------- */
const ONVIF_PORTS = [8899, 80, 8000, 8080, 2020, 8181, 85];
function camCreds(cam) { try { const u = new URL(cam.url); return { host: u.hostname, user: decodeURIComponent(u.username) || 'admin', pass: decodeURIComponent(u.password) }; } catch (e) { return null; } }
function onvifSecurity(user, pass) {
  const nonce = crypto.randomBytes(16), created = new Date().toISOString();
  const digest = crypto.createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created, 'utf8'), Buffer.from(pass, 'utf8')])).digest('base64');
  return '<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken><Username>' + user + '</Username><Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">' + digest + '</Password><Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">' + nonce.toString('base64') + '</Nonce><Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">' + created + '</Created></UsernameToken></Security></s:Header>';
}
function onvifCall(host, port, user, pass, path, body) {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">' + onvifSecurity(user, pass) + '<s:Body>' + body + '</s:Body></s:Envelope>';
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path: '/' + path, method: 'POST', headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', 'Content-Length': Buffer.byteLength(xml) }, timeout: 6000 }, (res) => {
      let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end(xml);
  });
}
async function onvifPort(cam, cr) {
  if (cam.onvifPort) return cam.onvifPort;
  for (const p of ONVIF_PORTS) {
    try { const r = await onvifCall(cr.host, p, cr.user, cr.pass, 'onvif/device_service', '<GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/>'); if (r.status === 200 && /onvif|SystemDateAndTime/i.test(r.body)) { cam.onvifPort = p; return p; } } catch (e) { }
  }
  return null;
}
async function onvifToken(cam, cr, port) {
  if (cam.ptzToken) return cam.ptzToken;
  const r = await onvifCall(cr.host, port, cr.user, cr.pass, 'onvif/media_service', '<GetProfiles xmlns="http://www.onvif.org/ver10/media/wsdl"/>');
  const t = (r.body.match(/Profiles[^>]*\btoken="([^"]+)"/) || r.body.match(/token="([^"]+)"/) || [])[1];
  if (t) cam.ptzToken = t;
  return t;
}
const PTZ_VEC = { right: [1, 0, 0], left: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0], upleft: [-1, 1, 0], upright: [1, 1, 0], downleft: [-1, -1, 0], downright: [1, -1, 0], zoomin: [0, 0, 1], zoomout: [0, 0, -1] };
const ptzStopBody = (t) => '<Stop xmlns="http://www.onvif.org/ver20/ptz/wsdl"><ProfileToken>' + t + '</ProfileToken><PanTilt>true</PanTilt><Zoom>true</Zoom></Stop>';
async function ptzControl(cam, act, speed, ms) {
  const cr = camCreds(cam); if (!cr || !cr.host) return { ok: false, error: 'لا يوجد عنوان للكاميرا' };
  if (cam.agentId) return { ok: false, error: 'تحكم كاميرا عبر وسيط الشبكة غير مدعوم بعد — شغّل المنصة على نفس شبكة الكاميرا' };
  const port = await onvifPort(cam, cr); if (!port) return { ok: false, error: 'الكاميرا لا تدعم ONVIF (مفيش منفذ تحكم)' };
  const token = await onvifToken(cam, cr, port); if (!token) return { ok: false, error: 'تعذّر قراءة ملف الكاميرا (ONVIF) — راجع المستخدم وكلمة المرور' };
  if (act === 'stop') { clearTimeout(cam.ptzStopT); try { await onvifCall(cr.host, port, cr.user, cr.pass, 'onvif/ptz_service', ptzStopBody(token)); } catch (e) { } return { ok: true, act: act }; }
  const v = PTZ_VEC[act]; if (!v) return { ok: false, error: 'حركة غير معروفة' };
  const s = Math.max(0.1, Math.min(1, +speed || 0.6));
  const vel = (v[0] || v[1]) ? '<PanTilt x="' + (v[0] * s) + '" y="' + (v[1] * s) + '" xmlns="http://www.onvif.org/ver10/schema"/>' : '';
  const zoom = v[2] ? '<Zoom x="' + (v[2] * s) + '" xmlns="http://www.onvif.org/ver10/schema"/>' : '';
  let r; try { r = await onvifCall(cr.host, port, cr.user, cr.pass, 'onvif/ptz_service', '<ContinuousMove xmlns="http://www.onvif.org/ver20/ptz/wsdl"><ProfileToken>' + token + '</ProfileToken><Velocity>' + vel + zoom + '</Velocity></ContinuousMove>'); } catch (e) { return { ok: false, error: 'تعذّر الاتصال بالكاميرا' }; }
  if (r.status !== 200 || /Fault/i.test(r.body)) return { ok: false, error: 'رفضت الكاميرا أمر الحركة (قد تكون الحركة مقفولة في إعدادات الكاميرا)' };
  // auto-stop after a short nudge so a click moves a little, press-and-hold moves longer
  const stopMs = Math.max(0, Math.min(5000, ms == null ? 500 : +ms));
  clearTimeout(cam.ptzStopT);
  if (stopMs) cam.ptzStopT = setTimeout(() => { onvifCall(cr.host, port, cr.user, cr.pass, 'onvif/ptz_service', ptzStopBody(token)).catch(() => { }); }, stopMs);
  return { ok: true, act: act, port: port };
}
// ask an agent to try a URL once; resolves with { ok, kind, image | error }
function agentTest(a, camUrl) {
  return new Promise((resolve) => {
    const tid = crypto.randomBytes(6).toString('hex');
    const t = setTimeout(() => { a.tests.delete(tid); resolve({ ok: false, error: agentOnline(a) ? errAr('ETIMEDOUT') : 'وسيط الشبكة «' + a.name + '» مش متصل — شغّله الأول على كمبيوتر المصنع' }); }, 35000);
    a.tests.set(tid, { tid, url: camUrl, sent: false, done: (r) => { clearTimeout(t); a.tests.delete(tid); resolve(r); } });
  });
}

async function ipcamApi(req, res, id, action) {
  if (!id && req.method === 'GET') return send(res, 200, { items: [...ipcams.values()].filter((c) => !c.temp).map(ipcamPublic), agents: [...agents.values()].map(agentPublic), ffmpeg: FFMPEG });
  if (req.method === 'POST' && !adminOk(req)) return send(res, 401, { error: 'admin_token_required' });
  if (req.method === 'POST' && (!id || id === 'test')) {
    let j;
    try { j = await readBody(req, 64 * 1024); } catch (e) { return send(res, 400, { error: e.message }); }
    const existing = j.id && ipcams.get(j.id);
    // editing without retyping the password: the masked URL keeps the saved credentials
    const camUrl = existing && j.url && j.url === maskUrl(existing.url) ? existing.url : String(j.url || '').trim();
    if (!validCamUrl(camUrl)) return send(res, 400, { error: 'الرابط لازم يبدأ بـ rtsp:// أو http:// أو https://' });
    const agent = j.agentId ? agents.get(j.agentId) : null;
    if (j.agentId && !agent) return send(res, 400, { error: 'وسيط الشبكة غير موجود' });
    if (id === 'test') {
      if (agent) { const r = await agentTest(agent, camUrl); if (r.image) r.image = 'data:image/jpeg;base64,' + r.image; if (r.error) r.error = errAr(r.error); return send(res, 200, r); }
      // try the camera once from this server without saving it; returns one frame as a preview
      const t = Object.assign(ipcamRuntime(), { id: 'TEST-' + crypto.randomBytes(4).toString('hex'), name: 'اختبار', url: camUrl, temp: true });
      ipcams.set(t.id, t); ipcamStart(t);
      const frame = await firstFrame(t, 20000);
      const out = frame ? { ok: true, kind: t.kind, image: 'data:image/jpeg;base64,' + frame.toString('base64') } : { ok: false, kind: t.kind, error: t.error || errAr('ETIMEDOUT') };
      ipcamStop(t); ipcams.delete(t.id);
      return send(res, 200, out);
    }
    let c = existing;
    if (!c) { c = Object.assign(ipcamRuntime(), { id: 'IPC-' + crypto.randomBytes(3).toString('hex').toUpperCase(), created: Date.now() }); ipcams.set(c.id, c); }
    const newEnhance = j.enhance === undefined ? !!c.enhance : !!j.enhance;
    const changed = c.url !== camUrl || (c.agentId || null) !== (agent ? agent.id : null) || newEnhance !== !!c.enhance;
    c.name = String(j.name || '').trim().slice(0, 80) || 'كاميرا IP'; c.url = camUrl; c.siteId = j.siteId || c.siteId || 'PLT-01'; c.agentId = agent ? agent.id : null; c.enhance = newEnhance;
    if (changed && c.running) { ipcamStop(c); if (c.viewers.size) ipcamStart(c); }
    if (changed || !existing) { if (c.agentId) STREAM.remove(c.id); else STREAM.set(c.id, c.url); }
    saveIpcams(); registerIpcams();
    log(C.c + '● IP CAM' + C.x, existing ? 'updated' : 'added', c.name, C.dim + maskUrl(c.url) + (agent ? ' · via agent ' + agent.name : '') + C.x);
    engine.emit('ipcam', { id: c.id, action: 'saved' });
    return send(res, 200, ipcamPublic(c));
  }
  const c = ipcams.get(id);
  if (!c || c.temp) return send(res, 404, { error: 'not_found' });
  if (action === 'delete' && req.method === 'POST') {
    ipcamStop(c); for (const r of c.viewers) try { r.end(); } catch (e) { }
    ipcams.delete(id); saveIpcams(); engine.removeCamera(id); STREAM.remove(id);
    engine.emit('ipcam', { id, action: 'deleted' });
    return send(res, 200, { ok: true, id });
  }
  if (action === 'mjpeg') {
    mjpegHead(res);
    c.viewers.add(res); c.lastViewer = Date.now();
    ipcamStart(c);
    if (c.frame && Date.now() - c.ts < 5000) pushFrame({ viewers: new Set([res]) }, c.frame);
    req.on('close', () => { c.viewers.delete(res); c.lastViewer = Date.now(); });
    return;
  }
  if (action === 'webrtc' && req.method === 'POST') {
    if (c.agentId) return send(res, 409, { error: 'agent_camera' });
    let j; try { j = await readBody(req, 256 * 1024); } catch (e) { return send(res, 400, { error: e.message }); }
    if (!j || j.type !== 'offer' || typeof j.sdp !== 'string') return send(res, 400, { error: 'bad_sdp' });
    const out = await STREAM.webrtc(c.id, j).catch((e) => ({ status: 502, body: { error: e.message } }));
    if (out.status === 200) log(C.c + '● IP CAM' + C.x, 'video stream (WebRTC)', c.name);
    return send(res, out.status, out.body);
  }
  if (action === 'snapshot') {
    ipcamStart(c); c.lastViewer = Date.now();
    const frame = await firstFrame(c, 15000);
    return frame ? send(res, 200, frame, { 'Content-Type': 'image/jpeg' }) : send(res, 504, { error: c.error || 'no_frame' });
  }
  if (action === 'ptz' && req.method === 'POST') {
    if (!adminOk(req)) return send(res, 401, { error: 'admin_token_required' });
    let j = {}; try { j = await readBody(req, 2048); } catch (e) { }
    const out = await ptzControl(c, String(j.act || ''), j.speed, j.ms);
    return send(res, out.ok ? 200 : 502, out);
  }
  return send(res, 200, ipcamPublic(c));
}

/* ---------------- Edge Agents: create / list (admin) · poll / frame / test (agent, by key) ---------------- */
const keyHash = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');
function agentByKey(req) {
  const k = req.headers['x-agent-key']; if (!k) return null;
  const hsh = keyHash(k);
  for (const a of agents.values()) if (a.keyHash.length === hsh.length && crypto.timingSafeEqual(Buffer.from(a.keyHash), Buffer.from(hsh))) return a;
  return null;
}
async function agentsApi(req, res, id, action) {
  if (req.method === 'GET' && !id) return send(res, 200, { items: [...agents.values()].map(agentPublic) });
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!adminOk(req)) return send(res, 401, { error: 'admin_token_required' });
  if (!id) {
    let j = {}; try { j = await readBody(req, 4096); } catch (e) { }
    const key = 'egk_' + crypto.randomBytes(18).toString('base64url');
    const a = { id: 'AGT-' + crypto.randomBytes(3).toString('hex').toUpperCase(), name: String(j.name || '').trim().slice(0, 60) || 'وسيط المصنع', keyHash: keyHash(key), created: Date.now(), lastSeen: 0, tests: new Map() };
    agents.set(a.id, a); saveAgents();
    log(C.c + '● AGENT' + C.x, 'created', a.name, C.dim + a.id + C.x);
    return send(res, 200, Object.assign(agentPublic(a), { key })); // the key is shown once
  }
  const a = agents.get(id);
  if (!a) return send(res, 404, { error: 'not_found' });
  if (action === 'delete') {
    for (const c of ipcams.values()) if (c.agentId === id) { ipcamStop(c); c.agentId = null; }
    agents.delete(id); saveAgents(); saveIpcams();
    return send(res, 200, { ok: true, id });
  }
  return send(res, 404, { error: 'not_found' });
}
async function agentApi(req, res, action, camId) {
  const a = agentByKey(req);
  if (!a) return send(res, 401, { error: 'bad_agent_key' });
  const first = !agentOnline(a);
  a.lastSeen = Date.now(); a.host = String(req.headers['x-agent-host'] || '').slice(0, 60); a.version = String(req.headers['x-agent-version'] || '').slice(0, 20);
  if (first) { log(C.g + '● AGENT' + C.x, 'online', a.name, C.dim + a.host + C.x); engine.emit('ipcam', { agentId: a.id, action: 'online' }); }
  if (action === 'poll') {
    const now = Date.now(), tests = [];
    for (const t of a.tests.values()) if (!t.sent) { t.sent = true; tests.push({ tid: t.tid, url: t.url }); }
    const cams = [...ipcams.values()].filter((c) => c.agentId === a.id).map((c) => ({ id: c.id, url: c.url, want: c.running && (c.viewers.size > 0 || now - c.lastViewer < 15000) }));
    return send(res, 200, { agent: { id: a.id, name: a.name }, cams, tests, fps: AGENT_FPS, width: AGENT_WIDTH });
  }
  if (action === 'frame') {
    const c = ipcams.get(camId);
    if (!c || c.agentId !== a.id) { req.resume(); return send(res, 404, { error: 'not_found' }); }
    let buf;
    try { buf = await readRaw(req, 4 * 1024 * 1024); } catch (e) { return send(res, 413, { error: e.message }); }
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return send(res, 415, { error: 'jpeg_only' });
    if (!c.running) return send(res, 410, { error: 'not_watched' });
    c.kind = 'agent'; ipcamFrame(c, buf);
    return send(res, 200, { ok: true });
  }
  let j = {};
  try { j = await readBody(req, 8 * 1024 * 1024); } catch (e) { return send(res, 400, { error: e.message }); }
  if (action === 'error') {
    const c = ipcams.get(camId);
    if (c && c.agentId === a.id && c.running) { c.state = 'error'; c.error = errAr(j.error); c.waiters.splice(0).forEach((fn) => fn(null)); log(C.r + '● IP CAM' + C.x, c.name, C.dim + 'agent: ' + c.error + C.x); }
    return send(res, 200, { ok: true });
  }
  if (action === 'test') {
    const t = a.tests.get(camId);
    if (t) t.done({ ok: !!j.ok, kind: j.kind || null, image: j.image || null, error: j.error || null });
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'not_found' });
}

function lanAddresses() { return Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address); }

/* ------------------------------------------------------------------ */
/* HTTP                                                                 */
/* ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.bin': 'application/octet-stream', '.onnx': 'application/octet-stream', '.wasm': 'application/wasm', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm'
};

function send(res, status, body, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Powered-By': 'DELMON & DEV SMART X' }, CORS, headers || {});
  res.writeHead(status, h);
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('payload_too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
}

async function api(req, res, pathname, query) {
  const t0 = Date.now();
  const cm = /^\/api\/v1\/cam\/([^/]+)(?:\/(frame|mjpeg|offer|answer))?$/.exec(pathname);
  if (cm) return camApi(req, res, cm[1], cm[2] || 'status');
  if (pathname === '/api/v1/streams') return STREAM.status().then((s) => send(res, 200, s));
  if (pathname === '/api/v1/learning/reviews') {
    if (!adminOk(req)) return send(res, 401, { error: 'admin_token_required' });
    const latest = {};
    for (const line of readJournal(REVIEWS_FILE)) { try { const r = JSON.parse(line); latest[r.incident] = r; } catch (e) { } }
    return send(res, 200, { items: Object.values(latest) });
  }
  const ic = /^\/api\/v1\/ipcams(?:\/([A-Za-z0-9-]+))?(?:\/(mjpeg|snapshot|delete|ptz|webrtc))?\/?$/.exec(pathname);
  if (ic) return ipcamApi(req, res, ic[1] || null, ic[2] || 'status');
  const ag = /^\/api\/v1\/agents(?:\/([A-Za-z0-9-]+))?(?:\/(delete))?\/?$/.exec(pathname);
  if (ag) return agentsApi(req, res, ag[1] || null, ag[2] || null);
  const am = /^\/api\/v1\/agent\/(poll|frame|error|test)(?:\/([A-Za-z0-9-]+))?$/.exec(pathname);
  if (am) return agentApi(req, res, am[1], am[2] || null);
  if (pathname === '/api/v1/admin/reset' && req.method === 'POST') {
    if (!adminOk(req)) return send(res, 401, { error: 'admin_token_required' });
    let j = {};
    try { j = JSON.parse((await readRaw(req, 4096)).toString('utf8') || '{}'); } catch (e) { }
    if (j.confirm !== 'RESET') return send(res, 400, { error: 'confirm_required' });
    return send(res, 200, resetData(!!j.people));
  }
  if (pathname === '/api/v1/netinfo') return send(res, 200, { lan: lanAddresses(), port: PORT, httpsPort: httpsServer ? HTTPS_PORT : null });
  if (pathname === '/api/v1/stream') {
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }, CORS));
    res.write('retry: 2000\n');
    res.write('event: hello\ndata: ' + JSON.stringify({ mode: 'server', version: engine.meta().version, ts: Date.now() }) + '\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    log(C.g + 'SSE' + C.x, 'client connected', C.dim + '(' + clients.size + ' live)' + C.x);
    return;
  }
  let body = {};
  if (req.method === 'POST') {
    try { body = await readBody(req, 16 * 1024 * 1024); } catch (e) { return send(res, 400, { error: e.message }); }
    if (/^\/api\/v1\/workers\/[^/]+\/delete$/.test(pathname) && !adminOk(req)) return send(res, 401, { error: 'admin_token_required' });
    // persist images to disk and journal the mutation
    if (pathname === '/api/v1/events' && body.evidence && body.evidence.image) {
      const f = saveDataUrl(body.evidence.image, 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
      if (f) body.evidence = Object.assign({}, body.evidence, { image: f });
    }
    // keep the big raw training frame out of the journal/engine; it is saved to the learning notebook after the id is known
    if (pathname === '/api/v1/events' && body.learn) { req._learn = body.learn; delete body.learn; }
    if (pathname === '/api/v1/events' && body.subject) { req._subject = String(body.subject); delete body.subject; } // referee-only crop
    // the referee's note can only come from this server, never from a browser
    if (/^\/api\/v1\/events\/[^/]+\/action$/.test(pathname) && body.action === 'referee') return send(res, 403, { error: 'referee_is_server_only' });
    if (pathname === '/api/v1/gate/log') {
      if (body.image) body.image = saveDataUrl(body.image, 'veh_' + Date.now()) || null;
      if (body.plateImage) body.plateImage = saveDataUrl(body.plateImage, 'plate_' + Date.now()) || null;
    }
    if (pathname === '/api/v1/workers' && body.photo && String(body.photo).indexOf('data:') === 0) body.photo = saveDataUrl(body.photo, 'worker_' + (body.id || 'new') + '_' + Date.now().toString(36)) || null;
    if (pathname === '/api/v1/attendance/sighting') {
      // check-in photo once per shift-day; the check-out photo is overwritten (at most once a minute)
      body.ts = +body.ts || Date.now();
      const info = body.image && engine.attendanceLookup(body.workerId, body.ts);
      if (info) {
        const base = 'att_' + String(body.workerId).replace(/[^A-Za-z0-9_-]/g, '_') + '_' + info.day;
        if (!info.rec) body.inImg = saveDataUrl(body.image, base + '_in');
        else if (body.ts - (info.rec.outImgTs || 0) > 60000 && body.ts - info.rec.lastTs >= engine.attSettings.gapSec * 1000) body.outImg = saveDataUrl(body.image, base + '_out');
      }
      delete body.image;
    }
  }
  const out = engine.handle(req.method, pathname, query, body);
  if (req.method === 'POST' && out.status === 200) {
    const j = engine.journalEntry(pathname, body, out.body);
    if (j) journal(j[0], j[1]);
    // save the raw frame behind a live alarm into the learning notebook, keyed by the event id
    if (pathname === '/api/v1/events' && out.body && req._learn) saveLearnEvent(out.body.incident || out.body.id, req._learn);
    if (pathname === '/api/v1/events' && out.body) refereeEvent(out.body, req._learn, req._subject); // second opinion on PPE alarms
    // the supervisor's decision on an AI detection (engine OR live lab) = the ground truth the AI student learns from
    if (/^\/api\/v1\/events\/[^/]+\/action$/.test(pathname) && out.body && /^(ai-engine|live-)/.test(out.body.source || '') && (out.body.incident || out.body.id)) {
      try { fs.appendFileSync(REVIEWS_FILE, JSON.stringify({ incident: out.body.incident || out.body.id, type: out.body.type, review: out.body.review, status: out.body.status, reviewer: out.body.reviewer || null, ts: Date.now() }) + '\n'); } catch (e) { /* non-fatal */ }
    }
  }
  send(res, out.status, out.body, { 'Server-Timing': 'engine;dur=' + (Date.now() - t0) });
  if (!/\/(system|summary|health)$/.test(pathname) && pathname !== '/api/v1/attendance/sighting') log(req.method === 'POST' ? C.y + 'POST' + C.x : C.dim + 'GET ' + C.x, pathname, (out.status === 200 ? C.g : C.r) + out.status + C.x, C.dim + (Date.now() - t0) + 'ms' + C.x);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  if (rel === '/console' || rel === '/console/') rel = '/console.html';
  const base = rel.indexOf('/data/') === 0 ? DATA : ROOT;
  const file = path.normalize(path.join(base, base === DATA ? rel.slice('/data'.length) : rel));
  // only evidence images are public under /data — never the journals or the camera list (credentials)
  const inside = (dir) => file === dir || file.startsWith(dir + path.sep);
  const privateData = inside(DATA) || inside(path.join(ROOT, 'data'));
  if (!file.startsWith(base) || file.includes(path.sep + '.') || inside(path.join(ROOT, 'server')) || inside(CERT_DIR) || inside(path.join(ROOT, 'bin')) || (privateData && !file.startsWith(EVID + path.sep) && !file.startsWith(path.join(ROOT, 'data', 'evidence') + path.sep))) return send(res, 403, { error: 'forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, '<h1>404</h1>', { 'Content-Type': 'text/html; charset=utf-8' });
    const ext = path.extname(file).toLowerCase();
    const cache = /\/(assets)\//.test(rel) && !/model\.json$/.test(rel) ? 'public, max-age=86400' : 'no-cache';
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache, 'X-Powered-By': 'DELMON & DEV SMART X' }, CORS));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// config.js from the environment on cloud hosts (Railway): EGIC_AI_URL, EGIC_ICE_SERVERS (JSON, e.g. a TURN server)
function runtimeConfig() {
  if (!process.env.EGIC_AI_URL && !process.env.EGIC_ICE_SERVERS) return null;
  const cfg = { apiBase: '', aiUrl: String(process.env.EGIC_AI_URL || '').replace(/\/+$/, '') };
  try { if (process.env.EGIC_ICE_SERVERS) cfg.iceServers = JSON.parse(process.env.EGIC_ICE_SERVERS); } catch (e) { console.error('EGIC_ICE_SERVERS is not valid JSON'); }
  return '/*! generated from environment */\nwindow.EGIC_CONFIG = ' + JSON.stringify(cfg) + ';\n';
}
function handler(req, res) {
  const u = url.parse(req.url, true); // eslint-disable-line n/no-deprecated-api
  if (u.pathname === '/config.js') { const js = runtimeConfig(); if (js) return send(res, 200, js, Object.assign({ 'Content-Type': 'text/javascript; charset=utf-8' }, CORS)); }
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (u.pathname.indexOf('/api/') === 0) return api(req, res, u.pathname, u.query).catch((e) => send(res, 500, { error: String(e && e.message || e) }));
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method_not_allowed' });
  serveStatic(req, res, u.pathname);
}
const server = http.createServer(handler);
const HTTPS_PORT = +process.env.HTTPS_PORT || 8443;
const CERT_DIR = path.join(ROOT, '.certs');
let httpsServer = null;
if (!process.env.RAILWAY_ENVIRONMENT && fs.existsSync(path.join(CERT_DIR, 'key.pem')) && fs.existsSync(path.join(CERT_DIR, 'cert.pem'))) {
  httpsServer = https.createServer({ key: fs.readFileSync(path.join(CERT_DIR, 'key.pem')), cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')) }, handler);
  httpsServer.on('error', (e) => { console.error(C.r + '  HTTPS ' + HTTPS_PORT + ': ' + e.message + C.x); httpsServer = null; });
  httpsServer.listen(HTTPS_PORT, process.env.HOST || '0.0.0.0');
}

loadIpcams();
const replayed = bootEngine();
if (STREAM.available) STREAM.start([...ipcams.values()].filter((c) => !c.temp && !c.agentId).map((c) => ({ id: c.id, url: c.url })));
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => { STREAM.stop(); process.exit(0); }));
process.on('exit', () => STREAM.stop());

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(C.b + '  EGIC · AI Safety & Smart Access Platform' + C.x);
  console.log('  ' + C.o + 'POWERED BY DELMON & DEV SMART X' + C.x);
  console.log('');
  console.log('  ● Executive briefing   ' + C.c + 'http://localhost:' + PORT + '/' + C.x);
  console.log('  ● Live console         ' + C.c + 'http://localhost:' + PORT + '/console.html' + C.x);
  if (HOST === '0.0.0.0') lanAddresses().forEach((ip) => console.log('  ● On your network      ' + C.c + 'http://' + ip + ':' + PORT + '/' + C.x));
  console.log('  ● API                  ' + C.dim + '/api/v1/*   ·   live stream /api/v1/stream' + C.x);
  if (httpsServer) lanAddresses().forEach((ip) => console.log('  ● Phone camera (HTTPS) ' + C.c + 'https://' + ip + ':' + HTTPS_PORT + '/phone.html' + C.x));
  console.log('  ● IP cameras           ' + C.dim + ipcams.size + ' saved · RTSP via ' + FFMPEG + C.x);
  console.log('  ● Live video           ' + (STREAM.available ? C.g + 'WebRTC (go2rtc)' + C.x + C.dim + ' · AI re-stream rtsp://127.0.0.1:8554/<camera>' + C.x : C.y + 'go2rtc not found — JPEG fallback only (put go2rtc.exe in platform/bin)' + C.x));
  console.log('  ● AI referee           ' + (REFEREE_MODE === 'off' || !REFEREE_KEY ? C.dim + 'off (no OpenRouter key)' + C.x : C.g + REFEREE_MODE + C.x + C.dim + ' · ' + REFEREE_MODEL + ' re-judges PPE alarms by the foundry gear rules' + C.x));
  console.log('  ● Mode                 ' + (DEMO ?C.y + 'DEMO (simulated data) — set EGIC_DEMO=0 in the factory' + C.x : C.g + 'FACTORY (real data only)' + C.x));
  console.log('  ● Engine               ' + C.g + 'ONLINE' + C.x + C.dim + '  (' + engine.events.length + ' events · ' + engine.gateLog.length + ' gate reads · ' + engine.workers.length + ' employees' + (replayed ? ' · ' + replayed + ' live records restored' : '') + ')' + C.x);
  console.log('');
  console.log(C.dim + '  Demo environment — simulated data is clearly labelled. Press Ctrl+C to stop.' + C.x);
  console.log('');
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(C.r + '  Port ' + PORT + ' is already in use. Try: PORT=8090 node server/server.js' + C.x);
  else console.error(e);
  process.exit(1);
});
