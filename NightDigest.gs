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

// Flag code -> plain words. HOT ones put a recap in "Needs a look".
var NID_FLAG = {
  complaint: 'Client complaint',
  fsm_action: 'FSM follow-up requested',
  low_score: 'Score under 8',
  unresolved: 'Not fixed before leaving',
  standards_failed: 'Standard not met',
  uniform: 'Crew uniform issue',
  unmatched_vendor: 'Company not in the directory',
  unmatched_account: 'Building not in the directory',
  supplies: 'Supplies needed',
  crew_unverified: 'Crew name with no background check on file'
};
var NID_HOT = ['complaint', 'fsm_action', 'low_score', 'unresolved', 'standards_failed', 'uniform', 'unmatched_vendor', 'unmatched_account'];
var NID_RANK = { complaint: 0, fsm_action: 1, unresolved: 2, low_score: 3, standards_failed: 4, uniform: 5, unmatched_account: 6, unmatched_vendor: 7 };

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
    var r = { _src: 'jotform', _id: j.id, _ts: j.ts || e.ts || 0, _timeKnown: !!sub, _link: NID_FORMS + NID_JF_SLUG[key],
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
function nidBuild_(mkt, key, rows, sinceMs, test) {
  var F = CW_HTML_F;
  var hubUrl = NID_HUB + '?m=' + key;
  var hot = rows.filter(function (r) { return nidHot_(r).length; });
  hot.sort(function (a, b) {
    var ra = Math.min.apply(null, nidHot_(a).map(function (f) { return NID_RANK[f]; }));
    var rb = Math.min.apply(null, nidHot_(b).map(function (f) { return NID_RANK[f]; }));
    return (ra - rb) || (a._ts - b._ts);
  });
  var buildings = {}, nms = {}, scores = [];
  rows.forEach(function (r) {
    buildings[r.account_name || r.account_id] = 1;
    if (r.nm_name) nms[r.nm_name] = 1;
    if (r.score !== '' && !isNaN(Number(r.score))) scores.push(Number(r.score));
  });
  var avg = scores.length ? (scores.reduce(function (s, x) { return s + x; }, 0) / scores.length) : null;
  var nB = Object.keys(buildings).length, nNM = Object.keys(nms).length;
  var sinceNice = nidFmt_(sinceMs, 'EEE MMM d, h:mm a');

  // stat strip
  var stat = function (n, label, red) {
    return '<td align="center" width="25%" style="padding:12px 6px;border:1px solid #E5E5E5;">' +
      '<div style="' + F + 'font-size:22px;font-weight:bold;color:' + (red ? '#D22730' : '#2d2a26') + ';">' + nidE_(n) + '</div>' +
      '<div style="' + F + 'font-size:10px;color:#636466;text-transform:uppercase;letter-spacing:0.05em;padding-top:2px;">' + nidE_(label) + '</div></td>';
  };
  var html = '';
  var nJf = rows.filter(function (r) { return r._src === 'jotform'; }).length;
  var srcLine = nJf === 0 ? ' on the hub' : nJf === rows.length ? ' on the Jotform' : ' (' + (rows.length - nJf) + ' on the hub, ' + nJf + ' on the Jotform)';
  html += '<p style="margin:0 0 14px;' + F + 'font-size:14px;line-height:1.55;color:#2d2a26;">' +
    nidE_(nidPlural_(rows.length, 'inspection')) + nidE_(srcLine) + ' from ' + nidE_(nidPlural_(nNM, 'night manager')) +
    ' since ' + nidE_(sinceNice) + '. ' +
    (hot.length ? '<b style="color:#D22730;">' + nidE_(hot.length) + ' need a look.</b>' : 'Nothing flagged.') + '</p>';
  html += '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;"><tr>' +
    stat(rows.length, 'Inspections') + stat(nB, 'Buildings') + stat(avg === null ? '-' : avg.toFixed(1), 'Avg score') +
    stat(hot.length, 'Need a look', hot.length > 0) + '</tr></table>';
  html += cwButton_('Review them in the Ops Hub', hubUrl);

  // Needs a look
  if (hot.length) {
    html += '<div style="margin:26px 0 8px;' + F + 'font-size:12px;font-weight:bold;color:#D22730;text-transform:uppercase;letter-spacing:0.06em;">Needs a look</div>';
    hot.forEach(function (r) { html += nidCard_(r, key); });
  }

  // Everything, grouped by FSM
  html += '<div style="margin:26px 0 8px;' + F + 'font-size:12px;font-weight:bold;color:#2d2a26;text-transform:uppercase;letter-spacing:0.06em;">All inspections</div>';
  var byFsm = {}, order = [];
  rows.forEach(function (r) { var f = r.fsm || 'No FSM picked'; if (!byFsm[f]) { byFsm[f] = []; order.push(f); } byFsm[f].push(r); });
  order.sort();
  order.forEach(function (f) {
    html += '<div style="margin:14px 0 4px;' + F + 'font-size:12px;font-weight:bold;color:#636466;">FSM ' + nidE_(f) + ' &middot; ' + nidE_(nidPlural_(byFsm[f].length, 'stop')) + '</div>';
    html += '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">';
    byFsm[f].forEach(function (r) { html += nidLine_(r, key); });
    html += '</table>';
  });

  html += cwButton_('Open every recap in the Ops Hub', hubUrl);
  html += '<p style="margin:14px 0 0;' + F + 'font-size:12px;line-height:1.55;color:#636466;">The hub asks for the team password the first time on a new device. Each PDF opens straight from Drive.</p>';

  var label = 'Night Inspections';
  var sub = mkt + ' · ' + nidFmt_(new Date().getTime(), 'EEE MMM d');
  var subject = (test ? '[TEST] ' : '') + 'Night Inspections | ' + mkt + ' | ' + nidPlural_(rows.length, 'recap') +
    (hot.length ? ', ' + hot.length + ' need a look' : '');

  var text = [nidPlural_(rows.length, 'inspection') + srcLine + ' since ' + sinceNice + '.',
    hot.length ? hot.length + ' need a look.' : 'Nothing flagged.', ''];
  rows.forEach(function (r) {
    text.push('- ' + nidWhen_(r) + ' | ' + r.account_name + ' | ' + r.nm_name + ' | ' + r.reason +
      (r.score !== '' ? ' | ' + r.score + '/10' : '') + (nidHot_(r).length ? ' | ' + nidHot_(r).map(function (f) { return NID_FLAG[f]; }).join(', ') : '') +
      (r.pdf_url ? ' | ' + r.pdf_url : '') + (r._src === 'jotform' ? ' | Jotform' : ''));
  });
  text.push('', 'Review them in the Ops Hub ' + hubUrl);

  return { subject: subject, htmlBody: cwShell_(label, sub, html, 'Sent every morning at 7 from the City Wide Nevada team platform. Covers recaps filed on the hub and on the Jotform. GoCityWide.com'), body: text.join('\n') };
}

function nidScore_(r) {
  var F = CW_HTML_F;
  if (r.score === '' || isNaN(Number(r.score))) return '<span style="' + F + 'font-size:12px;color:#999999;">no score</span>';
  var low = Number(r.score) < NI_LOW_SCORE;
  return '<span style="' + F + 'font-size:15px;font-weight:bold;color:' + (low ? '#D22730' : '#2d2a26') + ';">' + nidE_(r.score) + '</span><span style="' + F + 'font-size:10px;color:#636466;">/10</span>';
}
function nidLinks_(r, key) {
  var F = CW_HTML_F;
  var a = [];
  if (r.pdf_url) a.push('<a href="' + nidE_(r.pdf_url) + '" style="' + F + 'font-size:12px;font-weight:bold;color:#D22730;text-decoration:underline;">PDF</a>');
  if (r._src === 'jotform') a.push('<a href="' + nidE_(r._link) + '" style="' + F + 'font-size:12px;font-weight:bold;color:#D22730;text-decoration:underline;">Jotform recap</a>');
  var n = Number(r.photo_count) || 0;
  if (n && r._src === 'jotform') a.push('<span style="' + F + 'font-size:12px;color:#636466;">' + nidPlural_(n, 'photo') + ' on the Jotform</span>');
  if (n && r.photo_folder_url) a.push('<a href="' + nidE_(r.photo_folder_url) + '" style="' + F + 'font-size:12px;color:#2d2a26;text-decoration:underline;">' + nidPlural_(n, 'photo') + '</a>');
  a.push('<a href="' + nidE_(NID_HUB + '?m=' + key + '&q=' + encodeURIComponent(r.account_name || '')) + '" style="' + F + 'font-size:12px;color:#2d2a26;text-decoration:underline;">Hub</a>');
  return a.join(' &nbsp;&middot;&nbsp; ');
}
function nidChips_(codes) {
  var F = CW_HTML_F;
  return codes.map(function (f) {
    var hot = NID_HOT.indexOf(f) >= 0;
    return '<span style="display:inline-block;margin:4px 4px 0 0;padding:2px 8px;border-radius:10px;' + F + 'font-size:10px;font-weight:bold;' +
      (hot ? 'background:#fdecec;color:#a61d24;' : 'background:#F0F0F0;color:#636466;') + '">' + nidE_(NID_FLAG[f] || f) + '</span>';
  }).join('');
}
// Full card for a recap that needs a look: what was flagged and the words behind it.
function nidCard_(r, key) {
  var F = CW_HTML_F;
  var hot = nidHot_(r);
  var det = [];
  var add = function (k, v) { v = nidStr_(v); if (v) det.push([k, v]); };
  if (hot.indexOf('complaint') >= 0) {
    add('Complaint', [r.complaint_what, r.complaint_areas].map(nidStr_).filter(Boolean).join(' | ') || 'Flagged with no details');
    if (r.complaint_resolved) add('Complaint fixed', r.complaint_resolved + (r.complaint_blocker ? ' | ' + r.complaint_blocker : ''));
  }
  if (r.fsm_action_needed === 'Yes') add('For the FSM', r.fsm_action_note || 'Follow-up requested');
  add('What was wrong', r.score_note);
  if (hot.indexOf('standards_failed') >= 0) add('Standard not met', r.standards_failed);
  if (hot.indexOf('unresolved') >= 0) add('Still open', [r.issue_remaining, r.issue_owner, r.issue_due].map(nidStr_).filter(Boolean).join(' | '));
  if (hot.indexOf('uniform') >= 0) add('Uniform', [r.crew_uniform, r.crew_uniform_note].map(nidStr_).filter(Boolean).join(' | '));
  var rowsHtml = det.map(function (p) {
    return '<tr><td width="1%" style="padding:4px 12px 4px 0;' + F + 'font-size:11px;color:#636466;white-space:nowrap;vertical-align:top;">' + nidE_(p[0]) + '</td>' +
      '<td style="padding:4px 0;' + F + 'font-size:13px;color:#2d2a26;line-height:1.45;">' + nidE_(nidCut_(p[1], 400)) + '</td></tr>';
  }).join('');
  return '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 10px;border-collapse:collapse;"><tr>' +
    '<td width="4" bgcolor="#D22730" style="width:4px;"></td>' +
    '<td style="padding:10px 14px;background:#FAFAFA;border:1px solid #EEEEEE;border-left:0;">' +
    '<table border="0" cellpadding="0" cellspacing="0" width="100%"><tr>' +
    '<td style="' + F + 'font-size:14px;font-weight:bold;color:#2d2a26;">' + nidE_(r.account_name) + '</td>' +
    '<td align="right" style="white-space:nowrap;">' + nidScore_(r) + '</td></tr></table>' +
    '<div style="' + F + 'font-size:12px;color:#636466;padding-top:2px;">' + nidE_([r.nm_name, nidWhen_(r), r.reason, r._src === 'jotform' ? 'Jotform' : '', r.vendor_name, r.fsm ? 'FSM ' + r.fsm : ''].map(nidStr_).filter(Boolean).join(' · ')) + '</div>' +
    '<div>' + nidChips_(hot) + '</div>' +
    (rowsHtml ? '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top:8px;">' + rowsHtml + '</table>' : '') +
    '<div style="padding-top:8px;">' + nidLinks_(r, key) + '</div>' +
    '</td></tr></table>';
}
// One compact line for the full log.
function nidLine_(r, key) {
  var F = CW_HTML_F;
  var codes = nidFlags_(r);
  return '<tr>' +
    '<td width="1%" style="padding:9px 12px 9px 0;border-bottom:1px solid #EEEEEE;' + F + 'font-size:11px;color:#636466;white-space:nowrap;vertical-align:top;">' + (r._src === 'jotform' && !r._timeKnown ? nidE_(nidWhen_(r)).replace(' ', '<br>') : nidE_(nidFmt_(r._ts, 'EEE')) + '<br>' + nidE_(nidFmt_(r._ts, 'h:mm a'))) + '</td>' +
    '<td style="padding:9px 10px 9px 0;border-bottom:1px solid #EEEEEE;vertical-align:top;">' +
    '<div style="' + F + 'font-size:13px;font-weight:bold;color:#2d2a26;">' + nidE_(r.account_name) + '</div>' +
    '<div style="' + F + 'font-size:11px;color:#636466;padding-top:1px;">' + nidE_([r.nm_name, r.reason, r.vendor_name, r._src === 'jotform' ? 'Jotform' : ''].map(nidStr_).filter(Boolean).join(' · ')) + '</div>' +
    (r.summary ? '<div style="' + F + 'font-size:12px;color:#2d2a26;line-height:1.45;padding-top:4px;">' + nidE_(nidCut_(r.summary, 220)) + '</div>' : '') +
    (codes.length ? '<div>' + nidChips_(codes) + '</div>' : '') +
    '<div style="padding-top:5px;">' + nidLinks_(r, key) + '</div></td>' +
    '<td width="1%" align="right" style="padding:9px 0;border-bottom:1px solid #EEEEEE;white-space:nowrap;vertical-align:top;">' + nidScore_(r) + '</td>' +
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
    var out = [];
    nidRecipients_().forEach(function (rc) {
      var pk = 'NID_LAST_' + rc.key;
      var since = Number(props.getProperty(pk)) || first;
      var rows = nidRows_(rc.market, since, cutoff);
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
  Logger.log(out.join('\n'));
  return out.join('\n');
}

// One-time setup. Safe to run again.
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
  Logger.log(out.join('\n'));
  return out.join('\n');
}
