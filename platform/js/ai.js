/*!
 * EGIC · Vision AI Runtime  —  POWERED BY DELMON & DEV SMART X
 * In-browser inference (TensorFlow.js, WebGL) — no cloud, no video leaves the device.
 *
 *   PPE      : YOLOv8s  · SH17 manufacturing PPE classes (helmet · safety glasses · safety vest · person · head · face …)
 *   BEHAVIOR : YOLO26n-pose (Ultralytics, 2025/26) · 17 body keypoints → SOS gesture · fall · unattended station · ergonomics
 *   ANPR (EG): YOLOv8n plate detector  +  YOLOv8n / YOLO11m character recognisers (Egyptian Arabic letters & digits)
 *   FIRE     : YOLOv8n · D-Fire (smoke · fire)                 — ONNX Runtime Web (WASM)
 *   SMOKING  : YOLOv8  · cigarette · vape · smoke · person      — ONNX Runtime Web (WASM)
 *
 * The same file runs in Node (tests) — call EGICAI.setTF(tf) with an initialised TensorFlow.js instance.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EGICAI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var tf = (typeof self !== 'undefined' && self.faceapi && self.faceapi.tf) || (typeof self !== 'undefined' && self.tf) || null;
  function setTF(t) { tf = t; }
  function getTF() { return tf; }

  /* ------------------------------------------------------------------ */
  /* Model registry                                                       */
  /* ------------------------------------------------------------------ */
  var SH17 = ['person', 'ear', 'ear-mufs', 'face', 'face-guard', 'face-mask', 'foot', 'tool', 'glasses', 'gloves', 'helmet', 'hands', 'head', 'medical-suit', 'shoes', 'safety-suit', 'safety-vest'];
  var OCR_N = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'aain', 'ain', 'alf', 'baa', 'dal', 'faa', 'geem', 'haa', 'kaf', 'lam', 'meem', 'non', 'raa', 'sad', 'sen', 'taa', 'waaw', 'yaa', 'zen'];
  // EGIC-trained recogniser (EALPR, 27 classes: 17 Egyptian letters + 10 digits)
  var OCR_EG = ['alf', 'baa', 'geem', 'dal', 'raa', 'sen', 'sad', 'taa', 'ain', 'faa', 'kaf', 'lam', 'meem', 'non', 'haa', 'waaw', 'yaa', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  var OCR_M = ['0', '1', '2', '3', '4', '5', '6', '7', '7aa', '8', '9', 'Taa', 'Thaa', 'ain', 'alif', 'baa', 'daad', 'daal', 'faa', 'ghayn', 'haa', 'jeem', 'kaaf', 'khaa', 'laam', 'meem', 'noon', 'qaaf', 'raa', 'saad', 'seen', 'sheen', 'taa', 'thaa', 'waw', 'yaa', 'zaal', 'zay'];

  // latin class name → Arabic glyph, constrained to the Egyptian plate alphabet
  // (أ ب ج د ر س ص ط ع ف ق ل م ن هـ و ى — 17 letters) : non-Egyptian look-alikes map to the Egyptian letter they are confused with.
  var AR = {
    aain: 'ع', ain: 'ع', alf: 'أ', alif: 'أ', baa: 'ب', dal: 'د', daal: 'د', faa: 'ف', geem: 'ج', jeem: 'ج', haa: 'هـ', kaf: 'ق', kaaf: 'ق', qaaf: 'ق',
    lam: 'ل', laam: 'ل', meem: 'م', non: 'ن', noon: 'ن', raa: 'ر', sad: 'ص', saad: 'ص', sen: 'س', seen: 'س', taa: 'ط', Taa: 'ط', waaw: 'و', waw: 'و', yaa: 'ى',
    zen: 'ر', zay: 'ر', '7aa': 'ج', khaa: 'ج', Thaa: 'ط', daad: 'ص', ghayn: 'ع', sheen: 'س', thaa: 'ب', zaal: 'د'
  };
  var AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

  var REGISTRY = {
    ppe:   { dir: 'assets/models/ppe_s',  size: 640, names: SH17, label: 'YOLOv8s · SH17 PPE (17 classes)' },
    pose:  { dir: 'assets/models/pose_n', size: 640, pose: true, label: 'YOLO26n-pose · 17 keypoints' },
    // ANPR — chosen by benchmark (docs/MODEL_SELECTION.md): plate detector found 23/23 independent Egyptian plates (old one 16/23);
    // EGIC-trained recogniser: 92.3% exact full-plate reads on 300 held-out EALPR plates (old model 37%)
    plate:  { dir: 'assets/models/plate_eg', size: 640, onnx: true, names: ['plate'], label: 'YOLO11n · Egyptian plate detector' },
    ocr:    { dir: 'assets/models/ocr_egic', size: 320, onnx: true, names: OCR_EG, label: 'YOLO11s · EGIC-trained plate characters (27)' },
    ocrPro: { dir: 'assets/models/ocr_eg_s', size: 640, onnx: true, names: OCR_M, label: 'YOLOv8s · Egyptian plate characters (38)' },
    // ONNX models (ONNX Runtime Web): input NCHW [1,3,640,640], output [1, 4+nc, 8400] — same decode as the TF.js ones
    fire:    { dir: 'assets/models/fire_n',    size: 640, onnx: true, names: ['smoke', 'fire'], label: 'YOLOv8n · D-Fire (fire · smoke)' },
    smoking: { dir: 'assets/models/smoking_n', size: 640, onnx: true, names: ['smoke', 'person', 'cigarette', 'vape'], label: 'YOLOv8 · cigarette · vape' }
  };

  var models = {}, loading = {};
  var basePath = '';
  var MODEL_REV = '20261012-anpr-egic';
  function setBase(p) { basePath = p || ''; }

  // ONNX Runtime Web (vendored, WASM backend) — loaded on demand for the ONNX models
  var ortP = null;
  function ensureOrt() {
    if (ortP) return ortP;
    ortP = new Promise(function (res, rej) {
      if (typeof self !== 'undefined' && self.ort) return res(self.ort);
      var s = document.createElement('script'); s.src = basePath + 'assets/vendor/ort/ort.wasm.min.js';
      s.onload = function () { res(self.ort); }; s.onerror = function () { ortP = null; rej(new Error('تعذر تحميل ONNX Runtime')); };
      document.head.appendChild(s);
    }).then(function (ort) {
      ort.env.wasm.wasmPaths = new URL(basePath + 'assets/vendor/ort/', location.href).href;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      return ort;
    });
    return ortP;
  }
  function loadOnnx(name, reg, onProgress) {
    var url = basePath + reg.dir + '/model.onnx?v=' + MODEL_REV;
    return ensureOrt().then(function (ort) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        var total = +r.headers.get('content-length') || 0;
        if (!r.body || !total || !onProgress) return r.arrayBuffer();
        var reader = r.body.getReader(), got = 0, chunks = [];
        return (function pump() {
          return reader.read().then(function (x) {
            if (x.done) { var buf = new Uint8Array(got), o = 0; chunks.forEach(function (c) { buf.set(c, o); o += c.length; }); return buf.buffer; }
            chunks.push(x.value); got += x.value.length; onProgress(Math.min(1, got / total)); return pump();
          });
        })();
      }).then(function (buf) { return ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }); });
    }).then(function (sess) { sess.__onnx = true; return sess; });
  }

  // Load a TF.js graph model. Uses fetch (http/https/Electron); falls back to embedded weights for file:// if present.
  function load(name, onProgress) {
    if (models[name]) return Promise.resolve(models[name]);
    if (loading[name]) return loading[name];
    var reg = REGISTRY[name];
    if (!reg) return Promise.reject(new Error('unknown model ' + name));
    if (reg.onnx) {
      loading[name] = loadOnnx(name, reg, onProgress).then(function (m) { models[name] = m; return m; }).catch(function (e) { delete loading[name]; throw e; });
      return loading[name];
    }
    var url = basePath + reg.dir + '/model.json?v=' + MODEL_REV; // bump MODEL_REV when a model.json changes (browsers cache assets/)
    loading[name] = tf.loadGraphModel(url, { onProgress: onProgress }).then(function (m) {
      models[name] = m;
      return m;
    }).catch(function (e) { delete loading[name]; throw e; });
    return loading[name];
  }
  function loaded(name) { return !!models[name]; }
  function register(name, m) { models[name] = m; }

  // Warm-up: compiles WebGL shaders once so the first live frame is fast.
  function warmup(name) {
    var m = models[name], size = REGISTRY[name].size;
    if (m.__onnx) { var o = self.ort; return m.run(feeds(m, new o.Tensor('float32', new Float32Array(3 * size * size), [1, 3, size, size]))).then(function () { return true; }); }
    return tf.tidy(function () { return m.execute(tf.zeros([1, size, size, 3])); }).data().then(function () { return true; });
  }

  /* ------------------------------------------------------------------ */
  /* Pre / post processing                                                */
  /* ------------------------------------------------------------------ */
  function srcSize(src) {
    if (src && src.shape) return { w: src.shape[1], h: src.shape[0] };
    return { w: src.videoWidth || src.naturalWidth || src.width, h: src.videoHeight || src.naturalHeight || src.height };
  }

  // Letterbox: keep aspect, pad with 114 grey — identical to Ultralytics training pre-processing.
  function letterbox(src, size, crop, shrink) {
    return tf.tidy(function () {
      var img = src.shape ? src : tf.browser.fromPixels(src);
      if (crop) {
        var cy1 = Math.max(0, Math.round(crop.y1)), cx1 = Math.max(0, Math.round(crop.x1));
        var ch = Math.max(1, Math.min(img.shape[0] - cy1, Math.round(crop.y2 - crop.y1))), cw = Math.max(1, Math.min(img.shape[1] - cx1, Math.round(crop.x2 - crop.x1)));
        img = tf.slice(img, [cy1, cx1, 0], [ch, cw, 3]);
      }
      var h = img.shape[0], w = img.shape[1];
      var s = Math.min(size / w, size / h) * (shrink || 1);
      var nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
      var px = Math.floor((size - nw) / 2), py = Math.floor((size - nh) / 2);
      var r = tf.div(tf.image.resizeBilinear(tf.cast(img, 'float32'), [nh, nw]), 255);
      var padded = tf.pad(r, [[py, size - nh - py], [px, size - nw - px], [0, 0]], 114 / 255);
      return { t: tf.expandDims(padded, 0), s: s, px: px, py: py, w: w, h: h };
    });
  }

  function iou(a, b) {
    var x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1), x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
    var inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    var u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
    return u > 0 ? inter / u : 0;
  }
  function ioa(a, b) { // intersection over area of a
    var x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1), x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
    var inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    var ar = (a.x2 - a.x1) * (a.y2 - a.y1);
    return ar > 0 ? inter / ar : 0;
  }
  function nms(dets, thr, classAware) {
    dets.sort(function (a, b) { return b.score - a.score; });
    var keep = [];
    for (var i = 0; i < dets.length; i++) {
      var d = dets[i], ok = true;
      for (var j = 0; j < keep.length; j++) {
        if (classAware && keep[j].cls !== d.cls) continue;
        if (iou(d, keep[j]) > thr) { ok = false; break; }
      }
      if (ok) keep.push(d);
    }
    return keep;
  }

  /**
   * Run a detection / pose model.
   * opts: { conf: number|{cls:conf}, iou, maxDet, crop:{x1,y1,x2,y2}, classAware }
   * returns [{x1,y1,x2,y2,score,cls,label,kpts?}] in source pixel coordinates
   */
  function feeds(sess, t) { var f = {}; f[sess.inputNames[0]] = t; return f; }

  // ONNX path: same letterbox as TF.js, then HWC → CHW and an ORT session run. Returns {data:[N*C] row-major, N, C}
  function runOnnx(m, lb) {
    var chw = tf.tidy(function () { return tf.transpose(tf.squeeze(lb.t, [0]), [2, 0, 1]); });
    lb.t.dispose();
    return chw.data().then(function (px) {
      chw.dispose();
      var size = Math.sqrt(px.length / 3);
      return m.run(feeds(m, new self.ort.Tensor('float32', px, [1, 3, size, size])));
    }).then(function (res) {
      var o = res[m.outputNames[0]], C = o.dims[1], N = o.dims[2], src = o.data, data = new Float32Array(N * C);
      for (var c = 0; c < C; c++) for (var i = 0; i < N; i++) data[i * C + c] = src[c * N + i]; // [C, N] → [N, C]
      return { data: data, N: N, C: C };
    });
  }

  function run(name, src, opts) {
    opts = opts || {};
    var reg = REGISTRY[name], m = models[name];
    if (!m) return Promise.reject(new Error('model not loaded: ' + name));
    var lb = letterbox(src, reg.size, opts.crop, opts.shrink);
    var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var outP;
    if (m.__onnx) outP = runOnnx(m, lb);
    else {
      var out = tf.tidy(function () {
        var o = m.execute(lb.t);
        if (Array.isArray(o)) o = o[0];
        return tf.transpose(tf.squeeze(o, [0]), [1, 0]); // [8400, C]
      });
      lb.t.dispose();
      outP = out.data().then(function (data) { var r = { data: data, N: out.shape[0], C: out.shape[1] }; out.dispose(); return r; });
    }
    return outP.then(function (res) {
      var data = res.data, C = res.C, N = res.N;
      var nc = reg.pose ? 1 : reg.names.length;
      var confDefault = typeof opts.conf === 'number' ? opts.conf : 0.25;
      var confMap = typeof opts.conf === 'object' ? opts.conf : null;
      var minConf = confMap ? Math.min.apply(null, Object.keys(confMap).map(function (k) { return confMap[k]; }).concat([confDefault])) : confDefault;
      var dets = [];
      var ox = opts.crop ? opts.crop.x1 : 0, oy = opts.crop ? opts.crop.y1 : 0;
      for (var i = 0; i < N; i++) {
        var base = i * C, best = -1, bs = 0;
        for (var c = 0; c < nc; c++) { var v = data[base + 4 + c]; if (v > bs) { bs = v; best = c; } }
        if (bs < minConf) continue;
        var label = reg.pose ? 'person' : reg.names[best];
        var thr = confMap && confMap[label] != null ? confMap[label] : confDefault;
        if (bs < thr) continue;
        var cx = data[base], cy = data[base + 1], w = data[base + 2], h = data[base + 3];
        var d = {
          x1: (cx - w / 2 - lb.px) / lb.s + ox, y1: (cy - h / 2 - lb.py) / lb.s + oy,
          x2: (cx + w / 2 - lb.px) / lb.s + ox, y2: (cy + h / 2 - lb.py) / lb.s + oy,
          score: bs, cls: best, label: label
        };
        if (reg.pose) {
          var k = [];
          for (var j = 0; j < 17; j++) {
            var kb = base + 5 + j * 3;
            k.push({ x: (data[kb] - lb.px) / lb.s + ox, y: (data[kb + 1] - lb.py) / lb.s + oy, v: data[kb + 2] });
          }
          d.kpts = k;
        }
        dets.push(d);
      }
      dets = nms(dets, opts.iou || 0.5, opts.classAware !== false);
      if (opts.maxDet) dets = dets.slice(0, opts.maxDet);
      var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      dets.ms = Math.round(t1 - t0);
      dets.srcW = lb.w; dets.srcH = lb.h;
      return dets;
    });
  }

  /* ------------------------------------------------------------------ */
  /* PPE analysis — associate helmet / glasses / vest / gloves / ear protection with each person */
  /* ------------------------------------------------------------------ */
  // lower thresholds for the person/head/face anchors and the small items (glasses, gloves, ears) so distant workers and small PPE are evaluated instead of silently dropped; the temporal Tracker absorbs the extra single-frame noise
  var PPE_CONF = { person: 0.3, head: 0.27, face: 0.27, helmet: 0.35, glasses: 0.23, 'safety-vest': 0.35, 'safety-suit': 0.4, gloves: 0.28, 'face-mask': 0.35, 'face-guard': 0.35, hands: 0.4, shoes: 0.35, ear: 0.4, 'ear-mufs': 0.35, foot: 0.9, tool: 0.9, 'medical-suit': 0.5 };

  function expand(b, l, t, r, bt) { var w = b.x2 - b.x1, h = b.y2 - b.y1; return { x1: b.x1 - w * l, y1: b.y1 - h * t, x2: b.x2 + w * r, y2: b.y2 + h * bt }; }
  function center(b) { return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }; }
  function inside(p, b) { return p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2; }

  function analyzePPE(dets, W, H) {
    var by = {}; dets.forEach(function (d) { (by[d.label] = by[d.label] || []).push(d); });
    var persons = (by.person || []).slice();
    var heads = by.head || [], faces = by.face || [], helmets = by.helmet || [], glasses = by.glasses || [], vests = (by['safety-vest'] || []);
    var gloves = by.gloves || [], hands = by.hands || [], muffs = by['ear-mufs'] || [], ears = by.ear || [];
    // People without a person box (close-up webcam): synthesise one from head/face
    var anchors = heads.length ? heads : faces;
    anchors.forEach(function (hd) {
      var covered = persons.some(function (p) { return inside(center(hd), p); });
      if (!covered) {
        var w = hd.x2 - hd.x1, h = hd.y2 - hd.y1;
        persons.push({ x1: Math.max(0, hd.x1 - w * 1.3), y1: Math.max(0, hd.y1 - h * 0.25), x2: Math.min(W, hd.x2 + w * 1.3), y2: Math.min(H, hd.y2 + h * 5), score: hd.score * 0.9, label: 'person', synthetic: true });
      }
    });
    var people = persons.map(function (p) {
      var ph = p.y2 - p.y1;
      var topZone = { x1: p.x1, y1: p.y1 - ph * 0.08, x2: p.x2, y2: p.y1 + ph * 0.5 };
      var head = pickBest(heads, function (h) { return inside(center(h), topZone) ? ioa(h, p) * h.score : 0; });
      var face = pickBest(faces, function (f) { return inside(center(f), topZone) ? ioa(f, p) * f.score : 0; });
      if (!head && face) head = expand(face, 0.18, 0.45, 0.18, 0.1);
      var res = { box: p, head: head, face: face, items: {}, marks: [] };
      // helmet
      if (head) {
        var hz = expand(head, 0.25, 0.7, 0.25, 0.1);
        var hel = pickBest(helmets, function (x) { return (inside(center(x), hz) || ioa(x, hz) > 0.4) ? x.score : 0; });
        res.items.helmet = hel ? { state: 'OK', box: hel, score: hel.score } : { state: 'MISSING', box: { x1: head.x1 - (head.x2 - head.x1) * 0.08, y1: head.y1 - (head.y2 - head.y1) * 0.35, x2: head.x2 + (head.x2 - head.x1) * 0.08, y2: head.y1 + (head.y2 - head.y1) * 0.4 } };
      } else res.items.helmet = { state: 'UNKNOWN' };
      // safety glasses — needs a visible face
      if (face) {
        var gz = expand(face, 0.1, 0.05, 0.1, -0.35);
        var gl = pickBest(glasses, function (x) { return inside(center(x), gz) || ioa(x, face) > 0.5 ? x.score : 0; });
        var fh = face.y2 - face.y1;
        res.items.glasses = gl ? { state: 'OK', box: gl, score: gl.score } : { state: 'MISSING', box: { x1: face.x1 + (face.x2 - face.x1) * 0.04, y1: face.y1 + fh * 0.2, x2: face.x2 - (face.x2 - face.x1) * 0.04, y2: face.y1 + fh * 0.55 } };
      } else res.items.glasses = { state: 'UNKNOWN' };
      // hi-vis vest — needs a visible torso
      var headH = head ? head.y2 - head.y1 : ph * 0.2;
      var torsoTop = head ? head.y2 + headH * 0.15 : p.y1 + ph * 0.25;
      var torsoVisible = (Math.min(p.y2, H) - torsoTop) > headH * 0.55;
      if (torsoVisible) {
        var tz = { x1: p.x1, y1: torsoTop - headH * 0.3, x2: p.x2, y2: p.y2 };
        var vs = pickBest(vests, function (x) { return (ioa(x, tz) > 0.45 && center(x).y > (head ? head.y2 - headH * 0.2 : p.y1)) ? x.score : 0; });
        var pw = p.x2 - p.x1;
        res.items.vest = vs ? { state: 'OK', box: vs, score: vs.score } : { state: 'MISSING', box: { x1: p.x1 + pw * 0.12, y1: torsoTop, x2: p.x2 - pw * 0.12, y2: Math.min(p.y2, torsoTop + headH * 2.6) } };
      } else res.items.vest = { state: 'UNKNOWN' };
      // gloves — judged only when hands are visible: a gloved hand on the person = OK, a bare hand = MISSING
      var hz2 = expand(p, 0.12, 0, 0.12, 0.05);
      var onMe = function (x) { return inside(center(x), hz2) && center(x).y > (head ? head.y2 : p.y1 + ph * 0.2); };
      var glv = pickBest(gloves, function (x) { return onMe(x) ? x.score : 0; });
      var bare = pickBest(hands, function (x) { return onMe(x) ? x.score : 0; });
      res.items.gloves = glv && (!bare || glv.score >= bare.score * 0.8) ? { state: 'OK', box: glv, score: glv.score } : bare ? { state: 'MISSING', box: bare, score: bare.score } : { state: 'UNKNOWN' };
      // ear protection (noisy machines) — ear muffs beside the head = OK; a bare ear, or a clear frontal face without muffs = MISSING
      if (head) {
        var hw = head.x2 - head.x1, hh2 = head.y2 - head.y1;
        var ez = { x1: head.x1 - hw * 0.45, y1: head.y1 - hh2 * 0.2, x2: head.x2 + hw * 0.45, y2: head.y2 + hh2 * 0.25 };
        var muff = pickBest(muffs, function (x) { return inside(center(x), ez) || ioa(x, ez) > 0.4 ? x.score : 0; });
        var ear = pickBest(ears, function (x) { return inside(center(x), ez) ? x.score : 0; });
        var earBox = { x1: head.x1 - hw * 0.12, y1: head.y1 + hh2 * 0.3, x2: head.x2 + hw * 0.12, y2: head.y1 + hh2 * 0.75 };
        res.items.ears = muff ? { state: 'OK', box: muff, score: muff.score } : ear ? { state: 'MISSING', box: ear, score: ear.score } : face && hw > W * 0.06 ? { state: 'MISSING', box: earBox } : { state: 'UNKNOWN' };
      } else res.items.ears = { state: 'UNKNOWN' };
      return res;
    });
    // de-duplicate synthetic persons that overlap real ones
    people = people.filter(function (a, i) { return !a.box.synthetic || !people.some(function (b, j) { return j !== i && !b.box.synthetic && iou(a.box, b.box) > 0.3; }); });
    return people;
  }
  function pickBest(arr, scoreFn) { var best = null, bs = 0; (arr || []).forEach(function (x) { var s = scoreFn(x); if (s > bs) { bs = s; best = x; } }); return best; }

  /* PPE analysis for TITAN ppe_hf.onnx (served by live_server.py) — same rules as TITAN_PPE/ppe_H.py:
     an item belongs to a person when its centre is inside the person box or >40 % of it overlaps;
     helmet/vest is OK only when the positive class is on the person and the NO- class is not. No glasses class. */
  function onPerson(p, x) { return inside(center(x), p) || ioa(x, p) > 0.4; }
  function analyzePPEHF(dets, W, H) {
    var by = {}; dets.forEach(function (d) { (by[d.label] = by[d.label] || []).push(d); });
    var hats = by.Hardhat || [], noHats = by['NO-Hardhat'] || [], vests = by['Safety Vest'] || [], noVests = by['NO-Safety Vest'] || [];
    var persons = (by.Person || []).slice();
    // close-up webcam: no Person box — synthesise one around each head-level detection
    hats.concat(noHats).forEach(function (hd) {
      if (persons.some(function (p) { return onPerson(p, hd); })) return;
      var w = hd.x2 - hd.x1, h = hd.y2 - hd.y1;
      persons.push({ x1: Math.max(0, hd.x1 - w * 1.3), y1: Math.max(0, hd.y1 - h * 0.25), x2: Math.min(W, hd.x2 + w * 1.3), y2: Math.min(H, hd.y2 + h * 5), score: hd.score * 0.9, label: 'Person', synthetic: true });
    });
    return persons.map(function (p) {
      var pw = p.x2 - p.x1, ph = p.y2 - p.y1;
      function mine(arr) { return pickBest(arr, function (x) { return onPerson(p, x) ? x.score : 0; }); }
      var hat = mine(hats), noHat = mine(noHats), vest = mine(vests), noVest = mine(noVests);
      var res = { box: p, head: null, face: null, items: {}, marks: [] };
      res.items.helmet = hat && !noHat ? { state: 'OK', box: hat, score: hat.score }
        : { state: 'MISSING', box: noHat || { x1: p.x1 + pw * 0.25, y1: p.y1, x2: p.x2 - pw * 0.25, y2: p.y1 + ph * 0.2 }, score: noHat ? noHat.score : null };
      if (p.synthetic && !vest && !noVest) res.items.vest = { state: 'UNKNOWN' }; // only a head is in view
      else res.items.vest = vest && !noVest ? { state: 'OK', box: vest, score: vest.score }
        : { state: 'MISSING', box: noVest || { x1: p.x1 + pw * 0.12, y1: p.y1 + ph * 0.22, x2: p.x2 - pw * 0.12, y2: p.y1 + ph * 0.6 }, score: noVest ? noVest.score : null };
      res.items.glasses = { state: 'UNKNOWN' }; res.items.gloves = { state: 'UNKNOWN' }; res.items.ears = { state: 'UNKNOWN' };
      return res;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Tracker + temporal smoothing + violation logic                        */
  /* ------------------------------------------------------------------ */
  function Tracker(opts) {
    this.tracks = []; this.nextId = 1;
    this.opts = Object.assign({ window: 12, missingRatio: 0.55, persistMs: 1500, cooldownMs: 25000, maxAgeMs: 1500, required: ['helmet', 'glasses', 'vest'] }, opts || {});
  }
  Tracker.prototype.update = function (people, now) {
    var self = this, o = this.opts;
    var used = {};
    people.forEach(function (p) {
      var best = null, bi = 0.2;
      self.tracks.forEach(function (t) { if (used[t.id]) return; var v = iou(t.box, p.box); if (v > bi) { bi = v; best = t; } });
      if (!best) { best = { id: self.nextId++, hist: {}, since: {}, lastViolation: {}, identity: null, idVotes: {}, born: now }; self.tracks.push(best); }
      used[best.id] = true;
      best.box = p.box; best.head = p.head; best.face = p.face; best.items = p.items; best.seen = now;
      o.required.forEach(function (k) {
        var h = best.hist[k] = best.hist[k] || [];
        var st = p.items[k] ? p.items[k].state : 'UNKNOWN';
        h.push(st); if (h.length > o.window) h.shift();
        var known = h.filter(function (x) { return x !== 'UNKNOWN'; });
        var miss = h.filter(function (x) { return x === 'MISSING'; }).length;
        var stable = known.length < 3 ? (best.stable && best.stable[k]) || 'UNKNOWN' : (miss / known.length >= o.missingRatio ? 'MISSING' : (known.length - miss) / known.length >= 0.5 ? 'OK' : ((best.stable && best.stable[k]) || 'UNKNOWN'));
        best.stable = best.stable || {}; best.stable[k] = stable;
        if (stable === 'MISSING') { if (!best.since[k]) best.since[k] = now; } else best.since[k] = null;
      });
    });
    this.tracks = this.tracks.filter(function (t) { return now - t.seen < o.maxAgeMs; });
    // violations that just became confirmed
    var out = [];
    this.tracks.forEach(function (t) {
      if (t.seen !== now) return;
      var items = o.required.filter(function (k) { return t.since[k] && now - t.since[k] >= o.persistMs && (!t.lastViolation[k] || now - t.lastViolation[k] > o.cooldownMs); });
      if (items.length) { items.forEach(function (k) { t.lastViolation[k] = now; }); out.push({ track: t, items: items }); }
    });
    return out;
  };
  Tracker.prototype.assignIdentity = function (faceBox, identity, score) {
    var c = center(faceBox), best = null;
    this.tracks.forEach(function (t) { if (inside(c, expand(t.box, 0.05, 0.1, 0.05, 0))) best = best && (best.box.x2 - best.box.x1) < (t.box.x2 - t.box.x1) ? best : t; });
    if (!best) return null;
    best.idVotes[identity] = (best.idVotes[identity] || 0) + (score || 1);
    var top = null, tv = 0; Object.keys(best.idVotes).forEach(function (k) { if (best.idVotes[k] > tv) { tv = best.idVotes[k]; top = k; } });
    best.identity = top === '__unknown__' ? null : top;
    return best;
  };

  /* ------------------------------------------------------------------ */
  /* Behaviour AI (pose): SOS gesture · fall · ergonomics · station       */
  /* ------------------------------------------------------------------ */
  // COCO keypoints: 0 nose 1 l-eye 2 r-eye 3 l-ear 4 r-ear 5 l-sho 6 r-sho 7 l-elb 8 r-elb 9 l-wri 10 r-wri 11 l-hip 12 r-hip 13 l-knee 14 r-knee 15 l-ank 16 r-ank
  var SKELETON = [[5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [0, 1], [0, 2], [1, 3], [2, 4], [0, 5], [0, 6]];
  function kp(p, i, minV) { var k = p.kpts[i]; return k && k.v >= (minV || 0.45) ? k : null; }
  function mid(a, b) { return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) } : (a || b); }
  function analyzePose(p) {
    var nose = kp(p, 0), ls = kp(p, 5), rs = kp(p, 6), lw = kp(p, 9), rw = kp(p, 10), le = kp(p, 7), re = kp(p, 8), lh = kp(p, 11), rh = kp(p, 12), lk = kp(p, 13), rk = kp(p, 14);
    var sho = mid(ls, rs), hip = mid(lh, rh);
    var res = { sos: false, handsUp: 0, fall: false, trunkAngle: null, ergo: null, ergoLevel: null, notes: [] };
    // SOS: both wrists clearly above the head line
    var headY = nose ? nose.y : sho ? sho.y - (p.y2 - p.y1) * 0.12 : null;
    var shoW = ls && rs ? Math.abs(ls.x - rs.x) : (p.x2 - p.x1) * 0.35;
    if (headY != null) {
      var up = 0;
      if (lw && lw.y < headY - shoW * 0.15) up++;
      if (rw && rw.y < headY - shoW * 0.15) up++;
      res.handsUp = up; res.sos = up === 2;
    }
    // trunk angle vs vertical (0 = upright, 90 = horizontal)
    if (sho && hip) {
      var dx = sho.x - hip.x, dy = hip.y - sho.y;
      res.trunkAngle = Math.round(Math.abs(Math.atan2(dx, dy)) * 180 / Math.PI);
    }
    var bw = p.x2 - p.x1, bh = p.y2 - p.y1;
    // fall / person down: horizontal torso or wide-low box with hips near shoulders' height
    if ((res.trunkAngle != null && res.trunkAngle > 58) || (bw > bh * 1.2 && (!(hip && sho) || Math.abs(hip.y - sho.y) < bh * 0.4))) res.fall = true;
    // ergonomic risk (RULA-inspired, simplified): trunk flexion + arm elevation
    if (res.trunkAngle != null) {
      var score = res.trunkAngle < 10 ? 1 : res.trunkAngle < 25 ? 2 : res.trunkAngle < 45 ? 3 : 4;
      var armUp = 0;
      [[ls, le], [rs, re]].forEach(function (pair) { if (pair[0] && pair[1] && pair[1].y < pair[0].y - shoW * 0.1) armUp = 1; });
      score += armUp;
      res.ergo = score; res.ergoLevel = score <= 2 ? 'LOW' : score <= 3 ? 'MEDIUM' : 'HIGH';
      if (res.trunkAngle >= 45 && !res.fall) res.notes.push('انحناء خطر للظهر');
    }
    return res;
  }

  /* ------------------------------------------------------------------ */
  /* ANPR — Egyptian plate text assembly                                   */
  /* ------------------------------------------------------------------ */
  function charInfo(label) {
    if (/^[0-9]$/.test(label)) return { kind: 'digit', ch: AR_DIGITS[+label], latin: label };
    var a = AR[label]; return a ? { kind: 'letter', ch: a, latin: label } : null;
  }
  // Ensemble of one or two recognisers → one plate reading (digits on the left, letters on the right)
  function assemblePlate(lists, weights) {
    var all = [];
    lists.forEach(function (l, li) { (l || []).forEach(function (d) { var ci = charInfo(d.label); if (ci) all.push({ x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, score: d.score * (weights ? weights[li] : 1), ci: ci }); }); });
    if (!all.length) return null;
    // median char height → reject noise (top band text "مصر EGYPT" is much smaller)
    var hs = all.map(function (d) { return d.y2 - d.y1; }).sort(function (a, b) { return a - b; });
    var medH = hs[Math.floor(hs.length / 2)];
    all = all.filter(function (d) { return (d.y2 - d.y1) > medH * 0.55; });
    all.sort(function (a, b) { return (a.x1 + a.x2) - (b.x1 + b.x2); });
    // cluster overlapping boxes across models
    var clusters = [];
    all.forEach(function (d) {
      var c = clusters.filter(function (c) { return iou(c.box, d) > 0.35 || Math.abs((c.box.x1 + c.box.x2) / 2 - (d.x1 + d.x2) / 2) < (d.x2 - d.x1) * 0.35; })[0];
      if (!c) { c = { box: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }, votes: {} }; clusters.push(c); }
      var key = d.ci.kind + ':' + d.ci.ch;
      c.votes[key] = (c.votes[key] || 0) + d.score;
      c.box = { x1: Math.min(c.box.x1, d.x1), y1: Math.min(c.box.y1, d.y1), x2: Math.max(c.box.x2, d.x2), y2: Math.max(c.box.y2, d.y2) };
    });
    clusters.sort(function (a, b) { return (a.box.x1 + a.box.x2) - (b.box.x1 + b.box.x2); });
    function best(c, kind) { var bk = null, bv = 0; Object.keys(c.votes).forEach(function (k) { if (k.indexOf(kind + ':') === 0 && c.votes[k] > bv) { bv = c.votes[k]; bk = k.slice(kind.length + 1); } }); return { ch: bk, v: bv }; }
    // choose split: digits left of k, letters from k — maximise total evidence
    var bestK = 0, bestSum = -1;
    for (var k = 0; k <= clusters.length; k++) {
      var sum = 0;
      for (var i = 0; i < clusters.length; i++) sum += i < k ? best(clusters[i], 'digit').v : best(clusters[i], 'letter').v;
      if (sum > bestSum) { bestSum = sum; bestK = k; }
    }
    var digits = [], letters = [], conf = [];
    clusters.forEach(function (c, i) {
      var b = best(c, i < bestK ? 'digit' : 'letter');
      if (!b.ch || b.v < 0.2) return;
      (i < bestK ? digits : letters).push({ ch: b.ch, box: c.box, v: b.v });
      conf.push(Math.min(1, b.v / (weights ? weights.reduce(function (a, x) { return a + x; }, 0) : 1)));
    });
    if (digits.length > 4) digits = digits.sort(function (a, b) { return b.v - a.v; }).slice(0, 4).sort(function (a, b) { return a.box.x1 - b.box.x1; });
    if (letters.length > 3) letters = letters.sort(function (a, b) { return b.v - a.v; }).slice(0, 3).sort(function (a, b) { return a.box.x1 - b.box.x1; });
    if (!digits.length && !letters.length) return null;
    var lettersReading = letters.slice().reverse().map(function (l) { return l.ch; }); // rightmost letter is read first
    var digitStr = digits.map(function (d) { return d.ch; }).join('');
    var avg = conf.length ? conf.reduce(function (a, b) { return a + b; }, 0) / conf.length : 0;
    return {
      text: lettersReading.join(' ') + (digitStr ? '  ' + digitStr : ''), letters: lettersReading, digits: digitStr,
      visualLeftToRight: digits.map(function (d) { return d.ch; }).concat(letters.map(function (l) { return l.ch; })),
      conf: Math.round(avg * 100) / 100, valid: digits.length >= 1 && digits.length <= 4 && letters.length >= 1 && letters.length <= 3,
      boxes: digits.concat(letters).map(function (x) { return x.box; })
    };
  }

  // Multi-frame vote (video / webcam) — stabilises the reading of a moving plate.
  function PlateVoter(maxAgeMs) { this.reads = []; this.maxAge = maxAgeMs || 2500; }
  PlateVoter.prototype.add = function (r, now) {
    if (!r || !r.valid) return null;
    this.reads.push({ r: r, t: now });
    var self = this; this.reads = this.reads.filter(function (x) { return now - x.t < self.maxAge; });
    var tally = {};
    this.reads.forEach(function (x) { var k = x.r.text; tally[k] = tally[k] || { n: 0, conf: 0, r: x.r }; tally[k].n++; tally[k].conf += x.r.conf; });
    var best = null; Object.keys(tally).forEach(function (k) { if (!best || tally[k].n > best.n || (tally[k].n === best.n && tally[k].conf > best.conf)) best = tally[k]; });
    return best ? { reading: best.r, votes: best.n, total: this.reads.length, stable: best.n >= 3 && best.n / this.reads.length >= 0.5 } : null;
  };
  PlateVoter.prototype.reset = function () { this.reads = []; };

  return {
    setTF: setTF, getTF: getTF, setBase: setBase, load: load, loaded: loaded, register: register, warmup: warmup, run: run, REGISTRY: REGISTRY,
    analyzePPE: analyzePPE, analyzePPEHF: analyzePPEHF, Tracker: Tracker, analyzePose: analyzePose, SKELETON: SKELETON,
    assemblePlate: assemblePlate, PlateVoter: PlateVoter, PPE_CONF: PPE_CONF, iou: iou, ioa: ioa, nms: nms, AR_DIGITS: AR_DIGITS,
    SH17: SH17, OCR_N: OCR_N, OCR_M: OCR_M, OCR_EG: OCR_EG
  };
});
