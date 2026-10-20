/*!
 * EGIC · Operations Console — core, router & main views
 * POWERED BY DELMON & DEV SMART X
 */
(function () {
  'use strict';
  var API = window.EGICClient, C = window.EGICCharts, SC = window.EGICScenes, ENG = window.EGICEngine;

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                          */
  /* ------------------------------------------------------------------ */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v; // only used with static, trusted markup
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  var ICONS = {
    overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    wall: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M12 4v14M2 11h20M8 21h8"/>',
    live: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="10" r="3"/><path d="M7 17c1.2-2 3-3 5-3s3.8 1 5 3"/>',
    events: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    workers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.7 2.5 3 5.2"/>',
    bbs: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    reports: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
    gates: '<path d="M3 20V9M3 11h18"/><path d="M6 11l3-2M11 11l3-2M16 11l3-2"/><rect x="1.5" y="7" width="3" height="4" rx="1"/>',
    anpr: '<path d="M5 17h14M3 17v-4l2-5a2 2 0 0 1 2-1.3h10A2 2 0 0 1 19 8l2 5v4"/><circle cx="7.5" cy="17" r="1.8"/><circle cx="16.5" cy="17" r="1.8"/><rect x="9" y="12" width="6" height="2.5" rx=".6"/>',
    vehicles: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    sites: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    cameras: '<rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="m15.5 10 6-3.5v11l-6-3.5"/>',
    access: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    rules: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    integrations: '<path d="M9 2v5M15 2v5M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v6"/>',
    health: '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1z"/>',
    audit: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5"/><path d="M14 3v6h6v2"/><circle cx="16.5" cy="16.5" r="3"/><path d="m21 21-2.3-2.3"/>',
    api: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    helmet: '<path d="M4 16a8 8 0 0 1 16 0"/><path d="M2.5 16h19v2.5h-19z"/><path d="M12 8V5M9 9.5 8 6.5M15 9.5l1-3"/>',
    glasses: '<circle cx="6.5" cy="14" r="3.5"/><circle cx="17.5" cy="14" r="3.5"/><path d="M10 14h4M3 13 4.5 8M21 13l-1.5-5"/>',
    vest: '<path d="M8 3 5 6v15h5v-6l2-2 2 2v6h5V6l-3-3-2 3h-4z"/><path d="M5 12h5M14 12h5"/>',
    gloves: '<path d="M7 21v-4l-2.5-4.5a1.6 1.6 0 0 1 2.7-1.7L9 13V5a1.5 1.5 0 0 1 3 0v6-7.5a1.5 1.5 0 0 1 3 0V11V5a1.5 1.5 0 0 1 3 0v9c0 3-1.5 5-3 7z"/><path d="M7 18h8"/>',
    ears: '<path d="M5 14v-2a7 7 0 0 1 14 0v2"/><rect x="3" y="13" width="4" height="7" rx="1.5"/><rect x="17" y="13" width="4" height="7" rx="1.5"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
    full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M4 4h16"/>',
    userplus: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M19 8v6M16 11h6"/>',
    alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.5"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    sos: '<path d="M7 18v-6a5 5 0 0 1 10 0v6M5 21h14M12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4"/>',
    station: '<rect x="3" y="8" width="11" height="9" rx="1.5"/><path d="M14 11h3l3 3v3h-6M6 17v3M11 17v3M6 5h5"/>',
    posture: '<circle cx="13" cy="4.5" r="2"/><path d="M13 7c-2 3-4 4-7 4M13 7l1 6-3 8M14 13l4 3 1 5"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>'
  };
  function icon(name, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    s.innerHTML = ICONS[name] || ICONS.overview;
    return s;
  }

  /* ------------------------------------------------------------------ */
  /* Formatting                                                          */
  /* ------------------------------------------------------------------ */
  var AR_STATUS = { OPEN: 'مفتوح', ACK: 'تم الاستلام', ASSIGNED: 'مُسند', RESOLVED: 'تم الحل', FALSE_POSITIVE: 'إنذار غير صحيح' };
  var AR_DEC = { AUTHORIZED: 'مصرّح', VISITOR: 'زائر', UNAUTHORIZED: 'غير مصرّح', BLACKLISTED: 'قائمة سوداء', UNKNOWN: 'غير مقروءة' };
  var SEV_CLASS = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' };
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function cairo(ts) { return ENG.localParts(ts, 'Africa/Cairo'); }
  function fTime(ts) { var p = cairo(ts); return pad2(p.h) + ':' + pad2(p.mi) + ':' + pad2(p.s); }
  function fHM(ts) { var p = cairo(ts); return pad2(p.h) + ':' + pad2(p.mi); }
  function fDate(ts) { var p = cairo(ts); return p.y + '-' + pad2(p.mo + 1) + '-' + pad2(p.d); }
  function fDT(ts) { return fDate(ts) + ' ' + fHM(ts); }
  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return 'الآن'; if (s < 3600) return 'منذ ' + Math.round(s / 60) + ' د'; if (s < 86400) return 'منذ ' + Math.round(s / 3600) + ' س';
    return 'منذ ' + Math.round(s / 86400) + ' يوم';
  }
  function num(n, d) { if (n === null || n === undefined || isNaN(n)) return '—'; return (+n).toLocaleString('en-US', { maximumFractionDigits: d == null ? 1 : d }); }
  function sevBadge(sev) { return h('span', { class: 'badge badge--' + (SEV_CLASS[sev] || 'neutral'), text: ENG.SEV_AR[sev] || sev }); }
  function statusBadge(st) { var c = st === 'OPEN' ? 'critical' : st === 'RESOLVED' ? 'good' : st === 'FALSE_POSITIVE' ? 'neutral' : 'medium'; return h('span', { class: 'badge badge--' + c, text: AR_STATUS[st] || st }); }
  function decBadge(d) { var c = d === 'AUTHORIZED' ? 'good' : d === 'VISITOR' ? 'low' : d === 'UNKNOWN' ? 'medium' : d === 'BLACKLISTED' ? 'critical' : 'high'; return h('span', { class: 'badge badge--' + c, text: AR_DEC[d] || d }); }
  function srcTag(src) { return String(src || '').indexOf('live') === 0 ? h('span', { class: 'tag-real', text: 'LIVE AI · حقيقي' }) : src === 'demo' ? h('span', { class: 'tag-demo', text: 'DEMO CHAIN' }) : h('span', { class: 'tag-demo', text: 'SIM' }); }
  function initials(name) { var p = String(name || '?').trim().split(/\s+/); return (p[0] || '?').charAt(0) + (p[1] ? p[1].charAt(0) : ''); }

  var S = { site: 'ALL', meta: null, route: 'overview', param: null, cleanup: [], unread: 0, summary: null, faceIndex: {} };
  function camById(id) { return S.cams ? S.cams[id] : null; }
  function evidenceSrc(ev, w) {
    if (ev.evidence && ev.evidence.image) return API.evidenceUrl(ev.evidence.image);
    var cam = camById(ev.cameraId) || { id: ev.cameraId || 'CAM', scene: 'production' };
    try { return SC.evidenceThumb(ev, cam, w || 320, Math.round((w || 320) * 9 / 16)); } catch (e) { return ''; }
  }
  function siteName(id) { var s = S.meta && S.meta.sites.filter(function (x) { return x.id === id; })[0]; return s ? s.name : id; }

  /* ------------------------------------------------------------------ */
  /* UI primitives                                                        */
  /* ------------------------------------------------------------------ */
  function card(title, opts) {
    opts = opts || {};
    var head = h('div', { class: 'card-h' }, h('div', null, h('div', { class: 'card-t' }, opts.icon ? icon(opts.icon) : null, title), opts.sub ? h('div', { class: 'card-sub', text: opts.sub }) : null), h('div', { class: 'card-actions' }, opts.actions || null));
    var body = h('div', { class: 'card-b' });
    var el = h('section', { class: 'card' + (opts.flush ? ' card--flush' : '') + (opts.cls ? ' ' + opts.cls : '') }, title || opts.actions ? head : null, body, opts.foot ? h('div', { class: 'card-foot' }, opts.foot) : null);
    el.body = body; el.head = head;
    return el;
  }
  function stat(label, value, sub, opts) {
    opts = opts || {};
    return h('div', { class: 'stat' }, h('div', { class: 'stat-l' }, opts.icon ? icon(opts.icon) : null, label), h('div', { class: 'stat-v' + (opts.critical ? ' is-critical' : '') }, value, opts.unit ? h('small', { text: opts.unit }) : null), sub ? h('div', { class: 'stat-s' }, sub) : null);
  }
  function table(cols, rows, opts) {
    opts = opts || {};
    var thead = h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { text: c.t, style: c.w ? { width: c.w } : null }); })));
    var tbody = h('tbody');
    rows.forEach(function (r, i) {
      var tr = h('tr', { class: (opts.onRow ? 'is-click' : '') + (r.__new ? ' is-new' : '') });
      cols.forEach(function (c) { var v = c.f(r, i); tr.appendChild(h('td', { class: c.cls || null }, v)); });
      if (opts.onRow) tr.addEventListener('click', function () { opts.onRow(r); });
      tbody.appendChild(tr);
    });
    if (!rows.length) tbody.appendChild(h('tr', null, h('td', { colspan: cols.length }, h('div', { class: 'empty', text: opts.empty || 'لا توجد بيانات' }))));
    return h('div', { class: 'table-wrap', style: opts.maxH ? { maxHeight: opts.maxH } : null }, h('table', { class: 'tbl' }, thead, tbody));
  }
  function seg(options, value, onChange) {
    var el = h('div', { class: 'seg', role: 'group' });
    options.forEach(function (o) {
      var b = h('button', { type: 'button', 'aria-pressed': String(o[0] === value), text: o[1] });
      b.addEventListener('click', function () { Array.prototype.forEach.call(el.children, function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); onChange(o[0]); });
      el.appendChild(b);
    });
    return el;
  }
  function select(options, value, onChange, cls) {
    var el = h('select', { class: 'select ' + (cls || '') });
    options.forEach(function (o) { var op = h('option', { value: o[0], text: o[1] }); if (o[0] === value) op.selected = true; el.appendChild(op); });
    el.addEventListener('change', function () { onChange(el.value); });
    return el;
  }
  function chartCard(title, sub, drawChart, tableData, opts) {
    var c = card(title, Object.assign({ sub: sub }, opts || {}));
    var holder = h('div'), mode = 'chart';
    var tbtn = h('button', { class: 'btn btn--xs btn--ghost', type: 'button', text: 'جدول', title: 'عرض كجدول' });
    tbtn.addEventListener('click', function () { mode = mode === 'chart' ? 'table' : 'chart'; tbtn.textContent = mode === 'chart' ? 'جدول' : 'رسم'; render(); });
    $('.card-actions', c.head).appendChild(tbtn);
    function render() { clear(holder); if (holder.__legend) holder.__legend.remove(); if (mode === 'chart') drawChart(holder); else { var d = tableData(); C.table(holder, d.cols, d.rows); } }
    c.body.appendChild(holder); render();
    c.redraw = render;
    return c;
  }

  /* toasts / drawer / modal */
  function toast(title, sub, opts) {
    opts = opts || {};
    var t = h('div', { class: 'toast ' + (opts.kind ? 'toast--' + opts.kind : '') }, opts.img ? h('img', { src: opts.img, alt: '' }) : h('span', { class: 'dot ' + (opts.kind === 'critical' ? 'dot--off' : 'dot--on') }), h('div', null, h('div', { class: 'toast-t', text: title }), sub ? h('div', { class: 'toast-s', text: sub }) : null), opts.action ? h('button', { class: 'btn btn--xs', text: opts.action[0], onclick: function () { opts.action[1](); t.remove(); } }) : null);
    var box = $('#toasts'); box.insertBefore(t, box.firstChild);
    while (box.children.length > 4) box.removeChild(box.lastChild);
    setTimeout(function () { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 450); }, opts.ms || 6000);
  }
  function openDrawer(titleEl, bodyEl) { clear($('#drawerTitle')).appendChild(titleEl); clear($('#drawerBody')).appendChild(bodyEl); $('#drawer').classList.add('is-open'); $('#scrim').classList.add('is-open'); }
  function closeDrawer() { $('#drawer').classList.remove('is-open'); if (!$('#modal').classList.contains('is-open')) $('#scrim').classList.remove('is-open'); }
  function openModal(title, bodyEl) { $('#modalTitle').textContent = title; clear($('#modalBody')).appendChild(bodyEl); $('#modal').classList.add('is-open'); $('#scrim').classList.add('is-open'); }
  function closeModal() { $('#modal').classList.remove('is-open'); if (!$('#drawer').classList.contains('is-open')) $('#scrim').classList.remove('is-open'); var mb = $('#modalBody'); if (mb.__onClose) { mb.__onClose(); mb.__onClose = null; } }
  function imageModal(src, caption) { openModal(caption || 'الدليل', h('div', null, h('img', { src: src, alt: caption || '', style: { width: '100%', borderRadius: '10px' } }))); }

  /* ------------------------------------------------------------------ */
  /* Event drawer                                                         */
  /* ------------------------------------------------------------------ */
  function openEvent(ev) {
    function render(e) {
      var img = evidenceSrc(e, 640);
      var body = h('div', { style: { display: 'grid', gap: '16px' } },
        h('div', { style: { position: 'relative' } }, h('img', { src: img, alt: 'دليل الحدث', style: { width: '100%', borderRadius: '12px', border: '1px solid var(--line-2)', cursor: 'zoom-in' }, onclick: function () { imageModal(img, e.typeAr + ' · ' + e.id); } }), h('div', { style: { position: 'absolute', top: '10px', insetInlineStart: '10px' } }, srcTag(e.source))),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, sevBadge(e.sev), statusBadge(e.status), h('span', { class: 'chip', text: (ENG.GROUP_AR[e.group] || e.group) }), e.missing && e.missing.length > 1 ? h('span', { class: 'chip', text: 'حادثة مجمّعة: ' + e.missing.length + ' عناصر' }) : null),
        h('dl', { class: 'kv' },
          h('dt', { text: 'رقم الحدث' }), h('dd', { class: 'mono', text: e.id }),
          h('dt', { text: 'المخالفة' }), h('dd', { text: e.typeAr + ' · ' + e.typeEn }),
          h('dt', { text: 'الموقع / المنطقة' }), h('dd', { text: e.siteName + ' · ' + e.zoneName }),
          h('dt', { text: 'الكاميرا' }), h('dd', null, h('span', { class: 'mono', text: e.cameraId || '—' }), e.cameraName ? h('span', { class: 'muted', text: ' · ' + e.cameraName }) : null),
          h('dt', { text: 'التوقيت' }), h('dd', { class: 'mono', text: fDate(e.ts) + ' ' + fTime(e.ts) + ' (القاهرة)' }),
          h('dt', { text: 'الثقة (AI)' }), h('dd', { class: 'mono', text: Math.round((e.conf || 0) * 100) + '%' }),
          h('dt', { text: 'العامل' }), h('dd', null, e.workerId ? h('a', { href: '#/workers/' + e.workerId, text: (e.workerName || '') + ' · ' + e.workerId, onclick: closeDrawer }) : h('span', { class: 'muted', text: 'غير محدد الهوية' })),
          h('dt', { text: 'القسم / الوردية' }), h('dd', { text: (e.dept || '—') + ' · الوردية ' + ({ A: 'أ', B: 'ب', C: 'ج' })[e.shift || 'A'] }),
          h('dt', { text: 'المسؤول' }), h('dd', { text: e.assignee || '—' }),
          h('dt', { text: 'زمن الاستجابة' }), h('dd', { class: 'mono', text: e.ackTs ? Math.round((e.ackTs - e.ts) / 1000) + ' ث' : '—' }),
          h('dt', { text: 'الدليل' }), h('dd', { text: e.evidence && e.evidence.image ? 'لقطة حقيقية من الكاميرا (مخزنة داخليًا)' : 'لا توجد صورة (حدث محاكاة)' }),
          e.note ? h('dt', { text: 'ملاحظة' }) : null, e.note ? h('dd', { text: e.note }) : null),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          e.status === 'OPEN' ? h('button', { class: 'btn btn--sm', text: 'استلام', onclick: function () { act(e, 'ack'); } }) : null,
          e.status === 'OPEN' || e.status === 'ACK' ? h('button', { class: 'btn btn--sm', text: 'إسناد لمشرف السلامة', onclick: function () { act(e, 'assign'); } }) : null,
          e.status !== 'RESOLVED' ? h('button', { class: 'btn btn--sm btn--primary', text: 'إغلاق الحدث', onclick: function () { act(e, 'resolve'); } }) : null,
          e.status !== 'FALSE_POSITIVE' && e.status !== 'RESOLVED' ? h('button', { class: 'btn btn--sm btn--ghost', text: 'إنذار غير صحيح', onclick: function () { act(e, 'false_positive'); } }) : null,
          e.status === 'RESOLVED' || e.status === 'FALSE_POSITIVE' ? h('button', { class: 'btn btn--sm btn--ghost', text: 'إعادة فتح', onclick: function () { act(e, 'reopen'); } }) : null));
      openDrawer(h('div', null, h('div', { class: 'card-t', text: 'تفاصيل الحدث' }), h('b', { text: e.typeAr, style: { fontSize: '17px' } })), body);
    }
    function act(e, action) { API.post('events/' + e.id + '/action', { action: action }).then(function (d) { render(d); toast('تم تحديث الحدث', AR_STATUS[d.status] + ' · ' + d.id); }); }
    render(ev);
  }

  /* ------------------------------------------------------------------ */
  /* Router & shell                                                       */
  /* ------------------------------------------------------------------ */
  var NAV = [
    ['المراقبة', 'MONITOR', [['overview', 'نظرة عامة', 'overview'], ['live', 'المختبر الحي — AI', 'live', 'LIVE']]],
    ['الموارد البشرية', 'HR', [['workers', 'الموظفون والملفات', 'workers'], ['attendance', 'الحضور والانصراف', 'clock', 'LIVE']]],
    ['التحليلات', 'ANALYTICS', [['events', 'سجل الأحداث', 'events', 'count'], ['bbs', 'مؤشرات السلوك BBS', 'bbs'], ['reports', 'التقارير', 'reports']]],
    ['الوصول الذكي', 'SMART ACCESS', [['gates', 'البوابات وANPR', 'gates'], ['anpr', 'قارئ اللوحات المصرية', 'anpr', 'LIVE'], ['vehicles', 'سجل المركبات', 'vehicles']]],
    ['الإدارة', 'MANAGE', [['sites', 'المواقع والمناطق', 'sites'], ['cameras', 'الكاميرات', 'cameras'], ['access', 'المستخدمون والصلاحيات', 'access'], ['rules', 'قواعد التنبيه والتصعيد', 'rules'], ['integrations', 'التكامل المؤسسي', 'integrations']]],
    ['النظام', 'SYSTEM', [['health', 'صحة النظام', 'health'], ['audit', 'سجل التدقيق', 'audit'], ['api', 'الخلفية والواجهة البرمجية', 'api']]]
  ];
  var VIEWS = {};
  function register(name, fn) { VIEWS[name] = fn; }

  function renderNav() {
    var nav = clear($('#nav'));
    NAV.forEach(function (g) {
      var grp = h('div', { class: 'nav-group' }, h('span', { text: g[0] + ' · ' + g[1] }));
      g[2].forEach(function (it) {
        var b = h('button', { class: 'nav-item' + (S.route === it[0] ? ' is-active' : ''), type: 'button', 'data-route': it[0] }, icon(it[2]), h('span', { text: it[1] }), it[3] === 'LIVE' ? h('span', { class: 'nav-badge', text: 'LIVE' }) : it[3] === 'count' ? h('span', { class: 'nav-count', id: 'navCount', text: String(S.summary ? S.summary.activeViolations : '') }) : null);
        b.addEventListener('click', function () { location.hash = '#/' + it[0]; $('#app').classList.remove('nav-open'); });
        grp.appendChild(b);
      });
      nav.appendChild(grp);
    });
  }
  function navigate(hash) { location.hash = hash; }
  function route() {
    var hs = (location.hash || '#/overview').replace(/^#\/?/, '').split('/');
    var name = hs[0] || 'overview';
    if (!VIEWS[name]) name = 'overview';
    S.cleanup.forEach(function (f) { try { f(); } catch (e) { } }); S.cleanup = [];
    S.route = name; S.param = hs[1] ? decodeURIComponent(hs[1]) : null;
    renderNav();
    var v = clear($('#view'));
    v.scrollTop = 0; window.scrollTo(0, 0);
    try { VIEWS[name](v, S.param); } catch (e) { console.error(e); v.appendChild(h('div', { class: 'empty', text: 'تعذر عرض الصفحة: ' + e.message })); }
    $('#view').focus({ preventScroll: true });
  }
  function onCleanup(f) { S.cleanup.push(f); }
  function every(ms, f) { var id = setInterval(f, ms); onCleanup(function () { clearInterval(id); }); }
  function sub(type, f) { onCleanup(API.on(type, f)); }

  function viewHead(title, desc, actions) {
    return h('div', { class: 'view-h' }, h('div', null, h('h1', { text: title }), desc ? h('p', { text: desc }) : null), h('div', { class: 'actions' }, actions || null));
  }

  /* status strip */
  function renderStatus(health) {
    var st = clear($('#status'));
    var cams = health ? health.cameras : null;
    var mode = API.state.mode;
    st.appendChild(h('span', null, h('span', { class: 'dot dot--on' }), 'NODE ', h('b', { text: mode === 'server' ? 'egic-core-01' : 'egic-edge-browser' })));
    st.appendChild(h('span', null, 'MODE ', h('b', { text: 'MULTI-SITE · 9' })));
    st.appendChild(h('span', null, 'CAMERAS ', h('b', { text: cams ? cams.online + '/' + cams.total : '—' })));
    st.appendChild(h('span', null, 'ENGINE ', h('b', { class: 'ok', text: 'ONLINE' })));
    st.appendChild(h('span', { class: 'hide-sm' }, 'BACKEND ', h('b', { class: mode === 'server' ? 'ok' : 'warn', text: mode === 'server' ? 'LIVE API · SSE' : 'EMBEDDED ENGINE' })));
    st.appendChild(h('span', { class: 'spacer' }));
    st.appendChild(h('span', { class: 'hide-sm' }, 'POWERED BY ', h('b', { text: 'DELMON & DEV SMART X' })));
    st.appendChild(h('span', { id: 'clock' }, h('b', { text: fTime(Date.now()) }), ' CAIRO'));
  }

  function setBell(n) { var c = $('#bellCount'); c.textContent = String(n); c.style.display = n ? '' : 'none'; }

  /* ------------------------------------------------------------------ */
  /* VIEW: Overview                                                       */
  /* ------------------------------------------------------------------ */
  register('overview', function (v) {
    var site = S.site;
    v.appendChild(viewHead('نظرة السلامة العامة', 'امتثال معدات الوقاية والأحداث لحظيًا عبر ' + (site === 'ALL' ? 'المواقع التسعة' : siteName(site)), [h('span', { class: 'updated', id: 'upd', text: 'UPDATED ' + fTime(Date.now()) })]));
    var hero = card(null, { cls: 'hero-kpi-card' });
    var heroIn = h('div', { class: 'hero-kpi' }); hero.body.style.padding = '0'; hero.body.appendChild(heroIn);
    v.appendChild(hero);
    var row2 = h('div', { class: 'grid g-4' }); v.appendChild(row2);
    var mid = h('div', { class: 'grid g-main' }); v.appendChild(mid);
    var trendCard = card('اتجاه الامتثال', { sub: 'آخر 24 ساعة · حسب عنصر الوقاية', actions: [seg([['24h', '24 س'], ['7d', '7 أيام'], ['30d', '30 يوم']], '24h', function (r) { drawTrend(r); })] });
    var feedCard = card('المخالفات المباشرة', { actions: [h('span', { class: 'badge badge--critical', id: 'openBadge', text: '—' })] });
    mid.appendChild(trendCard); mid.appendChild(feedCard);
    var feed = h('div', { class: 'feed', id: 'feed' }); feedCard.body.appendChild(feed);
    var row3 = h('div', { class: 'grid g-3' }); v.appendChild(row3);
    var row4 = h('div', { class: 'grid g-main-r' }); v.appendChild(row4);

    var trendHolder = h('div'); trendCard.body.appendChild(trendHolder);
    var hidden = {};
    function drawTrend(range) {
      API.get('trend', { site: site, range: range }).then(function (t) {
        var xs = t.points.map(function (p) { return p.t; });
        var names = [['index', 'المؤشر الكلي'], ['helmet', 'الخوذة'], ['glasses', 'النظارة'], ['vest', 'السترة'], ['gloves', 'القفازات'], ['ears', 'سماعات الأذن']];
        var series = names.map(function (n, i) { return { name: n[1], values: t.points.map(function (p) { return n[0] === 'index' ? p.index : p.items[n[0]]; }), color: i === 5 ? 'var(--warning)' : C.seriesColor(i), hidden: hidden[i], width: i === 0 ? 2.5 : 1.6 }; });
        if (trendHolder.__legend) trendHolder.__legend.remove();
        C.line(trendHolder, { x: xs, series: series, height: 240, yMax: 100, yMinAuto: true, target: 95, targetLabel: 'الهدف 95%', yFormat: function (v) { return v.toFixed(1) + '%'; }, yTick: function (v) { return v + '%'; }, xLabel: function (x) { return range === '30d' ? fDate(x).slice(5) : fHM(x); }, tipTitle: function (x) { return range === '30d' ? fDate(x) : fDate(x) + ' ' + fHM(x); }, onToggle: function (i) { hidden[i] = !hidden[i]; drawTrend(range); } });
      });
    }
    drawTrend('24h');

    function renderSummary(s) {
      S.summary = s;
      clear(heroIn);
      var mainK = h('div', { class: 'kpi-main' },
        h('div', { class: 'stat-l' }, 'PPE COMPLIANCE INDEX // ', h('span', { text: site === 'ALL' ? 'كل المواقع' : siteName(site) })),
        h('div', { class: 'big' }, num(s.compliance, 1), h('small', { text: 'PERCENT COMPLIANT' })),
        h('div', { id: 'meter', style: { marginTop: '18px' } }),
        h('div', { class: 'stat-s', style: { marginTop: '10px' } }, 'الأمس في نفس الفترة ', h('span', { class: 'delta ' + (s.compliance >= s.compliancePrev ? 'up-good' : 'down-bad'), text: (s.compliance >= s.compliancePrev ? '▲ ' : '▼ ') + num(Math.abs(s.compliance - s.compliancePrev), 1) + ' نقطة' }), h('span', { class: 'tag-demo', text: 'DEMO DATA' })));
      heroIn.appendChild(mainK);
      C.meter($('#meter', mainK), { value: s.compliance, target: s.target, warn: 85 });
      heroIn.appendChild(h('div', { class: 'kpi-stack' }, stat('في الموقع الآن', num(s.onSite, 0), 'الوردية ' + ({ A: 'أ', B: 'ب', C: 'ج' })[s.shift], { icon: 'workers' }), stat('مخالفات نشطة', num(s.activeViolations, 0), 'بانتظار إجراء', { icon: 'alert', critical: s.activeViolations > 0 })));
      heroIn.appendChild(h('div', { class: 'kpi-stack' }, stat('مدة التعرض', num(s.exposureMin, 1), 'دقائق عدم امتثال · اليوم', { icon: 'posture', unit: 'د' }), stat('تسلل ومناطق محظورة', num(s.intrusionsToday, 0), 'اليوم', { icon: 'access' })));
      clear(row2);
      [['أحداث حرجة (24س)', num(s.critical24, 0), 'تصعيد تلقائي', 'alert', s.critical24 > 0], ['مؤشر BBS', num(s.bbsScore, 1), 'صيغة قابلة للضبط مع HSE', 'bbs'], ['متوسط زمن الاستجابة', s.meanResponseSec != null ? Math.round(s.meanResponseSec / 60 * 10) / 10 + '' : '—', 'دقيقة حتى الاستلام · 7 أيام', 'rules'], ['مركبات داخل المواقع', num(s.vehiclesOnSite, 0), num(s.authorizedToday, 0) + ' دخول مصرح · ' + num(s.deniedToday, 0) + ' مرفوض اليوم', 'vehicles']].forEach(function (k) {
        var c = card(null); c.body.style.padding = '0'; c.body.appendChild(stat(k[0], k[1], k[2], { icon: k[3], critical: k[4] })); row2.appendChild(c);
      });
      var ob = $('#openBadge'); if (ob) ob.textContent = s.activeViolations + ' OPEN';
      var nc = $('#navCount'); if (nc) nc.textContent = String(s.activeViolations);
      var u = $('#upd'); if (u) u.textContent = 'UPDATED ' + fTime(Date.now());
    }
    API.get('summary', { site: site }).then(renderSummary);

    function feedItem(e, isNew) {
      var it = h('button', { type: 'button', class: 'feed-item' + (isNew ? ' is-new' : '') + (String(e.source).indexOf('live') === 0 ? ' is-live' : '') },
        h('img', { src: evidenceSrc(e, 240), alt: '', loading: 'lazy' }),
        h('div', null, h('div', { class: 'ft', text: e.typeAr }), h('div', { class: 'fs', text: (e.workerName ? e.workerName + ' · ' : '') + e.siteName + ' · ' + (e.zoneName || '').split(' — ')[0] }), h('div', { class: 'fs mono', text: e.cameraId || '' })),
        h('div', { class: 'fm' }, h('span', { text: fTime(e.ts) }), sevBadge(e.sev), String(e.source).indexOf('live') === 0 ? h('span', { class: 'tag-real', text: 'LIVE' }) : null));
      it.addEventListener('click', function () { openEvent(e); });
      return it;
    }
    API.get('events', { site: site, status: 'ACTIVE', limit: 30 }).then(function (r) { clear(feed); if (!r.items.length) feed.appendChild(h('div', { class: 'empty', text: 'لا توجد مخالفات مفتوحة' })); r.items.forEach(function (e) { feed.appendChild(feedItem(e)); }); });
    sub('event', function (e) {
      if (site !== 'ALL' && e.siteId !== site) return;
      var em = feed.querySelector('.empty'); if (em) em.remove();
      feed.insertBefore(feedItem(e, true), feed.firstChild);
      while (feed.children.length > 40) feed.removeChild(feed.lastChild);
    });
    sub('kpi', function () { API.get('summary', { site: site }).then(renderSummary); });

    // zones + heatmap + repeat offenders
    var zoneCard = card('الامتثال حسب المنطقة', { sub: '7 أيام · الأعلى خطورة أولًا' }); row3.appendChild(zoneCard);
    var heatCard = card('المخالفات / الساعة', { sub: '7 أيام × 24 ساعة (توقيت القاهرة)' }); row3.appendChild(heatCard);
    var repCard = card('تكرار المخالفات', { sub: '30 يومًا · للتوجيه لا للعقاب' }); row3.appendChild(repCard);
    API.get('zones', { site: site }).then(function (zs) {
      var items = zs.slice(0, 7).map(function (z) { return { label: z.name, value: z.compliance, extra: [{ label: 'أحداث', value: String(z.events) }, { label: 'حرجة', value: String(z.critical) }] }; });
      C.bars(zoneCard.body, { horizontal: true, items: items, max: 100, format: function (v) { return v.toFixed(1) + '%'; }, valueLabel: 'امتثال', color: 'var(--s1)', labelWidth: 150 });
    });
    API.get('heatmap', { site: site }).then(function (hm) {
      C.heatmap(heatCard.body, { rows: hm.rows, rowLabels: hm.dow, colLabel: function (c) { return pad2(c); }, valueLabel: 'أحداث' });
    });
    API.get('workers', { site: site, limit: 7 }).then(function (w) {
      var list = h('div', { class: 'rank' });
      if (!w.items.length) list.appendChild(h('div', { class: 'empty' }, h('div', { text: 'لا يوجد موظفون مسجلون بعد.' }), h('a', { class: 'btn btn--xs', href: '#/workers', style: { marginTop: '8px' }, text: '+ إضافة موظف' })));
      w.items.slice(0, 6).forEach(function (x, i) {
        var r = h('div', { class: 'rank-row', role: 'button', tabindex: '0' }, h('span', { class: 'n', text: pad2(i + 1) }), h('span', { class: 'av', text: initials(x.name) }), h('div', null, h('b', { text: x.name }), h('span', { text: x.id + ' · ' + x.dept + ' · امتثال ' + num(x.compliance, 1) + '%' })), h('span', { class: 'v', text: String(x.violations) }));
        r.addEventListener('click', function () { navigate('#/workers/' + x.id); });
        list.appendChild(r);
      });
      repCard.body.appendChild(list);
    });

    // site comparison + live wall teaser
    var cmpCard = card('مقارنة المواقع التسعة', { sub: 'الامتثال (24 س) · اضغط على الموقع للتصفية' });
    row4.appendChild(cmpCard);
    API.get('sites/stats').then(function (ss) {
      C.bars(cmpCard.body, { items: ss.map(function (x) { return { label: x.code, value: x.compliance, tipTitle: x.name + ' · ' + x.sub, id: x.id }; }), max: 100, height: 230, format: function (v) { return v.toFixed(1) + '%'; }, valueLabel: 'امتثال', showValues: true, onClick: function (it) { setSite(it.id); } });
    });
    var attCard = card('الحضور اليوم', { sub: 'بالتعرف على الوجه · لحظيًا', icon: 'clock', actions: [h('a', { class: 'btn btn--xs', href: '#/attendance', text: 'فتح الحضور' })] });
    row4.appendChild(attCard);
    function drawAtt() {
      API.get('attendance', { site: site }).then(function (a) {
        var t = a.totals; clear(attCard.body);
        if (!t.employees) { attCard.body.appendChild(h('div', { class: 'empty' }, h('div', { text: 'لا يوجد موظفون بعد.' }), h('a', { class: 'btn btn--xs', href: '#/workers', style: { marginTop: '8px' }, text: '+ إضافة موظف' }))); return; }
        var g = h('div', { class: 'grid g-2', style: { gap: '10px' } });
        [['حاضر', t.present, 'check'], ['في العمل الآن', t.inNow, 'workers'], ['متأخر', t.late, 'clock'], ['غائب', t.absent, 'alert']].forEach(function (k) { g.appendChild(stat(k[0], num(k[1], 0), null, { icon: k[2], critical: k[0] === 'غائب' && k[1] > 0 })); });
        attCard.body.appendChild(g);
        attCard.body.appendChild(h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '10px' }, text: t.employees + ' موظف · ' + (t.pending ? t.pending + ' لم تبدأ ورديتهم بعد · ' : '') + a.day }));
      });
    }
    drawAtt();
    sub('attendance', drawAtt); sub('worker', drawAtt);
  });

  /* ------------------------------------------------------------------ */
  /* VIEW: Events log                                                     */
  /* ------------------------------------------------------------------ */
  register('events', function (v, openId) {
    var q = { site: S.site, type: 'ALL', sev: 'ALL', status: 'ALL', source: 'ALL', q: '', limit: 25, offset: 0 };
    if (openId) {
      // deep link from the executive briefing (#/events/<id>); in embedded mode ids can differ per page, so fall back to the newest demo event
      API.get('events/' + encodeURIComponent(openId)).then(openEvent).catch(function () {
        API.get('events', { source: 'demo', limit: 1 }).then(function (r) { if (r.items && r.items[0]) openEvent(r.items[0]); }).catch(function () { });
      });
    }
    var types = S.meta.types;
    v.appendChild(viewHead('سجل الأحداث', 'كل حدث: هوية، مكان، زمن، خطورة، دليل، وإجراء', [h('button', { class: 'btn btn--sm', onclick: exportCsv }, icon('download'), 'تصدير CSV')]));
    var fl = h('div', { class: 'filters card', style: { padding: '14px 16px' } });
    var qIn = h('input', { class: 'input', placeholder: 'رقم حدث، عامل، كاميرا…', type: 'search' });
    qIn.addEventListener('input', debounce(function () { q.q = qIn.value; q.offset = 0; load(); }, 250));
    fl.appendChild(h('label', { class: 'field', style: { minWidth: '220px', flex: 1 } }, h('span', { text: 'بحث' }), qIn));
    fl.appendChild(h('label', { class: 'field' }, h('span', { text: 'النوع' }), select([['ALL', 'كل الأنواع']].concat(Object.keys(types).map(function (k) { return [k, types[k].ar]; })), 'ALL', function (x) { q.type = x; q.offset = 0; load(); })));
    fl.appendChild(h('label', { class: 'field' }, h('span', { text: 'الخطورة' }), select([['ALL', 'الكل'], ['CRITICAL', 'حرجة'], ['HIGH', 'عالية'], ['MEDIUM', 'متوسطة'], ['LOW', 'منخفضة']], 'ALL', function (x) { q.sev = x; q.offset = 0; load(); })));
    fl.appendChild(h('label', { class: 'field' }, h('span', { text: 'الحالة' }), select([['ALL', 'الكل'], ['ACTIVE', 'نشطة'], ['OPEN', 'مفتوح'], ['ASSIGNED', 'مُسند'], ['RESOLVED', 'تم الحل'], ['FALSE_POSITIVE', 'غير صحيح']], 'ALL', function (x) { q.status = x; q.offset = 0; load(); })));
    fl.appendChild(h('label', { class: 'field' }, h('span', { text: 'المصدر' }), select([['ALL', 'الكل'], ['live', 'كشف حي حقيقي'], ['sim', 'محاكاة']], 'ALL', function (x) { q.source = x; q.offset = 0; load(); })));
    v.appendChild(fl);
    var tc = card(null, { flush: true }); v.appendChild(tc);
    var pager = h('div', { class: 'pager' });
    function load() {
      API.get('events', q).then(function (r) {
        clear(tc.body);
        tc.body.appendChild(table([
          { t: 'الدليل', f: function (e) { return h('img', { class: 'thumb', src: evidenceSrc(e, 160), alt: '', loading: 'lazy' }); } },
          { t: 'الحدث', f: function (e) { return h('div', null, h('div', { class: 'strong', text: e.typeAr }), h('div', { class: 'mono muted', style: { fontSize: '11px' }, text: e.id })); } },
          { t: 'الخطورة', f: function (e) { return sevBadge(e.sev); } },
          { t: 'الموقع / المنطقة', f: function (e) { return h('div', null, h('div', { text: e.siteName }), h('div', { class: 'muted', style: { fontSize: '11.5px' }, text: (e.zoneName || '').split(' — ')[0] })); } },
          { t: 'العامل', f: function (e) { return e.workerName ? h('div', null, h('div', { text: e.workerName }), h('div', { class: 'mono muted', style: { fontSize: '11px' }, text: e.workerId })) : h('span', { class: 'muted', text: '—' }); } },
          { t: 'التوقيت', f: function (e) { return h('div', { class: 'mono', style: { fontSize: '12px' } }, h('div', { text: fTime(e.ts) }), h('div', { class: 'muted', text: fDate(e.ts) })); } },
          { t: 'الحالة', f: function (e) { return statusBadge(e.status); } },
          { t: 'المصدر', f: function (e) { return srcTag(e.source); } }
        ], r.items, { onRow: openEvent }));
        clear(pager);
        pager.appendChild(h('span', { text: 'عرض ' + (r.total ? q.offset + 1 : 0) + '–' + Math.min(q.offset + q.limit, r.total) + ' من ' + num(r.total, 0) }));
        pager.appendChild(h('div', { style: { display: 'flex', gap: '6px' } }, h('button', { class: 'btn btn--xs', text: 'السابق', disabled: q.offset === 0, onclick: function () { q.offset = Math.max(0, q.offset - q.limit); load(); } }), h('button', { class: 'btn btn--xs', text: 'التالي', disabled: q.offset + q.limit >= r.total, onclick: function () { q.offset += q.limit; load(); } })));
        tc.body.appendChild(pager);
      });
    }
    function exportCsv() {
      API.get('events', Object.assign({}, q, { limit: 500, offset: 0 })).then(function (r) {
        var rows = [['event_id', 'timestamp_cairo', 'type', 'type_ar', 'severity', 'status', 'site', 'zone', 'camera', 'worker_id', 'worker_name', 'confidence', 'source']];
        r.items.forEach(function (e) { rows.push([e.id, fDate(e.ts) + ' ' + fTime(e.ts), e.type, e.typeAr, e.sev, e.status, e.siteName, e.zoneName, e.cameraId, e.workerId || '', e.workerName || '', e.conf, e.source]); });
        downloadCsv('EGIC-events-' + fDate(Date.now()) + '.csv', rows);
        toast('تم تصدير الملف', r.items.length + ' حدث · CSV');
      });
    }
    load();
    sub('event', function () { if (q.offset === 0) load(); });
  });

  function downloadCsv(name, rows) {
    var csv = '﻿' + rows.map(function (r) { return r.map(function (c) { c = c == null ? '' : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\n') + '\n\n# POWERED BY DELMON & DEV SMART X — EGIC AI Safety & Smart Access Platform\n';
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function debounce(f, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { f.apply(s, a); }, ms); }; }

  /* ------------------------------------------------------------------ */
  /* VIEW: Workers + profile                                              */
  /* ------------------------------------------------------------------ */
  register('workers', function (v, id) {
    if (id) return renderProfile(v, id);
    var q = { site: S.site, q: '', risk: '', limit: 60 };
    v.appendChild(viewHead('الموظفون والملفات', 'ملف لكل موظف: البيانات، بصمة الوجه، الحضور والانصراف، ومخالفات السلامة', [h('a', { class: 'btn btn--sm', href: '#/attendance' }, icon('clock'), 'الحضور والانصراف'), h('button', { class: 'btn btn--sm btn--accent', onclick: function () { editProfile(null, function (w) { navigate('#/workers/' + w.id); }); } }, icon('userplus'), 'إضافة موظف')]));
    var kp = h('div', { class: 'grid g-3' }); v.appendChild(kp);
    var fl = h('div', { class: 'filters card', style: { padding: '14px 16px' } });
    var qIn = h('input', { class: 'input', placeholder: 'اسم، كود، قسم…', type: 'search' });
    qIn.addEventListener('input', debounce(function () { q.q = qIn.value; load(); }, 250));
    fl.appendChild(h('label', { class: 'field', style: { flex: 1, minWidth: '220px' } }, h('span', { text: 'بحث' }), qIn));
    fl.appendChild(h('label', { class: 'field' }, h('span', { text: 'التصفية' }), select([['', 'كل الموظفين'], ['repeat', 'تكرار مخالفات (3+)']], '', function (x) { q.risk = x; load(); })));
    v.appendChild(fl);
    var tc = card(null, { flush: true }); v.appendChild(tc);
    function load() {
      API.get('workers', q).then(function (r) {
        clear(kp);
        [['موظفون مسجلون', num(r.total, 0), 'ضمن النطاق المحدد', 'workers'], ['ببصمة وجه', num(r.items.filter(function (w) { return w.enrolled; }).length, 0), 'يتسجل حضورهم تلقائيًا', 'check'], ['تكرار المخالفات', num(r.repeat, 0), '3 مخالفات أو أكثر · للتوجيه', 'alert']].forEach(function (k) { var c = card(null); c.body.style.padding = '0'; c.body.appendChild(stat(k[0], k[1], k[2], { icon: k[3] })); kp.appendChild(c); });
        clear(tc.body);
        tc.body.appendChild(table([
          { t: 'الموظف', f: function (w) { return h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } }, h('span', { class: 'av', style: { width: '34px', height: '34px', borderRadius: '9px', background: 'var(--bg-4)', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: '11px', overflow: 'hidden', flex: 'none' } }, w.photo ? h('img', { src: API.evidenceUrl(w.photo), alt: '', style: { width: '100%', height: '100%', objectFit: 'cover' } }) : initials(w.name)), h('div', null, h('div', { class: 'strong', text: w.name }), h('div', { class: 'mono muted', style: { fontSize: '11px' }, text: w.id }))); } },
          { t: 'الموقع', f: function (w) { return w.siteName; } },
          { t: 'القسم / الوظيفة', f: function (w) { return h('div', null, h('div', { text: w.dept }), h('div', { class: 'muted', style: { fontSize: '11.5px' }, text: w.role })); } },
          { t: 'الموبايل', f: function (w) { return w.phone ? h('span', { class: 'mono', dir: 'ltr', text: w.phone }) : h('span', { class: 'muted', text: '—' }); } },
          { t: 'الوردية', f: function (w) { return shiftName(w.shift); } },
          { t: 'المخالفات', f: function (w) { return h('span', { class: 'mono strong', text: String(w.violations) }); } },
          { t: 'آخر ظهور', f: function (w) { return h('span', { class: 'mono muted', text: w.lastSeen ? ago(w.lastSeen) : '—' }); } },
          { t: 'بصمة الوجه', f: function (w) { return w.enrolled ? h('span', { class: 'badge badge--good', text: 'مسجلة' }) : h('span', { class: 'badge badge--neutral', text: 'غير مسجلة' }); } }
        ], r.items, { onRow: function (w) { navigate('#/workers/' + w.id); }, empty: 'لا يوجد موظفون بعد — اضغط «إضافة موظف» لإنشاء أول ملف.' }));
      });
    }
    load();
  });

  function renderProfile(v, id) {
    v.appendChild(h('div', null, h('a', { href: '#/workers', class: 'btn btn--xs btn--ghost', text: '→ كل الموظفين' })));
    var holder = h('div', { style: { display: 'grid', gap: '16px' } }); v.appendChild(holder);
    function load() {
      API.get('workers/' + encodeURIComponent(id)).then(function (w) {
        clear(holder);
        var enrolled = w.enrolled;
        var head = card(null); head.body.style.padding = '0';
        head.body.appendChild(h('div', { class: 'profile-h' },
          h('div', { class: 'ph' }, w.photo ? h('img', { src: API.evidenceUrl(w.photo), alt: w.name }) : initials(w.name)),
          h('div', null, h('div', { class: 'card-t', text: 'ملف الموظف · EMPLOYEE PROFILE' }), h('h2', { text: w.name }),
            h('div', { class: 'meta' }, h('span', { class: 'chip mono', text: w.id }), h('span', { class: 'chip', text: w.siteName }), h('span', { class: 'chip', text: w.dept }), h('span', { class: 'chip', text: w.role }), h('span', { class: 'chip', text: shiftName(w.shift) + ' · ' + shiftHours(w.shift) }), w.phone ? h('span', { class: 'chip mono', dir: 'ltr', text: '📞 ' + w.phone }) : null, enrolled ? h('span', { class: 'badge badge--good', text: 'بصمة الوجه مسجلة (' + w.faces + ')' }) : h('span', { class: 'badge badge--neutral', text: 'بصمة الوجه غير مسجلة' }))),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            h('button', { class: 'btn btn--sm btn--accent', onclick: function () { window.EGICLive.enrollDialog(w.id, load); } }, icon('userplus'), enrolled ? 'إعادة تسجيل الوجه' : 'تسجيل الوجه'),
            h('button', { class: 'btn btn--sm', onclick: function () { editProfile(w, load); } }, 'تعديل البيانات'),
            h('button', { class: 'btn btn--sm btn--ghost', onclick: function () { deleteWorker(w); } }, icon('trash'), 'حذف'))));
        holder.appendChild(head);
        if (!enrolled) holder.appendChild(h('div', { class: 'card', style: { padding: '12px 16px', borderColor: 'rgba(247,146,36,.5)', fontSize: '13px' } }, 'الموظف ده لسه ملوش بصمة وجه — ', h('b', { text: 'سجّل وجهه' }), ' عشان الكاميرات تتعرف عليه وتسجل حضوره وانصرافه تلقائيًا.'));
        holder.appendChild(attendanceCard(w));
        var ks = h('div', { class: 'grid g-4' });
        var live = w.events.filter(function (e) { return String(e.source).indexOf('live') === 0; });
        [['نسبة الامتثال', w.obs ? num(w.compliance, 1) + '%' : '—', num(w.obs, 0) + ' ملاحظة متابعة', 'check'], ['إجمالي المخالفات', num(w.violations, 0), 'منها ' + live.length + ' لقطات حية', 'alert'], ['آخر ظهور', w.lastSeen ? ago(w.lastSeen) : '—', w.lastSeen ? fDT(w.lastSeen) : '', 'cameras'], ['أكثر مخالفة', topType(w.byType), 'حسب التكرار', 'bbs']].forEach(function (k) { var c = card(null); c.body.style.padding = '0'; c.body.appendChild(stat(k[0], k[1], k[2], { icon: k[3] })); ks.appendChild(c); });
        holder.appendChild(ks);
        var tl = card('سجل مخالفات السلامة والأدلة', { sub: 'اللقطات الحية تُسجل تلقائيًا من الكاميرا بعلامة مائية للمنصة' });
        var list = h('div', { class: 'timeline' });
        if (!w.events.length) list.appendChild(h('div', { class: 'empty' }, h('div', { text: 'لا توجد مخالفات مسجلة في هذا الملف.' })));
        groupIncidents(w.events).forEach(function (g) {
          var e = g[0], img = evidenceSrc(e, 400);
          var item = h('div', { class: 'tl-item' + (String(e.source).indexOf('live') === 0 ? ' is-live' : '') },
            h('img', { src: img, alt: 'دليل', onclick: function () { imageModal(img, g.map(function (x) { return x.typeAr; }).join(' + ') + ' · ' + fDT(e.ts)); } }),
            h('div', null, h('div', { class: 'ttl', text: g.map(function (x) { return x.typeAr; }).join(' + ') }), h('div', { class: 'muted', style: { fontSize: '12.5px', marginTop: '4px' }, text: e.siteName + ' · ' + (e.zoneName || '') + ' · ' + (e.cameraId || '') }), h('div', { class: 'chips' }, g.map(function (x) { return sevBadge(x.sev); }), statusBadge(e.status), srcTag(e.source))),
            h('div', { class: 'mono', style: { textAlign: 'end', fontSize: '12px' } }, h('div', { text: fTime(e.ts) }), h('div', { class: 'muted', text: fDate(e.ts) }), h('button', { class: 'btn btn--xs', style: { marginTop: '8px' }, text: 'التفاصيل', onclick: function () { openEvent(e); } })));
          list.appendChild(item);
        });
        tl.body.appendChild(list);
        holder.appendChild(tl);
      }).catch(function () { clear(holder).appendChild(h('div', { class: 'empty', text: 'الملف غير موجود' })); });
    }
    load();
    sub('event', function (e) { if (e.workerId === id) load(); });
    sub('worker', function (w) { if (w.id === id) { if (w.deleted) navigate('#/workers'); else load(); } });
    sub('attendance', function (a) { if (a.record && a.record.workerId === id) load(); });
  }
  /* shift labels from the attendance settings */
  function shiftName(k) { var sh = S.meta && S.meta.shifts && S.meta.shifts[k]; return sh ? sh.name : 'الوردية ' + (({ A: 'أ', B: 'ب', C: 'ج' })[k] || k || '—'); }
  function shiftHours(k) { var sh = S.meta && S.meta.shifts && S.meta.shifts[k]; return sh ? '⁦' + sh.start + '–' + sh.end + '⁩' : ''; } // LTR isolate: keeps 06:00–14:00 in order inside Arabic text
  var ATT_STATUS = { IN: ['في العمل', 'good'], OUT: ['انصرف', 'low'], ABSENT: ['غائب', 'critical'], OFF: ['إجازة أسبوعية', 'neutral'], PENDING: ['لم يحضر بعد', 'neutral'] };
  function attBadges(o) {
    var st = ATT_STATUS[o.status] || [o.status, 'neutral'];
    return h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } }, h('span', { class: 'badge badge--' + st[1], text: st[0] }),
      o.late ? h('span', { class: 'badge badge--medium', text: 'متأخر ' + o.lateMin + ' د' }) : null,
      o.early ? h('span', { class: 'badge badge--medium', text: 'انصراف مبكر ' + o.earlyMin + ' د' }) : null,
      o.missingOut ? h('span', { class: 'badge badge--neutral', text: 'بدون انصراف' }) : null,
      o.overtimeMin >= 30 ? h('span', { class: 'chip', text: 'إضافي ' + hm(o.overtimeMin) }) : null);
  }
  function hm(min) { min = Math.max(0, Math.round(min || 0)); return Math.floor(min / 60) + ':' + pad2(min % 60); }
  function monthRange(offset) {
    var p = cairo(Date.now()), y = p.y, m = p.mo - (offset || 0);
    while (m < 0) { m += 12; y--; }
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), from = y + '-' + pad2(m + 1) + '-01', to = y + '-' + pad2(m + 1) + '-' + pad2(last);
    return { from: from, to: to < fDate(Date.now()) ? to : fDate(Date.now()), label: y + '-' + pad2(m + 1) };
  }
  // monthly attendance in the employee profile
  function attendanceCard(w) {
    var off = 0;
    var c = card('الحضور والانصراف', { icon: 'clock', sub: shiftName(w.shift) + ' · ' + shiftHours(w.shift) });
    var monthSel = select([[0, 'الشهر الحالي'], [1, 'الشهر الماضي'], [2, 'منذ شهرين']].map(function (x) { return [String(x[0]), x[1]]; }), '0', function (x) { off = +x; draw(); });
    var exp = h('button', { class: 'btn btn--xs', onclick: function () { var r = monthRange(off); exportAttendance(r.from, r.to, { worker: w.id }, 'EGIC-attendance_' + w.id + '_' + r.label + '.csv'); } }, icon('download'), 'Excel');
    c.head.querySelector('.card-actions').appendChild(monthSel); c.head.querySelector('.card-actions').appendChild(exp);
    var body = h('div'); c.body.appendChild(body);
    function draw() {
      var r = monthRange(off);
      API.get('attendance/range', { from: r.from, to: r.to, worker: w.id }).then(function (a) {
        clear(body);
        var s = a.summary, ks = h('div', { class: 'grid g-4', style: { marginBottom: '12px' } });
        [['أيام حضور', s.present + ' / ' + s.days, 'check'], ['غياب', s.absent, 'alert'], ['تأخير', s.late + ' مرة · ' + hm(s.lateMin), 'clock'], ['ساعات العمل', hm(s.workedMin), 'workers']].forEach(function (k) { ks.appendChild(stat(k[0], String(k[1]), null, { icon: k[2] })); });
        body.appendChild(ks);
        body.appendChild(table([
          { t: 'اليوم', f: function (o) { return h('span', { class: 'mono', text: o.day }); } },
          { t: 'الحضور', f: function (o) { return o.firstTs ? h('span', { class: 'mono', text: fHM(o.firstTs) }) : h('span', { class: 'muted', text: '—' }); } },
          { t: 'الانصراف', f: function (o) { return o.lastTs && o.status === 'OUT' && !o.missingOut ? h('span', { class: 'mono', text: fHM(o.lastTs) }) : o.status === 'IN' ? h('span', { class: 'muted', text: 'آخر ظهور ' + fHM(o.lastTs) }) : h('span', { class: 'muted', text: '—' }); } },
          { t: 'المدة', f: function (o) { return o.firstTs ? h('span', { class: 'mono', text: hm(o.workedMin) }) : ''; } },
          { t: 'الحالة', f: attBadges }
        ], a.rows.slice().reverse(), { maxH: '360px', empty: 'لا توجد أيام في هذه الفترة' }));
      });
    }
    draw();
    return c;
  }
  function exportAttendance(from, to, q, name) {
    API.get('attendance/range', Object.assign({ from: from, to: to }, q || {})).then(function (a) {
      var rows = [['التاريخ', 'كود الموظف', 'الاسم', 'القسم', 'الوظيفة', 'الوردية', 'بداية الوردية', 'نهاية الوردية', 'الحضور', 'الانصراف', 'مدة العمل (ساعة:دقيقة)', 'الحالة', 'تأخير (دقيقة)', 'انصراف مبكر (دقيقة)', 'إضافي (دقيقة)', 'كاميرا الحضور']];
      a.rows.forEach(function (o) {
        var st = (ATT_STATUS[o.status] || [o.status])[0] + (o.late ? ' · متأخر' : '') + (o.early ? ' · انصراف مبكر' : '') + (o.missingOut ? ' · بدون انصراف' : '');
        rows.push([o.day, o.workerId, o.workerName, o.dept, o.role, shiftName(o.shift), fHM(o.start), fHM(o.end), o.firstTs ? fHM(o.firstTs) : '', o.firstTs && o.status === 'OUT' && !o.missingOut ? fHM(o.lastTs) : '', o.firstTs ? hm(o.workedMin) : '', st, o.firstTs ? o.lateMin : '', o.firstTs ? o.earlyMin : '', o.firstTs ? o.overtimeMin : '', o.firstCam || '']);
      });
      downloadCsv(name || ('EGIC-attendance_' + from + '_' + to + '.csv'), rows);
      toast('تم تصدير الحضور', a.rows.length + ' سطر · يفتح في Excel');
    });
  }
  function deleteWorker(w) {
    if (!window.confirm('حذف ملف «' + w.name + '» نهائيًا؟ هيتمسح كمان بصمة الوجه وسجل الحضور بتاعه.')) return;
    var p = API.state.mode === 'server' ? window.EGICLive.adminPost('workers/' + encodeURIComponent(w.id) + '/delete') : API.post('workers/' + encodeURIComponent(w.id) + '/delete');
    p.then(function () { toast('تم حذف الموظف', w.name); navigate('#/workers'); }).catch(function (e) { toast('تعذر الحذف', e.message, { kind: 'critical' }); });
  }
  function groupIncidents(evs) {
    var out = [], map = {};
    evs.forEach(function (e) { if (e.incident) { if (!map[e.incident]) { map[e.incident] = []; out.push(map[e.incident]); } map[e.incident].push(e); } else out.push([e]); });
    return out;
  }
  function topType(byType) { var k = Object.keys(byType || {}).sort(function (a, b) { return byType[b] - byType[a]; })[0]; return k ? S.meta.types[k].ar : '—'; }
  // create (w = null) or edit an employee
  function editProfile(w, done) {
    var isNew = !w; w = w || { siteId: S.site !== 'ALL' ? S.site : 'PLT-01', shift: 'A' };
    var code = h('input', { class: 'input mono', dir: 'ltr', value: w.id || '', placeholder: 'تلقائي لو فاضي', disabled: !isNew });
    var name = h('input', { class: 'input', value: w.name || '' });
    var dept = h('input', { class: 'input', value: w.dept && w.dept !== 'غير محدد' ? w.dept : '', placeholder: 'مثال: الإنتاج' });
    var role = h('input', { class: 'input', value: w.role && w.role !== 'موظف' ? w.role : '', placeholder: 'مثال: مشغل ماكينة' });
    var phone = h('input', { class: 'input mono', dir: 'ltr', type: 'tel', value: w.phone || '', placeholder: '01xxxxxxxxx' });
    var shiftSel = select(Object.keys(S.meta.shifts).map(function (k) { return [k, shiftName(k) + ' (' + shiftHours(k) + ')']; }), w.shift || 'A', function () { });
    var siteSel = select(S.meta.sites.map(function (s) { return [s.id, s.name]; }), w.siteId, function () { });
    var msg = h('div', { style: { fontSize: '12.5px', color: '#ff9b9b', minHeight: '16px' } });
    var enrollAfter = h('input', { type: 'checkbox', checked: true });
    function save() {
      var nm = name.value.trim(), id = code.value.trim();
      if (!nm) { msg.textContent = 'اكتب اسم الموظف.'; return; }
      if (isNew && id && !/^[A-Za-z0-9_-]{1,32}$/.test(id)) { msg.textContent = 'الكود حروف إنجليزي وأرقام و - فقط.'; return; }
      var check = isNew && id ? API.get('workers/' + encodeURIComponent(id)).then(function () { throw new Error('الكود ' + id + ' مستخدم لموظف تاني'); }, function () { }) : Promise.resolve();
      check.then(function () {
        return API.post('workers', { id: isNew ? (id || undefined) : w.id, name: nm, dept: dept.value.trim() || 'غير محدد', role: role.value.trim() || 'موظف', phone: phone.value.trim(), shift: shiftSel.value, siteId: siteSel.value });
      }).then(function (saved) {
        closeModal(); toast(isNew ? 'تم إضافة الموظف' : 'تم حفظ الملف', saved.name + ' · ' + saved.id);
        if (done) done(saved);
        if (isNew && enrollAfter.checked) setTimeout(function () { window.EGICLive.enrollDialog(saved.id, function () { route(); }); }, 250);
      }).catch(function (e) { msg.textContent = e.message; });
    }
    var body = h('div', { style: { display: 'grid', gap: '12px' } },
      h('div', { class: 'grid g-2', style: { gap: '10px' } }, h('label', { class: 'field' }, h('span', { text: 'كود الموظف' }), code), h('label', { class: 'field' }, h('span', { text: 'الاسم *' }), name)),
      h('div', { class: 'grid g-2', style: { gap: '10px' } }, h('label', { class: 'field' }, h('span', { text: 'القسم' }), dept), h('label', { class: 'field' }, h('span', { text: 'الوظيفة' }), role)),
      h('div', { class: 'grid g-2', style: { gap: '10px' } }, h('label', { class: 'field' }, h('span', { text: 'الموبايل' }), phone), h('label', { class: 'field' }, h('span', { text: 'الوردية' }), shiftSel)),
      h('label', { class: 'field' }, h('span', { text: 'الموقع' }), siteSel),
      isNew ? h('label', { class: 'switch' }, enrollAfter, 'سجّل بصمة الوجه بعد الحفظ مباشرة') : null,
      msg,
      h('div', { style: { display: 'flex', gap: '8px' } }, h('button', { class: 'btn btn--primary', text: isNew ? 'إضافة الموظف' : 'حفظ', onclick: save }), h('button', { class: 'btn', text: 'إلغاء', onclick: closeModal })));
    openModal(isNew ? 'إضافة موظف جديد' : 'تعديل ملف الموظف · ' + w.id, body);
    setTimeout(function () { (isNew ? code : name).focus(); }, 50);
  }

  /* ------------------------------------------------------------------ */
  /* VIEW: BBS                                                            */
  /* ------------------------------------------------------------------ */
  register('bbs', function (v) {
    var dim = 'dept';
    v.appendChild(viewHead('محرك السلوك BBS', 'من «كاميرا ← إنذار» إلى «حدث ← تصنيف ← مؤشر ← اتجاه» · 30 يومًا', [h('span', { class: 'tag-demo', text: 'ILLUSTRATIVE DATA' })]));
    var ks = h('div', { class: 'grid g-4' }); v.appendChild(ks);
    API.get('summary', { site: S.site }).then(function (s) {
      [['مؤشر BBS', num(s.bbsScore, 1), '0.4×امتثال + 0.3×سلوك آمن + 0.2×إغلاق + 0.1×استجابة', 'bbs'], ['معدل السلوك الخطر', num(s.atRiskPer1k, 2), 'حدث لكل 1,000 ملاحظة · 24 س', 'alert'], ['معدل الإغلاق', num(s.resolutionRate, 1) + '%', 'أحداث 7 أيام', 'check'], ['امتثال معدات الوقاية', num(s.compliance, 1) + '%', 'آخر 24 ساعة', 'helmet']].forEach(function (k) { var c = card(null); c.body.style.padding = '0'; c.body.appendChild(stat(k[0], k[1], k[2], { icon: k[3] })); ks.appendChild(c); });
    });
    var g = h('div', { class: 'grid g-main' }); v.appendChild(g);
    var drill = card('التحليل حسب البُعد', { sub: 'القسم ← الوردية ← الموقع ← المنطقة ← السلوك', actions: [seg([['dept', 'القسم'], ['shift', 'الوردية'], ['site', 'الموقع'], ['zone', 'المنطقة'], ['behavior', 'السلوك']], 'dept', function (d) { dim = d; load(); })] });
    var side = card('السلوك الآمن مقابل الخطر', { sub: 'نسبة الملاحظات · 30 يومًا' });
    g.appendChild(drill); g.appendChild(side);
    var trend = card('اتجاه الأحداث الأسبوعي', { sub: 'آخر 4 أسابيع — للتعلم والتحسين المستمر' }); v.appendChild(trend);
    function load() {
      API.get('bbs', { site: S.site, dim: dim }).then(function (b) {
        clear(drill.body);
        C.bars(drill.body, { horizontal: true, items: b.items.slice(0, 10).map(function (x) { return { label: x.label, value: x.events, extra: [{ label: 'حرجة', value: String(x.critical) }] }; }), valueLabel: 'أحداث', color: 'var(--s3)', labelWidth: 170 });
        clear(side.body);
        var tot = b.safeObs + b.atRiskObs, safeP = tot ? b.safeObs / tot * 100 : 0;
        side.body.appendChild(h('div', { style: { display: 'grid', gap: '14px' } },
          h('div', { style: { display: 'flex', height: '14px', borderRadius: '7px', overflow: 'hidden', gap: '2px' } }, h('i', { style: { width: safeP + '%', background: 'var(--good)' } }), h('i', { style: { flex: 1, background: 'var(--critical)' } })),
          h('dl', { class: 'kv' }, h('dt', null, h('span', { class: 'dot', style: { background: 'var(--good)', marginInlineEnd: '6px' } }), 'سلوك آمن'), h('dd', { class: 'mono', text: num(b.safeObs, 0) + ' · ' + num(safeP, 1) + '%' }), h('dt', null, h('span', { class: 'dot', style: { background: 'var(--critical)', marginInlineEnd: '6px' } }), 'سلوك خطر'), h('dd', { class: 'mono', text: num(b.atRiskObs, 0) + ' · ' + num(100 - safeP, 1) + '%' })),
          h('p', { class: 'muted', style: { margin: 0, fontSize: '12.5px' } }, 'الهدف من BBS تحسين السلوك على مستوى القسم والوردية والمنطقة، وليس معاقبة الأفراد. المؤشرات تدعم منظومة ISO 45001 القائمة لدى EGIC.')));
        clear(trend.body);
        C.bars(trend.body, { items: b.weeks.map(function (w, i) { return { label: 'أسبوع ' + (i + 1), value: w }; }), height: 190, valueLabel: 'أحداث', showValues: true, color: 'var(--s2)' });
      });
    }
    load();
  });

  /* ------------------------------------------------------------------ */
  /* VIEW: Reports                                                        */
  /* ------------------------------------------------------------------ */
  register('reports', function (v) {
    v.appendChild(viewHead('التقارير', 'تقارير امتثال مُعلَّمة بهوية EGIC · PDF للطباعة و CSV لـ Excel'));
    var g = h('div', { class: 'grid g-main-r' }); v.appendChild(g);
    var form = card('إنشاء تقرير', { icon: 'reports' });
    var from = h('input', { class: 'input', type: 'date', value: fDate(Date.now() - 6 * 864e5) }), to = h('input', { class: 'input', type: 'date', value: fDate(Date.now()) });
    var fmt = 'PDF', siteSel = select([['ALL', 'كل المواقع']].concat(S.meta.sites.map(function (s) { return [s.id, s.name]; })), S.site, function () { });
    form.body.appendChild(h('div', { style: { display: 'grid', gap: '12px' } },
      h('div', { class: 'grid g-2', style: { gap: '10px' } }, h('label', { class: 'field' }, h('span', { text: 'من' }), from), h('label', { class: 'field' }, h('span', { text: 'إلى' }), to)),
      h('label', { class: 'field' }, h('span', { text: 'الصيغة' }), seg([['PDF', 'PDF'], ['Excel', 'Excel (CSV)']], 'PDF', function (x) { fmt = x; })),
      h('label', { class: 'field' }, h('span', { text: 'الموقع' }), siteSel),
      h('button', { class: 'btn btn--primary', onclick: function () { makeReport(from.value, to.value, siteSel.value, fmt); } }, icon('download'), 'إنشاء التقرير'),
      h('div', { style: { borderTop: '1px solid var(--line-1)', paddingTop: '12px', display: 'grid', gap: '10px' } }, h('div', { class: 'card-t', text: 'التقارير الآلية' }), h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: true }), 'يومي — بالبريد لمديري السلامة'), h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: true }), 'أسبوعي — ملخص BBS للإدارة العليا'), h('label', { class: 'switch' }, h('input', { type: 'checkbox' }), 'شهري — مؤشرات ISO 45001'))));
    g.appendChild(form);
    var list = card('التقارير المُنشأة', { flush: true }); g.appendChild(list);
    function load() { API.get('reports').then(function (r) { clear(list.body); list.body.appendChild(table([{ t: 'الملف', f: function (x) { return h('div', null, h('div', { class: 'mono strong', style: { fontSize: '12px' }, text: x.name }), h('div', { class: 'muted', style: { fontSize: '11.5px' }, text: fDT(x.ts) + ' · ' + x.sizeKb + ' KB · ' + x.scope })); } }, { t: 'النوع', f: function (x) { return h('span', { class: 'chip', text: x.auto ? (x.kind === 'weekly' ? 'آلي أسبوعي' : 'آلي يومي') : 'يدوي' }); } }, { t: '', f: function (x) { return h('button', { class: 'btn btn--xs', text: 'فتح', onclick: function (ev) { ev.stopPropagation(); var d = x.from ? [x.from, x.to] : [fDate(x.ts - 864e5), fDate(x.ts - 864e5)]; makeReport(d[0], d[1], 'ALL', x.format === 'Excel' ? 'Excel' : 'PDF', true); } }); } }], r.items, { maxH: '520px' })); }); }
    load();
    function makeReport(f, t, site, format, silent) {
      var t0 = new Date(f + 'T00:00:00+03:00').getTime(), t1 = new Date(t + 'T23:59:59+03:00').getTime();
      Promise.all([API.get('events', { site: site, limit: 500, since: t0 }), API.get('summary', { site: site }), API.get('sites/stats')]).then(function (res) {
        var evs = res[0].items.filter(function (e) { return e.ts <= t1; }), s = res[1];
        if (format === 'Excel') {
          var rows = [['event_id', 'timestamp', 'type', 'severity', 'status', 'site', 'zone', 'worker', 'source']];
          evs.forEach(function (e) { rows.push([e.id, fDate(e.ts) + ' ' + fTime(e.ts), e.typeAr, e.sevAr, AR_STATUS[e.status], e.siteName, e.zoneName, e.workerName || '', e.source]); });
          downloadCsv('EGIC-Safety_' + f + '_' + t + '_' + site + '.csv', rows);
        } else printReport(f, t, site, evs, s, res[2]);
        if (!silent) API.post('reports', { from: f, to: t, site: site, siteName: site === 'ALL' ? 'كل المواقع' : siteName(site), format: format, kind: 'Safety' }).then(load);
      });
    }
  });
  function printReport(f, t, site, evs, s, sites) {
    var w = window.open('', '_blank');
    if (!w) { toast('يرجى السماح بالنوافذ المنبثقة لفتح التقرير', ''); return; }
    var byType = {}; evs.forEach(function (e) { byType[e.typeAr] = (byType[e.typeAr] || 0) + 1; });
    var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var logo = new URL('assets/egic-logo.png', location.href).href;
    var html = '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>EGIC Safety Report ' + esc(f) + '</title><style>body{font-family:"Segoe UI",Tahoma,sans-serif;color:#111;margin:32px;}h1{margin:0;font-size:22px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #126D37;padding-bottom:14px;margin-bottom:18px}header img{height:74px}.meta{color:#555;font-size:12px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}.k{border:1px solid #ddd;border-radius:8px;padding:10px}.k b{display:block;font-size:22px;color:#126D37}table{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:10px}th,td{border-bottom:1px solid #e3e3e3;padding:6px;text-align:right}th{background:#f3f6f4}footer{margin-top:24px;border-top:1px solid #ddd;padding-top:10px;font-size:11px;color:#666;display:flex;justify-content:space-between}.pw{letter-spacing:.12em;font-weight:700;color:#111}.pw span{color:#F79224}.note{font-size:11px;color:#8a4c00;border:1px dashed #F79224;padding:6px 10px;border-radius:6px;margin:10px 0}</style></head><body>' +
      '<header><div><h1>تقرير السلامة والامتثال · EGIC</h1><div class="meta">الفترة: ' + esc(f) + ' → ' + esc(t) + ' · النطاق: ' + esc(site === 'ALL' ? 'كل المواقع' : siteName(site)) + ' · أُنشئ: ' + esc(fDT(Date.now())) + '</div></div><img src="' + logo + '" alt="EGIC"></header>' +
      '<div class="note">بيئة عرض: البيانات التشغيلية محاكاة، والأحداث الموسومة «LIVE» مصدرها كشف حقيقي بالكاميرا.</div>' +
      '<div class="kpis"><div class="k">مؤشر الامتثال<b>' + esc(num(s.compliance, 1)) + '%</b></div><div class="k">أحداث الفترة<b>' + evs.length + '</b></div><div class="k">مؤشر BBS<b>' + esc(num(s.bbsScore, 1)) + '</b></div><div class="k">معدل الإغلاق<b>' + esc(num(s.resolutionRate, 1)) + '%</b></div></div>' +
      '<h3>الأحداث حسب النوع</h3><table><tr><th>النوع</th><th>العدد</th></tr>' + Object.keys(byType).sort(function (a, b) { return byType[b] - byType[a]; }).map(function (k) { return '<tr><td>' + esc(k) + '</td><td>' + byType[k] + '</td></tr>'; }).join('') + '</table>' +
      '<h3>المواقع</h3><table><tr><th>الموقع</th><th>الامتثال</th><th>مخالفات نشطة</th><th>أحداث 7 أيام</th></tr>' + sites.map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td>' + esc(num(x.compliance, 1)) + '%</td><td>' + x.active + '</td><td>' + x.events7 + '</td></tr>'; }).join('') + '</table>' +
      '<h3>سجل الأحداث (أحدث 150)</h3><table><tr><th>الرقم</th><th>التوقيت</th><th>النوع</th><th>الخطورة</th><th>الموقع</th><th>العامل</th><th>الحالة</th></tr>' + evs.slice(0, 150).map(function (e) { return '<tr><td>' + esc(e.id) + '</td><td>' + esc(fDate(e.ts) + ' ' + fTime(e.ts)) + '</td><td>' + esc(e.typeAr) + '</td><td>' + esc(e.sevAr) + '</td><td>' + esc(e.siteName) + '</td><td>' + esc(e.workerName || '—') + '</td><td>' + esc(AR_STATUS[e.status]) + '</td></tr>'; }).join('') + '</table>' +
      '<footer><span>EGIC · AI Safety &amp; Smart Access Platform</span><span class="pw">POWERED BY DELMON <span>&amp;</span> DEV SMART X</span></footer><script>setTimeout(function(){print()},600)<\/script></body></html>';
    w.document.open(); w.document.write(html); w.document.close();
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                 */
  /* ------------------------------------------------------------------ */
  function setSite(id) { S.site = id; $('#siteSel').value = id; route(); }
  function applyTheme() {
    var t = document.documentElement.getAttribute('data-theme') || 'dark';
    clear($('#themeBtn')).appendChild(icon(t === 'dark' ? 'sun' : 'moon'));
  }
  /* ---------- hazard alarm: fire / smoke / smoking — siren + flashing overlay on every connected screen ---------- */
  var HZ = {
    FIRE_DETECTED: { ic: '🔥', title: 'إنذار حريق', en: 'FIRE ALARM', amber: false, siren: 'fire' },
    SMOKE_DETECTED: { ic: '💨', title: 'إنذار دخان — احتمال حريق', en: 'SMOKE ALARM', amber: true, siren: 'smoke' },
    SMOKING_DETECTED: { ic: '🚬', title: 'تدخين داخل المنشأة', en: 'SMOKING DETECTED', amber: true, siren: 'chime' },
    FALL: { ic: '🚑', title: 'سقوط شخص', en: 'PERSON FALL', amber: false, siren: 'fire' },
    SOS_GESTURE: { ic: '🆘', title: 'إشارة استغاثة', en: 'SOS GESTURE', amber: false, siren: 'fire' }
  };
  var EGICAlarm = (function () {
    var ctx = null, timer = null, stopAt = 0, shown = {}, current = null, pill = null;
    function audio() { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) { ctx = null; } return ctx; }
    function armed() { return !!(ctx && ctx.state === 'running'); }
    // Browsers block sound until a user gesture; on an unattended screen the siren would be SILENT.
    // Keep trying on every interaction (not once), and show an unmissable pill until audio is actually running.
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (t) { document.addEventListener(t, function () { audio(); updatePill(); }, { passive: true }); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { audio(); updatePill(); } });
    function unlock() { audio(); try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) { } updatePill(); }
    function updatePill() {
      if (!armed() && !pill && document.body) {
        pill = h('button', { type: 'button', title: 'المتصفح بيمنع صوت الإنذار لحد ما تضغط مرة', style: { position: 'fixed', zIndex: '99999', insetInlineEnd: '16px', bottom: '16px', background: '#e5484d', color: '#fff', border: 'none', borderRadius: '999px', padding: '11px 18px', fontWeight: '700', fontSize: '13px', boxShadow: '0 6px 22px rgba(0,0,0,.45)', cursor: 'pointer' } }, '🔊 فعّل صوت الإنذار');
        pill.addEventListener('click', function () {
          audio(); if (ctx && ctx.state !== 'running') try { ctx.resume(); } catch (e) { }
          setTimeout(function () { try { var t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 880; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.31); } catch (e) { } try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) { } updatePill(); }, 60);
        });
        document.body.appendChild(pill);
      } else if (armed() && pill) { pill.remove(); pill = null; }
    }
    setInterval(updatePill, 3000); setTimeout(function () { audio(); updatePill(); }, 800);
    function tone(f0, f1, t, dur, type, vol) {
      var o = ctx.createOscillator(), g = ctx.createGain(), v = vol || 0.22;
      o.type = type || 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.03); g.gain.setValueAtTime(v, t + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    function cycle(kind) {
      if (!audio()) return;
      var t = ctx.currentTime;
      if (kind === 'fire') { tone(650, 1250, t, 0.45); tone(1250, 650, t + 0.45, 0.45); } // wailing siren
      else if (kind === 'smoke') { tone(880, 880, t, 0.22, 'square', 0.16); tone(880, 880, t + 0.4, 0.22, 'square', 0.16); }
      else { tone(988, 988, t, 0.14, 'sine', 0.18); tone(784, 784, t + 0.18, 0.2, 'sine', 0.18); }
    }
    function silence() { if (timer) clearInterval(timer); timer = null; try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) { } }
    function hide() { silence(); $('#hzAlarm').classList.remove('is-on'); current = null; }
    function show(e, opts) {
      var cfg = HZ[e.type]; if (!cfg) return;
      var key = e.id || e.incident || (e.type + ':' + Math.round((e.ts || Date.now()) / 20000));
      if (shown[key]) return; shown[key] = Date.now();
      opts = opts || {};
      current = e;
      updatePill();
      var box = $('#hzAlarm');
      box.classList.toggle('is-amber', cfg.amber);
      $('#hzIc').textContent = cfg.ic;
      $('#hzTitle').textContent = cfg.title + ' · ' + cfg.en;
      $('#hzSub').textContent = [e.siteName, (e.zoneName || '').split(' — ')[0], e.cameraId, fTime(e.ts || Date.now())].filter(Boolean).join(' · ');
      var src = opts.img || (e.evidence && e.evidence.image ? evidenceSrc(e, 640) : '');
      if (src) $('#hzImg').src = src; else $('#hzImg').removeAttribute('src');
      var meta = $('#hzMeta'); clear(meta);
      [e.id, 'ثقة ' + Math.round((e.conf || 0.9) * 100) + '%', e.sev, e.evidence && e.evidence.model, e.workerName].filter(Boolean).forEach(function (x) { meta.appendChild(h('span', { text: x })); });
      box.classList.add('is-on');
      silence(); cycle(cfg.siren);
      var period = cfg.siren === 'fire' ? 900 : cfg.siren === 'smoke' ? 1500 : 2500;
      stopAt = Date.now() + (cfg.siren === 'chime' ? 8000 : 45000);
      timer = setInterval(function () { if (Date.now() > stopAt) return silence(); cycle(cfg.siren); }, period);
      try { if (navigator.vibrate) navigator.vibrate(cfg.siren === 'chime' ? [200, 100, 200] : [600, 200, 600, 200, 600, 200, 600]); } catch (x) { }
      if (cfg.siren === 'chime') setTimeout(function () { if (current === e) hide(); }, 12000);
      try { if (document.hidden && window.Notification && Notification.permission === 'granted') new Notification(cfg.title, { body: $('#hzSub').textContent, tag: key, requireInteraction: true }); } catch (x) { }
    }
    return { show: show, hide: hide, current: function () { return current; }, unlock: unlock, armed: armed };
  })();
  window.EGICAlarm = EGICAlarm;

  /* ---------- wipe test data (server: evidence + journal · browser: local copies) ---------- */
  function resetDialog() {
    var people = h('input', { type: 'checkbox' });
    var msg = h('div', { class: 'muted', style: { fontSize: '12.5px' } });
    var go = h('button', { class: 'btn btn--primary', text: 'مسح البيانات نهائيًا' });
    openModal('🧹 مسح بيانات التجارب', h('div', { style: { display: 'grid', gap: '12px' } },
      h('div', { style: { lineHeight: '1.8' } }, 'هيتم مسح كل اللي اتسجل من التجارب: ', h('b', { text: 'صور الأدلة، أحداث الكشف الحي (حريق · تدخين · PPE · سلوك)، وقراءات اللوحات' }), '. البيانات التوضيحية المولّدة هتفضل زي ما هي.'),
      h('div', { class: 'muted', style: { fontSize: '12.5px' }, text: 'الموظفون وبصمات الوجه وسجل الحضور بيفضلوا محفوظين.' }),
      h('label', { class: 'switch' }, people, 'امسح كمان كل الموظفين وبصمات الوجه وسجل الحضور (لا يمكن التراجع)'),
      msg, h('div', { class: 'row' }, go, h('button', { class: 'btn', text: 'إلغاء', onclick: closeModal }))));
    go.addEventListener('click', function () {
      go.disabled = true; msg.textContent = 'جارٍ المسح…';
      var local = function () { return API.resetLocal(people.checked); };
      if (API.state.mode !== 'server') { local().then(function () { location.reload(); }); return; }
      var send = function (token) {
        return fetch(API.state.base + '/api/v1/admin/reset', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'X-Admin-Token': token } : {}), body: JSON.stringify({ confirm: 'RESET', people: people.checked }) });
      };
      var token = null; try { token = sessionStorage.getItem('egic-admin-token'); } catch (e) { }
      send(token).then(function (r) {
        if (r.status === 401) { token = window.prompt('رمز الإدارة (ADMIN_TOKEN):'); if (!token) throw new Error('مطلوب رمز الإدارة'); try { sessionStorage.setItem('egic-admin-token', token); } catch (e) { } return send(token); }
        return r;
      }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(function (j) {
        return local().then(function () { msg.textContent = 'تم المسح: ' + j.files + ' صورة · ' + j.records + ' سجل. جارٍ إعادة التحميل…'; });
      }).catch(function (e) { go.disabled = false; msg.textContent = 'تعذر المسح: ' + e.message; });
    });
  }

  function boot() {
    clear($('#fsBtn')).appendChild(icon('full'));
    clear($('#bellBtn')).appendChild(icon('bell')); $('#bellBtn').appendChild(h('span', { class: 'count', id: 'bellCount', text: '0' }));
    applyTheme();
    $('#themeBtn').addEventListener('click', function () { var t = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light'; document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('egic-theme', t); } catch (e) { } applyTheme(); route(); });
    $('#fsBtn').addEventListener('click', function () { try { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); } catch (e) { toast('ملء الشاشة غير متاح هنا', 'استخدم F11'); } });
    $('#menuBtn').addEventListener('click', function () { $('#app').classList.toggle('nav-open'); });
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#modalClose').addEventListener('click', closeModal);
    $('#scrim').addEventListener('click', function () { closeDrawer(); closeModal(); });
    $('#bellBtn').addEventListener('click', function () { S.unread = 0; setBell(0); navigate('#/events'); });
    $('#demoBtn').addEventListener('click', function () { API.post('demo', {}); toast('تشغيل سلسلة الحدث', 'كاميرا ← رصد ← تصنيف ← خطورة ← دليل ← إشعار ← حادثة ← BBS'); });
    $('#sosAck').addEventListener('click', function () { $('#sos').classList.remove('is-on'); });
    $('#resetBtn').addEventListener('click', resetDialog);
    $('#hzAck').addEventListener('click', function () { var e = EGICAlarm.current(); EGICAlarm.hide(); if (e && e.id) API.post('events/' + e.id + '/action', { action: 'ack', note: 'تم استلام الإنذار من لوحة القيادة' }).catch(function () { }); });
    $('#hzView').addEventListener('click', function () { var e = EGICAlarm.current(); EGICAlarm.hide(); if (e) openEvent(e); });
    try { if (window.Notification && Notification.permission === 'default') document.addEventListener('pointerdown', function () { Notification.requestPermission(); }, { once: true }); } catch (e) { }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeDrawer(); closeModal(); } });
    setBell(0);
    API.init().then(function (mode) {
      return Promise.all([API.get('meta'), API.get('cameras'), API.get('system')]).then(function (r) {
        S.meta = r[0]; S.cams = {}; r[1].items.forEach(function (c) { S.cams[c.id] = c; });
        var ss = $('#siteSel'); clear(ss); ss.appendChild(h('option', { value: 'ALL', text: 'كل المواقع (9)' }));
        S.meta.sites.forEach(function (s) { ss.appendChild(h('option', { value: s.id, text: s.name + ' · ' + s.sub })); });
        ss.addEventListener('change', function () { setSite(ss.value); });
        renderStatus(r[2]);
        API.on('health', function (hs) { renderStatus(hs); });
        setInterval(function () { var c = $('#clock'); if (c) { clear(c); c.appendChild(h('b', { text: fTime(Date.now()) })); c.appendChild(document.createTextNode(' CAIRO')); } }, 1000);
        API.on('event', function (e) {
          if (e.sev === 'CRITICAL' || String(e.source).indexOf('live') === 0) { S.unread++; setBell(S.unread); }
          if (String(e.source).indexOf('live') === 0 && S.route !== 'live') toast('كشف حي: ' + e.typeAr, (e.workerName || 'غير محدد') + ' · ' + e.cameraId, { kind: 'live', img: evidenceSrc(e, 200), action: ['عرض', function () { openEvent(e); }] });
          else if (e.sev === 'CRITICAL' && S.route !== 'live') toast(e.typeAr, e.siteName + ' · ' + (e.zoneName || '').split(' — ')[0], { kind: 'critical', img: evidenceSrc(e, 200), action: ['عرض', function () { openEvent(e); }] });
          if (HZ[e.type]) EGICAlarm.show(e);
          if (e.type === 'SOS_GESTURE') { $('#sosImg').src = evidenceSrc(e, 240); $('#sosSub').textContent = e.siteName + ' · ' + e.zoneName + ' · ' + fTime(e.ts) + (e.workerName ? ' · ' + e.workerName : ''); $('#sos').classList.add('is-on'); setTimeout(function () { $('#sos').classList.remove('is-on'); }, 15000); }
        });
        API.on('trace', function (t) { if (t.step === 'DONE') toast('اكتملت سلسلة الحدث', 'تم تحديث لوحة القيادة ومؤشرات BBS', { action: t.eventId ? ['عرض الحدث', function () { API.get('events/' + t.eventId).then(openEvent); }] : null }); });
        API.on('attendance', function (a) { if (a.kind === 'SETTINGS') API.get('meta').then(function (m) { S.meta.shifts = m.shifts; }); });
        API.on('reset', function (r) { toast('تم مسح بيانات التجارب', (r.files || 0) + ' صورة · ' + (r.records || 0) + ' سجل — جارٍ إعادة التحميل', { ms: 2500 }); setTimeout(function () { location.reload(); }, 1500); });
        API.on('connection', function (c) { if (!c.connected) toast('انقطع الاتصال بالخادم', 'إعادة المحاولة تلقائيًا…', { kind: 'critical' }); });
        window.addEventListener('hashchange', route);
        route();
        if (mode === 'embedded' && /^https?:$/.test(location.protocol) === false) setTimeout(function () { toast('وضع المحرك المدمج', 'لتشغيل الخادم الحي: node server/server.js'); }, 1500);
      });
    }).catch(function (e) { console.error(e); clear($('#view')).appendChild(h('div', { class: 'empty', text: 'تعذر تشغيل المنصة: ' + e.message })); });
  }

  window.EGICUI = { h: h, $: $, clear: clear, icon: icon, card: card, stat: stat, table: table, seg: seg, select: select, chartCard: chartCard, toast: toast, openDrawer: openDrawer, closeDrawer: closeDrawer, openModal: openModal, closeModal: closeModal, imageModal: imageModal, openEvent: openEvent, register: register, viewHead: viewHead, navigate: navigate, onCleanup: onCleanup, every: every, sub: sub, S: S, fTime: fTime, fHM: fHM, fDate: fDate, fDT: fDT, ago: ago, num: num, sevBadge: sevBadge, statusBadge: statusBadge, decBadge: decBadge, srcTag: srcTag, evidenceSrc: evidenceSrc, siteName: siteName, initials: initials, downloadCsv: downloadCsv, debounce: debounce, AR_DEC: AR_DEC, AR_STATUS: AR_STATUS, route: route, shiftName: shiftName, shiftHours: shiftHours, attBadges: attBadges, hm: hm, exportAttendance: exportAttendance, editProfile: editProfile, monthRange: monthRange };
  document.addEventListener('DOMContentLoaded', boot);
})();
