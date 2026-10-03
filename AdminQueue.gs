// ============================================================
// AdminQueue.gs - Ops Admin task queue (Oct 3 2026)
// File in the CW Team Portal Backend Apps Script project (still "CW Solicitations"
// in most comments). Routing: doPost routes any kind starting 'aq_' to aqDispatch(data).
//
// The queue sits on the Admin Hub home page (cw-admin-hub/index.html) between Most
// Used and the feature cards. It is the ops admin's work list: everything an IC
// signing up produces that needs a human to look at it, plus every crew background
// check from either market, each with the next step on it.
//
// Three feeds, nothing duplicated:
//   Evaluations     the Evaluations tab (VendorEval.gs). Item until marked reviewed.
//   PandaDoc        completed IC documents pulled from the PandaDoc API (vendor
//                   packets, ACH, W-9, waivers; never proposals or Exhibit As) into
//                   this module's own PandaDoc tab. Item until marked reviewed.
//   Background checks  the BC Requests tab (Onboarding.gs). The request row itself
//                   carries the state, so the onboarding desk and this queue always
//                   agree. Steps: submit through Verified First -> log the result
//                   (Cleared / Not cleared; the person row on the Background checks
//                   tab is written too) -> Las Vegas: print the name badge;
//                   Northern Nevada: notify Jeremy Walker the person is approved for
//                   a badge. Requests that only need a badge start at the badge step.
//
// Window: only items received in the last AQ_DAYS (21) days. Older ones never appear.
//
// Own storage, per TJ's rule (one subject, one book, one folder):
//   Book   "CW Admin Task Queue"  (script property AQ_SHEET_ID)
//   Folder "CW Admin Task Queue"  (script property AQ_FOLDER_ID), under Team Portal > Team and Admin
//   Tabs   Done      one row per evaluation / PandaDoc item marked reviewed (key, who, when)
//          PandaDoc  one row per completed IC document pulled from PandaDoc
//          Log       every queue action (background check steps included)
//
// Kinds (team passcode):
//   aq_list   {}                      -> {ok, items:[...], counts, pandadoc:{on, synced, error}, fetched}
//   aq_done   {key, type, title, market, who, undo?} -> mark an eval / PandaDoc item reviewed (or undo)
//   aq_bc     {req_id, action, who}   -> action: sent | clear | notclear | badge | notify
//   aq_sync   {force?}                -> pull PandaDoc now (also runs inside aq_list, throttled)
//   aq_setup  {}                      -> create the book, folder and tabs (safe to re-run)
//
//   aq_pd_auth {client_id, client_secret, code, redirect_uri} -> one-time OAuth exchange,
//                                        stores the tokens in script properties
//   (no kind)  a JSON array = a PandaDoc webhook delivery -> aqPandaHook_ (doPost routes it)
//
// PandaDoc auth: an OAuth application from PandaDoc Dev Center (script properties
// PANDADOC_CLIENT_ID / PANDADOC_CLIENT_SECRET / PANDADOC_ACCESS_TOKEN /
// PANDADOC_REFRESH_TOKEN / PANDADOC_TOKEN_EXP, written by aq_pd_auth; the access
// token is refreshed here when it nears expiry). A production API key in
// PANDADOC_API_KEY also works. Without either, the queue still runs for evaluations
// and background checks and says PandaDoc is off.
// ============================================================

var AQ_SHEET_PROP = 'AQ_SHEET_ID';
var AQ_FOLDER_PROP = 'AQ_FOLDER_ID';
var AQ_BOOK_NAME = 'CW Admin Task Queue';
var AQ_EDITOR = 'tjroberts@gocitywide.com';
var AQ_DAYS = 21;
var AQ_TAB_DONE = 'Done';
var AQ_TAB_PD = 'PandaDoc';
var AQ_TAB_LOG = 'Log';
var AQ_DONE_HEADERS = ['key', 'type', 'title', 'market', 'done_by', 'done_at', 'note'];
var AQ_PD_HEADERS = ['doc_id', 'name', 'completed', 'vendor', 'contact', 'email', 'market', 'url', 'template', 'synced'];
var AQ_LOG_HEADERS = ['when', 'who', 'type', 'key', 'action', 'title', 'market', 'note'];

// PandaDoc document names that belong to an IC signing up. Everything else
// (customer proposals, Exhibit As, ledgers, Ken's PMs) is ignored.
var AQ_PD_MATCH = /IC Vendor Packet|Vendor Packet|\bACH\b|W-?9|Waiver|IC Agreement|Acknowledg|Independent Contractor|Vendor Form|Direct Deposit/i;
var AQ_PD_SKIP = /Exhibit A|Proposal|Ledger|Quote|Ken's PMs|Invoice/i;
var AQ_PD_API = 'https://api.pandadoc.com/public/v1/documents';
var AQ_PD_TOKEN_URL = 'https://api.pandadoc.com/oauth2/access_token';
var AQ_PD_KEY_PROP = 'PANDADOC_API_KEY';
var AQ_PD_PROPS = { id: 'PANDADOC_CLIENT_ID', secret: 'PANDADOC_CLIENT_SECRET', access: 'PANDADOC_ACCESS_TOKEN', refresh: 'PANDADOC_REFRESH_TOKEN', exp: 'PANDADOC_TOKEN_EXP' };
var AQ_PD_CACHE = 'aqPdSynced';
var AQ_PD_CACHE_SEC = 900;   // sync at most every 15 minutes from aq_list

// Northern Nevada name badges are printed in Reno. Jeremy Walker gets the notice.
var AQ_NNV_BADGE_TO = 'jeremy.walker@gocitywide.com';
var AQ_NNV_BADGE_NAME = 'Jeremy Walker';
var AQ_DESK_URL = 'https://citywidelv.github.io/cw-admin-hub/onboarding.html';

// ------------------------------------------------------------ dispatch ----

function aqDispatch(data) {
  var kind = String(data.kind || '');
  try {
    if ((data.passcode || '') === '' || (data.passcode || '') !== vdPass_()) {
      return vdOut_({ ok: false, error: 'Wrong passcode.' });
    }
    if (kind === 'aq_list') return aqList_(data);
    if (kind === 'aq_done') return aqDone_(data);
    if (kind === 'aq_bc') return aqBc_(data);
    if (kind === 'aq_sync') return vdOut_(aqPandaSync_(!!data.force));
    if (kind === 'aq_pd_auth') return aqPandaAuth_(data);
    if (kind === 'aq_setup') return aqSetup_(data);
    return vdOut_({ ok: false, error: 'Unknown aq kind' });
  } catch (e) {
    return vdOut_({ ok: false, error: String(e && e.message ? e.message : e), where: kind });
  }
}

// ------------------------------------------------------------ storage -----

function aqNow_() { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'); }
function aqToday_() { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd'); }
function aqWhen_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm');
  return String(v == null ? '' : v).trim();
}

function aqFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(AQ_FOLDER_PROP) || '';
  var folder = null;
  if (id) { try { folder = DriveApp.getFolderById(id); } catch (e) { folder = null; } }
  if (!folder) {
    folder = DriveApp.createFolder(AQ_BOOK_NAME);
    props.setProperty(AQ_FOLDER_PROP, folder.getId());
    try { folder.addEditor(AQ_EDITOR); } catch (e) {}
    try {
      var tp = DriveApp.getFoldersByName('Team Portal');
      if (tp.hasNext()) {
        var sub = tp.next().getFoldersByName('Team and Admin');
        if (sub.hasNext()) folder.moveTo(sub.next());
      }
    } catch (e2) {}
  }
  return folder;
}

function aqBook_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(AQ_SHEET_PROP) || '';
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(AQ_BOOK_NAME);
    props.setProperty(AQ_SHEET_PROP, ss.getId());
    try { DriveApp.getFileById(ss.getId()).addEditor(AQ_EDITOR); } catch (e) {}
    try { DriveApp.getFileById(ss.getId()).moveTo(aqFolder_()); } catch (e2) {}
  }
  return ss;
}

function aqTab_(ss, name, headers, color) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    var first = ss.getSheets()[0];
    if (first && first.getName() === 'Sheet1' && first.getLastRow() === 0) { sh = first; sh.setName(name); }
    else sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground(color).setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    return sh;
  }
  var last = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, last).getValues()[0].map(vdStr_);
  var missing = headers.filter(function (h) { return head.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground(color).setFontColor('#FFFFFF');
  }
  return sh;
}

function aqRows_(sh) {
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return { head: (vals[0] || []).map(vdStr_), rows: [] };
  var head = vals[0].map(vdStr_);
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    if (!vdStr_(vals[i][0])) continue;
    var o = { _row: i + 1 };
    for (var c = 0; c < head.length; c++) if (head[c]) o[head[c]] = aqWhen_(vals[i][c]);
    rows.push(o);
  }
  return { head: head, rows: rows };
}

function aqAppend_(sh, obj) {
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(vdStr_);
  sh.appendRow(head.map(function (h) { return obj[h] == null ? '' : String(obj[h]); }));
}

function aqLog_(ss, e) {
  try {
    var sh = aqTab_(ss, AQ_TAB_LOG, AQ_LOG_HEADERS, '#636466');
    sh.appendRow([aqNow_(), e.who || '', e.type || '', e.key || '', e.action || '', e.title || '', e.market || '', String(e.note || '').slice(0, 2000)]);
  } catch (err) {}
}

function aqSetup_(data) {
  var ss = aqBook_();
  aqTab_(ss, AQ_TAB_DONE, AQ_DONE_HEADERS, '#1E8E5A');
  aqTab_(ss, AQ_TAB_PD, AQ_PD_HEADERS, '#2F6FD6');
  aqTab_(ss, AQ_TAB_LOG, AQ_LOG_HEADERS, '#636466');
  return vdOut_({ ok: true, sheet: ss.getUrl(), folder: aqFolder_().getUrl() });
}

// ------------------------------------------------------------ list --------

// Window start as 'yyyy-MM-dd HH:mm' text so it compares against the stamps the
// feeds write (and the normalized Date reads).
function aqWindowStart_() {
  var d = new Date(Date.now() - AQ_DAYS * 86400000);
  return Utilities.formatDate(d, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm');
}
function aqMarket_(raw) {
  var s = vdStr_(raw).toLowerCase();
  if (s === 'lv' || s === 'nnv') return s;
  if (/north(ern)? ?nevada|nnv|reno|sparks|carson/.test(s) && !/north las vegas/.test(s)) return 'nnv';
  if (/las vegas|lv|southern|henderson|both/.test(s)) return 'lv';
  return 'lv';
}

function aqList_(data) {
  var ss = aqBook_();
  var since = aqWindowStart_();
  var done = {};
  aqRows_(aqTab_(ss, AQ_TAB_DONE, AQ_DONE_HEADERS, '#1E8E5A')).rows.forEach(function (r) { done[r.key] = r; });

  var items = [];

  // 1. Vendor evaluations
  var evals = [];
  try {
    var esh = (typeof vevSheet_ === 'function') ? vevSheet_() : null;
    if (esh && esh.getLastRow() > 1) {
      var vals = esh.getRange(2, 1, esh.getLastRow() - 1, VEV_HEADERS.length).getValues();
      vals.forEach(function (r) {
        var o = {};
        VEV_HEADERS.forEach(function (h, i) { o[h] = aqWhen_(r[i]); });
        if (!o.eval_id || o.received < since) return;
        var key = 'eval:' + o.eval_id;
        if (done[key]) return;
        evals.push({
          key: key, type: 'eval', market: aqMarket_(o.market), received: o.received,
          title: o.vendor || o.legal_name || 'Vendor evaluation', sub: [o.contact_name, o.email, o.services || o.service_types].filter(Boolean).join(' · '),
          action_note: o.action || '', vendor_id: o.vendor_id || '', pdf_url: o.pdf_url || '',
          link: o.vendor_id ? 'vendor-profile.html#' + o.vendor_id : 'onboarding.html',
          step: 'review', step_label: 'Review the evaluation'
        });
      });
    }
  } catch (ee) { evals = []; }

  // 2. PandaDoc IC documents (synced at most every 15 minutes)
  var pd = { on: false, synced: '', error: '' };
  var packets = [];
  try {
    var sync = aqPandaSync_(false);
    pd.on = !!sync.on; pd.synced = sync.synced || ''; pd.error = sync.error || '';
    aqRows_(aqTab_(ss, AQ_TAB_PD, AQ_PD_HEADERS, '#2F6FD6')).rows.forEach(function (r) {
      if (!r.doc_id || r.completed < since) return;
      var key = 'pd:' + r.doc_id;
      if (done[key]) return;
      packets.push({
        key: key, type: 'packet', market: aqMarket_(r.market), received: r.completed,
        title: r.vendor || r.name, sub: [r.name, r.contact, r.email].filter(Boolean).join(' · '),
        link: r.url || '', step: 'review', step_label: 'Review the signed document'
      });
    });
  } catch (pe) { pd.error = String(pe && pe.message || pe); }

  // 3. Background check requests (both markets), state read off the request row
  var bcs = [];
  try {
    var vss = vdSS_();
    var rsh = vss.getSheetByName(OB_REQ_TAB);
    if (rsh) {
      obRows_(rsh).rows.forEach(function (r) {
        r.status = obReqStatus_(r.status);
        if (!r.req_id || r.dupe_of) return;
        if (aqWhen_(r.received) < since) return;
        var st = aqBcStep_(r);
        if (!st) return;
        var person = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.legal_name;
        bcs.push({
          key: 'bc:' + r.req_id, type: 'bc', market: r.market === 'nnv' ? 'nnv' : 'lv', received: aqWhen_(r.received),
          req_id: r.req_id, title: person, sub: [r.company, r.request_type, r.client_account ? 'for ' + r.client_account : ''].filter(Boolean).join(' · '),
          status: r.status, badge: r.badge || '', sent: r.sent || '', report_link: r.report_link || '', vendor_id: r.vendor_id || '',
          link: 'onboarding.html#bc', step: st.step, step_label: st.label, actions: st.actions
        });
      });
    }
  } catch (be) {}

  var byDate = function (a, b) { return a.received < b.received ? 1 : -1; };
  bcs.sort(byDate); evals.sort(byDate); packets.sort(byDate);
  items = bcs.concat(evals, packets);

  // Done in the last 7 days, so a wrong click can be undone from the page.
  var recentDone = [];
  var weekAgo = Utilities.formatDate(new Date(Date.now() - 7 * 86400000), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm');
  Object.keys(done).forEach(function (k) { var r = done[k]; if (r.done_at >= weekAgo) recentDone.push({ key: r.key, type: r.type, title: r.title, market: r.market, done_by: r.done_by, done_at: r.done_at }); });
  recentDone.sort(function (a, b) { return a.done_at < b.done_at ? 1 : -1; });

  return vdOut_({ ok: true, items: items, counts: { bc: bcs.length, eval: evals.length, packet: packets.length, total: items.length },
                  done: recentDone.slice(0, 20), pandadoc: pd, days: AQ_DAYS, fetched: new Date().toISOString() });
}

// The next step for a background check request, or null when nothing is left.
function aqBcStep_(r) {
  var status = obReqStatus_(r.status);
  var badge = vdStr_(r.badge);
  var nnv = r.market === 'nnv';
  if (status === 'Not cleared' || status === 'Closed') return null;
  if (status === 'New') return { step: 'vf', label: 'Submit through Verified First', actions: ['sent'] };
  if (status === 'Review report') return { step: 'result', label: 'Review the vendor-run report and log the result', actions: ['clear', 'notclear'] };
  if (status === 'Sent') return { step: 'result', label: 'Log the result from Verified First', actions: ['clear', 'notclear'] };
  // Cleared, or a badge-only request
  if (badge === 'Delivered') return null;
  if (nnv && badge === 'Ordered') return null;
  if (nnv) return { step: 'badge', label: 'Approved. Notify Jeremy Walker to print the name badge', actions: ['notify'] };
  return { step: 'badge', label: 'Approved. Print the name badge', actions: ['badge'] };
}

// ------------------------------------------------------------ done --------

function aqDone_(data) {
  var ss = aqBook_();
  var key = vdStr_(data.key);
  if (!key) return vdOut_({ ok: false, error: 'No item key.' });
  var who = vdStr_(data.who) || 'Admin Hub';
  var sh = aqTab_(ss, AQ_TAB_DONE, AQ_DONE_HEADERS, '#1E8E5A');
  var rr = aqRows_(sh);
  var hit = rr.rows.filter(function (r) { return r.key === key; })[0];
  if (data.undo) {
    if (hit) sh.getRange(hit._row, 1, 1, rr.head.length).clearContent();
    aqLog_(ss, { who: who, type: vdStr_(data.type), key: key, action: 'undo reviewed', title: vdStr_(data.title), market: vdStr_(data.market) });
    return vdOut_({ ok: true, undone: !!hit });
  }
  if (!hit) {
    aqAppend_(sh, { key: key, type: vdStr_(data.type), title: vdStr_(data.title), market: vdStr_(data.market), done_by: who, done_at: aqNow_(), note: vdStr_(data.note) });
  }
  aqLog_(ss, { who: who, type: vdStr_(data.type), key: key, action: 'reviewed', title: vdStr_(data.title), market: vdStr_(data.market), note: vdStr_(data.note) });
  // An evaluation marked reviewed also ticks the vendor's onboarding checklist item
  // to Verified, when the vendor has an onboarding row. Best effort, never required.
  if (key.indexOf('eval:') === 0 && vdStr_(data.vendor_id)) {
    try {
      var vss = vdSS_();
      var osh = vss.getSheetByName(OB_TAB);
      if (osh) {
        var orr = obRows_(osh);
        var row = orr.rows.filter(function (r) { return r.vendor_id === vdStr_(data.vendor_id); })[0];
        if (row) obFeedDoc_(vss, { row: row, sh: osh, head: orr.head }, 'eval', 'verified', 'Reviewed from the Admin Hub task queue ' + aqToday_(), who);
      }
    } catch (oe) {}
  }
  return vdOut_({ ok: true });
}

// ------------------------------------------------------------ bc flow -----

// {req_id, action, who}. action: sent | clear | notclear | badge | notify
function aqBc_(data) {
  var ss = aqBook_();
  var vss = vdSS_();
  var rid = vdStr_(data.req_id), action = vdStr_(data.action), who = vdStr_(data.who) || 'Admin Hub';
  var rsh = vss.getSheetByName(OB_REQ_TAB);
  if (!rsh) return vdOut_({ ok: false, error: 'No BC Requests tab.' });
  var row = obRows_(rsh).rows.filter(function (r) { return r.req_id === rid; })[0];
  if (!row) return vdOut_({ ok: false, error: 'Request not found. Reload the page.' });
  row.status = obReqStatus_(row.status);
  var person = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.legal_name;
  var market = row.market === 'nnv' ? 'nnv' : 'lv';
  var upd = { req_id: rid, who: who };
  var note = '';
  var out = { ok: true };

  if (action === 'sent') {
    upd.status = 'Sent';
    note = 'Submitted through Verified First ' + aqToday_() + ' by ' + who;
  } else if (action === 'clear' || action === 'notclear') {
    var clear = action === 'clear';
    upd.status = clear ? 'Cleared' : 'Not cleared';
    note = (clear ? 'Cleared' : 'Not cleared') + ' ' + aqToday_() + ' by ' + who;
    // The person row on the Background checks <market> tab is the source of truth
    // for Clear / Not clear (the Ops Hub list reads it). Same dedupe as the desk.
    try {
      var prow = { market: market, first_name: row.first_name, last_name: row.last_name, result: clear ? 'Clear' : 'Not clear' };
      if (row.vendor_id) prow.vendor_id = row.vendor_id; else prow.vendor = row.company;
      var up = JSON.parse(vdBcUpsert_({ rows: [prow], reviewed_by: who }).getContent());
      out.person = up;
    } catch (ue) { out.person_error = String(ue && ue.message || ue); }
  } else if (action === 'badge') {
    upd.badge = 'Delivered';
    note = 'Name badge printed ' + aqToday_() + ' by ' + who;
  } else if (action === 'notify') {
    if (market !== 'nnv') return vdOut_({ ok: false, error: 'Only Northern Nevada badges go to Jeremy.' });
    var test = !!data._test;
    var to = test ? 'tjroberts@gocitywide.com' : AQ_NNV_BADGE_TO;
    var subject = (test ? 'TEST ' : '') + 'Name badge approved: ' + person + ' (' + (row.company || 'vendor') + ')';
    var lines = [
      'Hi ' + AQ_NNV_BADGE_NAME.split(' ')[0] + ',', '',
      person + ' with ' + (row.company || 'a vendor') + ' is cleared and approved for a City Wide name badge.',
      'Please print the badge and get it to them.', '',
      'Request: ' + rid + (row.client_account ? '  Account: ' + row.client_account : ''),
      'Approved by: ' + who + ', ' + aqToday_(), '',
      'Onboarding desk: ' + AQ_DESK_URL + '#bc'
    ];
    var html = '';
    try {
      var F = CW_HTML_F;
      var facts = cwFacts_([['Person', person], ['Company', row.company || ''], ['Request', rid], ['Account', row.client_account || ''], ['Approved by', who + ', ' + aqToday_()]].filter(function (p) { return p[1]; }));
      html = cwShell_('Name badge approved', 'Northern Nevada', '<p style="margin:0 0 12px;' + F + 'font-size:15px;font-weight:bold;color:#2d2a26;">' + cwEscT_(person) + ' is approved for a name badge</p>' +
        '<p style="margin:0 0 14px;' + F + 'font-size:12.5px;color:#2d2a26;line-height:1.6;">Background check cleared. Please print the City Wide name badge and get it to them.</p>' + facts +
        cwButton_('Open the onboarding desk', AQ_DESK_URL + '#bc'), 'Sent by the City Wide Nevada team platform from the Admin Hub task queue. GoCityWide.com');
    } catch (he) { html = ''; }
    var mail = { to: to, name: 'City Wide Northern Nevada Compliance', replyTo: 'rncompliance@gocitywide.com', subject: subject, body: lines.join('\n') };
    if (html) mail.htmlBody = html;
    if (!test) mail.cc = 'rncompliance@gocitywide.com';
    cwMail_('aq_badge_nnv', mail);
    upd.badge = 'Ordered';
    note = 'Jeremy Walker notified ' + aqToday_() + ' by ' + who + ' (badge approved)' + (test ? ' [test send to TJ]' : '');
    out.sent_to = to;
  } else {
    return vdOut_({ ok: false, error: 'Unknown action ' + action });
  }
  upd.notes = ((row.notes || '') + '\n' + note).trim().slice(0, 4000);
  var res = JSON.parse(obBcUpdate_(upd).getContent());
  if (!res.ok) return vdOut_(res);
  // Re-read for the next step so the page can swap the row in place.
  var fresh = obRows_(rsh).rows.filter(function (r) { return r.req_id === rid; })[0] || row;
  fresh.status = obReqStatus_(fresh.status);
  var st = aqBcStep_(fresh);
  aqLog_(ss, { who: who, type: 'bc', key: 'bc:' + rid, action: action, title: person, market: market, note: note });
  out.status = fresh.status; out.badge = fresh.badge || ''; out.step = st ? st.step : ''; out.step_label = st ? st.label : ''; out.actions = st ? st.actions : [];
  out.done = !st;
  return vdOut_(out);
}

// ------------------------------------------------------------ PandaDoc ----

// Pull completed IC documents from PandaDoc into the PandaDoc tab. Throttled with
// the script cache unless force. Returns {on, synced, added, error}.
// Authorization header value: OAuth bearer token (refreshed when it nears expiry)
// or the production API key. '' when neither is set up.
function aqPandaAuthHeader_() {
  var props = PropertiesService.getScriptProperties();
  var key = String(props.getProperty(AQ_PD_KEY_PROP) || '').trim();
  if (key) return 'API-Key ' + key;
  var access = String(props.getProperty(AQ_PD_PROPS.access) || '').trim();
  if (!access) return '';
  var exp = Number(props.getProperty(AQ_PD_PROPS.exp) || 0);
  if (exp && Date.now() > exp - 7 * 86400000) {
    var refresh = String(props.getProperty(AQ_PD_PROPS.refresh) || '').trim();
    var cid = String(props.getProperty(AQ_PD_PROPS.id) || '').trim(), sec = String(props.getProperty(AQ_PD_PROPS.secret) || '').trim();
    if (refresh && cid && sec) {
      try {
        var r = UrlFetchApp.fetch(AQ_PD_TOKEN_URL, { method: 'post', payload: { grant_type: 'refresh_token', client_id: cid, client_secret: sec, refresh_token: refresh, scope: 'read+write' }, muteHttpExceptions: true });
        if (r.getResponseCode() === 200) {
          var t = JSON.parse(r.getContentText());
          if (t.access_token) {
            props.setProperty(AQ_PD_PROPS.access, t.access_token);
            if (t.refresh_token) props.setProperty(AQ_PD_PROPS.refresh, t.refresh_token);
            props.setProperty(AQ_PD_PROPS.exp, String(Date.now() + Number(t.expires_in || 31536000) * 1000));
            access = t.access_token;
          }
        }
      } catch (e) {}
    }
  }
  return 'Bearer ' + access;
}

// One-time OAuth exchange. {client_id, client_secret, code, redirect_uri}. Team passcode.
function aqPandaAuth_(data) {
  var cid = vdStr_(data.client_id), sec = vdStr_(data.client_secret), code = vdStr_(data.code), redir = vdStr_(data.redirect_uri);
  if (!cid || !sec || !code) return vdOut_({ ok: false, error: 'client_id, client_secret and code are required.' });
  var r = UrlFetchApp.fetch(AQ_PD_TOKEN_URL, { method: 'post', payload: { grant_type: 'authorization_code', client_id: cid, client_secret: sec, code: code, scope: 'read+write', redirect_uri: redir }, muteHttpExceptions: true });
  var codeN = r.getResponseCode();
  if (codeN !== 200) return vdOut_({ ok: false, error: 'PandaDoc token HTTP ' + codeN + ': ' + String(r.getContentText()).slice(0, 300) });
  var t = JSON.parse(r.getContentText());
  if (!t.access_token) return vdOut_({ ok: false, error: 'No access token in the reply.' });
  var props = PropertiesService.getScriptProperties();
  props.setProperty(AQ_PD_PROPS.id, cid);
  props.setProperty(AQ_PD_PROPS.secret, sec);
  props.setProperty(AQ_PD_PROPS.access, t.access_token);
  if (t.refresh_token) props.setProperty(AQ_PD_PROPS.refresh, t.refresh_token);
  props.setProperty(AQ_PD_PROPS.exp, String(Date.now() + Number(t.expires_in || 31536000) * 1000));
  try { CacheService.getScriptCache().remove(AQ_PD_CACHE); } catch (ce) {}
  var sync = aqPandaSync_(true);
  return vdOut_({ ok: true, expires_in: t.expires_in || '', scope: t.scope || '', sync: sync });
}

function aqPandaSync_(force) {
  var auth = '';
  try { auth = aqPandaAuthHeader_(); } catch (e) {}
  if (!auth) return { on: false, synced: '', added: 0, error: 'PandaDoc is not connected yet.' };
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (ce) { cache = null; }
  if (!force && cache) {
    var last = cache.get(AQ_PD_CACHE);
    if (last) return { on: true, synced: last, added: 0, error: '' };
  }
  var ss = aqBook_();
  var sh = aqTab_(ss, AQ_TAB_PD, AQ_PD_HEADERS, '#2F6FD6');
  var have = {};
  aqRows_(sh).rows.forEach(function (r) { have[r.doc_id] = true; });
  var fromIso = new Date(Date.now() - (AQ_DAYS + 2) * 86400000).toISOString();
  var hdr = { 'Authorization': auth, 'Content-Type': 'application/json' };
  var added = 0, error = '';
  try {
    var url = AQ_PD_API + '?status=2&count=100&order_by=-date_completed&completed_from=' + encodeURIComponent(fromIso);
    var resp = UrlFetchApp.fetch(url, { method: 'get', headers: hdr, muteHttpExceptions: true });
    var code = resp.getResponseCode();
    if (code !== 200) throw new Error('PandaDoc list HTTP ' + code + ': ' + String(resp.getContentText()).slice(0, 200));
    var list = JSON.parse(resp.getContentText()).results || [];
    list.forEach(function (d) {
      var name = String(d.name || '').trim();
      if (!d.id || have[d.id]) return;
      if (!AQ_PD_MATCH.test(name) || AQ_PD_SKIP.test(name)) return;
      var det = {};
      try {
        var r2 = UrlFetchApp.fetch(AQ_PD_API + '/' + d.id + '/details', { method: 'get', headers: hdr, muteHttpExceptions: true });
        if (r2.getResponseCode() === 200) det = JSON.parse(r2.getContentText());
      } catch (de) { det = {}; }
      var tok = {};
      (det.tokens || []).forEach(function (t) { tok[String(t.name || '')] = String(t.value || ''); });
      var signer = (det.recipients || []).filter(function (p) { return p.recipient_type === 'signer' && !/gocitywide\.com$/i.test(String(p.email || '')); })[0] || {};
      var vendor = tok['Vendor.Company'] || tok['Client.Company'] || tok['Company'] || '';
      var contact = [signer.first_name, signer.last_name].filter(Boolean).join(' ') || [tok['Vendor.FirstName'], tok['Vendor.LastName']].filter(Boolean).join(' ');
      var email = signer.email || tok['Vendor.Email'] || '';
      if (!vendor && contact) vendor = contact;
      var market = /NNV|Northern Nevada|Reno|Sparks|Carson/i.test(name) ? 'nnv' : (/Las Vegas|\bLV\b/i.test(name) ? 'lv' : aqMarket_(tok['Vendor.City'] || ''));
      var completed = aqWhen_(d.date_completed ? new Date(d.date_completed) : '');
      aqAppend_(sh, { doc_id: d.id, name: name, completed: completed, vendor: vendor, contact: contact, email: email, market: market,
                      url: d.document_url || ('https://app.pandadoc.com/a/#/documents/' + d.id), template: (det.template && det.template.name) || '', synced: aqNow_() });
      have[d.id] = true; added++;
    });
  } catch (e) { error = String(e && e.message || e); }
  var stamp = aqNow_();
  if (!error && cache) { try { cache.put(AQ_PD_CACHE, stamp, AQ_PD_CACHE_SEC); } catch (ce2) {} }
  if (added) aqLog_(ss, { who: 'PandaDoc sync', type: 'packet', action: 'synced', note: added + ' new document(s)' });
  return { on: true, synced: stamp, added: added, error: error };
}

// PandaDoc webhook receiver. PandaDoc posts a JSON ARRAY of events to the /exec URL
// (no kind, no passcode), so doPost hands any array payload here. Only
// document_state_changed with status document.completed on an IC document is kept;
// everything else is acknowledged and dropped. Dedupes on doc_id, so PandaDoc
// retrying a delivery (it sees Google's 302, not the 200 behind it) is harmless.
// Payload shape: [{event, data:{id, name, status, date_completed, recipients, tokens, ...}}]
function aqPandaHook_(arr) {
  var added = 0, seen = 0;
  try {
    var ss = aqBook_();
    var sh = aqTab_(ss, AQ_TAB_PD, AQ_PD_HEADERS, '#2F6FD6');
    var have = {};
    aqRows_(sh).rows.forEach(function (r) { have[r.doc_id] = true; });
    (arr || []).forEach(function (ev) {
      var d = (ev && ev.data) || {};
      var evName = String(ev && ev.event || '');
      seen++;
      if (!d.id || !/document_state_changed|document_completed/i.test(evName)) return;
      if (!/completed/i.test(String(d.status || ''))) return;
      var name = String(d.name || '').trim();
      if (have[d.id] || !AQ_PD_MATCH.test(name) || AQ_PD_SKIP.test(name)) return;
      var tok = {};
      (d.tokens || []).forEach(function (t) { tok[String(t.name || '')] = String(t.value || ''); });
      var signer = (d.recipients || []).filter(function (p) { return (p.recipient_type || 'signer') === 'signer' && !/gocitywide\.com$/i.test(String(p.email || '')); })[0] || {};
      var vendor = tok['Vendor.Company'] || tok['Client.Company'] || tok['Company'] || '';
      var contact = [signer.first_name, signer.last_name].filter(Boolean).join(' ') || [tok['Vendor.FirstName'], tok['Vendor.LastName']].filter(Boolean).join(' ');
      var email = signer.email || tok['Vendor.Email'] || '';
      if (!vendor && contact) vendor = contact;
      var market = /NNV|Northern Nevada|Reno|Sparks|Carson/i.test(name) ? 'nnv' : (/Las Vegas|\bLV\b/i.test(name) ? 'lv' : aqMarket_(tok['Vendor.City'] || ''));
      var completed = aqWhen_(d.date_completed ? new Date(d.date_completed) : new Date());
      aqAppend_(sh, { doc_id: d.id, name: name, completed: completed, vendor: vendor, contact: contact, email: email, market: market,
                      url: 'https://app.pandadoc.com/a/#/documents/' + d.id, template: (d.template && d.template.name) || '', synced: aqNow_() + ' webhook' });
      have[d.id] = true; added++;
    });
    if (added) aqLog_(ss, { who: 'PandaDoc webhook', type: 'packet', action: 'received', note: added + ' new document(s)' });
  } catch (e) {
    try { aqLog_(aqBook_(), { who: 'PandaDoc webhook', type: 'packet', action: 'error', note: String(e && e.message || e) }); } catch (e2) {}
  }
  return vdOut_({ ok: true, received: seen, added: added });
}

// Editor helper: run once to confirm the key works and pull everything now.
function aqPandaSyncNow() {
  var r = aqPandaSync_(true);
  Logger.log(JSON.stringify(r));
  return r;
}
