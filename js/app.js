/* RCS Tracker — data loading, theme, section nav, event wiring and startup. Plain script (no modules) so it also works on GitHub Pages without a build; files share the global scope and are loaded in order by index.html. */
'use strict';

/* ================= Relative-time tick ================= */
function tickRel() {
  document.querySelectorAll('[data-rel]').forEach(function (el) {
    el.textContent = (el.getAttribute('data-prefix') || '') + rel(el.getAttribute('data-rel'));
  });
}

/* ================= Loading ================= */
function load(manual) {
  if (S.loading) return;
  S.loading = true;
  $('refreshBtn').classList.add('spinning');
  function getJSON(url) {
    try {
      return fetch(url + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    } catch (e) { return Promise.reject(e); }
  }
  function list(j, key) { return Array.isArray(j) ? j : (j && Array.isArray(j[key]) ? j[key] : null); }
  var F = CONFIG.files, failed = [];
  function opt(url, name) { return getJSON(url).catch(function () { failed.push(name); return null; }); }
  var p = Promise.all([opt(F.config, 'config.json'), opt(F.members, 'members.json'), opt(F.batches, 'batches.json'), opt(F.setup_tasks, 'setup_tasks.json')])
  .then(function (r) {
    var cfg = r[0] || {}, members = list(r[1], 'members'), batches = list(r[2], 'batches');
    if (!members) throw new Error('members.json missing or invalid');
    if (cfg.objectives) {
      Object.keys(cfg.objectives).forEach(function (k) { OBJECTIVES[k.toUpperCase()] = cfg.objectives[k]; });
    }
    S.loadErrors = failed;
    S.data = normalize({
      generated_at: cfg.generated_at || null, subtitle: cfg.subtitle || '', repo: cfg.repo || '', drive_url: cfg.drive_url || '', dataset: cfg.dataset || '',
      members: members, batches: batches || [], setup_tasks: list(r[3], 'setup_tasks') || []
    });
  });
  p.catch(function () {
    S.loadErrors = failed.length ? failed : ['members.json'];
    if (S.data && manual) toast('Refresh failed — showing last data');
  }).then(function () {
    if (!S.data) { renderLoadError(); return; }
    renderAll();
    if (manual) toast('Data refreshed');
  }).catch(function () { /* render errors are not expected; keep console clean */ })
    .then(function () {
      S.loading = false;
      setTimeout(function () { $('refreshBtn').classList.remove('spinning'); }, 300);
    });
}

/* ================= Theme ================= */
function currentTheme() {
  var t = document.documentElement.getAttribute('data-theme');
  if (t) return t;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function toggleTheme() {
  var next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('rcs-theme', next); } catch (e) {}
  $('themeBtn').setAttribute('aria-label', next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
}

/* ================= Section nav ================= */
function setupNav() {
  var links = document.querySelectorAll('#secnav a');
  links.forEach(function (a) {
    a.addEventListener('click', function (e) {
      var sec = $(a.getAttribute('data-sec'));
      if (!sec) return;
      e.preventDefault();
      sec.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
      try { history.replaceState(null, '', '#' + sec.id); } catch (err) {}
      setActive(sec.id);
    });
  });
  function setActive(id) {
    links.forEach(function (a) {
      var on = a.getAttribute('data-sec') === id;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
    var act = document.querySelector('#secnav a.active');
    if (act && act.scrollIntoView && window.innerWidth < 768) {
      var nav = $('secnav');
      nav.scrollLeft = act.offsetLeft - 16;
    }
  }
  if (!('IntersectionObserver' in window)) { setActive('overview'); return; }
  var visible = {};
  var ids = ['overview', 'team', 'batches', 'activity', 'failures', 'setup'];
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting; });
    var atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (atBottom) { setActive('setup'); return; }
    for (var i = 0; i < ids.length; i++) if (visible[ids[i]]) { setActive(ids[i]); return; }
  }, { rootMargin: '-120px 0px -55% 0px', threshold: 0 });
  ids.forEach(function (id) { io.observe($(id)); });
  window.addEventListener('scroll', function () {
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) setActive('setup');
  }, { passive: true });
  setActive('overview');
}

/* ================= Events ================= */
function bind() {
  $('themeBtn').setAttribute('aria-label', currentTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  $('themeBtn').addEventListener('click', toggleTheme);
  $('refreshBtn').addEventListener('click', function () { load(true); });
  $('search').addEventListener('input', function (e) { S.search = e.target.value; if (S.data) renderTeam(view()); });
  $('overlay').addEventListener('click', closeDrawer);

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : e.target.parentElement;
    if (!t) return;
    var el;
    if ((el = t.closest('[data-status]'))) { S.status = el.getAttribute('data-status'); renderBoard(view()); return; }
    if ((el = t.closest('[data-copy]'))) {
      var b = S.batchById[el.getAttribute('data-copy')];
      if (b) copyText(resumeCmd(b));
      return;
    }
    if ((el = t.closest('[data-close]'))) { closeDrawer(); return; }
    if (t.closest('#moreBtn')) { S.activityLimit += 20; renderActivity(view()); return; }
    if ((el = t.closest('[data-batch]')) && !t.closest('#drawer')) {
      var bb = S.batchById[el.getAttribute('data-batch')];
      if (bb) openDrawer(bb.member_id, bb.batch_id);
      return;
    }
    if ((el = t.closest('[data-member]'))) { openDrawer(el.getAttribute('data-member')); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.drawer) { e.preventDefault(); closeDrawer(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-member][role="button"]')) {
      e.preventDefault(); openDrawer(e.target.getAttribute('data-member'));
    }
  });

  // Focus trap inside the drawer
  $('drawer').addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(
      this.querySelectorAll('a[href], button:not([disabled]), input, select, [tabindex]:not([tabindex="-1"])'),
      function (n) { return n.offsetParent !== null; });
    if (!f.length) { e.preventDefault(); return; }
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === this)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // Heatmap tooltips (hover + keyboard focus)
  var board = $('board');
  board.addEventListener('mouseover', function (e) { var c = e.target.closest && e.target.closest('.cell'); if (c) showTip(c); });
  board.addEventListener('mouseout', function (e) { var c = e.target.closest && e.target.closest('.cell'); if (c) hideTip(); });
  board.addEventListener('focusin', function (e) { if (e.target.classList.contains('cell')) showTip(e.target); });
  board.addEventListener('focusout', hideTip);
  board.addEventListener('scroll', hideTip, { passive: true });
  window.addEventListener('scroll', hideTip, { passive: true });
}

/* ================= Init ================= */
bind();
setupNav();
load(false);
setInterval(function () { if (!document.hidden) load(false); }, CONFIG.refreshMs);
setInterval(tickRel, CONFIG.relTickMs);
document.addEventListener('visibilitychange', function () { if (!document.hidden) tickRel(); });
