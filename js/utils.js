/* RCS Tracker — formatting helpers and data normalisation. Plain script (no modules) so it also works on GitHub Pages without a build; files share the global scope and are loaded in order by index.html. */
'use strict';

/* ================= Helpers ================= */
function $(id) { return document.getElementById(id); }
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function ts(v) { var t = v ? new Date(v).getTime() : NaN; return isNaN(t) ? null : t; }
function pct(a, b) { return b > 0 ? (a / b) * 100 : 0; }
function kfmt(n) {
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}
function fmtExact(v) {
  var t = ts(v); if (t == null) return '';
  return new Date(t).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDay(t) { return new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); }
function rel(v) {
  var t = ts(v); if (t == null) return '—';
  var s = Math.round((Date.now() - t) / 1000);
  if (s < 0) s = 0;
  if (s < 45) return 'just now';
  var m = Math.round(s / 60); if (m < 60) return m + ' min ago';
  var h = Math.round(m / 60); if (h < 24) return h + ' h ago';
  var d = Math.round(h / 24); if (d < 30) return d + ' d ago';
  return fmtExact(v);
}
function relEl(v, prefix, cls) {
  if (!ts(v)) return '<span class="' + (cls || '') + '">' + esc(prefix || '') + '—</span>';
  return '<time class="' + (cls || '') + '" datetime="' + esc(v) + '" data-rel="' + esc(v) + '" data-prefix="' + esc(prefix || '') + '" title="' + esc(fmtExact(v)) + '">' + esc((prefix || '') + rel(v)) + '</time>';
}
function initials(name) {
  var p = String(name || '?').trim().split(/\s+/);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
function objClass(o) { return 'o-' + (OBJECTIVES[o] ? o : 'none'); }
function avatar(m, size) {
  var s = size || 32;
  var name = m ? m.name : '?';
  var img = m && m.avatar_url ? '<img src="' + esc(m.avatar_url) + '" alt="" loading="lazy" onerror="this.remove()">' : '';
  return '<span class="av ' + objClass(m && m.objective) + '" style="--s:' + s + 'px" title="' + esc(name) + '" aria-hidden="true">' + esc(initials(name)) + img + '</span>';
}
function stack(members, max) {
  max = max || 5;
  var h = members.slice(0, max).map(function (m) { return avatar(m, 26); }).join('');
  if (members.length > max) h += '<span class="av" style="--s:26px">+' + (members.length - max) + '</span>';
  return '<span class="stack">' + h + '</span>';
}
function statusChip(st) {
  return '<span class="chip s-' + st + '"><span class="dot' + (st === 'running' ? ' pulse' : '') + '"></span>' + STATUS_LABEL[st] + '</span>';
}
function objChip(o) { return '<span class="chip ' + objClass(o) + '">' + esc(o || '—') + '</span>'; }
function repoUrl() { return S.data && S.data.repo ? 'https://github.com/' + S.data.repo : null; }
function driveUrl() { return (S.data && S.data.drive_url) || null; }
function batchDrive(b) { return b.drive_folder_url || driveUrl(); }
function commitUrl(b) { return b.commit_sha && repoUrl() ? repoUrl() + '/commit/' + encodeURIComponent(b.commit_sha) : null; }
function extLink(url, label, cls) {
  if (!url) return '<span class="' + (cls ? cls + ' ' : '') + 'off" aria-disabled="true" title="Not available">' + esc(label) + ' ↗</span>';
  return '<a class="' + (cls || '') + '" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + ' ↗</a>';
}
function btnLink(url, label) {
  if (!url) return '<span class="btn" aria-disabled="true" title="Not available">' + esc(label) + ' ' + ICON.ext + '</span>';
  return '<a class="btn" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + ' ' + ICON.ext + '</a>';
}

/* Effective status: running but silent for > CONFIG.staleMinutes (45) → stale */
function effStatus(b) {
  var st = STATUSES.indexOf(b.status) >= 0 ? b.status : 'pending';
  if (st === 'running') {
    var u = ts(b.updated_at);
    if (u != null && Date.now() - u > CONFIG.staleMinutes * 60000) st = 'stale';
  }
  return st;
}

/* ================= Data ================= */
function normalize(d) {
  d.members = Array.isArray(d.members) ? d.members : [];
  d.batches = Array.isArray(d.batches) ? d.batches : [];
  d.setup_tasks = Array.isArray(d.setup_tasks) ? d.setup_tasks : [];
  S.memberById = {}; S.batchById = {};
  d.members.forEach(function (m) {
    m.onboarding = m.onboarding || {};
    m.objective = normObjective(m);
    S.memberById[m.id] = m;
  });
  d.batches.forEach(function (b) {
    b.chunks_total = +b.chunks_total || 0;
    b.last_completed_chunk = +b.last_completed_chunk || 0;
    b.prompts_total = +b.prompts_total || 0;
    b.prompts_done = +b.prompts_done || 0;
    if (S.memberById[b.member_id]) b.objective = S.memberById[b.member_id].objective;
    S.batchById[b.batch_id] = b;
  });
  return d;
}
function view() {
  var d = S.data, o = 'All';
  var members = d.members.filter(function (m) { return o === 'All' || m.objective === o; });
  var batches = d.batches.filter(function (b) { return o === 'All' || b.objective === o; });
  batches.forEach(function (b) { b._st = effStatus(b); });
  return { members: members, batches: batches };
}
function countBy(batches) {
  var c = { done: 0, running: 0, failed: 0, stale: 0, pending: 0 };
  batches.forEach(function (b) { c[b._st || effStatus(b)]++; });
  return c;
}
function memberStats(m, all) {
  var mine = all.filter(function (b) { return b.member_id === m.id; });
  mine.forEach(function (b) { b._st = effStatus(b); });
  var c = countBy(mine);
  var last = null, cur = null;
  mine.forEach(function (b) {
    var u = ts(b.updated_at);
    if (u != null && (last == null || u > last.t)) last = { t: u, v: b.updated_at, b: b };
  });
  var active = mine.filter(function (b) { return b._st === 'running'; })[0] || mine.filter(function (b) { return b._st === 'stale'; })[0];
  cur = active || (last && last.b) || null;
  return {
    batches: mine, c: c, total: mine.length, pct: pct(c.done, mine.length),
    lastActive: last ? last.v : null, lastT: last ? last.t : 0, current: cur, currentLive: !!active
  };
}
