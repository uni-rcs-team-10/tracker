/* RCS Tracker — member drawer, heatmap tooltip, toast and clipboard. Plain script (no modules) so it also works on GitHub Pages without a build; files share the global scope and are loaded in order by index.html. */
'use strict';

/* ================= Drawer ================= */
function openDrawer(memberId, batchId) {
  var m = S.memberById[memberId];
  if (!m) return;
  var wasOpen = !!S.drawer;
  S.drawer = { memberId: memberId, batchId: batchId || null, returnFocus: wasOpen ? S.drawer.returnFocus : document.activeElement };
  renderDrawer(false);
  var d = $('drawer');
  d.classList.add('open'); d.setAttribute('aria-hidden', 'false');
  $('overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  hideTip();
  setTimeout(function () {
    var close = d.querySelector('[data-close]');
    (close || d).focus();
    var hl = d.querySelector('tr.hl');
    if (hl) hl.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' });
  }, 30);
}
function closeDrawer() {
  if (!S.drawer) return;
  var rf = S.drawer.returnFocus;
  S.drawer = null;
  var d = $('drawer');
  d.classList.remove('open'); d.setAttribute('aria-hidden', 'true');
  $('overlay').classList.remove('open');
  document.body.style.overflow = '';
  if (rf && document.body.contains(rf) && rf.focus) rf.focus();
}
function renderDrawer(keepScroll) {
  var d = $('drawer'), top = d.scrollTop;
  var m = S.memberById[S.drawer.memberId];
  if (!m) { closeDrawer(); return; }
  var st = memberStats(m, S.data.batches), ob = m.onboarding;
  var bs = st.batches.slice().sort(function (a, b) { return a.batch_id.localeCompare(b.batch_id, undefined, { numeric: true }); });
  var focus = S.drawer.batchId ? S.batchById[S.drawer.batchId] : null;
  var pd = 0, pt = 0, gpu = 0;
  bs.forEach(function (b) { pd += b.prompts_done; pt += b.prompts_total; gpu += +b.gpu_minutes || 0; });
  var ghState = { accepted: 'Accepted', pending: 'Invite pending', not_sent: 'Invite not sent' }[ob.github_invite] || 'Unknown';

  var focusBlock = '';
  if (focus && focus.member_id === m.id) {
    var fst = focus._st || effStatus(focus);
    focusBlock = '<div class="d-sec"><h4>Batch ' + esc(focus.batch_id) + '</h4><dl class="d-list">' +
      '<dt>Status</dt><dd>' + statusChip(fst) + '</dd>' +
      '<dt>Model</dt><dd class="mono">' + esc(focus.model) + '</dd>' +
      '<dt>Chunks</dt><dd class="num">' + focus.last_completed_chunk + ' / ' + focus.chunks_total + '</dd>' +
      '<dt>Prompts</dt><dd class="num">' + focus.prompts_done.toLocaleString() + ' / ' + focus.prompts_total.toLocaleString() + '</dd>' +
      '<dt>Started</dt><dd>' + (focus.started_at ? esc(fmtExact(focus.started_at)) : '—') + '</dd>' +
      '<dt>Updated</dt><dd>' + relEl(focus.updated_at) + '</dd>' +
      (focus.commit_sha ? '<dt>Commit</dt><dd><a class="mono" href="' + esc(commitUrl(focus)) + '" target="_blank" rel="noopener">' + esc(String(focus.commit_sha).slice(0, 7)) + ' ↗</a></dd>' : '') +
      (focus.error ? '<dt>Error</dt><dd class="d-err">' + esc(focus.error) + '</dd>' : '') +
      '</dl>' +
      (fst === 'failed' || fst === 'stale' ? '<div class="actions" style="margin-top:12px"><button type="button" class="btn" data-copy="' + esc(focus.batch_id) + '">' + ICON.copy + 'Copy resume cmd</button>' + btnLink(focus.kaggle_url, 'Kaggle') + btnLink(batchDrive(focus), 'Drive') + '</div>' : '') +
      '</div>';
  }

  $('drawerBody').innerHTML =
    '<div class="d-head ' + objClass(m.objective) + '">' + avatar(m, 48) +
      '<div class="m-id" style="flex:1;min-width:0"><h3 id="drawerTitle">' + esc(m.name) + '</h3>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="mono muted">' + (m.github ? '@' + esc(m.github) : 'GitHub not set') + '</span>' + objChip(m.objective) + '</div></div>' +
      '<button type="button" class="icon-btn" data-close aria-label="Close details">' + ICON.close + '</button></div>' +
    '<div class="d-sec"><div class="d-stats">' +
      '<div class="d-stat"><b>' + st.c.done + '/' + st.total + '</b><span>batches done</span></div>' +
      '<div class="d-stat"><b>' + Math.round(pct(pd, pt)) + '%</b><span>prompts</span></div>' +
      '<div class="d-stat"><b>' + (gpu >= 60 ? (gpu / 60).toFixed(1) + ' h' : gpu + ' m') + '</b><span>GPU time</span></div>' +
    '</div></div>' +
    focusBlock +
    '<div class="d-sec"><h4>Onboarding</h4><dl class="d-list">' +
      '<dt>GitHub</dt><dd>' + ghBadge(ob.github_invite) + ' <span class="muted">' + ghState + '</span></dd>' +
      '<dt>Kaggle</dt><dd>' + boolBadge('Kaggle', ob.kaggle_linked) + ' <span class="muted">' + (ob.kaggle_linked ? 'Linked' : 'Not linked') + '</span></dd>' +
      '<dt>Drive</dt><dd>' + boolBadge('Drive', ob.drive_access) + ' <span class="muted">' + (ob.drive_access ? 'Has access' : 'No access yet') + '</span></dd>' +
      '<dt>Last active</dt><dd>' + relEl(st.lastActive) + '</dd>' +
    '</dl></div>' +
    '<div class="d-sec"><h4>Run history</h4>' +
      (bs.length ? '<div class="tbl-wrap"><table><thead><tr><th>Batch</th><th>Model</th><th>Status</th><th>Chunks</th><th>Prompts</th><th>Updated</th><th>Links</th></tr></thead><tbody>' +
        bs.map(function (b) {
          var s = b._st || effStatus(b);
          return '<tr' + (focus && focus.batch_id === b.batch_id ? ' class="hl"' : '') + '><td class="mono">' + esc(b.batch_id) + '</td>' +
            '<td class="mono" style="font-size:11.5px">' + esc(b.model) + '</td><td>' + statusChip(s) + '</td>' +
            '<td class="num">' + b.last_completed_chunk + '/' + b.chunks_total + '</td>' +
            '<td class="num">' + kfmt(b.prompts_done) + '/' + kfmt(b.prompts_total) + '</td>' +
            '<td>' + relEl(b.updated_at) + '</td>' +
            '<td class="links">' + extLink(b.kaggle_url, 'Kaggle') + extLink(batchDrive(b), 'Drive') + extLink(commitUrl(b), 'Commit') + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="muted">No batches assigned yet.</div>') +
    '</div>';
  if (keepScroll) d.scrollTop = top;
}

/* ================= Tooltip ================= */
function showTip(el) {
  var b = S.batchById[el.getAttribute('data-batch')];
  if (!b) return;
  var s = b._st || effStatus(b), tip = $('tip');
  tip.innerHTML = '<div class="mono">' + esc(b.batch_id) + ' · ' + STATUS_LABEL[s] + '</div>' +
    '<div>' + esc(b.model) + '</div><div>Chunks ' + b.last_completed_chunk + ' / ' + b.chunks_total + '</div>' +
    '<div>Updated ' + esc(ts(b.updated_at) ? rel(b.updated_at) : '—') + '</div>';
  tip.hidden = false;
  var r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
  var x = Math.max(8, Math.min(window.innerWidth - tr.width - 8, r.left + r.width / 2 - tr.width / 2));
  var y = r.top - tr.height - 8;
  if (y < 116) y = r.bottom + 8;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
function hideTip() { $('tip').hidden = true; }

/* ================= Toast / clipboard ================= */
var toastTimer;
function toast(msg) {
  var t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
}
function copyText(text) {
  function fallback() {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      toast(ok ? 'Copied' : 'Copy failed');
    } catch (e) { toast('Copy failed'); }
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied'); }, fallback);
    } else fallback();
  } catch (e) { fallback(); }
}
