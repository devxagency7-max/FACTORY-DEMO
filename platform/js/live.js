/*!
 * EGIC · Live AI — real models on a real camera, wired to the dashboard
 *   • PPE Lab     : helmet · safety glasses · hi-vis vest  → screenshot → worker profile → events → KPIs
 *   • Behaviour AI: YOLO26-pose → SOS gesture · fall · unattended station · ergonomic posture
 *   • Egyptian ANPR: plate detector + Arabic character recognisers → gate log → decision → dwell time
 * POWERED BY DELMON & DEV SMART X
 */
(function () {
  'use strict';
  var U = window.EGICUI, API = window.EGICClient, SC = window.EGICScenes, ENG = window.EGICEngine;
  var h = U.h, clear = U.clear, S = U.S;
  var AI = null, faceapi = null;

  /* ------------------------------------------------------------------ */
  /* Loading                                                              */
  /* ------------------------------------------------------------------ */
  var scripts = {};
  function loadScript(src) {
    if (scripts[src]) return scripts[src];
    scripts[src] = new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { delete scripts[src]; rej(new Error('تعذر تحميل ' + src)); }; document.head.appendChild(s); });
    return scripts[src];
  }
  var core = null;
  function ensureCore() {
    if (core) return core;
    core = loadScript('assets/vendor/face-api.js').then(function () { return loadScript('js/ai.js'); }).then(function () {
      faceapi = window.faceapi; AI = window.EGICAI; AI.setTF(faceapi.tf);
      var tf = faceapi.tf;
      return tf.setBackend('webgl').catch(function () { return tf.setBackend('cpu'); }).then(function () { return tf.ready(); }).then(function () {
        try { tf.env().set('WEBGL_PACK', true); } catch (e) { }
        return tf.getBackend();
      });
    }).catch(function (e) { core = null; throw e; });
    return core;
  }
  var warmed = {};
  function ensureModel(name, onP) {
    return ensureCore().then(function () { return AI.load(name, onP); }).then(function () { if (warmed[name]) return; warmed[name] = AI.warmup(name); return warmed[name]; });
  }
  var faceP = null;
  function ensureFace() {
    if (faceP) return faceP;
    faceP = ensureCore().then(function () {
      var base = 'assets/models/face';
      return Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri(base), faceapi.nets.faceLandmark68TinyNet.loadFromUri(base), faceapi.nets.faceRecognitionNet.loadFromUri(base)]);
    }).catch(function (e) { faceP = null; throw e; });
    return faceP;
  }
  function fileProtocolNotice(box) {
    if (location.protocol !== 'file:') return false;
    box.appendChild(h('div', { class: 'card', style: { padding: '16px 18px', borderColor: 'rgba(247,146,36,.5)' } }, h('b', { text: 'تشغيل النماذج الحية يحتاج تشغيل البرنامج كتطبيق' }), h('p', { class: 'muted', style: { margin: '6px 0 0', fontSize: '13px' } }, 'المتصفح يمنع تحميل ملفات النماذج عند فتح الصفحة كملف مباشر. افتح البرنامج من تطبيق سطح المكتب «EGIC Platform»، أو شغّل الخادم (node server/server.js) ثم افتح http://localhost:8080، أو استخدم الرابط المستضاف.')));
    return true;
  }

  /* TITAN PPE server — live_server.py (port 8765) running TITAN_PPE/models/ppe_hf.onnx, the ppe_H.py model */
  // EGIC AI Engine (Python · app/main.py) — set window.EGIC_CONFIG.aiUrl (config.js); defaults to the local engine on :8765
  var TITAN_URL = ((window.EGIC_CONFIG && window.EGIC_CONFIG.aiUrl) || ('http://' + (location.hostname || 'localhost') + ':8765')).replace(/\/$/, ''), TITAN_CONF = 0.45;
  function titanHealth() {
    var ctl = window.AbortController ? new AbortController() : null, tm = setTimeout(function () { if (ctl) ctl.abort(); }, 2500);
    return fetch(TITAN_URL + '/health', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }).then(function (r) { clearTimeout(tm); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }, function (e) { clearTimeout(tm); throw e; });
  }
  var grab = null;
  // POST one JPEG frame to the AI engine; boxes come back in the engine's pixel space → map to source pixels
  function serverDetect(path, src, d) {
    var W = Math.min(960, d.w), sc = W / d.w, H = Math.round(d.h * sc);
    grab = grab || document.createElement('canvas');
    if (grab.width !== W || grab.height !== H) { grab.width = W; grab.height = H; }
    grab.getContext('2d').drawImage(src, 0, 0, W, H);
    return new Promise(function (res) { grab.toBlob(res, 'image/jpeg', 0.85); }).then(function (blob) {
      return fetch(TITAN_URL + path, { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
    }).then(function (r) { if (!r.ok) throw new Error('AI HTTP ' + r.status); return r.json(); }).then(function (j) {
      var map = function (arr) { return (arr || []).map(function (x) { return { x1: x.box[0] / sc, y1: x.box[1] / sc, x2: x.box[2] / sc, y2: x.box[3] / sc, score: x.score, label: x.label }; }); };
      var dets = map(j.dets); dets.schema = j.schema; dets.raw = j; dets.persons = map(j.persons);
      return dets;
    });
  }
  function titanDetect(src, d) { return serverDetect('/ppe/detect?conf=' + TITAN_CONF, src, d); }

  /* ------------------------------------------------------------------ */
  /* Phone camera pairing: QR → phone.html streams JPEG → MJPEG back here   */
  /* ------------------------------------------------------------------ */
  function newSession() { var a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
  // Phones open the camera only on https: use this page's origin when it is https (Vercel / Railway),
  // otherwise the local server's HTTPS port on the LAN address (scripts/make-local-cert.sh)
  function phonePageBase() {
    var here = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
    if (location.protocol === 'https:') return Promise.resolve({ base: here, secure: true });
    return fetch(API.state.base + '/api/v1/netinfo', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (n) {
      var ip = (n.lan || [])[0] || location.hostname;
      if (n.httpsPort) return { base: 'https://' + ip + ':' + n.httpsPort + '/', secure: true, local: true };
      return { base: 'http://' + ip + ':' + n.port + '/', secure: false };
    });
  }
  function pairPhone(onReady) {
    if (API.state.mode !== 'server') { U.toast('كاميرا الموبايل تحتاج سيرفر المنصة', 'شغّل: node server/server.js أو افتح النسخة المنشورة.', { kind: 'critical', ms: 8000 }); return; }
    var sid = newSession(), poll = null, done = false;
    var qrBox = h('div', { style: { background: '#fff', borderRadius: '14px', padding: '12px', width: 'min(280px, 70vw)', margin: '0 auto' } });
    var link = h('a', { class: 'mono', target: '_blank', rel: 'noopener', style: { fontSize: '11.5px', wordBreak: 'break-all', textAlign: 'center', display: 'block' } });
    var status = h('div', { class: 'verdict' }, h('span', { text: 'بانتظار اتصال الموبايل…' }), h('span', { class: 'spinner', style: { width: '16px', height: '16px' } }));
    var note = h('div', { class: 'muted', style: { fontSize: '12px', lineHeight: '1.7' } });
    U.openModal('📱 استخدم كاميرا الموبايل', h('div', { style: { display: 'grid', gap: '12px' } },
      h('div', { class: 'muted', style: { fontSize: '13px' }, text: 'امسح الكود بكاميرا الموبايل ← اضغط «تشغيل الكاميرا» ← المنصة هتتحول لكاميرا الموبايل لوحدها.' }),
      qrBox, link, status, note));
    var mb = U.$('#modalBody');
    mb.__onClose = function () { done = true; clearInterval(poll); };
    Promise.all([loadScript('assets/vendor/qrcode.js'), phonePageBase()]).then(function (r) {
      var b = r[1], url = b.base + 'phone.html?s=' + sid;
      var qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      link.href = url; link.textContent = url;
      if (b.local) note.textContent = 'شبكة محلية: الموبايل لازم يكون على نفس الواي فاي. أول مرة هيظهر تحذير أمان (شهادة محلية) ← «خيارات متقدمة» ← «متابعة».';
      if (!b.secure) note.textContent = '⚠️ الموبايل لن يفتح الكاميرا بدون https. شغّل: bash scripts/make-local-cert.sh ثم أعد تشغيل السيرفر، أو استخدم النسخة المنشورة.';
      var pc = null, rtcAt = 0;
      function finish(src) {
        if (done) return; done = true; clearInterval(poll); U.closeModal();
        U.toast('تم توصيل كاميرا الموبايل', src.kind === 'rtc' ? 'فيديو مباشر (WebRTC) — المنصة تحلل صورة الموبايل لحظيًا' : 'وضع بديل (صور) — الشبكة منعت الاتصال المباشر', { kind: 'live', ms: 5000 });
        onReady(src);
      }
      mb.__onClose = function () { if (!done && pc) try { pc.close(); } catch (e) { } done = true; clearInterval(poll); };
      poll = setInterval(function () {
        fetch(API.state.base + '/api/v1/cam/' + sid, { cache: 'no-store' }).then(function (x) { return x.json(); }).then(function (j) {
          if (done) return;
          if (j.offer && !pc) { status.firstChild.textContent = 'الموبايل اتصل — جارٍ فتح الفيديو المباشر…'; rtcAt = Date.now(); pc = answerPhone(sid, function (stream) { finish({ kind: 'rtc', stream: stream, pc: pc, sid: sid }); }); }
          // JPEG relay: phone fell back (no direct WebRTC path)
          if (j.connected && (!pc || Date.now() - rtcAt > 12000)) { if (pc) try { pc.close(); } catch (e) { } finish({ kind: 'mjpeg', url: API.state.base + '/api/v1/cam/' + sid + '/mjpeg', sid: sid }); }
        }).catch(function () { });
      }, 700);
    }).catch(function (e) { status.firstChild.textContent = 'تعذر إنشاء الكود: ' + e.message; });
  }
  var ICE = (window.EGIC_CONFIG && window.EGIC_CONFIG.iceServers) || [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  function answerPhone(sid, onStream) {
    var pc = new RTCPeerConnection({ iceServers: ICE }), stream = null, fired = false;
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addEventListener('track', function (e) { stream = e.streams[0] || new MediaStream([e.track]); try { e.receiver.playoutDelayHint = 0; e.receiver.jitterBufferTarget = 0; } catch (x) { } });
    pc.addEventListener('connectionstatechange', function () { if (pc.connectionState === 'connected' && stream && !fired) { fired = true; onStream(stream); } });
    fetch(API.state.base + '/api/v1/cam/' + sid + '/offer', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (o) {
      return pc.setRemoteDescription(o);
    }).then(function () {
      pc.getTransceivers().forEach(function (t) { t.direction = 'recvonly'; });
      return pc.createAnswer();
    }).then(function (a) { return pc.setLocalDescription(a); }).then(function () {
      return new Promise(function (res) { if (pc.iceGatheringState === 'complete') return res(); var t = setTimeout(res, 2500); pc.addEventListener('icegatheringstatechange', function () { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); });
    }).then(function () {
      return fetch(API.state.base + '/api/v1/cam/' + sid + '/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: pc.localDescription.type, sdp: pc.localDescription.sdp }) });
    }).catch(function (e) { console.error('WebRTC answer', e); });
    return pc;
  }
  // attach a paired phone (WebRTC stream or MJPEG relay) to a hidden-but-decoding <video>/<img>; resolves when frames flow
  function attachPhone(src, vid, im, st, onLost) {
    clearInterval(st.phoneWatch); st.phoneMode = src.kind; st.phonePc = src.pc || null;
    if (src.kind === 'rtc') {
      vid.srcObject = src.stream; vid.muted = true;
      var lostT = null;
      src.pc.addEventListener('connectionstatechange', function () {
        var cs = src.pc.connectionState;
        if (cs === 'connected') clearTimeout(lostT);
        else if (cs === 'disconnected' || cs === 'failed') { clearTimeout(lostT); lostT = setTimeout(function () { if (st.phonePc === src.pc && src.pc.connectionState !== 'connected') onLost(); }, cs === 'failed' ? 0 : 4000); }
      });
      st.phoneWatch = setInterval(function () {
        if (st.phonePc !== src.pc) return clearInterval(st.phoneWatch);
        src.pc.getStats().then(function (r) { r.forEach(function (x) { if (x.type === 'inbound-rtp' && x.kind === 'video') st.phoneFps = Math.round(x.framesPerSecond || 0); }); });
      }, 1000);
      return vid.play().then(function () { return new Promise(function (res) { (function w() { if (vid.videoWidth) return res(vid); setTimeout(w, 50); })(); }); });
    }
    return phoneSource(im, src.url, src.sid, st, onLost).then(function () { return im; });
  }
  function detachPhone(st, vid, im) {
    clearInterval(st.phoneWatch);
    if (st.phonePc) { try { st.phonePc.close(); } catch (e) { } st.phonePc = null; }
    try { vid.pause(); } catch (e) { } vid.srcObject = null; im.removeAttribute('src'); st.phoneMode = null;
  }
  // TF.js / ONNX can't read pixels from a multipart (MJPEG) <img> → copy the current frame to a canvas each tick
  function phoneFrame(st, el) {
    var c = st.phoneCanvas || (st.phoneCanvas = document.createElement('canvas'));
    var w = el.naturalWidth, hh = el.naturalHeight;
    if (!w || !hh) return null;
    if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; }
    c.getContext('2d').drawImage(el, 0, 0, w, hh);
    return c;
  }
  // attach the MJPEG relay to a (visually hidden, still decoding) <img> and resolve once the first frame is in
  function phoneSource(el, mjpegUrl, sid, st, onLost) {
    el.crossOrigin = 'anonymous';
    el.src = mjpegUrl + '?t=' + Date.now();
    var t0 = Date.now();
    var ready = new Promise(function (res, rej) {
      (function wait() { if (el.naturalWidth) return res(); if (Date.now() - t0 > 15000) return rej(new Error('لم يصل أي إطار من الموبايل')); setTimeout(wait, 100); })();
    });
    clearInterval(st.phoneWatch); var lostAt = 0;
    st.phoneWatch = setInterval(function () {
      if (st.srcKind !== 'phone') { clearInterval(st.phoneWatch); return; }
      fetch(API.state.base + '/api/v1/cam/' + sid, { cache: 'no-store' }).then(function (x) { return x.json(); }).then(function (j) {
        if (j.connected) { lostAt = 0; st.phoneFps = j.fps; return; }
        if (!lostAt) { lostAt = Date.now(); onLost(); }
      }).catch(function () { });
    }, 3000);
    return ready;
  }

  /* ------------------------------------------------------------------ */
  /* IP cameras: the server reads RTSP / MJPEG / snapshot URLs and re-serves  */
  /* them as same-origin MJPEG (/api/v1/ipcams/:id/mjpeg)                   */
  /* ------------------------------------------------------------------ */
  // POST that may need the ADMIN_TOKEN (camera changes, deleting employees)
  function adminPost(path, body) {
    var token = null; try { token = sessionStorage.getItem('egic-admin-token'); } catch (e) { }
    function go(t) { return fetch(API.state.base + '/api/v1/' + path, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, t ? { 'X-Admin-Token': t } : {}), body: JSON.stringify(body || {}) }); }
    return go(token).then(function (r) {
      if (r.status !== 401) return r;
      token = window.prompt('رمز الإدارة (ADMIN_TOKEN):'); if (!token) throw new Error('مطلوب رمز الإدارة');
      try { sessionStorage.setItem('egic-admin-token', token); } catch (e) { }
      return go(token);
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error || r.status); return j; }); });
  }
  var CAM_EXAMPLES = [
    ['Hikvision', 'rtsp://admin:password@192.168.1.64:554/Streaming/Channels/101'],
    ['Dahua', 'rtsp://admin:password@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0'],
    ['ONVIF / عام', 'rtsp://user:password@IP:554/stream1'],
    ['IP Webcam (موبايل أندرويد)', 'http://192.168.1.20:8080/video'],
    ['صورة Snapshot', 'http://admin:password@192.168.1.64/ISAPI/Streaming/channels/101/picture']
  ];
  // camera manager + picker. onPick(src) is optional: without it the dialog only manages cameras
  function ipCamDialog(onPick) {
    if (API.state.mode !== 'server') { U.toast('كاميرات IP تحتاج سيرفر المنصة', 'شغّل: node server/server.js أو افتح النسخة المنشورة.', { kind: 'critical', ms: 8000 }); return; }
    var list = h('div', { style: { display: 'grid', gap: '8px' } });
    var name = h('input', { class: 'input', placeholder: 'مثال: بوابة الموظفين' });
    var urlIn = h('input', { class: 'input mono', dir: 'ltr', placeholder: 'rtsp://user:pass@192.168.1.64:554/…', style: { fontSize: '12px' } });
    var siteSel = U.select(S.meta.sites.map(function (s) { return [s.id, s.name]; }), 'PLT-01', function () { });
    var viaSel = h('select', { class: 'select' }, h('option', { value: '', text: 'مباشر من السيرفر' }));
    var agentsBox = h('div', { style: { display: 'grid', gap: '8px' } }), setupBox = h('div');
    var serverUrl = (API.state.base || location.origin).replace(/\/$/, '');
    var cloud = !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
    var msg = h('div', { class: 'muted', style: { fontSize: '12px', lineHeight: '1.7' } });
    var preview = h('img', { alt: '', style: { display: 'none', width: '100%', borderRadius: '10px', border: '1px solid var(--line-2)' } });
    var editId = null;
    var testBtn = h('button', { class: 'btn', text: 'اختبار الاتصال' }), saveBtn = h('button', { class: 'btn btn--primary', text: 'حفظ الكاميرا' });
    var examples = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, CAM_EXAMPLES.map(function (x) { return h('button', { class: 'btn btn--xs btn--ghost', type: 'button', text: x[0], title: x[1], onclick: function () { urlIn.value = x[1]; urlIn.focus(); } }); }));
    function load() {
      fetch(API.state.base + '/api/v1/ipcams', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        clear(list);
        renderAgents(j.agents || []);
        if (!j.items.length) list.appendChild(h('div', { class: 'muted', style: { fontSize: '12.5px' }, text: 'لا توجد كاميرات محفوظة بعد — أضف أول كاميرا من النموذج بالأسفل.' }));
        j.items.forEach(function (c) {
          var dot = c.state === 'live' ? 'dot--on' : c.state === 'error' ? 'dot--off' : 'dot--idle';
          list.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '10px', alignItems: 'center', padding: '10px 12px', borderRadius: '10px', background: 'var(--bg-3)', border: '1px solid var(--line-1)' } },
            h('div', { style: { minWidth: 0 } }, h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { class: 'dot ' + dot }), h('b', { text: c.name }), h('span', { class: 'chip mono', text: c.protocol }), c.agentId ? h('span', { class: 'chip', title: c.agentOnline ? 'الوسيط متصل' : 'الوسيط مش متصل', text: (c.agentOnline ? '📡 ' : '⚠️ ') + c.agentName }) : null),
              h('div', { class: 'mono muted', dir: 'ltr', style: { fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'start' }, text: c.url }),
              c.error ? h('div', { style: { fontSize: '11.5px', color: '#ff9b9b' }, text: c.error }) : null),
            h('div', { style: { display: 'flex', gap: '6px' } },
              onPick ? h('button', { class: 'btn btn--xs btn--accent', text: 'تشغيل', onclick: function () { U.closeModal(); onPick({ kind: 'ipcam', id: c.id, name: c.name, webrtc: !!c.webrtc, url: API.state.base + '/api/v1/ipcams/' + c.id + '/mjpeg' }); } }) : null,
              h('button', { class: 'btn btn--xs', text: 'تعديل', onclick: function () { editId = c.id; name.value = c.name; urlIn.value = c.url; siteSel.value = c.siteId || 'PLT-01'; viaSel.value = c.agentId || ''; saveBtn.textContent = 'حفظ التعديل'; msg.textContent = 'كلمة المرور المخفية (****) هتفضل زي ما هي لو مغيرتهاش.'; } }),
              h('button', { class: 'btn btn--xs btn--danger', text: 'حذف', onclick: function () { if (!window.confirm('حذف الكاميرا «' + c.name + '»؟')) return; adminPost('ipcams/' + c.id + '/delete').then(load).catch(function (e) { msg.textContent = 'تعذر الحذف: ' + e.message; }); } }))));
        });
      }).catch(function (e) { clear(list).appendChild(h('div', { class: 'muted', text: 'تعذر تحميل الكاميرات: ' + e.message })); });
    }
    function renderAgents(ags) {
      var keep = viaSel.value;
      while (viaSel.options.length > 1) viaSel.remove(1);
      ags.forEach(function (a) { viaSel.appendChild(h('option', { value: a.id, text: 'عن طريق وسيط الشبكة: ' + a.name + (a.online ? '' : ' (مش متصل)') })); });
      viaSel.value = keep && ags.some(function (a) { return a.id === keep; }) ? keep : (editId ? '' : cloud && ags[0] ? ags[0].id : '');
      clear(agentsBox);
      ags.forEach(function (a) {
        agentsBox.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', padding: '8px 10px', borderRadius: '10px', background: 'var(--bg-3)', border: '1px solid var(--line-1)' } },
          h('span', { class: 'dot ' + (a.online ? 'dot--on' : 'dot--off') }), h('b', { text: a.name }),
          h('span', { class: 'muted', style: { fontSize: '11.5px' }, text: a.online ? 'متصل · ' + (a.host || '') + ' · ' + a.cams + ' كاميرا' : a.lastSeen ? 'آخر اتصال ' + U.ago(a.lastSeen) : 'لسه ماتشغلش' }),
          h('span', { style: { flex: 1 } }),
          h('button', { class: 'btn btn--xs btn--danger', text: 'حذف', onclick: function () { if (!window.confirm('حذف الوسيط «' + a.name + '»؟ الكاميرات اللي عليه هتتحول «مباشر من السيرفر».')) return; adminPost('agents/' + a.id + '/delete').then(load).catch(function (e) { msg.textContent = '✗ ' + e.message; }); } })));
      });
    }
    function newAgent() {
      var nm = window.prompt('اسم الوسيط (مثال: كمبيوتر أمن البوابة):', 'وسيط المصنع'); if (nm === null) return;
      adminPost('agents', { name: nm }).then(function (a) {
        var bat = agentLauncher(serverUrl, a.key, a.name);
        var cmd = 'node edge-agent.js --server ' + serverUrl + ' --key ' + a.key;
        clear(setupBox).appendChild(h('div', { style: { display: 'grid', gap: '8px', padding: '12px', borderRadius: '10px', border: '1px solid rgba(69,212,140,.45)', background: 'rgba(69,212,140,.06)' } },
          h('b', { text: '✓ اتعمل الوسيط «' + a.name + '» — شغّله على كمبيوتر جوه شبكة المصنع:' }),
          h('div', { style: { fontSize: '12.5px', lineHeight: '1.9' } }, '1) نزّل ملف التشغيل وحطه في فولدر لوحده على الكمبيوتر ده.', h('br'), '2) افتحه دبل كليك. أول مرة هينزّل البرنامج و ffmpeg لوحده (محتاج Node.js — لو مش متثبت هيفتحلك صفحة التحميل).', h('br'), '3) سيب الشباك مفتوح — هتلاقي النقطة جنب الوسيط بقت خضرا.'),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            h('button', { class: 'btn btn--sm btn--accent', text: '⬇ نزّل ملف التشغيل (Windows)', onclick: function () { var el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([bat], { type: 'application/octet-stream' })); el.download = 'EGIC-Agent.bat'; document.body.appendChild(el); el.click(); setTimeout(function () { URL.revokeObjectURL(el.href); el.remove(); }, 500); } }),
            h('a', { class: 'btn btn--sm', href: serverUrl + '/agent/edge-agent.js', download: 'edge-agent.js', text: '⬇ edge-agent.js (Linux / Raspberry Pi)' })),
          h('div', { class: 'muted', style: { fontSize: '11.5px' }, text: 'أمر التشغيل اليدوي (المفتاح ده بيظهر مرة واحدة بس — احتفظ بيه):' }),
          h('div', { class: 'code mono', dir: 'ltr', style: { fontSize: '11px', userSelect: 'all', wordBreak: 'break-all', textAlign: 'left' }, text: cmd })));
        load();
      }).catch(function (e) { msg.textContent = '✗ ' + e.message; });
    }
    testBtn.addEventListener('click', function () {
      testBtn.disabled = true; preview.style.display = 'none'; msg.textContent = 'جارٍ الاتصال بالكاميرا من السيرفر… (حتى 20 ثانية)';
      adminPost('ipcams/test', { url: urlIn.value.trim(), id: editId, agentId: viaSel.value || null }).then(function (j) {
        if (j.ok) { preview.src = j.image; preview.style.display = ''; msg.textContent = '✓ الكاميرا شغالة (' + ({ mjpeg: 'MJPEG', snapshot: 'Snapshot', ffmpeg: 'RTSP / ffmpeg' })[j.kind] + ') — اضغط «حفظ الكاميرا».'; }
        else msg.textContent = '✗ ' + j.error + (!viaSel.value && cloud ? ' — لو الكاميرا على شبكة المصنع، اختار «عن طريق وسيط الشبكة».' : '');
      }).catch(function (e) { msg.textContent = '✗ ' + e.message; }).then(function () { testBtn.disabled = false; });
    });
    saveBtn.addEventListener('click', function () {
      saveBtn.disabled = true;
      adminPost('ipcams', { id: editId, name: name.value.trim(), url: urlIn.value.trim(), siteId: siteSel.value, agentId: viaSel.value || null }).then(function (c) {
        U.toast('تم حفظ الكاميرا', c.name); editId = null; name.value = ''; urlIn.value = ''; preview.style.display = 'none'; saveBtn.textContent = 'حفظ الكاميرا'; msg.textContent = ''; load();
        API.get('cameras').then(function (r) { r.items.forEach(function (x) { S.cams[x.id] = x; }); });
      }).catch(function (e) { msg.textContent = '✗ ' + e.message; }).then(function () { saveBtn.disabled = false; });
    });
    U.openModal('🌐 كاميرات IP / NVR', h('div', { style: { display: 'grid', gap: '14px' } },
      h('div', { class: 'muted', style: { fontSize: '12.5px', lineHeight: '1.8' } }, cloud ? 'المنصة أونلاين، فمش هتشوف كاميرات شبكة المصنع مباشرة. شغّل «وسيط الشبكة» على أي كمبيوتر في المصنع: هو اللي بيقرا الكاميرات ويبعتها هنا، من غير فتح أي بورت في الراوتر.' : 'السيرفر هو اللي بيتصل بالكاميرا (RTSP أو MJPEG أو Snapshot) — لازم تكون على نفس الشبكة. ولو الكاميرات في مكان تاني، استخدم «وسيط الشبكة».'),
      list,
      h('div', { style: { borderTop: '1px solid var(--line-1)', paddingTop: '12px', display: 'grid', gap: '8px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h('div', { class: 'card-t', text: '📡 وسطاء الشبكة (Edge Agents)' }), h('span', { style: { flex: 1 } }), h('button', { class: 'btn btn--xs', text: '+ إضافة وسيط', onclick: newAgent })),
        agentsBox, setupBox),
      h('div', { style: { borderTop: '1px solid var(--line-1)', paddingTop: '12px', display: 'grid', gap: '10px' } },
        h('div', { class: 'card-t', text: 'إضافة كاميرا' }),
        h('div', { class: 'grid g-2', style: { gap: '10px' } }, h('label', { class: 'field' }, h('span', { text: 'اسم الكاميرا' }), name), h('label', { class: 'field' }, h('span', { text: 'الموقع' }), siteSel)),
        h('label', { class: 'field' }, h('span', { text: 'رابط البث (زي ما هو على شبكة المصنع)' }), urlIn),
        h('label', { class: 'field' }, h('span', { text: 'طريقة الاتصال' }), viaSel),
        h('div', null, h('div', { class: 'muted', style: { fontSize: '11.5px', marginBottom: '6px' }, text: 'أمثلة (اضغط لتعبئة الشكل ثم عدّل الـ IP وكلمة المرور) — لو كلمة المرور فيها @ أو : اكتبها %40 أو %3A:' }), examples),
        h('div', { class: 'row', style: { display: 'flex', gap: '8px' } }, testBtn, saveBtn), msg, preview)));
    load();
  }
  // Windows launcher: fetches the agent + ffmpeg on first run, then keeps the agent running (restarts it if it stops)
  function agentLauncher(server, key, name) {
    return ['@echo off', 'chcp 65001 >nul', 'title EGIC Edge Agent', 'cd /d "%~dp0"', 'echo EGIC Edge Agent - ' + String(name).replace(/[^\x20-\x7e]/g, '').trim(),
      'where node >nul 2>nul', 'if errorlevel 1 (', '  echo Node.js 18+ is required. Install it, then run this file again.', '  start https://nodejs.org/en/download', '  pause', '  exit /b 1', ')',
      'if exist edge-agent.js goto ffmpeg', 'echo Downloading the agent...', 'powershell -NoProfile -Command "Invoke-WebRequest -UseBasicParsing \'' + server + '/agent/edge-agent.js\' -OutFile \'edge-agent.js\'"',
      ':ffmpeg', 'if exist ffmpeg.exe goto run', 'echo Downloading ffmpeg for RTSP cameras - one time, about 90 MB...',
      'powershell -NoProfile -Command "$z=Join-Path $env:TEMP \'egic-ffmpeg.zip\'; $d=Join-Path $env:TEMP \'egic-ffmpeg\'; Invoke-WebRequest -UseBasicParsing \'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip\' -OutFile $z; Expand-Archive $z $d -Force; Copy-Item (Get-ChildItem $d -Recurse -Filter ffmpeg.exe | Select-Object -First 1).FullName \'ffmpeg.exe\'"',
      ':run', 'node edge-agent.js --server "' + server + '" --key "' + key + '"', 'echo Agent stopped - restarting in 5 seconds...', 'timeout /t 5 >nul', 'goto run', ''].join('\r\n');
  }
  // real video from the platform's go2rtc over WebRTC (the camera's own H.264, no re-encode); resolves with the <video>
  function ipcamVideo(src, vid, st) {
    var pc = new RTCPeerConnection({ iceServers: [] }), done = false;
    pc.addTransceiver('video', { direction: 'recvonly' });
    var p = new Promise(function (res, rej) {
      var to = setTimeout(function () { fail(new Error('webrtc_timeout')); }, 12000);
      function fail(e) { if (done) return; done = true; clearTimeout(to); try { pc.close(); } catch (x) { } rej(e); }
      pc.addEventListener('track', function (e) { vid.srcObject = e.streams[0] || new MediaStream([e.track]); vid.muted = true; try { e.receiver.playoutDelayHint = 0; e.receiver.jitterBufferTarget = 0; } catch (x) { } });
      pc.addEventListener('connectionstatechange', function () { if (pc.connectionState === 'failed') fail(new Error('webrtc_failed')); });
      pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () {
        return new Promise(function (r) { if (pc.iceGatheringState === 'complete') return r(); var t = setTimeout(r, 1500); pc.addEventListener('icegatheringstatechange', function () { if (pc.iceGatheringState === 'complete') { clearTimeout(t); r(); } }); });
      }).then(function () {
        return fetch(API.state.base + '/api/v1/ipcams/' + src.id + '/webrtc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'offer', sdp: pc.localDescription.sdp }) });
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; }); })
        .then(function (ans) { return pc.setRemoteDescription(ans); })
        .then(function () { return vid.play().catch(function () { }); })
        .then(function () { (function w() { if (done) return; if (vid.videoWidth) { done = true; clearTimeout(to); return res(pc); } setTimeout(w, 50); })(); })
        .catch(fail);
    });
    return p;
  }
  // attach an IP camera: real video over WebRTC when the server streams it (vid given), else MJPEG into a hidden <img>
  function attachIpCam(src, el, st, onLost, vid) {
    if (vid && src.webrtc && window.RTCPeerConnection && !st.noWebrtc) {
      clearInterval(st.phoneWatch); st.ipcam = src;
      return ipcamVideo(src, vid, st).then(function (pc) {
        st.phoneMode = 'rtc'; st.phonePc = pc;
        var lostT = null;
        pc.addEventListener('connectionstatechange', function () {
          var cs = pc.connectionState;
          if (cs === 'connected') clearTimeout(lostT);
          else if (cs === 'disconnected' || cs === 'failed') { clearTimeout(lostT); lostT = setTimeout(function () { if (st.phonePc === pc && pc.connectionState !== 'connected') onLost('انقطع بث الفيديو من الكاميرا'); }, cs === 'failed' ? 0 : 4000); }
        });
        st.phoneWatch = setInterval(function () {
          if (st.phonePc !== pc) return clearInterval(st.phoneWatch);
          pc.getStats().then(function (r) { r.forEach(function (x) { if (x.type === 'inbound-rtp' && x.kind === 'video') st.phoneFps = Math.round(x.framesPerSecond || 0); }); });
        }, 1000);
        return vid;
      }, function (e) {
        // no WebRTC path (firewall, remote access without TURN, codec) → JPEG stream
        console.warn('IP cam WebRTC unavailable, falling back to MJPEG:', e.message);
        return attachIpCam(src, el, st, onLost);
      });
    }
    clearInterval(st.phoneWatch); st.ipcam = src; st.phoneMode = 'mjpeg';
    el.crossOrigin = 'anonymous';
    el.src = src.url + '?t=' + Date.now();
    var t0 = Date.now(), lostAt = 0;
    st.phoneWatch = setInterval(function () {
      if (st.srcKind !== 'ipcam') return clearInterval(st.phoneWatch);
      fetch(API.state.base + '/api/v1/ipcams/' + src.id, { cache: 'no-store' }).then(function (x) { return x.json(); }).then(function (j) {
        st.phoneFps = j.fps;
        if (j.state === 'live') { lostAt = 0; return; }
        if (j.state === 'error' && !lostAt) { lostAt = Date.now(); onLost(j.error); }
      }).catch(function () { });
    }, 3000);
    return new Promise(function (res, rej) {
      (function wait() {
        if (st.srcKind !== 'ipcam') return rej(new Error('أُلغي'));
        if (el.naturalWidth) return res(el);
        if (Date.now() - t0 > 30000) return fetch(API.state.base + '/api/v1/ipcams/' + src.id).then(function (x) { return x.json(); }).then(function (j) { rej(new Error(j.error || 'لم يصل أي إطار من الكاميرا')); }, function () { rej(new Error('لم يصل أي إطار من الكاميرا')); });
        setTimeout(wait, 150);
      })();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Face templates — stored on the server, shared by every screen          */
  /* ------------------------------------------------------------------ */
  var FACES = {}, facesP = null, matcherCache = null, matcherKey = '';
  function loadFaces() {
    facesP = API.get('faces').then(function (r) { FACES = r.items || {}; S.faceIndex = FACES; matcherKey = ''; return FACES; }).catch(function () { return FACES; });
    return facesP;
  }
  API.on('faces', function () { loadFaces(); });
  API.on('reset', function () { loadFaces(); });
  // one-time move of face prints saved in this browser by the previous version → server
  function migrateLocalFaces() {
    var old = null; try { old = JSON.parse(localStorage.getItem('egic-faces') || 'null'); } catch (e) { }
    if (!old) return;
    var ids = Object.keys(old).filter(function (k) { return old[k] && old[k].length; });
    Promise.all(ids.map(function (k) { return API.post('faces', { workerId: k, descriptors: old[k] }).catch(function () { return null; }); })).then(function () { try { localStorage.removeItem('egic-faces'); } catch (e) { } loadFaces(); });
  }
  function hasFaces() { return Object.keys(FACES).some(function (k) { return FACES[k] && FACES[k].length; }); }
  // gallery of enrolled face prints (Float32Array per sample) — rebuilt only when enrolment changes
  function matcher() {
    if (!faceapi || !AI) return null;
    var key = Object.keys(FACES).map(function (k) { return k + FACES[k].length; }).join(',');
    if (key === matcherKey) return matcherCache;
    matcherKey = key;
    var g = {}, n = 0;
    Object.keys(FACES).forEach(function (k) { if (FACES[k] && FACES[k].length) { g[k] = FACES[k].map(function (d) { return new Float32Array(d); }); n++; } });
    matcherCache = n ? g : null;
    return matcherCache;
  }
  function srcDim(src) { return { w: src.videoWidth || src.naturalWidth || src.width, h: src.videoHeight || src.naturalHeight || src.height }; }
  function detectRaw(src, size, x0, y0) {
    return faceapi.detectAllFaces(src, new faceapi.TinyFaceDetectorOptions({ inputSize: size, scoreThreshold: 0.42 })).withFaceLandmarks(true).withFaceDescriptors().then(function (res) {
      return res.map(function (r) { var b = r.detection.box; return { box: { x1: b.x + x0, y1: b.y + y0, x2: b.x + b.width + x0, y2: b.y + b.height + y0 }, score: r.detection.score, descriptor: r.descriptor }; });
    });
  }
  var tileCv = null;
  // Many people at once: the whole frame, plus (for high-resolution sources) four overlapping 60 % tiles, so faces of
  // workers further away aren't shrunk to a few pixels by the detector's input size. Every face is then matched with
  // AI.matchFaces: one name per person, only when clearly that person.
  function detectFaces(src, size, opts) {
    var g = matcher(); if (!g) return Promise.resolve([]);
    opts = opts || {}; size = size || 512;
    var d = srcDim(src), steps = [function () { return detectRaw(src, size, 0, 0); }];
    if (opts.tiles && d.w >= 1280) {
      var tw = Math.round(d.w * 0.6), th = Math.round(d.h * 0.6);
      [[0, 0], [d.w - tw, 0], [0, d.h - th], [d.w - tw, d.h - th]].forEach(function (o) {
        steps.push(function () {
          var c = tileCv || (tileCv = document.createElement('canvas'));
          c.width = tw; c.height = th; c.getContext('2d').drawImage(src, o[0], o[1], tw, th, 0, 0, tw, th);
          return detectRaw(c, Math.min(size, 416), o[0], o[1]);
        });
      });
    }
    var all = [];
    return steps.reduce(function (p, step) { return p.then(step).then(function (r) { all = all.concat(r); }); }, Promise.resolve()).then(function () {
      var faces = AI.mergeFaceBoxes(all);
      var m = AI.matchFaces(faces.map(function (f) { return f.descriptor; }), g);
      return faces.map(function (f, i) { return { box: f.box, label: m[i].label, dist: m[i].dist, second: m[i].second }; });
    });
  }
  function faceCrop(src, box, size) {
    var w = box.x2 - box.x1, pad = w * 0.35, c = document.createElement('canvas'); c.width = c.height = size || 192;
    c.getContext('2d').drawImage(src, Math.max(0, box.x1 - pad), Math.max(0, box.y1 - pad * 1.2), w + pad * 2, (box.y2 - box.y1) + pad * 2.2, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  }
  // attendance: a face must match in 2 of the last 3 detections (≈ 1–2 s) before it counts; then at most one post a minute per person
  function Sighter(cameraIdFn, onSeen) { this.votes = {}; this.sent = {}; this.cameraIdFn = cameraIdFn; this.onSeen = onSeen; }
  Sighter.prototype.feed = function (faces, src) {
    var now = Date.now(), self = this;
    faces.forEach(function (f) {
      if (f.label === 'unknown') return;
      var v = self.votes[f.label] = (self.votes[f.label] || []).filter(function (t) { return now - t < 3000; }); v.push(now);
      if (v.length < 2 || (self.sent[f.label] && now - self.sent[f.label] < 60000)) return;
      self.sent[f.label] = now;
      var img = null; try { img = faceCrop(src, f.box, 192); } catch (e) { }
      API.post('attendance/sighting', { workerId: f.label, cameraId: self.cameraIdFn(), conf: Math.round((1 - f.dist) * 100) / 100, image: img }).then(function (r) { if (self.onSeen) self.onSeen(r, f, img); }).catch(function () { });
    });
  };

  /* face enrolment — a guided screen in 3 steps:
     ① who (and their consent)  ② the camera sees ONE clear face — a live box says what's wrong  ③ five shots, slightly
     different angles. What is stored is a 128-number face print per shot (not the photo); every camera compares faces to it. */
  var ENROLL_HINTS = ['بص للكاميرا على طول', 'ميّل راسك شوية يمين', 'ميّل راسك شوية شمال', 'ارفع دقنك شوية', 'بص للكاميرا تاني'];
  function enrollDialog(workerId, done, liveSrc) {
    var own = !liveSrc, stream = null, closed = false, capturing = false, checking = false, check = { ok: false }, raf = 0, timer = 0;
    var vid = h('video', { playsinline: true, muted: true, autoplay: true, style: { position: 'absolute', width: '1px', height: '1px', opacity: 0 } });
    var pv = h('canvas', { style: { width: '100%', display: 'block', borderRadius: '12px', background: '#000' } });
    var camMsg = h('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', textAlign: 'center', padding: '18px', color: '#fff', fontSize: '14px', lineHeight: '1.9', background: 'rgba(0,0,0,.72)', borderRadius: '12px' } },
      own ? '📷 المتصفح هيسألك عن الكاميرا (فوق على الشمال) — دوس «Allow» أو «سماح»' : 'جارٍ استخدام الكاميرا الشغالة…');
    var stage = h('div', { style: { position: 'relative', minHeight: '200px' } }, pv, vid, camMsg);
    var state = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600', fontSize: '14px', minHeight: '22px' } });
    var dots = h('div', { style: { display: 'flex', gap: '6px' } });
    var thumbs = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' } });
    for (var i = 0; i < 5; i++) { dots.appendChild(h('span', { style: { width: '12px', height: '12px', borderRadius: '50%', border: '2px solid var(--line-3, #456)' } })); thumbs.appendChild(h('div', { style: { aspectRatio: '1', borderRadius: '8px', background: 'var(--bg-3, #111)', border: '1px dashed var(--line-2, #345)' } })); }
    var consent = h('input', { type: 'checkbox', id: 'enrollConsent' });
    var profSel = h('select', { class: 'select', id: 'enrollWorker' });
    var go = h('button', { class: 'btn btn--primary', type: 'button', text: 'ابدأ التسجيل (5 لقطات)', disabled: true });
    var msg = h('div', { role: 'alert', style: { fontSize: '13px', minHeight: '18px', lineHeight: '1.7' } });
    var stepEls = [1, 2, 3].map(function (n) { return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: '10px', fontSize: '13px', border: '1px solid var(--line-2, #345)' } }, h('b', { text: String(n) }), h('span', { text: ['مين الموظف', 'الكاميرا تشوف وشه', '5 لقطات'][n - 1] })); });
    function setStep(n) { stepEls.forEach(function (el, i) { el.style.background = i + 1 === n ? 'var(--green-dim, rgba(43,161,96,.18))' : ''; el.style.borderColor = i + 1 <= n ? 'var(--green-hi, #45D48C)' : ''; }); }
    function say(ok, text) { clear(state); state.appendChild(h('span', { style: { width: '10px', height: '10px', borderRadius: '50%', background: ok ? '#45D48C' : '#FAB219', flex: 'none' } })); state.appendChild(h('span', { text: text })); }
    API.get('workers', { limit: 1000 }).then(function (r) {
      if (!r.items.length) profSel.appendChild(h('option', { value: '', text: 'مفيش موظفين — ضيف موظف الأول من «الموظفون والملفات»' }));
      var pick = workerId || (r.items.filter(function (w) { return !w.enrolled; })[0] || {}).id;
      r.items.forEach(function (w) { var o = h('option', { value: w.id, text: w.name + ' · ' + w.id + (w.enrolled ? ' · ✓ عنده بصمة (هتتسجل من جديد)' : ' · بدون بصمة') }); if (w.id === pick) o.selected = true; profSel.appendChild(o); });
      refresh();
    });
    var source = function () { return own ? vid : liveSrc(); };
    if (own) openCam().then(function (s) { if (closed) return stopStream(s); stream = s; vid.srcObject = s; return vid.play(); }).catch(function (e) { camMsg.textContent = '⚠️ ' + camErrMsg(e) + ' — من علامة القفل جنب العنوان، اسمح للكاميرا وافتح الشاشة دي تاني.'; });
    // live preview + face box, drawn every frame
    function draw() {
      if (closed) return;
      var src = source(), w = src && (src.videoWidth || src.naturalWidth || src.width), hh = src && (src.videoHeight || src.naturalHeight || src.height);
      if (w && hh) {
        if (camMsg.parentNode && (!own || vid.videoWidth)) camMsg.remove();
        if (pv.width !== w || pv.height !== hh) { pv.width = w; pv.height = hh; }
        var g = pv.getContext('2d'); g.save(); if (own) { g.translate(w, 0); g.scale(-1, 1); } g.drawImage(src, 0, 0, w, hh); g.restore();
        (check.boxes || []).forEach(function (b) {
          var x = own ? w - b.x2 : b.x1; g.lineWidth = Math.max(3, w / 220); g.strokeStyle = check.ok ? '#45D48C' : '#FAB219'; g.strokeRect(x, b.y1, b.x2 - b.x1, b.y2 - b.y1);
        });
      }
      raf = requestAnimationFrame(draw);
    }
    // is there exactly ONE clear face, close enough and lit enough?
    function inspect() {
      var src = source(), w = src && (src.videoWidth || src.naturalWidth || src.width), hh = src && (src.videoHeight || src.naturalHeight || src.height);
      if (!w || !faceapi) return Promise.resolve({ ok: false, boxes: [], why: own ? 'مستني الكاميرا…' : 'مستني صورة من الكاميرا…' });
      return faceapi.detectAllFaces(src, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })).then(function (all) {
        var boxes = all.map(function (r) { var b = r.box; return { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height }; });
        var big = boxes.filter(function (b) { return b.x2 - b.x1 > 50; });
        if (!boxes.length) return { ok: false, boxes: boxes, why: 'مش شايف وش — خلي الموظف يقف قدام الكاميرا ويبص لها' };
        if (big.length > 1) return { ok: false, boxes: boxes, why: 'فيه أكتر من شخص قدام الكاميرا — لازم الموظف يكون لوحده' };
        var b = big[0] || boxes[0], fh = b.y2 - b.y1;
        if (fh < Math.max(90, hh * 0.14)) return { ok: false, boxes: boxes, why: 'الوش صغير — قرّب من الكاميرا (حوالي متر)' };
        try {
          var c = document.createElement('canvas'); c.width = 32; c.height = 32; c.getContext('2d').drawImage(src, b.x1, b.y1, b.x2 - b.x1, fh, 0, 0, 32, 32);
          var d = c.getContext('2d').getImageData(0, 0, 32, 32).data, sum = 0; for (var k = 0; k < d.length; k += 4) sum += 0.3 * d[k] + 0.59 * d[k + 1] + 0.11 * d[k + 2];
          if (sum / 1024 < 55) return { ok: false, boxes: boxes, why: 'النور ضعيف على الوش — ولّع نور قدام الموظف (مش وراه)' };
        } catch (e) { }
        return { ok: true, boxes: boxes, box: b, why: 'الوش واضح ✓' };
      });
    }
    function refresh() {
      var who = !!profSel.value, agreed = consent.checked;
      setStep(!who || !agreed ? 1 : capturing ? 3 : 2);
      go.disabled = capturing || !who || !agreed || !check.ok;
      if (capturing) return;
      if (!who) say(false, 'اختار الموظف');
      else if (!agreed) say(false, 'علّم إن الموظف موافق');
      else say(check.ok, check.ok ? 'الوش واضح ✓ — دوس «ابدأ التسجيل»' : (check.why || 'مستني الكاميرا…'));
    }
    function loop() {
      if (closed) return;
      if (!capturing && !checking) {
        checking = true;
        ensureFace().then(inspect).then(function (c) { check = c; }, function () { }).then(function () { checking = false; refresh(); });
      }
      timer = setTimeout(loop, 350);
    }
    profSel.addEventListener('change', function () { resetShots(); refresh(); });
    consent.addEventListener('change', refresh);
    function resetShots() { [].forEach.call(dots.children, function (d) { d.style.background = ''; }); [].forEach.call(thumbs.children, function (t) { clear(t); t.style.border = '1px dashed var(--line-2, #345)'; }); }
    go.addEventListener('click', function () {
      capturing = true; msg.textContent = ''; resetShots(); refresh();
      var samples = [], tries = 0, lastBox = null;
      function one() {
        if (closed) throw new Error('اتقفلت الشاشة');
        say(true, 'لقطة ' + (samples.length + 1) + ' من 5 — ' + ENROLL_HINTS[samples.length]);
        return inspect().then(function (c) {
          check = c; tries++;
          if (!c.ok) { say(false, c.why); return; }
          return faceapi.detectSingleFace(source(), new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })).withFaceLandmarks(true).withFaceDescriptor().then(function (r) {
            if (!r) return;
            samples.push(Array.from(r.descriptor)); var b = r.detection.box; lastBox = { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height };
            dots.children[samples.length - 1].style.background = '#45D48C';
            var t = thumbs.children[samples.length - 1]; t.style.border = '1px solid #45D48C';
            try { t.appendChild(h('img', { src: faceCrop(source(), lastBox, 96), alt: '', style: { width: '100%', borderRadius: '8px', display: 'block', transform: own ? 'scaleX(-1)' : '' } })); } catch (e) { }
          });
        }).then(function () { if (samples.length < 5 && tries < 40) return new Promise(function (res) { setTimeout(res, 700); }).then(one); });
      }
      ensureFace().then(one).then(function () {
        if (samples.length < 3) throw new Error('ملقطش لقطات كفاية — قرّب من الكاميرا، وخلي النور قدام الموظف، وجرّب تاني');
        var wid = profSel.value, spread = 0;
        samples.forEach(function (a, i) { samples.forEach(function (b, j) { if (j > i) spread = Math.max(spread, AI.faceDist(a, b)); }); });
        if (spread > 0.6) throw new Error('اللقطات مش لنفس الشخص — حد دخل الكادر. خلي الموظف لوحده وجرّب تاني');
        var near = AI.nearestOther(samples, matcher() || {}, wid);
        if (near.id && near.d < 0.45) {
          var opt = [].filter.call(profSel.options, function (o) { return o.value === near.id; })[0];
          var other = opt ? opt.text.split(' · ')[0] : near.id;
          throw new Error('الوش ده شبه جدًا بصمة «' + other + '». اتأكد إن الموظف الصح هو اللي واقف. ولو بصمة «' + other + '» متسجلة غلط، امسحها من ملفه الأول.');
        }
        var photo = null; try { photo = faceCrop(source(), lastBox, 256); } catch (e) { }
        return API.post('faces', { workerId: wid, descriptors: samples, mode: 'replace' }).then(function () { return API.post('workers', { id: wid, photo: photo || undefined }); }).then(function (w) {
          loadFaces();
          capturing = false; setStep(3);
          clear(msg); msg.appendChild(h('div', { style: { color: '#45D48C', fontWeight: '700', fontSize: '15px' }, text: '✓ اتسجلت بصمة ' + w.name + ' — الكاميرات هتعرفه من دلوقتي وتسجل حضوره' }));
          U.toast('تم تسجيل بصمة الوجه', w.name);
          var opt2 = [].filter.call(profSel.options, function (o) { return o.value === wid; })[0]; if (opt2) opt2.text = w.name + ' · ' + w.id + ' · ✓ عنده بصمة (هتتسجل من جديد)';
          var next = [].filter.call(profSel.options, function (o) { return /بدون بصمة/.test(o.text); })[0];
          if (next) { profSel.value = next.value; msg.appendChild(h('div', { class: 'muted', text: 'اخترتلك الموظف اللي بعده: ' + next.text.split(' · ')[0] + ' — خليه يقف قدام الكاميرا.' })); resetShots(); }
          refresh();
          if (done) done(w);
        });
      }).catch(function (e) { capturing = false; msg.textContent = '⚠️ ' + e.message; refresh(); });
    });
    function closeIt() { closed = true; clearTimeout(timer); cancelAnimationFrame(raf); stopStream(stream); }
    U.openModal('تسجيل وش موظف', h('div', { style: { display: 'grid', gap: '12px' } },
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, stepEls),
      h('label', { class: 'field' }, h('span', { text: '① الموظف' }), profSel),
      h('label', { class: 'switch' }, consent, 'الموظف موافق على تسجيل بصمة وشه للحضور والسلامة'),
      h('div', { class: 'field' }, h('span', { text: '② الكاميرا — لازم يبان مربع أخضر حوالين الوش' }), stage),
      state,
      h('div', { class: 'field' }, h('span', { text: '③ اللقطات' }), dots, thumbs),
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, go, h('button', { class: 'btn btn--ghost', type: 'button', text: 'قفل', onclick: function () { U.closeModal(); } })),
      msg,
      h('details', { class: 'muted', style: { fontSize: '12.5px', lineHeight: '1.8' } }, h('summary', { text: 'إزاي الوش بيتسجل؟' }),
        h('div', { text: 'الكاميرا بتاخد 5 لقطات للوش من زوايا مختلفة شوية. كل لقطة بتتحول لبصمة رقمية (128 رقم بيوصفوا ملامح الوش)، والبصمات دي اللي بتتحفظ على السيرفر — مش الصور. لما أي كاميرا تشوف وش، بتحوّله لبصمة وتقارنه ببصمات كل الموظفين: لو قريب بوضوح من موظف واحد يتكتب اسمه، ولو مش متأكد يتكتب «غير معروف». الصورة الوحيدة اللي بتتحفظ هي صورة الملف.' }))));
    U.$('#modalBody').__onClose = closeIt;
    draw(); loop();
  }

  /* ------------------------------------------------------------------ */
  /* Shared canvas helpers                                                */
  /* ------------------------------------------------------------------ */
  var COL = { ok: '#45D48C', bad: '#FF4D4D', warn: '#FAB219', info: '#8FC7FF', orange: '#F79224' };
  function label(g, x, y, text, bg, fs, alignRight) {
    g.save(); g.font = '600 ' + fs + 'px "EGIC Sans", "Segoe UI", Tahoma, sans-serif';
    var rtl = /[؀-ۿ]/.test(text); g.direction = rtl ? 'rtl' : 'ltr';
    var w = g.measureText(text).width + fs * 0.9, hgt = fs * 1.55;
    var bx = alignRight ? x - w : x, by = y - hgt;
    var safeTop = g.canvas.height * 0.085;
    if (by < safeTop) by = Math.min(g.canvas.height - hgt, Math.max(safeTop, y + 2));
    bx = Math.max(2, Math.min(g.canvas.width - w - 2, bx));
    g.fillStyle = bg; SC.roundRect(g, bx, by, w, hgt, fs * 0.3); g.fill();
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = rtl ? 'right' : 'left';
    g.fillText(text, rtl ? bx + w - fs * 0.45 : bx + fs * 0.45, by + hgt / 2 + 1);
    g.restore();
  }
  function corners(g, b, col, lw) {
    var w = b.x2 - b.x1, hh = b.y2 - b.y1, L = Math.min(22, w * 0.22, hh * 0.22);
    g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round';
    [[b.x1, b.y1, 1, 1], [b.x2, b.y1, -1, 1], [b.x1, b.y2, 1, -1], [b.x2, b.y2, -1, -1]].forEach(function (c) { g.beginPath(); g.moveTo(c[0], c[1] + L * c[3]); g.lineTo(c[0], c[1]); g.lineTo(c[0] + L * c[2], c[1]); g.stroke(); });
  }
  function mirrorBox(b, W) { return { x1: W - b.x2, y1: b.y1, x2: W - b.x1, y2: b.y2 }; }
  function watermark(g, W, H, line1) {
    var fs = Math.max(12, Math.round(W / 64)), bh = fs * 2.3;
    g.fillStyle = 'rgba(4,8,6,.82)'; g.fillRect(0, H - bh, W, bh);
    g.fillStyle = '#F79224'; g.fillRect(0, H - bh, W, 3);
    g.font = '600 ' + fs + 'px "EGIC Sans", "Segoe UI", Tahoma, sans-serif'; g.textBaseline = 'middle';
    g.direction = 'rtl'; g.textAlign = 'right'; g.fillStyle = '#fff'; g.fillText(line1, W - fs * 0.8, H - bh / 2 + 1);
    g.direction = 'ltr'; g.textAlign = 'left'; g.font = '700 ' + Math.round(fs * 0.82) + 'px "Plex Mono", monospace'; g.fillStyle = '#F79224';
    g.fillText('POWERED BY DELMON & DEV SMART X', fs * 0.8, H - bh / 2 + 1);
  }
  var audioCtx = null;
  function beep(kind) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      var t = audioCtx.currentTime;
      (kind === 'sos' ? [880, 660, 880, 660] : [740, 520]).forEach(function (f, i) {
        var o = audioCtx.createOscillator(), gn = audioCtx.createGain();
        o.frequency.value = f; o.type = 'sine'; gn.gain.setValueAtTime(0.0001, t + i * 0.16); gn.gain.exponentialRampToValueAtTime(0.18, t + i * 0.16 + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.14);
        o.connect(gn); gn.connect(audioCtx.destination); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.16);
      });
    } catch (e) { }
  }
  function nowStr() { return U.fDate(Date.now()) + ' ' + U.fTime(Date.now()); }

  /* camera */
  function listCams() { return navigator.mediaDevices && navigator.mediaDevices.enumerateDevices ? navigator.mediaDevices.enumerateDevices().then(function (d) { return d.filter(function (x) { return x.kind === 'videoinput'; }); }) : Promise.resolve([]); }
  function openCam(deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('المتصفح لا يدعم الكاميرا في هذا السياق'));
    var c = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
    if (deviceId) c.deviceId = { exact: deviceId };
    return navigator.mediaDevices.getUserMedia({ video: c, audio: false });
  }
  function stopStream(st) { if (st) st.getTracks().forEach(function (t) { t.stop(); }); }
  function camErrMsg(e) {
    var denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    var framed = false; try { framed = window.top !== window.self; } catch (x) { framed = true; }
    if (denied && framed) return 'الكاميرا المباشرة غير متاحة داخل نافذة المعاينة المستضافة — استخدم «صورة / فيديو» أو العينات، أو نسخة سطح المكتب للكاميرا الحية.';
    if (denied) return 'يرجى السماح للمتصفح باستخدام الكاميرا (أيقونة القفل بجوار العنوان) ثم أعد المحاولة.';
    if (e && e.name === 'NotFoundError') return 'لا توجد كاميرا متصلة بهذا الجهاز.';
    if (e && e.name === 'NotReadableError') return 'الكاميرا مستخدمة في برنامج آخر — أغلقه ثم أعد المحاولة.';
    return (e && e.message) || String(e);
  }

  /* ------------------------------------------------------------------ */
  /* PPE / Behaviour lab                                                  */
  /* ------------------------------------------------------------------ */
  var PPE_KEYS = ['helmet', 'glasses', 'vest', 'gloves', 'ears'];
  var PPE_TYPES = { helmet: 'NO_HELMET', glasses: 'NO_GLASSES', vest: 'NO_VEST', gloves: 'NO_GLOVES', ears: 'NO_EARMUFFS' };
  var PPE_AR = { helmet: 'الخوذة', glasses: 'نظارة الوقاية', vest: 'السترة العاكسة', gloves: 'القفازات', ears: 'سماعات الأذن' };
  var PPE_EN = { helmet: 'NO HELMET', glasses: 'NO GLASSES', vest: 'NO VEST', gloves: 'NO GLOVES', ears: 'NO EAR PROTECTION' };
  var PPE_SUB = { helmet: 'HARD HAT', glasses: 'SAFETY GLASSES', vest: 'HI-VIS VEST', gloves: 'SAFETY GLOVES · لما الإيدين تبان', ears: 'EAR MUFFS · ضوضاء المكن' };
  var LAB = { mode: 'ppe', mirror: true, sound: true, autoTrack: false, required: { helmet: true, glasses: true, vest: true, gloves: true, ears: true }, idMode: 'auto', profileId: null, persistMs: 1500, stationSec: 8, ppeEngine: 'browser' };
  try { Object.assign(LAB, JSON.parse(localStorage.getItem('egic-lab') || '{}')); } catch (e) { }
  LAB.required = { helmet: true, glasses: true, vest: true, gloves: true, ears: true }; // PPE always checks the full set
  LAB.persistMs = 5000; // an item must be clearly missing for 5 s (wiping sweat, adjusting a visor) before anything is reported
  function saveLab() { try { localStorage.setItem('egic-lab', JSON.stringify({ mode: LAB.mode, mirror: LAB.mirror, sound: LAB.sound, autoTrack: LAB.autoTrack, required: LAB.required, idMode: LAB.idMode, profileId: LAB.profileId, stationSec: LAB.stationSec, ppeEngine: LAB.ppeEngine })); } catch (e) { } }

  U.register('live', function (v) {
    var st = { running: false, stream: null, src: null, srcKind: null, busy: false, last: null, pose: null, fps: 0, ms: 0, frames: 0, fpsT: performance.now(), tracker: null, lastFace: 0, faces: [], captures: [], behavior: { sosSince: 0, fallSince: 0, ergoSince: 0, absentSince: 0, present: false, cool: {} }, flip: 0, destroyed: false };
    U.onCleanup(function () { st.destroyed = true; st.running = false; stopStream(st.stream); if (st.url) URL.revokeObjectURL(st.url); });
    // PPE engine actually in use: 'titan' (live_server.py) or 'browser' (TF.js) — falls back to browser when TITAN is down
    var ppeEng = null, titanOk = false, titanErrT = 0;
    function ppeEngine() { return ppeEng || LAB.ppeEngine; }
    var titanSchema = null; // 'sh17' from the EGIC AI engine (has glasses) · null for the legacy TITAN ppe_hf.onnx
    function reqKeys() { return Object.keys(LAB.required).filter(function (k) { return LAB.required[k] && PPE_TYPES[k] && !(k !== 'helmet' && k !== 'vest' && ppeEngine() === 'titan' && titanSchema !== 'sh17'); }); }
    function hasPPE() { return LAB.mode === 'ppe' || LAB.mode === 'both'; }
    function hasPose() { return LAB.mode === 'behavior' || LAB.mode === 'both'; }
    function hasFire() { return LAB.mode === 'fire' || LAB.mode === 'both'; }
    function hasSmoking() { return LAB.mode === 'smoking' || LAB.mode === 'both'; }

    v.appendChild(U.viewHead('المختبر الحي — ذكاء اصطناعي حقيقي', 'الكاميرا بتتحلل لحظيًا. أي كشف بيتسجل بلقطة «بانتظار مراجعة المشرف»، ومابيدخلش ملف العامل غير لما مشرف يأكده.', [h('span', { class: 'badge badge--live', text: 'نماذج حقيقية · على الجهاز' })]));
    if (fileProtocolNotice(v)) return;

    // mode selector
    var modes = h('div', { class: 'mode-cards' });
    [['ppe', 'معدات الوقاية PPE', 'خوذة · نظارة · سترة · قفازات · سماعات أذن — YOLOv8s (SH17)', null],
      ['fire', 'الحريق والدخان', 'رصد اللهب والدخان لحظيًا + صفارة إنذار على كل الشاشات — YOLOv8n (D-Fire)', 'جديد · إنذار فوري'],
      ['smoking', 'كشف التدخين', 'سيجارة · فيب · دخان سيجارة داخل المنشأة — YOLOv8 / Ensemble', 'جديد'],
      ['behavior', 'ذكاء السلوك (Pose AI)', 'استغاثة بالإشارة · سقوط · ماكينة بدون مشغّل · وضعية خطرة — YOLO26', 'YOLO26'],
      ['both', 'الوضع الشامل', 'PPE + الحريق + التدخين + السلوك على نفس الكاميرا', null]].forEach(function (m) {
      var b = h('button', { type: 'button', class: 'mode-card', 'aria-pressed': String(LAB.mode === m[0]) }, m[3] ? h('span', { class: 'new', text: m[3] }) : null, h('b', { text: m[1] }), h('span', { text: m[2] }));
      b.addEventListener('click', function () { LAB.mode = m[0]; saveLab(); Array.prototype.forEach.call(modes.children, function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); prepareModels(); renderSide(); });
      modes.appendChild(b);
    });
    v.appendChild(modes);

    var lab = h('div', { class: 'lab' }); v.appendChild(lab);
    var canvas = h('canvas', { width: 1280, height: 720 });
    var video = h('video', { playsinline: true, muted: true, autoplay: true });
    var img = h('img', { alt: '', style: { display: 'none' } });
    var phoneImg = h('img', { alt: '', style: { position: 'absolute', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' } });
    var phoneVid = h('video', { playsinline: true, muted: true, autoplay: true, style: { position: 'absolute', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' } });
    var hudL = h('div', { class: 'l' }), hudR = h('div', { class: 'r' });
    var empty = h('div', { class: 'lab-empty' }, h('div', null,
      h('div', { style: { width: '64px', height: '64px', margin: '0 auto', borderRadius: '18px', display: 'grid', placeItems: 'center', background: 'rgba(43,161,96,.16)', color: 'var(--green-hi)' } }, U.icon('live')),
      h('h3', { text: 'ابدأ الكشف المباشر' }),
      h('p', { text: 'قف أمام الكاميرا. النظام هيشوف الخوذة والنظارة والسترة والقفازات وسماعات الأذن. لو حاجة ناقصة بوضوح لمدة 5 ثواني، هياخد لقطة ويبعتها للمشرف يراجعها.' }),
      h('div', { class: 'row' }, h('button', { class: 'btn btn--accent', onclick: function () { startCamera(); } }, U.icon('play'), 'تشغيل الكاميرا'), h('button', { class: 'btn', onclick: function () { pairPhone(startPhone); } }, '📱 كاميرا الموبايل'), h('button', { class: 'btn', onclick: function () { ipCamDialog(startIpCam); } }, '🌐 كاميرا IP'), h('label', { class: 'btn' }, U.icon('upload'), 'صورة / فيديو', h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' }, onchange: function (e) { if (e.target.files[0]) startFile(e.target.files[0]); } })))));
    var loading = h('div', { class: 'lab-loading hidden' }, h('div', { class: 'box' }, h('div', { class: 'spinner' }), h('div', { style: { marginTop: '14px', fontWeight: 600 }, id: 'ldT', text: 'تحميل النماذج…' }), h('div', { class: 'bar' }, h('i', { id: 'ldBar' })), h('div', { class: 'muted mono', style: { fontSize: '11px' }, id: 'ldS', text: '' })));
    var stage = h('div', { class: 'lab-stage' }, canvas, video, img, phoneImg, phoneVid, h('div', { class: 'lab-hud' }, hudL, hudR), h('div', { class: 'lab-brand' }, h('div', { class: 'powered' }, h('span', { class: 'dot' }), 'POWERED BY ', h('b', { text: 'DELMON' }), h('span', { class: 'amp', text: '&' }), h('b', { text: 'DEV SMART X' }))), empty, loading);
    // second lens / camera — live view beside the AI one (no heavy AI on the second, to stay smooth)
    var secondImg = h('img', { alt: '', style: { width: '100%', display: 'block', borderRadius: '12px', background: '#020403', aspectRatio: '16 / 9', objectFit: 'cover' } });
    var secondLabel = h('div', { style: { position: 'absolute', top: '8px', insetInlineStart: '8px', background: 'rgba(0,0,0,.55)', color: '#fff', padding: '4px 10px', borderRadius: '8px', fontSize: '12px' }, text: '' });
    var secondWrap = h('div', { style: { position: 'relative', flex: '1 1 0', minWidth: '0', display: 'none' } }, secondImg, secondLabel, h('button', { class: 'btn btn--xs', style: { position: 'absolute', top: '8px', insetInlineEnd: '8px' }, onclick: function () { hideSecond(); }, text: '✕ إغلاق' }));
    var stageRow = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' } }, h('div', { style: { flex: '1 1 0', minWidth: '0' } }, stage), secondWrap);
    var left = h('div', null, stageRow);
    function hideSecond() { secondImg.removeAttribute('src'); secondWrap.style.display = 'none'; }
    function showSecond(cam) { secondLabel.textContent = '📷 ' + cam.name + ' · بث مباشر'; secondImg.src = (API.state.base || '') + '/api/v1/ipcams/' + cam.id + '/mjpeg?t=' + (+new Date()); secondWrap.style.display = ''; }
    function pickSecondCam() {
      fetch((API.state.base || '') + '/api/v1/ipcams', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        var others = (j.items || []).filter(function (c) { return !(st.ipcam && c.id === st.ipcam.id); });
        if (!others.length) { U.toast('مفيش كاميرا/عدسة تانية', 'ضيف كاميرا IP تانية الأول من «🌐 كاميرا IP»', { kind: 'critical', ms: 7000 }); return; }
        if (others.length === 1) { showSecond(others[0]); return; }
        var box = h('div', { style: { display: 'grid', gap: '8px' } }, others.map(function (c) { return h('button', { class: 'btn', onclick: function () { U.closeModal(); showSecond(c); } }, '📷 ' + c.name); }));
        U.openModal('اختر العدسة / الكاميرا الثانية', box);
      }).catch(function () { U.toast('تعذر جلب الكاميرات', '', { kind: 'critical' }); });
    }
    U.onCleanup(hideSecond);
    var camSel = h('select', { class: 'select', style: { minWidth: '180px' } }, h('option', { value: '', text: 'الكاميرا الافتراضية' }));
    listCams().then(function (ds) { ds.forEach(function (d, i) { camSel.appendChild(h('option', { value: d.deviceId, text: d.label || ('كاميرا ' + (i + 1)) })); }); });
    var stopBtn = h('button', { class: 'btn', onclick: stop }, U.icon('stop'), 'إيقاف');
    var controls = h('div', { class: 'lab-controls' },
      h('button', { class: 'btn btn--accent', onclick: function () { startCamera(); } }, U.icon('play'), 'تشغيل الكاميرا'), h('button', { class: 'btn', onclick: function () { pairPhone(startPhone); } }, '📱 كاميرا الموبايل'), h('button', { class: 'btn', onclick: function () { ipCamDialog(startIpCam); } }, '🌐 كاميرا IP'), h('button', { class: 'btn', onclick: pickSecondCam, title: 'اعرض العدسة/الكاميرا التانية جنب دي' }, '📷 عدسة ثانية'), stopBtn, camSel,
      h('label', { class: 'btn' }, U.icon('upload'), 'صورة / فيديو', h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' }, onchange: function (e) { if (e.target.files[0]) startFile(e.target.files[0]); } })),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: LAB.mirror, onchange: function (e) { LAB.mirror = e.target.checked; saveLab(); } }), 'عكس الصورة'),
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: LAB.sound, onchange: function (e) { LAB.sound = e.target.checked; saveLab(); } }), 'تنبيه صوتي'),
      h('label', { class: 'switch', title: 'الكاميرا تلحق الوش/الشخص وتزوّم تلقائيًا، وتلف ناحية أي مخالفة أو خطر (كاميرات IP المتحركة فقط)' }, h('input', { type: 'checkbox', checked: LAB.autoTrack, onchange: function (e) { LAB.autoTrack = e.target.checked; saveLab(); if (ptzEl) ptzEl.style.opacity = LAB.autoTrack ? '0.5' : '1'; } }), '🎯 تتبّع تلقائي'));
    var engSel = U.select([['browser', 'محرك الذكاء: داخل الجهاز (المتصفح)'], ['titan', 'محرك الذكاء: خادم EGIC AI (Python)']], LAB.ppeEngine, function (x) { LAB.ppeEngine = x; saveLab(); st.tracker = null; prepareModels(); renderSide(); });
    var reqRow = h('div', { class: 'lab-controls' }, engSel, h('span', { class: 'muted', style: { fontSize: '12px' }, text: 'فحص PPE: ' + PPE_KEYS.map(function (k) { return PPE_AR[k]; }).join(' · ') }),
      h('label', { class: 'lab-ctl-pair muted', style: { fontSize: '12px' } }, 'مهلة غياب المشغّل (ثانية)', h('input', { class: 'input', id: 'stationSec', type: 'number', min: 3, max: 120, value: LAB.stationSec, style: { width: '70px', height: '30px' }, onchange: function (e) { LAB.stationSec = Math.max(3, +e.target.value || 8); saveLab(); } })));
    left.appendChild(controls); left.appendChild(reqRow);
    var side = h('div', { class: 'lab-side' });
    lab.appendChild(left); lab.appendChild(side);

    // ---------- side panel ----------
    var idCard, ppeRows = {}, verdict, timerBar, behav, caps, modelChips, idSel, hzList;
    function liveSrcFn() { return st.srcKind && st.srcKind !== 'image' ? function () { return st.src; } : null; }
    // handle ALL employees from the live screen: see everyone + enrol any of them straight from the running camera
    function allEmployeesPanel() {
      var list = h('div', { style: { display: 'grid', gap: '8px', maxHeight: '55vh', overflow: 'auto' } });
      function load() {
        API.get('workers', { limit: 1000 }).then(function (r) {
          clear(list);
          if (!r.items.length) { list.appendChild(h('div', { class: 'muted', style: { fontSize: '12.5px' }, text: 'لا يوجد موظفون بعد — أضفهم من «الموظفون والملفات».' })); return; }
          r.items.forEach(function (w) {
            list.appendChild(h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '10px', alignItems: 'center', padding: '8px 10px', borderRadius: '10px', background: 'var(--bg-3)', border: '1px solid var(--line-1)' } },
              h('span', { style: { width: '34px', height: '34px', borderRadius: '9px', overflow: 'hidden', background: 'var(--bg-4)', display: 'grid', placeItems: 'center', fontWeight: '700', fontSize: '11px', flex: 'none' } }, w.photo ? h('img', { src: API.evidenceUrl(w.photo), alt: '', style: { width: '100%', height: '100%', objectFit: 'cover' } }) : U.initials(w.name)),
              h('div', { style: { minWidth: 0 } }, h('b', { text: w.name }), h('div', { class: 'mono muted', style: { fontSize: '11px' }, text: w.id + ' · ' + w.dept })),
              w.enrolled ? h('button', { class: 'btn btn--xs btn--ghost', title: 'إعادة تسجيل الوجه', onclick: function () { enrollDialog(w.id, function () { loadFaces(); allEmployeesPanel(); }, liveSrcFn()); } }, '✓ وجه مسجل') : h('button', { class: 'btn btn--xs btn--accent', onclick: function () { enrollDialog(w.id, function () { loadFaces(); allEmployeesPanel(); }, liveSrcFn()); } }, 'سجّل وجهه')));
          });
        });
      }
      U.openModal('👥 كل الموظفين', h('div', { style: { display: 'grid', gap: '10px' } },
        h('div', { class: 'muted', style: { fontSize: '12.5px', lineHeight: '1.8' }, text: 'كل الموظفين وحالة بصمة الوجه. سجّل وجه أي موظف مباشرة من الكاميرا الشغّالة دلوقتي (خلي الموظف قريب وواضح قدام الكاميرا) — وبعدها النظام هيتعرف عليه تلقائيًا ويسجّل حضوره ومخالفاته.' }),
        list,
        h('a', { class: 'btn btn--sm', href: '#/workers', onclick: U.closeModal }, U.icon('userplus'), '+ إضافة / إدارة الموظفين')));
      load();
    }
    function renderSide() {
      clear(side);
      // identity
      var c1 = U.card('الهوية', { icon: 'workers', actions: [
        h('button', { class: 'btn btn--xs', onclick: allEmployeesPanel }, U.icon('workers'), 'كل الموظفين'),
        h('button', { class: 'btn btn--xs', onclick: function () { enrollDialog(LAB.profileId, renderSide, liveSrcFn()); } }, U.icon('userplus'), 'تسجيل وجه')] });
      idCard = h('div', { class: 'idcard' }, h('div', { class: 'ph', id: 'idPh', text: '?' }), h('div', null, h('b', { id: 'idName', text: '—' }), h('span', { id: 'idSub', text: 'بانتظار ظهور شخص' })));
      idSel = U.select([['auto', 'تعرّف تلقائي بالوجه'], ['fixed', 'ربط بملف محدد']], LAB.idMode, function (x) { LAB.idMode = x; saveLab(); profSel.style.display = x === 'fixed' || !hasFaces() ? '' : 'none'; });
      var profSel = h('select', { class: 'select' });
      profSel.appendChild(h('option', { value: '', text: 'بدون ربط بموظف' }));
      API.get('workers', { limit: 1000 }).then(function (r) { r.items.forEach(function (w) { var o = h('option', { value: w.id, text: w.name + ' · ' + w.id }); if (w.id === LAB.profileId) o.selected = true; profSel.appendChild(o); }); });
      profSel.addEventListener('change', function () { LAB.profileId = profSel.value || null; saveLab(); });
      profSel.style.display = LAB.idMode === 'fixed' || !hasFaces() ? '' : 'none';
      c1.body.appendChild(h('div', { style: { display: 'grid', gap: '10px' } }, idCard, h('div', { id: 'idRoster', style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } }), idSel, profSel, h('div', { class: 'muted', style: { fontSize: '11.5px' }, id: 'idHint', text: hasFaces() ? 'موظفون ببصمة وجه: ' + Object.keys(FACES).length + ' — أي وجه يتعرف عليه بيتسجل حضوره تلقائيًا.' : 'لا توجد بصمات وجه مسجلة بعد — سجّل وجوه الموظفين من «تسجيل وجه» أو من ملف الموظف.' })));
      side.appendChild(c1);
      // PPE checklist
      if (hasPPE()) {
        var c2 = U.card('فحص معدات الوقاية', { icon: 'helmet' });
        var list = h('div', { class: 'ppe-list' });
        PPE_KEYS.forEach(function (k) {
          var row = h('div', { class: 'ppe-row' + (LAB.required[k] ? '' : ' hidden') }, h('span', { class: 'ic' }, U.icon(k)), h('div', null, h('b', { text: PPE_AR[k] }), h('small', { text: PPE_SUB[k] })), h('span', { class: 'state-pill', text: '—' }));
          ppeRows[k] = row; list.appendChild(row);
        });
        verdict = h('div', { class: 'verdict' }, h('span', { id: 'vText', text: 'بانتظار الكشف' }), h('span', { class: 'mono muted', style: { fontSize: '11px' }, id: 'vSub', text: '' }));
        timerBar = h('div', { class: 'timer' }, h('i'));
        c2.body.appendChild(h('div', { style: { display: 'grid', gap: '10px' } }, list, verdict, timerBar));
        side.appendChild(c2);
      }
      if (hasFire() || hasSmoking()) {
        var c6 = U.card('الحريق والمخاطر', { icon: 'alert' });
        hzList = h('div', { class: 'ppe-list' });
        [['fire', '🔥', 'لهب / حريق', 'FIRE · إنذار حرج', hasFire()], ['smoke', '💨', 'دخان', 'SMOKE · إنذار مبكر', hasFire()], ['smoking', '🚬', 'تدخين', 'سيجارة · فيب', hasSmoking()]].forEach(function (r) {
          if (!r[4]) return;
          hzList.appendChild(h('div', { class: 'ppe-row', id: 'hz-' + r[0] }, h('span', { class: 'ic', style: { fontSize: '18px' }, text: r[1] }), h('div', null, h('b', { text: r[2] }), h('small', { text: r[3] })), h('span', { class: 'state-pill', text: '—' })));
        });
        c6.body.appendChild(hzList);
        c6.body.appendChild(h('div', { class: 'muted', style: { fontSize: '11.5px', marginTop: '8px' }, text: 'لا يُطلق الإنذار من إطار واحد: يلزم تكرار الرصد في عدة إطارات متتالية لتقليل الإنذارات الكاذبة.' }));
        side.appendChild(c6);
      }
      if (hasPose()) {
        var c3 = U.card('ذكاء السلوك · YOLO26-pose', { icon: 'posture' });
        behav = h('div', { class: 'ppe-list' });
        [['sos', 'sos', 'إشارة استغاثة', 'ارفع اليدين فوق الرأس ثانيتين'], ['fall', 'alert', 'سقوط / شخص على الأرض', 'وضع أفقي للجسم'], ['station', 'station', 'محطة التشغيل', 'غياب المشغّل عن المنطقة المحددة'], ['ergo', 'posture', 'وضعية العمل', 'زاوية انحناء الظهر']].forEach(function (b) {
          behav.appendChild(h('div', { class: 'ppe-row', id: 'bh-' + b[0] }, h('span', { class: 'ic' }, U.icon(b[1])), h('div', null, h('b', { text: b[2] }), h('small', { text: b[3] })), h('span', { class: 'state-pill', text: '—' })));
        });
        c3.body.appendChild(behav);
        side.appendChild(c3);
      }
      var c4 = U.card('آخر اللقطات المسجلة', { icon: 'reports', actions: [LAB.profileId ? h('a', { class: 'btn btn--xs', href: '#/workers/' + LAB.profileId, text: 'فتح الملف' }) : h('a', { class: 'btn btn--xs', href: '#/attendance', text: 'الحضور' })] });
      caps = h('div', { class: 'captures' });
      renderCaptures();
      c4.body.appendChild(caps);
      side.appendChild(c4);
      var c5 = U.card('النماذج', { icon: 'api' });
      modelChips = h('div', { class: 'modelbar' });
      c5.body.appendChild(modelChips);
      side.appendChild(c5);
      renderModelChips();
    }
    function renderCaptures() {
      if (!caps) return; clear(caps);
      if (!st.captures.length) { caps.appendChild(h('div', { class: 'muted', style: { gridColumn: '1 / -1', fontSize: '12px' }, text: 'لا توجد لقطات بعد.' })); return; }
      st.captures.slice(0, 6).forEach(function (c) { caps.appendChild(h('button', { type: 'button', title: c.title, onclick: function () { U.imageModal(c.img, c.title); } }, h('img', { src: c.img, alt: c.title }))); });
    }
    function renderModelChips() {
      if (!modelChips) return; clear(modelChips);
      var tf = faceapi ? faceapi.tf : null;
      modelChips.appendChild(h('span', { class: 'chip' }, 'Backend ', h('b', { text: tf ? tf.getBackend().toUpperCase() : '—' })));
      var srv = ppeEngine() === 'titan';
      if (hasPPE()) modelChips.appendChild(h('span', { class: 'chip' }, 'PPE ', h('b', { text: srv ? (titanOk ? 'خادم AI · YOLOv8s SH17' : 'خادم AI · جارٍ الاتصال') : AI && AI.loaded('ppe') ? 'YOLOv8s · SH17' : 'غير محمّل' })));
      if (hasFire()) modelChips.appendChild(h('span', { class: 'chip' }, 'Fire ', h('b', { text: srv && titanOk ? 'خادم AI · YOLOv8n D-Fire' : AI && AI.loaded('fire') ? 'YOLOv8n · D-Fire · ONNX' : 'غير محمّل' })));
      if (hasSmoking()) modelChips.appendChild(h('span', { class: 'chip' }, 'Smoking ', h('b', { text: srv && titanOk ? 'خادم AI · Ensemble YOLOv8+YOLO11m' : AI && AI.loaded('smoking') ? 'YOLOv8 · ONNX' : 'غير محمّل' })));
      if (hasPose()) modelChips.appendChild(h('span', { class: 'chip' }, 'Pose ', h('b', { text: AI && AI.loaded('pose') ? 'YOLO26n' : 'غير محمّل' })));
      modelChips.appendChild(h('span', { class: 'chip' }, 'Face ID ', h('b', { text: faceapi && faceapi.nets.faceRecognitionNet.isLoaded ? 'جاهز' : '—' })));
      modelChips.appendChild(h('span', { class: 'chip' }, 'المعالجة ', h('b', { text: 'على الجهاز · بدون سحابة' })));
    }
    renderSide();

    // ---------- model preparation ----------
    function setLoading(on, t, p, s) {
      loading.classList.toggle('hidden', !on);
      if (t) loading.querySelector('#ldT').textContent = t;
      if (p != null) loading.querySelector('#ldBar').style.width = Math.round(p * 100) + '%';
      if (s != null) loading.querySelector('#ldS').textContent = s;
    }
    var prepP = null, prepMode = null;
    function prepareModels() {
      var key = LAB.mode + ':' + LAB.ppeEngine;
      var retryTitan = LAB.ppeEngine === 'titan' && ppeEng === 'browser';
      if (prepP && prepMode === key && !retryTitan) return prepP;
      prepMode = key; ppeEng = null; titanOk = false;
      var need = { ppe: ['ppe'], behavior: ['pose'], fire: ['fire'], smoking: ['smoking'], both: ['fire', 'ppe', 'smoking', 'pose'] }[LAB.mode] || ['ppe'];
      var i = 0;
      var engP = LAB.ppeEngine === 'titan' && LAB.mode !== 'behavior'
        ? (setLoading(true, 'الاتصال بخادم EGIC AI…', 0.03, TITAN_URL), titanHealth().then(function (hj) { titanOk = true; titanSchema = hj && hj.models ? 'sh17' : null; return 'titan'; }, function () {
          U.toast('خادم EGIC AI غير متاح', TITAN_URL + ' — تم التحويل تلقائيًا لنماذج المتصفح على الجهاز.', { kind: 'critical', ms: 9000 });
          return 'browser';
        }))
        : Promise.resolve('browser');
      prepP = engP.then(function (eng) {
        ppeEng = eng; st.tracker = null;
        if (eng === 'titan') need = need.filter(function (n) { return n === 'pose' || (n === 'ppe' && titanSchema !== 'sh17'); });
        setLoading(true, 'تحميل محرك الذكاء الاصطناعي…', 0.05, 'TensorFlow.js · WebGL');
        return ensureCore();
      }).then(function (backend) {
        return need.reduce(function (p, name) {
          return p.then(function () {
            setLoading(true, 'تحميل نموذج ' + ({ ppe: 'معدات الوقاية (YOLOv8s · SH17)', pose: 'الوضعيات (YOLO26-pose)', fire: 'الحريق والدخان (YOLOv8n · D-Fire)', smoking: 'كشف التدخين (YOLOv8)' })[name] + '…', 0.1 + 0.7 * i / need.length, AI.REGISTRY[name].label + ' · ' + backend.toUpperCase());
            return ensureModel(name, function (f) { setLoading(true, null, 0.1 + 0.7 * (i + f) / need.length); }).then(function () { i++; });
          });
        }, Promise.resolve());
      }).then(function () {
        setLoading(true, 'تحميل التعرّف على الوجه…', 0.9, 'face-api · 128-D descriptors');
        return ensureFace().then(function () {
          // warm the three face nets on a blank frame behind the loader, so the first live face pass doesn't compile shaders mid-stream (first-seconds jank)
          setLoading(true, 'تهيئة التعرّف على الوجه…', 0.96, null);
          var c = document.createElement('canvas'); c.width = c.height = 512; c.getContext('2d').fillRect(0, 0, 512, 512);
          return faceapi.detectSingleFace(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.5 })).withFaceLandmarks(true).withFaceDescriptor().catch(function () { });
        }).catch(function () { return null; });
      }).then(function () { setLoading(false); renderModelChips(); if (st.srcKind) st.running = true; }).catch(function (e) { setLoading(true, 'تعذر تحميل النماذج', 1, e.message); prepP = null; });
      return prepP;
    }

    // ---------- sources ----------
    function startCamera() {
      stopSources();
      empty.classList.add('hidden');
      prepareModels();
      openCam(camSel.value || undefined).then(function (stream) {
        if (st.destroyed) { stopStream(stream); return; }
        st.stream = stream; video.srcObject = stream; st.src = video; st.srcKind = 'camera';
        return video.play().then(function () { st.running = true; st.tracker = null; loop(); });
      }).catch(function (e) {
        empty.classList.remove('hidden');
        U.toast('تعذر فتح الكاميرا', camErrMsg(e), { kind: 'critical', ms: 9000 });
      });
    }
    function startPhone(src) {
      stopSources();
      empty.classList.add('hidden');
      prepareModels();
      st.srcKind = 'phone';
      attachPhone(src, phoneVid, phoneImg, st, function () { U.toast('انقطع اتصال كاميرا الموبايل', 'تأكد أن صفحة الكاميرا مفتوحة على الموبايل — أو امسح الكود مرة أخرى', { kind: 'critical', ms: 7000 }); })
        .then(function (el) { if (st.srcKind !== 'phone') return; st.src = st.phoneMode === 'mjpeg' ? phoneFrame(st, phoneImg) : el; st.running = true; st.tracker = null; loop(); })
        .catch(function (e) { st.srcKind = null; empty.classList.remove('hidden'); U.toast('تعذر استقبال صورة الموبايل', e.message, { kind: 'critical' }); });
    }
    function startIpCam(src) {
      stopSources();
      empty.classList.add('hidden');
      prepareModels();
      st.srcKind = 'ipcam';
      attachIpCam(src, phoneImg, st, function (err) { U.toast('مشكلة في كاميرا IP: ' + src.name, err || 'انقطع البث — السيرفر بيحاول يعيد الاتصال', { kind: 'critical', ms: 8000 }); }, phoneVid)
        .then(function (el) { if (st.srcKind !== 'ipcam') return; st.src = st.phoneMode === 'mjpeg' ? phoneFrame(st, phoneImg) : el; st.running = true; st.tracker = null; showPtz(src.id); loop(); })
        .catch(function (e) { if (st.srcKind !== 'ipcam') return; stopSources(); empty.classList.remove('hidden'); U.toast('تعذر تشغيل كاميرا IP', e.message, { kind: 'critical', ms: 9000 }); });
    }
    // PTZ pad: control a moving / zoomable camera from the platform (ONVIF, via the server). Shows only for IP cameras that accept it.
    var ptzEl = null, ptzOk = true;
    function hidePtz() { if (ptzEl) { ptzEl.remove(); ptzEl = null; } }
    function ptzBtn(label, act, title) {
      var b = h('button', { type: 'button', title: title || '', style: { width: '40px', height: '40px', borderRadius: '10px', border: '1px solid rgba(255,255,255,.22)', background: 'rgba(10,20,16,.74)', color: '#fff', fontSize: '16px', cursor: 'pointer', display: 'grid', placeItems: 'center', touchAction: 'none', userSelect: 'none' } }, label);
      var moving = false;
      function send(a, ms) { return adminPost('ipcams/' + (st.ipcam && st.ipcam.id) + '/ptz', { act: a, ms: ms }); }
      function go(e) { if (e) e.preventDefault(); if (moving || !st.ipcam) return; moving = true; b.style.background = 'rgba(247,146,36,.85)'; send(act, 4000).then(function (r) { if (r && r.ok === false && ptzOk) { ptzOk = false; U.toast('التحكم في الكاميرا غير متاح', r.error || '', { kind: 'critical', ms: 7000 }); hidePtz(); } }).catch(function () { }); }
      function stop() { if (!moving) return; moving = false; b.style.background = 'rgba(10,20,16,.74)'; send('stop', 0).catch(function () { }); }
      b.addEventListener('pointerdown', go);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { b.addEventListener(t, stop); });
      return b;
    }
    function showPtz(camId) {
      hidePtz(); if (!ptzOk) return;
      var gap = function () { return h('span'); };
      ptzEl = h('div', { style: { position: 'absolute', insetInlineEnd: '12px', bottom: '46px', display: 'grid', gridTemplateColumns: 'repeat(3, 40px)', gap: '5px', padding: '8px', borderRadius: '13px', background: 'rgba(0,0,0,.38)', zIndex: '7' } },
        gap(), ptzBtn('▲', 'up', 'أعلى'), gap(),
        ptzBtn('◀', 'left', 'يسار'), ptzBtn('■', 'stop', 'إيقاف الحركة'), ptzBtn('▶', 'right', 'يمين'),
        ptzBtn('＋', 'zoomin', 'تقريب'), ptzBtn('▼', 'down', 'أسفل'), ptzBtn('－', 'zoomout', 'إبعاد'));
      if (LAB.autoTrack) ptzEl.style.opacity = '0.5';
      stage.appendChild(ptzEl);
    }
    // AI-driven PTZ: keep the subject centred and well-sized, and swing toward any violation / hazard when it fires
    function autoTrackTick(d, now) {
      if (!LAB.autoTrack || st.srcKind !== 'ipcam' || !st.ipcam || !ptzOk) return;
      if (now - (st.ptzAt || 0) < 650) return; // PTZ is slow — don't spam it
      var target = null, th = 0, band;
      if (st.alertTarget && now - st.alertTarget.t < 5000) { target = st.alertTarget.box; th = target.y2 - target.y1; band = [0.34, 0.82]; }       // 1) a fresh violation / hazard wins
      if (!target && st.faces && st.faces.length) { st.faces.forEach(function (f) { var hh = f.box.y2 - f.box.y1; if (hh > th) { th = hh; target = f.box; } }); if (target) band = [0.16, 0.42]; } // 2) the biggest face → zoom to recognise it
      if (!target && st.last && st.last.tracks) { st.last.tracks.forEach(function (t) { if (t.seen !== st.last.t) return; var hh = t.box.y2 - t.box.y1; if (hh > th) { th = hh; target = t.box; } }); if (target) band = [0.42, 0.85]; } // 3) the biggest person
      if (!target && st.pose && st.pose.poses) { st.pose.poses.forEach(function (p) { var hh = p.y2 - p.y1; if (hh > th) { th = hh; target = p; } }); if (target) band = [0.42, 0.85]; }
      if (!target) return; // nothing in view → hold position
      var ex = ((target.x1 + target.x2) / 2) / d.w - 0.5, ey = ((target.y1 + target.y2) / 2) / d.h - 0.5;
      var ax = Math.abs(ex), ay = Math.abs(ey), dz = 0.12, act = null;
      if (ax > dz && ax >= ay) act = ex > 0 ? 'right' : 'left';
      else if (ay > dz) act = ey > 0 ? 'down' : 'up';
      else { var frac = th / d.h; if (frac < band[0]) act = 'zoomin'; else if (frac > band[1]) act = 'zoomout'; }
      if (!act) return;
      st.ptzAt = now;
      var ms = (act === 'zoomin' || act === 'zoomout') ? 260 : Math.round(Math.min(600, Math.max(170, Math.max(ax, ay) * 1500)));
      adminPost('ipcams/' + st.ipcam.id + '/ptz', { act: act, ms: ms, speed: 0.5 }).then(function (r) { if (r && r.ok === false && ptzOk) { ptzOk = false; U.toast('التتبّع التلقائي غير متاح', r.error || '', { kind: 'critical', ms: 6000 }); } }).catch(function () { });
    }
    function camId() { return st.srcKind === 'ipcam' && st.ipcam ? st.ipcam.id : 'P01-CAM-LIVE'; }
    function camName() { return st.srcKind === 'ipcam' && st.ipcam ? st.ipcam.name : (S.cams['P01-CAM-LIVE'] || {}).name || 'كاميرا العرض'; }
    var sighter = new Sighter(camId, function (r, f, img) { if (r && r.isNew) U.toast('تسجيل حضور: ' + r.record.workerName, 'أول ظهور اليوم · ' + U.fTime(r.ts) + (r.record.late ? ' · متأخر ' + r.record.lateMin + ' د' : ''), { kind: 'live', img: img, action: ['الحضور', function () { U.navigate('#/attendance'); }] }); });
    function startFile(file) {
      stopSources();
      empty.classList.add('hidden');
      prepareModels();
      st.url = URL.createObjectURL(file);
      if (/^video\//.test(file.type)) {
        video.srcObject = null; video.src = st.url; video.loop = true; st.src = video; st.srcKind = 'video';
        video.play().then(function () { st.running = true; st.tracker = null; loop(); });
      } else {
        img.onload = function () { st.src = img; st.srcKind = 'image'; st.running = true; st.tracker = null; loop(); };
        img.src = st.url;
      }
    }
    function stopSources() { hidePtz(); if (st.srcKind === 'phone' || st.srcKind === 'ipcam') detachPhone(st, phoneVid, phoneImg); st.ipcam = null; st.running = false; stopStream(st.stream); st.stream = null; try { video.pause(); } catch (e) { } video.removeAttribute('src'); video.srcObject = null; if (st.url) { URL.revokeObjectURL(st.url); st.url = null; } st.srcKind = null; st.last = null; st.pose = null; st.startedAt = 0; st.inferEMA = 0; st.lastInfer = 0; st.lastFaceT = 0; st.faces = []; }
    function stop() { stopSources(); empty.classList.remove('hidden'); var g = canvas.getContext('2d'); g.fillStyle = '#020403'; g.fillRect(0, 0, canvas.width, canvas.height); }

    // ---------- main loop ----------
    function srcDims() { var s = st.src; return s ? { w: s.videoWidth || s.naturalWidth || s.width, h: s.videoHeight || s.naturalHeight || s.height } : { w: 0, h: 0 }; }
    // adaptive model schedule: fire + the mode's primary model stay dense; pose/smoking thin out only when the device is slow
    var SCHED = { ppe: ['ppe'], behavior: ['pose'], fire: ['fire'], smoking: ['smoking'], both: ['fire', 'ppe', 'fire', 'smoking', 'fire', 'pose'] };
    function schedule() {
      if (LAB.mode !== 'both') return SCHED[LAB.mode] || ['ppe'];
      var e = st.inferEMA || 0;
      if (e > 170) return ['fire', 'ppe', 'fire', 'smoking', 'fire', 'ppe', 'fire', 'pose']; // slow device: thin pose/smoking, never drop
      return SCHED.both;
    }
    // cap inference rate so the GPU keeps headroom for compositing the video (smoothness); loosen on fast devices, tighten on slow
    function inferMinMs() { var e = st.inferEMA || 0; return e > 140 ? 66 : e < 45 ? 30 : 45; }
    function faceMinMs() { return (st.inferEMA || 0) > 140 ? 1100 : 700; }

    function loop() {
      if (!st.running || st.destroyed) return;
      var now = performance.now();
      if (!st.startedAt) st.startedAt = now;
      var canvasSrc = (st.srcKind === 'phone' || st.srcKind === 'ipcam') && st.phoneMode === 'mjpeg';
      // display the camera frame every rAF so the video is smooth; for mjpeg/ipcam draw the <img> directly (one copy instead of two)
      var disp = canvasSrc ? phoneImg : st.src;
      var dw = disp && (disp.videoWidth || disp.naturalWidth || disp.width), dh = disp && (disp.videoHeight || disp.naturalHeight || disp.height);
      if (dw && dh) {
        if (canvas.width !== dw || canvas.height !== dh) { canvas.width = dw; canvas.height = dh; }
        var g = canvas.getContext('2d');
        var mir = LAB.mirror && st.srcKind === 'camera';
        g.save(); if (mir) { g.translate(dw, 0); g.scale(-1, 1); } g.drawImage(disp, 0, 0, dw, dh); g.restore();
        var d = { w: dw, h: dh };
        // inference: single-in-flight + rate-capped; refresh the inference canvas only when we actually run a model
        if (!st.busy && prepP && AI && now - (st.lastInfer || 0) >= inferMinMs()) {
          if (canvasSrc) st.src = phoneFrame(st, phoneImg) || st.src;
          st.lastInfer = now; st.busy = true;
          infer(d).then(function () { st.busy = false; }, function (e) { console.error(e); st.busy = false; });
        }
        kickFace(d, now, canvasSrc);
        autoTrackTick(d, now);
        drawOverlay(g, d, mir);
      }
      if (st.srcKind === 'image') { setTimeout(function () { requestAnimationFrame(loop); }, 120); } else requestAnimationFrame(loop);
    }

    // face recognition runs on its OWN guard + cadence, never stacked onto a model frame — keeps both smooth and reliable
    function kickFace(d, now, canvasSrc) {
      if (st.faceBusy || !(faceapi && faceapi.nets.faceRecognitionNet.isLoaded) || !matcher()) return;
      if (now - (st.lastFaceT || 0) < faceMinMs()) return;
      st.lastFaceT = now; st.faceBusy = true;
      if (canvasSrc) st.src = phoneFrame(st, phoneImg) || st.src;
      var fsrc = st.src;
      var fsize = (st.inferEMA || 0) > 200 ? 320 : (st.inferEMA || 0) > 110 ? 416 : 512; // smaller face net on slow devices
      detectFaces(fsrc, fsize, { tiles: (st.inferEMA || 0) < 120 }).then(function (faces) {
        st.faces = faces; st.facesT = Date.now();
        // only trust a face big enough to be reliable for identity — tiny far faces cause wrong matches
        var minH = Math.max(40, d.h * 0.035);
        var good = faces.filter(function (f) { return (f.box.y2 - f.box.y1) >= minH; });
        // each recognised face is assigned to its OWN person track, so several employees are identified at once
        if (st.tracker) good.forEach(function (f) { st.tracker.assignIdentity(f.box, f.label === 'unknown' ? '__unknown__' : f.label, 1 - f.dist); });
        if (st.srcKind !== 'image' && st.srcKind !== 'video') sighter.feed(good, fsrc); // a clear recognised face also marks attendance
      }).catch(function () { }).then(function () { st.faceBusy = false; });
    }

    function infer(d) {
      var t0 = performance.now(), now = Date.now();
      // first ~1.5s after start: run only the lightest model so the GPU settles and the opening is smooth
      var sched = (LAB.mode === 'both' && st.startedAt && t0 - st.startedAt < 1500) ? ['fire'] : schedule();
      var task = sched[st.flip++ % sched.length];
      var doPPE = task === 'ppe', doPose = task === 'pose', doFire = task === 'fire', doSmoking = task === 'smoking';
      var jobs = [];
      var titan = ppeEng === 'titan';
      if (doFire && (titan || AI.loaded('fire'))) jobs.push((titan ? serverDetect('/fire/detect', st.src, d) : AI.run('fire', st.src, { conf: { fire: 0.25, smoke: 0.4 }, iou: 0.45 })).then(function (dets) { hazards('fire', dets, d, now); }, serverErr));
      if (doSmoking && (titan || AI.loaded('smoking'))) jobs.push((titan ? serverDetect('/smoking/detect', st.src, d) : AI.run('smoking', st.src, { conf: { cigarette: 0.45, vape: 0.45, smoke: 0.45, person: 0.4 }, iou: 0.5 })).then(function (dets) { hazards('smoking', dets, d, now); }, serverErr));
      if (doPPE && (titan ? titanOk : AI.loaded('ppe'))) jobs.push((titan ? titanDetect(st.src, d) : AI.run('ppe', st.src, { conf: AI.PPE_CONF, iou: 0.5 })).then(function (dets) {
        if (!st.tracker) st.tracker = new AI.Tracker({ required: reqKeys(), persistMs: LAB.persistMs, cooldownMs: st.srcKind === 'image' ? 60000 : 25000 });
        var people = titan && dets.schema !== 'sh17' ? AI.analyzePPEHF(dets, d.w, d.h) : AI.analyzePPE(dets, d.w, d.h);
        var vio = st.tracker.update(people, now);
        st.last = { dets: dets, people: people, tracks: st.tracker.tracks.slice(), t: now };
        vio.forEach(function (x) { reportPPE(x.track, x.items, d); });
        checkPersonFall(people, d, now); // fall from the person box — works even when the pose skeleton can't read a lying body
      }, function (e) {
        if (!titan) throw e;
        serverErr(e);
      }));
      if (doPose && AI.loaded('pose')) jobs.push(AI.run('pose', st.src, { conf: 0.4, iou: 0.5, maxDet: 10 }).then(function (poses) { st.pose = { poses: poses, t: now }; behaviour(poses, d, now); }));
      return Promise.all(jobs).then(function () {
        var dt = performance.now() - t0; st.ms = Math.round(dt); st.frames++;
        st.inferEMA = st.inferEMA ? st.inferEMA * 0.85 + dt * 0.15 : dt; // smoothed inference time → drives the adaptive schedule + rate cap
        var el = performance.now() - st.fpsT; if (el > 1000) { st.fps = Math.round(st.frames * 1000 / el); st.frames = 0; st.fpsT = performance.now(); }
        updateSide();
      });
    }

    // identity resolution
    var workerCache = {};
    function workerInfo(id) {
      if (!id) return Promise.resolve(null);
      if (workerCache[id]) return Promise.resolve(workerCache[id]);
      return API.get('workers/' + encodeURIComponent(id)).then(function (w) { workerCache[id] = w; return w; }).catch(function () { return null; });
    }
    // Who did it: only the face-confirmed identity of THAT person's track. When unsure → null («غير محدد»),
    // and a supervisor identifies the worker from the evidence. Never guess between people.
    function resolveWorker(track) {
      if (!track) return null;
      if (track.identity) return track.identity;
      if (LAB.idMode === 'fixed' && LAB.profileId) {
        // «ربط بملف محدد» is for a one-person checkpoint: valid only while exactly one person is in view
        var seen = st.tracker && st.last ? st.tracker.tracks.filter(function (t) { return t.seen === st.last.t; }) : [track];
        return seen.length === 1 && seen[0] === track ? LAB.profileId : null;
      }
      return null;
    }
    // the person track a detection belongs to (a cigarette in the hand, a fallen body, a pose) — or null
    function trackFor(box) {
      if (!box || !st.tracker) return null;
      var c = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 }, best = null, bs = 0, nowT = Date.now();
      st.tracker.tracks.forEach(function (t) {
        if (nowT - t.seen > 2500) return;
        var b = t.box, s = AI.iou(b, box);
        if (c.x >= b.x1 && c.x <= b.x2 && c.y >= b.y1 && c.y <= b.y2) {
          var dx = c.x - (b.x1 + b.x2) / 2, dy = c.y - (b.y1 + b.y2) / 2, half = Math.max(1, Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2);
          s = Math.max(s, 0.3 + 0.2 * (1 - Math.min(1, Math.hypot(dx, dy) / half)));
        }
        if (s > bs) { bs = s; best = t; }
      });
      return bs >= 0.3 ? best : null;
    }

    // ---------- report PPE violation ----------
    function snapshot(boxesFn, d, title) {
      var W = Math.min(1280, d.w), sc = W / d.w, H = Math.round(d.h * sc);
      var c = document.createElement('canvas'); c.width = W; c.height = H;
      var g = c.getContext('2d'); g.drawImage(st.src, 0, 0, W, H);
      g.save(); g.scale(sc, sc); boxesFn(g, d); g.restore();
      watermark(g, W, H, title);
      return c.toDataURL('image/jpeg', 0.84);
    }
    var workerCool = {};
    function reportPPE(track, items, d) {
      var wid = resolveWorker(track);
      // unknown people churn track ids → key their cooldown by a coarse screen cell (not the id) so we don't spam the same violation
      var tnow = Date.now();
      var coolKey = wid || ('u' + Math.round(((track.box.x1 + track.box.x2) / 2) / 140) + '_' + Math.round(((track.box.y1 + track.box.y2) / 2) / 140));
      var coolMs = wid ? 30000 : 45000;
      items = items.filter(function (k) { var kk = coolKey + ':' + k; if (workerCool[kk] && tnow - workerCool[kk] < coolMs) return false; workerCool[kk] = tnow; return true; });
      if (!items.length) return;
      st.alertTarget = { box: track.box, t: performance.now() }; // auto-track swings to the PPE violation
      var title = 'EGIC · ' + camName() + ' · ' + nowStr();
      var imgUrl = snapshot(function (g) {
        var fs = Math.max(14, Math.round(d.w / 55));
        corners(g, track.box, COL.bad, Math.max(3, d.w / 320));
        // item boxes without text (dashed red = missing, thin green = worn) + ONE readable line per person
        items.forEach(function (k) { var it = track.items[k]; if (it && it.box) { g.setLineDash([10, 7]); g.strokeStyle = COL.bad; g.lineWidth = Math.max(3, d.w / 360); g.strokeRect(it.box.x1, it.box.y1, it.box.x2 - it.box.x1, it.box.y2 - it.box.y1); g.setLineDash([]); } });
        PPE_KEYS.forEach(function (k) { var it = track.items[k]; if (it && it.state === 'OK' && it.box) { g.strokeStyle = COL.ok; g.lineWidth = Math.max(2, d.w / 480); g.strokeRect(it.box.x1, it.box.y1, it.box.x2 - it.box.x1, it.box.y2 - it.box.y1); } });
        var who = workerCache[wid] ? workerCache[wid].name : 'عامل غير محدد';
        label(g, Math.max(0, Math.min(track.box.x1, d.w * 0.55)), Math.max(fs * 2, track.box.y1), who + ' · ناقص: ' + items.map(function (k) { return PPE_AR[k]; }).join('، '), 'rgba(120,14,14,.95)', fs);
      }, d, title);
      var incident = 'INC-' + Date.now().toString(36).toUpperCase();
      var conf = Math.max.apply(null, [0.8].concat(items.map(function (k) { return track.items[k] && track.items[k].score ? track.items[k].score : 0.85; })));
      st.captures.unshift({ img: imgUrl, title: items.map(function (k) { return 'بدون ' + PPE_AR[k]; }).join(' + ') + ' · ' + U.fTime(Date.now()) }); renderCaptures();
      stage.classList.remove('is-alert'); void stage.offsetWidth; stage.classList.add('is-alert');
      if (LAB.sound) beep();
      workerInfo(wid).then(function (w) {
        var posts = items.map(function (k) { return API.post('events', { type: PPE_TYPES[k], workerId: wid, cameraId: camId(), conf: Math.round(conf * 100) / 100, source: 'live-ai', incident: incident, missing: items, durationSec: Math.round((Date.now() - (track.since[k] || Date.now())) / 1000) + 1, evidence: { kind: 'live', image: imgUrl, model: ppeEng === 'titan' ? 'TITAN-PPE ppe_hf.onnx' : 'YOLOv8s-SH17' } }); });
        return Promise.all(posts).then(function (evs) {
          U.toast('كشف بانتظار مراجعة المشرف' + (w ? ' · ' + w.name + '؟' : ''), items.map(function (k) { return 'بدون ' + PPE_AR[k]; }).join(' · ') + ' · ' + (evs[0] ? evs[0].id : ''), { kind: 'live', img: imgUrl, action: evs[0] ? ['مراجعة', function () { U.openEvent(evs[0]); }] : null, ms: 7000 });
        });
      });
    }

    function serverErr(e) {
      if (ppeEng !== 'titan') throw e;
      if (Date.now() - titanErrT > 15000) { titanErrT = Date.now(); U.toast('انقطع الاتصال بخادم EGIC AI', TITAN_URL + ' · ' + e.message, { kind: 'critical', ms: 8000 }); }
    }

    // ---------- fire · smoke · smoking ----------
    var HZ_RULE = {
      fire: { need: 3, win: 5, type: 'FIRE_DETECTED', sev: 'CRITICAL', cool: 30000, ar: 'حريق', model: 'YOLOv8n · D-Fire' },
      smoke: { need: 4, win: 6, type: 'SMOKE_DETECTED', sev: 'HIGH', cool: 45000, ar: 'دخان', model: 'YOLOv8n · D-Fire' },
      smoking: { need: 4, win: 6, type: 'SMOKING_DETECTED', sev: 'HIGH', cool: 45000, ar: 'تدخين', model: 'YOLOv8 · cigarette/vape' }
    };
    var SMOKING_LABELS = { cigarette: 'سيجارة', vape: 'فيب', smoke: 'دخان سيجارة' };
    // only a cigarette-sized cigarette/vape at a person's head/hands is smoking — furnace steam and glare are
    // read as "smoke" (and a whole fume cloud as a "cigarette") on the EGIC site footage. Same rule as app/models/smoking.py
    function plausibleCigarettes(dets, d) {
      var persons = dets.filter(function (x) { return x.label === 'person' && x.score >= 0.35; });
      if (dets.raw) return dets.filter(function (x) { return x.label === 'cigarette' || x.label === 'vape'; }); // already filtered by the AI server
      return dets.filter(function (x) {
        if (x.label !== 'cigarette' && x.label !== 'vape') return false;
        if (x.x2 - x.x1 > d.w * 0.15 || x.y2 - x.y1 > d.h * 0.15) return false;
        var cx = (x.x1 + x.x2) / 2, cy = (x.y1 + x.y2) / 2;
        return persons.some(function (p) { var pw = p.x2 - p.x1, ph = p.y2 - p.y1; return cx >= p.x1 - pw * 0.15 && cx <= p.x2 + pw * 0.15 && cy >= p.y1 - ph * 0.05 && cy <= p.y1 + ph * 0.75; });
      });
    }
    st.hz = { fire: [], smoke: [], smoking: [], cool: {}, view: {} };
    function hazards(kind, dets, d, now) {
      var groups = kind === 'fire'
        ? { fire: dets.filter(function (x) { return x.label === 'fire'; }), smoke: dets.filter(function (x) { return x.label === 'smoke'; }) }
        : { smoking: plausibleCigarettes(dets, d) };
      if (kind === 'smoking' && dets.raw && dets.raw.smoking === false) groups.smoking = groups.smoking.filter(function (x) { return x.score >= 0.5; });
      st.hz.view[kind] = { dets: kind === 'fire' ? groups.fire.concat(groups.smoke) : groups.smoking, t: now };
      Object.keys(groups).forEach(function (k) {
        var R = HZ_RULE[k], w = st.hz[k], hits;
        if (k === 'smoking') {
          // smoking is confirmed per person: the hits must come from the same spot, not from different people in the frame
          var top = groups.smoking.slice().sort(function (a, b) { return b.score - a.score; })[0];
          var cx = top ? (top.x1 + top.x2) / 2 : 0, cy = top ? (top.y1 + top.y2) / 2 : 0, near = d.w * 0.12;
          w.push(top ? { x: cx, y: cy } : null); while (w.length > R.win) w.shift();
          hits = top ? w.filter(function (p) { return p && Math.hypot(p.x - cx, p.y - cy) < near; }).length : 0;
        } else {
          w.push(groups[k].length > 0); while (w.length > R.win) w.shift();
          hits = w.filter(Boolean).length;
        }
        if (groups[k].length && hits >= R.need && (!st.hz.cool[k] || now - st.hz.cool[k] > R.cool)) { st.hz.cool[k] = now; raiseHazard(k, groups[k], d); }
      });
    }
    // Fall from the PERSON box (any mode with the PPE/person detector): a clearly horizontal body on the ground
    function checkPersonFall(people, d, now) {
      var B = st.behavior;
      // a body cut off by the frame edge (close-up: head + shoulders + a raised hand) is wide too — it can't be judged
      var down = (people || []).filter(function (p) { var b = p.box; return !cutOff(b, d) && !b.synthetic && (b.x2 - b.x1) > (b.y2 - b.y1) * 1.5 && (b.y2 - b.y1) > d.h * 0.07; });
      var big = down.sort(function (a, b) { return (b.box.x2 - b.box.x1) * (b.box.y2 - b.box.y1) - (a.box.x2 - a.box.x1) * (a.box.y2 - a.box.y1); })[0];
      // a person down = horizontal AND staying in place for 3 s (someone walking past a low machine, or bending, isn't)
      var bc = big ? { x: (big.box.x1 + big.box.x2) / 2, y: (big.box.y1 + big.box.y2) / 2, w: big.box.x2 - big.box.x1 } : null;
      if (bc && B.pfallAt && Math.hypot(bc.x - B.pfallAt.x, bc.y - B.pfallAt.y) > B.pfallAt.w * 0.5) B.pfallSince = 0;
      if (bc) { if (!B.pfallSince) { B.pfallSince = now; B.pfallAt = bc; } } else { B.pfallSince = 0; B.pfallAt = null; }
      if (B.pfallSince && now - B.pfallSince > 3000 && (!B.cool.fall || now - B.cool.fall > 30000)) {
        B.cool.fall = now;
        raiseFall(big.box, d);
      }
    }
    function cutOff(b, d) { return b.y2 > d.h * 0.96 || b.y1 < d.h * 0.02 || b.x1 < d.w * 0.015 || b.x2 > d.w * 0.985; }
    function raiseFall(box, d) {
      st.alertTarget = { box: box, t: performance.now() };
      var wid = resolveWorker(trackFor(box));
      var imgUrl = snapshot(function (g) {
        var fs = Math.max(14, Math.round(d.w / 55));
        g.setLineDash([]); g.strokeStyle = COL.bad; g.lineWidth = Math.max(3, d.w / 300); g.strokeRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
        label(g, box.x1, box.y1, '🚑 سقوط / شخص على الأرض', 'rgba(170,20,20,.94)', fs);
      }, d, 'EGIC · سقوط / شخص على الأرض · ' + nowStr());
      st.captures.unshift({ img: imgUrl, title: 'سقوط · ' + U.fTime(Date.now()) }); renderCaptures();
      stage.classList.remove('is-alert'); void stage.offsetWidth; stage.classList.add('is-alert');
      if (LAB.sound) beep('sos');
      var body = { type: 'FALL', workerId: wid, cameraId: camId(), conf: 0.9, source: 'live-pose', sev: 'CRITICAL', evidence: { kind: 'live', image: imgUrl, model: 'Fall (person box)' }, note: 'شخص في وضع أفقي على الأرض' };
      var fb = { type: 'FALL', ts: Date.now(), sev: 'CRITICAL', cameraId: body.cameraId, conf: 0.9, evidence: {}, incident: 'FALL-' + Date.now().toString(36) };
      API.post('events', body).then(function (ev) { if (window.EGICAlarm) window.EGICAlarm.show(ev, { img: imgUrl }); U.toast('🚑 سقوط شخص', ev.siteName + ' · ' + U.fTime(ev.ts), { kind: 'critical', img: imgUrl, action: ['عرض', function () { U.openEvent(ev); }] }); }, function () { if (window.EGICAlarm) window.EGICAlarm.show(fb, { img: imgUrl }); });
    }
    function raiseHazard(k, dets, d) {
      var R = HZ_RULE[k], best = dets.slice().sort(function (a, b) { return b.score - a.score; })[0];
      if (best) st.alertTarget = { box: best, t: performance.now() }; // auto-track swings the camera to the hazard
      var col = k === 'fire' ? '#ff3b1f' : k === 'smoke' ? '#c9d1d9' : '#ffb000';
      var imgUrl = snapshot(function (g) {
        var fs = Math.max(14, Math.round(d.w / 55)), lw = Math.max(3, d.w / 300);
        dets.forEach(function (x) { g.strokeStyle = col; g.lineWidth = lw; g.strokeRect(x.x1, x.y1, x.x2 - x.x1, x.y2 - x.y1); label(g, x.x1, x.y1, (k === 'smoking' ? SMOKING_LABELS[x.label] : R.ar) + ' · ' + Math.round(x.score * 100) + '%', k === 'fire' ? 'rgba(180,20,10,.94)' : 'rgba(120,80,10,.92)', fs); });
      }, d, 'EGIC · إنذار ' + R.ar + ' · ' + nowStr());
      st.captures.unshift({ img: imgUrl, title: 'إنذار ' + R.ar + ' · ' + U.fTime(Date.now()) }); renderCaptures();
      stage.classList.remove('is-alert'); void stage.offsetWidth; stage.classList.add('is-alert');
      var wid = k === 'smoking' ? resolveWorker(trackFor(best)) : null;
      var body = { type: R.type, workerId: wid, cameraId: camId(), conf: best ? Math.round(best.score * 100) / 100 : 0.9, source: 'live-' + (k === 'smoking' ? 'smoking' : 'fire'), sev: R.sev, evidence: { kind: 'live', image: imgUrl, model: (ppeEng === 'titan' ? 'EGIC AI · ' : '') + (k === 'smoking' && ppeEng === 'titan' ? 'Ensemble YOLOv8 + YOLO11m' : R.model) }, note: k === 'smoking' ? 'رُصد تدخين (' + dets.map(function (x) { return SMOKING_LABELS[x.label]; }).filter(Boolean).join('، ') + ') في منطقة يُمنع فيها التدخين' : 'رصد ' + R.ar + ' مؤكد عبر ' + R.need + ' إطارات متتالية' };
      var fallback = { type: R.type, ts: Date.now(), conf: body.conf, sev: R.sev, cameraId: body.cameraId, evidence: { model: body.evidence.model }, incident: 'HZ-' + Date.now().toString(36) };
      API.post('events', body).then(function (ev) {
        if (window.EGICAlarm) window.EGICAlarm.show(ev, { img: imgUrl });
      }, function () { if (window.EGICAlarm) window.EGICAlarm.show(fallback, { img: imgUrl }); });
    }

    // ---------- behaviour (pose) ----------
    function stationRoi(d) { return { x1: d.w * 0.22, y1: d.h * 0.18, x2: d.w * 0.78, y2: d.h * 0.98 }; }
    function behaviour(poses, d, now) {
      var B = st.behavior, primary = poses.slice().sort(function (a, b) { return (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1); })[0];
      var roi = stationRoi(d);
      var present = poses.some(function (p) { var cx = (p.x1 + p.x2) / 2, cy = (p.y1 + p.y2) / 2; return cx > roi.x1 && cx < roi.x2 && cy > roi.y1 && cy < roi.y2; });
      if (present) { B.absentSince = 0; B.present = true; } else if (!B.absentSince) B.absentSince = now;
      B.analysis = primary ? AI.analyzePose(primary) : null;
      var a = B.analysis;
      if (a && a.sos) { if (!B.sosSince) B.sosSince = now; } else B.sosSince = 0;
      if (a && a.fall && !cutOff(primary, d)) { if (!B.fallSince) B.fallSince = now; } else B.fallSince = 0;
      if (a && a.trunkAngle != null && a.trunkAngle >= 45 && !a.fall) { if (!B.ergoSince) B.ergoSince = now; } else B.ergoSince = 0;
      function fire(key, type, ms, cool, text, sev) {
        if (!B.cool[key] || now - B.cool[key] > cool) {
          B.cool[key] = now;
          if (primary && type !== 'UNATTENDED_STATION') st.alertTarget = { box: primary, t: performance.now() }; // auto-track swings to the fall/SOS

          var wid = type === 'UNATTENDED_STATION' ? null : resolveWorker(trackFor(primary));
          var imgUrl = snapshot(function (g) { drawPoses(g, poses, d, false, true); if (type === 'UNATTENDED_STATION') drawRoi(g, roi, true, d); }, d, 'EGIC · ' + text + ' · ' + nowStr());
          st.captures.unshift({ img: imgUrl, title: text + ' · ' + U.fTime(now) }); renderCaptures();
          stage.classList.remove('is-alert'); void stage.offsetWidth; stage.classList.add('is-alert');
          if (LAB.sound) beep(type === 'SOS_GESTURE' ? 'sos' : null);
          API.post('events', { type: type, workerId: type === 'UNATTENDED_STATION' ? null : wid, cameraId: camId(), conf: 0.9, source: 'live-pose', sev: sev, evidence: { kind: 'live', image: imgUrl, model: 'YOLO26n-pose' }, note: type === 'UNATTENDED_STATION' ? 'لا يوجد مشغّل في منطقة المحطة لأكثر من ' + LAB.stationSec + ' ث' : '' }).then(function (ev) {
            if (type !== 'SOS_GESTURE') U.toast('Pose AI: ' + text, ev.id + ' · ' + ev.siteName, { kind: type === 'FALL' ? 'critical' : 'live', img: imgUrl, action: ['عرض', function () { U.openEvent(ev); }] });
          });
        }
      }
      if (B.sosSince && now - B.sosSince > 2500) fire('sos', 'SOS_GESTURE', 2500, 20000, 'إشارة استغاثة يدوية', 'CRITICAL');
      if (B.fallSince && now - B.fallSince > 3000) fire('fall', 'FALL', 3000, 30000, 'سقوط / شخص على الأرض', 'CRITICAL');
      if (B.ergoSince && now - B.ergoSince > 3000) fire('ergo', 'ERGONOMIC_RISK', 3000, 30000, 'وضعية عمل خطرة (انحناء الظهر)', 'LOW');
      if (B.present && B.absentSince && now - B.absentSince > LAB.stationSec * 1000) { fire('station', 'UNATTENDED_STATION', 0, 30000, 'ماكينة بدون مشغّل', 'MEDIUM'); B.present = false; }
    }
    function drawRoi(g, roi, alert, d) {
      g.save(); g.setLineDash([12, 8]); g.lineWidth = Math.max(2, d.w / 500); g.strokeStyle = alert ? COL.bad : 'rgba(143,199,255,.9)'; g.strokeRect(roi.x1, roi.y1, roi.x2 - roi.x1, roi.y2 - roi.y1); g.setLineDash([]);
      label(g, roi.x1, roi.y1 + Math.max(16, d.w / 60) * 1.6, 'منطقة المشغّل · OPERATOR ZONE', alert ? 'rgba(160,20,20,.9)' : 'rgba(20,60,110,.85)', Math.max(12, Math.round(d.w / 70)));
      g.restore();
    }
    function drawPoses(g, poses, d, mir, forSnap) {
      var lw = Math.max(2.5, d.w / 380);
      poses.forEach(function (p) {
        var a = AI.analyzePose(p);
        var bad = a.sos || a.fall; var col = bad ? COL.bad : a.ergoLevel === 'HIGH' ? COL.warn : COL.info;
        var P = function (k) { return { x: mir ? d.w - k.x : k.x, y: k.y, v: k.v }; };
        g.strokeStyle = col; g.lineWidth = lw; g.lineCap = 'round';
        AI.SKELETON.forEach(function (s) { var a1 = p.kpts[s[0]], b1 = p.kpts[s[1]]; if (a1.v > 0.45 && b1.v > 0.45) { var A = P(a1), Bp = P(b1); g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(Bp.x, Bp.y); g.stroke(); } });
        g.fillStyle = '#fff'; p.kpts.forEach(function (k) { if (k.v > 0.45) { var q = P(k); g.beginPath(); g.arc(q.x, q.y, lw * 1.2, 0, Math.PI * 2); g.fill(); } });
        var bx = mir ? mirrorBox(p, d.w) : p;
        var txt = a.sos ? 'SOS · استغاثة' : a.fall ? 'FALL · سقوط' : a.trunkAngle != null ? 'زاوية الظهر ' + a.trunkAngle + '°' : 'PERSON';
        label(g, bx.x1, bx.y1, txt, bad ? 'rgba(170,20,20,.92)' : 'rgba(10,40,70,.85)', Math.max(13, Math.round(d.w / 60)));
      });
    }

    // ---------- overlay ----------
    function drawOverlay(g, d, mir) {
      var fs = Math.max(13, Math.round(d.w / 62)), lw = Math.max(2.5, d.w / 400);
      var L = st.last;
      var maxAge = Math.max(2500, st.ms * 2.5);
      Object.keys(st.hz.view).forEach(function (kind) {
        var V = st.hz.view[kind]; if (!V || Date.now() - V.t > maxAge) return;
        V.dets.forEach(function (x) {
          var b = mir ? mirrorBox(x, d.w) : x, c = x.label === 'fire' ? '#ff3b1f' : x.label === 'smoke' && kind === 'fire' ? '#c9d1d9' : '#ffb000';
          g.strokeStyle = c; g.lineWidth = lw * 1.1; g.setLineDash(x.label === 'smoke' && kind === 'fire' ? [12, 8] : []); g.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); g.setLineDash([]);
          var t = kind === 'fire' ? (x.label === 'fire' ? '🔥 حريق FIRE ' : '💨 دخان SMOKE ') : '🚬 ' + (SMOKING_LABELS[x.label] || x.label) + ' ';
          label(g, b.x1, b.y1, t + Math.round(x.score * 100) + '%', x.label === 'fire' ? 'rgba(180,20,10,.94)' : 'rgba(110,75,10,.92)', fs);
        });
      });
      if (L && hasPPE() && Date.now() - L.t < maxAge) {
        L.tracks.forEach(function (t) {
          if (t.seen !== L.t) return;
          var req = reqKeys();
          var missing = req.filter(function (k) { return t.stable && t.stable[k] === 'MISSING'; });
          var ok = req.every(function (k) { return t.stable && t.stable[k] === 'OK'; });
          var col = missing.length ? COL.bad : ok ? COL.ok : COL.warn;
          var b = mir ? mirrorBox(t.box, d.w) : t.box;
          corners(g, b, col, lw);
          req.forEach(function (k) {
            var it = t.items[k]; if (!it || !it.box) return;
            var ib = mir ? mirrorBox(it.box, d.w) : it.box;
            if (it.state === 'OK') { g.strokeStyle = COL.ok; g.lineWidth = lw * 0.8; g.strokeRect(ib.x1, ib.y1, ib.x2 - ib.x1, ib.y2 - ib.y1); label(g, ib.x1, ib.y1, '✓ ' + PPE_AR[k], 'rgba(10,90,50,.88)', fs * 0.85); }
            else if (it.state === 'MISSING') { g.setLineDash([10, 7]); g.strokeStyle = COL.bad; g.lineWidth = lw; g.strokeRect(ib.x1, ib.y1, ib.x2 - ib.x1, ib.y2 - ib.y1); g.setLineDash([]); label(g, ib.x1, ib.y2 + fs * 1.6, '✗ بدون ' + PPE_AR[k], 'rgba(170,20,20,.92)', fs * 0.9); }
          });
          var wid = resolveWorker(t), w = workerCache[wid];
          if (wid && !w) workerInfo(wid);
          var who = t.identity && workerCache[t.identity] ? workerCache[t.identity].name : w ? w.name : 'شخص';
          label(g, b.x1, b.y1, who + (missing.length ? ' · مخالفة' : ok ? ' · ملتزم' : ''), missing.length ? 'rgba(150,16,16,.94)' : ok ? 'rgba(10,90,50,.9)' : 'rgba(120,90,10,.9)', fs);
        });
      }
      if (st.pose && hasPose() && Date.now() - st.pose.t < Math.max(2000, st.ms * 2.5)) {
        drawPoses(g, st.pose.poses, d, mir);
        var roi = stationRoi(d), B = st.behavior;
        var alertRoi = B.absentSince && B.present && Date.now() - B.absentSince > LAB.stationSec * 500;
        drawRoi(g, mir ? mirrorBox(roi, d.w) : roi, alertRoi, d);
      }
      if (st.faces && st.faces.length && LAB.idMode === 'auto') st.faces.forEach(function (f) { var b = mir ? mirrorBox(f.box, d.w) : f.box; g.strokeStyle = 'rgba(247,146,36,.85)'; g.lineWidth = 1.5; g.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); });
      // HUD chips
      clear(hudL); clear(hudR);
      hudL.appendChild(h('span', { class: 'hud-chip rec', text: st.srcKind === 'camera' ? 'LIVE · P01-CAM-LIVE' : st.srcKind === 'ipcam' ? 'LIVE · 🌐 ' + camName() + (st.phoneMode === 'rtc' ? ' · بث فيديو' : ' · صور JPEG') + (st.phoneFps ? ' · ' + st.phoneFps + ' FPS' : '') : st.srcKind === 'phone' ? 'LIVE · 📱 MOBILE CAM · ' + (st.phoneMode === 'rtc' ? 'WebRTC' : 'RELAY') + (st.phoneFps ? ' · ' + st.phoneFps + ' FPS' : '') : st.srcKind === 'video' ? 'VIDEO FILE' : 'IMAGE' }));
      hudL.appendChild(h('span', { class: 'hud-chip', text: st.srcKind === 'ipcam' ? U.siteName((S.cams[camId()] || {}).siteId || 'PLT-01') + ' · ' + camId() : 'نقطة فحص الوقاية · المصنع 01' }));
      hudR.appendChild(h('span', { class: 'hud-chip', text: (st.fps ? st.fps + ' FPS · ' : '') + st.ms + ' ms' }));
      hudR.appendChild(h('span', { class: 'hud-chip', text: (ppeEng === 'titan' ? 'EGIC AI SERVER' : faceapi ? faceapi.tf.getBackend().toUpperCase() : '') + ' · ON-DEVICE' }));
    }

    // ---------- side panel live update ----------
    function updateSide() {
      var L = st.last;
      var primary = L && L.tracks.filter(function (t) { return t.seen === L.t; }).sort(function (a, b) { return (b.box.x2 - b.box.x1) - (a.box.x2 - a.box.x1); })[0];
      var ph = document.getElementById('idPh'), nm = document.getElementById('idName'), sb = document.getElementById('idSub');
      var wid = primary ? resolveWorker(primary) : (!hasPPE() ? LAB.profileId : null);
      if (nm) {
        var w = workerCache[wid];
        if (w) { nm.textContent = w.name; sb.textContent = w.id + ' · ' + w.dept + (primary && primary.identity ? ' · تعرّف بالوجه ✓' : ' · ربط بالملف'); if (ph) { clear(ph); if (w.photo) ph.appendChild(h('img', { src: API.evidenceUrl(w.photo), alt: '' })); else ph.textContent = U.initials(w.name); } }
        else if (primary) { nm.textContent = 'شخص غير معروف'; sb.textContent = 'سجّل الوجه لربطه بملف'; if (ph) ph.textContent = '?'; if (wid) workerInfo(wid); }
        else { nm.textContent = '—'; sb.textContent = 'بانتظار ظهور شخص'; }
      }
      // roster: every person currently in frame + their identity (green = recognised, red = violation, grey = unknown)
      var roster = document.getElementById('idRoster');
      if (roster && hasPPE()) {
        var tracks = L ? L.tracks.filter(function (t) { return t.seen === L.t; }) : [];
        clear(roster);
        var reqK = reqKeys();
        tracks.slice(0, 16).forEach(function (t) {
          var id = resolveWorker(t), ww = id ? workerCache[id] : null; if (id && !ww) workerInfo(id);
          var miss = reqK.some(function (k) { return t.stable && t.stable[k] === 'MISSING'; });
          var name = t.identity && workerCache[t.identity] ? workerCache[t.identity].name : ww ? ww.name : 'غير معروف';
          roster.appendChild(h('span', { class: 'chip', style: { display: 'inline-flex', alignItems: 'center', gap: '5px', borderColor: miss ? 'var(--critical)' : t.identity ? 'var(--good)' : '' } }, h('span', { class: 'dot ' + (miss ? 'dot--off' : t.identity ? 'dot--on' : 'dot--idle') }), name));
        });
      }
      if (hzList) {
        var setH = function (id, cls, text) { var r = document.getElementById('hz-' + id); if (!r) return; r.classList.toggle('is-ok', cls === 'ok'); r.classList.toggle('is-miss', cls === 'bad'); r.querySelector('.state-pill').textContent = text; };
        ['fire', 'smoke', 'smoking'].forEach(function (k) {
          var w = st.hz[k], hits = w.filter(Boolean).length, R = HZ_RULE[k], alarm = st.hz.cool[k] && Date.now() - st.hz.cool[k] < 15000;
          setH(k, alarm || hits >= R.need ? 'bad' : w.length ? 'ok' : '', alarm ? 'إنذار!' : hits ? 'رصد ' + hits + '/' + R.win : w.length ? 'لا يوجد ✓' : '—');
        });
      }
      if (hasPPE() && ppeRows.helmet) {
        var req = reqKeys();
        PPE_KEYS.forEach(function (k) {
          var row = ppeRows[k]; row.classList.toggle('hidden', !LAB.required[k]);
          var s2 = primary && primary.stable ? primary.stable[k] : null;
          row.classList.toggle('is-ok', s2 === 'OK'); row.classList.toggle('is-miss', s2 === 'MISSING');
          row.querySelector('.state-pill').textContent = req.indexOf(k) < 0 ? 'غير مدعوم في هذا المحرك' : s2 === 'OK' ? 'ملتزم ✓' : s2 === 'MISSING' ? 'غير موجود ✗' : primary ? 'غير واضح' : '—';
        });
        var missing = primary ? req.filter(function (k) { return primary.stable && primary.stable[k] === 'MISSING'; }) : [];
        var allOk = primary && req.every(function (k) { return primary.stable && primary.stable[k] === 'OK'; });
        verdict.className = 'verdict' + (missing.length ? ' is-bad' : allOk ? ' is-ok' : '');
        document.getElementById('vText').textContent = !primary ? 'لا يوجد شخص أمام الكاميرا' : missing.length ? 'مخالفة: ' + missing.map(function (k) { return PPE_AR[k]; }).join('، ') : allOk ? 'ملتزم بمعدات الوقاية' : 'جارٍ التحقق…';
        var since = primary && missing.length ? Math.min.apply(null, missing.map(function (k) { return primary.since[k] || Date.now(); })) : 0;
        var prog = since ? Math.min(1, (Date.now() - since) / LAB.persistMs) : 0;
        timerBar.firstChild.style.width = (prog * 100) + '%';
        document.getElementById('vSub').textContent = missing.length ? (prog >= 1 ? 'تم التسجيل' : 'تأكيد خلال ' + Math.max(0, ((LAB.persistMs - (Date.now() - since)) / 1000)).toFixed(1) + ' ث') : '';
      }
      if (hasPose() && behav) {
        var B = st.behavior, a = B.analysis;
        function setB(id, cls, text) { var r = document.getElementById('bh-' + id); if (!r) return; r.classList.toggle('is-ok', cls === 'ok'); r.classList.toggle('is-miss', cls === 'bad'); r.querySelector('.state-pill').textContent = text; }
        setB('sos', a && a.sos ? 'bad' : a ? 'ok' : '', a ? (a.sos ? 'استغاثة!' : 'اليدان: ' + a.handsUp + '/2') : '—');
        setB('fall', a && a.fall ? 'bad' : a ? 'ok' : '', a ? (a.fall ? 'سقوط!' : 'طبيعي') : '—');
        var abs = B.absentSince ? Math.round((Date.now() - B.absentSince) / 1000) : 0;
        setB('station', abs && B.present ? 'bad' : 'ok', B.absentSince ? 'غائب ' + abs + ' ث' : 'المشغّل موجود');
        setB('ergo', a && a.ergoLevel === 'HIGH' ? 'bad' : a ? 'ok' : '', a && a.trunkAngle != null ? a.trunkAngle + '° · ' + ({ LOW: 'منخفض', MEDIUM: 'متوسط', HIGH: 'مرتفع' })[a.ergoLevel] : '—');
      }
    }

    // preload models in the background so the first start is instant
    setTimeout(function () { if (!st.destroyed) prepareModels(); }, 300);
    loadFaces().then(function () { if (!st.destroyed) renderSide(); }); migrateLocalFaces();
  });

  /* ------------------------------------------------------------------ */
  /* Egyptian ANPR                                                        */
  /* ------------------------------------------------------------------ */
  var ANPR = { lane: 'AUTO', precise: false, engine: 'browser' };
  try { Object.assign(ANPR, JSON.parse(localStorage.getItem('egic-anpr2') || '{}')); } catch (e) { }
  function saveAnpr() { try { localStorage.setItem('egic-anpr2', JSON.stringify(ANPR)); } catch (e) { } }

  U.register('anpr', function (v) {
    var st = { running: false, stream: null, src: null, srcKind: null, busy: false, voter: null, last: null, lastPlateBox: null, logged: {}, destroyed: false, fps: 0, ms: 0 };
    U.onCleanup(function () { st.destroyed = true; st.running = false; stopStream(st.stream); if (st.url) URL.revokeObjectURL(st.url); });
    v.appendChild(U.viewHead('قارئ اللوحات المصرية — مباشر', 'نموذج كشف اللوحة + نموذجا قراءة الحروف العربية والأرقام · كل قراءة تُسجل في سجل البوابة وتحدد القرار ومدة البقاء', [h('span', { class: 'badge badge--live', text: 'REAL ANPR · EGYPTIAN PLATES' })]));
    if (fileProtocolNotice(v)) return;
    var g = h('div', { class: 'lab' }); v.appendChild(g);
    var canvas = h('canvas', { width: 1280, height: 720 }), video = h('video', { playsinline: true, muted: true, autoplay: true, style: { position: 'absolute', width: '1px', height: '1px', opacity: 0 } }), img = h('img', { alt: '', style: { display: 'none' } });
    var phoneImg = h('img', { alt: '', style: { position: 'absolute', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' } });
    var phoneVid = h('video', { playsinline: true, muted: true, autoplay: true, style: { position: 'absolute', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' } });
    var hudL = h('div', { class: 'l' }), hudR = h('div', { class: 'r' });
    var loading = h('div', { class: 'lab-loading hidden' }, h('div', { class: 'box' }, h('div', { class: 'spinner' }), h('div', { style: { marginTop: '14px', fontWeight: 600 }, class: 'ldT', text: 'تحميل النماذج…' }), h('div', { class: 'bar' }, h('i', { class: 'ldBar' })), h('div', { class: 'muted mono ldS', style: { fontSize: '11px' } })));
    var empty = h('div', { class: 'lab-empty' }, h('div', null, h('div', { style: { width: '64px', height: '64px', margin: '0 auto', borderRadius: '18px', display: 'grid', placeItems: 'center', background: 'rgba(247,146,36,.14)', color: 'var(--orange-hi)' } }, U.icon('anpr')), h('h3', { text: 'اختر مصدرًا للقراءة' }), h('p', { text: 'صور نموذجية لسيارات مصرية، أو ارفع صورة/فيديو من بوابة المصنع، أو وجّه الكاميرا نحو لوحة سيارة.' })));
    var stage = h('div', { class: 'anpr-stage' }, canvas, video, img, phoneImg, phoneVid, h('div', { class: 'lab-hud' }, hudL, hudR), h('div', { class: 'lab-brand' }, h('div', { class: 'powered' }, h('span', { class: 'dot' }), 'POWERED BY ', h('b', { text: 'DELMON' }), h('span', { class: 'amp', text: '&' }), h('b', { text: 'DEV SMART X' }))), empty, loading);
    var left = h('div', null, stage);
    var samples = h('div', { class: 'samples' });
    for (var i = 1; i <= 7; i++) (function (n) { samples.appendChild(h('button', { type: 'button', title: 'صورة نموذجية ' + n, onclick: function () { startUrl('assets/samples/anpr/eg-car-0' + n + '.jpg', 'image'); } }, h('img', { src: 'assets/samples/anpr/eg-car-0' + n + '.jpg', alt: 'سيارة مصرية ' + n, loading: 'lazy' }))); })(i);
    samples.appendChild(h('button', { type: 'button', title: 'مقطع فيديو', onclick: function () { startUrl('assets/samples/anpr/eg-gate-clip.mp4', 'video'); }, style: { display: 'grid', placeItems: 'center', color: '#fff', fontSize: '11px', background: 'linear-gradient(135deg,#123,#0a1a12)' } }, '▶ فيديو'));
    left.appendChild(h('div', { style: { marginTop: '12px' } }, h('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '6px' }, text: 'صور نموذجية لسيارات مصرية (للتجربة):' }), samples));
    var preciseLbl = h('label', { class: 'switch', title: 'نموذج قراءة ثانٍ أكبر — أدق لكنه أبطأ ويحتاج كارت شاشة أقوى' }, h('input', { type: 'checkbox', checked: ANPR.precise, onchange: function (e) { ANPR.precise = e.target.checked; saveAnpr(); prepare(); } }), 'قراءة دقيقة (نموذجان)');
    // the precise OCR model ships as an optional pack — hide the switch when it is not installed
    fetch('assets/models/ocr_eg_s/model.onnx', { method: 'HEAD', cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; }).catch(function () { preciseLbl.style.display = 'none'; if (ANPR.precise) { ANPR.precise = false; saveAnpr(); } });
    left.appendChild(h('div', { class: 'lab-controls' },
      h('button', { class: 'btn btn--accent', onclick: startCamera }, U.icon('play'), 'تشغيل الكاميرا'),
      h('button', { class: 'btn', onclick: function () { pairPhone(startPhone); } }, '📱 كاميرا الموبايل'),
      h('button', { class: 'btn', onclick: function () { ipCamDialog(startIpCam); } }, '🌐 كاميرا IP'),
      h('button', { class: 'btn', onclick: stop }, U.icon('stop'), 'إيقاف'),
      h('label', { class: 'btn' }, U.icon('upload'), 'صورة / فيديو', h('input', { type: 'file', accept: 'image/*,video/*', style: { display: 'none' }, onchange: function (e) { var f = e.target.files[0]; if (f) startUrl(URL.createObjectURL(f), /^video/.test(f.type) ? 'video' : 'image', true); } })),
      h('span', { class: 'muted', style: { fontSize: '12px' }, text: 'الاتجاه:' }), U.seg([['AUTO', 'تلقائي'], ['IN', 'دخول'], ['OUT', 'خروج']], ANPR.lane, function (x) { ANPR.lane = x; saveAnpr(); }),
      U.select([['browser', 'القراءة: داخل الجهاز'], ['server', 'القراءة: خادم EGIC AI (أدق)']], ANPR.engine, function (x) { ANPR.engine = x; saveAnpr(); prepKey = ''; prepare(); chips(); }),
      preciseLbl));
    var side = h('div', { class: 'lab-side' }); g.appendChild(left); g.appendChild(side);
    var readCard = U.card('القراءة الحالية', { icon: 'anpr' });
    var readBox = h('div', { class: 'anpr-read' }, h('div', { class: 'muted', text: 'لا توجد قراءة بعد' }));
    readCard.body.appendChild(readBox); side.appendChild(readCard);
    var logCard = U.card('سجل هذه الجلسة', { icon: 'gates', actions: [h('a', { class: 'btn btn--xs', href: '#/gates', text: 'سجل البوابات' })] });
    var logBox = h('div', { style: { display: 'grid', gap: '8px', maxHeight: '380px', overflow: 'auto' } }, h('div', { class: 'muted', style: { fontSize: '12px' }, text: 'كل قراءة مؤكدة تُرسل للخلفية وتظهر في لوحة البوابات.' }));
    logCard.body.appendChild(logBox); side.appendChild(logCard);
    var mCard = U.card('النماذج', { icon: 'api' }); var mChips = h('div', { class: 'modelbar' }); mCard.body.appendChild(mChips); side.appendChild(mCard);
    function chips() { clear(mChips); if (ANPR.engine === 'server') { mChips.appendChild(h('span', { class: 'chip' }, 'المحرك ', h('b', { text: srvOk ? 'خادم EGIC AI · YOLO11n + OCR ensemble' : 'خادم EGIC AI · غير متصل' }))); return; } [['كشف اللوحة', 'YOLO11n', 'plate'], ['قراءة الحروف', 'YOLO11s · مُدرَّب EGIC', 'ocr'], ['قراءة دقيقة', '+ YOLOv8s · 38 فئة', 'ocrPro']].forEach(function (m) { if (m[2] === 'ocrPro' && !ANPR.precise) return; mChips.appendChild(h('span', { class: 'chip' }, m[0] + ' ', h('b', { text: AI && AI.loaded(m[2]) ? m[1] : 'غير محمّل' }))); }); mChips.appendChild(h('span', { class: 'chip' }, 'الحروف ', h('b', { text: 'أ ب ج د ر س ص ط ع ف ق ل م ن هـ و ى' }))); }
    chips();

    function setLoading(on, t, p, s) { loading.classList.toggle('hidden', !on); if (t) loading.querySelector('.ldT').textContent = t; if (p != null) loading.querySelector('.ldBar').style.width = Math.round(p * 100) + '%'; if (s != null) loading.querySelector('.ldS').textContent = s; }
    var prepP = null, prepKey = '', srvOk = false;
    function prepare() {
      var key = ANPR.engine === 'server' ? 's' : ANPR.precise ? 'p' : 'f';
      if (prepP && prepKey === key) return prepP;
      prepKey = key;
      if (ANPR.engine === 'server') {
        setLoading(true, 'الاتصال بخادم EGIC AI…', 0.3, TITAN_URL);
        prepP = titanHealth().then(function () { return ensureCore(); }).then(function () { srvOk = true; setLoading(false); chips(); }, function () {
          srvOk = false; ANPR.engine = 'browser'; saveAnpr(); prepKey = '';
          U.toast('خادم EGIC AI غير متاح', TITAN_URL + ' — تم التحويل للقراءة داخل الجهاز.', { kind: 'critical', ms: 8000 });
          prepP = null; return prepare();
        });
        return prepP;
      }
      var need = ['plate', 'ocr'].concat(ANPR.precise ? ['ocrPro'] : []);
      var k = 0;
      setLoading(true, 'تحميل نماذج قراءة اللوحات…', 0.05, '');
      prepP = need.reduce(function (p, name) { return p.then(function () { setLoading(true, 'تحميل ' + AI_LABEL(name) + '…', 0.1 + 0.85 * k / need.length); return ensureModel(name, function (f) { setLoading(true, null, 0.1 + 0.85 * (k + f) / need.length); }).then(function () { k++; }); }); }, ensureCore()).then(function () { setLoading(false); chips(); if (st.srcKind) st.running = true; }).catch(function (e) { setLoading(true, 'تعذر تحميل النماذج', 1, e.message); prepP = null; });
      return prepP;
    }
    function AI_LABEL(n) { return n === 'plate' ? 'كاشف اللوحات' : n === 'ocr' ? 'قارئ الحروف (سريع)' : 'قارئ الحروف (دقيق)'; }

    function startUrl(url, kind, own) {
      stopSources(); empty.classList.add('hidden'); prepare();
      st.gen = (st.gen || 0) + 1; // results of a read still running on the previous image are discarded
      if (own) st.url = url;
      st.voter = null; st.lastRead = null; st.lastPlateBox = null;
      clear(readBox).appendChild(h('div', { class: 'muted', text: 'جارٍ القراءة…' }));
      if (kind === 'video') { video.srcObject = null; video.src = url; video.loop = true; video.play().then(function () { st.src = video; st.srcKind = 'video'; st.running = true; loop(); }); }
      else { img.onload = function () { st.src = img; st.srcKind = 'image'; st.running = true; st.imageDone = false; loop(); }; img.src = url; }
    }
    function startPhone(src) {
      stopSources(); empty.classList.add('hidden'); prepare();
      st.gen = (st.gen || 0) + 1; st.voter = null; st.lastRead = null; st.srcKind = 'phone';
      clear(readBox).appendChild(h('div', { class: 'muted', text: 'وجّه كاميرا الموبايل على اللوحة وثبّتها ثانية…' }));
      attachPhone(src, phoneVid, phoneImg, st, function () { U.toast('انقطع اتصال كاميرا الموبايل', 'تأكد أن صفحة الكاميرا مفتوحة على الموبايل — أو امسح الكود مرة أخرى', { kind: 'critical', ms: 7000 }); })
        .then(function (el) { if (st.srcKind !== 'phone') return; st.src = st.phoneMode === 'mjpeg' ? phoneFrame(st, phoneImg) : el; st.running = true; loop(); })
        .catch(function (e) { st.srcKind = null; empty.classList.remove('hidden'); U.toast('تعذر استقبال صورة الموبايل', e.message, { kind: 'critical' }); });
    }
    function startIpCam(src) {
      stopSources(); empty.classList.add('hidden'); prepare();
      st.gen = (st.gen || 0) + 1; st.voter = null; st.lastRead = null; st.srcKind = 'ipcam';
      clear(readBox).appendChild(h('div', { class: 'muted', text: 'جارٍ استقبال صورة الكاميرا ' + src.name + '…' }));
      attachIpCam(src, phoneImg, st, function (err) { U.toast('مشكلة في كاميرا IP: ' + src.name, err || 'انقطع البث', { kind: 'critical', ms: 8000 }); }, phoneVid)
        .then(function (el) { if (st.srcKind !== 'ipcam') return; st.src = st.phoneMode === 'mjpeg' ? phoneFrame(st, phoneImg) : el; st.running = true; loop(); })
        .catch(function (e) { if (st.srcKind !== 'ipcam') return; stopSources(); empty.classList.remove('hidden'); U.toast('تعذر تشغيل كاميرا IP', e.message, { kind: 'critical', ms: 9000 }); });
    }
    function startCamera() {
      stopSources(); empty.classList.add('hidden'); prepare();
      st.gen = (st.gen || 0) + 1;
      openCam().then(function (s) { if (st.destroyed) { stopStream(s); return; } st.stream = s; video.srcObject = s; return video.play().then(function () { st.src = video; st.srcKind = 'camera'; st.running = true; loop(); }); }).catch(function (e) { empty.classList.remove('hidden'); U.toast('تعذر فتح الكاميرا', camErrMsg(e), { kind: 'critical', ms: 9000 }); });
    }
    function stopSources() { if (st.srcKind === 'phone' || st.srcKind === 'ipcam') detachPhone(st, phoneVid, phoneImg); st.ipcam = null; st.running = false; stopStream(st.stream); st.stream = null; try { video.pause(); } catch (e) { } video.removeAttribute('src'); video.srcObject = null; if (st.url) { URL.revokeObjectURL(st.url); st.url = null; } st.srcKind = null; st.lastPlateBox = null; }
    function stop() { stopSources(); empty.classList.remove('hidden'); }

    function loop() {
      if (!st.running || st.destroyed) return;
      if ((st.srcKind === 'phone' || st.srcKind === 'ipcam') && st.phoneMode === 'mjpeg') st.src = phoneFrame(st, phoneImg) || st.src;
      var s = st.src, W = s.videoWidth || s.naturalWidth || s.width, H = s.videoHeight || s.naturalHeight || s.height;
      if (W && H) {
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        var g2 = canvas.getContext('2d'); g2.drawImage(s, 0, 0, W, H);
        if (!st.busy && prepP && ((ANPR.engine === 'server' && srvOk) || (AI && AI.loaded('plate') && AI.loaded('ocr'))) && !(st.srcKind === 'image' && st.imageDone)) { st.busy = true; read(W, H).then(function () { st.busy = false; }, function (e) { console.error(e); st.busy = false; }); }
        overlay(g2, W, H);
      }
      requestAnimationFrame(loop);
    }
    // server engine: one JPEG → /anpr/read → same reading format as the in-browser assembler
    var grabA = null;
    function readServer(W, H) {
      var t0 = performance.now(), gen = st.gen;
      var sw = Math.min(1600, W), sc = sw / W, sh = Math.round(H * sc);
      grabA = grabA || document.createElement('canvas');
      if (grabA.width !== sw || grabA.height !== sh) { grabA.width = sw; grabA.height = sh; }
      grabA.getContext('2d').drawImage(st.src, 0, 0, sw, sh);
      return new Promise(function (res) { grabA.toBlob(res, 'image/jpeg', 0.9); }).then(function (blob) {
        return fetch(TITAN_URL + '/anpr/read', { method: 'POST', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      }).then(function (r) { if (!r.ok) throw new Error('AI HTTP ' + r.status); return r.json(); }).then(function (j) {
        if (gen !== st.gen) return;
        var best = (j.plates || []).filter(function (x) { return x.reading; })[0] || (j.plates || [])[0];
        if (!best) { st.lastPlateBox = null; if (st.srcKind === 'image') { st.imageDone = true; showNoPlate(); } return; }
        var b = best.box, p = { x1: b[0] / sc, y1: b[1] / sc, x2: b[2] / sc, y2: b[3] / sc, score: best.score }, pw = p.x2 - p.x1, ph = p.y2 - p.y1;
        var crop = { x1: Math.max(0, p.x1 - pw * 0.04), y1: Math.max(0, p.y1 - ph * 0.08), x2: Math.min(W, p.x2 + pw * 0.04), y2: Math.min(H, p.y2 + ph * 0.08) };
        st.lastPlateBox = p;
        var r = best.reading;
        st.ms = Math.round(performance.now() - t0); st.lastRead = r;
        if (!r) { if (st.srcKind === 'image') { st.imageDone = true; showNoPlate(); } return; }
        if (st.srcKind === 'image') { st.imageDone = true; if (r.valid) commit(r, p, crop, W, H); else showReading(r, null, crop); return; }
        st.voter = st.voter || new AI.PlateVoter(3000);
        var vote = st.voter.add(r, Date.now());
        showReading(vote ? vote.reading : r, null, crop, vote);
        if (vote && vote.stable) commit(vote.reading, p, crop, W, H);
      });
    }
    function read(W, H) {
      if (ANPR.engine === 'server') return readServer(W, H);
      var t0 = performance.now(), gen = st.gen;
      return AI.run('plate', st.src, { conf: 0.2, maxDet: 5 }).then(function (plates) {
        if (gen !== st.gen) return null;
        if (!plates.length && st.srcKind === 'image') return AI.run('plate', st.src, { conf: 0.2, maxDet: 5, shrink: 0.72 });
        return plates;
      }).then(function (plates) {
        if (!plates || gen !== st.gen) return;
        if (!plates.length) { st.lastPlateBox = null; if (st.srcKind === 'image') { st.imageDone = true; showNoPlate(); } return; }
        var p = plates[0], pw = p.x2 - p.x1, ph = p.y2 - p.y1;
        var crop = { x1: Math.max(0, p.x1 - pw * 0.04), y1: Math.max(0, p.y1 - ph * 0.08), x2: Math.min(W, p.x2 + pw * 0.04), y2: Math.min(H, p.y2 + ph * 0.08) };
        st.lastPlateBox = p;
        var jobs = [AI.run('ocr', st.src, { conf: 0.2, crop: crop, iou: 0.5, classAware: false })];
        if (ANPR.precise && AI.loaded('ocrPro')) jobs.push(AI.run('ocrPro', st.src, { conf: 0.2, crop: crop, iou: 0.5, classAware: false }));
        return Promise.all(jobs).then(function (lists) {
          if (gen !== st.gen) return;
          var r = AI.assemblePlate(lists, lists.length > 1 ? [2, 1] : null);
          st.ms = Math.round(performance.now() - t0);
          st.lastRead = r;
          if (!r) { if (st.srcKind === 'image') { st.imageDone = true; showNoPlate(); } return; }
          if (st.srcKind === 'image') { st.imageDone = true; if (r.valid) commit(r, p, crop, W, H); else showReading(r, null, crop); return; }
          st.voter = st.voter || new AI.PlateVoter(3000);
          var vote = st.voter.add(r, Date.now());
          showReading(vote ? vote.reading : r, null, crop, vote);
          if (vote && vote.stable) commit(vote.reading, p, crop, W, H);
        });
      });
    }
    function showNoPlate() { clear(readBox).appendChild(h('div', { class: 'muted', text: 'لم يتم العثور على لوحة واضحة في هذه الصورة.' })); }
    function plateCrop(crop) { var c = document.createElement('canvas'); var w = crop.x2 - crop.x1, hh = crop.y2 - crop.y1, sc = Math.min(1, 480 / w); c.width = Math.round(w * sc); c.height = Math.round(hh * sc); c.getContext('2d').drawImage(st.src, crop.x1, crop.y1, w, hh, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.9); }
    function showReading(r, rec, crop, vote) {
      clear(readBox);
      readBox.appendChild(h('img', { src: plateCrop(crop), alt: 'اللوحة', style: { maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--line-2)' } }));
      readBox.appendChild(SC.plateEl(r.text, { size: 'lg' }));
      readBox.appendChild(h('div', { class: 'mono muted', style: { fontSize: '11.5px' }, text: 'ثقة ' + Math.round(r.conf * 100) + '% · ' + st.ms + ' ms' + (vote ? ' · تصويت ' + vote.votes + '/' + vote.total : '') + (r.valid ? '' : ' · قراءة غير مكتملة') }));
      if (rec) {
        readBox.appendChild(h('div', { class: 'decision ' + rec.decision, text: U.AR_DEC[rec.decision] + ' · ' + (rec.lane === 'IN' ? 'دخول' : 'خروج') }));
        readBox.appendChild(h('dl', { class: 'kv', style: { width: '100%', textAlign: 'start' } }, h('dt', { text: 'المركبة' }), h('dd', { text: rec.vehicleType }), h('dt', { text: 'الجهة' }), h('dd', { text: rec.owner }), h('dt', { text: 'الإجراء' }), h('dd', { text: rec.action }), rec.dwellMin != null ? h('dt', { text: 'مدة البقاء' }) : null, rec.dwellMin != null ? h('dd', { class: 'mono', text: rec.dwellMin + ' دقيقة' }) : null, h('dt', { text: 'البوابة' }), h('dd', { text: U.siteName(rec.siteId) + ' · ' + rec.gateName })));
        readBox.appendChild(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } },
          rec.decision !== 'AUTHORIZED' ? h('button', { class: 'btn btn--sm btn--primary', text: 'إضافة للمصرّح بها', onclick: function () { API.post('vehicles', { plate: r.text, status: 'authorized', owner: 'مصرّح من شاشة البوابة', category: 'fleet', type: 'ملاكي' }).then(function () { U.toast('تمت إضافة المركبة', r.text); st.logged = {}; }); } }) : null,
          rec.decision !== 'BLACKLISTED' ? h('button', { class: 'btn btn--sm btn--danger', text: 'حظر (قائمة سوداء)', onclick: function () { API.post('vehicles', { plate: r.text, status: 'blacklisted', owner: 'محظور من شاشة البوابة', category: 'blacklist', type: 'ملاكي' }).then(function () { U.toast('تم حظر المركبة', r.text, { kind: 'critical' }); st.logged = {}; }); } }) : null,
          h('button', { class: 'btn btn--sm', text: 'إعادة القراءة', onclick: function () { st.logged = {}; st.imageDone = false; st.voter = null; } })));
      }
    }
    function commit(r, p, crop, W, H) {
      var key = r.text;
      if (st.logged[key] && Date.now() - st.logged[key] < (st.srcKind === 'image' ? 3000 : 60000)) return;
      st.logged[key] = Date.now();
      var snapC = document.createElement('canvas'), sw = Math.min(1280, W), sc = sw / W; snapC.width = sw; snapC.height = Math.round(H * sc);
      var g3 = snapC.getContext('2d'); g3.drawImage(st.src, 0, 0, snapC.width, snapC.height);
      g3.strokeStyle = COL.orange; g3.lineWidth = 4; g3.strokeRect(p.x1 * sc, p.y1 * sc, (p.x2 - p.x1) * sc, (p.y2 - p.y1) * sc);
      watermark(g3, snapC.width, snapC.height, 'EGIC · البوابة الرئيسية — المصنع 01 · ' + r.text + ' · ' + nowStr());
      var snap = snapC.toDataURL('image/jpeg', 0.82);
      API.post('gate/log', { plate: r.text, conf: r.conf, cameraId: 'P01-ANPR-LIVE', lane: ANPR.lane, source: 'live-anpr', image: snap, plateImage: plateCrop(crop) }).then(function (rec) {
        showReading(r, rec, crop);
        if (logBox.firstChild && logBox.firstChild.classList && logBox.firstChild.classList.contains('muted')) clear(logBox);
        logBox.insertBefore(h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '10px', alignItems: 'center', padding: '8px', borderRadius: '10px', background: 'var(--bg-3)', border: '1px solid var(--line-1)' } }, SC.plateEl(rec.plate, { size: 'sm' }), h('div', null, U.decBadge(rec.decision), h('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' }, text: (rec.lane === 'IN' ? 'دخول' : 'خروج') + (rec.dwellMin != null ? ' · بقاء ' + rec.dwellMin + ' د' : '') })), h('span', { class: 'mono muted', style: { fontSize: '11px' }, text: U.fTime(rec.ts) })), logBox.firstChild);
        U.toast('قراءة لوحة: ' + rec.plate, U.AR_DEC[rec.decision] + ' · ' + (rec.lane === 'IN' ? 'دخول' : 'خروج') + ' · ' + rec.gateName, { kind: rec.decision === 'BLACKLISTED' || rec.decision === 'UNAUTHORIZED' ? 'critical' : 'live', img: snap });
      });
    }
    function overlay(g4, W, H) {
      var p = st.lastPlateBox;
      if (p) {
        var lw = Math.max(3, W / 300);
        g4.strokeStyle = COL.orange; g4.lineWidth = lw; g4.strokeRect(p.x1, p.y1, p.x2 - p.x1, p.y2 - p.y1);
        var t = st.lastRead && st.lastRead.valid ? st.lastRead.text : 'PLATE ' + p.score.toFixed(2);
        label(g4, p.x1, p.y1 - 4, t, 'rgba(150,70,0,.95)', Math.max(16, Math.round(W / 40)));
      }
      clear(hudL); clear(hudR);
      hudL.appendChild(h('span', { class: 'hud-chip rec', text: st.srcKind === 'camera' ? 'LIVE · P01-ANPR-LIVE' : st.srcKind === 'ipcam' ? 'LIVE · 🌐 ' + st.ipcam.name : st.srcKind === 'phone' ? 'LIVE · 📱 MOBILE CAM · ' + (st.phoneMode === 'rtc' ? 'WebRTC' : 'RELAY') + (st.phoneFps ? ' · ' + st.phoneFps + ' FPS' : '') : st.srcKind === 'video' ? 'VIDEO · GATE' : 'IMAGE' }));
      hudL.appendChild(h('span', { class: 'hud-chip', text: 'البوابة الرئيسية · المصنع 01' }));
      hudR.appendChild(h('span', { class: 'hud-chip', text: st.ms + ' ms / قراءة' }));
    }
    setTimeout(function () { if (!st.destroyed) prepare(); }, 300);
  });

  // shared with the attendance screen and the employee profile
  window.EGICLive = { ensureFace: ensureFace, loadFaces: loadFaces, hasFaces: hasFaces, detectFaces: detectFaces, Sighter: Sighter, enrollDialog: enrollDialog, ipCamDialog: ipCamDialog, pairPhone: pairPhone, attachPhone: attachPhone, attachIpCam: attachIpCam, detachPhone: detachPhone, phoneFrame: phoneFrame, openCam: openCam, stopStream: stopStream, camErrMsg: camErrMsg, listCams: listCams, fileProtocolNotice: fileProtocolNotice, adminPost: adminPost };
})();
