// ============================================================
// Recruiting.gs - Vendor Recruiting queue (Oct 1 2026)
// File in the CW Team Portal Backend Apps Script project (still "CW Solicitations"
// in most comments). Routing: doPost routes any kind starting 'rq_' to rqDispatch(data).
//
// The page: cw-admin-hub/recruiting.html. One queue of every vendor City Wide is
// trying to bring in: invited and not heard back, replied and not started, in
// paperwork, one document away, blocked by an issue, or gone quiet. Vendors who
// are Active or Waiting for Account, or whose checklist is complete, never show.
// The page computes the funnel itself from ob_list (Onboarding.gs) plus what this
// module returns. Nothing in Onboarding.gs or VendorDirectory.gs changes.
//
// Own storage, per TJ's rule (one subject, one book, one folder):
//   Book   "CW Vendor Recruiting"  (script property RQ_SHEET_ID)
//   Folder "CW Vendor Recruiting"  (script property RQ_FOLDER_ID)
//   Tabs   Touches  one row per call, email, text, visit, invite or reply logged
//          Log      every directory field this module changed, old and new value
//          Config   key / value: quiet_days, nudge_days, resend_days, touch_types,
//                   outcomes. Ops edits this tab; no deploy needed.
//
// Kinds (team passcode):
//   rq_list    {}  -> {ok, vendors, intake, touches, config, types, fetched}
//                     vendors: every directory row that is not Active / Waiting for
//                     Account / Do Not Contact and not hidden, with the fields the
//                     queue needs (email hold, outreach date, invite stamps, eval
//                     date, COI dates). The page joins them to ob_list.
//   rq_touch   {vendor_id, vendor, market, type, outcome, note, next, who}
//                  -> {ok, touch}. Appends a Touches row. Stamps the directory
//                     outreach date when the touch went to the vendor.
//   rq_set     {vendor_id, field, value, who} -> {ok, from, to}
//                     Whitelisted directory fields only: status, email_status,
//                     email_note. Written by the live header row, so the two
//                     email columns (added by hand Sep 23 2026, not in VD_HEADERS)
//                     work. Logged with the old value.
//   rq_setup   {}  -> creates the book, folder and tabs (safe to re-run)
// ============================================================

var RQ_SHEET_PROP = 'RQ_SHEET_ID';
var RQ_FOLDER_PROP = 'RQ_FOLDER_ID';
var RQ_BOOK_NAME = 'CW Vendor Recruiting';
var RQ_EDITOR = 'tjroberts@gocitywide.com';
var RQ_TAB_TOUCH = 'Touches';
var RQ_TAB_LOG = 'Log';
var RQ_TAB_CFG = 'Config';

var RQ_TOUCH_HEADERS = ['touch_id', 'when', 'vendor_id', 'vendor', 'market', 'type', 'outcome', 'note', 'next_followup', 'who'];
var RQ_LOG_HEADERS = ['when', 'who', 'vendor_id', 'vendor', 'field', 'from', 'to'];
var RQ_CFG_HEADERS = ['key', 'value', 'hint'];
var RQ_CFG_SEED = [
  ['quiet_days', '30', 'No activity for this many days moves a vendor to Gone quiet.'],
  ['nudge_days', '7', 'Days after an invite with no reply before the queue suggests a nudge.'],
  ['resend_days', '14', 'Days after an invite with no reply before the queue suggests resending it.'],
  ['due_soon_days', '3', 'A follow-up due within this many days shows as due soon.'],
  ['touch_types', 'Call, Email, Text, Visit, Invite sent, Reply received, Orientation booked, Other', 'Touch types on the Log a touch form.'],
  ['outcomes', 'No answer, Left voicemail, Spoke with them, They replied, Scheduled orientation, Sent paperwork, Not interested, Wrong number or email', 'Outcomes on the Log a touch form.']
];

// Directory fields rq_set may write. Nothing else, ever.
var RQ_SET_FIELDS = { status: 1, email_status: 1, email_note: 1 };
var RQ_STATUSES = ['Prospect', 'In Progress', 'Waiting for Account', 'Active', 'Do Not Contact'];

// Touch types that count as City Wide reaching out (stamp the directory outreach date).
var RQ_OUTREACH_TYPES = { 'Call': 1, 'Email': 1, 'Text': 1, 'Visit': 1, 'Invite sent': 1 };

// ------------------------------------------------------------ dispatch ----

function rqDispatch(data) {
  var kind = String(data.kind || '');
  try {
    if ((data.passcode || '') === '' || (data.passcode || '') !== vdPass_()) {
      return vdOut_({ ok: false, error: 'Wrong passcode.' });
    }
    if (kind === 'rq_list') return rqList_(data);
    if (kind === 'rq_touch') return rqTouch_(data);
    if (kind === 'rq_set') return rqSet_(data);
    if (kind === 'rq_setup') return rqSetup_(data);
    return vdOut_({ ok: false, error: 'Unknown rq kind' });
  } catch (e) {
    return vdOut_({ ok: false, error: String(e && e.message ? e.message : e), where: kind });
  }
}

// ------------------------------------------------------------ storage -----

function rqFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(RQ_FOLDER_PROP) || '';
  var folder = null;
  if (id) { try { folder = DriveApp.getFolderById(id); } catch (e) { folder = null; } }
  if (!folder) {
    folder = DriveApp.createFolder(RQ_BOOK_NAME);
    props.setProperty(RQ_FOLDER_PROP, folder.getId());
    try { folder.addEditor(RQ_EDITOR); } catch (e) {}
    // Team Portal > Vendors, when that folder exists under My Drive. Best effort.
    try {
      var tp = DriveApp.getFoldersByName('Team Portal');
      if (tp.hasNext()) {
        var sub = tp.next().getFoldersByName('Vendors');
        if (sub.hasNext()) folder.moveTo(sub.next());
      }
    } catch (e2) {}
  }
  return folder;
}

function rqBook_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(RQ_SHEET_PROP) || '';
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create(RQ_BOOK_NAME);
    props.setProperty(RQ_SHEET_PROP, ss.getId());
    try { DriveApp.getFileById(ss.getId()).addEditor(RQ_EDITOR); } catch (e) {}
    try { DriveApp.getFileById(ss.getId()).moveTo(rqFolder_()); } catch (e2) {}
  }
  return ss;
}

function rqTab_(ss, name, headers, color) {
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

function rqRows_(sh) {
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return { head: (vals[0] || []).map(vdStr_), rows: [] };
  var head = vals[0].map(vdStr_);
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    if (!vdStr_(vals[i][0])) continue;
    var o = { _row: i + 1 };
    for (var c = 0; c < head.length; c++) if (head[c]) o[head[c]] = vdStr_(vals[i][c]);
    rows.push(o);
  }
  return { head: head, rows: rows };
}

function rqAppend_(sh, headers, obj) {
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(vdStr_);
  var row = head.map(function (h) { return obj[h] == null ? '' : String(obj[h]); });
  sh.appendRow(row);
}

function rqConfig_(ss) {
  var sh = rqTab_(ss, RQ_TAB_CFG, RQ_CFG_HEADERS, '#0AA6A9');
  var rows = rqRows_(sh).rows;
  if (!rows.length) {
    sh.getRange(2, 1, RQ_CFG_SEED.length, RQ_CFG_HEADERS.length).setValues(RQ_CFG_SEED);
    rows = rqRows_(sh).rows;
  }
  var cfg = {};
  RQ_CFG_SEED.forEach(function (s) { cfg[s[0]] = s[1]; });
  rows.forEach(function (r) { if (r.key) cfg[r.key] = r.value; });
  return {
    quiet_days: Number(cfg.quiet_days) || 30,
    nudge_days: Number(cfg.nudge_days) || 7,
    resend_days: Number(cfg.resend_days) || 14,
    due_soon_days: Number(cfg.due_soon_days) || 3,
    touch_types: rqList_split_(cfg.touch_types),
    outcomes: rqList_split_(cfg.outcomes)
  };
}
function rqList_split_(s) { return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x; }); }

function rqSetup_(data) {
  var ss = rqBook_();
  rqTab_(ss, RQ_TAB_TOUCH, RQ_TOUCH_HEADERS, '#D22730');
  rqTab_(ss, RQ_TAB_LOG, RQ_LOG_HEADERS, '#636466');
  rqConfig_(ss);
  return vdOut_({ ok: true, url: ss.getUrl(), id: ss.getId(), folder: rqFolder_().getId() });
}

function rqNow_() { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'); }
function rqToday_() { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd'); }
function rqId_() { return 'T-' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd-HHmmss') + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(); }

// ------------------------------------------------------------ list --------

// Invite stamps written by vd_invite into internal_notes look like
// "Invited 2026-09-12 by Brett Stephens (Las Vegas, for Brett Stephens)".
function rqInvites_(notes) {
  var out = [];
  var re = /Invited (\d{4}-\d{2}-\d{2}) by ([^(\n]+?)(?: \(([^)\n]*)\))?(?:\n|$)/g, m;
  var s = String(notes || '');
  while ((m = re.exec(s))) out.push({ date: m[1], by: m[2].trim(), note: (m[3] || '').trim() });
  out.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  return out;
}

function rqList_(data) {
  var ss = vdSS_();
  var all = vdAllRows_(ss);
  var vendors = [];
  all.forEach(function (r) {
    if (!r.dba_name || vdTrue_(r.hide)) return;
    var st = vdStr_(r.status);
    if (st === 'Active' || st === 'Waiting for Account' || st === 'Do Not Contact') return;
    var region = vdRegion_(r.region);
    var inv = rqInvites_(r.internal_notes);
    vendors.push({
      vendor_id: r.vendor_id || '', status: st, dba_name: r.dba_name, legal_name: r.legal_name || '',
      region: region, market: region === 'Northern Nevada' ? 'nnv' : 'lv', both: region === 'Both',
      service_types: r.service_types || '', contact_name: r.contact_name || '', email: r.email || '',
      phone: r.phone || '', business_phone: r.business_phone || '', city_state: r.city_state || '',
      source: r.source || '', added_by: r.added_by || '', eval_date: r.eval_date || '', updated: r.updated || '',
      outreach: r.outreach || '', gl_exp: r.gl_exp || '', wc_exp: r.wc_exp || '',
      email_status: r.email_status || '', email_note: r.email_note || '',
      invites: inv.length, last_invite: inv.length ? inv[0].date : '', last_invite_by: inv.length ? inv[0].by : '',
      notes_tail: String(r.internal_notes || '').split('\n').slice(0, 4).join('\n').slice(0, 400)
    });
  });

  // Intake Log: evaluations and intake forms, matched to a vendor id when the
  // submission matched one. The newest per vendor is enough for the queue.
  var intake = {};
  try {
    var ish = ss.getSheetByName(VD_TABS.INTAKE);
    if (ish) {
      rqRows_(ish).rows.forEach(function (r) {
        var vid = vdStr_(r.matched_vendor_id);
        if (!vid || r.submission_id === 'INVITE') return;
        var when = vdStr_(r.received);
        var cur = intake[vid];
        if (!cur || cur.when < when) intake[vid] = { when: when, kind: r.submission_id === 'EVAL' ? 'eval' : 'intake', action: r.action || '' };
      });
    }
  } catch (e) {}

  // Touches, newest first per vendor. The page keeps the last five per vendor.
  var book = rqBook_();
  var tsh = rqTab_(book, RQ_TAB_TOUCH, RQ_TOUCH_HEADERS, '#D22730');
  var touches = {};
  rqRows_(tsh).rows.forEach(function (r) {
    var vid = vdStr_(r.vendor_id);
    if (!vid) return;
    delete r._row;
    (touches[vid] = touches[vid] || []).push(r);
  });
  Object.keys(touches).forEach(function (k) {
    touches[k].sort(function (a, b) { return a.when < b.when ? 1 : a.when > b.when ? -1 : 0; });
    touches[k] = touches[k].slice(0, 5);
  });

  var types = [];
  try {
    var tsh2 = ss.getSheetByName(VD_TABS.TYPES);
    if (tsh2) {
      types = vdRows_(tsh2).rows.filter(function (x) { return x.slug && vdTrue_(x.active); })
        .sort(function (a, b) { return (Number(a.sort) || 999) - (Number(b.sort) || 999); })
        .map(function (x) { return { slug: x.slug.toLowerCase(), name: x.name }; });
    }
  } catch (e2) {}

  return vdOut_({ ok: true, vendors: vendors, intake: intake, touches: touches, config: rqConfig_(book), types: types,
                  book: book.getUrl(), fetched: new Date().toISOString() });
}

// ------------------------------------------------------------ touch -------

function rqTouch_(data) {
  var vid = vdStr_(data.vendor_id);
  if (!vid) return vdOut_({ ok: false, error: 'No vendor id.' });
  var type = vdStr_(data.type) || 'Other';
  var who = vdStr_(data.who) || 'Admin Hub';
  var next = vdStr_(data.next);
  if (next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) return vdOut_({ ok: false, error: 'Follow-up date must be yyyy-mm-dd.' });
  var book = rqBook_();
  var sh = rqTab_(book, RQ_TAB_TOUCH, RQ_TOUCH_HEADERS, '#D22730');
  var t = {
    touch_id: rqId_(), when: rqNow_(), vendor_id: vid, vendor: vdStr_(data.vendor), market: vdStr_(data.market),
    type: type, outcome: vdStr_(data.outcome), note: vdStr_(data.note).slice(0, 2000), next_followup: next, who: who
  };
  var lock = LockService.getScriptLock();
  try { lock.waitLock(8000); } catch (e) {}
  try { rqAppend_(sh, RQ_TOUCH_HEADERS, t); } finally { try { lock.releaseLock(); } catch (e2) {} }

  // City Wide reached out: the directory outreach date moves, the same column the
  // hub invite writes, so the Vendor Profile shows it too.
  if (RQ_OUTREACH_TYPES[type]) {
    try { rqDirSet_(vid, 'outreach', rqToday_(), who, false); } catch (e3) {}
  }
  return vdOut_({ ok: true, touch: t });
}

// ------------------------------------------------------------ set ---------

function rqSet_(data) {
  var vid = vdStr_(data.vendor_id), field = vdStr_(data.field), value = vdStr_(data.value);
  var who = vdStr_(data.who) || 'Admin Hub';
  if (!vid) return vdOut_({ ok: false, error: 'No vendor id.' });
  if (!RQ_SET_FIELDS[field]) return vdOut_({ ok: false, error: 'That field cannot be changed from here.' });
  if (field === 'status' && RQ_STATUSES.indexOf(value) < 0) return vdOut_({ ok: false, error: 'Unknown status ' + value });
  var r = rqDirSet_(vid, field, value, who, true);
  if (!r.ok) return vdOut_(r);
  return vdOut_({ ok: true, vendor_id: vid, field: field, from: r.from, to: value });
}

// Write one directory cell by the live header row (not VD_HEADERS, which does not
// know the email columns). Logs old and new to the recruiting Log tab.
function rqDirSet_(vid, field, value, who, log) {
  var ss = vdSS_();
  var hit = vdAllRows_(ss).filter(function (r) { return r.vendor_id === vid; })[0];
  if (!hit) return { ok: false, error: 'Vendor ' + vid + ' is not on the directory.' };
  var sh = hit._sheet;
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(vdStr_);
  var col = head.indexOf(field);
  if (col < 0) {
    if (field !== 'email_status' && field !== 'email_note') return { ok: false, error: 'The directory has no ' + field + ' column.' };
    // The two email columns are added at the end the first time they are needed.
    col = head.length;
    sh.getRange(1, col + 1).setValue(field).setFontWeight('bold').setBackground('#D22730').setFontColor('#FFFFFF');
  }
  var from = vdStr_(hit[field]);
  sh.getRange(hit._row, col + 1).setValue(value);
  var uc = head.indexOf('updated');
  if (uc >= 0 && field !== 'outreach') sh.getRange(hit._row, uc + 1).setValue(rqToday_());
  if (log) {
    try {
      var book = rqBook_();
      rqAppend_(rqTab_(book, RQ_TAB_LOG, RQ_LOG_HEADERS, '#636466'), RQ_LOG_HEADERS,
        { when: rqNow_(), who: who, vendor_id: vid, vendor: hit.dba_name || '', field: field, from: from, to: value });
    } catch (e) {}
  }
  return { ok: true, from: from };
}
