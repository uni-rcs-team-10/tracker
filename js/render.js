/* RCS Tracker — section renderers. Plain script (no modules) so it also works on GitHub Pages without a build; files share the global scope and are loaded in order by index.html. */
'use strict';

/* ================= Rendering ================= */
function renderBanner() {
  var errs = S.loadErrors || [];
  $('bannerSlot').innerHTML = errs.length
    ? '<div class="banner" role="status"><span aria-hidden="true">⚠</span> Could not load ' + errs.map(function (f) { return '<span class="mono" style="font-size:12px">data/' + esc(f) + '</span>'; }).join(', ') + ' — those sections may be empty.</div>'
    : '';
}

function renderMeta() {
  $('subtitle').textContent = S.data.subtitle || '';
  [['driveBtn', driveUrl()], ['repoBtn', repoUrl()]].forEach(function (p) {
    var el = $(p[0]);
    if (p[1]) { el.href = p[1]; el.hidden = false; } else { el.removeAttribute('href'); el.hidden = true; }
  });
}
function renderLoadError() {
  renderBanner();
  var msg = '<div class="empty"><strong>No data</strong>data/members.json could not be loaded. Serve this folder over HTTP (not file://) and check the JSON is valid.</div>';
  ['kpis', 'objs', 'teamBody', 'board', 'activityBody', 'failBody', 'setupBody'].forEach(function (id) { $(id).innerHTML = id === 'kpis' || id === 'objs' ? '' : msg; });
  $('synced').textContent = '';
  $('footer').textContent = '';
}
function renderSynced() {
  var el = $('synced'), g = S.data && S.data.generated_at;
  if (!g) { el.textContent = ''; return; }
  el.setAttribute('datetime', g);
  el.setAttribute('data-rel', g);
  el.setAttribute('data-prefix', 'Synced ');
  el.title = 'Data generated ' + fmtExact(g);
  el.textContent = 'Synced ' + rel(g);
}

function renderKPIs(v) {
  var c = countBy(v.batches);
  var total = v.batches.length;
  var pDone = 0, pTot = 0;
  v.batches.forEach(function (b) { pDone += b.prompts_done; pTot += b.prompts_total; });
  var attention = c.failed + c.stale;
  var accepted = v.members.filter(function (m) { return m.onboarding.github_invite === 'accepted'; });
  var pp = pct(pDone, pTot);
  $('kpis').innerHTML =
    '<div class="card kpi"><div class="kpi-label">Batches done</div>' +
      '<div class="kpi-num"><span data-to="' + c.done + '">' + c.done + '</span> <small>/ ' + total + '</small></div>' +
      '<div class="bar thin" style="margin-top:auto"><i style="width:' + pct(c.done, total).toFixed(1) + '%"></i></div></div>' +
    '<div class="card kpi"><div class="kpi-label">Prompts completed</div>' +
      '<div class="kpi-num"><span data-to="' + pp.toFixed(1) + '" data-dec="1">' + pp.toFixed(1) + '</span>%</div>' +
      '<div class="kpi-foot num">' + kfmt(pDone) + ' / ' + kfmt(pTot) + '</div></div>' +
    '<div class="card kpi"><div class="kpi-label"><span class="dot s-running' + (c.running ? ' pulse' : '') + '"></span>Running now</div>' +
      '<div class="kpi-num"><span data-to="' + c.running + '">' + c.running + '</span></div>' +
      '<div class="kpi-foot">' + (c.running ? 'batches active on Kaggle' : 'nothing running') + '</div></div>' +
    '<div class="card kpi' + (attention > 0 ? ' alert' : '') + '"><div class="kpi-label"><span class="dot ' + (attention ? 's-failed' : 's-done') + '"></span>Needs attention</div>' +
      '<div class="kpi-num"><span data-to="' + attention + '">' + attention + '</span></div>' +
      '<div class="kpi-foot">' + c.failed + ' failed · ' + c.stale + ' stale</div></div>' +
    '<div class="card kpi"><div class="kpi-label">Team onboarded</div>' +
      '<div class="kpi-num"><span data-to="' + accepted.length + '">' + accepted.length + '</span> <small>/ ' + v.members.length + ' accepted</small></div>' +
      '<div class="kpi-foot">' + (v.members.length ? stack(v.members, 9) : 'No members in this objective') + '</div></div>';

  if (S.first && !REDUCED) {
    $('kpis').querySelectorAll('[data-to]').forEach(countUp);
  }
}
function countUp(el) {
  var to = parseFloat(el.getAttribute('data-to')) || 0;
  var dec = +(el.getAttribute('data-dec') || 0);
  if (!to) return;
  var t0 = performance.now(), dur = 400;
  function step(t) {
    var k = Math.min(1, (t - t0) / dur);
    var e = 1 - Math.pow(1 - k, 3);
    el.textContent = (to * e).toFixed(dec);
    if (k < 1) requestAnimationFrame(step);
  }
  el.textContent = (0).toFixed(dec);
  requestAnimationFrame(step);
}

function etaText(batches, members) {
  var remaining = batches.filter(function (b) { return b._st !== 'done'; }).length;
  if (!batches.length) return 'No batches yet';
  if (!remaining) return 'Complete';
  var durs = batches.filter(function (b) { return b._st === 'done' && ts(b.started_at) && ts(b.updated_at); })
    .map(function (b) { return ts(b.updated_at) - ts(b.started_at); })
    .filter(function (x) { return x > 0; });
  if (!durs.length) return 'Est. finish: not enough data yet';
  var avg = durs.reduce(function (a, b) { return a + b; }, 0) / durs.length;
  var workers = Math.max(1, members.filter(function (m) { return m.onboarding.kaggle_linked; }).length);
  var eta = Date.now() + (remaining * avg) / workers;
  var hrs = avg / 3600000;
  return 'Est. finish ~' + fmtDay(eta) + ' · avg ' + hrs.toFixed(1) + ' h / batch';
}

function renderObjectives(v) {
  var list = OBJ_ORDER.filter(function (o) { return S.data.members.some(function (m) { return m.objective === o; }); });
  $('objs').style.gridTemplateColumns = list.length === 1 ? '1fr' : '';
  $('objs').innerHTML = list.map(function (o) {
    var bs = S.data.batches.filter(function (b) { return b.objective === o; });
    bs.forEach(function (b) { b._st = effStatus(b); });
    var ms = S.data.members.filter(function (m) { return m.objective === o; });
    var c = countBy(bs), pd = 0, pt = 0;
    bs.forEach(function (b) { pd += b.prompts_done; pt += b.prompts_total; });
    var p = pct(pd, pt), pr = Math.round(p);
    var meta = c.done + '/' + bs.length + ' batches';
    if (c.running) meta += ' · <span style="color:var(--running-t)">' + c.running + ' running</span>';
    if (c.failed) meta += ' · <span style="color:var(--failed-t)">' + c.failed + ' failed</span>';
    if (c.stale) meta += ' · <span style="color:var(--stale-t)">' + c.stale + ' stale</span>';
    return '<div class="card obj ' + objClass(o) + '">' +
      '<div class="ring" style="--p:' + p.toFixed(1) + '" role="img" aria-label="' + pr + '% of prompts complete"><span><b>' + pr + '%</b><em>prompts</em></span></div>' +
      '<div class="obj-body"><div class="obj-title">' + objChip(o) + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(OBJECTIVES[o].name) + '</span></div>' +
      '<div class="obj-desc">' + esc(OBJECTIVES[o].desc) + '</div>' +
      (ms.length ? stack(ms) : '<span class="muted">No members assigned</span>') +
      '<div class="obj-meta num">' + meta + '</div>' +
      '<div class="obj-eta">' + esc(etaText(bs, ms)) + '</div></div></div>';
  }).join('');
}

function ghBadge(s) {
  if (s === 'accepted') return '<span class="badge ok" title="GitHub invite accepted">GitHub ✓</span>';
  if (s === 'pending') return '<span class="badge warn" title="GitHub invite pending">GitHub ⏳</span>';
  return '<span class="badge" title="GitHub invite not sent">GitHub –</span>';
}
function boolBadge(label, ok) {
  return '<span class="badge ' + (ok ? 'ok' : 'bad') + '" title="' + label + (ok ? ' connected' : ' not connected') + '">' + label + ' ' + (ok ? '✓' : '✗') + '</span>';
}

function lastName(n) { var p = String(n || '').trim().split(/\s+/); return p[p.length - 1] || ''; }
/* Rank: most completed batches first; ties broken by last name, then full name. */
function rankMembers(members) {
  var stats = {};
  members.forEach(function (m) { stats[m.id] = memberStats(m, S.data.batches); });
  var ranked = members.slice().sort(function (a, b) {
    return stats[b.id].c.done - stats[a.id].c.done ||
      lastName(a.name).localeCompare(lastName(b.name)) || a.name.localeCompare(b.name);
  });
  return { list: ranked, stats: stats };
}
function renderTeam(v) {
  var q = S.search.trim().toLowerCase();
  var r = rankMembers(v.members);
  var rows = r.list.map(function (m, i) { return { m: m, rank: i + 1 }; }).filter(function (x) {
    var m = x.m;
    return !q || (m.name || '').toLowerCase().indexOf(q) >= 0 || (m.github || '').toLowerCase().indexOf(q) >= 0 ||
      String(m.objective).toLowerCase().indexOf(q) >= 0;
  });
  if (!rows.length) {
    $('teamBody').innerHTML = '<div class="card empty"><strong>No members found</strong>' + (q ? 'Try a different search.' : 'No members listed.') + '</div>';
    return;
  }
  $('teamBody').innerHTML = '<div class="card mlist">' +
    '<div class="mrow mhead" aria-hidden="true"><span>#</span><span>Member</span><span>Group</span><span class="c-badges">Onboarding</span><span>Completed</span><span class="c-counts">Status</span><span class="c-last">Last active</span></div>' +
    rows.map(function (x) { return memberRow(x.m, r.stats[x.m.id], x.rank); }).join('') + '</div>';
}
function memberRow(m, st, rank) {
  var ob = m.onboarding, c = st.c;
  var gh = m.github ? '@' + esc(m.github) : 'GitHub not set';
  return '<div class="mrow ' + objClass(m.objective) + '" role="button" tabindex="0" data-member="' + esc(m.id) + '" aria-label="Rank ' + rank + ', ' + esc(m.name) + ', group ' + esc(m.objective) + ', ' + c.done + ' of ' + st.total + ' batches done. Open details">' +
    '<span class="rank num">' + rank + '</span>' +
    '<span class="m-head">' + avatar(m, 32) + '<span class="m-id"><span class="m-name" title="' + esc(m.name) + '">' + esc(m.name) + '</span><span class="m-gh mono">' + gh + '</span></span></span>' +
    '<span>' + objChip(m.objective) + '</span>' +
    '<span class="badges c-badges">' + ghBadge(ob.github_invite) + boolBadge('Kaggle', ob.kaggle_linked) + boolBadge('Drive', ob.drive_access) + '</span>' +
    '<span class="m-prog"><span class="bar" style="--bc:var(--oc)"><i style="width:' + st.pct.toFixed(1) + '%"></i></span>' +
      '<span class="row num"><span>' + c.done + '/' + st.total + ' batches</span><span>' + Math.round(st.pct) + '%</span></span></span>' +
    '<span class="counts c-counts">' + ['running', 'failed', 'stale'].map(function (k) {
      return '<span class="s-' + k + '" title="' + STATUS_LABEL[k] + '"><span class="dot' + (k === 'running' && c[k] ? ' pulse' : '') + '"></span><b>' + c[k] + '</b> ' + k + '</span>';
    }).join('') + '</span>' +
    '<span class="c-last">' + relEl(st.lastActive) + '</span>' +
    '</div>';
}

function renderBoard(v) {
  var c = countBy(v.batches);
  var keys = ['all'].concat(STATUSES);
  $('statusFilters').innerHTML = keys.map(function (k) {
    var n = k === 'all' ? v.batches.length : c[k];
    var dot = k === 'all' ? '' : '<span class="dot s-' + k + '"></span>';
    return '<button type="button" class="fchip" data-status="' + k + '" aria-pressed="' + (S.status === k) + '">' + dot + (k === 'all' ? 'All' : STATUS_LABEL[k]) + ' <span class="n">' + n + '</span></button>';
  }).join('');
  var ms = v.members.slice().sort(function (a, b) {
    return OBJ_ORDER.indexOf(a.objective) - OBJ_ORDER.indexOf(b.objective) || a.name.localeCompare(b.name);
  });
  if (!ms.length) { $('board').innerHTML = '<div class="empty"><strong>No batches</strong>No members in this objective.</div>'; return; }
  $('board').innerHTML = ms.map(function (m) {
    var bs = v.batches.filter(function (b) { return b.member_id === m.id; }).sort(function (a, b) { return a.batch_id.localeCompare(b.batch_id, undefined, { numeric: true }); });
    var cells = bs.length ? bs.map(function (b) {
      var dim = S.status !== 'all' && b._st !== S.status;
      return '<button type="button" class="cell s-' + b._st + (dim ? ' dim' : '') + '" data-batch="' + esc(b.batch_id) + '" aria-label="' +
        esc(b.batch_id + ', ' + STATUS_LABEL[b._st] + ', ' + b.model + ', chunks ' + b.last_completed_chunk + ' of ' + b.chunks_total) + '"></button>';
    }).join('') : '<span class="muted" style="font-size:12.5px;padding:4px 0">No batches assigned</span>';
    return '<div class="brow"><div class="bname">' + avatar(m, 28) + '<div class="m-id" style="min-width:0"><div class="m-name" title="' + esc(m.name) + '">' + esc(m.name) + '</div><div class="muted">' + esc(m.objective) + '</div></div></div><div class="cells">' + cells + '</div></div>';
  }).join('');
}

var VERB = { done: 'finished', running: 'is running', failed: 'failed on', stale: 'stalled on', pending: 'queued' };
function renderActivity(v) {
  var ev = v.batches.filter(function (b) { return ts(b.updated_at); })
    .sort(function (a, b) { return ts(b.updated_at) - ts(a.updated_at); });
  if (!ev.length) { $('activityBody').innerHTML = '<div class="empty"><strong>No activity yet</strong>Runs will appear here once batches start.</div>'; return; }
  var shown = ev.slice(0, S.activityLimit);
  var html = '<div class="timeline">' + shown.map(function (b) {
    var m = S.memberById[b.member_id] || { name: b.member_id || 'Unknown', objective: b.objective };
    var extra = b._st === 'running' || b._st === 'stale' ? ' · chunk ' + b.last_completed_chunk + '/' + b.chunks_total : '';
    return '<div class="ev"><div class="dotcol s-' + b._st + '"><span class="dot' + (b._st === 'running' ? ' pulse' : '') + '"></span></div>' + avatar(m, 32) +
      '<div class="ev-text"><div><b>' + esc(m.name) + '</b> ' + VERB[b._st] + ' <button type="button" class="mono" data-batch="' + esc(b.batch_id) + '" style="border:0;background:none;padding:0;color:var(--primary);cursor:pointer">' + esc(b.batch_id) + '</button> <span class="sr-only">(' + STATUS_LABEL[b._st] + ')</span></div>' +
      '<div class="ev-sub">' + esc(b.model) + extra + ' · ' + relEl(b.updated_at) + '</div></div></div>';
  }).join('') + '</div>';
  if (ev.length > shown.length) html += '<div class="more-row"><button type="button" class="btn" id="moreBtn">Show more (' + (ev.length - shown.length) + ' older)</button></div>';
  $('activityBody').innerHTML = html;
}

function resumeChunk(b) { return Math.min(b.chunks_total || Infinity, b.last_completed_chunk + 1); }
function resumeCmd(b) { return 'run_batch(batch_id="' + b.batch_id + '", start_chunk=' + resumeChunk(b) + ')'; }
function renderFailures(v) {
  var list = v.batches.filter(function (b) { return b._st === 'failed' || b._st === 'stale'; })
    .sort(function (a, b) { return (ts(b.updated_at) || 0) - (ts(a.updated_at) || 0); });
  if (!list.length) {
    $('failBody').innerHTML = '<div class="empty"><div class="ok-icon">' + ICON.check + '</div><strong>Nothing to fix — all runs healthy.</strong></div>';
    return;
  }
  $('failBody').innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>Batch</th><th>Member</th><th>Status</th><th>Resume from</th><th>Error</th><th>Last update</th><th>Actions</th></tr></thead><tbody>' +
    list.map(function (b) {
      var m = S.memberById[b.member_id] || { name: b.member_id, objective: b.objective };
      var err = b.error || (b._st === 'stale' ? 'No heartbeat for > ' + CONFIG.staleMinutes + ' min' : '—');
      return '<tr><td><button type="button" class="mono" data-batch="' + esc(b.batch_id) + '" style="border:0;background:none;padding:0;color:var(--primary);cursor:pointer">' + esc(b.batch_id) + '</button></td>' +
        '<td><span class="owner" style="color:var(--text)">' + avatar(m, 24) + '<span style="max-width:160px;overflow:hidden;text-overflow:ellipsis" title="' + esc(m.name) + '">' + esc(m.name) + '</span></span></td>' +
        '<td>' + statusChip(b._st) + '</td>' +
        '<td class="num">chunk <span class="mono">' + resumeChunk(b) + ' / ' + b.chunks_total + '</span></td>' +
        '<td class="err" title="' + esc(err) + '">' + esc(err) + '</td>' +
        '<td>' + relEl(b.updated_at) + '</td>' +
        '<td><div class="actions">' + btnLink(b.kaggle_url, 'Open Kaggle') + btnLink(batchDrive(b), 'Open Drive') +
        '<button type="button" class="btn" data-copy="' + esc(b.batch_id) + '" aria-label="Copy resume command for ' + esc(b.batch_id) + '">' + ICON.copy + 'Copy resume cmd</button></div></td></tr>';
    }).join('') + '</tbody></table></div>';
}

function renderSetup() {
  var tasks = S.data.setup_tasks;
  if (!tasks.length) { $('setupBody').innerHTML = '<div class="empty" style="padding:20px"><strong>No setup tasks listed</strong></div>'; return; }
  var dn = tasks.filter(function (t) { return t.done; }).length;
  $('setupBody').innerHTML =
    '<div class="setup-head"><span class="num"><b>' + dn + '/' + tasks.length + '</b> setup tasks done</span><span class="muted num">' + Math.round(pct(dn, tasks.length)) + '%</span></div>' +
    '<div class="bar" style="--bc:var(--neutral)"><i style="width:' + pct(dn, tasks.length).toFixed(1) + '%"></i></div>' +
    '<ul class="tasks">' + tasks.map(function (t) {
      var m = S.memberById[t.owner];
      var owner = m ? avatar(m, 22) + '<span>' + esc(m.name) + '</span>' : (t.owner ? '<span>' + esc(t.owner) + '</span>' : '<span>Unassigned</span>');
      return '<li><span class="check' + (t.done ? ' on' : '') + '">' + (t.done ? ICON.check : '') + '</span><span class="t">' + esc(t.task) +
        '<span class="sr-only">' + (t.done ? ' (done)' : ' (open)') + '</span></span><span class="owner">' + owner + '</span></li>';
    }).join('') + '</ul>';
}

function renderFooter() {
  var g = S.data.generated_at;
  $('footer').innerHTML = 'Data generated ' + (g ? '<time datetime="' + esc(g) + '">' + esc(fmtExact(g)) + '</time>' : '—') +
    ' by GitHub Actions' +
    (repoUrl() ? ' · <a href="' + esc(repoUrl()) + '" target="_blank" rel="noopener">GitHub repo</a>' : '') +
    (driveUrl() ? ' · <a href="' + esc(driveUrl()) + '" target="_blank" rel="noopener">Drive</a>' : '') +
    (S.data.dataset ? ' · ' + esc(S.data.dataset) : '');
}

function renderAll() {
  if (!S.data) return;
  var v = view();
  renderBanner(); renderSynced(); renderMeta();
  renderKPIs(v); renderObjectives(v); renderTeam(v); renderBoard(v);
  renderActivity(v); renderFailures(v); renderSetup(); renderFooter();
  $('overviewHint').textContent = 'All groups';
  if (S.drawer) renderDrawer(true);
  S.first = false;
}
