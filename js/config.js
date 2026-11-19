/* RCS Tracker — paths, timing and app state. Plain script (no modules) so it also works on GitHub Pages without a build; files share the global scope and are loaded in order by index.html. */
'use strict';

/* ================= Config ================= */
/* All content lives in ./data/*.json — this file holds only paths and timing. */
var CONFIG = {
  files: {
    config: './data/config.json',            // generated_at, repo, drive_url, dataset, objectives
    members: './data/members.json',          // { members: [...] }
    batches: './data/batches.json',          // { batches: [...] }
    setup_tasks: './data/setup_tasks.json'   // { setup_tasks: [...] }
  },
  refreshMs: 60000,
  relTickMs: 30000,
  staleMinutes: 45
};
var OBJECTIVES = { O1A: { name: 'O1A', desc: '' }, O1B: { name: 'O1B', desc: '' }, O1C: { name: 'O1C', desc: '' } }; // replaced by config.json
/* Accepts `objective` or `group` (any case, e.g. "o1a") and returns canonical "O1A". */
function normObjective(m) {
  var o = String(m.objective || m.group || '').toUpperCase();
  return o || 'Unassigned';
}
var OBJ_ORDER = ['O1A', 'O1B', 'O1C'];
var STATUSES = ['done', 'running', 'failed', 'stale', 'pending'];
var STATUS_LABEL = { done: 'Done', running: 'Running', failed: 'Failed', stale: 'Stale', pending: 'Pending' };
var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

var ICON = {
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
};

/* ================= State ================= */
var S = {
  data: null, mock: false, obj: 'All', search: '', sort: 'progress', status: 'all',
  activityLimit: 20, first: true, loading: false,
  drawer: null, // { memberId, batchId, returnFocus }
  memberById: {}, batchById: {}
};
