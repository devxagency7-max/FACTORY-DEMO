/*!
 * EGIC · AI Safety & Smart Access Platform — Data & Simulation Engine
 * Proposed & engineered by DELMON × DEV SMART X
 *
 * Runs in two places with identical behaviour:
 *   1) Node.js backend  (server/server.js)  → REST API + live SSE stream
 *   2) The browser       (embedded mode)     → same API, in-memory, when no backend is reachable
 *
 * All generated records are DEMO / SIMULATED data and are flagged as such.
 * Records created by the live AI models (camera PPE + Egyptian ANPR) are flagged source:"live-*".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EGICEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.4.0';
  var MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;

  /* ------------------------------------------------------------------ */
  /* Random                                                              */
  /* ------------------------------------------------------------------ */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function Rng(seed) { this.f = mulberry32(seed >>> 0); }
  Rng.prototype.next = function () { return this.f(); };
  Rng.prototype.int = function (a, b) { return a + Math.floor(this.f() * (b - a + 1)); };
  Rng.prototype.range = function (a, b) { return a + this.f() * (b - a); };
  Rng.prototype.pick = function (arr) { return arr[Math.floor(this.f() * arr.length)]; };
  Rng.prototype.chance = function (p) { return this.f() < p; };
  Rng.prototype.normal = function (mu, sd) {
    var u = 1 - this.f(), v = this.f();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  Rng.prototype.poisson = function (l) {
    if (l <= 0) return 0;
    if (l > 30) return Math.max(0, Math.round(this.normal(l, Math.sqrt(l))));
    var L = Math.exp(-l), k = 0, p = 1;
    do { k++; p *= this.f(); } while (p > L);
    return k - 1;
  };
  Rng.prototype.weighted = function (pairs) { // [[item, weight], ...]
    var tot = 0, i;
    for (i = 0; i < pairs.length; i++) tot += pairs[i][1];
    var r = this.f() * tot;
    for (i = 0; i < pairs.length; i++) { r -= pairs[i][1]; if (r <= 0) return pairs[i][0]; }
    return pairs[pairs.length - 1][0];
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function round(v, d) { var m = Math.pow(10, d || 0); return Math.round(v * m) / m; }

  var AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  function toArabicDigits(s) { return String(s).replace(/[0-9]/g, function (d) { return AR_DIGITS[+d]; }); }
  function toLatinDigits(s) { return String(s).replace(/[٠-٩]/g, function (d) { return String(AR_DIGITS.indexOf(d)); }); }

  /* ------------------------------------------------------------------ */
  /* Time zone helpers (Cairo / Riyadh)                                   */
  /* ------------------------------------------------------------------ */
  var tzCache = {};
  function tzOffsetMin(tz, ts) {
    var key = tz + ':' + Math.floor(ts / (6 * HOUR));
    if (tzCache[key] !== undefined) return tzCache[key];
    var off = 180;
    try {
      var dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      var p = {}; dtf.formatToParts(new Date(ts)).forEach(function (x) { p[x.type] = x.value; });
      var asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
      off = Math.round((asUTC - Math.floor(ts / 1000) * 1000) / MIN);
    } catch (e) { off = 180; }
    tzCache[key] = off;
    return off;
  }
  function localParts(ts, tz) {
    var d = new Date(ts + tzOffsetMin(tz || 'Africa/Cairo', ts) * MIN);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), dow: d.getUTCDay() };
  }
  function localDayStart(ts, tz) {
    var off = tzOffsetMin(tz || 'Africa/Cairo', ts) * MIN;
    return Math.floor((ts + off) / DAY) * DAY - off;
  }
  function shiftOf(hour) { return hour >= 6 && hour < 14 ? 'A' : hour >= 14 && hour < 22 ? 'B' : 'C'; }

  /* ------------------------------------------------------------------ */
  /* Reference model: PPE items, event types, zones, sites               */
  /* ------------------------------------------------------------------ */
  var PPE = {
    helmet:  { id: 'helmet',  ar: 'الخوذة',          en: 'Helmet',       base: 0.955 },
    glasses: { id: 'glasses', ar: 'نظارة الوقاية',    en: 'Safety glasses', base: 0.905 },
    vest:    { id: 'vest',    ar: 'السترة العاكسة',   en: 'Hi-vis vest',  base: 0.94 },
    gloves:  { id: 'gloves',  ar: 'القفازات',         en: 'Gloves',       base: 0.915 },
    shoes:   { id: 'shoes',   ar: 'حذاء السلامة',     en: 'Safety shoes', base: 0.975 },
    ears:    { id: 'ears',    ar: 'سماعات حماية الأذن', en: 'Hearing protection', base: 0.93 }
  };
  var PPE_ORDER = ['helmet', 'glasses', 'vest', 'gloves', 'ears', 'shoes'];

  var SEV = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  var SEV_AR = { LOW: 'منخفضة', MEDIUM: 'متوسطة', HIGH: 'عالية', CRITICAL: 'حرجة' };

  var TYPES = {
    NO_HELMET:        { group: 'PPE',       ppe: 'helmet',  ar: 'عدم ارتداء الخوذة',            en: 'No helmet',               sev: 'HIGH' },
    NO_GLASSES:       { group: 'PPE',       ppe: 'glasses', ar: 'عدم ارتداء نظارة الوقاية',      en: 'No safety glasses',       sev: 'MEDIUM' },
    NO_VEST:          { group: 'PPE',       ppe: 'vest',    ar: 'عدم ارتداء السترة العاكسة',     en: 'No hi-vis vest',          sev: 'MEDIUM' },
    NO_GLOVES:        { group: 'PPE',       ppe: 'gloves',  ar: 'عدم ارتداء القفازات',           en: 'No gloves',               sev: 'MEDIUM' },
    NO_SHOES:         { group: 'PPE',       ppe: 'shoes',   ar: 'عدم ارتداء حذاء السلامة',       en: 'No safety shoes',         sev: 'MEDIUM' },
    NO_EARMUFFS:      { group: 'PPE',       ppe: 'ears',    ar: 'عدم ارتداء سماعات حماية الأذن',  en: 'No hearing protection',   sev: 'MEDIUM' },
    RESTRICTED_ZONE:  { group: 'ZONE',      ar: 'دخول منطقة محظورة',            en: 'Restricted zone entry',   sev: 'HIGH' },
    LINE_CROSSING:    { group: 'ZONE',      ar: 'عبور خط أمان',                  en: 'Safety line crossing',    sev: 'MEDIUM' },
    INTRUSION:        { group: 'ZONE',      ar: 'تسلل خارج أوقات العمل',         en: 'After-hours intrusion',   sev: 'CRITICAL' },
    UNSAFE_PROXIMITY: { group: 'PROXIMITY', ar: 'اقتراب غير آمن من ماكينة',      en: 'Unsafe machine proximity', sev: 'HIGH' },
    PERSON_VEHICLE:   { group: 'PROXIMITY', ar: 'تقارب شخص ورافعة شوكية',        en: 'Person–forklift proximity', sev: 'HIGH' },
    CROWD:            { group: 'BEHAVIOR',  ar: 'تكدّس وازدحام',                 en: 'Crowding / congestion',   sev: 'LOW', alert: true },
    RUNNING:          { group: 'BEHAVIOR',  ar: 'جري داخل الصالة',               en: 'Running / rushing',       sev: 'LOW' },
    FALL:             { group: 'BEHAVIOR',  ar: 'سقوط شخص',                      en: 'Person fall',             sev: 'CRITICAL', alert: true },
    WORK_AT_HEIGHT:   { group: 'BEHAVIOR',  ar: 'عمل على ارتفاع بدون حماية',     en: 'Unprotected work at height', sev: 'HIGH' },
    SOS_GESTURE:      { group: 'BEHAVIOR',  ar: 'إشارة استغاثة يدوية',           en: 'SOS hand gesture',        sev: 'CRITICAL', ai: 'pose', alert: true },
    UNATTENDED_STATION: { group: 'BEHAVIOR', ar: 'ترك محطة التشغيل (ماكينة بدون مشغّل)', en: 'Unattended machine station', sev: 'MEDIUM', ai: 'pose' },
    ERGONOMIC_RISK:   { group: 'BEHAVIOR',  ar: 'وضعية عمل خطرة (انحناء الظهر)', en: 'Ergonomic posture risk',  sev: 'LOW', ai: 'pose', alert: true },
    FIRE_DETECTED:    { group: 'HAZARD',    ar: 'حريق — رصد لهب',                en: 'Fire detected',           sev: 'CRITICAL', ai: 'fire', alert: true },
    SMOKE_DETECTED:   { group: 'HAZARD',    ar: 'دخان — إنذار مبكر بحريق',       en: 'Smoke detected',          sev: 'HIGH', ai: 'fire', alert: true },
    SMOKING_DETECTED: { group: 'HAZARD',    ar: 'التدخين داخل المنشأة',          en: 'Smoking detected',        sev: 'HIGH', ai: 'smoking' }
  };
  var GROUP_AR = { PPE: 'معدات الوقاية', ZONE: 'المناطق', PROXIMITY: 'التقارب', BEHAVIOR: 'السلوك', HAZARD: 'الحريق والمخاطر' };
  // Safety alerts (fire, fall, SOS…) call for help — they are never counted against a worker.
  // Every other type is conduct: it stays PENDING until a named supervisor confirms it from the evidence.
  var REVIEW_AR = { PENDING: 'بانتظار مراجعة المشرف', CONFIRMED: 'مخالفة مؤكدة', REJECTED: 'ليست مخالفة' };
  function isConduct(type) { return !!TYPES[type] && !TYPES[type].alert; }

  // zone kind → [event type, weight]
  var KIND_EVENTS = {
    checkpoint: [['NO_HELMET', 5], ['NO_GLASSES', 4], ['NO_VEST', 4], ['NO_SHOES', 1]],
    production: [['NO_HELMET', 5], ['NO_VEST', 3], ['NO_GLASSES', 3], ['NO_GLOVES', 2], ['NO_EARMUFFS', 2.5], ['NO_SHOES', 1], ['UNSAFE_PROXIMITY', 2], ['RUNNING', 1.5], ['CROWD', 1], ['LINE_CROSSING', 1.5], ['UNATTENDED_STATION', 1.2], ['ERGONOMIC_RISK', 0.8], ['SOS_GESTURE', 0.03]],
    hot:        [['NO_HELMET', 3], ['NO_GLOVES', 4], ['NO_GLASSES', 3], ['NO_EARMUFFS', 2], ['RESTRICTED_ZONE', 3], ['UNSAFE_PROXIMITY', 2]],
    chemical:   [['NO_GLOVES', 5], ['NO_GLASSES', 4], ['RESTRICTED_ZONE', 2], ['NO_VEST', 1]],
    machine:    [['UNSAFE_PROXIMITY', 4], ['NO_GLASSES', 4], ['NO_GLOVES', 2], ['NO_EARMUFFS', 3], ['LINE_CROSSING', 2], ['UNATTENDED_STATION', 1.5]],
    test:       [['RESTRICTED_ZONE', 5], ['NO_GLASSES', 2], ['NO_HELMET', 2]],
    packing:    [['NO_VEST', 3], ['CROWD', 2], ['PERSON_VEHICLE', 2], ['NO_SHOES', 1], ['NO_HELMET', 1]],
    storage:    [['NO_HELMET', 3], ['NO_VEST', 3], ['PERSON_VEHICLE', 3], ['WORK_AT_HEIGHT', 2], ['FALL', 0.25], ['ERGONOMIC_RISK', 1.2]],
    dock:       [['PERSON_VEHICLE', 4], ['NO_VEST', 3], ['NO_HELMET', 2], ['FALL', 0.2]],
    forklift:   [['PERSON_VEHICLE', 5], ['LINE_CROSSING', 3], ['RUNNING', 1]],
    gate:       [['NO_VEST', 2], ['LINE_CROSSING', 2]],
    perimeter:  [['INTRUSION', 1], ['LINE_CROSSING', 2]]
  };
  var KIND_REQ = {
    checkpoint: ['helmet', 'glasses', 'vest'],
    production: ['helmet', 'vest', 'glasses', 'gloves', 'ears', 'shoes'],
    hot: ['helmet', 'gloves', 'glasses', 'ears', 'shoes'],
    chemical: ['gloves', 'glasses', 'vest', 'shoes'],
    machine: ['glasses', 'gloves', 'ears', 'shoes'],
    test: ['helmet', 'glasses', 'shoes'],
    packing: ['vest', 'shoes'],
    storage: ['helmet', 'vest', 'shoes'],
    dock: ['helmet', 'vest', 'shoes'],
    forklift: ['vest', 'shoes'],
    gate: ['vest'],
    perimeter: []
  };

  function Z(id, name, nameEn, kind, weight, restricted, required) { return { id: id, name: name, nameEn: nameEn, kind: kind, w: weight, restricted: !!restricted, required: (required || KIND_REQ[kind] || []).slice() }; }

  var PROFILES = {
    plastics: [
      Z('CHK', 'نقطة فحص معدات الوقاية — مدخل الصالة', 'PPE checkpoint — hall entrance', 'checkpoint', 2),
      Z('EXT', 'خط البثق', 'Extrusion line', 'production', 7),
      Z('INJ', 'خط الحقن', 'Injection molding', 'production', 6),
      Z('MIX', 'غرفة الخلط والخامات', 'Compounding & raw materials', 'production', 2),
      Z('QLT', 'معمل الجودة والاختبار', 'Quality lab & pressure test', 'test', 2, true),
      Z('PCK', 'خط التغليف', 'Packaging line', 'packing', 4),
      Z('STR', 'مخزن الإنتاج التام', 'Finished goods store', 'storage', 4),
      Z('FRK', 'ممر الرافعات الشوكية', 'Forklift lane', 'forklift', 3),
      Z('DCK', 'رصيف التحميل', 'Loading dock', 'dock', 3),
      Z('GTE', 'البوابات', 'Gates', 'gate', 2),
      Z('PER', 'المحيط الخارجي', 'Perimeter', 'perimeter', 3)
    ],
    foundry: [
      Z('CHK', 'نقطة فحص معدات الوقاية — مدخل الصالة', 'PPE checkpoint — hall entrance', 'checkpoint', 2),
      Z('CST', 'منطقة الأفران والصب', 'Furnace & casting', 'hot', 5, true),
      Z('FRG', 'الحدادة الساخنة والصب بالقالب', 'Hot forging & die casting', 'hot', 4),
      Z('CNC', 'ورشة CNC والتشغيل', 'CNC machining cell', 'machine', 6),
      Z('PLT', 'خط الطلاء الكهربائي', 'Electroplating line', 'chemical', 4, true),
      Z('ASM', 'التجميع واختبار الضغط', 'Assembly & pressure test', 'test', 4),
      Z('PCK', 'خط التغليف', 'Packaging line', 'packing', 3),
      Z('FRK', 'ممر الرافعات الشوكية', 'Forklift lane', 'forklift', 2),
      Z('DCK', 'رصيف التحميل', 'Loading dock', 'dock', 2),
      Z('GTE', 'البوابات', 'Gates', 'gate', 2),
      Z('PER', 'المحيط الخارجي', 'Perimeter', 'perimeter', 3)
    ],
    assembly: [
      Z('CHK', 'نقطة فحص معدات الوقاية — مدخل الصالة', 'PPE checkpoint — hall entrance', 'checkpoint', 2),
      Z('INJ', 'خط الحقن', 'Injection molding', 'production', 5),
      Z('ASM', 'خطوط التجميع', 'Assembly lines', 'production', 6),
      Z('TST', 'منطقة الاختبار', 'Test bay', 'test', 2, true),
      Z('PCK', 'خط التغليف', 'Packaging line', 'packing', 4),
      Z('STR', 'مخزن المكونات', 'Components store', 'storage', 3),
      Z('FRK', 'ممر الرافعات الشوكية', 'Forklift lane', 'forklift', 2),
      Z('DCK', 'رصيف التحميل', 'Loading dock', 'dock', 2),
      Z('GTE', 'البوابات', 'Gates', 'gate', 2),
      Z('PER', 'المحيط الخارجي', 'Perimeter', 'perimeter', 2)
    ],
    // EGIC brass-rod plant (from the site survey, Oct 2026) — the real factory profile
    egic: [
      Z('CHK', 'مدخل العمال — فحص معدات الوقاية', 'Workers entrance — PPE check', 'checkpoint', 2, false, ['vest', 'shoes']),
      Z('FRN', 'منصة الأفران — شحن الأفران', 'Furnace platform — charging', 'hot', 4, true, ['vest', 'gloves', 'shoes']),
      Z('CST', 'ماكينات السحب والسباكة', 'Casting & drawing machines', 'hot', 4, false, ['vest', 'gloves', 'shoes']),
      Z('HL1', 'عنبر السباكة — الممرات', 'Casting hall — aisles', 'production', 4, false, ['vest', 'shoes']),
      Z('STR', 'تخزين الأسياخ', 'Rod storage', 'storage', 3, false, ['vest', 'shoes']),
      Z('FIN', 'عنبر التشطيب والتقطيع', 'Finishing & cutting hall', 'machine', 5, false, ['vest', 'ears', 'gloves', 'shoes']),
      Z('WLD', 'محطة اللحام', 'Welding station', 'hot', 1, false, ['vest', 'gloves']),
      Z('CRN', 'الونش والتحميل', 'Crane & loading', 'dock', 2, false, ['vest', 'shoes']),
      Z('GTE', 'البوابة', 'Gate', 'gate', 1, false, ['vest'])
    ],
    warehouse: [
      Z('CHK', 'نقطة فحص معدات الوقاية — مدخل المخزن', 'PPE checkpoint — entrance', 'checkpoint', 1),
      Z('RCK', 'ممرات التخزين (Racking)', 'Racking aisles', 'storage', 7),
      Z('DK1', 'رصيف التحميل 1', 'Loading dock 1', 'dock', 4),
      Z('DK2', 'رصيف التحميل 2', 'Loading dock 2', 'dock', 3),
      Z('FRK', 'ممر الرافعات الشوكية', 'Forklift lane', 'forklift', 4),
      Z('STG', 'منطقة التجهيز والشحن', 'Staging & dispatch', 'packing', 3),
      Z('GTE', 'البوابات', 'Gates', 'gate', 2),
      Z('PER', 'المحيط الخارجي', 'Perimeter', 'perimeter', 3)
    ]
  };

  var DEPTS = {
    plastics: ['البثق', 'الحقن', 'الخلط والخامات', 'الجودة', 'التغليف', 'المخازن والنقل الداخلي', 'الصيانة', 'الأمن'],
    foundry: ['الصب والسبك', 'الحدادة والقوالب', 'CNC والتشغيل', 'الطلاء الكهربائي', 'التجميع والاختبار', 'التغليف', 'الصيانة', 'الأمن'],
    assembly: ['الحقن', 'التجميع', 'الاختبار', 'التغليف', 'المخازن والنقل الداخلي', 'الصيانة', 'الأمن'],
    warehouse: ['المخازن', 'الشحن والتفريغ', 'النقل الداخلي', 'الأمن'],
    egic: ['الأفران والسباكة', 'السحب', 'التشطيب والتقطيع', 'المخازن والتحميل', 'الصيانة', 'الأمن']
  };
  var ZONE_DEPT = { // which department typically works in which zone kind
    checkpoint: null, production: null, hot: ['الصب والسبك', 'الحدادة والقوالب'], chemical: ['الطلاء الكهربائي'],
    machine: ['CNC والتشغيل'], test: ['الجودة', 'التجميع والاختبار', 'الاختبار'], packing: ['التغليف', 'الشحن والتفريغ'],
    storage: ['المخازن والنقل الداخلي', 'المخازن'], dock: ['المخازن والنقل الداخلي', 'الشحن والتفريغ', 'المخازن'],
    forklift: ['المخازن والنقل الداخلي', 'النقل الداخلي'], gate: ['الأمن'], perimeter: ['الأمن']
  };

  // 9 sites — DEMO configuration (camera counts / gates are illustrative, to be confirmed during site assessment)
  var SITES = [
    { id: 'PLT-01', code: 'P01', type: 'plant', profile: 'plastics', name: 'المصنع 01', nameEn: 'Plant 01', sub: 'أنابيب ووصلات بلاستيك', country: 'EG', tz: 'Africa/Cairo', cams: 60, gates: [['G1', 'البوابة الرئيسية'], ['G2', 'بوابة الشاحنات']], workers: 290, risk: 1.00 },
    { id: 'PLT-02', code: 'P02', type: 'plant', profile: 'plastics', name: 'المصنع 02', nameEn: 'Plant 02', sub: 'أنابيب PE وPPR', country: 'EG', tz: 'Africa/Cairo', cams: 56, gates: [['G1', 'البوابة الرئيسية'], ['G2', 'بوابة الشاحنات']], workers: 260, risk: 1.08 },
    { id: 'PLT-03', code: 'P03', type: 'plant', profile: 'foundry', name: 'المصنع 03', nameEn: 'Plant 03', sub: 'سبك وتشغيل النحاس', country: 'EG', tz: 'Africa/Cairo', cams: 52, gates: [['G1', 'البوابة الرئيسية'], ['G2', 'بوابة الشاحنات']], workers: 230, risk: 1.22 },
    { id: 'PLT-04', code: 'P04', type: 'plant', profile: 'assembly', name: 'المصنع 04', nameEn: 'Plant 04', sub: 'حقن وتجميع', country: 'EG', tz: 'Africa/Cairo', cams: 44, gates: [['G1', 'البوابة الرئيسية'], ['G2', 'بوابة الشاحنات']], workers: 200, risk: 0.94 },
    { id: 'PLT-05', code: 'P05', type: 'plant', profile: 'assembly', name: 'المصنع 05', nameEn: 'Plant 05', sub: 'إكسسوارات ومضخات', country: 'EG', tz: 'Africa/Cairo', cams: 40, gates: [['G1', 'البوابة الرئيسية']], workers: 170, risk: 0.9 },
    { id: 'WH-01', code: 'W01', type: 'warehouse', profile: 'warehouse', name: 'المخزن 01', nameEn: 'Warehouse 01', sub: 'مخزن مركزي', country: 'EG', tz: 'Africa/Cairo', cams: 28, gates: [['G1', 'بوابة الدخول'], ['G2', 'بوابة الخروج']], workers: 85, risk: 1.05 },
    { id: 'WH-02', code: 'W02', type: 'warehouse', profile: 'warehouse', name: 'المخزن 02', nameEn: 'Warehouse 02', sub: 'مخزن توزيع', country: 'EG', tz: 'Africa/Cairo', cams: 24, gates: [['G1', 'البوابة الرئيسية']], workers: 70, risk: 1.0 },
    { id: 'WH-03', code: 'W03', type: 'warehouse', profile: 'warehouse', name: 'المخزن 03', nameEn: 'Warehouse 03', sub: 'مخزن توزيع', country: 'EG', tz: 'Africa/Cairo', cams: 20, gates: [['G1', 'البوابة الرئيسية']], workers: 60, risk: 0.96 },
    { id: 'KSA-01', code: 'K01', type: 'ksa', profile: 'warehouse', name: 'موقع السعودية', nameEn: 'KSA Site', sub: 'المملكة العربية السعودية', country: 'SA', tz: 'Asia/Riyadh', cams: 36, gates: [['G1', 'البوابة الرئيسية'], ['G2', 'بوابة الشاحنات']], workers: 95, risk: 0.92 }
  ];

  // the real factory (EGIC_DEMO=0): one plant, real cameras only. Id stays PLT-01 so live cameras and employees keep their site.
  var FACTORY_SITES = [
    { id: 'PLT-01', code: 'P01', type: 'plant', profile: 'egic', name: 'مصنع EGIC', nameEn: 'EGIC Plant', sub: 'سباكة وسحب أسياخ النحاس', country: 'EG', tz: 'Africa/Cairo', cams: 0, gates: [['G1', 'البوابة الرئيسية']], workers: 0, risk: 1 }
  ];

  // attendance defaults — shift times, late/early grace and weekly day off (editable from the attendance screen)
  var ATT_DEFAULTS = {
    shifts: { A: { name: 'الوردية أ', start: '06:00', end: '14:00' }, B: { name: 'الوردية ب', start: '14:00', end: '22:00' }, C: { name: 'الوردية ج', start: '22:00', end: '06:00' } },
    graceMin: 15, earlyMin: 15, weekend: [5], gapSec: 30
  };
  function hmToMin(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? (+m[1] % 24) * 60 + Math.min(59, +m[2]) : 0; }

  var EG_LETTERS = ['أ', 'ب', 'ج', 'د', 'ر', 'س', 'ص', 'ط', 'ع', 'ف', 'ق', 'ل', 'م', 'ن', 'هـ', 'و', 'ى'];
  var SA_LETTERS = [['ا', 'A'], ['ب', 'B'], ['ح', 'J'], ['د', 'D'], ['ر', 'R'], ['س', 'S'], ['ص', 'X'], ['ط', 'T'], ['ع', 'E'], ['ق', 'G'], ['ك', 'K'], ['ل', 'L'], ['م', 'Z'], ['ن', 'N'], ['هـ', 'H'], ['و', 'U'], ['ى', 'V']];

  /* Plate normalisation — used to match live-read plates with the vehicle registry */
  function normalizePlate(s) {
    if (!s) return '';
    s = toLatinDigits(String(s));
    s = s.replace(/[إأآا]/g, 'ا').replace(/[ىي]/g, 'ى').replace(/[ةه]/g, 'ه').replace(/ـ/g, '').replace(/ؤ/g, 'و');
    s = s.replace(/[^0-9ء-يA-Za-z]/g, '');
    // letters first then digits (order-insensitive inside each group is NOT applied: order matters)
    var letters = s.replace(/[0-9]/g, ''), digits = s.replace(/[^0-9]/g, '');
    return letters + '|' + digits;
  }
  function formatEgPlate(letters, digits) { return letters.join(' ') + '  ' + toArabicDigits(digits); }

  /* ------------------------------------------------------------------ */
  /* Engine                                                               */
  /* ------------------------------------------------------------------ */
  function Engine(opts) {
    opts = opts || {};
    this.seed = opts.seed || 20260929;
    this.now = opts.now || Date.now();
    this.days = opts.days || 30;
    this.gateDays = opts.gateDays || 7;
    this.listeners = [];
    this.timers = [];
    this.seq = { evt: 0, gate: 0, audit: 0, rep: 0, inc: 0 };
    this.rng = new Rng(this.seed);
    this.live = new Rng((this.seed ^ 0x9e3779b9) + (Date.now() % 100000));
    this.mode = opts.mode || 'embedded';
    // demo = simulated sites, history, gate traffic and live sim events. A real factory runs with demo:false.
    this.demo = opts.demo !== false;
    this.sites = this.demo ? SITES : FACTORY_SITES;
    this.startedAt = Date.now();
    this.build();
  }

  Engine.prototype.emit = function (type, data) {
    var msg = { type: type, ts: Date.now(), data: data };
    for (var i = 0; i < this.listeners.length; i++) {
      try { this.listeners[i](msg); } catch (e) { /* listener errors must never break the engine */ }
    }
  };
  Engine.prototype.on = function (fn) {
    var self = this; this.listeners.push(fn);
    return function () { self.listeners = self.listeners.filter(function (f) { return f !== fn; }); };
  };

  Engine.prototype.site = function (id) { for (var i = 0; i < this.sites.length; i++) if (this.sites[i].id === id) return this.sites[i]; return null; };
  Engine.prototype.zone = function (siteId, zoneId) {
    var s = this.site(siteId); if (!s) return null;
    var zs = PROFILES[s.profile];
    for (var i = 0; i < zs.length; i++) if (zs[i].id === zoneId) return zs[i];
    return null;
  };

  /* ---------------- build all reference + historical data ---------------- */
  Engine.prototype.build = function () {
    var r = this.rng, self = this;
    this.cameras = []; this.camById = {};
    this.workers = []; this.workerById = {};
    this.gates = [];
    this.sites.forEach(function (s) {
      var zs = PROFILES[s.profile];
      // cameras distributed by zone weight (demo only — the factory lists its real IP cameras)
      var totW = zs.reduce(function (a, z) { return a + z.w; }, 0);
      var alloc = zs.map(function (z) { return self.demo ? Math.max(1, Math.round(s.cams * z.w / totW)) : 0; });
      var diff = self.demo ? s.cams - alloc.reduce(function (a, b) { return a + b; }, 0) : 0;
      for (var k = 0; diff !== 0 && k < 100; k++) { var idx = k % alloc.length; if (diff > 0) { alloc[idx]++; diff--; } else if (alloc[idx] > 1) { alloc[idx]--; diff++; } }
      var n = 0;
      zs.forEach(function (z, zi) {
        for (var c = 0; c < alloc[zi]; c++) {
          n++;
          var id = s.code + '-CAM-' + pad(n, 3);
          var legacy = r.chance(0.12), analog = r.chance(0.05);
          var res = analog ? 'D1 (تناظري)' : legacy ? r.pick(['720p', '1080p']) : r.pick(['1080p', '1080p', '4MP', '4MP', '5MP']);
          var fps = analog ? 25 : r.pick([15, 20, 25, 25, 25]);
          var protocol = analog ? 'Analog → Encoder' : legacy && r.chance(0.35) ? 'RTSP' : 'RTSP / ONVIF';
          var dark = z.kind === 'perimeter' || (z.kind === 'dock' && r.chance(0.3));
          var assess = analog ? 'UPGRADE' : (res === '720p' && (z.kind === 'checkpoint' || z.kind === 'production')) ? 'REPLACE' : (dark && r.chance(0.5)) ? 'UPGRADE' : (protocol === 'RTSP' && r.chance(0.4)) ? 'UPGRADE' : r.chance(0.04) ? 'REPLACE' : 'USE';
          var st = r.chance(0.968) ? 'online' : r.chance(0.6) ? 'degraded' : 'offline';
          var cam = {
            id: id, siteId: s.id, zoneId: z.id, name: z.name + ' · ' + pad(c + 1, 2), nameEn: z.nameEn + ' ' + pad(c + 1, 2),
            kind: z.kind === 'perimeter' ? r.pick(['bullet', 'ptz']) : z.kind === 'storage' ? r.pick(['dome', 'bullet']) : r.pick(['dome', 'bullet', 'bullet']),
            res: res, fps: fps, protocol: protocol, status: st, assessment: assess, lowLight: dark,
            modules: (KIND_EVENTS[z.kind] || []).map(function (p) { return p[0]; }),
            ip: '10.' + (20 + self.sites.indexOf(s)) + '.' + (10 + zi) + '.' + (20 + c),
            scene: z.kind
          };
          self.cameras.push(cam); self.camById[id] = cam;
        }
      });
      // ANPR lane cameras (one per gate lane)
      s.gates.forEach(function (g, gi) {
        (self.demo ? ['IN', 'OUT'] : []).forEach(function (lane) {
          var id = s.code + '-ANPR-' + g[0] + lane;
          var cam = { id: id, siteId: s.id, zoneId: 'GTE', name: g[1] + ' · ' + (lane === 'IN' ? 'دخول' : 'خروج'), nameEn: 'ANPR ' + g[0] + ' ' + lane, kind: 'anpr', res: '4MP', fps: 25, protocol: 'RTSP / ONVIF', status: 'online', assessment: gi === 1 && s.type === 'plant' && lane === 'OUT' ? 'UPGRADE' : 'USE', lowLight: false, modules: ['ANPR'], ip: '10.' + (20 + self.sites.indexOf(s)) + '.99.' + (10 + gi * 2 + (lane === 'IN' ? 0 : 1)), scene: 'gate', lane: lane, gateId: s.id + '-' + g[0] };
          self.cameras.push(cam); self.camById[id] = cam;
        });
        self.gates.push({ id: s.id + '-' + g[0], siteId: s.id, code: g[0], name: g[1], lanes: 2, barrier: 'closed', controller: gi === 0 ? 'Relay / Dry-contact' : 'API (يُحدد أثناء التقييم)', lastPlate: null });
      });
    });

    // Employees are real records only (added from the UI) — no generated workforce
    this.presenterId = null;
    this.faces = {};      // workerId → [128-D face descriptors]
    this.att = {};        // 'workerId|YYYY-MM-DD' → attendance record
    this.attSettings = JSON.parse(JSON.stringify(ATT_DEFAULTS));

    // live demo camera (browser webcam) — mapped to the PPE checkpoint of Plant 01
    var live = { id: 'P01-CAM-LIVE', siteId: 'PLT-01', zoneId: 'CHK', name: 'كاميرا العرض المباشر · نقطة فحص الوقاية', nameEn: 'Live demo camera · PPE checkpoint', kind: 'webcam', res: 'حسب الجهاز', fps: 30, protocol: 'WebRTC (getUserMedia)', status: 'standby', assessment: 'USE', lowLight: false, modules: ['NO_HELMET', 'NO_GLASSES', 'NO_VEST', 'NO_GLOVES', 'NO_EARMUFFS'], ip: 'local', scene: 'checkpoint', live: true };
    this.cameras.unshift(live); this.camById[live.id] = live;
    var liveAnpr = { id: 'P01-ANPR-LIVE', siteId: 'PLT-01', zoneId: 'GTE', name: 'قارئ اللوحات المباشر · البوابة الرئيسية', nameEn: 'Live ANPR · main gate', kind: 'webcam', res: 'حسب الجهاز', fps: 30, protocol: 'WebRTC / ملف فيديو', status: 'standby', assessment: 'USE', lowLight: false, modules: ['ANPR'], ip: 'local', scene: 'gate', live: true, gateId: 'PLT-01-G1' };
    this.cameras.unshift(liveAnpr); this.camById[liveAnpr.id] = liveAnpr;

    if (!this.demo) { this.buildEmpty(); this.buildHealth(); return; }
    this.buildVehicles();
    this.buildHistory();
    this.buildGateHistory();
    this.buildHealth();
    this.buildAudit();
    this.buildReports();
  };
  Engine.prototype.buildEmpty = function () {
    var self = this;
    this.vehicles = []; this.vehByNorm = {};
    this.events = []; this.eventById = {};
    this.obs = {}; this.gateLog = []; this.onSite = {};
    this.sites.forEach(function (s) { self.obs[s.id] = []; self.onSite[s.id] = {}; });
    this.audit = []; this.reports = [];
  };

  /* ---------------- vehicles registry ---------------- */
  Engine.prototype.egPlate = function (r) {
    var nL = r.chance(0.8) ? 3 : 2, L = [];
    for (var i = 0; i < nL; i++) L.push(r.pick(EG_LETTERS));
    var digits = String(r.chance(0.7) ? r.int(1000, 9999) : r.int(100, 999));
    return { text: formatEgPlate(L, digits), letters: L, digits: digits, country: 'EG' };
  };
  Engine.prototype.saPlate = function (r) {
    var L = [r.pick(SA_LETTERS), r.pick(SA_LETTERS), r.pick(SA_LETTERS)];
    var digits = String(r.int(1000, 9999));
    return { text: L.map(function (x) { return x[0]; }).join(' ') + '  ' + toArabicDigits(digits), latin: L.map(function (x) { return x[1]; }).join(' ') + ' ' + digits, letters: L.map(function (x) { return x[0]; }), digits: digits, country: 'SA' };
  };
  Engine.prototype.buildVehicles = function () {
    var r = new Rng(this.seed + 77), self = this;
    this.vehicles = []; this.vehByNorm = {};
    var cats = [
      ['fleet', 'أسطول EGIC — نقل منتجات', 'شاحنة نقل ثقيل', 34, 'authorized'],
      ['fleet', 'أسطول EGIC — توزيع', 'نصف نقل', 22, 'authorized'],
      ['supplier', 'مورد مواد خام (بوليمر)', 'مقطورة', 18, 'authorized'],
      ['supplier', 'مورد نحاس وسبائك', 'شاحنة نقل ثقيل', 8, 'authorized'],
      ['supplier', 'مورد مواد تغليف', 'نصف نقل', 10, 'authorized'],
      ['contractor', 'مقاول صيانة', 'فان', 9, 'authorized'],
      ['employee', 'سيارة موظف', 'ملاكي', 46, 'authorized'],
      ['staff-bus', 'نقل العاملين', 'أتوبيس', 12, 'authorized'],
      ['visitor', 'زائر — موعد مسبق', 'ملاكي', 14, 'visitor'],
      ['customer', 'عميل — استلام بضاعة', 'نصف نقل', 12, 'visitor'],
      ['blacklist', 'ممنوع من الدخول — قرار إداري', 'نصف نقل', 3, 'blacklisted'],
      ['blacklist', 'ممنوع من الدخول — مخالفات سابقة', 'ملاكي', 2, 'blacklisted']
    ];
    cats.forEach(function (c) {
      for (var i = 0; i < c[3]; i++) {
        var ksa = r.chance(c[0] === 'fleet' || c[0] === 'supplier' ? 0.1 : 0.06);
        var p = ksa ? self.saPlate(r) : self.egPlate(r);
        var v = {
          id: 'VEH-' + pad(self.vehicles.length + 1, 4), plate: p.text, plateLatin: p.latin || null, country: p.country,
          category: c[0], owner: c[1], type: c[2], status: c[4],
          sites: ksa ? ['KSA-01'] : c[0] === 'employee' ? [r.pick(self.sites.filter(function (s) { return s.country === 'EG'; })).id] : self.sites.filter(function (s) { return s.country === 'EG'; }).map(function (s) { return s.id; }),
          validUntil: c[4] === 'visitor' ? self.now + r.int(1, 10) * DAY : c[4] === 'blacklisted' ? null : self.now + r.int(60, 365) * DAY,
          note: c[4] === 'blacklisted' ? 'تنبيه أمني عند الظهور' : '', demo: true
        };
        self.vehicles.push(v); self.vehByNorm[normalizePlate(v.plate)] = v;
      }
    });
  };
  Engine.prototype.findVehicle = function (plateText) { return this.vehByNorm[normalizePlate(plateText)] || null; };

  /* ---------------- 30-day safety history ---------------- */
  Engine.prototype.hourActivity = function (h) {
    // relative presence of people by local hour (3 shifts, shift-change peaks)
    var base = h >= 6 && h < 22 ? 1 : 0.55;
    if (h === 6 || h === 14 || h === 22) base *= 1.35;
    if (h === 12 || h === 13) base *= 0.85;
    return base;
  };
  Engine.prototype.buildHistory = function () {
    var r = new Rng(this.seed + 101), self = this;
    this.events = []; this.eventById = {};
    this.obs = {}; // obs[siteId] = array of hourly buckets {t, n, ok:{item:count}, all}
    var start = localDayStart(this.now, 'Africa/Cairo') - (this.days - 1) * DAY;
    var endHour = Math.floor(this.now / HOUR) * HOUR;
    this.sites.forEach(function (s) {
      var buckets = []; self.obs[s.id] = buckets;
      var zs = PROFILES[s.profile];
      var siteCams = self.cameras.filter(function (c) { return c.siteId === s.id && c.kind !== 'anpr' && !c.live; });
      var siteWorkers = self.workers.filter(function (w) { return w.siteId === s.id && !w.presenter; });
      for (var t = start; t <= endHour; t += HOUR) {
        var lp = localParts(t, s.tz);
        var dayIdx = Math.floor((t - start) / DAY);
        var improve = (dayIdx / self.days) * 0.018; // gentle improvement across the window
        var act = self.hourActivity(lp.h);
        var weekend = s.country === 'EG' ? lp.dow === 5 : lp.dow === 5 || lp.dow === 6;
        if (weekend) act *= 0.45;
        var n = Math.round(s.workers * act * r.range(2.4, 3.4)); // person-track observations
        var night = lp.h >= 22 || lp.h < 6;
        var ok = {}, all = 1;
        PPE_ORDER.forEach(function (it) {
          var p = PPE[it].base + improve - (s.risk - 1) * 0.06 - (night ? 0.022 : 0) + r.normal(0, 0.006);
          p = clamp(p, 0.78, 0.995);
          ok[it] = Math.round(n * p);
          all *= p;
        });
        var okAll = Math.round(n * clamp(all + 0.12, 0.6, 0.99)); // items are correlated → joint compliance higher than product
        buckets.push({ t: t, n: n, ok: ok, all: okAll });
        // violation events from non-compliant tracks + non-PPE behaviours
        var lambda = (n - okAll) * 0.012 * s.risk + (siteCams.length * 0.004 * act);
        var cnt = r.poisson(lambda);
        for (var e = 0; e < cnt; e++) {
          var ts = t + Math.floor(r.next() * HOUR);
          if (ts > self.now) continue;
          var z = r.weighted(zs.map(function (z) { return [z, z.w]; }));
          var kindEv = KIND_EVENTS[z.kind];
          var type = r.weighted(kindEv);
          if (type === 'INTRUSION' && !night) type = 'LINE_CROSSING';
          if (z.kind === 'perimeter' && !night && r.chance(0.7)) continue;
          var camsZ = siteCams.filter(function (c) { return c.zoneId === z.id; });
          var cam = camsZ.length ? r.pick(camsZ) : r.pick(siteCams);
          self.addHistoricalEvent(r, s, z, cam, type, ts, siteWorkers, lp.h);
        }
      }
    });
    this.events.sort(function (a, b) { return b.ts - a.ts; });
    // repeat-offender stats + worker observations
    this.events.forEach(function (ev) {
      if (!ev.workerId) return;
      var w = self.workerById[ev.workerId]; if (!w) return;
      w.violations++; if (ev.ts > w.lastSeen) w.lastSeen = ev.ts;
    });
    this.workers.forEach(function (w) {
      if (w.presenter) return;
      w.obs = Math.round(r.range(180, 900));
      w.obsOk = Math.max(0, w.obs - Math.round(w.violations * r.range(1.6, 3.2)));
      if (!w.lastSeen) w.lastSeen = self.now - r.int(1, 72) * HOUR;
    });
  };

  Engine.prototype.pickWorker = function (r, siteWorkers, zone, hour) {
    if (!siteWorkers.length) return null;
    var shift = shiftOf(hour);
    var depts = ZONE_DEPT[zone.kind];
    var pool = siteWorkers.filter(function (w) { return w.shift === shift && (!depts || depts.indexOf(w.dept) >= 0); });
    if (pool.length < 3) pool = siteWorkers.filter(function (w) { return w.shift === shift; });
    if (!pool.length) pool = siteWorkers;
    // weight by propensity → repeat offenders emerge naturally
    return r.weighted(pool.slice(0, 400).map(function (w) { return [w, w.propensity]; }));
  };

  Engine.prototype.severityFor = function (type, zone, r) {
    var sev = TYPES[type].sev;
    if (zone && zone.restricted && (sev === 'MEDIUM')) sev = 'HIGH';
    if (zone && zone.restricted && type === 'NO_HELMET' && r && r.chance(0.3)) sev = 'CRITICAL';
    if (type === 'PERSON_VEHICLE' && r && r.chance(0.3)) sev = 'CRITICAL';
    return sev;
  };

  Engine.prototype.nextEventId = function (ts) {
    this.seq.evt++;
    var lp = localParts(ts, 'Africa/Cairo');
    return 'EVT-' + pad(lp.mo + 1, 2) + pad(lp.d, 2) + '-' + pad(this.seq.evt, 6);
  };

  Engine.prototype.addHistoricalEvent = function (r, s, z, cam, type, ts, siteWorkers, hour) {
    var t = TYPES[type];
    var identified = t.group !== 'ZONE' || type === 'RESTRICTED_ZONE';
    // simulated events must never name a person: the worker list holds real employees
    var w = null;
    // simulated events are not tied to people; the department still comes from the zone (keeps BBS by department)
    var zd = (ZONE_DEPT[z.kind] || []).filter(function (d) { return DEPTS[s.profile].indexOf(d) >= 0; });
    var dept = w ? w.dept : identified && type !== 'INTRUSION' ? r.pick(zd.length ? zd : DEPTS[s.profile]) : null;
    var sev = this.severityFor(type, z, r);
    var age = this.now - ts;
    // status lifecycle
    var respondSec = Math.round(clamp(r.normal(sev === 'CRITICAL' ? 70 : sev === 'HIGH' ? 150 : 320, sev === 'CRITICAL' ? 30 : 120), 15, 1800));
    var resolveMin = Math.round(clamp(r.normal(sev === 'CRITICAL' ? 18 : 42, 25), 3, 600));
    var status = 'RESOLVED', ackTs = ts + respondSec * 1000, resTs = ts + resolveMin * MIN;
    var fp = r.chance(0.035);
    if (fp) status = 'FALSE_POSITIVE';
    if (age < respondSec * 1000) { status = 'OPEN'; ackTs = null; resTs = null; }
    else if (age < resolveMin * MIN || (age < 26 * HOUR && r.chance(sev === 'LOW' ? 0.14 : 0.05))) { status = r.chance(0.5) ? 'ACK' : 'ASSIGNED'; resTs = null; }
    var id = this.nextEventId(ts);
    var ev = {
      id: id, ts: ts, siteId: s.id, zoneId: z.id, cameraId: cam ? cam.id : null, type: type, group: t.group, sev: sev,
      conf: round(clamp(r.normal(0.88, 0.06), 0.62, 0.99), 2), status: status,
      workerId: w ? w.id : null, dept: dept, shift: shiftOf(hour),
      assignee: status === 'OPEN' ? null : ('مشرف السلامة — الوردية ' + ({ A: 'أ', B: 'ب', C: 'ج' })[shiftOf(hour)]),
      ackTs: ackTs, resTs: resTs, durationSec: t.group === 'PPE' ? Math.round(clamp(r.normal(95, 60), 12, 900)) : Math.round(clamp(r.normal(25, 15), 3, 180)),
      evidence: { kind: 'sim', frames: 3, clipSec: 10, seed: hashStr(id) },
      source: 'sim', note: fp ? 'تم التحقق: إنذار غير صحيح (انعكاس/زاوية)' : ''
    };
    this.events.push(ev); this.eventById[id] = ev;
    return ev;
  };

  /* ---------------- gate / ANPR history ---------------- */
  Engine.prototype.buildGateHistory = function () {
    var r = new Rng(this.seed + 211), self = this;
    this.gateLog = []; this.onSite = {}; // onSite[siteId] = { norm: {plate, ts, vehicleId} }
    var start = this.now - this.gateDays * DAY;
    this.sites.forEach(function (s) {
      self.onSite[s.id] = {};
      var gates = self.gates.filter(function (g) { return g.siteId === s.id; });
      var pool = self.vehicles.filter(function (v) { return v.sites.indexOf(s.id) >= 0; });
      var perDay = s.type === 'warehouse' ? r.int(55, 80) : s.type === 'ksa' ? r.int(35, 50) : r.int(45, 70);
      for (var d = 0; d < self.gateDays; d++) {
        var day0 = localDayStart(start + d * DAY, s.tz);
        var lp0 = localParts(day0 + 12 * HOUR, s.tz);
        var weekend = s.country === 'EG' ? lp0.dow === 5 : lp0.dow === 5 || lp0.dow === 6;
        var visits = Math.round(perDay * (weekend ? 0.35 : 1) * r.range(0.85, 1.15));
        for (var i = 0; i < visits; i++) {
          var hour = r.weighted([[6, 3], [7, 5], [8, 7], [9, 8], [10, 8], [11, 7], [12, 6], [13, 6], [14, 5], [15, 5], [16, 4], [17, 3], [18, 2], [19, 2], [20, 1], [21, 1], [23, 0.5], [2, 0.3]]);
          var tin = day0 + hour * HOUR + r.int(0, 59) * MIN + r.int(0, 59) * 1000;
          if (tin > self.now) continue;
          var unknownVeh = r.chance(0.07);
          var v = unknownVeh ? null : r.pick(pool);
          var plate = v ? v.plate : (s.country === 'SA' ? self.saPlate(r).text : self.egPlate(r).text);
          var dwellMin = v && v.category === 'employee' ? r.int(420, 560) : v && v.category === 'staff-bus' ? r.int(10, 30) : r.int(25, 210);
          var decision = v ? (v.status === 'blacklisted' ? 'BLACKLISTED' : v.status === 'visitor' ? 'VISITOR' : 'AUTHORIZED') : (r.chance(0.35) ? 'UNKNOWN' : 'UNAUTHORIZED');
          var g = r.pick(gates);
          var inRec = self.gateRecord(s, g, 'IN', tin, plate, v, decision, r.range(0.86, 0.99));
          self.gateLog.push(inRec);
          if (decision === 'BLACKLISTED' || decision === 'UNAUTHORIZED') continue; // denied: never enters
          var tout = tin + dwellMin * MIN;
          if (tout <= self.now) {
            var outRec = self.gateRecord(s, g, 'OUT', tout, plate, v, decision, r.range(0.86, 0.99));
            outRec.dwellMin = dwellMin; self.gateLog.push(outRec);
          } else {
            self.onSite[s.id][normalizePlate(plate)] = { plate: plate, ts: tin, vehicleId: v ? v.id : null, decision: decision, gateId: g.id };
          }
        }
      }
    });
    this.gateLog.sort(function (a, b) { return b.ts - a.ts; });
  };
  Engine.prototype.gateRecord = function (s, g, lane, ts, plate, v, decision, conf) {
    this.seq.gate++;
    return {
      id: 'GT-' + pad(this.seq.gate, 6), ts: ts, siteId: s.id, gateId: g.id, gateName: g.name, lane: lane, plate: plate,
      vehicleId: v ? v.id : null, vehicleType: v ? v.type : 'غير مسجلة', category: v ? v.category : 'unknown', owner: v ? v.owner : '—',
      decision: decision, conf: round(conf, 2), dwellMin: null, source: 'sim', country: v ? v.country : (s.country === 'SA' ? 'SA' : 'EG'),
      action: decision === 'AUTHORIZED' ? 'فتح الحاجز تلقائيًا' : decision === 'VISITOR' ? 'تأكيد الأمن + تصريح مؤقت' : decision === 'UNKNOWN' ? 'تحقق يدوي من فرد الأمن' : decision === 'BLACKLISTED' ? 'الحاجز مغلق + تصعيد أمني' : 'الحاجز مغلق + تنبيه الأمن'
    };
  };

  /* ---------------- system health ---------------- */
  Engine.prototype.buildHealth = function () {
    var r = new Rng(this.seed + 313), self = this;
    this.nodes = [{ id: 'CORE-01', role: 'central', name: 'المنصة المركزية', siteId: null, cpu: 38, gpu: 0, ram: 52, disk: 41, temp: 49, streams: 0, fps: 0, latency: 34, uptimeH: 1442, services: ['API Gateway', 'Auth / RBAC', 'Event Service', 'Rule Engine', 'Notification Service', 'BBS Analytics', 'Reporting', 'Audit Log', 'Database', 'Evidence Store'] }];
    this.sites.forEach(function (s) {
      var cams = self.cameras.filter(function (c) { return c.siteId === s.id && !c.live; }).length;
      self.nodes.push({ id: 'EDGE-' + s.code, role: 'edge', name: 'عقدة المعالجة الطرفية — ' + s.name, siteId: s.id, cpu: r.int(35, 62), gpu: r.int(48, 78), ram: r.int(44, 70), disk: r.int(30, 72), temp: r.int(52, 71), streams: cams, fps: 0, latency: r.int(38, 95), uptimeH: r.int(120, 1400), services: ['Stream Ingest', 'Camera Health', 'AI Inference', 'Tracker', 'Zone Rules', 'Evidence Buffer', 'ANPR'] });
    });
  };
  Engine.prototype.tickHealth = function () {
    var r = this.live, self = this;
    this.nodes.forEach(function (n) {
      n.cpu = clamp(Math.round(n.cpu + r.normal(0, 3)), 18, 92);
      n.ram = clamp(Math.round(n.ram + r.normal(0, 1.2)), 30, 88);
      if (n.role === 'edge') {
        n.gpu = clamp(Math.round(n.gpu + r.normal(0, 4)), 30, 96);
        n.temp = clamp(Math.round(n.temp + r.normal(0, 1)), 45, 82);
        var online = self.cameras.filter(function (c) { return c.siteId === n.siteId && c.status === 'online' && !c.live; }).length;
        n.fps = Math.round(online * 5 * (0.97 + r.next() * 0.05)); // AI analyses 5 fps per stream
        n.latency = clamp(Math.round(n.latency + r.normal(0, 6)), 28, 180);
      } else {
        n.latency = clamp(Math.round(n.latency + r.normal(0, 3)), 18, 90);
      }
    });
    // occasional camera state flips (realistic health noise)
    if (r.chance(0.08)) {
      var c = r.pick(this.cameras);
      if (!c.live && c.kind !== 'anpr') {
        var before = c.status;
        c.status = c.status === 'online' ? (r.chance(0.7) ? 'degraded' : 'offline') : 'online';
        if (before !== c.status) this.emit('camera', { id: c.id, siteId: c.siteId, status: c.status, name: c.name });
      }
    }
    this.emit('health', this.healthSnapshot());
  };
  Engine.prototype.healthSnapshot = function () {
    var cams = this.cameras.filter(function (c) { return !c.live || c.ipcam; });
    var on = cams.filter(function (c) { return c.status === 'online' || (c.ipcam && c.status !== 'offline'); }).length;
    var deg = cams.filter(function (c) { return c.status === 'degraded'; }).length;
    return {
      nodes: this.nodes, cameras: { total: cams.length, online: on, degraded: deg, offline: cams.length - on - deg },
      engine: 'ONLINE', mode: this.mode, version: VERSION, uptimeSec: Math.round((Date.now() - this.startedAt) / 1000)
    };
  };

  /* ---------------- audit + reports ---------------- */
  Engine.prototype.buildAudit = function () {
    var r = new Rng(this.seed + 419), self = this;
    this.audit = [];
    var actors = [['مدير السلامة (HSE Admin)', '10.10.4.21'], ['مشرف السلامة — الوردية أ', '10.10.4.37'], ['مشرف أمن البوابات', '10.10.6.12'], ['مسؤول IT', '10.10.1.5'], ['مدير المصنع 03', '10.22.1.14'], ['مراجع داخلي (قراءة فقط)', '10.10.4.88']];
    var acts = [['تسجيل دخول', 'SSO / AD'], ['تحديث قاعدة منطقة', 'منطقة الأفران والصب — المصنع 03'], ['إغلاق حدث', 'EVT'], ['تصدير تقرير', 'تقرير الامتثال اليومي'], ['تعديل صلاحيات', 'دور: مشرف أمن'], ['إضافة مركبة للقائمة', 'سجل المركبات'], ['تغيير عتبة الثقة', 'NO_HELMET → 0.55'], ['مراجعة دليل', 'مقطع فيديو — 10 ث'], ['تعطيل كاميرا مؤقتًا', 'صيانة مجدولة']];
    for (var i = 0; i < 160; i++) {
      var a = r.pick(actors), ac = r.pick(acts);
      this.seq.audit++;
      this.audit.push({ id: 'AUD-' + pad(this.seq.audit, 5), ts: this.now - r.int(1, 14 * 24 * 60) * MIN, actor: a[0], ip: a[1], action: ac[0], target: ac[1] === 'EVT' ? r.pick(this.events).id : ac[1], result: r.chance(0.97) ? 'SUCCESS' : 'DENIED' });
    }
    this.audit.sort(function (a, b) { return b.ts - a.ts; });
  };
  Engine.prototype.buildReports = function () {
    this.reports = [];
    for (var d = 1; d <= 14; d++) {
      var ts = localDayStart(this.now, 'Africa/Cairo') - (d - 1) * DAY + 5 * MIN;
      var lp = localParts(ts - DAY, 'Africa/Cairo');
      var ds = lp.y + '-' + pad(lp.mo + 1, 2) + '-' + pad(lp.d, 2);
      this.seq.rep++;
      this.reports.push({ id: 'REP-' + pad(this.seq.rep, 4), ts: ts, name: 'EGIC-Safety-Daily_' + ds + '_ALL-SITES.pdf', kind: 'daily', scope: 'كل المواقع', format: 'PDF', sizeKb: 180 + (d * 37 % 90), auto: true });
      if (d % 7 === 1) { this.seq.rep++; this.reports.push({ id: 'REP-' + pad(this.seq.rep, 4), ts: ts + 2 * MIN, name: 'EGIC-BBS-Weekly_' + ds + '.xlsx', kind: 'weekly', scope: 'كل المواقع', format: 'Excel', sizeKb: 420, auto: true }); }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Queries                                                              */
  /* ------------------------------------------------------------------ */
  function inSite(siteId) { return function (x) { return !siteId || siteId === 'ALL' || x.siteId === siteId; }; }
  var ACTIVE = { OPEN: 1, ACK: 1, ASSIGNED: 1 };

  Engine.prototype.complianceBetween = function (siteId, t0, t1) {
    var n = 0, all = 0, ok = {}; PPE_ORDER.forEach(function (k) { ok[k] = 0; });
    var self = this;
    this.sites.forEach(function (s) {
      if (siteId && siteId !== 'ALL' && s.id !== siteId) return;
      var b = self.obs[s.id];
      for (var i = b.length - 1; i >= 0; i--) {
        if (b[i].t < t0) break;
        if (b[i].t >= t1) continue;
        n += b[i].n; all += b[i].all;
        PPE_ORDER.forEach(function (k) { ok[k] += b[i].ok[k]; });
      }
    });
    var res = { n: n, index: n ? round(100 * all / n, 1) : null, items: {} };
    PPE_ORDER.forEach(function (k) { res.items[k] = n ? round(100 * ok[k] / n, 1) : null; });
    return res;
  };

  Engine.prototype.summary = function (siteId) {
    var now = Date.now(), self = this;
    var day0 = localDayStart(now, 'Africa/Cairo');
    var f = inSite(siteId);
    var ev24 = [], evToday = [], active = 0, critical24 = 0, intrusionsToday = 0, exposureSec = 0, resolved7 = 0, total7 = 0, respSum = 0, respN = 0;
    for (var i = 0; i < this.events.length; i++) {
      var e = this.events[i];
      if (!f(e)) continue;
      var age = now - e.ts;
      if (ACTIVE[e.status]) active++;
      if (age <= DAY) { ev24.push(e); if (e.sev === 'CRITICAL') critical24++; }
      if (e.ts >= day0) { evToday.push(e); if (e.type === 'INTRUSION' || e.type === 'RESTRICTED_ZONE') intrusionsToday++; if (e.group === 'PPE') exposureSec += e.durationSec; }
      if (age <= 7 * DAY) { total7++; if (e.status === 'RESOLVED' || e.status === 'FALSE_POSITIVE') resolved7++; if (e.ackTs) { respSum += (e.ackTs - e.ts) / 1000; respN++; } }
      if (age > 31 * DAY) break;
    }
    var comp = this.complianceBetween(siteId, now - DAY, now + HOUR);
    var compPrev = this.complianceBetween(siteId, now - 8 * DAY, now - 7 * DAY);
    var cams = this.cameras.filter(function (c) { return f(c) && (!c.live || c.ipcam); });
    var camsOn = cams.filter(function (c) { return c.status === 'online' || (c.ipcam && c.status !== 'offline'); }).length;
    var lpNow = localParts(now, 'Africa/Cairo');
    var shift = shiftOf(lpNow.h);
    var onShift = 0;
    // demo: estimated head-count · factory: employees the face cameras saw arrive and not leave
    if (this.demo) this.sites.forEach(function (s) { if (!siteId || siteId === 'ALL' || s.id === siteId) onShift += Math.round(s.workers * (shift === 'C' ? 0.18 : 0.4) * self.hourActivity(lpNow.h)); });
    else onShift = this.attendanceDay({ site: siteId }).totals.inNow;
    var pendingReview = 0, confirmedToday = 0;
    for (var j = 0; j < this.events.length; j++) {
      var ev = this.events[j]; if (!f(ev)) continue;
      if (ev.review === 'PENDING') pendingReview++;
      else if (ev.review === 'CONFIRMED' && ev.reviewTs >= day0) confirmedToday++;
    }
    var vehiclesOn = 0;
    Object.keys(this.onSite).forEach(function (sid) { if (!siteId || siteId === 'ALL' || sid === siteId) vehiclesOn += Object.keys(self.onSite[sid]).length; });
    var authToday = this.gateLog.filter(function (g) { return f(g) && g.ts >= day0 && g.lane === 'IN' && (g.decision === 'AUTHORIZED' || g.decision === 'VISITOR'); }).length;
    var deniedToday = this.gateLog.filter(function (g) { return f(g) && g.ts >= day0 && g.lane === 'IN' && (g.decision === 'BLACKLISTED' || g.decision === 'UNAUTHORIZED'); }).length;
    var resolutionRate = total7 ? round(100 * resolved7 / total7, 1) : null;
    var meanResp = respN ? Math.round(respSum / respN) : null;
    // BBS score (transparent, configurable formula — illustrative weights)
    var atRiskRate = comp.n ? (ev24.length / (comp.n / 1000)) : 0; // at-risk events per 1,000 observations
    var bbs = comp.index == null ? null : round(0.4 * comp.index + 0.3 * clamp(100 - atRiskRate * 6, 0, 100) + 0.2 * (resolutionRate || 0) + 0.1 * clamp(100 - (meanResp || 0) / 6, 0, 100), 1);
    return {
      siteId: siteId || 'ALL', ts: now, shift: shift,
      compliance: comp.index, complianceItems: comp.items, compliancePrev: compPrev.index, target: 95,
      onSite: onShift, activeViolations: active, critical24: critical24, events24: ev24.length, eventsToday: evToday.length,
      exposureMin: round(exposureSec / 60, 1), intrusionsToday: intrusionsToday,
      cameras: { total: cams.length, online: camsOn }, vehiclesOnSite: vehiclesOn, authorizedToday: authToday, deniedToday: deniedToday,
      resolutionRate: resolutionRate, meanResponseSec: meanResp, atRiskPer1k: round(atRiskRate, 2), bbsScore: bbs,
      pendingReview: pendingReview, confirmedToday: confirmedToday,
      sites: this.sites.length, demo: this.demo
    };
  };

  Engine.prototype.trend = function (siteId, range) {
    var now = Date.now(), self = this, step, span;
    if (range === '7d') { step = 6 * HOUR; span = 7 * DAY; }
    else if (range === '30d') { step = DAY; span = 30 * DAY; }
    else { step = HOUR; span = 24 * HOUR; }
    var t0 = Math.floor((now - span) / step) * step + step;
    var pts = [];
    for (var t = t0; t <= now; t += step) {
      var c = this.complianceBetween(siteId, t, t + step);
      var evs = 0;
      pts.push({ t: t, index: c.index, items: c.items, n: c.n, events: evs });
    }
    // event counts per bucket
    var f = inSite(siteId);
    for (var i = 0; i < this.events.length; i++) {
      var e = this.events[i]; if (e.ts < t0) break; if (!f(e)) continue;
      var k = Math.floor((e.ts - t0) / step); if (pts[k]) pts[k].events++;
    }
    return { range: range || '24h', step: step, points: pts };
  };

  Engine.prototype.heatmap = function (siteId, days) {
    days = days || 7;
    var now = Date.now(), f = inSite(siteId), grid = [];
    for (var d = 0; d < 7; d++) { grid.push([]); for (var h = 0; h < 24; h++) grid[d].push(0); }
    var dayLabels = [];
    for (var i = 0; i < this.events.length; i++) {
      var e = this.events[i]; if (now - e.ts > days * DAY) break; if (!f(e)) continue;
      var lp = localParts(e.ts, 'Africa/Cairo');
      grid[lp.dow][lp.h]++;
    }
    return { rows: grid, dow: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] };
  };

  Engine.prototype.zoneStats = function (siteId) {
    var now = Date.now(), f = inSite(siteId), self = this, map = {};
    for (var i = 0; i < this.events.length; i++) {
      var e = this.events[i]; if (now - e.ts > 7 * DAY) break; if (!f(e)) continue;
      var z = this.zone(e.siteId, e.zoneId); if (!z) continue;
      var key = siteId && siteId !== 'ALL' ? z.id : z.kind;
      if (!map[key]) map[key] = { key: key, name: siteId && siteId !== 'ALL' ? z.name : z.name.split(' — ')[0], kind: z.kind, events: 0, critical: 0, ppe: 0 };
      map[key].events++; if (e.sev === 'CRITICAL') map[key].critical++; if (e.group === 'PPE') map[key].ppe++;
    }
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    var comp = this.complianceBetween(siteId, now - 7 * DAY, now + HOUR).index || 95;
    var maxE = arr.reduce(function (a, z) { return Math.max(a, z.events); }, 1);
    // demo: an illustrative per-zone figure · factory: no invented percentages — only what was measured
    arr.forEach(function (z) { z.compliance = self.demo ? round(clamp(comp + 4 - 9 * (z.ppe / maxE), 70, 99.5), 1) : null; z.risk = z.critical * 3 + z.events; });
    arr.sort(function (a, b) { return b.risk - a.risk; });
    return arr;
  };

  Engine.prototype.siteStats = function () {
    var self = this, now = Date.now();
    return this.sites.map(function (s) {
      var sum = self.summary(s.id);
      var ev7 = 0; for (var i = 0; i < self.events.length; i++) { var e = self.events[i]; if (now - e.ts > 7 * DAY) break; if (e.siteId === s.id) ev7++; }
      return { id: s.id, code: s.code, name: s.name, nameEn: s.nameEn, sub: s.sub, type: s.type, country: s.country, cams: sum.cameras.total, camsOnline: sum.cameras.online, compliance: sum.compliance, active: sum.activeViolations, critical24: sum.critical24, events7: ev7, vehiclesOnSite: sum.vehiclesOnSite, bbs: sum.bbsScore, gates: s.gates.length, workers: s.workers };
    });
  };

  Engine.prototype.listEvents = function (q) {
    q = q || {};
    var lim = Math.min(+q.limit || 50, 500), off = +q.offset || 0;
    var term = (q.q || '').trim().toLowerCase();
    var since = q.since ? +q.since : 0;
    var self = this;
    var res = this.events.filter(function (e) {
      if (q.site && q.site !== 'ALL' && e.siteId !== q.site) return false;
      if (q.type && q.type !== 'ALL' && e.type !== q.type) return false;
      if (q.group && q.group !== 'ALL' && e.group !== q.group) return false;
      if (q.sev && q.sev !== 'ALL' && e.sev !== q.sev) return false;
      if (q.status && q.status !== 'ALL') { if (q.status === 'ACTIVE') { if (!ACTIVE[e.status]) return false; } else if (e.status !== q.status) return false; }
      if (q.review && q.review !== 'ALL' && e.review !== q.review) return false;
      if (q.source && q.source !== 'ALL') { if (q.source === 'live' ? e.source.indexOf('live') !== 0 : e.source !== q.source) return false; }
      if (q.worker && e.workerId !== q.worker) return false;
      if (q.camera && e.cameraId !== q.camera) return false;
      if (since && e.ts < since) return false;
      if (term) {
        var w = e.workerId ? self.workerById[e.workerId] : null;
        var hay = (e.id + ' ' + (e.workerId || '') + ' ' + (w ? w.name : '') + ' ' + (e.cameraId || '') + ' ' + TYPES[e.type].ar + ' ' + TYPES[e.type].en).toLowerCase();
        if (hay.indexOf(term) < 0) return false;
      }
      return true;
    });
    return { total: res.length, offset: off, limit: lim, items: res.slice(off, off + lim).map(this.decorate, this) };
  };

  Engine.prototype.decorate = function (e) {
    var s = this.site(e.siteId), z = this.zone(e.siteId, e.zoneId), w = e.workerId ? this.workerById[e.workerId] : null, c = e.cameraId ? this.camById[e.cameraId] : null;
    var o = {}; for (var k in e) o[k] = e[k];
    o.typeAr = TYPES[e.type].ar; o.typeEn = TYPES[e.type].en; o.sevAr = SEV_AR[e.sev];
    o.siteName = s ? s.name : ''; o.zoneName = z ? z.name : ''; o.cameraName = c ? c.name : '';
    o.workerName = w ? w.name : null; o.workerRole = w ? w.role : null;
    return o;
  };

  Engine.prototype.workerProfile = function (id) {
    var w = this.workerById[id]; if (!w) return null;
    var evs = this.events.filter(function (e) { return e.workerId === id; }).map(this.decorate, this);
    var byType = {};
    evs.forEach(function (e) { byType[e.type] = (byType[e.type] || 0) + 1; });
    var s = this.site(w.siteId);
    var o = {}; for (var k in w) if (k !== 'propensity') o[k] = w[k];
    o.siteName = s ? s.name : '';
    o.enrolled = !!(this.faces[id] && this.faces[id].length); o.faces = this.faces[id] ? this.faces[id].length : 0;
    o.compliance = w.obs ? round(100 * w.obsOk / w.obs, 1) : null;
    o.events = evs.slice(0, 200); o.byType = byType;
    // only supervisor-confirmed conduct counts as a violation on the worker's record
    o.violations = evs.filter(function (e) { return e.review === 'CONFIRMED'; }).length;
    o.pending = evs.filter(function (e) { return e.review === 'PENDING'; }).length;
    o.rejected = evs.filter(function (e) { return e.review === 'REJECTED'; }).length;
    o.live = evs.filter(function (e) { return e.source.indexOf('live') === 0; }).length;
    return o;
  };

  Engine.prototype.listWorkers = function (q) {
    q = q || {};
    var term = (q.q || '').trim().toLowerCase(), self = this;
    var arr = this.workers.filter(function (w) {
      if (q.site && q.site !== 'ALL' && w.siteId !== q.site) return false;
      if (q.risk === 'repeat' && w.violations < 3 && !w.presenter) return false;
      if (term && (w.id + ' ' + w.name + ' ' + w.dept + ' ' + w.role).toLowerCase().indexOf(term) < 0) return false;
      return true;
    });
    arr.sort(function (a, b) { return (b.presenter ? 1e9 : 0) + b.violations * 1000 + (b.lastSeen / 1e10) - ((a.presenter ? 1e9 : 0) + a.violations * 1000 + (a.lastSeen / 1e10)); });
    var lim = Math.min(+q.limit || 100, 1000);
    var sumObs = 0, sumOk = 0; arr.forEach(function (w) { sumObs += w.obs; sumOk += w.obsOk; });
    return {
      total: arr.length, avgCompliance: sumObs ? round(100 * sumOk / sumObs, 1) : null, repeat: arr.filter(function (w) { return w.violations >= 3; }).length,
      items: arr.slice(0, lim).map(function (w) {
        var s = self.site(w.siteId);
        return { id: w.id, name: w.name, siteId: w.siteId, siteName: s ? s.name : '', dept: w.dept, shift: w.shift, role: w.role, phone: w.phone || '', contractor: w.contractor, violations: w.violations, compliance: w.obs ? round(100 * w.obsOk / w.obs, 1) : null, lastSeen: w.lastSeen, enrolled: !!(self.faces[w.id] && self.faces[w.id].length), faces: self.faces[w.id] ? self.faces[w.id].length : 0, photo: w.photo || null };
      })
    };
  };

  Engine.prototype.bbs = function (siteId, dim) {
    var now = Date.now(), f = inSite(siteId), self = this, map = {};
    dim = dim || 'dept';
    for (var i = 0; i < this.events.length; i++) {
      var e = this.events[i]; if (now - e.ts > 30 * DAY) break; if (!f(e)) continue;
      var key;
      if (dim === 'shift') key = e.shift;
      else if (dim === 'site') key = e.siteId;
      else if (dim === 'zone') { var z = this.zone(e.siteId, e.zoneId); key = z ? z.name.split(' — ')[0] : e.zoneId; }
      else if (dim === 'behavior') key = e.type;
      else { if (!e.dept) continue; key = e.dept; }
      if (!map[key]) map[key] = { key: key, events: 0, critical: 0, resolved: 0 };
      map[key].events++; if (e.sev === 'CRITICAL') map[key].critical++; if (e.status === 'RESOLVED') map[key].resolved++;
    }
    var arr = Object.keys(map).map(function (k) {
      var o = map[k];
      o.label = dim === 'shift' ? ('الوردية ' + ({ A: 'أ (06–14)', B: 'ب (14–22)', C: 'ج (22–06)' })[k]) : dim === 'site' ? (self.site(k) || {}).name : dim === 'behavior' ? TYPES[k].ar : k;
      return o;
    });
    arr.sort(function (a, b) { return b.events - a.events; });
    // weekly trend of at-risk events (4 weeks)
    var weeks = [0, 0, 0, 0];
    for (var j = 0; j < this.events.length; j++) { var ev = this.events[j]; var age = now - ev.ts; if (age > 28 * DAY) break; if (!f(ev)) continue; weeks[3 - Math.floor(age / (7 * DAY))]++; }
    var comp = this.complianceBetween(siteId, now - 30 * DAY, now + HOUR);
    return { dim: dim, items: arr, weeks: weeks, safeObs: comp.n ? Math.round(comp.n * (comp.index / 100)) : 0, atRiskObs: comp.n ? Math.round(comp.n * (1 - comp.index / 100)) : 0 };
  };

  Engine.prototype.gateList = function (q) {
    q = q || {};
    var lim = Math.min(+q.limit || 60, 500), f = inSite(q.site);
    var term = (q.q || '').trim();
    var nt = term ? normalizePlate(term) : '';
    var items = this.gateLog.filter(function (g) {
      if (!f(g)) return false;
      if (q.decision && q.decision !== 'ALL' && g.decision !== q.decision) return false;
      if (q.lane && q.lane !== 'ALL' && g.lane !== q.lane) return false;
      if (q.source && q.source !== 'ALL' && (q.source === 'live' ? g.source.indexOf('live') !== 0 : g.source !== q.source)) return false;
      if (term) { var np = normalizePlate(g.plate); if (np.indexOf(nt.replace('|', '')) < 0 && np.replace('|', '').indexOf(nt.replace('|', '')) < 0) return false; }
      return true;
    });
    return { total: items.length, items: items.slice(0, lim) };
  };

  Engine.prototype.gateStats = function (siteId) {
    var now = Date.now(), f = inSite(siteId), hours = [];
    for (var h = 0; h < 24; h++) hours.push({ h: h, in: 0, out: 0 });
    var dec = { AUTHORIZED: 0, VISITOR: 0, UNAUTHORIZED: 0, BLACKLISTED: 0, UNKNOWN: 0 };
    var dwell = [], cats = {};
    for (var i = 0; i < this.gateLog.length; i++) {
      var g = this.gateLog[i]; if (now - g.ts > DAY) break; if (!f(g)) continue;
      var lp = localParts(g.ts, 'Africa/Cairo');
      hours[lp.h][g.lane === 'IN' ? 'in' : 'out']++;
      if (g.lane === 'IN') { dec[g.decision]++; cats[g.vehicleType] = (cats[g.vehicleType] || 0) + 1; }
      if (g.dwellMin) dwell.push(g.dwellMin);
    }
    dwell.sort(function (a, b) { return a - b; });
    var self = this, onSite = [];
    Object.keys(this.onSite).forEach(function (sid) {
      if (siteId && siteId !== 'ALL' && sid !== siteId) return;
      Object.keys(self.onSite[sid]).forEach(function (k) {
        var o = self.onSite[sid][k], v = o.vehicleId ? self.vehicles.filter(function (x) { return x.id === o.vehicleId; })[0] : null;
        onSite.push({ plate: o.plate, siteId: sid, siteName: self.site(sid).name, since: o.ts, dwellMin: Math.round((now - o.ts) / MIN), type: v ? v.type : 'غير مسجلة', owner: v ? v.owner : '—', decision: o.decision, overstay: (now - o.ts) > 6 * HOUR && (!v || v.category !== 'employee') });
      });
    });
    onSite.sort(function (a, b) { return b.dwellMin - a.dwellMin; });
    return { hours: hours, decisions: dec, medianDwell: dwell.length ? dwell[Math.floor(dwell.length / 2)] : null, onSite: onSite, categories: cats };
  };

  /* ------------------------------------------------------------------ */
  /* Mutations                                                            */
  /* ------------------------------------------------------------------ */
  Engine.prototype.addEvent = function (data) {
    var now = Date.now();
    var type = TYPES[data.type] ? data.type : 'NO_HELMET';
    var cam = data.cameraId && this.camById[data.cameraId] ? this.camById[data.cameraId] : this.camById['P01-CAM-LIVE'];
    var z = this.zone(cam.siteId, cam.zoneId);
    var ts = data.ts || now;
    var id = this.nextEventId(ts);
    var lp = localParts(ts, 'Africa/Cairo');
    var w = data.workerId ? this.workerById[data.workerId] : null;
    var ev = {
      id: id, ts: ts, siteId: cam.siteId, zoneId: cam.zoneId, cameraId: cam.id, type: type, group: TYPES[type].group,
      sev: data.sev || this.severityFor(type, z, null), conf: data.conf != null ? round(+data.conf, 2) : 0.9, status: 'OPEN',
      workerId: w ? w.id : null, dept: w ? w.dept : null, shift: shiftOf(lp.h), assignee: null, ackTs: null, resTs: null,
      durationSec: data.durationSec || 0, evidence: data.evidence || { kind: 'none' }, source: data.source || 'live-ai',
      incident: data.incident || null, missing: data.missing || null, note: data.note || '',
      review: isConduct(type) ? 'PENDING' : null, reviewer: null, reviewTs: null, reviewNote: ''
    };
    this.events.unshift(ev); this.eventById[id] = ev;
    // nothing is counted against the worker here — only a supervisor's confirmation does that
    if (w) w.lastSeen = ts;
    this.emit('event', this.decorate(ev));
    this.emit('kpi', this.summary('ALL'));
    return this.decorate(ev);
  };

  Engine.prototype.observe = function (workerId, compliant) {
    var w = this.workerById[workerId]; if (!w) return null;
    w.obs++; if (compliant) w.obsOk++; w.lastSeen = Date.now();
    return { id: w.id, obs: w.obs, obsOk: w.obsOk };
  };

  Engine.prototype.countViolation = function (e, sign) {
    var w = e.workerId ? this.workerById[e.workerId] : null; if (!w) return;
    w.violations = Math.max(0, w.violations + sign); w.obs = Math.max(0, w.obs + sign);
  };

  Engine.prototype.eventAction = function (id, action, body) {
    var e = this.eventById[id]; if (!e) return null;
    var now = Date.now(), before = e.status, beforeReview = e.review;
    body = body || {};
    var actor = String(body.actor || '').trim(), note = String(body.note || '').trim();
    var reviewable = e.review != null;
    if (action === 'confirm' || action === 'set_worker') {
      if (!reviewable) return { error: 'not_reviewable', message: 'الحدث ده تنبيه سلامة، مش مخالفة بتتسجل على عامل.' };
      if (!actor) return { error: 'reviewer_required', message: 'اكتب اسم المشرف اللي بيراجع.' };
    }
    if (action === 'set_worker' || (action === 'confirm' && body.workerId !== undefined)) {
      var nw = body.workerId ? this.workerById[body.workerId] : null;
      if (body.workerId && !nw) return { error: 'worker_not_found', message: 'الموظف ده مش موجود.' };
      if (e.review === 'CONFIRMED') this.countViolation(e, -1);
      e.workerId = nw ? nw.id : null;
      if (nw) e.dept = nw.dept;
      if (e.review === 'CONFIRMED') this.countViolation(e, 1);
    }
    if (action === 'confirm') {
      if (!e.workerId) return { error: 'worker_required', message: 'حدد العامل الأول قبل تأكيد المخالفة.' };
      if (!note) return { error: 'note_required', message: 'اكتب إيه اللي شفته في الدليل وأكّد المخالفة.' };
      if (e.review !== 'CONFIRMED') { e.review = 'CONFIRMED'; this.countViolation(e, 1); }
      e.reviewer = actor; e.reviewTs = now; e.reviewNote = note;
      if (ACTIVE[e.status]) { e.status = 'RESOLVED'; e.ackTs = e.ackTs || now; e.resTs = now; }
    }
    else if (action === 'ack') { e.status = 'ACK'; e.ackTs = e.ackTs || now; }
    else if (action === 'assign') { e.status = 'ASSIGNED'; e.ackTs = e.ackTs || now; e.assignee = body.assignee || 'مشرف السلامة — الوردية ' + ({ A: 'أ', B: 'ب', C: 'ج' })[e.shift || 'A']; }
    else if (action === 'resolve') { e.status = 'RESOLVED'; e.ackTs = e.ackTs || now; e.resTs = now; }
    else if (action === 'false_positive') {
      e.status = 'FALSE_POSITIVE'; e.resTs = now;
      if (reviewable) { if (e.review === 'CONFIRMED') this.countViolation(e, -1); e.review = 'REJECTED'; e.reviewer = actor || null; e.reviewTs = now; e.reviewNote = note; }
    }
    else if (action === 'reopen') {
      e.status = 'OPEN'; e.resTs = null;
      if (reviewable) { if (e.review === 'CONFIRMED') this.countViolation(e, -1); e.review = 'PENDING'; e.reviewer = null; e.reviewTs = null; e.reviewNote = ''; }
    }
    else if (action === 'referee') {
      // the AI referee's second opinion (vision LLM judging by the foundry's gear rules) — a note, never a human review
      var rf = body.referee || {};
      e.referee = { verdict: String(rf.verdict || 'unclear'), reason: String(rf.reason || '').slice(0, 300), model: rf.model || null, subject: !!rf.subject, ts: now };
    }
    if (body.note && action !== 'confirm' && action !== 'false_positive') e.note = body.note;
    var w = e.workerId ? this.workerById[e.workerId] : null;
    var what = action === 'confirm' ? 'تأكيد مخالفة على ' + (w ? w.name : '—')
      : action === 'referee' ? 'الحَكَم الآلي: ' + ({ false_alarm: 'إنذار غلط', real: 'المخالفة باينة', unclear: 'مش متأكد' }[e.referee.verdict] || e.referee.verdict)
      : action === 'set_worker' ? 'تحديد العامل: ' + (w ? w.name : 'بدون')
      : 'تحديث حالة حدث (' + before + ' → ' + e.status + (beforeReview !== e.review ? ' · ' + (REVIEW_AR[e.review] || '') : '') + ')';
    this.logAudit(actor || 'مدير السلامة (HSE Admin)', what, id);
    var d = this.decorate(e);
    this.emit('event_update', d);
    this.emit('kpi', this.summary('ALL'));
    return d;
  };

  Engine.prototype.upsertWorker = function (data) {
    var w = data.id ? this.workerById[data.id] : null;
    if (!w) {
      var id = data.id && /^[A-Za-z0-9_-]{1,32}$/.test(data.id) ? String(data.id) : null, n = 1;
      while (!id || this.workerById[id]) id = 'EMP-' + pad(n++, 4);
      w = { id: id, name: data.name || 'موظف جديد', siteId: data.siteId || 'PLT-01', dept: data.dept || 'غير محدد', shift: data.shift || 'A', role: data.role || 'موظف', phone: '', contractor: false, propensity: 0, enrolled: false, obs: 0, obsOk: 0, violations: 0, lastSeen: 0, joined: data.joined || Date.now(), demo: false };
      this.workers.unshift(w); this.workerById[id] = w;
    }
    ['name', 'siteId', 'dept', 'shift', 'role', 'phone', 'enrolled', 'photo'].forEach(function (k) { if (data[k] !== undefined) w[k] = data[k]; });
    if (!this.attSettings.shifts[w.shift]) w.shift = 'A';
    this.emit('worker', { id: w.id, name: w.name, enrolled: w.enrolled });
    return this.workerProfile(w.id);
  };

  Engine.prototype.removeWorker = function (id) {
    var w = this.workerById[id]; if (!w) return null;
    this.workers = this.workers.filter(function (x) { return x.id !== id; });
    delete this.workerById[id]; delete this.faces[id];
    var att = this.att; Object.keys(att).forEach(function (k) { if (att[k].workerId === id) delete att[k]; });
    this.logAudit('مدير الموارد البشرية', 'حذف موظف', id + ' · ' + w.name);
    this.emit('worker', { id: id, deleted: true });
    this.emit('faces', { workerId: id, count: 0 });
    return { id: id, deleted: true };
  };

  /* ---------------- face templates (128-D descriptors, shared by every screen) ---------------- */
  Engine.prototype.setFaces = function (workerId, descriptors, mode) {
    var w = this.workerById[workerId]; if (!w) return null;
    var clean = (descriptors || []).filter(function (d) { return d && d.length === 128; }).map(function (d) { return Array.prototype.map.call(d, function (x) { return round(+x, 5); }); });
    var list = (mode === 'replace' ? [] : (this.faces[workerId] || [])).concat(clean).slice(-20);
    if (list.length) this.faces[workerId] = list; else delete this.faces[workerId];
    w.enrolled = list.length > 0;
    this.emit('faces', { workerId: workerId, count: list.length });
    return { workerId: workerId, count: list.length, descriptors: list };
  };

  /* ---------------- attendance: first sighting of the shift-day = check-in, last = check-out ---------------- */
  function dayStr(lp) { return lp.y + '-' + pad(lp.mo + 1, 2) + '-' + pad(lp.d, 2); }
  function dayStartOf(day) { var p = String(day).split('-'); return localDayStart(Date.UTC(+p[0], +p[1] - 1, +p[2], 12), 'Africa/Cairo'); }
  Engine.prototype.shiftOfWorker = function (w) { return this.attSettings.shifts[w.shift] ? w.shift : 'A'; };
  // a sighting belongs to the shift-day whose start is the latest one ≤ ts + 3 h (early arrivals and night shifts land on the right day)
  Engine.prototype.attDay = function (ts, shift) {
    var sh = this.attSettings.shifts[shift] || this.attSettings.shifts.A;
    return dayStr(localParts(ts + (180 - hmToMin(sh.start)) * MIN, 'Africa/Cairo'));
  };
  Engine.prototype.shiftWindow = function (day, shift) {
    var sh = this.attSettings.shifts[shift] || this.attSettings.shifts.A, d0 = dayStartOf(day);
    var s = hmToMin(sh.start), e = hmToMin(sh.end);
    return { start: d0 + s * MIN, end: d0 + (e <= s ? e + 1440 : e) * MIN };
  };
  Engine.prototype.isWeekend = function (day) { return this.attSettings.weekend.indexOf(new Date(dayStartOf(day) + 12 * HOUR).getUTCDay()) >= 0; };
  Engine.prototype.attendanceLookup = function (workerId, ts) {
    var w = this.workerById[workerId]; if (!w) return null;
    var day = this.attDay(ts, this.shiftOfWorker(w));
    return { day: day, rec: this.att[workerId + '|' + day] || null };
  };
  Engine.prototype.attendanceSighting = function (data) {
    var w = this.workerById[data.workerId]; if (!w) return null;
    var ts = +data.ts || Date.now(), shift = this.shiftOfWorker(w), day = this.attDay(ts, shift), key = w.id + '|' + day;
    var rec = this.att[key], isNew = !rec;
    if (rec && ts >= rec.firstTs && ts - rec.lastTs < this.attSettings.gapSec * 1000) return { accepted: false, ts: ts, isNew: false, record: this.attDecorate(rec) };
    if (!rec) {
      rec = this.att[key] = { workerId: w.id, day: day, shift: shift, firstTs: ts, lastTs: ts, n: 0, firstCam: data.cameraId || null, lastCam: data.cameraId || null, inImg: data.inImg || data.image || null, outImg: null, outImgTs: 0, conf: data.conf != null ? round(+data.conf, 2) : null };
    }
    if (ts < rec.firstTs) { rec.firstTs = ts; rec.firstCam = data.cameraId || rec.firstCam; }
    if (ts > rec.lastTs) { rec.lastTs = ts; rec.lastCam = data.cameraId || rec.lastCam; }
    rec.n++;
    if (!isNew && (data.outImg || data.image)) { rec.outImg = data.outImg || data.image; rec.outImgTs = ts; }
    if (ts > w.lastSeen) w.lastSeen = ts;
    var d = this.attDecorate(rec);
    if (isNew || ts - (rec.emitTs || 0) > 60e3) { rec.emitTs = ts; this.emit('attendance', { kind: isNew ? 'IN' : 'SEEN', record: d }); }
    return { accepted: true, ts: ts, isNew: isNew, record: d };
  };
  Engine.prototype.attStatus = function (rec, day, shift, now) {
    var A = this.attSettings, win = this.shiftWindow(day, shift);
    var o = { day: day, shift: shift, start: win.start, end: win.end };
    if (!rec) {
      o.status = this.isWeekend(day) ? 'OFF' : now > win.start + A.graceMin * MIN ? 'ABSENT' : 'PENDING';
      return o;
    }
    o.firstTs = rec.firstTs; o.lastTs = rec.lastTs; o.firstCam = rec.firstCam; o.lastCam = rec.lastCam; o.inImg = rec.inImg; o.outImg = rec.outImg; o.sightings = rec.n;
    o.lateMin = Math.max(0, Math.round((rec.firstTs - win.start) / MIN));
    o.late = o.lateMin > A.graceMin;
    o.workedMin = Math.round((rec.lastTs - rec.firstTs) / MIN);
    o.overtimeMin = Math.max(0, Math.round((rec.lastTs - win.end) / MIN));
    var over = now > win.end + 2 * HOUR || now - rec.lastTs > 6 * HOUR; // the shift is over → the last sighting counts as check-out
    o.status = over ? 'OUT' : 'IN';
    o.earlyMin = over ? Math.max(0, Math.round((win.end - rec.lastTs) / MIN)) : 0;
    o.early = over && o.earlyMin > A.earlyMin;
    o.missingOut = over && o.workedMin < 5;
    return o;
  };
  Engine.prototype.attDecorate = function (rec) {
    var w = this.workerById[rec.workerId], o = this.attStatus(rec, rec.day, rec.shift, Date.now());
    o.workerId = rec.workerId; o.workerName = w ? w.name : rec.workerId; o.dept = w ? w.dept : ''; o.photo = w ? w.photo || null : null;
    return o;
  };
  Engine.prototype.attendanceDay = function (q) {
    q = q || {};
    var self = this, now = Date.now(), f = inSite(q.site);
    var day = q.day || dayStr(localParts(now, 'Africa/Cairo'));
    var tot = { employees: 0, present: 0, inNow: 0, late: 0, early: 0, absent: 0, off: 0, pending: 0 };
    var items = this.workers.filter(function (w) { return f(w) && dayStr(localParts(w.joined || 0, 'Africa/Cairo')) <= day; }).map(function (w) {
      var rec = self.att[w.id + '|' + day];
      var o = self.attStatus(rec, day, rec ? rec.shift : self.shiftOfWorker(w), now);
      o.workerId = w.id; o.workerName = w.name; o.dept = w.dept; o.role = w.role; o.photo = w.photo || null; o.siteId = w.siteId;
      tot.employees++;
      if (rec) { tot.present++; if (o.status === 'IN') tot.inNow++; if (o.late) tot.late++; if (o.early) tot.early++; }
      else if (o.status === 'ABSENT') tot.absent++; else if (o.status === 'OFF') tot.off++; else tot.pending++;
      return o;
    });
    var rank = { IN: 0, OUT: 1, PENDING: 2, ABSENT: 3, OFF: 4 };
    items.sort(function (a, b) { return (rank[a.status] - rank[b.status]) || ((a.firstTs || 0) - (b.firstTs || 0)) || String(a.workerName).localeCompare(String(b.workerName)); });
    return { day: day, totals: tot, items: items, settings: this.attSettings };
  };
  // one row per employee per day — used by the monthly profile view and the Excel/CSV export
  Engine.prototype.attendanceRange = function (q) {
    q = q || {};
    var self = this, now = Date.now(), f = inSite(q.site);
    var today = dayStr(localParts(now, 'Africa/Cairo'));
    var to = q.to || today, from = q.from || to, days = [];
    for (var t = dayStartOf(from), end = dayStartOf(to), k = 0; t <= end && k < 92; t += DAY, k++) days.push(dayStr(localParts(t + 12 * HOUR, 'Africa/Cairo')));
    var ws = this.workers.filter(function (w) { return f(w) && (!q.worker || w.id === q.worker); });
    var rows = [];
    ws.forEach(function (w) {
      days.forEach(function (day) {
        if (day > today) return;
        var rec = self.att[w.id + '|' + day];
        if (!rec && day < dayStr(localParts(w.joined || 0, 'Africa/Cairo'))) return; // not employed yet
        var o = self.attStatus(rec, day, rec ? rec.shift : self.shiftOfWorker(w), now);
        o.workerId = w.id; o.workerName = w.name; o.dept = w.dept; o.role = w.role;
        rows.push(o);
      });
    });
    var sum = { days: 0, present: 0, late: 0, early: 0, absent: 0, workedMin: 0, lateMin: 0, overtimeMin: 0 };
    rows.forEach(function (o) {
      if (o.status === 'OFF' || o.status === 'PENDING') return;
      sum.days++;
      if (o.status === 'ABSENT') { sum.absent++; return; }
      sum.present++; sum.workedMin += o.workedMin; sum.overtimeMin += o.overtimeMin;
      if (o.late) { sum.late++; sum.lateMin += o.lateMin; }
      if (o.early) sum.early++;
    });
    return { from: from, to: to, rows: rows, summary: sum };
  };
  Engine.prototype.setAttendanceSettings = function (d) {
    var A = this.attSettings;
    if (d.shifts) Object.keys(A.shifts).forEach(function (k) { var x = d.shifts[k]; if (!x) return; ['name', 'start', 'end'].forEach(function (f) { if (x[f] !== undefined && (f === 'name' || /^\d{1,2}:\d{2}$/.test(x[f]))) A.shifts[k][f] = String(x[f]); }); });
    ['graceMin', 'earlyMin', 'gapSec'].forEach(function (k) { if (d[k] != null && !isNaN(+d[k])) A[k] = clamp(Math.round(+d[k]), 0, 600); });
    if (Array.isArray(d.weekend)) A.weekend = d.weekend.map(Number).filter(function (x) { return x >= 0 && x <= 6; });
    this.emit('attendance', { kind: 'SETTINGS' });
    return A;
  };

  /* ---------------- IP cameras connected through the server (registered so events can reference them) ---------------- */
  Engine.prototype.upsertCamera = function (d) {
    var c = this.camById[d.id];
    if (!c) {
      c = { id: d.id, siteId: 'PLT-01', zoneId: 'CHK', kind: 'ipcam', res: 'حسب الكاميرا', fps: 0, status: 'standby', assessment: 'USE', lowLight: false, modules: ['NO_HELMET', 'NO_GLASSES', 'NO_VEST', 'NO_GLOVES', 'NO_EARMUFFS', 'FIRE_DETECTED', 'SMOKING_DETECTED'], ip: '', scene: 'checkpoint', live: true, ipcam: true };
      this.cameras.unshift(c); this.camById[c.id] = c;
    }
    ['name', 'protocol', 'ip', 'status'].forEach(function (k) { if (d[k] !== undefined) c[k] = d[k]; });
    if (d.siteId && this.site(d.siteId)) c.siteId = d.siteId;
    c.nameEn = c.name;
    return c;
  };
  Engine.prototype.removeCamera = function (id) {
    if (!this.camById[id] || !this.camById[id].ipcam) return;
    this.cameras = this.cameras.filter(function (c) { return c.id !== id; }); delete this.camById[id];
  };

  /* ---------------- persistence: which POSTs are journaled, and how a journal line is replayed ---------------- */
  Engine.prototype.journalEntry = function (path, body, res) {
    var p = path.replace(/\/+$/, ''), m;
    if (p === '/api/v1/events') return ['event', Object.assign({}, body, { ts: res.ts })];
    if ((m = /^\/api\/v1\/events\/([^/]+)\/action$/.exec(p))) return ['action', { id: m[1], action: body.action, body: body }];
    if (p === '/api/v1/workers') return ['worker', Object.assign({}, body, { id: res.id, joined: res.joined })];
    if ((m = /^\/api\/v1\/workers\/([^/]+)\/delete$/.exec(p))) return ['worker_del', { id: decodeURIComponent(m[1]) }];
    if (p === '/api/v1/gate/log') return ['gate', Object.assign({}, body, { ts: res.ts, lane: res.lane })];
    if (p === '/api/v1/vehicles') return ['vehicle', body];
    if (p === '/api/v1/faces') return ['face', { workerId: res.workerId, descriptors: res.descriptors }];
    if (p === '/api/v1/attendance/sighting') { if (!res.accepted) return null; var b = Object.assign({}, body, { ts: res.ts }); if (!res.isNew) delete b.image; return ['att', b]; }
    if (p === '/api/v1/attendance/settings') return ['attset', body];
    return null;
  };
  Engine.prototype.replay = function (kind, p, ts) {
    if (kind === 'event') this.addEvent(Object.assign({}, p, { ts: p.ts || ts }));
    else if (kind === 'worker') this.upsertWorker(p);
    else if (kind === 'worker_del') this.removeWorker(p.id);
    else if (kind === 'face') this.setFaces(p.workerId, p.descriptors, 'replace');
    else if (kind === 'att') this.attendanceSighting(Object.assign({}, p, { ts: p.ts || ts }));
    else if (kind === 'attset') this.setAttendanceSettings(p);
    else if (kind === 'gate') this.addGateRead(Object.assign({}, p, { ts: p.ts || ts }));
    else if (kind === 'vehicle') this.upsertVehicle(p);
    else if (kind === 'action') this.eventAction(p.id, p.action, p.body || {});
  };

  Engine.prototype.addGateRead = function (data) {
    var cam = data.cameraId && this.camById[data.cameraId] ? this.camById[data.cameraId] : this.camById['P01-ANPR-LIVE'];
    var s = this.site(cam.siteId);
    var g = this.gates.filter(function (x) { return x.id === (cam.gateId || (s.id + '-G1')); })[0] || this.gates[0];
    var v = this.findVehicle(data.plate);
    var decision = v ? (v.status === 'blacklisted' ? 'BLACKLISTED' : v.status === 'visitor' ? 'VISITOR' : 'AUTHORIZED') : (data.conf != null && data.conf < 0.6 ? 'UNKNOWN' : 'UNAUTHORIZED');
    if (data.forceDecision) decision = data.forceDecision;
    var norm = normalizePlate(data.plate);
    var lane = data.lane;
    if (!lane || lane === 'AUTO') lane = this.onSite[s.id][norm] ? 'OUT' : 'IN';
    var rec = this.gateRecord(s, g, lane, data.ts || Date.now(), data.plate, v, decision, data.conf != null ? +data.conf : 0.9);
    rec.source = data.source || 'live-anpr';
    rec.image = data.image || null; rec.plateImage = data.plateImage || null;
    if (lane === 'OUT' && this.onSite[s.id][norm]) {
      rec.dwellMin = Math.max(0, Math.round((rec.ts - this.onSite[s.id][norm].ts) / MIN));
      delete this.onSite[s.id][norm];
    } else if (lane === 'IN' && (decision === 'AUTHORIZED' || decision === 'VISITOR')) {
      this.onSite[s.id][norm] = { plate: data.plate, ts: rec.ts, vehicleId: v ? v.id : null, decision: decision, gateId: g.id };
    }
    g.lastPlate = rec.plate; g.barrier = (decision === 'AUTHORIZED' || decision === 'VISITOR' || lane === 'OUT') ? 'open' : 'closed';
    this.gateLog.unshift(rec);
    this.emit('gate', rec);
    if (decision === 'BLACKLISTED' || decision === 'UNAUTHORIZED') {
      this.logAudit('نظام ANPR', 'تنبيه أمني — ' + (decision === 'BLACKLISTED' ? 'مركبة في القائمة السوداء' : 'مركبة غير مصرح لها'), rec.plate);
    }
    return rec;
  };

  Engine.prototype.upsertVehicle = function (data) {
    var norm = normalizePlate(data.plate);
    var v = this.vehByNorm[norm];
    if (!v) {
      v = { id: 'VEH-' + pad(this.vehicles.length + 1, 4), plate: data.plate, country: data.country || 'EG', category: data.category || 'visitor', owner: data.owner || 'زائر', type: data.type || 'ملاكي', status: data.status || 'visitor', sites: data.sites || this.sites.map(function (s) { return s.id; }), validUntil: Date.now() + 3 * DAY, note: data.note || '', demo: false };
      this.vehicles.unshift(v); this.vehByNorm[norm] = v;
    } else {
      ['status', 'owner', 'type', 'category', 'note'].forEach(function (k) { if (data[k] !== undefined) v[k] = data[k]; });
    }
    this.logAudit('مشرف أمن البوابات', 'تحديث سجل مركبة (' + v.status + ')', v.plate);
    this.emit('vehicle', v);
    return v;
  };

  Engine.prototype.logAudit = function (actor, action, target) {
    this.seq.audit++;
    var a = { id: 'AUD-' + pad(this.seq.audit, 5), ts: Date.now(), actor: actor, ip: actor === 'نظام ANPR' || actor === 'نموذج PPE' ? 'system' : '10.10.4.21', action: action, target: target, result: 'SUCCESS' };
    this.audit.unshift(a);
    this.emit('audit', a);
    return a;
  };

  Engine.prototype.addReport = function (data) {
    this.seq.rep++;
    var lp = localParts(Date.now(), 'Africa/Cairo');
    var ds = lp.y + '-' + pad(lp.mo + 1, 2) + '-' + pad(lp.d, 2);
    var r = { id: 'REP-' + pad(this.seq.rep, 4), ts: Date.now(), name: 'EGIC-' + (data.kind || 'Safety') + '_' + ds + '_' + (data.site || 'ALL') + '.' + (data.format === 'Excel' ? 'csv' : 'pdf'), kind: 'manual', scope: data.siteName || 'كل المواقع', format: data.format || 'PDF', sizeKb: 120 + Math.round(Math.random() * 200), auto: false, from: data.from, to: data.to };
    this.reports.unshift(r);
    this.logAudit('مدير السلامة (HSE Admin)', 'إنشاء تقرير', r.name);
    return r;
  };

  /* ---------------- live simulation loop ---------------- */
  Engine.prototype.simTick = function () {
    var r = this.live, self = this;
    var s = r.weighted(this.sites.map(function (s) { return [s, s.cams * s.risk]; }));
    var zs = PROFILES[s.profile];
    var lp = localParts(Date.now(), s.tz);
    var night = lp.h >= 22 || lp.h < 6;
    var z = r.weighted(zs.map(function (z) { return [z, z.w * (z.kind === 'perimeter' ? (night ? 3 : 0.1) : 1)]; }));
    var type = r.weighted(KIND_EVENTS[z.kind]);
    if (type === 'INTRUSION' && !night) type = 'LINE_CROSSING';
    var cams = this.cameras.filter(function (c) { return c.siteId === s.id && c.zoneId === z.id && !c.live && c.kind !== 'anpr'; });
    var cam = cams.length ? r.pick(cams) : null;
    var siteWorkers = this.workers.filter(function (w) { return w.siteId === s.id && !w.presenter; });
    var ev = this.addHistoricalEvent(r, s, z, cam, type, Date.now(), siteWorkers, lp.h);
    ev.status = 'OPEN'; ev.ackTs = null; ev.resTs = null; ev.assignee = null;
    this.events.sort(function (a, b) { return b.ts - a.ts; });
    if (ev.workerId) { var w = this.workerById[ev.workerId]; if (w) { w.violations++; w.lastSeen = ev.ts; } }
    this.emit('event', this.decorate(ev));
    // auto-progress some older open events (supervisors responding)
    var opened = this.events.filter(function (e) { return ACTIVE[e.status] && e.source === 'sim'; }).slice(3, 40);
    if (opened.length && r.chance(0.7)) {
      var e = r.pick(opened), act = e.status === 'OPEN' ? (r.chance(0.6) ? 'assign' : 'ack') : 'resolve';
      if (Date.now() - e.ts > 60e3) this.eventAction(e.id, act, { actor: 'مشرف السلامة — الوردية أ' });
    }
    this.emit('kpi', this.summary('ALL'));
  };

  Engine.prototype.gateTick = function () {
    var r = this.live, self = this;
    var s = r.weighted(this.sites.map(function (s) { return [s, s.type === 'warehouse' ? 1.3 : 1]; }));
    var inside = Object.keys(this.onSite[s.id]);
    var exiting = inside.length > 6 && r.chance(0.45);
    if (exiting) {
      var k = r.pick(inside), o = this.onSite[s.id][k];
      var g = this.gates.filter(function (x) { return x.id === o.gateId; })[0] || this.gates.filter(function (x) { return x.siteId === s.id; })[0];
      var v = o.vehicleId ? this.vehicles.filter(function (x) { return x.id === o.vehicleId; })[0] : null;
      var rec = this.gateRecord(s, g, 'OUT', Date.now(), o.plate, v, o.decision, r.range(0.88, 0.99));
      rec.dwellMin = Math.round((rec.ts - o.ts) / MIN);
      delete this.onSite[s.id][k];
      g.lastPlate = rec.plate; g.barrier = 'open';
      this.gateLog.unshift(rec); this.emit('gate', rec);
      return;
    }
    var pool = this.vehicles.filter(function (v) { return v.sites.indexOf(s.id) >= 0 && !self.onSite[s.id][normalizePlate(v.plate)]; });
    var unknown = r.chance(0.08) || !pool.length;
    var v2 = unknown ? null : r.pick(pool);
    var plate = v2 ? v2.plate : (s.country === 'SA' ? this.saPlate(r).text : this.egPlate(r).text);
    var decision = v2 ? (v2.status === 'blacklisted' ? 'BLACKLISTED' : v2.status === 'visitor' ? 'VISITOR' : 'AUTHORIZED') : (r.chance(0.4) ? 'UNKNOWN' : 'UNAUTHORIZED');
    var g2 = r.pick(this.gates.filter(function (x) { return x.siteId === s.id; }));
    var rec2 = this.gateRecord(s, g2, 'IN', Date.now(), plate, v2, decision, r.range(0.84, 0.99));
    if (decision === 'AUTHORIZED' || decision === 'VISITOR') this.onSite[s.id][normalizePlate(plate)] = { plate: plate, ts: rec2.ts, vehicleId: v2 ? v2.id : null, decision: decision, gateId: g2.id };
    g2.lastPlate = plate; g2.barrier = decision === 'AUTHORIZED' || decision === 'VISITOR' ? 'open' : 'closed';
    this.gateLog.unshift(rec2); this.emit('gate', rec2);
  };

  Engine.prototype.start = function (opts) {
    opts = opts || {};
    this.stop();
    var self = this;
    function loop(fn, min, max) {
      var t = { id: null };
      (function sched() { t.id = setTimeout(function () { try { fn.call(self); } catch (e) { if (typeof console !== 'undefined') console.error(e); } sched(); }, min + Math.random() * (max - min)); })();
      self.timers.push(t);
    }
    if (this.demo) {
      loop(this.simTick, opts.eventMin || 7000, opts.eventMax || 16000);
      loop(this.gateTick, opts.gateMin || 9000, opts.gateMax || 20000);
      loop(this.tickHealth, 3000, 3000);
    }
    this.running = true;
  };
  Engine.prototype.stop = function () { this.timers.forEach(function (t) { clearTimeout(t.id); }); this.timers = []; this.running = false; };

  /* ---------------- scripted demo chain (for the executive briefing) ---------------- */
  Engine.prototype.demoChain = function () {
    var self = this, t0 = Date.now();
    var cam = this.cameras.filter(function (c) { return c.siteId === 'PLT-02' && c.zoneId === 'EXT'; })[6] || this.cameras[10];
    var steps = [
      [0, 'CAMERA', 'استقبال إطار من ' + cam.id + ' · ' + cam.name],
      [350, 'AI', 'رصد شخص (Person) · ثقة 0.94'],
      [700, 'AI', 'الخوذة غير موجودة → NO_HELMET'],
      [1050, 'EVENT', 'تصنيف الحدث: معدات الوقاية / عدم ارتداء الخوذة'],
      [1400, 'SEVERITY', 'الخطورة: عالية (منطقة إنتاج × معدات وقاية)'],
      [1750, 'EVIDENCE', 'حفظ الدليل: 3 إطارات + مقطع 10 ثوانٍ (تخزين داخلي)'],
      [2100, 'ALERT', 'إشعار: مشرف السلامة — الوردية ب (لوحة التحكم + رسالة)'],
      [2450, 'INCIDENT', 'إنشاء حادثة: OPEN → ASSIGNED'],
      [2800, 'BBS', 'تحديث مؤشرات BBS والامتثال للمصنع 02']
    ];
    var r = this.live;
    var s = this.site('PLT-02'), z = this.zone('PLT-02', 'EXT');
    var siteWorkers = this.workers.filter(function (w) { return w.siteId === 'PLT-02' && !w.presenter; });
    var lp = localParts(Date.now(), s.tz);
    var created = null;
    steps.forEach(function (st) {
      setTimeout(function () {
        self.emit('trace', { step: st[1], text: st[2], t: Date.now() - t0 });
        if (st[1] === 'EVENT') {
          created = self.addHistoricalEvent(r, s, z, cam, 'NO_HELMET', Date.now(), siteWorkers, lp.h);
          created.status = 'OPEN'; created.ackTs = null; created.resTs = null; created.assignee = null; created.sev = 'HIGH'; created.source = 'demo';
          self.events.sort(function (a, b) { return b.ts - a.ts; });
          self.emit('event', self.decorate(created));
        }
        if (st[1] === 'INCIDENT' && created) self.eventAction(created.id, 'assign', { actor: 'محرك القواعد' });
        if (st[1] === 'BBS') { self.emit('kpi', self.summary('ALL')); self.emit('trace', { step: 'DONE', text: 'اكتملت السلسلة', t: Date.now() - t0, eventId: created ? created.id : null }); }
      }, st[0]);
    });
    return { started: t0, steps: steps.length };
  };

  /* ------------------------------------------------------------------ */
  /* REST-style router — shared by the Node server and embedded mode      */
  /* ------------------------------------------------------------------ */
  Engine.prototype.meta = function () {
    return {
      version: VERSION, mode: this.mode, sites: this.sites.map(function (s) { return { id: s.id, code: s.code, name: s.name, nameEn: s.nameEn, sub: s.sub, type: s.type, country: s.country, tz: s.tz, cams: s.cams, gates: s.gates.map(function (g) { return { id: s.id + '-' + g[0], name: g[1] }; }), workers: s.workers, zones: PROFILES[s.profile].map(function (z) { return { id: z.id, name: z.name, nameEn: z.nameEn, kind: z.kind, restricted: z.restricted, required: z.required }; }) }; }),
      types: TYPES, groups: GROUP_AR, sevAr: SEV_AR, ppe: PPE, ppeOrder: PPE_ORDER, presenterId: this.presenterId, shifts: this.attSettings.shifts,
      demo: this.demo, notice: this.demo ? 'بيانات عرض توضيحية — Simulated demo data' : null, reviewAr: REVIEW_AR
    };
  };

  Engine.prototype.handle = function (method, path, query, body) {
    query = query || {}; body = body || {};
    var m = method.toUpperCase();
    var p = path.replace(/\/+$/, '');
    var seg = p.split('/').filter(Boolean); // ['api','v1',...]
    if (seg[0] !== 'api' || seg[1] !== 'v1') return { status: 404, body: { error: 'not_found' } };
    var r = seg.slice(2);
    var ok = function (b) { return { status: 200, body: b }; };
    var nf = { status: 404, body: { error: 'not_found' } };
    try {
      if (m === 'GET') {
        switch (r[0]) {
          case 'health': return ok({ status: 'ok', engine: 'ONLINE', mode: this.mode, version: VERSION, time: Date.now() });
          case 'meta': return ok(this.meta());
          case 'summary': return ok(this.summary(query.site));
          case 'trend': return ok(this.trend(query.site, query.range));
          case 'heatmap': return ok(this.heatmap(query.site, +query.days || 7));
          case 'zones': return ok(this.zoneStats(query.site));
          case 'sites': return ok(r[1] === 'stats' ? this.siteStats() : this.meta().sites);
          case 'events':
            if (r[1]) { var e = this.eventById[r[1]]; return e ? ok(this.decorate(e)) : nf; }
            return ok(this.listEvents(query));
          case 'workers':
            if (r[1]) { var wp = this.workerProfile(decodeURIComponent(r[1])); return wp ? ok(wp) : nf; }
            return ok(this.listWorkers(query));
          case 'cameras':
            var f = inSite(query.site);
            return ok({ items: this.cameras.filter(function (c) { return f(c) && (!query.kind || query.kind === 'ALL' || (query.kind === 'anpr' ? c.kind === 'anpr' : c.kind !== 'anpr')); }) });
          case 'gates': return ok({ items: this.gates });
          case 'gate':
            if (r[1] === 'log') return ok(this.gateList(query));
            if (r[1] === 'stats') return ok(this.gateStats(query.site));
            return nf;
          case 'vehicles':
            var t = (query.q || '').trim(), nt = t ? normalizePlate(t).replace('|', '') : '';
            return ok({ items: this.vehicles.filter(function (v) { return (!query.status || query.status === 'ALL' || v.status === query.status) && (!nt || normalizePlate(v.plate).replace('|', '').indexOf(nt) >= 0 || (v.owner || '').indexOf(t) >= 0); }).slice(0, +query.limit || 300), total: this.vehicles.length });
          case 'bbs': return ok(this.bbs(query.site, query.dim));
          case 'system': return ok(this.healthSnapshot());
          case 'audit': return ok({ items: this.audit.slice(0, +query.limit || 100) });
          case 'reports': return ok({ items: this.reports });
          case 'faces': return ok({ items: this.faces });
          case 'attendance':
            if (r[1] === 'range') return ok(this.attendanceRange(query));
            if (r[1] === 'settings') return ok(this.attSettings);
            return ok(this.attendanceDay(query));
        }
      } else if (m === 'POST') {
        switch (r[0]) {
          case 'events':
            if (r[1] && r[2] === 'action') { var d = this.eventAction(r[1], body.action, body); return !d ? nf : d.error ? { status: 400, body: d } : ok(d); }
            return ok(this.addEvent(body));
          case 'observe': return ok(this.observe(body.workerId, !!body.compliant));
          case 'workers':
            if (r[1] && r[2] === 'delete') { var rw = this.removeWorker(decodeURIComponent(r[1])); return rw ? ok(rw) : nf; }
            return ok(this.upsertWorker(body));
          case 'faces': var fc = this.setFaces(body.workerId, body.descriptors, body.mode); return fc ? ok(fc) : nf;
          case 'attendance':
            if (r[1] === 'sighting') { var sg = this.attendanceSighting(body); return sg ? ok(sg) : nf; }
            if (r[1] === 'settings') return ok(this.setAttendanceSettings(body));
            return nf;
          case 'gate': if (r[1] === 'log') return ok(this.addGateRead(body)); return nf;
          case 'vehicles': return ok(this.upsertVehicle(body));
          case 'reports': return ok(this.addReport(body));
          case 'demo': return ok(this.demoChain());
          case 'audit': return ok(this.logAudit(body.actor || 'مستخدم', body.action || 'إجراء', body.target || ''));
        }
      }
    } catch (err) {
      return { status: 500, body: { error: 'engine_error', message: String(err && err.message || err) } };
    }
    return nf;
  };

  return {
    Engine: Engine, VERSION: VERSION, SITES: SITES, TYPES: TYPES, PPE: PPE, PPE_ORDER: PPE_ORDER, SEV_AR: SEV_AR, GROUP_AR: GROUP_AR,
    PROFILES: PROFILES, normalizePlate: normalizePlate, toArabicDigits: toArabicDigits, toLatinDigits: toLatinDigits,
    localParts: localParts, shiftOf: shiftOf, hashStr: hashStr, Rng: Rng, EG_LETTERS: EG_LETTERS
  };
});
