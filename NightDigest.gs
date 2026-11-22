// ============================================================
// NightDigest.gs - the 7am Night Inspection roll-up (Oct 8 2026)
// New FILE in the CW Team Portal Backend project (CW Solicitations). No doPost
// route and no kind: it runs from a daily time trigger and from editor helpers.
//
// What it does: every morning around 7am Pacific, one HTML email per market
// listing every recap filed through the hub page night-inspection.html since
// the last roll-up, worst first, with a button into the FSM view
// (night-inspections.html?m=lv|nnv). A market with nothing new sends nothing.
// Jotform submissions are in it too (TJ, Oct 8 2026: whichever form the night
// manager used, it shows on the same dashboard and in the same email). They are
// read through the Jotform Feeds registry (slugs ni_lv / ni_nnv, JotformFeeds.gs).
// The Las Vegas Jotform sheet carries only the report date, not the time, so
// Jotform rows go by submission id instead of by time: every Jotform recap from
// the last 6 days that is not in the sent list (script property NID_JF_<key>,
// kept 14 days) goes in, however late it was filed.
//
// Recipients live on the "Digest" tab of the CW Night Inspections book (same
// subject, so it is a tab there, not a new book). Edit that tab to change who
// gets it; no deploy needed. Seeded Oct 8 2026 per TJ:
//   Las Vegas        To CWLV_FSMs@   cc TJ, Robert Krause
//   Northern Nevada  To Jeremy Walker  cc TJ
//   Crew checks      To Angel Nieves   cc TJ   (Oct 21 2026: crew names with no background check;
//                    Oct 28 2026: re-checked at send time, cleared never listed, pending listed as submitted)
//
// Window: each market keeps a cutoff in script property NID_LAST_<lv|nnv>
// (epoch ms). A run covers submitted_at >= last cutoff and < this run's
// minute, then stores this run's minute. No gaps, no repeats, and a missed
// trigger just makes the next email cover two nights.
//
// Editor helpers (run through Runner.gs cwRunNow):
//   niDigestInstall()  trigger + Digest tab + first cutoffs (idempotent). Marks the
//                      Jotform recaps already on file as sent, because the Jotforms
//                      already emailed those one at a time.
//   niDigestPreview()  both markets to tjroberts@ only, last 3 days, no state change
//   niDigestRun()      the real send (what the trigger calls)
//   niDigestStatus()   logs cutoffs, triggers and recipients
// Uses niSS_/niTab_/niHead_/NI_TZ from NightInspection.gs and cwSend_/cwShell_/
// cwButton_/cwEscT_/CW_HTML_F from Code.gs.
// ============================================================

var NID_TAB = 'Digest';
var NID_HEAD = ['market', 'to', 'cc', 'active', 'notes'];
var NID_SEED_ROWS = [
  ['Las Vegas', 'CWLV_FSMs@gocitywide.com', 'tjroberts@gocitywide.com, RKrause@gocitywide.com', 'TRUE', 'Oct 8 2026 per TJ'],
  ['Northern Nevada', 'jeremy.walker@gocitywide.com', 'tjroberts@gocitywide.com', 'TRUE', 'Oct 8 2026 per TJ']
];
// First run picks up everything filed on the hub from here on. Oct 6 2026 is when
// Northern Nevada started filing on the hub and nobody had been emailed any of it.
var NID_FIRST_CUTOFF = '2026-10-06 00:00';
var NID_HOUR = 7;
var NID_FN = 'niDigestRun';
var NID_HUB = 'https://citywidelv.github.io/cw-ops-desk/night-inspections.html';
var NID_TEST_TO = 'tjroberts@gocitywide.com';
var NID_KEYS = { 'Las Vegas': 'lv', 'Northern Nevada': 'nnv' };
var NID_SENDER = { lv: 'City Wide Las Vegas Night Ops', nnv: 'City Wide Northern Nevada Night Ops' };
var NID_JF_SLUG = { lv: 'ni_lv', nnv: 'ni_nnv' };
var NID_FORMS = 'https://citywidelv.github.io/cw-ops-desk/form-view.html?f=';
var NID_JQ = { score: 'Rate the Quality of the Clean based on what you see tonight', fsmAsk: 'Any actions needed by the FSM tomorrow morning?',
  fsmNote: 'FSM Follow-up needed', resolved: 'Were all issues resolved before you left',
  why: "Why wasn't it resolved prior to you leaving, what is the plan for resolution?", uniform: 'Is the crew all in uniform?',
  supplies: 'Do we need to order supplies for the account or for the vendor?', vendor: 'Vendor', fsmEmail: 'FSM Email', date: 'Date', sub: 'Submission Date' };
var NID_REPLY = { lv: 'lvservicecall@gocitywide.com', nnv: 'rnservicecall@gocitywide.com' };

// Flag code -> plain words. HOT ones put a recap in "Needs a look". Nov 22 2026: one rule,
// shared with the hub page (night-inspections.html ATTN) and the hub alerts (NI_ATTN in
// NightInspection.gs). A building or company that is not in the directory already goes to
// the office through ni_request, and a crew name with no background check goes to the ops
// admin, so neither puts a recap in front of the FSM.
var NID_FLAG = {
  complaint: 'Complaint',
  fsm_action: 'Night manager asked for you',
  low_score: 'Low score',
  unresolved: 'Still open',
  standards_failed: 'Standard not met',
  fsm_ask_missed: 'Your question came back No',
  uniform: 'Uniform',
  unmatched_vendor: 'Company not in the directory',
  unmatched_account: 'Building not in the directory',
  supplies: 'Supplies',
  crew_unverified: 'Crew name with no background check'
};
var NID_HOT = ['complaint', 'fsm_action', 'low_score', 'unresolved', 'standards_failed', 'fsm_ask_missed', 'uniform'];
var NID_RANK = { complaint: 0, fsm_action: 1, unresolved: 2, low_score: 3, standards_failed: 4, fsm_ask_missed: 5, uniform: 6 };
var NID_EXPECT = 5;   // in-building recaps expected from each night manager on a weekday night

// ------------------------------------------------------------ helpers -----
function nidStr_(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }
function nidE_(s) { return cwEscT_(s); }
function nidTs_(v) {
  if (v instanceof Date) return v.getTime();
  var s = nidStr_(v);
  if (!s) return 0;
  try { return Utilities.parseDate(s.length <= 10 ? s + ' 00:00' : s.slice(0, 16), NI_TZ, 'yyyy-MM-dd HH:mm').getTime(); } catch (e) {}
  var t = Date.parse(s.replace(' ', 'T'));
  return isNaN(t) ? 0 : t;
}
function nidFmt_(ms, f) { return Utilities.formatDate(new Date(ms), NI_TZ, f); }
function nidFlags_(r) { return nidStr_(r.flags).split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
function nidHot_(r) { return nidFlags_(r).filter(function (f) { return NID_HOT.indexOf(f) >= 0; }); }
function nidCut_(s, n) { s = nidStr_(s).replace(/\*\*/g, '').replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '...' : s; }
function nidPlural_(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

function nidConfigTab_() {
  var ss = niSS_();
  var sh = ss.getSheetByName(NID_TAB);
  if (!sh) {
    sh = ss.insertSheet(NID_TAB);
    sh.getRange(1, 1, 1, NID_HEAD.length).setValues([NID_HEAD]).setFontWeight('bold');
    sh.getRange(2, 1, NID_SEED_ROWS.length, NID_HEAD.length).setValues(NID_SEED_ROWS);
    sh.setFrozenRows(1);
  }
  return sh;
}
// [{market, key, to, cc}] for active rows with a To.
function nidRecipients_() {
  var sh = nidConfigTab_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(1, 1, last, NID_HEAD.length).getValues();
  var head = vals[0].map(function (h) { return nidStr_(h).toLowerCase(); });
  var c = function (k) { return head.indexOf(k); };
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var mkt = nidStr_(vals[i][c('market')]);
    var key = NID_KEYS[mkt];
    var to = nidStr_(vals[i][c('to')]);
    var act = String(vals[i][c('active')]).toUpperCase();
    if (!key || !to || act === 'FALSE' || act === 'NO') continue;
    out.push({ market: mkt, key: key, to: to, cc: nidStr_(vals[i][c('cc')]) });
  }
  return out;
}

// Every hub recap for one market with submitted_at in [from, to).
function nidRows_(market, fromMs, toMs) {
  var sh = niTab_(niSS_());
  var head = niHead_(sh);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  var iM = head.indexOf('market'), iS = head.indexOf('submitted_at');
  var out = [];
  vals.forEach(function (v) {
    if (nidStr_(v[iM]) !== market) return;
    var ts = nidTs_(v[iS]);
    if (!ts || ts < fromMs || ts >= toMs) return;
    var o = { _ts: ts };
    head.forEach(function (h, j) { o[h] = (v[j] instanceof Date) ? v[j] : nidStr_(v[j]); });
    out.push(o);
  });
  out.sort(function (a, b) { return a._ts - b._ts; });
  return out;
}

// FSM names: Account Directory (account name -> fsm) and Staff (email -> name).
function nidFsmMaps_(market) {
  var out = { acct: {}, email: {} };
  try {
    actAccountRows_(actSS_()).forEach(function (r) {
      if (actRegion_(r.region) !== market) return;
      var n = actStr_(r.name).toLowerCase();
      if (n && actStr_(r.fsm)) out.acct[n] = actStr_(r.fsm);
    });
  } catch (e) {}
  try {
    var sh = staffSS_().getSheetByName('Staff');
    var v = sh ? sh.getDataRange().getValues() : [];
    for (var i = 1; i < v.length; i++) {
      var em = nidStr_(v[i][4]).toLowerCase();
      if (em) out.email[em] = nidStr_(v[i][0]).replace(/\s+/g, ' ');
    }
  } catch (e2) {}
  return out;
}
// Jotform recaps for one market, newest first, shaped like hub rows.
// keep(row) decides which ones count (window and sent-id checks).
function nidJfRows_(market, key, keep) {
  var feed = jfFeedBySlug_(NID_JF_SLUG[key]);
  if (!feed) return [];
  var data = jfLoad_(feed);
  var maps = null;
  var out = [];
  for (var i = 0; i < data.idx.length; i++) {
    var e = data.idx[i];
    if (e.ts && e.ts < new Date().getTime() - 6 * 86400000) break;   // newest first; nothing older matters
    if (!keep({ id: e.id, ts: e.ts })) continue;
    if (!maps) maps = nidFsmMaps_(market);
    var j = jfShaped_(data, e);
    var f = j.fields || {};
    var g = function (k) { return nidStr_(f[k]); };
    var score = g(NID_JQ.score).replace(/[^0-9.]/g, '');
    var reason = j.title || g('Report Type');
    var sub = g(NID_JQ.sub);
    var r = { _src: 'jotform', _id: j.id, _ts: j.ts || e.ts || 0, _timeKnown: !!sub, _link: NID_FORMS + NID_JF_SLUG[key] + '&raw=1#' + encodeURIComponent(j.id),
      inspection_id: 'Jotform ' + j.id, report_date: g(NID_JQ.date) || String(j.when || '').slice(0, 10),
      nm_name: j.who, account_name: j.where || 'Building not given', vendor_name: g(NID_JQ.vendor), reason: reason, score: score,
      fsm_action_needed: /^yes/i.test(g(NID_JQ.fsmAsk)) ? 'Yes' : 'No', fsm_action_note: g(NID_JQ.fsmNote),
      complaint_what: /complaint/i.test(reason) ? (g('Summary') ? nidCut_(g('Summary'), 300) : '') : '',
      issue_remaining: g(NID_JQ.why), summary: g('Summary') || j.summary || '', pdf_url: '', photo_count: String((j.photos || []).length), photo_folder_url: '' };
    var em = (g(NID_JQ.fsmEmail) || nidStr_(j.fsm)).toLowerCase();
    r.fsm = (em && maps.email[em]) || maps.acct[r.account_name.toLowerCase()] || (em ? em.split('@')[0] : '');
    var fl = [];
    if (score !== '' && Number(score) < NI_LOW_SCORE) fl.push('low_score');
    if (/complaint/i.test(reason)) fl.push('complaint');
    if (/^no/i.test(g(NID_JQ.resolved))) fl.push('unresolved');
    if (r.fsm_action_needed === 'Yes') fl.push('fsm_action');
    if (/^no/i.test(g(NID_JQ.uniform))) { fl.push('uniform'); r.crew_uniform = 'Not all in uniform'; }
    if (/^yes/i.test(g(NID_JQ.supplies))) fl.push('supplies');
    r.flags = fl.join(',');
    out.push(r);
  }
  return out;
}
function nidJfSent_(key) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('NID_JF_' + key) || '{}') || {}; } catch (e) { return {}; }
}
function nidJfSave_(key, sent) {
  var cut = new Date().getTime() - 14 * 86400000;
  Object.keys(sent).forEach(function (id) { if (Number(sent[id]) < cut) delete sent[id]; });
  PropertiesService.getScriptProperties().setProperty('NID_JF_' + key, JSON.stringify(sent));
}
// When to show for a row. LV Jotform rows carry a date only.
function nidWhen_(r, withDay) {
  if (r._src === 'jotform' && !r._timeKnown) {
    var d = nidStr_(r.report_date);
    try { return Utilities.formatDate(Utilities.parseDate(d, NI_TZ, 'yyyy-MM-dd'), NI_TZ, 'EEE MMM d'); } catch (e) { return d; }
  }
  return nidFmt_(r._ts, withDay === false ? 'h:mm a' : 'EEE h:mm a');
}
function nidSort_(rows) {
  return rows.sort(function (a, b) {
    var da = nidStr_(a.report_date).slice(0, 10), db = nidStr_(b.report_date).slice(0, 10);
    if (da !== db) return da < db ? -1 : 1;
    return a._ts - b._ts;
  });
}

// --------------------------------------------------------------- email -----
// Nov 2 2026: the body is built by nidInner_ so the daily / weekly rollup in Code.gs
// (cwSendMarketDigest_) can carry the same block inside its own email. nidBuild_ is the
// standalone 7 AM email, kept for niDigestRun / niDigestPreview.
function nidBuild_(mkt, key, rows, sinceMs, test) {
  var inner = nidInner_(mkt, key, rows, sinceMs);
  var label = 'Night recaps';
  var sub = mkt + ' \u00b7 ' + nidFmt_(new Date().getTime(), 'EEE MMM d');
  var subject = (test ? '[TEST] ' : '') + 'Night recaps | ' + mkt + ' | ' + rows.length + ' filed' +
    (inner.hot ? ', ' + inner.hot + (inner.hot === 1 ? ' needs a look' : ' need a look') : '');
  return { subject: subject, htmlBody: cwShell_(label, sub, inner.html, 'Sent from the City Wide Nevada team platform. Covers recaps filed on the hub and on the Jotform. GoCityWide.com'), body: inner.text };
}
// Nov 22 2026: rebuilt. Grouped by FSM with a link that opens the hub on that FSM's
// buildings, the answers shown under every recap that needs a look (what the FSM asked,
// what was wrong, how it was fixed, what is still open), minutes in the building, and a
// night manager count at the bottom. No stat tiles, nothing under 12px.
function nidHm_(v) { var m = niStr_(v).match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function nidMins_(r) {
  if (r._src === 'jotform') return null;
  var a = nidHm_(r.arrival), d = nidHm_(r.departure);
  if (a === null || d === null) return null;
  var m = d - a; return m < 0 ? m + 1440 : m;
}
function nidClock_(v) { var m = nidHm_(v); if (m === null) return ''; var h = Math.floor(m / 60), ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + ('0' + (m % 60)).slice(-2) + ' ' + ap; }
function nidRemote_(r) { return /^(Phone only|Photos from crew)$/.test(nidStr_(r.reason)); }
// Lines of "question | Yes/No/Couldn't | note" as the recap form writes them.
function nidAnswers_(r) {
  return nidStr_(r.route_answers).split('\n').map(function (l) { return l.trim(); }).filter(String).map(function (l) {
    var p = l.split('|').map(function (x) { return x.trim(); });
    return p.length >= 2 ? { q: p[0], a: p[1], n: p.slice(2).join(' | ') } : { q: l, a: '', n: '' };
  });
}
function nidInner_(mkt, key, rows, sinceMs) {
  var F = CW_HTML_F, INK = '#2D2A26', GREY = '#636466', REDD = '#B01F27', LINE = '#D4D4D4';
  var hubUrl = NID_HUB + '?m=' + key;
  var multi = (new Date().getTime() - Number(sinceMs || 0)) > 36 * 3600000;   // the weekly, or a run that covers more than one night
  var rank = function (r) { return Math.min.apply(null, nidHot_(r).map(function (f) { return NID_RANK[f]; })); };
  var hot = rows.filter(function (r) { return nidHot_(r).length; });
  var nms = {}, nmOrder = [];
  var byFsm = {}, order = [];
  rows.forEach(function (r) {
    var f = r.fsm || 'No FSM picked';
    if (!byFsm[f]) { byFsm[f] = { all: [], hot: [] }; order.push(f); }
    byFsm[f].all.push(r);
    if (nidHot_(r).length) byFsm[f].hot.push(r);
    var n = r.nm_name || 'Name not given';
    if (!nms[n]) { nms[n] = { inb: 0, remote: 0, mins: 0, timed: 0 }; nmOrder.push(n); }
    if (nidRemote_(r)) nms[n].remote++;
    else { nms[n].inb++; var mi = nidMins_(r); if (mi !== null) { nms[n].mins += mi; nms[n].timed++; } }
  });
  order.sort(); nmOrder.sort();
  var sinceNice = nidFmt_(sinceMs, 'EEE MMM d, h:mm a');
  var nJf = rows.filter(function (r) { return r._src === 'jotform'; }).length;
  var srcLine = nJf === 0 ? '' : nJf === rows.length ? ' on the Jotform' : ' (' + (rows.length - nJf) + ' on the hub, ' + nJf + ' on the Jotform)';
  var h2 = function (t) { return '<div style="margin:28px 0 4px;' + F + 'font-size:17px;font-weight:bold;color:' + INK + ';line-height:1.3;">' + nidE_(t) + '</div>'; };
  var h3 = function (t) { return '<div style="margin:16px 0 8px;' + F + 'font-size:14px;font-weight:bold;color:' + INK + ';">' + nidE_(t) + '</div>'; };
  var th = function (t, al) { return '<td align="' + (al || 'left') + '" style="padding:8px 10px;border-bottom:1px solid ' + INK + ';' + F + 'font-size:12px;font-weight:bold;color:' + GREY + ';">' + nidE_(t) + '</td>'; };
  var td = function (t, al, bold, color) { return '<td align="' + (al || 'left') + '" style="padding:10px;border-bottom:1px solid ' + LINE + ';' + F + 'font-size:14px;' + (bold ? 'font-weight:bold;' : '') + 'color:' + (color || INK) + ';">' + t + '</td>'; };

  var html = '<p style="margin:0 0 12px;' + F + 'font-size:14px;line-height:1.55;color:' + INK + ';">' +
    nidE_(nidPlural_(rows.length, 'recap')) + nidE_(srcLine) + ' from ' + nidE_(nidPlural_(nmOrder.length, 'night manager')) + ' since ' + nidE_(sinceNice) + '. ' +
    (hot.length ? '<b style="color:' + REDD + ';">' + nidE_(hot.length) + (hot.length === 1 ? ' needs a look.' : ' need a look.') + '</b>' : 'Nothing needs a look.') + '</p>';

  // one line per FSM, with a link that opens the hub on their buildings
  html += '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;"><tr>' + th('FSM') + th('Recaps', 'right') + th('Need a look', 'right') + th('', 'right') + '</tr>';
  order.forEach(function (f) {
    var g = byFsm[f], url = hubUrl + (f === 'No FSM picked' ? '&attn=0' : '&fsm=' + encodeURIComponent(f));
    html += '<tr>' + td(nidE_(f), 'left', true) + td(String(g.all.length), 'right') + td(String(g.hot.length), 'right', g.hot.length > 0, g.hot.length ? REDD : INK) +
      td('<a href="' + nidE_(url) + '" style="' + F + 'font-size:12px;font-weight:bold;color:' + INK + ';text-decoration:underline;">Open in the hub</a>', 'right') + '</tr>';
  });
  html += '</table>';

  if (hot.length) {
    html += h2('Needs a look');
    order.forEach(function (f) {
      var g = byFsm[f]; if (!g.hot.length) return;
      g.hot.sort(function (a, b) { return (rank(a) - rank(b)) || (a._ts - b._ts); });
      html += h3(f);
      g.hot.forEach(function (r) { html += nidCard_(r, key); });
    });
  }

  html += h2('Every recap');
  order.forEach(function (f) {
    var g = byFsm[f];
    html += h3(f + ' · ' + nidPlural_(g.all.length, 'recap'));
    html += '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">';
    g.all.forEach(function (r) { html += nidLine_(r, key); });
    html += '</table>';
  });

  // Night managers. "of 5" only when this run covers one weekday night.
  var night = '', oneNight = false, routed = {};
  try {
    if (!multi && typeof nrNightDate_ === 'function') {
      night = nrNightDate_();
      var dow = Number(Utilities.formatDate(Utilities.parseDate(night, NI_TZ, 'yyyy-MM-dd'), NI_TZ, 'u'));
      oneNight = dow >= 1 && dow <= 5;
      var rl = JSON.parse(nrList_({ market: key, report_date: night, sent_only: true }).getContent());
      var filed = {}; rows.forEach(function (r) { filed[nidStr_(r.account_name).toLowerCase()] = 1; });
      ((rl && rl.ok && rl.stops) || []).forEach(function (s) {
        var n = s.nm_name || 'Name not given';
        if (!routed[n]) routed[n] = { all: 0, done: 0, miss: [] };
        routed[n].all++;
        if (s.status === 'Done' || s.inspection_id || filed[nidStr_(s.account_name).toLowerCase()]) routed[n].done++;
        else routed[n].miss.push(s.account_name + (s.fsm ? ' (from ' + s.fsm + ')' : ''));
      });
    }
  } catch (re) { routed = {}; }
  Object.keys(routed).forEach(function (n) { if (!nms[n]) { nms[n] = { inb: 0, remote: 0, mins: 0, timed: 0 }; nmOrder.push(n); } });
  var anyRoute = Object.keys(routed).length > 0;
  html += h2(multi ? 'Night managers' : 'Night managers last night');
  html += '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-top:8px;"><tr>' + th('Night manager') + th(oneNight ? 'In the building, of ' + NID_EXPECT : 'In the building', 'right') + th('Average time', 'right') + (anyRoute ? th('Route stops', 'right') : '') + '</tr>';
  var notes = [];
  nmOrder.forEach(function (n) {
    var x = nms[n], low = oneNight && x.inb < NID_EXPECT, rt = routed[n];
    html += '<tr>' + td(nidE_(n), 'left', true) + td(String(x.inb), 'right', low, low ? REDD : INK) + td(x.timed ? Math.round(x.mins / x.timed) + ' min' : '-', 'right') +
      (anyRoute ? td(rt ? rt.done + ' of ' + rt.all : '-', 'right', !!(rt && rt.miss.length), rt && rt.miss.length ? REDD : INK) : '') + '</tr>';
    if (x.remote) notes.push(n + ' also filed ' + nidPlural_(x.remote, 'recap') + ' by phone or from crew photos.');
    if (rt && rt.miss.length) notes.push('Routed with no recap for ' + n + ': ' + rt.miss.join(', ') + '.');
  });
  html += '</table>';
  if (notes.length || oneNight) html += '<p style="margin:10px 0 0;' + F + 'font-size:12px;line-height:1.55;color:' + GREY + ';">' + nidE_(notes.join(' ')) +
    (oneNight ? (notes.length ? ' ' : '') + 'Phone and photo recaps do not count toward the ' + NID_EXPECT + '.' : '') + '</p>';

  html += cwButton_('Open every recap in the Ops Hub', hubUrl + '&attn=0');
  html += '<p style="margin:14px 0 0;' + F + 'font-size:12px;line-height:1.55;color:' + GREY + ';">The hub asks for the team password the first time on a new device. Mark a recap handled on the hub once you have dealt with it.</p>';

  var text = [nidPlural_(rows.length, 'recap') + srcLine + ' since ' + sinceNice + '.',
    hot.length ? hot.length + (hot.length === 1 ? ' needs a look.' : ' need a look.') : 'Nothing needs a look.', ''];
  rows.forEach(function (r) {
    var mi = nidMins_(r);
    text.push('- ' + nidWhen_(r) + ' | ' + r.account_name + ' | ' + r.nm_name + ' | ' + r.reason + (mi !== null ? ' | ' + mi + ' min' : '') +
      (r.score !== '' ? ' | ' + r.score + '/10' : '') + (nidHot_(r).length ? ' | ' + nidHot_(r).map(function (f) { return NID_FLAG[f]; }).join(', ') : '') +
      (r.fsm ? ' | FSM ' + r.fsm : '') + (r.pdf_url ? ' | ' + r.pdf_url : '') + (r._src === 'jotform' ? ' | Jotform' : ''));
  });
  text.push('', 'Review them in the Ops Hub ' + hubUrl);

  return { html: html, text: text.join('\n'), hot: hot.length };
}

// Nov 2 2026: the block the daily / weekly rollup carries. sinceMs = 0 uses the
// market cutoff (NID_LAST_<key>, hub rows) and the Jotform sent list, exactly like
// the 7 AM run did; a value (the weekly) uses that window instead. Nothing moves
// until commit() runs, which the rollup calls after a real (non-test) send.
function nidBlock_(mkt, key, sinceMs) {
  var props = PropertiesService.getScriptProperties();
  var pk = 'NID_LAST_' + key;
  var first = Utilities.parseDate(NID_FIRST_CUTOFF, NI_TZ, 'yyyy-MM-dd HH:mm').getTime();
  var cutoff = Math.floor(new Date().getTime() / 60000) * 60000;
  var since = Number(sinceMs) || Number(props.getProperty(pk)) || first;
  var rows = nidRows_(mkt, since, cutoff);
  var sent = nidJfSent_(key), jf = [];
  try { jf = nidJfRows_(mkt, key, function (x) { return sinceMs ? (!x.ts || x.ts >= since) : !sent[x.id]; }); } catch (je) {}
  var all = nidSort_(rows.concat(jf));
  var inner = all.length ? nidInner_(mkt, key, all, since) : { html: '', text: '', hot: 0 };
  return { count: all.length, hot: inner.hot, rows: rows, html: inner.html, text: inner.text, commit: function () {
    props.setProperty(pk, String(cutoff));
    jf.forEach(function (r) { sent[r._id] = cutoff; });
    nidJfSave_(key, sent);
  } };
}

function nidScore_(r) {
  var F = CW_HTML_F;
  if (r.score === '' || isNaN(Number(r.score))) return '<span style="' + F + 'font-size:12px;color:#636466;">no score</span>';
  var low = Number(r.score) < NI_LOW_SCORE;
  return '<span style="' + F + 'font-size:17px;font-weight:bold;color:' + (low ? '#B01F27' : '#2D2A26') + ';">' + nidE_(r.score) + '</span><span style="' + F + 'font-size:12px;color:#636466;"> of 10</span>';
}
function nidLinks_(r, key) {
  var F = CW_HTML_F;
  var a = [];
  var link = function (label, url, bold) { return '<a href="' + nidE_(url) + '" style="' + F + 'font-size:12px;' + (bold ? 'font-weight:bold;' : '') + 'color:#2D2A26;text-decoration:underline;">' + nidE_(label) + '</a>'; };
  a.push(link('Open it in the hub', NID_HUB + '?m=' + key + '&attn=0&q=' + encodeURIComponent(r._src === 'jotform' ? (r.account_name || '') : (r.inspection_id || r.account_name || '')), true));
  if (r.pdf_url) a.push(link('PDF', r.pdf_url));
  if (r._src === 'jotform') a.push(link('Jotform recap', r._link));
  var n = Number(r.photo_count) || 0;
  if (n && r._src === 'jotform') a.push('<span style="' + F + 'font-size:12px;color:#636466;">' + nidPlural_(n, 'photo') + ' on the Jotform</span>');
  if (n && r.photo_folder_url) a.push(link(nidPlural_(n, 'photo'), r.photo_folder_url));
  return a.join(' &nbsp;&middot;&nbsp; ');
}
function nidChips_(codes) {
  var F = CW_HTML_F;
  return codes.map(function (f) {
    var hot = NID_HOT.indexOf(f) >= 0;
    return '<span style="display:inline-block;margin:4px 4px 0 0;padding:2px 10px;border-radius:18px;' + F + 'font-size:12px;font-weight:bold;' +
      (hot ? 'background:#D22730;color:#ffffff;' : 'background:#ffffff;color:#2D2A26;border:1px solid #2D2A26;') + '">' + nidE_(NID_FLAG[f] || f) + '</span>';
  }).join('');
}
// Who, why, which company, and how long they were in the building.
function nidMeta_(r) {
  var mi = nidMins_(r);
  var when = (r._src === 'jotform' || nidHm_(r.arrival) === null) ? nidWhen_(r)
    : nidClock_(r.arrival) + (nidHm_(r.departure) !== null ? ' to ' + nidClock_(r.departure) : '') + (mi !== null ? ', ' + mi + ' minutes in the building' : '');
  return [r.nm_name, r.reason, r.vendor_name, when, r._src === 'jotform' ? 'Jotform' : ''].map(nidStr_).filter(Boolean).join(' · ');
}
// Full card for a recap that needs a look: the tags, what the FSM asked and the answer,
// and the words behind every problem. A full border, no stripe down one side.
function nidCard_(r, key) {
  var F = CW_HTML_F;
  var hot = nidHot_(r);
  var det = [];
  var add = function (k, v) { v = nidStr_(v); if (v) det.push([k, v]); };
  if (r.fsm_action_needed === 'Yes') add('For you first thing', r.fsm_action_note || 'Follow-up requested');
  add('What was wrong', r.score_note);
  if (hot.indexOf('standards_failed') >= 0) add('Standard not met, and what was done', nidStr_(r.standards_failed).split('\n').map(function (l) { var p = l.split('|'); return p[0].trim() + (p[1] && p[1].trim() ? '. ' + p.slice(1).join('|').trim() : ''); }).join('\n'));
  if (hot.indexOf('complaint') >= 0) {
    add('The client said', [r.complaint_what, r.complaint_areas].map(nidStr_).filter(Boolean).join(' | ') || 'Flagged with no details');
    add('Why it happened', r.complaint_root_cause);
    add('The crew agreed to', r.complaint_agreed_fix);
    if (r.complaint_resolved) add('Complaint fixed', r.complaint_resolved + (r.complaint_blocker ? '. ' + r.complaint_blocker : ''));
    add('Closed in CRM', r.crm_closed);
  }
  add('How it was fixed', r.issue_resolution);
  if (hot.indexOf('unresolved') >= 0) add('Still open', [r.issue_remaining, r.issue_owner, r.issue_due ? 'by ' + r.issue_due : ''].map(nidStr_).filter(Boolean).join(' | '));
  if (hot.indexOf('uniform') >= 0) add('Uniform', [r.crew_uniform, r.crew_uniform_note].map(nidStr_).filter(Boolean).join('. '));
  var rowsHtml = det.map(function (p) {
    return '<tr><td style="padding:8px 0 0;"><div style="' + F + 'font-size:12px;color:#636466;">' + nidE_(p[0]) + '</div>' +
      '<div style="' + F + 'font-size:14px;color:#2D2A26;line-height:1.45;">' + nidE_(nidCut_(p[1], 500)).replace(/\n/g, '<br>') + '</div></td></tr>';
  }).join('');
  var asked = nidAnswers_(r).map(function (a) {
    var yes = /^yes/i.test(a.a);
    var pill = '<span style="display:inline-block;min-width:44px;text-align:center;padding:2px 8px;border-radius:18px;' + F + 'font-size:12px;font-weight:bold;' +
      (yes ? 'border:1px solid #2D2A26;color:#2D2A26;' : 'background:#D22730;color:#ffffff;') + '">' + nidE_(/^could/i.test(a.a) ? 'Could not' : (a.a || 'No answer')) + '</span>';
    return '<tr><td width="84" style="padding:4px 10px 4px 0;vertical-align:top;">' + pill + '</td><td style="padding:4px 0;' + F + 'font-size:14px;color:#2D2A26;line-height:1.45;">' + nidE_(a.q) +
      (a.n ? '<br><span style="font-size:12px;color:#636466;">' + nidE_(nidCut_(a.n, 300)) + '</span>' : '') + '</td></tr>';
  }).join('');
  return '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 12px;border:1px solid #D22730;border-collapse:separate;border-radius:8px;"><tr>' +
    '<td style="padding:14px 16px;">' +
    '<table border="0" cellpadding="0" cellspacing="0" width="100%"><tr>' +
    '<td style="' + F + 'font-size:16px;font-weight:bold;color:#2D2A26;line-height:1.3;">' + nidE_(r.account_name) + '</td>' +
    '<td align="right" style="white-space:nowrap;vertical-align:top;">' + nidScore_(r) + '</td></tr></table>' +
    '<div style="' + F + 'font-size:12px;color:#636466;padding-top:4px;line-height:1.5;">' + nidE_(nidMeta_(r)) + '</div>' +
    '<div>' + nidChips_(hot) + '</div>' +
    (asked ? '<div style="' + F + 'font-size:12px;font-weight:bold;color:#2D2A26;padding:12px 0 4px;">What you asked them to check</div><table border="0" cellpadding="0" cellspacing="0" width="100%">' + asked + '</table>' : '') +
    (rowsHtml ? '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top:6px;">' + rowsHtml + '</table>' : '') +
    '<div style="padding-top:12px;">' + nidLinks_(r, key) + '</div>' +
    '</td></tr></table>';
}
// One compact line for the full log.
function nidLine_(r, key) {
  var F = CW_HTML_F;
  var hot = nidHot_(r).length > 0, mi = nidMins_(r);
  var codes = nidFlags_(r).filter(function (f) { return NID_HOT.indexOf(f) < 0; });
  return '<tr>' +
    '<td width="1%" style="padding:10px 12px 10px 0;border-bottom:1px solid #D4D4D4;' + F + 'font-size:12px;color:#636466;white-space:nowrap;vertical-align:top;">' + (r._src === 'jotform' && !r._timeKnown ? nidE_(nidWhen_(r)).replace(' ', '<br>') : nidE_(nidFmt_(r._ts, 'EEE')) + '<br>' + nidE_(nidFmt_(r._ts, 'h:mm a'))) + '</td>' +
    '<td style="padding:10px 10px 10px 0;border-bottom:1px solid #D4D4D4;vertical-align:top;">' +
    '<div style="' + F + 'font-size:14px;font-weight:bold;color:#2D2A26;">' + nidE_(r.account_name) + '</div>' +
    '<div style="' + F + 'font-size:12px;color:#636466;padding-top:2px;line-height:1.5;">' + nidE_([r.nm_name, r.reason, mi !== null ? mi + ' min' : '', r.vendor_name, r._src === 'jotform' ? 'Jotform' : ''].map(nidStr_).filter(Boolean).join(' · ')) + '</div>' +
    (hot ? '<div style="' + F + 'font-size:12px;font-weight:bold;color:#B01F27;padding-top:4px;">Needs a look. Details above.</div>'
      : (r.summary ? '<div style="' + F + 'font-size:12px;color:#2D2A26;line-height:1.5;padding-top:4px;">' + nidE_(nidCut_(r.summary, 220)) + '</div>' : '')) +
    (codes.length ? '<div>' + nidChips_(codes) + '</div>' : '') +
    '<div style="padding-top:6px;">' + nidLinks_(r, key) + '</div></td>' +
    '<td width="1%" align="right" style="padding:10px 0;border-bottom:1px solid #D4D4D4;white-space:nowrap;vertical-align:top;">' + nidScore_(r) + '</td>' +
    '</tr>';
}

// ---------------------------------------------------------------- runs -----
// The trigger. Sends one email per active market that has new hub recaps.
function niDigestRun() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('Another roll-up is running.'); return 'busy'; }
  try {
    var props = PropertiesService.getScriptProperties();
    var now = new Date();
    var cutoff = Math.floor(now.getTime() / 60000) * 60000;
    var first = Utilities.parseDate(NID_FIRST_CUTOFF, NI_TZ, 'yyyy-MM-dd HH:mm').getTime();
    var out = [], crewRows = [];
    nidRecipients_().forEach(function (rc) {
      var pk = 'NID_LAST_' + rc.key;
      var since = Number(props.getProperty(pk)) || first;
      var rows = nidRows_(rc.market, since, cutoff);
      crewRows = crewRows.concat(rows);
      var sent = nidJfSent_(rc.key), jf = [];
      try {
        jf = nidJfRows_(rc.market, rc.key, function (x) { return !sent[x.id]; });
      } catch (je) { out.push(rc.market + ': Jotform read failed ' + je.message); }
      rows = nidSort_(rows.concat(jf));
      if (!rows.length) { props.setProperty(pk, String(cutoff)); out.push(rc.market + ': nothing new'); return; }
      var m = nidBuild_(rc.market, rc.key, rows, since, false);
      cwSend_({ to: rc.to, cc: rc.cc, subject: m.subject, body: m.body, htmlBody: m.htmlBody,
        name: NID_SENDER[rc.key], replyTo: NID_REPLY[rc.key] });
      props.setProperty(pk, String(cutoff));
      jf.forEach(function (r) { sent[r._id] = cutoff; });
      nidJfSave_(rc.key, sent);
      out.push(rc.market + ': sent ' + rows.length + ' (' + jf.length + ' Jotform) to ' + rc.to + (rc.cc ? ' cc ' + rc.cc : ''));
    });
    try { out.push(nidCrewSend_(crewRows, false)); } catch (ce) { out.push('crew checks failed: ' + ce.message); }
    Logger.log(out.join('\n'));
    return out.join('\n');
  } finally { lock.releaseLock(); }
}

// Test send: both markets, last 3 days (or since the first cutoff, whichever is
// earlier), To TJ only. Touches no cutoff.
function niDigestPreview() {
  var now = new Date().getTime();
  var first = Utilities.parseDate(NID_FIRST_CUTOFF, NI_TZ, 'yyyy-MM-dd HH:mm').getTime();
  var since = Math.min(first, now - 3 * 86400000);
  var out = [];
  [['Las Vegas', 'lv'], ['Northern Nevada', 'nnv']].forEach(function (p) {
    var rows = nidRows_(p[0], since, now);
    try { rows = rows.concat(nidJfRows_(p[0], p[1], function (x) { return !x.ts || x.ts >= now - 2 * 86400000; })); } catch (je) { out.push(p[0] + ': Jotform read failed ' + je.message); }
    rows = nidSort_(rows);
    if (!rows.length) { out.push(p[0] + ': nothing in the window, no test sent'); return; }
    var m = nidBuild_(p[0], p[1], rows, since, true);
    cwSend_({ to: NID_TEST_TO, subject: m.subject, body: m.body, htmlBody: m.htmlBody, name: NID_SENDER[p[1]], replyTo: NID_TEST_TO });
    out.push(p[0] + ': test with ' + rows.length + ' sent to ' + NID_TEST_TO);
  });
  try { out.push(nidCrewSend_(nidRows_('Las Vegas', since, now).concat(nidRows_('Northern Nevada', since, now)), true)); } catch (ce) { out.push('crew checks test failed: ' + ce.message); }
  Logger.log(out.join('\n'));
  return out.join('\n');
}

// Nov 2 2026: the 7 AM email is retired; its block rides in the daily / weekly rollup
// (cwSendMarketDigest_ in Code.gs). cwInstallDigestTrigger removes the niDigestRun
// trigger. This helper does only that, for a run on its own.
function niDigestRetire() {
  var out = [];
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === NID_FN) { ScriptApp.deleteTrigger(t); out.push('removed 7am trigger'); } });
  Logger.log(out.join(', ') || 'no 7am trigger to remove'); return out.join(', ') || 'no 7am trigger to remove';
}
// One-time setup. Safe to run again. (Installs the standalone 7 AM trigger; not used since Nov 2 2026.)
function niDigestInstall() {
  var out = [];
  nidConfigTab_(); out.push('Digest tab ready');
  var have = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === NID_FN; });
  if (!have.length) {
    ScriptApp.newTrigger(NID_FN).timeBased().atHour(NID_HOUR).nearMinute(0).everyDays(1).inTimezone(NI_TZ).create();
    out.push('7am trigger installed');
  } else out.push('7am trigger already there (' + have.length + ')');
  var props = PropertiesService.getScriptProperties();
  var first = String(Utilities.parseDate(NID_FIRST_CUTOFF, NI_TZ, 'yyyy-MM-dd HH:mm').getTime());
  ['lv', 'nnv'].forEach(function (k) { if (!props.getProperty('NID_LAST_' + k)) { props.setProperty('NID_LAST_' + k, first); out.push(k + ' starts from ' + NID_FIRST_CUTOFF); } });
  // Jotform recaps already on file were emailed one at a time by the Jotform; start after them.
  [['Las Vegas', 'lv'], ['Northern Nevada', 'nnv']].forEach(function (p) {
    if (props.getProperty('NID_JF_' + p[1])) return;
    var sent = {}, now = new Date().getTime();
    try { nidJfRows_(p[0], p[1], function (x) { sent[x.id] = now; return false; }); } catch (e) { out.push(p[1] + ' Jotform seed failed ' + e.message); }
    nidJfSave_(p[1], sent);
    out.push(p[1] + ' Jotform marked ' + Object.keys(sent).length + ' existing recaps as sent');
  });
  Logger.log(out.join('\n'));
  return out.join('\n');
}

function niDigestStatus() {
  var props = PropertiesService.getScriptProperties();
  var out = [];
  ['lv', 'nnv'].forEach(function (k) { var v = Number(props.getProperty('NID_LAST_' + k)); out.push(k + ' cutoff ' + (v ? nidFmt_(v, 'yyyy-MM-dd HH:mm') : 'not set')); });
  out.push('triggers ' + ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === NID_FN; }).length);
  nidRecipients_().forEach(function (r) { out.push(r.market + ' to ' + r.to + ' cc ' + r.cc); });
  var crc = nidCrewRecipient_(); out.push('crew checks ' + (crc ? 'to ' + crc.to + ' cc ' + crc.cc : 'off'));
  Logger.log(out.join('\n'));
  return out.join('\n');
}

// ------------------------------------------------------------ crew checks --
// Oct 21 2026, per TJ. When the roll-up goes out, one more email goes to the ops
// admin (Angel) listing every crew member a night manager met whose name is not
// on that vendor's background checks (the crew_unverified column), grouped by
// vendor. The ask: check the Background Checks log; if the person is not there,
// reach out to the vendor to submit a check or ask us to run one. Both markets in
// one email. Recipient is the "Crew checks" row on the Digest tab (added on
// first run), so it can be changed without a deploy.
var NID_CREW_MARKET = 'Crew checks';
var NID_CREW_SEED = ['Crew checks', 'Angel.Nieves@gocitywide.com', 'tjroberts@gocitywide.com', 'TRUE', 'Oct 21 2026 per TJ: crew names with no background check on file'];
var NID_CREW_BC = 'https://citywidelv.github.io/cw-admin-hub/background-checks.html';
var NID_CREW_SENDER = 'City Wide Nevada Night Ops';

function nidCrewRecipient_() {
  var sh = nidConfigTab_();
  var last = sh.getLastRow();
  var vals = last >= 2 ? sh.getRange(2, 1, last - 1, NID_HEAD.length).getValues() : [];
  for (var i = 0; i < vals.length; i++) {
    if (nidStr_(vals[i][0]) !== NID_CREW_MARKET) continue;
    var act = String(vals[i][3]).toUpperCase();
    if (!nidStr_(vals[i][1]) || act === 'FALSE' || act === 'NO') return null;
    return { to: nidStr_(vals[i][1]), cc: nidStr_(vals[i][2]) };
  }
  sh.getRange(last + 1, 1, 1, NID_HEAD.length).setValues([NID_CREW_SEED]);
  return { to: NID_CREW_SEED[1], cc: NID_CREW_SEED[2] };
}

// rows: hub recaps from both markets. Oct 28 2026: every crew name is re-checked
// HERE, at send time, against a freshly built vendor roster (the same roster the
// inspection page shows as tick boxes), not read back from the crew_unverified
// column written at 2am. A check Angel cleared during the day never shows up
// as missing the next morning, and the matching is one path end to end.
// Returns [{vendor, owner, market, need:[{name, why}], pending:[name], visits:[...]}]
// Only names with a status of Not on file or On profile, no check go in need.
function nidCrewGroups_(rows) {
  var rosters = {};
  var rosterFor = function (market) {
    var mkt = /^northern/i.test(market) ? 'nnv' : 'lv';
    if (!rosters[mkt]) { try { rosters[mkt] = niHistoryCached_(mkt, true).vendor_roster || {}; } catch (e) { rosters[mkt] = {}; } }
    return rosters[mkt];
  };
  var why = function (c) {
    if (c.status === NI_CREW_PROFILE) return 'on the vendor profile' + (c.role ? ' as ' + c.role.toLowerCase() : '') + ', no background check on file';
    return 'not on this vendor\'s profile at all';
  };
  var by = {}, order = [];
  rows.forEach(function (r) {
    if (r._src === 'jotform') return;
    if (!nidStr_(r.crew_names) || nidStr_(r.crew_seen) !== 'Yes') return;
    var checks = niCrewClassify_(rosterFor(nidStr_(r.market)), r);
    var need = checks.filter(function (c) { return c.status === NI_CREW_NONE || c.status === NI_CREW_PROFILE; });
    var pend = checks.filter(function (c) { return c.status === NI_CREW_PENDING; });
    if (!need.length && !pend.length) return;
    var vendor = nidStr_(r.vendor_name) || 'Company not given';
    var k = vendor.toLowerCase() + '|' + nidStr_(r.market);
    if (!by[k]) { by[k] = { vendor: vendor, owner: nidStr_(r.vendor_owner), market: nidStr_(r.market), need: [], pending: [], visits: [] }; order.push(k); }
    var g = by[k];
    var seen = function (list, n) { return list.some(function (x) { return (x.name || x).toLowerCase() === n.toLowerCase(); }); };
    need.forEach(function (c) { if (!seen(g.need, c.name)) g.need.push({ name: c.name, why: why(c) }); });
    pend.forEach(function (c) { if (!seen(g.pending, c.canon || c.name)) g.pending.push(c.canon || c.name); });
    g.visits.push({ account: nidStr_(r.account_name), when: nidWhen_(r, true), nm: nidStr_(r.nm_name), pdf: nidStr_(r.pdf_url),
      names: need.map(function (c) { return c.name; }).concat(pend.map(function (c) { return c.canon || c.name; })) });
  });
  return order.map(function (k) { return by[k]; });
}

function nidCrewBuild_(groups, test) {
  var F = CW_HTML_F;
  var total = groups.reduce(function (s, g) { return s + g.need.length; }, 0);
  var pendTotal = groups.reduce(function (s, g) { return s + g.pending.length; }, 0);
  var html = '<p style="margin:0 0 14px;' + F + 'font-size:14px;line-height:1.55;color:#2d2a26;">' +
    'Night managers met ' + nidE_(nidPlural_(total, 'crew member')) + ' last night with no background check on file for their company.' +
    (pendTotal ? ' ' + nidE_(nidPlural_(pendTotal, 'name has', 'names have')) + ' a check already submitted and waiting on the result; those are listed for reference only.' : '') + '</p>' +
    '<p style="margin:0 0 16px;' + F + 'font-size:14px;line-height:1.55;color:#2d2a26;">For each name that needs a check:<br>' +
    '1. Check the Background Checks log. If the check is there, attach it to the vendor.<br>' +
    '2. If it is not, reach out to the vendor. Ask them to submit a background check, or to request that we run one.</p>';
  groups.forEach(function (g) {
    html += '<div style="margin:0 0 12px;border:1px solid #E5E5E5;border-left:4px solid ' + (g.need.length ? '#D22730' : '#BBBBBB') + ';padding:12px 14px;">' +
      '<div style="' + F + 'font-size:15px;font-weight:bold;color:#2d2a26;">' + nidE_(g.vendor) + (g.owner ? ' <span style="font-weight:normal;color:#636466;">- ' + nidE_(g.owner) + '</span>' : '') + '</div>' +
      '<div style="' + F + 'font-size:11px;color:#636466;margin:2px 0 8px;">' + nidE_(g.market) + '</div>' +
      (g.need.length ? '<div style="' + F + 'font-size:14px;color:#2d2a26;line-height:1.6;"><b>Needs a check:</b><br>' +
        g.need.map(function (x) { return nidE_(x.name) + ' <span style="color:#636466;">(' + nidE_(x.why) + ')</span>'; }).join('<br>') + '</div>' : '') +
      (g.pending.length ? '<div style="' + F + 'font-size:13px;color:#636466;line-height:1.6;margin-top:6px;"><b>Already submitted, waiting on the result:</b> ' + nidE_(g.pending.join(', ')) + '</div>' : '') +
      g.visits.map(function (v) {
        return '<div style="' + F + 'font-size:12px;color:#636466;line-height:1.5;margin-top:4px;">' + nidE_(v.account) + ' &middot; ' + nidE_(v.when) + (v.nm ? ' &middot; ' + nidE_(v.nm) : '') +
          (v.pdf ? ' &middot; <a href="' + nidE_(v.pdf) + '" style="color:#D22730;">Recap PDF</a>' : '') + '</div>';
      }).join('') + '</div>';
  });
  html += cwButton_('Open the Background Checks log', NID_CREW_BC);
  var subject = (test ? '[TEST] ' : '') + 'Background checks needed: ' + nidPlural_(total, 'crew name') + ' from last night';
  var body = subject + '\n\n' + groups.map(function (g) {
    return g.vendor + (g.owner ? ' - ' + g.owner : '') + ' (' + g.market + ')\n' +
      (g.need.length ? '  Needs a check: ' + g.need.map(function (x) { return x.name + ' (' + x.why + ')'; }).join('; ') + '\n' : '') +
      (g.pending.length ? '  Already submitted, waiting on the result: ' + g.pending.join(', ') + '\n' : '') +
      g.visits.map(function (v) { return '  ' + v.account + ', ' + v.when + (v.nm ? ', ' + v.nm : '') + (v.pdf ? ', ' + v.pdf : ''); }).join('\n');
  }).join('\n\n') + '\n\nCheck the Background Checks log first. If the check is there, attach it to the vendor. If not, reach out to the vendor and ask them to submit a background check or request that we run one.\n' + NID_CREW_BC;
  return { subject: subject, body: body, htmlBody: cwShell_('Background checks needed', 'from last night\'s recaps', html, test ? 'TEST send. The real email goes to the Crew checks row on the Digest tab.' : undefined) };
}

// Called from niDigestRun with every hub recap the roll-up just covered.
// No email when every name is cleared, or when the only names left are
// already submitted and waiting; there is nothing for the ops admin to do.
function nidCrewSend_(rows, test) {
  var groups = nidCrewGroups_(rows);
  var needAny = groups.some(function (g) { return g.need.length; });
  if (!groups.length || !needAny) return 'crew checks: none needed' + (groups.length ? ' (' + groups.reduce(function (s, g) { return s + g.pending.length; }, 0) + ' pending only)' : '');
  var rc = test ? { to: NID_TEST_TO, cc: '' } : nidCrewRecipient_();
  if (!rc) return 'crew checks: recipient row is off';
  var m = nidCrewBuild_(groups, !!test);
  cwSend_({ to: rc.to, cc: rc.cc, subject: m.subject, body: m.body, htmlBody: m.htmlBody, name: NID_CREW_SENDER, replyTo: test ? NID_TEST_TO : 'tjroberts@gocitywide.com' });
  return 'crew checks: ' + groups.length + ' vendor(s), ' + groups.reduce(function (s, g) { return s + g.need.length; }, 0) + ' name(s) to ' + rc.to + (rc.cc ? ' cc ' + rc.cc : '');
}
