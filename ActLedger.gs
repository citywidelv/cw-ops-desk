// ============================================================
// ActLedger.gs - Account Change Tracking (ACT) and Ledger Changes, digital (Sep 2026)
// File in the CW Solicitations Apps Script project.
// Routing: vdDispatch in VendorDirectory.gs routes any kind starting 'vd_act_' here
// (actDispatch). The team passcode unlocks everything; the BOM passcode unlocks
// every vd_act_ kind except vd_act_setup and vd_act_seed.
//
// Replaces the four Excel workbooks (ACT Document Las Vegas, LV Ledger Changes,
// ACT Document NNV 2.0, NNV Ledger Changes). Own spreadsheet "CW Account Changes",
// created by vd_act_setup and remembered in the ACT_SHEET_ID script property.
//
// Tabs
//   One tab per ACT section, plus Ledger Changes. Each tab carries the exact Excel
//   column headers for that section between a fixed set of meta columns, so
//   accounting can read the sheet the way they read the workbook:
//     entry_id | region | doc | month | month_key | status | <section columns...> |
//     Accounting Complete | completed_by | completed_at | created | created_by |
//     updated | updated_by | source | layout | legacy_extras
//   Accounts Las Vegas / Accounts Northern Nevada: the account directory (new).
//   Lists: FSMs, contract types per region, ledger reasons (with the needs-new-IC
//     flag), month-affected choices, and the IC names from the Excel Keys (for the
//     "not in the vendor directory yet" report).
//   Comments: the chat thread on each entry (accounting questions, FSM notes).
//     comment_id | entry_id | when | who | text | needs_reply | region | section | hidden
//   Change Log: every edit, check, uncheck, void, add, rename, verify.
//   Config: key/value. live (FALSE = every email goes to test_to), test_to,
//     notify_accounts_lv/nnv, notify_vendors_lv/nnv, notify_comments_lv/nnv, next_entry_id.
//
// Nothing here deletes a row. Entries are voided (status Voided) and hidden by
// default; accounts and vendors are hidden with hide=TRUE.
// ============================================================

var ACT_PROP = 'ACT_SHEET_ID';
var ACT_REGIONS = ['Las Vegas', 'Northern Nevada'];
var ACT_TZ = 'America/Los_Angeles';

// Section definitions. cols = the Excel headers, in Excel order. doc = which
// document the section belongs to. entry = shown on the entry form (legacy-only
// and inventory sections are view-only).
var ACT_SECTIONS = [
  { key: 'new_accounts', name: 'New Accounts', doc: 'ACT', entry: true,
    cols: ['Account', 'IC', 'FSM', 'Start Date', 'CW Bill Rate', 'IC Pay Rate', 'Contract Type', 'Prorate?', 'Notes'] },
  { key: 'billing_changes', name: 'Billing Changes', doc: 'ACT', entry: true,
    cols: ['Account', 'IC', 'FSM', 'Effective Date', 'Old CW Bill Rate', 'New CW Bill Rate', 'Old IC Pay', 'New IC Pay', 'Contract Type', 'Notes'] },
  { key: 'ic_change_outs', name: 'IC Change Outs', doc: 'ACT', entry: true,
    cols: ['Account', 'Prior IC', 'New IC', 'Last Day Prior', 'First Day New', 'FSM', 'Refund PB?', 'Notes'] },
  { key: 'lost_accounts', name: 'Lost Accounts', doc: 'ACT', entry: true,
    cols: ['Account', 'IC', 'FSM', 'End Date', 'Refund PB?', 'Description or Reason'] },
  { key: 'floating_accounts', name: 'Floating Accounts', doc: 'ACT', entry: true,
    cols: ['Account', 'IC', 'FSM', 'IC Daily Rate', 'CW Daily Rate', 'Days', 'IC Total', 'CW Total', 'Notes'] },
  { key: 'account_credits', name: 'Account Credits', doc: 'ACT', entry: true,
    cols: ['Account', 'IC', 'FSM', 'Date', 'Client Credit', 'IC Deduction', 'Notes'] },
  { key: 'miscellaneous', name: 'Miscellaneous', doc: 'ACT', entry: true,
    cols: ['Account', 'IC', 'FSM', 'EC Number', 'Amount', 'Notes'] },
  { key: 'variable_term', name: 'Variable Term IC Payment Schedules', doc: 'ACT', entry: true,
    cols: ['Account', 'IC', 'Notes', 'Hold IC Pay This Month?'] },
  { key: 'project_deposits', name: 'Project Deposits', doc: 'ACT', entry: true,
    cols: ['Account', 'IC', 'FSM', 'Project Type', 'Start Date', 'Project Total', 'Deposit %', 'Deposit', 'Margin %', 'Pay IC Advance?'] },
  { key: 'office_inventory', name: 'Office Inventory', doc: 'ACT', entry: false, nocheck: true,
    cols: ['Item', 'Last Month Count', '# Sold', '# Comped/Gifted', '# Received', '# Expected', 'Count This Month', 'Variance', 'Notes'] },
  { key: 'account_holds', name: 'Account Holds', doc: 'ACT', entry: false, legacy: true,
    cols: ['Account', 'IC', 'FSM', 'Hold Start Date', 'Hold End Date', 'Reason'] },
  { key: 'ledger_changes', name: 'Ledger Changes', doc: 'Ledger', entry: true,
    cols: ['Account', 'IC', 'FSM', 'Amount', 'EC (If Applicable)', 'Reason', 'Reason Detail', 'Move Pay To', 'New IC Amount', 'Month Affected', 'Insurance Notes'] }
];
var ACT_META_HEAD = ['entry_id', 'region', 'doc', 'month', 'month_key', 'status'];
var ACT_META_TAIL = ['Accounting Complete', 'completed_by', 'completed_at', 'created', 'created_by', 'updated', 'updated_by', 'source', 'layout', 'legacy_extras'];

var ACT_ACCOUNT_TABS = [
  { key: 'lv', name: 'Accounts Las Vegas', region: 'Las Vegas' },
  { key: 'nnv', name: 'Accounts Northern Nevada', region: 'Northern Nevada' }
];
var ACT_ACCOUNT_HEADERS = ['account_id', 'name', 'region', 'status', 'relationship_js', 'relationship_os', 'bc_customer_no', 'crm_id',
  'fsm', 'doo', 'night_manager', 'industry', 'address1', 'address2', 'city', 'state', 'zip', 'contact_name', 'contact_email', 'js_contact',
  'former_names', 'in_act_key', 'in_ledger_key', 'source', 'added_by', 'added', 'updated', 'updated_by',
  'verified', 'verified_by', 'verified_at', 'notes', 'hide'];
var ACT_ACCOUNT_STATUS = ['Active', 'Prospect', 'Past Client', 'Inactive', 'Vendor', 'Needs review', 'Other'];
var ACT_LIST_HEADERS = ['list', 'region', 'value', 'flag', 'active', 'note'];
var ACT_LOG_HEADERS = ['when', 'who', 'action', 'id', 'tab', 'field', 'old', 'new'];
var ACT_COMMENT_HEADERS = ['comment_id', 'entry_id', 'when', 'who', 'text', 'needs_reply', 'region', 'section', 'hidden'];
var ACT_CONFIG_HEADERS = ['key', 'value', 'note'];
var ACT_CONFIG_DEFAULTS = [
  ['live', 'FALSE', 'FALSE = every notification email goes to test_to instead of the real lists'],
  ['test_to', 'tjroberts@gocitywide.com', 'Where notifications go while live is FALSE'],
  ['notify_accounts_lv', '', 'Comma-separated emails told when a Las Vegas account is added or renamed'],
  ['notify_accounts_nnv', '', 'Comma-separated emails told when a Northern Nevada account is added or renamed'],
  ['notify_vendors_lv', '', 'Comma-separated emails told when a Las Vegas vendor is quick-added or renamed from an entry'],
  ['notify_vendors_nnv', '', 'Comma-separated emails told when a Northern Nevada vendor is quick-added or renamed from an entry'],
  ['notify_comments_lv', '', 'Comma-separated emails told when someone posts a chat note on a Las Vegas entry'],
  ['notify_comments_nnv', '', 'Comma-separated emails told when someone posts a chat note on a Northern Nevada entry'],
  ['next_entry_id', '1', 'Counter for AC- entry ids. Setup and seed keep it ahead of the highest id in the book'],
  ['import_done', '', 'Set by vd_act_seed when the Excel history finished loading']
];

// ------------------------------------------------------------ plumbing -----

function actOut_(o) { return vdOut_(o); }
function actStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ACT_TZ, 'yyyy-MM-dd');
  if (v === true) return 'TRUE';
  if (v === false) return 'FALSE';
  return String(v == null ? '' : v).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}
function actNow_() { return Utilities.formatDate(new Date(), ACT_TZ, "yyyy-MM-dd HH:mm"); }
function actToday_() { return Utilities.formatDate(new Date(), ACT_TZ, 'yyyy-MM-dd'); }
function actRegion_(raw) {
  var s = actStr_(raw).toLowerCase();
  if (s === 'nnv' || s === 'nn' || s === 'reno' || s.indexOf('northern') === 0) return 'Northern Nevada';
  return 'Las Vegas';
}
function actMonthKey_(month) {
  // "August 2026" -> "2026-08". Accepts "2026-08" as is.
  var m = /^(\d{4})-(\d{2})$/.exec(actStr_(month));
  if (m) return m[0];
  var names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  var p = /^([A-Za-z]+)\s+(\d{4})$/.exec(actStr_(month));
  if (!p) return '';
  var i = names.indexOf(p[1].toLowerCase());
  if (i < 0) return '';
  return p[2] + '-' + (i + 1 < 10 ? '0' : '') + (i + 1);
}
// Sheets auto-parses "2026-08" and "August 2026" into dates when a cell is not
// text-formatted. Every reader goes through this so a date-typed cell still
// yields the month key.
function actMk_(v) {
  var s = actStr_(v);
  var m = /^(\d{4})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2];
  return actMonthKey_(s);
}
// Force text format on the month / month_key cells of a block before writing.
var ACT_TEXT_COLS = ['month', 'month_key', 'Month Affected', 'EC Number', 'EC (If Applicable)', 'bc_customer_no', 'zip'];
function actTextCols_(sh, head, row, n) {
  head.forEach(function (h, i) {
    if (ACT_TEXT_COLS.indexOf(h) >= 0) sh.getRange(row, i + 1, n, 1).setNumberFormat('@');
  });
}
function actMonthName_(key) {
  var names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var m = /^(\d{4})-(\d{2})$/.exec(actStr_(key));
  if (!m) return actStr_(key);
  return names[Number(m[2]) - 1] + ' ' + m[1];
}
function actSection_(nameOrKey) {
  var s = actStr_(nameOrKey).toLowerCase();
  for (var i = 0; i < ACT_SECTIONS.length; i++) {
    if (ACT_SECTIONS[i].key === s || ACT_SECTIONS[i].name.toLowerCase() === s) return ACT_SECTIONS[i];
  }
  return null;
}
function actHeaders_(sec) { return ACT_META_HEAD.concat(sec.cols, ACT_META_TAIL); }

function actSS_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(ACT_PROP);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ss = SpreadsheetApp.create('CW Account Changes');
  props.setProperty(ACT_PROP, ss.getId());
  return ss;
}
function actTab_(ss, name, headers, color) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var cur = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(actStr_) : [];
  var same = cur.length === headers.length && cur.every(function (h, i) { return h === headers[i]; });
  if (!same) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground(color || '#2D2A26').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  return sh;
}
function actRows_(sh) {
  var last = sh.getLastRow(), lastC = sh.getLastColumn();
  if (last < 2 || lastC < 1) return { head: [], rows: [] };
  var vals = sh.getRange(1, 1, last, lastC).getValues();
  var head = vals[0].map(actStr_);
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    var o = { _row: i + 1 };
    var any = false;
    for (var c = 0; c < head.length; c++) {
      if (!head[c]) continue;
      var v = vals[i][c];
      if (v instanceof Date) v = Utilities.formatDate(v, ACT_TZ, 'yyyy-MM-dd');
      else if (typeof v === 'number') { /* keep numbers */ }
      else if (typeof v === 'boolean') { /* keep booleans */ }
      else v = actStr_(v);
      if (v !== '' && v !== null) any = true;
      o[head[c]] = v;
    }
    if (any) rows.push(o);
  }
  return { head: head, rows: rows };
}
function actNextRow_(sh) {
  var last = Math.max(sh.getLastRow(), 1);
  var vals = sh.getRange(1, 1, last, 1).getValues();
  for (var i = 1; i < vals.length; i++) if (!actStr_(vals[i][0])) return i + 1;
  return vals.length + 1;
}
function actConfig_(ss) {
  var sh = ss.getSheetByName('Config');
  var out = {};
  if (!sh) return out;
  actRows_(sh).rows.forEach(function (r) { if (r.key) out[r.key] = actStr_(r.value); });
  return out;
}
function actSetConfig_(ss, key, value) {
  var sh = ss.getSheetByName('Config');
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 2).getValues();
  for (var i = 1; i < vals.length; i++) {
    if (actStr_(vals[i][0]) === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value, '']);
}
function actLog_(ss, who, action, id, tab, field, oldv, newv) {
  try {
    var sh = ss.getSheetByName('Change Log');
    sh.appendRow([actNow_(), who || '', action, id || '', tab || '', field || '', actStr_(oldv), actStr_(newv)]);
  } catch (e) {}
}
function actNextEntryId_(ss) {
  var cfg = actConfig_(ss);
  var n = Number(cfg.next_entry_id) || 1;
  // Never hand out an id that is already in the book, whatever the counter says
  // (the counter can lag after an import or a hand edit of the Config tab).
  var id;
  for (var tries = 0; tries < 5000; tries++) {
    var s = String(n);
    while (s.length < 6) s = '0' + s;
    id = 'AC-' + s;
    if (!actFind_(ss, id)) break;
    n++;
  }
  actSetConfig_(ss, 'next_entry_id', String(n + 1));
  return id;
}
function actWho_(data) { return actStr_(data.by || data.who || '').slice(0, 80); }

// ------------------------------------------------------------ dispatch -----

function actDispatch(data) {
  var kind = String(data.kind || '');
  if (data._bom && (kind === 'vd_act_setup' || kind === 'vd_act_seed')) {
    return actOut_({ ok: false, error: 'Team passcode required.' });
  }
  var lock = null;
  var writes = { vd_act_add: 1, vd_act_update: 1, vd_act_complete: 1, vd_act_void: 1, vd_act_account_save: 1, vd_act_comment_add: 1,
                 vd_act_account_verify: 1, vd_act_vendor_quick: 1, vd_act_seed: 1, vd_act_setup: 1 };
  if (writes[kind]) {
    lock = LockService.getScriptLock();
    try { lock.waitLock(25000); } catch (e) { return actOut_({ ok: false, error: 'The sheet is busy. Try again in a moment.' }); }
  }
  try {
    if (kind === 'vd_act_setup') return actSetup_(data);
    if (kind === 'vd_act_context') return actContext_(data);
    if (kind === 'vd_act_entries') return actEntries_(data);
    if (kind === 'vd_act_add') return actAdd_(data);
    if (kind === 'vd_act_update') return actUpdate_(data);
    if (kind === 'vd_act_complete') return actComplete_(data);
    if (kind === 'vd_act_void') return actVoid_(data);
    if (kind === 'vd_act_accounts') return actAccounts_(data);
    if (kind === 'vd_act_account_save') return actAccountSave_(data);
    if (kind === 'vd_act_account_verify') return actAccountVerify_(data);
    if (kind === 'vd_act_vendor_quick') return actVendorQuick_(data);
    if (kind === 'vd_act_seed') return actSeed_(data);
    if (kind === 'vd_act_log') return actLogRead_(data);
    if (kind === 'vd_act_comments') return actComments_(data);
    if (kind === 'vd_act_comment_add') return actCommentAdd_(data);
    return actOut_({ ok: false, error: 'Unknown vd_act kind' });
  } catch (e) {
    return actOut_({ ok: false, error: 'Server error: ' + (e && e.message ? e.message : e) });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (e2) {} }
  }
}

// ------------------------------------------------------------ setup --------

function actSetup_(data) {
  var ss = actSS_();
  ACT_SECTIONS.forEach(function (sec) {
    var sh = actTab_(ss, sec.name, actHeaders_(sec), sec.doc === 'Ledger' ? '#0AA6A9' : '#2D2A26');
    if (!sec.nocheck) {
      var c = actHeaders_(sec).indexOf('Accounting Complete') + 1;
      var cb = SpreadsheetApp.newDataValidation().requireCheckbox().build();
      sh.getRange(2, c, 5000, 1).setDataValidation(cb);
    }
    actTextCols_(sh, actHeaders_(sec), 2, 5000);
  });
  ACT_ACCOUNT_TABS.forEach(function (t) {
    var sh = actTab_(ss, t.name, ACT_ACCOUNT_HEADERS, '#D22730');
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(ACT_ACCOUNT_STATUS, true).build();
    sh.getRange(2, ACT_ACCOUNT_HEADERS.indexOf('status') + 1, 3000, 1).setDataValidation(rule);
    var cb = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    sh.getRange(2, ACT_ACCOUNT_HEADERS.indexOf('verified') + 1, 3000, 1).setDataValidation(cb);
    sh.getRange(2, ACT_ACCOUNT_HEADERS.indexOf('hide') + 1, 3000, 1).setDataValidation(cb);
    actTextCols_(sh, ACT_ACCOUNT_HEADERS, 2, 3000);
  });
  actTab_(ss, 'Lists', ACT_LIST_HEADERS, '#636466');
  actTab_(ss, 'Change Log', ACT_LOG_HEADERS, '#636466');
  actTab_(ss, 'Comments', ACT_COMMENT_HEADERS, '#203864');
  var cfg = actTab_(ss, 'Config', ACT_CONFIG_HEADERS, '#636466');
  var have = actConfig_(ss);
  ACT_CONFIG_DEFAULTS.forEach(function (d) { if (have[d[0]] === undefined) cfg.appendRow(d); });
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && ss.getSheets().length > 1 && s1.getLastRow() === 0) { try { ss.deleteSheet(s1); } catch (e) {} }
  return actOut_({ ok: true, url: ss.getUrl(), id: ss.getId(), tabs: ss.getSheets().map(function (s) { return s.getName(); }) });
}

// Bulk seed from the Excel import. data.tab = tab name, data.rows = array of objects
// keyed by header. Appends in one setValues per call. Team passcode only.
// data.mode 'replace' clears the tab's rows first (used once per tab by the importer).
function actSeed_(data) {
  var ss = actSS_();
  var sh = ss.getSheetByName(actStr_(data.tab));
  if (!sh) return actOut_({ ok: false, error: 'No tab named ' + data.tab });
  var rows = data.rows || [];
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(actStr_);
  if (data.mode === 'replace' && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
  if (data.next_entry_id) actSetConfig_(ss, 'next_entry_id', String(data.next_entry_id));
  if (data.import_done) actSetConfig_(ss, 'import_done', actNow_() + ' ' + actStr_(data.import_done));
  if (!rows.length) return actOut_({ ok: true, appended: 0, cleared: data.mode === 'replace' });
  var start = actNextRow_(sh);
  var vals = rows.map(function (r) {
    return head.map(function (h) {
      var v = r[h];
      if (v === undefined || v === null) return '';
      if (h === 'Accounting Complete' || h === 'verified' || h === 'hide') return actStr_(v).toUpperCase() === 'TRUE';
      return v;
    });
  });
  actTextCols_(sh, head, start, vals.length);
  sh.getRange(start, 1, vals.length, head.length).setValues(vals);
  return actOut_({ ok: true, appended: vals.length, first_row: start });
}

// ------------------------------------------------------------ context ------

// Everything the entry form and the viewers need in one call: lists, accounts
// (compact), vendors (compact, from the CW Vendor Directory), months present,
// config flags, and the sheet url.
function actContext_(data) {
  var ss = actSS_();
  var lists = actLists_(ss);
  var accounts = actAccountRows_(ss).filter(function (a) { return !actTrue_(a.hide); }).map(function (a) {
    return { id: a.account_id, name: a.name, region: a.region, status: a.status, verified: actTrue_(a.verified), fsm: a.fsm, bc: a.bc_customer_no };
  });
  var vendors = [];
  try {
    vdAllRows_(vdSS_()).forEach(function (r) {
      if (!r.dba_name || vdTrue_(r.hide)) return;
      vendors.push({ id: r.vendor_id, name: r.dba_name, legal: r.legal_name || '', region: vdRegion_(r.region), status: r.status || '', types: r.service_types || '' });
    });
  } catch (e) { vendors = null; }
  var scan = actScan_(ss);
  var months = scan.months;
  var cfg = actConfig_(ss);
  var out = { ok: true, sections: ACT_SECTIONS, lists: lists, accounts: accounts, vendors: vendors, months: months, suggest: scan.suggest,
              sheet_url: ss.getUrl(), gids: actGids_(ss), live: actTrue_(cfg.live), import_done: cfg.import_done || '',
              who: data._bom ? 'bom' : 'team' };
  return actOut_(out);
}
function actGids_(ss) {
  var g = {};
  ss.getSheets().forEach(function (s) { g[s.getName()] = s.getSheetId(); });
  return g;
}
function actTrue_(v) { return v === true || actStr_(v).toUpperCase() === 'TRUE'; }
function actLists_(ss) {
  var sh = ss.getSheetByName('Lists');
  var out = { fsms: {}, contract_types: {}, ledger_reasons: [], key_ics: {}, month_affected: [] };
  ACT_REGIONS.forEach(function (r) { out.fsms[r] = []; out.contract_types[r] = []; out.key_ics[r] = []; });
  if (!sh) return out;
  actRows_(sh).rows.forEach(function (r) {
    var list = actStr_(r.list), region = actStr_(r.region), v = actStr_(r.value);
    if (!v) return;
    var active = r.active === '' || actTrue_(r.active);
    if (list === 'fsm' && active) { if (region) out.fsms[region] && out.fsms[region].push(v); else ACT_REGIONS.forEach(function (x) { out.fsms[x].push(v); }); }
    else if (list === 'contract_type' && active) { if (region) out.contract_types[region] && out.contract_types[region].push(v); else ACT_REGIONS.forEach(function (x) { out.contract_types[x].push(v); }); }
    else if (list === 'ledger_reason' && active) out.ledger_reasons.push({ reason: v, needs_new_ic: actStr_(r.flag).toLowerCase() === 'yes' });
    else if (list === 'key_ic') { if (region && out.key_ics[region]) out.key_ics[region].push(v); }
  });
  return out;
}
// One pass over every section tab: which months have entries (per region and
// document) and, for the free-text columns, the values the team uses again and
// again (so the entry form can offer them as a pick-list before free typing).
var ACT_SUGGEST_COLS = { 'Notes': 1, 'Description or Reason': 1, 'Project Type': 1, 'Reason Detail': 1, 'Insurance Notes': 1 };
function actScan_(ss) {
  var seen = {}, counts = {};
  ACT_SECTIONS.forEach(function (sec) {
    var sh = ss.getSheetByName(sec.name);
    if (!sh || sh.getLastRow() < 2) return;
    var head = actHeaders_(sec);
    var want = [];
    if (sec.entry) sec.cols.forEach(function (h, i) { if (ACT_SUGGEST_COLS[h]) want.push({ h: h, c: head.indexOf(h) }); });
    var width = want.length ? head.length : ACT_META_HEAD.length;
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues();
    vals.forEach(function (v) {
      if (!actStr_(v[0])) return;
      var region = actStr_(v[1]), doc = actStr_(v[2]), mk = actMk_(v[4]) || actMk_(v[3]);
      var status = actStr_(v[5]);
      if (mk && region && status !== 'Voided') {
        var k = region + '|' + doc;
        seen[k] = seen[k] || {};
        seen[k][mk] = (seen[k][mk] || 0) + 1;
      }
      want.forEach(function (w) {
        var s = actStr_(v[w.c]);
        if (s.length < 3 || s.length > 140) return;
        var key = sec.key + '|' + w.h;
        counts[key] = counts[key] || {};
        var nk = s.toLowerCase();
        if (!counts[key][nk]) counts[key][nk] = { text: s, n: 0 };
        counts[key][nk].n++;
      });
    });
  });
  var months = {};
  Object.keys(seen).forEach(function (k) {
    months[k] = Object.keys(seen[k]).sort().map(function (mk) { return { key: mk, name: actMonthName_(mk), n: seen[k][mk] }; });
  });
  var suggest = {};
  Object.keys(counts).forEach(function (key) {
    var arr = Object.keys(counts[key]).map(function (nk) { return counts[key][nk]; }).filter(function (x) { return x.n >= 2; });
    arr.sort(function (a, b) { return b.n - a.n || a.text.localeCompare(b.text); });
    if (arr.length) suggest[key] = arr.slice(0, 15).map(function (x) { return x.text; });
  });
  return { months: months, suggest: suggest };
}
function actMonthsPresent_(ss) {
  var seen = {};
  ACT_SECTIONS.forEach(function (sec) {
    var sh = ss.getSheetByName(sec.name);
    if (!sh || sh.getLastRow() < 2) return;
    var head = actHeaders_(sec);
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, ACT_META_HEAD.length).getValues();
    vals.forEach(function (v) {
      var region = actStr_(v[1]), doc = actStr_(v[2]), mk = actMk_(v[4]) || actMk_(v[3]);
      if (!mk || !region) return;
      var k = region + '|' + doc;
      seen[k] = seen[k] || {};
      seen[k][mk] = (seen[k][mk] || 0) + 1;
    });
  });
  var out = {};
  Object.keys(seen).forEach(function (k) {
    out[k] = Object.keys(seen[k]).sort().map(function (mk) { return { key: mk, name: actMonthName_(mk), n: seen[k][mk] }; });
  });
  return out;
}

// ------------------------------------------------------------ entries ------

// Filters: region, doc (ACT|Ledger), month_key, section, open_only (Accounting
// Complete unchecked), q (search across every text field, all months), include_voided.
// Returns entries as {entry_id, region, doc, month, month_key, section, status,
// fields:{header:value}, complete, completed_by, completed_at, created..., source}.
function actEntries_(data) {
  var ss = actSS_();
  var region = actStr_(data.region) ? actRegion_(data.region) : '';
  var doc = actStr_(data.doc);
  var mk = actStr_(data.month_key) || actMonthKey_(data.month);
  var wantSec = data.section ? actSection_(data.section) : null;
  var q = actStr_(data.q).toLowerCase();
  var openOnly = !!data.open_only;
  var incVoid = !!data.include_voided;
  var cmap = actCommentMap_(ss);
  var out = [];
  ACT_SECTIONS.forEach(function (sec) {
    if (wantSec && wantSec.key !== sec.key) return;
    if (doc && sec.doc !== doc) return;
    var sh = ss.getSheetByName(sec.name);
    if (!sh) return;
    var rr = actRows_(sh);
    rr.rows.forEach(function (r) {
      if (!r.entry_id) return;
      if (region && r.region !== region) return;
      var rmk = actMk_(r.month_key) || actMk_(r.month);
      if (mk && rmk !== mk) return;
      var status = r.status || 'Open';
      if (!incVoid && status === 'Voided') return;
      var complete = actTrue_(r['Accounting Complete']);
      if (openOnly && (complete || sec.nocheck)) return;
      var fields = {};
      sec.cols.forEach(function (h) { if (r[h] !== '' && r[h] !== undefined) fields[h] = r[h]; });
      if (q) {
        var hay = [r.entry_id, r.month, r.region, sec.name].concat(sec.cols.map(function (h) { return r[h]; })).join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return;
      }
      out.push({ entry_id: r.entry_id, region: r.region, doc: r.doc, month: actMonthName_(rmk), month_key: rmk, section: sec.name, section_key: sec.key,
                 status: status, fields: fields, complete: complete, completed_by: r.completed_by, completed_at: r.completed_at,
                 created: r.created, created_by: r.created_by, updated: r.updated, updated_by: r.updated_by,
                 source: r.source, layout: r.layout, legacy_extras: r.legacy_extras, _row: r._row,
                 comments: (cmap[r.entry_id] || {}).n || 0, last_comment: (cmap[r.entry_id] || {}).last || '', open_q: !!(cmap[r.entry_id] || {}).open_q });
    });
  });
  out.sort(function (a, b) { return a.month_key < b.month_key ? -1 : a.month_key > b.month_key ? 1 : (a._row - b._row); });
  return actOut_({ ok: true, entries: out, n: out.length });
}

function actFind_(ss, entryId) {
  var id = actStr_(entryId);
  if (!id) return null;
  for (var i = 0; i < ACT_SECTIONS.length; i++) {
    var sec = ACT_SECTIONS[i];
    var sh = ss.getSheetByName(sec.name);
    if (!sh || sh.getLastRow() < 2) continue;
    var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var r = 0; r < ids.length; r++) {
      if (actStr_(ids[r][0]) === id) return { sec: sec, sh: sh, row: r + 2, head: actHeaders_(sec) };
    }
  }
  return null;
}
function actCoerce_(h, v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  var s = actStr_(v);
  // numbers typed as text stay numbers in the sheet; anything else stays text
  if (/^-?\d+(\.\d+)?$/.test(s) && !/^(EC Number|EC \(If Applicable\)|Account|IC|Prior IC|New IC|FSM|Notes|Item)$/.test(h)) return Number(s);
  return s;
}

function actAdd_(data) {
  var ss = actSS_();
  var sec = actSection_(data.section);
  if (!sec) return actOut_({ ok: false, error: 'Unknown section.' });
  if (!sec.entry && !data.allow_view_only) return actOut_({ ok: false, error: sec.name + ' is view-only.' });
  var region = actRegion_(data.region);
  var mk = actMonthKey_(data.month || data.month_key);
  if (!mk) return actOut_({ ok: false, error: 'Month is required (e.g. "September 2026").' });
  var f = data.fields || {};
  var missing = [];
  if (sec.key !== 'office_inventory' && !actStr_(f.Account)) missing.push('Account');
  if (sec.key === 'ledger_changes') {
    if (!actStr_(f.Reason)) missing.push('Reason');
    if (actStr_(f.Reason) === 'Other' && !actStr_(f['Reason Detail'])) missing.push('Reason Detail (required when Reason is Other)');
  }
  if (missing.length) return actOut_({ ok: false, error: 'Missing: ' + missing.join(', ') });
  var sh = ss.getSheetByName(sec.name);
  var head = actHeaders_(sec);
  var id = actNextEntryId_(ss);
  var who = actWho_(data);
  var now = actNow_();
  var row = head.map(function (h) {
    if (h === 'entry_id') return id;
    if (h === 'region') return region;
    if (h === 'doc') return sec.doc;
    if (h === 'month') return actMonthName_(mk);
    if (h === 'month_key') return mk;
    if (h === 'status') return 'Open';
    if (h === 'Accounting Complete') return sec.nocheck ? '' : false;
    if (h === 'created' || h === 'updated') return now;
    if (h === 'created_by' || h === 'updated_by') return who;
    if (h === 'source') return actStr_(data.source) || 'Ops Hub entry';
    if (h === 'layout') return 'current';
    if (ACT_META_TAIL.indexOf(h) >= 0) return '';
    return actCoerce_(h, f[h]);
  });
  var r = actNextRow_(sh);
  actTextCols_(sh, head, r, 1);
  sh.getRange(r, 1, 1, head.length).setValues([row]);
  actLog_(ss, who, 'add', id, sec.name, '', '', sec.name + ' / ' + actMonthName_(mk) + ' / ' + region);
  return actOut_({ ok: true, entry_id: id, row: r, tab: sec.name });
}

function actUpdate_(data) {
  var ss = actSS_();
  var hit = actFind_(ss, data.entry_id);
  if (!hit) return actOut_({ ok: false, error: 'No entry ' + data.entry_id });
  var f = data.fields || {};
  var who = actWho_(data);
  var vals = hit.sh.getRange(hit.row, 1, 1, hit.head.length).getValues()[0];
  var changed = 0;
  var allowed = {};
  hit.sec.cols.forEach(function (h) { allowed[h] = 1; });
  ['month', 'region'].forEach(function (h) { allowed[h] = 1; });
  Object.keys(f).forEach(function (h) {
    if (!allowed[h]) return;
    var c = hit.head.indexOf(h);
    if (c < 0) return;
    var nv = actCoerce_(h, f[h]);
    if (h === 'region') nv = actRegion_(nv);
    var ov = vals[c];
    if (actStr_(ov) === actStr_(nv)) return;
    vals[c] = nv;
    changed++;
    actLog_(ss, who, 'edit', data.entry_id, hit.sec.name, h, ov, nv);
    if (h === 'month') {
      var mk = actMonthKey_(nv);
      if (mk) { vals[hit.head.indexOf('month_key')] = mk; vals[hit.head.indexOf('month')] = actMonthName_(mk); }
    }
  });
  if (changed) {
    vals[hit.head.indexOf('updated')] = actNow_();
    vals[hit.head.indexOf('updated_by')] = who;
    actTextCols_(hit.sh, hit.head, hit.row, 1);
    hit.sh.getRange(hit.row, 1, 1, hit.head.length).setValues([vals]);
  }
  return actOut_({ ok: true, changed: changed });
}

function actComplete_(data) {
  var ss = actSS_();
  var hit = actFind_(ss, data.entry_id);
  if (!hit) return actOut_({ ok: false, error: 'No entry ' + data.entry_id });
  if (hit.sec.nocheck) return actOut_({ ok: false, error: hit.sec.name + ' has no Accounting Complete box.' });
  var on = actTrue_(data.complete);
  var who = actWho_(data);
  var c = hit.head.indexOf('Accounting Complete') + 1;
  var was = actTrue_(hit.sh.getRange(hit.row, c).getValue());
  hit.sh.getRange(hit.row, c).setValue(on);
  hit.sh.getRange(hit.row, hit.head.indexOf('completed_by') + 1).setValue(on ? who : '');
  hit.sh.getRange(hit.row, hit.head.indexOf('completed_at') + 1).setValue(on ? actNow_() : '');
  hit.sh.getRange(hit.row, hit.head.indexOf('updated') + 1).setValue(actNow_());
  hit.sh.getRange(hit.row, hit.head.indexOf('updated_by') + 1).setValue(who);
  actLog_(ss, who, on ? 'check' : 'uncheck', data.entry_id, hit.sec.name, 'Accounting Complete', was, on);
  return actOut_({ ok: true, complete: on, completed_by: on ? who : '', completed_at: on ? actNow_() : '' });
}

function actVoid_(data) {
  var ss = actSS_();
  var hit = actFind_(ss, data.entry_id);
  if (!hit) return actOut_({ ok: false, error: 'No entry ' + data.entry_id });
  var who = actWho_(data);
  var restore = !!data.restore;
  var c = hit.head.indexOf('status') + 1;
  hit.sh.getRange(hit.row, c).setValue(restore ? 'Open' : 'Voided');
  hit.sh.getRange(hit.row, hit.head.indexOf('updated') + 1).setValue(actNow_());
  hit.sh.getRange(hit.row, hit.head.indexOf('updated_by') + 1).setValue(who);
  actLog_(ss, who, restore ? 'restore' : 'void', data.entry_id, hit.sec.name, 'status', restore ? 'Voided' : 'Open', (restore ? 'Open' : 'Voided') + (data.reason ? ' - ' + actStr_(data.reason) : ''));
  return actOut_({ ok: true, status: restore ? 'Open' : 'Voided' });
}

function actLogRead_(data) {
  var ss = actSS_();
  var sh = ss.getSheetByName('Change Log');
  var rows = actRows_(sh).rows;
  var id = actStr_(data.id);
  if (id) rows = rows.filter(function (r) { return actStr_(r.id) === id; });
  rows = rows.slice(-Number(data.limit || 200));
  return actOut_({ ok: true, rows: rows });
}

// ------------------------------------------------------------ comments -----
// The chat thread on an entry. Anyone with the team or BOM passcode can post;
// nothing is deleted (hidden=TRUE hides a comment). needs_reply marks a question;
// the entry shows an open-question badge until someone posts after it.

function actCommentsSheet_(ss) {
  var sh = ss.getSheetByName('Comments');
  if (!sh) {
    sh = actTab_(ss, 'Comments', ACT_COMMENT_HEADERS, '#203864');
    var cfg = ss.getSheetByName('Config');
    if (cfg) {
      var have = actConfig_(ss);
      ACT_CONFIG_DEFAULTS.forEach(function (d) { if (/^notify_comments_/.test(d[0]) && have[d[0]] === undefined) cfg.appendRow(d); });
    }
  }
  return sh;
}
function actCommentRows_(ss) {
  var sh = ss.getSheetByName('Comments');
  if (!sh || sh.getLastRow() < 2) return [];
  return actRows_(sh).rows.filter(function (r) { return r.comment_id && !actTrue_(r.hidden); }).map(function (r) {
    return { comment_id: r.comment_id, entry_id: actStr_(r.entry_id), when: actStr_(r.when), who: actStr_(r.who), text: actStr_(r.text),
             needs_reply: actTrue_(r.needs_reply), region: r.region, section: r.section, _row: r._row };
  });
}
// entry_id -> { n, last: 'when · who', open_q } for the table badges.
function actCommentMap_(ss) {
  var map = {};
  actCommentRows_(ss).forEach(function (c) {
    var m = map[c.entry_id] || (map[c.entry_id] = { n: 0, last: '', open_q: false });
    m.n++;
    m.last = c.when + (c.who ? ' · ' + c.who : '');
    m.open_q = c.needs_reply;   // rows are in post order, so the last one decides
  });
  return map;
}
function actComments_(data) {
  var ss = actSS_();
  var id = actStr_(data.entry_id);
  var rows = actCommentRows_(ss);
  if (id) rows = rows.filter(function (c) { return c.entry_id === id; });
  else if (data.open_only) {
    var map = actCommentMap_(ss);
    rows = rows.filter(function (c) { return map[c.entry_id] && map[c.entry_id].open_q && c.needs_reply; });
  }
  rows = rows.slice(-Number(data.limit || 500));
  return actOut_({ ok: true, comments: rows, n: rows.length });
}
function actCommentAdd_(data) {
  var ss = actSS_();
  var text = actStr_(data.text).slice(0, 2000);
  var who = actWho_(data);
  if (!text) return actOut_({ ok: false, error: 'Type the note first.' });
  if (!who) return actOut_({ ok: false, error: 'Put your name in first.' });
  var hit = actFind_(ss, data.entry_id);
  if (!hit) return actOut_({ ok: false, error: 'No entry ' + data.entry_id });
  var sh = actCommentsSheet_(ss);
  var row = actNextRow_(sh);
  var region = actStr_(hit.sh.getRange(hit.row, hit.head.indexOf('region') + 1).getValue());
  var month = actStr_(hit.sh.getRange(hit.row, hit.head.indexOf('month') + 1).getValue());
  var acct = hit.head.indexOf('Account') > 0 ? actStr_(hit.sh.getRange(hit.row, hit.head.indexOf('Account') + 1).getValue()) : '';
  var cid = 'CM-' + Utilities.formatDate(new Date(), ACT_TZ, 'yyMMddHHmmss') + '-' + String(row);
  var needs = actTrue_(data.needs_reply);
  var when = actNow_();
  sh.getRange(row, 1, 1, ACT_COMMENT_HEADERS.length).setValues([[cid, hit.sh.getRange(hit.row, 1).getValue(), when, who, text, needs, region, hit.sec.name, false]]);
  sh.getRange(row, 3).setNumberFormat('@');
  actLog_(ss, who, needs ? 'question' : 'note', data.entry_id, hit.sec.name, 'chat', '', text.slice(0, 200));
  var docKey = hit.sec.doc === 'Ledger' ? 'ledger' : 'act';
  var mk = actMk_(hit.sh.getRange(hit.row, hit.head.indexOf('month_key') + 1).getValue()) || actMonthKey_(month);
  var link = 'https://citywidelv.github.io/cw-bom-hub/act-document.html#/' + (actRegion_(region) === 'Northern Nevada' ? 'nnv' : 'lv') + '/' + docKey + '/' + mk + '/' + actStr_(data.entry_id);
  var mail = actNotify_(ss, 'comment', region, {
    subject: (needs ? 'Question on ' : 'Note on ') + actStr_(data.entry_id) + (acct ? ' - ' + acct : '') + ' (' + hit.sec.name + ', ' + month + ')',
    lines: [who + (needs ? ' asked a question on ' : ' left a note on ') + actStr_(data.entry_id) + (acct ? ' (' + acct + ')' : '') + ':', '', text, '',
            (needs ? 'Reply on the entry so the question clears: ' : 'Open the entry: ') + link]
  });
  var map = actCommentMap_(ss)[actStr_(data.entry_id)] || { n: 1, last: when + ' · ' + who, open_q: needs };
  return actOut_({ ok: true, comment: { comment_id: cid, entry_id: actStr_(data.entry_id), when: when, who: who, text: text, needs_reply: needs },
                   comments: map.n, last_comment: map.last, open_q: map.open_q, mail: mail });
}

// ------------------------------------------------------------ accounts -----

function actAccountSheets_(ss) {
  return ACT_ACCOUNT_TABS.map(function (t) { return { sh: ss.getSheetByName(t.name), tab: t }; }).filter(function (x) { return !!x.sh; });
}
function actAccountRows_(ss) {
  var all = [];
  actAccountSheets_(ss).forEach(function (s) {
    actRows_(s.sh).rows.forEach(function (r) {
      if (!r.account_id && !r.name) return;
      r._sheet = s.sh; r._tab = s.tab.name;
      if (!r.region) r.region = s.tab.region;
      all.push(r);
    });
  });
  return all;
}
function actAccountTabFor_(ss, region) {
  var key = actRegion_(region) === 'Northern Nevada' ? 'nnv' : 'lv';
  var t = ACT_ACCOUNT_TABS.filter(function (x) { return x.key === key; })[0];
  return ss.getSheetByName(t.name);
}
function actNextAccountId_(rows, region) {
  var pre = actRegion_(region) === 'Northern Nevada' ? 'A-NNV-' : 'A-LV-';
  var max = 0;
  rows.forEach(function (r) {
    var m = new RegExp('^' + pre + '(\\d+)$').exec(actStr_(r.account_id));
    if (m) max = Math.max(max, Number(m[1]));
  });
  var n = String(max + 1);
  while (n.length < 4) n = '0' + n;
  return pre + n;
}
function actNorm_(s) {
  return actStr_(s).toLowerCase().replace(/&/g, 'and').replace(/\b(llc|inc|corp|ltd|co)\b\.?/g, '').replace(/[^a-z0-9]+/g, '');
}

function actAccounts_(data) {
  var ss = actSS_();
  var rows = actAccountRows_(ss).map(function (r) {
    var o = {};
    ACT_ACCOUNT_HEADERS.forEach(function (h) { o[h] = r[h] === undefined ? '' : r[h]; });
    o._row = r._row; o._tab = r._tab;
    return o;
  });
  return actOut_({ ok: true, accounts: rows, sheet_url: ss.getUrl(), gids: actGids_(ss) });
}

// Add or update one account. data.account = {account_id?, name, region, ...}.
// An add with a name already on the tab (normalised) is refused unless
// data.allow_duplicate. A name change keeps the old name in former_names, clears
// verified, and notifies. A new account is verified=FALSE and notifies.
function actAccountSave_(data) {
  var ss = actSS_();
  var a = data.account || {};
  var who = actWho_(data);
  var name = actStr_(a.name);
  var isUpdate = !!actStr_(a.account_id);
  if (!isUpdate && !name) return actOut_({ ok: false, error: 'Account name is required.' });
  if (isUpdate && a.name !== undefined && !name) return actOut_({ ok: false, error: 'Account name cannot be blanked.' });
  var all = actAccountRows_(ss);
  var target = null, sh, row;
  var region = a.region !== undefined ? actRegion_(a.region) : '';
  if (isUpdate) {
    target = all.filter(function (r) { return r.account_id === actStr_(a.account_id); })[0];
    if (!target) return actOut_({ ok: false, error: 'No account with id ' + a.account_id });
    sh = target._sheet; row = target._row;
    region = region || target.region;
  } else {
    region = region || 'Las Vegas';
    var key = actNorm_(name);
    var dupe = all.filter(function (r) { return r.region === region && actNorm_(r.name) === key; })[0];
    if (dupe && !data.allow_duplicate) {
      return actOut_({ ok: false, duplicate: true, account_id: dupe.account_id, name: dupe.name, status: dupe.status,
        error: name + ' is already in the ' + region + ' directory as ' + dupe.account_id + ' (' + dupe.status + '). Pick it from the list, or resubmit to add a second record.' });
    }
    sh = actAccountTabFor_(ss, region);
    row = actNextRow_(sh);
    a.account_id = actNextAccountId_(all, region);
    a.region = region;
    if (!actStr_(a.status)) a.status = 'Active';
    if (!actStr_(a.source)) a.source = actStr_(data.source) || 'Ops Hub';
    a.added = actToday_(); a.added_by = who;
    a.verified = false; a.verified_by = ''; a.verified_at = '';
    a.hide = false;
  }
  var renamed = false, oldName = '';
  if (target && a.name !== undefined && actStr_(target.name) !== name) {
    renamed = true; oldName = actStr_(target.name);
    var fn = actStr_(target.former_names);
    a.former_names = (fn ? fn + '; ' : '') + oldName + ' (until ' + actToday_() + ')';
    a.verified = false; a.verified_by = ''; a.verified_at = '';
  }
  a.updated = actToday_(); a.updated_by = who;
  var vals = sh.getRange(row, 1, 1, ACT_ACCOUNT_HEADERS.length).getValues()[0];
  ACT_ACCOUNT_HEADERS.forEach(function (h, i) {
    if (a[h] === undefined) return;
    var v = a[h];
    if (h === 'verified' || h === 'hide') v = actTrue_(v);
    else if (h === 'region') v = actRegion_(v);
    else v = actStr_(v);
    if (target && actStr_(vals[i]) !== actStr_(v) && h !== 'updated' && h !== 'updated_by') actLog_(ss, who, 'account edit', a.account_id, sh.getName(), h, vals[i], v);
    vals[i] = v;
  });
  sh.getRange(row, 1, 1, ACT_ACCOUNT_HEADERS.length).setValues([vals]);
  if (!target) actLog_(ss, who, 'account add', a.account_id, sh.getName(), 'name', '', name);
  var mailed = null;
  if (!target || renamed) {
    mailed = actNotify_(ss, 'account', region, {
      subject: (!target ? 'New account added: ' : 'Account renamed: ') + name + ' (' + region + ')',
      lines: [
        (!target ? 'A new account was added to the ' + region + ' account directory.' : 'An account in the ' + region + ' directory was renamed.'),
        renamed ? 'Was: ' + oldName : '',
        'Now: ' + name,
        'Id: ' + a.account_id,
        'By: ' + (who || 'not given'),
        actStr_(data.context) ? 'From: ' + actStr_(data.context) : '',
        '',
        'Please confirm the name matches CRM and Business Central, then mark it Verified on the BOM Hub:',
        'https://citywidelv.github.io/cw-bom-hub/accounts.html?id=' + encodeURIComponent(a.account_id)
      ]
    });
  }
  return actOut_({ ok: true, account_id: a.account_id, name: name, region: region, updated: !!target, renamed: renamed, notified: mailed });
}

function actAccountVerify_(data) {
  var ss = actSS_();
  var all = actAccountRows_(ss);
  var t = all.filter(function (r) { return r.account_id === actStr_(data.account_id); })[0];
  if (!t) return actOut_({ ok: false, error: 'No account with id ' + data.account_id });
  var who = actWho_(data);
  var on = data.verified === undefined ? true : actTrue_(data.verified);
  t._sheet.getRange(t._row, ACT_ACCOUNT_HEADERS.indexOf('verified') + 1).setValue(on);
  t._sheet.getRange(t._row, ACT_ACCOUNT_HEADERS.indexOf('verified_by') + 1).setValue(on ? who : '');
  t._sheet.getRange(t._row, ACT_ACCOUNT_HEADERS.indexOf('verified_at') + 1).setValue(on ? actNow_() : '');
  if (on && actStr_(t.status) === 'Needs review' && data.status === undefined) {
    t._sheet.getRange(t._row, ACT_ACCOUNT_HEADERS.indexOf('status') + 1).setValue('Active');
  }
  if (data.status !== undefined && actStr_(data.status)) t._sheet.getRange(t._row, ACT_ACCOUNT_HEADERS.indexOf('status') + 1).setValue(actStr_(data.status));
  actLog_(ss, who, on ? 'account verify' : 'account unverify', t.account_id, t._tab, 'verified', !on, on);
  return actOut_({ ok: true, verified: on });
}

// ------------------------------------------------------------ vendors ------

// Quick add or rename from the entry form. Writes straight into the CW Vendor
// Directory (VendorDirectory.gs helpers) so the vendor shows in every IC dropdown
// and on vendors.html. New vendors land as "In Progress" with source "ACT entry";
// the full packet still goes through vendor-add.html. A rename keeps the old
// name in internal_notes. Both notify the vendor list for the region.
function actVendorQuick_(data) {
  var who = actWho_(data);
  var vss = vdSS_();
  var all = vdAllRows_(vss);
  var name = vdStr_(data.dba_name);
  var region = vdRegion_(data.region);
  var out;
  if (vdStr_(data.vendor_id)) {
    var t = all.filter(function (r) { return r.vendor_id === vdStr_(data.vendor_id); })[0];
    if (!t) return actOut_({ ok: false, error: 'No vendor with id ' + data.vendor_id });
    if (!name) return actOut_({ ok: false, error: 'New vendor name is required.' });
    if (name === t.dba_name) return actOut_({ ok: true, vendor_id: t.vendor_id, unchanged: true });
    var note = vdStr_(t.internal_notes);
    var patch = { vendor_id: t.vendor_id, dba_name: name,
      internal_notes: (note ? note + ' | ' : '') + 'Renamed from "' + t.dba_name + '" on ' + actToday_() + ' by ' + (who || 'unknown') + ' (ACT entry)' };
    vdPatchCore_(vss, [patch]);
    actLog_(actSS_(), who, 'vendor rename', t.vendor_id, 'CW Vendor Directory', 'dba_name', t.dba_name, name);
    out = { ok: true, vendor_id: t.vendor_id, renamed: true, was: t.dba_name, name: name, region: vdRegion_(t.region) };
    out.notified = actNotify_(actSS_(), 'vendor', vdRegion_(t.region), {
      subject: 'Vendor renamed: ' + name + ' (' + vdRegion_(t.region) + ')',
      lines: ['A vendor in the CW Vendor Directory was renamed from an account change entry.', 'Was: ' + t.dba_name, 'Now: ' + name,
              'Id: ' + t.vendor_id, 'By: ' + (who || 'not given'), actStr_(data.context) ? 'From: ' + actStr_(data.context) : '', '',
              'Please confirm the name matches CRM and Business Central:', 'https://citywidelv.github.io/cw-ops-desk/vendors.html'] });
    return actOut_(out);
  }
  if (!name) return actOut_({ ok: false, error: 'Vendor name is required.' });
  var key = name.toLowerCase();
  var dupe = all.filter(function (r) { return vdStr_(r.dba_name).toLowerCase() === key || vdStr_(r.legal_name).toLowerCase() === key; })[0];
  if (dupe && !data.allow_duplicate) {
    return actOut_({ ok: false, duplicate: true, vendor_id: dupe.vendor_id, name: dupe.dba_name, status: dupe.status, region: vdRegion_(dupe.region),
      error: name + ' is already in the vendor directory as ' + dupe.vendor_id + ' (' + dupe.status + ', ' + vdRegion_(dupe.region) + '). Pick it from the list.' });
  }
  var sh = vdTabFor_(vss, region);
  var row = vdNextRow_(sh);
  var v = { vendor_id: vdNextId_(all), status: vdStr_(data.status) || 'In Progress', dba_name: name, region: region,
            service_types: vdStr_(data.service_types) || 'janitorial', source: 'ACT entry', added_by: who,
            updated: actToday_(), internal_notes: 'Quick-added from an account change entry on ' + actToday_() + (actStr_(data.context) ? ' (' + actStr_(data.context) + ')' : '') + '. Complete the vendor record on vendor-add.html.' };
  VD_HEADERS.forEach(function (h, i) { if (v[h] !== undefined) sh.getRange(row, i + 1).setValue(String(v[h])); });
  actLog_(actSS_(), who, 'vendor add', v.vendor_id, sh.getName(), 'dba_name', '', name);
  out = { ok: true, vendor_id: v.vendor_id, name: name, region: region, status: v.status };
  out.notified = actNotify_(actSS_(), 'vendor', region, {
    subject: 'New vendor added: ' + name + ' (' + region + ')',
    lines: ['A vendor was quick-added to the CW Vendor Directory from an account change entry.', 'Name: ' + name, 'Id: ' + v.vendor_id,
            'Status: ' + v.status, 'By: ' + (who || 'not given'), actStr_(data.context) ? 'From: ' + actStr_(data.context) : '', '',
            'Please confirm the name matches CRM and Business Central, and complete the record:',
            'https://citywidelv.github.io/cw-ops-desk/vendors.html'] });
  return actOut_(out);
}

// ------------------------------------------------------------ notify -------

// Sends one plain email. Config live=FALSE routes everything to test_to. Returns
// {to, test} or {skipped:reason}. Never throws: a mail failure must not lose the write.
function actNotify_(ss, kind, region, msg) {
  try {
    var cfg = actConfig_(ss);
    var live = actTrue_(cfg.live);
    var k = (kind === 'vendor' ? 'notify_vendors_' : kind === 'comment' ? 'notify_comments_' : 'notify_accounts_') + (actRegion_(region) === 'Northern Nevada' ? 'nnv' : 'lv');
    var to = actStr_(cfg[k]);
    var test = !live;
    if (test) to = actStr_(cfg.test_to);
    if (!to) return { skipped: 'no address in Config.' + k };
    var subject = (test ? '[TEST] ' : '') + msg.subject;
    var body = msg.lines.filter(function (l) { return l !== undefined && l !== null; }).join('\n') +
      (test ? '\n\n(Test mode: Config live is FALSE, so this went to test_to instead of ' + (actStr_(cfg[k]) || 'the empty ' + k + ' list') + '.)' : '') +
      '\n\nCity Wide Facility Solutions - Account Changes';
    MailApp.sendEmail({ to: to, subject: subject, body: body, name: 'City Wide Account Changes' });
    return { to: to, test: test };
  } catch (e) {
    return { skipped: 'mail error: ' + (e && e.message ? e.message : e) };
  }
}

// ------------------------------------------------------------ run helpers --

function actSetupRun() { Logger.log(actSetup_({}).getContent()); }
function actUrlRun() { Logger.log(actSS_().getUrl()); }
