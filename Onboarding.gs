// ============================================================
// Onboarding.gs - vendor onboarding desk + background check requests (Sep 19 2026)
// File in the CW Solicitations Apps Script project.
// Routing: doPost in Code.gs routes any kind starting 'ob_' to obDispatch(data),
//          and routes kind 'vd_eval' (the native Vendor Evaluation page) here too.
//
// Replaces the four Asana onboarding boards (LV/NNV x JS/OS) and the IC Background
// Checks board. Everything lives on the CW Vendor Directory book (vdSS_):
//   Onboarding            one row per vendor per track (JS / OS). Checklist state is
//                         a JSON cell keyed by checklist item, so adding an item to
//                         the checklist never needs a new column.
//   Onboarding Checklist  the items (label, track, group, how it auto-fills). Ops
//                         edits this tab; no deploy needed.
//   Onboarding Log        who changed what, when, from what to what.
//   BC Requests           every background check / name badge request from the
//                         Vendor Hub (and the ones imported from Asana). The person
//                         row on the "Background checks <market>" tabs stays the
//                         source of truth for the Clear / Not clear result.
//
// Kinds (team passcode unless noted):
//   ob_setup          create the tabs, seed the checklist (safe to re-run)
//   ob_list           everything the desk needs in one call
//   ob_save           create or update an onboarding row (stage, track, assignee...)
//   ob_doc            set one checklist item: '', received, verified, fix (+ note)
//   ob_docs           set several items at once (mark the packet received)
//   ob_note           add a dated note to a vendor's onboarding record
//   ob_bc_update      request-level fields: sent date, badge, notes, status
//   ob_import_asana   pull the five Asana boards through the ASANA_PAT property
//   ob_bc_request     NO PASSCODE. Vendor Hub background-check.html submits here.
//   ob_vendor_suggest NO PASSCODE. Company name picker on that page: at most three
//                     matches, and only once most of the name is typed (house rule).
//   vd_eval           NO PASSCODE. Vendor Hub vendor-evaluation.html submits here.
//
// Hooks other modules call (all guarded with typeof so nothing breaks if this file
// is missing):  obUploadHook_(info) from Uploads.gs after a COI / waiver / bank
// letter upload lands.
//
// Privacy: the requests carry a crew member's name, email and mobile. No date of
// birth, no SSN. Verified First collects those from the applicant directly.
// ============================================================

var OB_TAB = 'Onboarding';
var OB_CFG_TAB = 'Onboarding Checklist';
var OB_LOG_TAB = 'Onboarding Log';
var OB_REQ_TAB = 'BC Requests';

var OB_HEADERS = [
  'ob_id', 'vendor_id', 'vendor', 'market', 'track', 'stage', 'priority', 'assignee',
  'started', 'completed', 'asana_gid', 'asana_section', 'asana_status', 'notes', 'docs',
  'updated', 'updated_by', 'source', 'contact_name', 'email', 'phone', 'matched'
];
var OB_CFG_HEADERS = ['key', 'label', 'track', 'group', 'required', 'auto', 'asana_name', 'order', 'hint'];
var OB_LOG_HEADERS = ['when', 'ob_id', 'vendor', 'who', 'action', 'item', 'from', 'to', 'note'];
var OB_REQ_HEADERS = [
  'req_id', 'received', 'market', 'company', 'vendor_id', 'request_type', 'legal_name',
  'first_name', 'last_name', 'preferred_name', 'email', 'mobile', 'notify', 'client_account',
  'submitted_by', 'submitter_email', 'source', 'asana_gid', 'asana_done', 'status', 'sent',
  'badge', 'notes', 'updated', 'updated_by', 'dupe_of',
  // Sep 19 2026: a report the vendor ran themselves, stored in Drive (Uploads.gs folder)
  'report_link', 'report_name', 'matched_how'
];

var OB_STAGES = ['Invited', 'New', 'In Process', 'Complete', 'Not Approved', 'Ops Support'];
var OB_DOC_STATES = ['', 'received', 'verified', 'fix'];
var OB_REQ_TYPES = [
  'Background check and name badge',
  'Already checked, name badge only',
  'First name badge',
  'Replacement name badge ($5)'
];
var OB_REQ_STATUS = ['New', 'Sent', 'Review report', 'Cleared', 'Not cleared', 'Badge only', 'Closed'];
// Sep 19 2026: request statuses were Passed / Failed until the wording review. Legacy
// rows are normalized on read; obReqStatus_ keeps both spellings working.
function obReqStatus_(v) {
  v = vdStr_(v);
  if (v === 'Passed') return 'Cleared';
  if (v === 'Failed') return 'Not cleared';
  return v;
}
// One-time migration of stored request statuses. Run once from Runner.gs:
// cwRunNow -> obMigrateReqStatus_(). Safe to re-run.
function obMigrateReqStatus_() {
  var ss = vdSS_(), sh = ss.getSheetByName(OB_REQ_TAB);
  if (!sh || sh.getLastRow() < 2) return 0;
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(vdStr_);
  var col = head.indexOf('status') + 1;
  if (!col) return 0;
  var rng = sh.getRange(2, col, sh.getLastRow() - 1, 1), vals = rng.getValues(), n = 0;
  vals.forEach(function (r) { var nv = obReqStatus_(r[0]); if (nv !== vdStr_(r[0])) { r[0] = nv; n++; } });
  if (n) rng.setValues(vals);
  try { sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(OB_REQ_STATUS, true).build()); } catch (e) {}
  return n;
}
var OB_BADGE = ['', 'Needed', 'Ordered', 'Delivered'];

var OB_MARKETS = {
  lv:  { key: 'lv',  name: 'Las Vegas',       compliance: 'LVCompliance@gocitywide.com', sender: 'City Wide Las Vegas Compliance' },
  nnv: { key: 'nnv', name: 'Northern Nevada', compliance: 'rncompliance@gocitywide.com', sender: 'City Wide Northern Nevada Compliance' }
};
var OB_DESK_URL = 'https://citywidelv.github.io/cw-admin-hub/onboarding.html';
var OB_BC_PAGE = 'https://citywidelv.github.io/cw-vendor-hub/background-check.html';

// The five Asana boards. Team 1211434492126259 (Business Operations Management).
var OB_ASANA = {
  boards: [
    { gid: '1211434492126262', market: 'lv',  track: 'JS', name: 'LV Onboarding - JS ICs' },
    { gid: '1211502025994506', market: 'lv',  track: 'OS', name: 'LV Onboarding - OS ICs' },
    { gid: '1211502025994509', market: 'nnv', track: 'JS', name: 'NNV Onboarding - JS ICs' },
    { gid: '1211502025994512', market: 'nnv', track: 'OS', name: 'NNV Onboarding - OS ICs' }
  ],
  bc: '1211554681536533'
};

// Checklist seed. key | label | track | group | required | auto | asana_name(s) | order | hint
// auto: how the item fills itself. eval = Vendor Evaluation submit, upload:<x> = Vendor Hub
// upload of that document, bc = a background check request arrives. Blank = by hand.
var OB_CHECKLIST_SEED = [
  ['eval',            'Vendor Evaluation form',                       'Both', 'Getting started', 'TRUE', 'eval',          'IC Evaluation Form', 10, 'Fills itself when the vendor submits the evaluation on the Vendor Hub.'],
  ['orientation',     'Orientation / Meet the Team done',            'Both', 'Getting started', 'TRUE', '',              'Orientation Complete', 20, 'The 30 minute office meeting.'],
  ['packet_sent',     'PandaDoc packet sent',                        'Both', 'PandaDoc packet', 'FALSE', '',             'PandaDoc Packet Sent', 30, 'The vendor opens the packet from the Vendor Hub. Mark when you see it in PandaDoc.'],
  ['agreement',       'IC Agreement signed (JS: MSA, OS: agreement)', 'Both', 'PandaDoc packet', 'TRUE', '',             'JS IC Agreement / MSA|OS IC Agreement', 40, ''],
  ['acknowledgement', 'IC Acknowledgement',                          'Both', 'PandaDoc packet', 'TRUE', '',              'IC Acknowledgement', 50, ''],
  ['emergency',       'Emergency Contact form',                      'JS',   'PandaDoc packet', 'TRUE', '',              'IC Emergency Contact Form', 60, ''],
  ['invoicing',       'Invoicing Guidelines acknowledged',           'Both', 'PandaDoc packet', 'TRUE', '',              'Invoicing Guidelines', 70, ''],
  ['security',        'Security Policy signed',                      'Both', 'PandaDoc packet', 'TRUE', '',              'Security Policy', 80, ''],
  ['ach',             'ACH authorization',                           'Both', 'PandaDoc packet', 'TRUE', '',              'ACH Authorization', 90, 'Business account in the company name.'],
  ['communication',   'Communication Guidelines',                    'JS',   'PandaDoc packet', 'TRUE', '',              'Communication Guidelines', 100, ''],
  ['ins_directions',  'Insurance Requirements read',                 'Both', 'PandaDoc packet', 'TRUE', '',              'Insurance Requirements and Directions', 110, ''],
  ['booklet',         'IC Orientation Booklet',                      'JS',   'PandaDoc packet', 'TRUE', '',              'IC Orientation Booklet', 120, ''],
  ['w9',              'W-9',                                         'Both', 'PandaDoc packet', 'TRUE', '',              'W9', 130, 'Legal name and EIN must match the bank letter and the agreement.'],
  ['bank',            'Voided check or bank letter',                 'Both', 'Documents from the vendor', 'TRUE', 'upload:bank', 'Voided Check / Bank Letter', 140, 'Company name on the check must match the ACH form letter for letter.'],
  ['coi_gl',          'COI: General Liability',                      'Both', 'Documents from the vendor', 'TRUE', 'upload:coi_gl', 'General Liability COI', 150, 'Must name the exact City Wide entity.'],
  ['coi_wc',          'COI: Workers Compensation',                   'Both', 'Documents from the vendor', 'TRUE', 'upload:coi_wc', 'Workers Compensation COI', 160, 'Or the notarized waiver if they have no employees.'],
  ['waiver',          'Waiver of Agreement, notarized',              'Both', 'Documents from the vendor', 'TRUE', 'upload:waiver', 'Waiver of Workers Compensation Agreement', 170, 'Signed in front of a notary, never ahead of time.'],
  ['bc_request',      'Background check requested for the crew',     'JS',   'Background check', 'TRUE', 'bc',            'Request for Background Check', 180, 'Fills itself when the vendor submits the Vendor Hub background check page. Results are recorded per person below.'],
  ['crm_account',     'CRM: IC set up as a client account',          'Both', 'CRM and accounting', 'TRUE', '',            'IC "as a client" Account setup in CRM', 190, ''],
  ['crm_js',          'CRM: JS relationship set to Disqualified (too small)', 'Both', 'CRM and accounting', 'TRUE', '',  'Relationship Type JS set to disqualified too small', 200, ''],
  ['crm_os',          'CRM: OS relationship set to Pending OS Client', 'Both', 'CRM and accounting', 'TRUE', '',         'Relationship Type OS changed to "pending os client"', 210, ''],
  ['crm_class',       'CRM: Customer Class set to IC Vendor',        'Both', 'CRM and accounting', 'TRUE', '',            'Customer Class changed to IC Vendor', 220, ''],
  ['profile',         'IC Vendor Profile set up',                    'Both', 'CRM and accounting', 'TRUE', '',            'IC Vendor Profile setup', 230, ''],
  ['accounting',      'Vendor profile sent to Accounting for activation', 'Both', 'CRM and accounting', 'TRUE', '',       'IC Vendor Profile sent to Accounting for Activation', 240, 'Last step. Accounting activates the vendor in Business Central.']
];

// ------------------------------------------------------------ dispatch ----

function obDispatch(data) {
  var kind = String(data.kind || '');
  try {
    if (kind === 'vd_eval') return obVendorEval_(data);
    if (kind === 'ob_bc_request') return obBcRequest_(data);
    if (kind === 'ob_vendor_suggest') return obVendorSuggest_(data);
    if ((data.passcode || '') === '' || (data.passcode || '') !== vdPass_()) {
      return vdOut_({ ok: false, error: 'Wrong passcode.' });
    }
    if (kind === 'ob_setup') return obSetup_(data);
    if (kind === 'ob_list') return obList_(data);
    if (kind === 'ob_save') return obSave_(data);
    if (kind === 'ob_doc') return obDoc_(data);
    if (kind === 'ob_docs') return obDoc_(data);
    if (kind === 'ob_note') return obNote_(data);
    if (kind === 'ob_bc_update') return obBcUpdate_(data);
    if (kind === 'ob_import_asana') return obImportAsana_(data);
    return vdOut_({ ok: false, error: 'Unknown ob kind' });
  } catch (e) {
    return vdOut_({ ok: false, error: String(e && e.message ? e.message : e), where: kind });
  }
}

// ------------------------------------------------------------ helpers -----

function obNow_() { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'); }
function obToday_() { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd'); }
function obId_(prefix) {
  return prefix + '-' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd') + '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase();
}
function obMarketKey_(raw) {
  var s = vdStr_(raw).toLowerCase();
  if (!s) return '';
  if (s === 'lv' || s === 'nnv') return s;
  if (/north(ern)? ?nevada|nnv|reno|sparks|carson/.test(s) && !/north las vegas/.test(s)) return 'nnv';
  if (/las vegas|lv|southern|henderson/.test(s)) return 'lv';
  return '';
}
// Normalize a company name so "Clean All Time, LLC" and "CLEAN ALL TIME LLC" meet.
function obNorm_(s) {
  return vdStr_(s).toLowerCase()
    .replace(/[‘’'`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(llc|l l c|inc|incorporated|corp|corporation|co|company|ltd|dba|d b a|the)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function obTab_(ss, name, headers, color) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = vdTab_(ss, name, headers, color);
    return sh;
  }
  // Add any header this version knows that the tab does not have yet, at the end.
  var last = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, last).getValues()[0].map(vdStr_);
  var missing = headers.filter(function (h) { return head.indexOf(h) < 0; });
  if (missing.length) {
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing])
      .setFontWeight('bold').setBackground(color).setFontColor('#FFFFFF');
  }
  return sh;
}
function obRows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return { head: sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(vdStr_), rows: [] };
  var vals = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
  var head = vals[0].map(vdStr_);
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    var o = { _row: i + 1 };
    var any = false;
    for (var c = 0; c < head.length; c++) {
      if (!head[c]) continue;
      o[head[c]] = vdStr_(vals[i][c]);
      if (o[head[c]]) any = true;
    }
    if (any) rows.push(o);
  }
  return { head: head, rows: rows };
}
function obSet_(sh, head, row, field, value) {
  var i = head.indexOf(field);
  if (i < 0) return;
  sh.getRange(row, i + 1).setValue(value == null ? '' : String(value));
}
function obAppend_(sh, head, obj) {
  var out = head.map(function (h) { return obj[h] == null ? '' : String(obj[h]); });
  var at = Math.max(sh.getLastRow(), 1) + 1;
  sh.getRange(at, 1, 1, out.length).setValues([out]);
  return at;
}
function obLog_(ss, entry) {
  try {
    var sh = obTab_(ss, OB_LOG_TAB, OB_LOG_HEADERS, '#636466');
    sh.appendRow([obNow_(), entry.ob_id || '', entry.vendor || '', entry.who || '', entry.action || '',
                  entry.item || '', entry.from || '', entry.to || '', String(entry.note || '').slice(0, 2000)]);
  } catch (e) {}
}
function obDocs_(row) {
  try { var d = JSON.parse(row.docs || '{}'); return (d && typeof d === 'object') ? d : {}; } catch (e) { return {}; }
}
function obChecklist_(ss) {
  var sh = obTab_(ss, OB_CFG_TAB, OB_CFG_HEADERS, '#0AA6A9');
  var rows = obRows_(sh).rows.filter(function (r) { return r.key; });
  if (!rows.length) {
    sh.getRange(2, 1, OB_CHECKLIST_SEED.length, OB_CFG_HEADERS.length).setValues(OB_CHECKLIST_SEED);
    rows = obRows_(sh).rows;
  }
  rows.sort(function (a, b) { return Number(a.order || 0) - Number(b.order || 0); });
  return rows.map(function (r) {
    return { key: r.key, label: r.label, track: r.track || 'Both', group: r.group || '', required: vdTrue_(r.required),
             auto: r.auto || '', asana: r.asana_name || '', hint: r.hint || '' };
  });
}
function obItemsFor_(cfg, track) {
  return cfg.filter(function (c) { return c.track === 'Both' || c.track === track; });
}

// ------------------------------------------------------------ setup -------

function obSetup_(data) {
  var ss = vdSS_();
  obTab_(ss, OB_TAB, OB_HEADERS, '#D22730');
  obTab_(ss, OB_CFG_TAB, OB_CFG_HEADERS, '#0AA6A9');
  obTab_(ss, OB_LOG_TAB, OB_LOG_HEADERS, '#636466');
  obTab_(ss, OB_REQ_TAB, OB_REQ_HEADERS, '#2F6FD6');
  var cfg = obChecklist_(ss);
  var sh = ss.getSheetByName(OB_TAB);
  try {
    var stageRule = SpreadsheetApp.newDataValidation().requireValueInList(OB_STAGES, true).build();
    sh.getRange(2, OB_HEADERS.indexOf('stage') + 1, 2000, 1).setDataValidation(stageRule);
    var trackRule = SpreadsheetApp.newDataValidation().requireValueInList(['JS', 'OS'], true).build();
    sh.getRange(2, OB_HEADERS.indexOf('track') + 1, 2000, 1).setDataValidation(trackRule);
    sh.setColumnWidth(OB_HEADERS.indexOf('vendor') + 1, 240);
    sh.setColumnWidth(OB_HEADERS.indexOf('notes') + 1, 320);
    sh.setColumnWidth(OB_HEADERS.indexOf('docs') + 1, 120);
    var rq = ss.getSheetByName(OB_REQ_TAB);
    var stRule = SpreadsheetApp.newDataValidation().requireValueInList(OB_REQ_STATUS, true).build();
    rq.getRange(2, OB_REQ_HEADERS.indexOf('status') + 1, 2000, 1).setDataValidation(stRule);
  } catch (e) {}
  return vdOut_({ ok: true, items: cfg.length, sheet: ss.getUrl() });
}

// ------------------------------------------------------------ list --------

// One call for the desk. Vendors: every directory row that is live (Active, Waiting for
// Account, In Progress) or a Hub invite prospect, plus any vendor that has an onboarding
// row whatever its status. Never business_address.
function obList_(data) {
  var ss = vdSS_();
  var cfg = obChecklist_(ss);
  var obSh = obTab_(ss, OB_TAB, OB_HEADERS, '#D22730');
  var obRows = obRows_(obSh).rows;
  var byVendor = {};
  obRows.forEach(function (r) {
    r.docs = obDocs_(r);
    if (r.vendor_id) { byVendor[r.vendor_id] = byVendor[r.vendor_id] || []; byVendor[r.vendor_id].push(r.ob_id); }
    delete r._row;
  });

  var all = vdAllRows_(ss).filter(function (r) { return r.dba_name && !vdTrue_(r.hide); });
  var vendors = [];
  all.forEach(function (r) {
    var live = VD_LIVE_STATUS.indexOf(r.status) >= 0;
    var invited = vdInvIsPlaceholder_(r);
    if (!live && !invited && !byVendor[r.vendor_id]) return;
    var slugs = vdSlugs_(r.service_types);
    vendors.push({
      vendor_id: r.vendor_id, dba_name: r.dba_name, legal_name: r.legal_name || '', status: r.status,
      region: vdRegion_(r.region), market: vdRegion_(r.region) === 'Northern Nevada' ? 'nnv' : 'lv',
      both: vdRegion_(r.region) === 'Both', janitorial: slugs.indexOf(VD_JANITORIAL) >= 0,
      service_types: r.service_types || '', contact_name: r.contact_name || '', email: r.email || '',
      phone: r.phone || '', source: r.source || '', eval_date: r.eval_date || '', updated: r.updated || '',
      cw_start_date: r.cw_start_date || '', gl_exp: r.gl_exp || '', wc_exp: r.wc_exp || '',
      invited: invited, live: live, ob: byVendor[r.vendor_id] || []
    });
  });

  // Crew background checks per vendor (names, results). Same fields the Admin Hub
  // background-checks page uses, keyed by vendor_id or the vendor name as typed.
  var crew = [];
  VD_BC_TABS.forEach(function (b) {
    var sh = ss.getSheetByName(b.name);
    if (!sh) return;
    vdRows_(sh).rows.forEach(function (r) {
      var name = [vdStr_(r.first_name), vdStr_(r.last_name)].filter(function (x) { return x; }).join(' ');
      if (!name) return;
      crew.push({ market: b.key, row: r._row, vendor_id: r.vendor_id || '', vendor: r.vendor || r.roster_company_as_typed || '',
                  first_name: r.first_name || '', last_name: r.last_name || '', status: r.status || '', result: vdBcRes_(r.result),
                  result_date: r.result_date || '', check_type: r.check_type || '', source: r.source || '',
                  most_recent_check: r.most_recent_check || '', notes: r.notes || '', reviewed_by: r.reviewed_by || '' });
    });
  });

  var reqSh = obTab_(ss, OB_REQ_TAB, OB_REQ_HEADERS, '#2F6FD6');
  var reqs = obRows_(reqSh).rows.map(function (r) { delete r._row; r.status = obReqStatus_(r.status); return r; });

  var logSh = ss.getSheetByName(OB_LOG_TAB);
  var log = [];
  if (logSh && data.log !== false) {
    var lr = obRows_(logSh).rows;
    log = lr.slice(Math.max(0, lr.length - 150)).map(function (r) { delete r._row; return r; }).reverse();
  }

  return vdOut_({ ok: true, checklist: cfg, stages: OB_STAGES, req_types: OB_REQ_TYPES, req_status: OB_REQ_STATUS,
                  badge: OB_BADGE, vendors: vendors, onboarding: obRows, crew: crew, requests: reqs, log: log,
                  fetched: new Date().toISOString() });
}

// ------------------------------------------------------------ writes ------

function obFindRow_(sh, head, rows, obId) {
  for (var i = 0; i < rows.length; i++) if (rows[i].ob_id === obId) return rows[i];
  return null;
}
function obVendorById_(ss, vid) {
  if (!vid) return null;
  var hit = vdAllRows_(ss).filter(function (r) { return r.vendor_id === vid; })[0];
  return hit || null;
}

// Create or update. {ob_id?} or {vendor_id, track} to find; fields: stage, track,
// priority, assignee, market, notes (replaces), completed. New rows need vendor_id or vendor.
function obSave_(data) {
  var ss = vdSS_();
  var sh = obTab_(ss, OB_TAB, OB_HEADERS, '#D22730');
  var rr = obRows_(sh), head = rr.head;
  var who = vdStr_(data.who) || 'Admin Hub';
  var row = data.ob_id ? obFindRow_(sh, head, rr.rows, vdStr_(data.ob_id)) : null;
  if (!row && data.vendor_id && data.track) {
    row = rr.rows.filter(function (r) { return r.vendor_id === data.vendor_id && r.track === data.track; })[0] || null;
  }
  var fields = ['stage', 'track', 'priority', 'assignee', 'market', 'notes', 'completed', 'vendor_id', 'vendor'];
  if (row) {
    var changes = [];
    fields.forEach(function (f) {
      if (data[f] === undefined) return;
      var v = vdStr_(data[f]);
      if (f === 'stage' && v && OB_STAGES.indexOf(v) < 0) throw new Error('Unknown stage ' + v);
      if (row[f] === v) return;
      changes.push({ item: f, from: row[f], to: v });
      obSet_(sh, head, row._row, f, v);
      row[f] = v;
    });
    if (data.stage === 'Complete' && !row.completed) obSet_(sh, head, row._row, 'completed', obToday_());
    if (data.vendor_id) {
      var v2 = obVendorById_(ss, vdStr_(data.vendor_id));
      if (v2) { obSet_(sh, head, row._row, 'vendor', v2.dba_name); obSet_(sh, head, row._row, 'matched', 'TRUE'); }
    }
    obSet_(sh, head, row._row, 'updated', obNow_());
    obSet_(sh, head, row._row, 'updated_by', who);
    changes.forEach(function (c) { obLog_(ss, { ob_id: row.ob_id, vendor: row.vendor, who: who, action: 'update', item: c.item, from: c.from, to: c.to }); });
    return vdOut_({ ok: true, ob_id: row.ob_id, updated: true, changes: changes.length });
  }
  var vid = vdStr_(data.vendor_id);
  var v = obVendorById_(ss, vid);
  if (!v && !vdStr_(data.vendor)) return vdOut_({ ok: false, error: 'Pick a vendor from the directory first.' });
  var track = vdStr_(data.track) || (v && vdSlugs_(v.service_types).indexOf(VD_JANITORIAL) >= 0 ? 'JS' : 'OS');
  var obj = obNewRow_(ss, v, { vendor: vdStr_(data.vendor), track: track, stage: vdStr_(data.stage) || 'New',
    market: vdStr_(data.market), assignee: vdStr_(data.assignee), priority: vdStr_(data.priority),
    notes: vdStr_(data.notes), source: 'Admin Hub', who: who });
  return vdOut_({ ok: true, ob_id: obj.ob_id, created: true });
}

// Shared row builder used by save, the eval feed, the upload hook and the import.
function obNewRow_(ss, v, o) {
  var sh = obTab_(ss, OB_TAB, OB_HEADERS, '#D22730');
  var head = obRows_(sh).head;
  var region = v ? vdRegion_(v.region) : '';
  var market = o.market || (region === 'Northern Nevada' ? 'nnv' : region === 'Both' ? 'lv' : region ? 'lv' : 'lv');
  var obj = {
    ob_id: obId_('OB'), vendor_id: v ? v.vendor_id : '', vendor: v ? v.dba_name : o.vendor, market: market,
    track: o.track || 'JS', stage: o.stage || 'New', priority: o.priority || '', assignee: o.assignee || '',
    started: o.started || obToday_(), completed: o.completed || '', asana_gid: o.asana_gid || '',
    asana_section: o.asana_section || '', asana_status: o.asana_status || '', notes: o.notes || '',
    docs: JSON.stringify(o.docs || {}), updated: obNow_(), updated_by: o.who || 'system', source: o.source || '',
    contact_name: v ? v.contact_name : (o.contact_name || ''), email: v ? v.email : (o.email || ''),
    phone: v ? v.phone : (o.phone || ''), matched: v ? 'TRUE' : 'FALSE'
  };
  obj._row = obAppend_(sh, head, obj);
  obLog_(ss, { ob_id: obj.ob_id, vendor: obj.vendor, who: obj.updated_by, action: 'create', item: 'stage', to: obj.stage,
               note: (obj.source || '') + (v ? '' : ' (not matched to a directory vendor)') });
  return obj;
}

// {ob_id, key, state, note, who}  or  {ob_id, items:[{key,state,note}], who}
function obDoc_(data) {
  var ss = vdSS_();
  var sh = obTab_(ss, OB_TAB, OB_HEADERS, '#D22730');
  var rr = obRows_(sh), head = rr.head;
  var row = obFindRow_(sh, head, rr.rows, vdStr_(data.ob_id));
  if (!row) return vdOut_({ ok: false, error: 'That onboarding record was not found. Reload the page.' });
  var who = vdStr_(data.who) || 'Admin Hub';
  var items = data.items || [{ key: data.key, state: data.state, note: data.note }];
  var docs = obDocs_(row);
  var n = 0;
  items.forEach(function (it) {
    var key = vdStr_(it.key); if (!key) return;
    var state = vdStr_(it.state).toLowerCase();
    if (OB_DOC_STATES.indexOf(state) < 0) throw new Error('Bad state ' + state);
    var prev = docs[key] || {};
    var next = { s: state, d: obToday_(), by: who, n: it.note === undefined ? (prev.n || '') : vdStr_(it.note), src: 'hub' };
    if (!state && !next.n) { delete docs[key]; } else docs[key] = next;
    obLog_(ss, { ob_id: row.ob_id, vendor: row.vendor, who: who, action: 'doc', item: key, from: prev.s || '', to: state, note: next.n });
    n++;
  });
  obSet_(sh, head, row._row, 'docs', JSON.stringify(docs));
  obSet_(sh, head, row._row, 'updated', obNow_());
  obSet_(sh, head, row._row, 'updated_by', who);
  return vdOut_({ ok: true, ob_id: row.ob_id, docs: docs, changed: n });
}

function obNote_(data) {
  var ss = vdSS_();
  var sh = obTab_(ss, OB_TAB, OB_HEADERS, '#D22730');
  var rr = obRows_(sh), head = rr.head;
  var row = obFindRow_(sh, head, rr.rows, vdStr_(data.ob_id));
  if (!row) return vdOut_({ ok: false, error: 'Record not found. Reload the page.' });
  var text = vdStr_(data.note);
  if (!text) return vdOut_({ ok: false, error: 'Type the note first.' });
  var who = vdStr_(data.who) || 'Admin Hub';
  var line = obToday_() + ' ' + who + ': ' + text;
  var notes = (line + '\n' + (row.notes || '')).trim().slice(0, 45000);
  obSet_(sh, head, row._row, 'notes', notes);
  obSet_(sh, head, row._row, 'updated', obNow_());
  obSet_(sh, head, row._row, 'updated_by', who);
  obLog_(ss, { ob_id: row.ob_id, vendor: row.vendor, who: who, action: 'note', note: text });
  return vdOut_({ ok: true, notes: notes });
}

// Find (or create) the onboarding row for a vendor. Used by the automatic feeds.
function obEnsure_(ss, v, track, source, who) {
  var sh = obTab_(ss, OB_TAB, OB_HEADERS, '#D22730');
  var rr = obRows_(sh);
  var rows = rr.rows.filter(function (r) { return r.vendor_id && r.vendor_id === v.vendor_id; });
  var row = rows.filter(function (r) { return r.track === track; })[0] || rows[0];
  if (row) return { row: row, sh: sh, head: rr.head, created: false };
  var obj = obNewRow_(ss, v, { track: track, stage: 'New', source: source, who: who });
  var rr2 = obRows_(sh);
  var row2 = rr2.rows.filter(function (r) { return r.ob_id === obj.ob_id; })[0];
  return { row: row2, sh: sh, head: rr2.head, created: true };
}
// Set a checklist item from a feed, never downgrading a Verified item to Received.
function obFeedDoc_(ss, found, key, state, note, src) {
  var docs = obDocs_(found.row);
  var prev = docs[key] || {};
  if (prev.s === 'verified' && state === 'received') return false;
  docs[key] = { s: state, d: obToday_(), by: src, n: note || prev.n || '', src: src };
  obSet_(found.sh, found.head, found.row._row, 'docs', JSON.stringify(docs));
  obSet_(found.sh, found.head, found.row._row, 'updated', obNow_());
  obSet_(found.sh, found.head, found.row._row, 'updated_by', src);
  found.row.docs = JSON.stringify(docs);
  obLog_(ss, { ob_id: found.row.ob_id, vendor: found.row.vendor, who: src, action: 'doc', item: key, from: prev.s || '', to: state, note: note });
  return true;
}
// Vendor name from a public form -> directory row. Exact normalized match on dba or
// legal name, else the only candidate that starts with / contains it, else email.
function obMatchVendor_(all, name, email) {
  var n = obNorm_(name);
  var mail = vdStr_(email).toLowerCase();
  if (n) {
    var exact = all.filter(function (r) { return obNorm_(r.dba_name) === n || (r.legal_name && obNorm_(r.legal_name) === n); });
    if (exact.length) return { v: exact[0], how: 'name', sure: exact.length === 1 };
    var loose = all.filter(function (r) {
      var a = obNorm_(r.dba_name), b = obNorm_(r.legal_name || '');
      return (a && (a.indexOf(n) === 0 || n.indexOf(a) === 0)) || (b && (b.indexOf(n) === 0 || n.indexOf(b) === 0));
    });
    if (loose.length === 1) return { v: loose[0], how: 'partial', sure: false };
  }
  if (mail) {
    var em = all.filter(function (r) { return vdStr_(r.email).toLowerCase() === mail; });
    if (em.length === 1) return { v: em[0], how: 'email', sure: false };
  }
  return { v: null, how: '', sure: false };
}

// ------------------------------------------------------------ feeds -------

// Uploads.gs calls this after a Vendor Hub upload lands. info: {company, doc_type,
// coverage, region, email, first, last, links}
function obUploadHook_(info) {
  var ss = vdSS_();
  var all = vdAllRows_(ss).filter(function (r) { return r.dba_name; });
  var m = obMatchVendor_(all, info.company, info.email);
  var dt = String(info.doc_type || '');
  var keys = [];
  if (/insurance/i.test(dt)) {
    var cov = String(info.coverage || '');
    if (/both/i.test(cov)) keys = ['coi_gl', 'coi_wc'];
    else if (/workers/i.test(cov)) keys = ['coi_wc'];
    else keys = ['coi_gl'];
  } else if (/waiver/i.test(dt)) keys = ['waiver'];
  else if (/check|bank/i.test(dt)) keys = ['bank'];
  var note = 'Uploaded on the Vendor Hub ' + obToday_() + (info.links ? ' ' + String(info.links).split('\n')[0] : '');
  if (!m.v) {
    obLog_(ss, { vendor: info.company, who: 'Vendor Hub upload', action: 'upload unmatched', item: keys.join(','), note: note + ' (' + (info.first || '') + ' ' + (info.last || '') + ', ' + (info.email || '') + ')' });
    return { matched: false };
  }
  var track = vdSlugs_(m.v.service_types).indexOf(VD_JANITORIAL) >= 0 ? 'JS' : 'OS';
  var found = obEnsure_(ss, m.v, track, 'Vendor Hub upload', 'Vendor Hub upload');
  keys.forEach(function (k) { obFeedDoc_(ss, found, k, 'received', note, 'Vendor Hub upload'); });
  return { matched: true, vendor_id: m.v.vendor_id, keys: keys };
}

// The native Vendor Evaluation page (cw-vendor-hub/vendor-evaluation.html) posts
// kind vd_eval with {vendor:{...VD_HEADERS fields}, region, service_types, company_fax}.
// Same rules as the old Jotform intake (vdIntake_): never overwrite an existing
// vendor from a public form; upgrade a Hub invite placeholder; otherwise add.
function obVendorEval_(data) {
  if (vdStr_(data.company_fax) || vdStr_(data.website_hp)) return vdOut_({ ok: true });   // honeypot
  var v = data.vendor || {};
  var dba = vdStr_(v.dba_name);
  if (!dba) return vdOut_({ ok: false, error: 'Business name is required.' });
  if (vdStr_(v.email).indexOf('@') < 1) return vdOut_({ ok: false, error: 'A valid email is required.' });
  v.region = vdStr_(data.region) || vdStr_(v.region);
  v.service_types = vdStr_(data.service_types) || vdStr_(v.service_types);
  if (vdStr_(data.region_note)) v.additional_notes = (vdStr_(v.additional_notes) + ' ' + vdStr_(data.region_note)).trim();
  v.eval_date = obToday_();
  var clean = {};
  VD_HEADERS.forEach(function (h) { if (v[h] !== undefined && v[h] !== null) clean[h] = String(v[h]).slice(0, 4000); });
  clean.business_address = vdStr_(v.business_address).slice(0, 300);

  var ss = vdSS_();
  if (!vdVendorSheets_(ss).length) vdSetup_({});
  var all = vdAllRows_(ss);
  var key = dba.toLowerCase();
  var mail = vdStr_(clean.email).toLowerCase();
  var hit = all.filter(function (r) { return r.dba_name.toLowerCase() === key; })[0];
  if (!hit && mail) hit = all.filter(function (r) { return vdStr_(r.email).toLowerCase() === mail; })[0];
  if (!hit) { var mm = obMatchVendor_(all, dba, ''); if (mm.v && mm.sure) hit = mm.v; }
  var action = 'added', vid = '';
  var region = clean.region;
  if (hit && vdInvIsPlaceholder_(hit)) {
    action = 'invite upgraded'; vid = hit.vendor_id;
    var keep = { vendor_id: 1, internal_notes: 1, outreach: 1, status: 1, source: 1, added_by: 1, hide: 1,
                 last_audit: 1, audit_result: 1, audit_next_due: 1, audit_pdf: 1 };
    VD_HEADERS.forEach(function (h) {
      if (keep[h] || clean[h] === undefined || clean[h] === '') return;
      vdInvSet_(hit._sheet, hit._row, h, clean[h]);
    });
    vdInvSet_(hit._sheet, hit._row, 'region', vdRegion_(region || hit.region));
    vdInvSet_(hit._sheet, hit._row, 'status', 'In Progress');
    vdInvSet_(hit._sheet, hit._row, 'source', 'Eval Form');
    vdInvSet_(hit._sheet, hit._row, 'updated', obToday_());
    hit.status = 'In Progress'; hit.service_types = clean.service_types || hit.service_types;
  } else if (hit) {
    action = 'matched existing, not changed'; vid = hit.vendor_id;
    // Keep the directory as the team left it, but the evaluation itself is new
    // information: stamp the date so the desk can show it was re-submitted.
    if (!vdStr_(hit.eval_date)) vdInvSet_(hit._sheet, hit._row, 'eval_date', obToday_());
  } else {
    vid = vdNextId_(all);
    clean.vendor_id = vid; clean.status = 'In Progress'; clean.source = 'Eval Form';
    clean.added_by = 'Vendor Hub evaluation'; clean.region = vdRegion_(region); clean.updated = obToday_();
    var outRow = VD_HEADERS.map(function (h) { return clean[h] == null ? '' : String(clean[h]); });
    var sh = vdTabFor_(ss, clean.region);
    sh.getRange(vdNextRow_(sh), 1, 1, VD_HEADERS.length).setValues([outRow]);
    hit = clean; hit.vendor_id = vid;
  }
  var log = ss.getSheetByName(VD_TABS.INTAKE);
  if (log) {
    var logged = {}; Object.keys(clean).forEach(function (k) { if (k !== 'business_address') logged[k] = clean[k]; });
    log.appendRow([obNow_(), 'EVAL', dba, vdStr_(clean.contact_name), vdStr_(clean.email), vdStr_(clean.phone),
                   vdStr_(clean.region), vdStr_(clean.service_types), vid, action, JSON.stringify(logged).slice(0, 45000)]);
  }
  // Onboarding record + tick the evaluation item.
  var janitorial = vdSlugs_(hit.service_types || clean.service_types).indexOf(VD_JANITORIAL) >= 0;
  var found = obEnsure_(ss, hit, janitorial ? 'JS' : 'OS', 'Vendor evaluation', 'Vendor Hub evaluation');
  obFeedDoc_(ss, found, 'eval', 'received', 'Evaluation submitted on the Vendor Hub ' + obToday_(), 'Vendor Hub evaluation');
  // Record, PDF and the branded team email all live in VendorEval.gs (Sep 22 2026).
  // Everything there is best effort: the directory row and the onboarding record
  // above are already written, so a Drive or a mail failure must never fail the
  // vendor's submission. If VendorEval.gs is ever removed from the project, the
  // else branch keeps the old plain text notice going out.
  var evalOut = { eval_id: '', pdf_url: '', error: '' };
  try {
    if (typeof vevOnSubmit_ === 'function') {
      evalOut = vevOnSubmit_(clean, action, vdRegion_(region), vid);
      if (evalOut.pdf_url) {
        try { obFeedDoc_(ss, found, 'eval', 'received', 'Evaluation PDF: ' + evalOut.pdf_url, 'Vendor Hub evaluation'); } catch (fe) {}
      }
    } else {
      var mk = OB_MARKETS[obMarketKey_(vdRegion_(region)) || 'lv'];
      var both = vdRegion_(region) === 'Both';
      var to = both ? OB_MARKETS.lv.compliance + ',' + OB_MARKETS.nnv.compliance : mk.compliance;
      var lines = ['Vendor evaluation received (' + action + ')', '', 'Company: ' + dba,
        'Contact: ' + vdStr_(clean.contact_name) + ', ' + vdStr_(clean.phone) + ', ' + vdStr_(clean.email),
        'Region: ' + vdRegion_(region), 'Services: ' + vdStr_(clean.trade_raw || clean.service_types),
        'Directory id: ' + vid, '', 'Onboarding desk: ' + OB_DESK_URL + '#' + encodeURIComponent(vid)];
      cwMail_('vd_eval', { to: to, name: mk.sender, replyTo: mk.compliance,
        subject: 'New vendor evaluation: ' + dba + ' (' + vdRegion_(region) + ')', body: lines.join('\n') });
    }
  } catch (me) { evalOut.error = String(me && me.message || me); }
  return vdOut_({ ok: true, vendor_id: vid, action: action });
}

// ------------------------------------------------------------ suggest -----

// The company picker on the Vendor Hub background check page. Vendors must never be
// able to browse the directory, so: region required, at least five letters typed,
// only names the typed text covers 60% of, at most three, and only name plus the
// contact's name (so Bright Cleaning, Bright View and Go-Bright are told apart).
function obVendorSuggest_(data) {
  var mk = obMarketKey_(data.market);
  var q = obNorm_(data.q);
  if (!mk || q.length < 5) return vdOut_({ ok: true, matches: [] });
  var all = vdAllRows_(vdSS_()).filter(function (r) { return r.dba_name && !vdTrue_(r.hide) && r.status !== 'Do Not Contact'; });
  var region = mk === 'nnv' ? 'Northern Nevada' : 'Las Vegas';
  var out = [];
  all.forEach(function (r) {
    var reg = vdRegion_(r.region);
    if (reg !== region && reg !== 'Both') return;
    var names = [obNorm_(r.dba_name), obNorm_(r.legal_name || '')].filter(Boolean);
    var best = 0;
    names.forEach(function (n) {
      if (!n) return;
      if (n === q) best = Math.max(best, 3);
      else if (n.indexOf(q) === 0 && q.length >= 0.6 * n.length) best = Math.max(best, 2);
      else if (n.indexOf(q) >= 0 && q.length >= 0.6 * n.length) best = Math.max(best, 1);
    });
    if (best) out.push({ score: best, vendor_id: r.vendor_id, name: r.dba_name, contact: vdStr_(r.contact_name), region: reg });
  });
  out.sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); });
  return vdOut_({ ok: true, matches: out.slice(0, 3).map(function (m) { return { vendor_id: m.vendor_id, name: m.name, contact: m.contact }; }) });
}

// Store a vendor-run report in the compliance uploads folder (Uploads.gs owns it).
// Returns { link, name } or throws with a plain message.
function obStoreReport_(rid, company, person, f) {
  var ct = String(f.type || 'application/pdf');
  var okTypes = ['application/pdf', 'image/png', 'image/jpeg'];
  var name = String(f.name || 'report').replace(/[^\w .()-]+/g, '_').slice(0, 120) || 'report';
  if (okTypes.indexOf(ct) < 0) throw new Error('"' + name + '" is not a PDF or a photo (JPG, PNG).');
  var blob;
  try { blob = Utilities.newBlob(Utilities.base64Decode(String(f.data || '')), ct, name); } catch (e) { throw new Error('Could not read "' + name + '". Attach it again.'); }
  var n = blob.getBytes().length;
  if (!n) throw new Error('"' + name + '" came through empty. Attach it again.');
  if (n > 10 * 1024 * 1024) throw new Error('"' + name + '" is over 10 MB. Compress it and try again.');
  var folder = (typeof docFolder_ === 'function') ? docFolder_() : DriveApp.getRootFolder();
  var stored = folder.createFile(blob.copyBlob().setName(rid + ' - ' + String(company).replace(/[^\w .()-]+/g, '_').slice(0, 60) + ' - ' + person + ' - ' + name));
  return { link: stored.getUrl(), name: name, blob: blob };
}

// ------------------------------------------------------------ BC requests -

// Vendor Hub background-check.html. No passcode. Payload:
// { market:'lv'|'nnv', company, submitted_by, submitter_email, request_type,
//   people:[{first, middle, last, preferred, email, mobile, notify, client_account}], company_fax }
function obBcRequest_(data) {
  if (vdStr_(data.company_fax)) return vdOut_({ ok: true, id: 'ok' });   // honeypot
  var mk = OB_MARKETS[obMarketKey_(data.market)];
  if (!mk) return vdOut_({ ok: false, error: 'Pick your region: Las Vegas or Northern Nevada.' });
  var company = vdStr_(data.company).slice(0, 160);
  if (!company) return vdOut_({ ok: false, error: 'Your company name is required.' });
  var rtype = vdStr_(data.request_type);
  if (OB_REQ_TYPES.indexOf(rtype) < 0) return vdOut_({ ok: false, error: 'Pick what you need.' });
  var people = (data.people || []).slice(0, 10);
  if (!people.length) return vdOut_({ ok: false, error: 'Add at least one person.' });
  var subBy = vdStr_(data.submitted_by).slice(0, 120), subMail = vdStr_(data.submitter_email).slice(0, 160);
  if (subMail.indexOf('@') < 1) return vdOut_({ ok: false, error: 'Your email is required so we can reach you.' });
  var needsCheck = rtype === OB_REQ_TYPES[0];
  for (var i = 0; i < people.length; i++) {
    var p = people[i] || {};
    if (!vdStr_(p.first) || !vdStr_(p.last)) return vdOut_({ ok: false, error: 'Person ' + (i + 1) + ' needs a first and last name.' });
    if (needsCheck && vdStr_(p.email).indexOf('@') < 1) return vdOut_({ ok: false, error: 'Person ' + (i + 1) + ' needs an email address. Verified First sends the consent form there.' });
    if (needsCheck && vdStr_(p.mobile).replace(/\D/g, '').length < 10) return vdOut_({ ok: false, error: 'Person ' + (i + 1) + ' needs a mobile number.' });
  }

  var ss = vdSS_();
  var all = vdAllRows_(ss).filter(function (r) { return r.dba_name; });
  // The vendor picked their company from the suggestions: use that record, as long as the
  // typed name still resembles it (a stray id cannot attach a request to someone else).
  var m = { v: null, how: '' };
  var pickedId = vdStr_(data.vendor_id);
  if (pickedId) {
    var picked = all.filter(function (r) { return r.vendor_id === pickedId; })[0];
    if (picked) {
      var nq = obNorm_(company), nn = obNorm_(picked.dba_name), nl = obNorm_(picked.legal_name || '');
      if (nq === nn || nq === nl || (nq.length >= 5 && (nn.indexOf(nq) >= 0 || nq.indexOf(nn) >= 0 || (nl && nl.indexOf(nq) >= 0)))) m = { v: picked, how: 'picked' };
    }
  }
  if (!m.v) m = obMatchVendor_(all, company, subMail);
  var reqSh = obTab_(ss, OB_REQ_TAB, OB_REQ_HEADERS, '#2F6FD6');
  var head = obRows_(reqSh).head;
  var ids = [], bcRows = [], attachments = [], reports = [];
  // Store any vendor-run reports before writing rows, so a bad file stops the whole submission cleanly.
  for (var pi = 0; pi < people.length; pi++) {
    var pp = people[pi] || {};
    if (pp.report && pp.report.data) {
      var ridR = obId_('BC');
      pp._rid = ridR;
      var who2 = [vdStr_(pp.first), vdStr_(pp.last)].filter(Boolean).join(' ');
      var st;
      try { st = obStoreReport_(ridR, company, who2, pp.report); }
      catch (se) { return vdOut_({ ok: false, error: 'Person ' + (pi + 1) + ': ' + String(se.message || se) + ' Or email it to ' + mk.compliance + '.' }); }
      pp._report = st; attachments.push(st.blob); reports.push(who2 + ': ' + st.link);
    }
  }
  people.forEach(function (p) {
    var first = vdStr_(p.first).slice(0, 80), middle = vdStr_(p.middle).slice(0, 80), last = vdStr_(p.last).slice(0, 80);
    var legal = [first, middle, last].filter(function (x) { return x; }).join(' ');
    var rid = p._rid || obId_('BC');
    var hasReport = !!p._report;
    var req = {
      req_id: rid, received: obNow_(), market: mk.key, company: company, vendor_id: m.v ? m.v.vendor_id : '',
      request_type: rtype, legal_name: legal, first_name: first, last_name: last, preferred_name: vdStr_(p.preferred).slice(0, 80),
      email: vdStr_(p.email).slice(0, 160), mobile: vdStr_(p.mobile).slice(0, 40), notify: vdStr_(p.notify).slice(0, 160),
      client_account: vdStr_(p.client_account).slice(0, 160), submitted_by: subBy, submitter_email: subMail,
      source: 'Vendor Hub', asana_gid: '', asana_done: '', status: hasReport ? 'Review report' : needsCheck ? 'New' : 'Badge only', sent: '',
      badge: 'Needed', notes: hasReport ? 'Vendor ran the check on their own platform and attached the report.' : '', updated: obNow_(), updated_by: 'Vendor Hub', dupe_of: '',
      report_link: hasReport ? p._report.link : '', report_name: hasReport ? p._report.name : '', matched_how: m.how || ''
    };
    obAppend_(reqSh, head, req);
    ids.push(rid);
    if (needsCheck || hasReport) {
      bcRows.push({ market: mk.key, vendor_id: m.v ? m.v.vendor_id : '', vendor: m.v ? m.v.dba_name : company,
        roster_company_as_typed: m.v ? '' : company, first_name: first, last_name: last, status: 'Pending', check_type: 'Standard',
        source: hasReport ? 'Vendor submitted' : 'City Wide',
        notes: (hasReport ? 'Vendor-run report attached on the Vendor Hub ' + obToday_() + ' (' + rid + '). Review it, save it to the vendor folder, then mark Clear or Not clear. ' + p._report.link
                          : 'Requested on the Vendor Hub ' + obToday_() + ' (' + rid + ').') });
    }
  });
  // The person rows the review desk already works from. Pending until the BOM records
  // a result. vdBcUpsert_ dedupes on vendor + name, so a re-request updates in place.
  var upsert = null;
  if (bcRows.length) {
    try { upsert = JSON.parse(vdBcUpsert_({ rows: bcRows, reviewed_by: 'Vendor Hub' }).getContent()); } catch (ue) { upsert = { error: String(ue) }; }
  }
  // Tick the vendor's onboarding item.
  if (m.v && (needsCheck || reports.length)) {
    try {
      var found = obEnsure_(ss, m.v, 'JS', 'Background check request', 'Vendor Hub');
      obFeedDoc_(ss, found, 'bc_request', 'received', people.length + ' person' + (people.length === 1 ? '' : 's') + (reports.length ? ' with a vendor-run report' : ' requested') + ' ' + obToday_(), 'Vendor Hub');
    } catch (oe) {}
  } else if (!m.v) {
    obLog_(ss, { vendor: company, who: 'Vendor Hub', action: 'bc request unmatched', item: ids.join(','), note: 'Company not on the directory. Attach it on the desk.' });
  }
  // Team notice.
  try {
    var lines = [(reports.length ? 'Vendor-run background report to review' : needsCheck ? 'Background check request' : 'Name badge request') + ' from ' + company + (m.v ? ' (' + m.v.vendor_id + (m.how === 'picked' ? ', picked by the vendor' : ', matched by name') + ')' : ' (NOT on the vendor directory yet)'), '',
      'Request: ' + rtype, 'Region: ' + mk.name, 'Submitted by: ' + subBy + ', ' + subMail, ''];
    if (reports.length) lines.push('Reports (also attached): ' + reports.join('; '), '');
    people.forEach(function (p, i) {
      lines.push((i + 1) + '. ' + [vdStr_(p.first), vdStr_(p.middle), vdStr_(p.last)].filter(function (x) { return x; }).join(' ') +
        (vdStr_(p.preferred) ? ' (goes by ' + vdStr_(p.preferred) + ')' : '') + (vdStr_(p.email) ? ', ' + vdStr_(p.email) : '') +
        (vdStr_(p.mobile) ? ', ' + vdStr_(p.mobile) : '') + (vdStr_(p.client_account) ? ', for ' + vdStr_(p.client_account) : ''));
    });
    lines.push('', 'Open the onboarding desk: ' + OB_DESK_URL + '#bc');
    var mail = { to: mk.compliance, name: mk.sender, replyTo: subMail, subject: (reports.length ? 'Review a vendor-run background report: ' : needsCheck ? 'Background check: ' : 'Name badge: ') + company + ' (' + people.length + ')', body: lines.join('\n') };
    if (attachments.length) mail.attachments = attachments;
    cwMail_('ob_bc_request', mail);
  } catch (me) {}
  return vdOut_({ ok: true, ids: ids, matched: !!m.v, how: m.how || '', reports: reports.length, upsert: upsert });
}

// Admin: {req_id, status?, sent?, badge?, notes?, vendor_id?, who}
function obBcUpdate_(data) {
  var ss = vdSS_();
  var sh = obTab_(ss, OB_REQ_TAB, OB_REQ_HEADERS, '#2F6FD6');
  var rr = obRows_(sh), head = rr.head;
  var row = rr.rows.filter(function (r) { return r.req_id === vdStr_(data.req_id); })[0];
  if (!row) return vdOut_({ ok: false, error: 'Request not found. Reload the page.' });
  var who = vdStr_(data.who) || 'Admin Hub';
  ['status', 'sent', 'badge', 'notes', 'vendor_id'].forEach(function (f) {
    if (data[f] === undefined) return;
    var v = vdStr_(data[f]);
    if (f === 'status') v = obReqStatus_(v);
    if (f === 'status' && OB_REQ_STATUS.indexOf(v) < 0) throw new Error('Bad status');
    if (f === 'badge' && OB_BADGE.indexOf(v) < 0) throw new Error('Bad badge state');
    if (row[f] === v) return;
    obSet_(sh, head, row._row, f, v);
    obLog_(ss, { ob_id: row.req_id, vendor: row.company, who: who, action: 'bc request', item: f, from: row[f], to: v });
    row[f] = v;
  });
  if (data.status === 'Sent' && !row.sent) obSet_(sh, head, row._row, 'sent', obToday_());
  obSet_(sh, head, row._row, 'updated', obNow_());
  obSet_(sh, head, row._row, 'updated_by', who);
  return vdOut_({ ok: true });
}

// ------------------------------------------------------------ Asana import

function obAsanaGet_(pat, path) {
  var r = UrlFetchApp.fetch('https://app.asana.com/api/1.0' + path, { headers: { Authorization: 'Bearer ' + pat }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Asana said ' + r.getResponseCode() + ' for ' + path.split('?')[0]);
  return JSON.parse(r.getContentText());
}
function obAsanaAll_(pat, path) {
  var out = [], next = path, guard = 0;
  while (next && guard++ < 30) {
    var body = obAsanaGet_(pat, next);
    out = out.concat(body.data || []);
    next = body.next_page && body.next_page.offset ? path + '&offset=' + body.next_page.offset : null;
  }
  return out;
}
function obAsanaMany_(pat, paths) {
  var out = [];
  for (var i = 0; i < paths.length; i += 20) {
    var reqs = paths.slice(i, i + 20).map(function (p) {
      return { url: 'https://app.asana.com/api/1.0' + p, headers: { Authorization: 'Bearer ' + pat }, muteHttpExceptions: true };
    });
    var rs = UrlFetchApp.fetchAll(reqs);
    rs.forEach(function (r) {
      try { out.push(r.getResponseCode() === 200 ? (JSON.parse(r.getContentText()).data || []) : []); } catch (e) { out.push([]); }
    });
  }
  return out;
}
function obStageFromSection_(sec, completed) {
  var s = String(sec || '').toLowerCase();
  if (/not approved/.test(s)) return 'Not Approved';
  if (/support/.test(s)) return 'Ops Support';
  if (/complete/.test(s)) return 'Complete';
  if (/process|setup/.test(s)) return 'In Process';
  if (/new/.test(s)) return completed ? 'Complete' : 'New';
  return completed ? 'Complete' : 'New';
}

// Asana vendors that are not on the directory yet get a directory row, so the desk and
// every picker see one list. Status follows the Asana stage: set up = Waiting for
// Account, still in process = In Progress, Not Approved = Prospect. Source 'Asana import'.
// Rows are collected and written once per market tab at the end of the run.
function obDirectoryRowFor_(all, name, market, track, stage) {
  var v = {};
  v.vendor_id = vdNextId_(all);
  v.dba_name = name;
  v.status = stage === 'Not Approved' ? 'Prospect' : (stage === 'Complete' || stage === 'Ops Support') ? 'Waiting for Account' : 'In Progress';
  v.region = market === 'nnv' ? 'Northern Nevada' : 'Las Vegas';
  v.service_types = track === 'JS' ? VD_JANITORIAL : 'unclassified';
  v.source = 'Asana import';
  v.added_by = 'Asana import ' + obToday_();
  v.updated = obToday_();
  v.internal_notes = 'Added by the Asana onboarding import ' + obToday_() + ' (board stage: ' + stage + '). Contact details were not on the Asana task; fill them in.';
  v._pending = true;
  all.push(v);
  return v;
}

// {which:'onboarding'|'bc'|'all', dry:true|false, add_missing:true|false, who}
// Every write is batched: the Onboarding tab is read once into a matrix, edited in
// memory, and written back once; new rows, log lines, directory rows and requests are
// each appended with one setValues. The first run of 269 tasks writes in seconds.
function obImportAsana_(data) {
  var addMissing = data.add_missing === true || String(data.add_missing) === 'true' || String(data.add_missing) === '1';
  var pat = PropertiesService.getScriptProperties().getProperty('ASANA_PAT') || '';
  if (!pat) return vdOut_({ ok: false, error: 'The Asana token (ASANA_PAT) is not set on the script.' });
  var which = vdStr_(data.which) || 'all';
  var dry = data.dry === true || String(data.dry) === 'true' || String(data.dry) === '1';
  var who = vdStr_(data.who) || 'Admin Hub';
  var ss = vdSS_();
  var cfg = obChecklist_(ss);
  var all = vdAllRows_(ss).filter(function (r) { return r.dba_name; });
  var report = { ok: true, dry: dry, boards: [], bc: null, started: obNow_() };
  var logLines = [];
  function log(e) { logLines.push([obNow_(), e.ob_id || '', e.vendor || '', e.who || 'Asana import', e.action || '', e.item || '', e.from || '', e.to || '', String(e.note || '').slice(0, 2000)]); }

  if (which === 'all' || which === 'onboarding') {
    var obSh = obTab_(ss, OB_TAB, OB_HEADERS, '#D22730');
    var lastRow = Math.max(obSh.getLastRow(), 1), lastCol = obSh.getLastColumn();
    var vals = obSh.getRange(1, 1, lastRow, lastCol).getValues();
    var head = vals[0].map(vdStr_);
    var col = {}; head.forEach(function (h, i) { if (h) col[h] = i; });
    var dirty = false;
    var existing = [];
    for (var i = 1; i < vals.length; i++) {
      var o = { _i: i };
      head.forEach(function (h, c) { if (h) o[h] = vdStr_(vals[i][c]); });
      if (o.ob_id) existing.push(o);
    }
    var appends = [];   // objects, written at the end
    var byGid = {}, byVendorTrack = {};
    existing.forEach(function (r) { if (r.asana_gid) byGid[r.asana_gid] = r; if (r.vendor_id) byVendorTrack[r.vendor_id + '|' + r.track] = r; });
    function setField(r, f, v) {
      v = v == null ? '' : String(v);
      if (r[f] === v) return;
      r[f] = v;
      if (r._i !== undefined) { if (col[f] !== undefined) { vals[r._i][col[f]] = v; dirty = true; } }
    }
    var nameToKey = {};
    cfg.forEach(function (c) { String(c.asana || '').split('|').forEach(function (n) { n = n.trim().toLowerCase(); if (n) nameToKey[n] = c.key; }); });

    OB_ASANA.boards.forEach(function (b) {
      var br = { board: b.name, tasks: 0, created: 0, updated: 0, unmatched: [], skipped: 0, added_to_directory: 0 };
      var fields = 'name,completed,completed_at,created_at,assignee.name,memberships.section.name,custom_fields.name,custom_fields.display_value,notes,num_subtasks,permalink_url';
      var tasks;
      try { tasks = obAsanaAll_(pat, '/projects/' + b.gid + '/tasks?limit=100&opt_fields=' + encodeURIComponent(fields)); }
      catch (e) { br.error = String(e); report.boards.push(br); return; }
      br.tasks = tasks.length;
      var withSubs = tasks.filter(function (t) { return t.num_subtasks > 0; });
      var subs = obAsanaMany_(pat, withSubs.map(function (t) { return '/tasks/' + t.gid + '/subtasks?limit=100&opt_fields=name,completed,completed_at,assignee.name'; }));
      var subMap = {}; withSubs.forEach(function (t, i) { subMap[t.gid] = subs[i] || []; });
      var open = tasks.filter(function (t) { return !t.completed; });
      var stories = obAsanaMany_(pat, open.map(function (t) { return '/tasks/' + t.gid + '/stories?limit=50&opt_fields=type,text,created_at,created_by.name'; }));
      var storyMap = {}; open.forEach(function (t, i) { storyMap[t.gid] = (stories[i] || []).filter(function (s) { return s.type === 'comment'; }); });

      var rows = [];
      tasks.forEach(function (t) {
        var name = vdStr_(t.name).replace(/^​+/, '');
        if (!name) { br.skipped++; return; }
        var sec = (t.memberships || []).map(function (m) { return m.section && m.section.name; }).filter(Boolean)[0] || '';
        var cf = {}; (t.custom_fields || []).forEach(function (f) { if (f.display_value) cf[f.name] = f.display_value; });
        var st = subMap[t.gid] || [];
        var track = b.track;
        if (st.some(function (s) { return /^OS IC Agreement/i.test(s.name); })) track = 'OS';
        if (st.some(function (s) { return /^JS IC Agreement/i.test(s.name); })) track = 'JS';
        var docs = {}, unknownSubs = [];
        st.forEach(function (s) {
          var k = nameToKey[vdStr_(s.name).toLowerCase()];
          if (!k) { unknownSubs.push(s.name); return; }
          if (s.completed) docs[k] = { s: 'verified', d: (s.completed_at || '').slice(0, 10), by: 'Asana' + (s.assignee ? ' ' + s.assignee.name : ''), n: '', src: 'asana' };
        });
        var stage = obStageFromSection_(sec, t.completed);
        var noteLines = [];
        if (vdStr_(t.notes)) noteLines.push((t.created_at || '').slice(0, 10) + ' Asana: ' + vdStr_(t.notes).slice(0, 1500));
        (storyMap[t.gid] || []).forEach(function (s) { noteLines.push((s.created_at || '').slice(0, 10) + ' ' + (s.created_by ? s.created_by.name : 'Asana') + ': ' + vdStr_(s.text).slice(0, 800)); });
        if (unknownSubs.length) noteLines.push('Asana items not in the checklist: ' + unknownSubs.join('; '));
        rows.push({ t: t, name: name, sec: sec, cf: cf, track: track, docs: docs, stage: stage, m: obMatchVendor_(all, name, ''), notes: noteLines.join('\n') });
      });

      function rank(r) { var s = r.stage; return (r.t.num_subtasks > 0 ? 10 : 0) + (s === 'Complete' ? 5 : s === 'New' ? 1 : 4); }
      var createdRank = {};
      rows.forEach(function (r) {
        var t = r.t;
        if (!r.m.v && addMissing && !dry && !byGid[t.gid]) {
          r.m = obMatchVendor_(all, r.name, '');
          if (!r.m.v) { r.m = { v: obDirectoryRowFor_(all, r.name, b.market, r.track, r.stage), how: 'added', sure: true }; br.added_to_directory++; }
        }
        var hit = byGid[t.gid] || (r.m.v ? byVendorTrack[r.m.v.vendor_id + '|' + r.track] : null);
        if (!r.m.v) br.unmatched.push({ name: r.name, section: r.sec, gid: t.gid, url: t.permalink_url });
        if (dry) { if (hit) br.updated++; else br.created++; return; }
        if (hit && createdRank[hit.ob_id] !== undefined && rank(r) > createdRank[hit.ob_id]) {
          createdRank[hit.ob_id] = rank(r);
          setField(hit, 'stage', r.stage); setField(hit, 'asana_gid', t.gid); setField(hit, 'asana_section', r.sec);
          setField(hit, 'completed', t.completed ? (t.completed_at || '').slice(0, 10) : '');
          if (t.assignee) setField(hit, 'assignee', t.assignee.name);
          byGid[t.gid] = hit;
        }
        if (hit) {
          var cur = obDocs_(hit), changed = false;
          Object.keys(r.docs).forEach(function (k) { if (!cur[k]) { cur[k] = r.docs[k]; changed = true; } });
          if (changed) setField(hit, 'docs', JSON.stringify(cur));
          if (!hit.asana_gid) setField(hit, 'asana_gid', t.gid);
          setField(hit, 'asana_section', r.sec);
          setField(hit, 'asana_status', r.cf.Status || '');
          if (!hit.notes && r.notes) setField(hit, 'notes', r.notes);
          if (!hit.vendor_id && r.m.v) { setField(hit, 'vendor_id', r.m.v.vendor_id); setField(hit, 'vendor', r.m.v.dba_name); setField(hit, 'matched', 'TRUE'); byVendorTrack[r.m.v.vendor_id + '|' + hit.track] = hit; }
          if (changed) { setField(hit, 'updated', obNow_()); setField(hit, 'updated_by', 'Asana import'); }
          br.updated++;
          return;
        }
        var v = r.m.v;
        var obj = {
          ob_id: obId_('OB'), vendor_id: v ? v.vendor_id : '', vendor: v ? v.dba_name : r.name, market: b.market,
          track: r.track, stage: r.stage, priority: r.cf.Priority || '', assignee: t.assignee ? t.assignee.name : '',
          started: (t.created_at || '').slice(0, 10), completed: t.completed ? (t.completed_at || '').slice(0, 10) : '',
          asana_gid: t.gid, asana_section: r.sec, asana_status: r.cf.Status || '', notes: r.notes,
          docs: JSON.stringify(r.docs), updated: obNow_(), updated_by: 'Asana import', source: 'Asana ' + b.name,
          contact_name: v ? (v.contact_name || '') : '', email: v ? (v.email || '') : '', phone: v ? (v.phone || '') : '',
          matched: v ? 'TRUE' : 'FALSE'
        };
        appends.push(obj);
        byGid[t.gid] = obj; createdRank[obj.ob_id] = rank(r);
        if (v) byVendorTrack[v.vendor_id + '|' + r.track] = obj;
        log({ ob_id: obj.ob_id, vendor: obj.vendor, action: 'create', item: 'stage', to: obj.stage, note: obj.source + (v ? '' : ' (not matched to a directory vendor)') });
        br.created++;
      });
      report.boards.push(br);
    });

    if (!dry) {
      if (dirty) obSh.getRange(1, 1, vals.length, lastCol).setValues(vals);
      if (appends.length) {
        var out = appends.map(function (o) { return head.map(function (h) { return o[h] == null ? '' : String(o[h]); }); });
        obSh.getRange(lastRow + 1, 1, out.length, head.length).setValues(out);
      }
      // directory rows, one write per market tab
      var pend = all.filter(function (v) { return v._pending; });
      if (pend.length) {
        ['Las Vegas', 'Northern Nevada'].forEach(function (region) {
          var mine = pend.filter(function (v) { return v.region === region; });
          if (!mine.length) return;
          var sh = vdTabFor_(ss, region);
          var at = vdNextRow_(sh);
          var rowsOut = mine.map(function (v) { return VD_HEADERS.map(function (h) { return v[h] == null ? '' : String(v[h]); }); });
          sh.getRange(at, 1, rowsOut.length, VD_HEADERS.length).setValues(rowsOut);
          mine.forEach(function (v) { delete v._pending; });
        });
        report.directory_added = pend.length;
      }
    }
  }

  if (which === 'all' || which === 'bc') {
    var bcr = { tasks: 0, created: 0, updated: 0, people_added: 0, people_updated: 0, dupes: 0, unmatched: [] };
    var fields2 = 'name,completed,completed_at,created_at,assignee.name,memberships.section.name,custom_fields.name,custom_fields.display_value,notes,permalink_url';
    var tasks2;
    try { tasks2 = obAsanaAll_(pat, '/projects/' + OB_ASANA.bc + '/tasks?limit=100&opt_fields=' + encodeURIComponent(fields2)); }
    catch (e2) { bcr.error = String(e2); report.bc = bcr; return vdOut_(report); }
    bcr.tasks = tasks2.length;
    var reqSh = obTab_(ss, OB_REQ_TAB, OB_REQ_HEADERS, '#2F6FD6');
    var rLast = Math.max(reqSh.getLastRow(), 1), rCols = reqSh.getLastColumn();
    var rVals = reqSh.getRange(1, 1, rLast, rCols).getValues();
    var rHead = rVals[0].map(vdStr_);
    var rCol = {}; rHead.forEach(function (h, i) { if (h) rCol[h] = i; });
    var rDirty = false;
    var exRows = [];
    for (var ri = 1; ri < rVals.length; ri++) { var ro = { _i: ri }; rHead.forEach(function (h, c) { if (h) ro[h] = vdStr_(rVals[ri][c]); }); if (ro.req_id) exRows.push(ro); }
    var byGid2 = {}; exRows.forEach(function (r) { if (r.asana_gid) byGid2[r.asana_gid] = r; });
    var seen = {};
    exRows.forEach(function (r) { var k = obNorm_(r.company) + '|' + obNorm_(r.legal_name) + '|' + r.request_type; if (!seen[k]) seen[k] = r.req_id; });
    tasks2.sort(function (a, b) { return (a.created_at || '') < (b.created_at || '') ? -1 : 1; });
    var reqAppends = [], bcRows = [];
    tasks2.forEach(function (t) {
      var f = obParseBcNotes_(t.notes || '');
      var cf = {}; (t.custom_fields || []).forEach(function (x) { if (x.display_value) cf[x.name] = x.display_value; });
      var company = vdStr_(f.company || t.name);
      var legal = vdStr_(cf['Full Name'] || f.legal_name);
      var parts = legal.split(/\s+/).filter(Boolean);
      var first = parts[0] || '', last = parts.length > 1 ? parts[parts.length - 1] : '';
      var rtRaw = vdStr_(cf['Request Type'] || f.request_type).toLowerCase();
      var rtype = /already ran/.test(rtRaw) ? OB_REQ_TYPES[1] : /1st one|never received/.test(rtRaw) ? OB_REQ_TYPES[2] : /replac|lost/.test(rtRaw) ? OB_REQ_TYPES[3] : OB_REQ_TYPES[0];
      var mk = obMarketKey_(f.region) || 'lv';
      var sec = (t.memberships || []).map(function (m) { return m.section && m.section.name; }).filter(Boolean)[0] || '';
      var aStatus = vdStr_(cf['Background Check Status']);
      var status = rtype !== OB_REQ_TYPES[0] ? 'Badge only'
        : /passed|clear(ed)?$/i.test(aStatus) ? 'Cleared' : /failed|not clear/i.test(aStatus) ? 'Not cleared'
        : t.completed ? 'Closed' : (/sent|progress/i.test(sec) || /sent|progress/i.test(aStatus)) ? 'Sent' : 'New';
      var m = obMatchVendor_(all, company, '');
      var k = obNorm_(company) + '|' + obNorm_(legal) + '|' + rtype;
      var hit = byGid2[t.gid];
      var dupe = seen[k] && !hit ? seen[k] : '';
      if (!m.v && !hit) bcr.unmatched.push({ company: company, name: legal, gid: t.gid });
      if (dry) { if (hit) bcr.updated++; else bcr.created++; if (dupe) bcr.dupes++; return; }
      if (hit) {
        if (!hit.vendor_id && m.v) { rVals[hit._i][rCol.vendor_id] = m.v.vendor_id; rDirty = true; }
        var done = t.completed ? (t.completed_at || '').slice(0, 10) : '';
        if (hit.asana_done !== done) { rVals[hit._i][rCol.asana_done] = done; rDirty = true; }
        bcr.updated++; return;
      }
      var rid = obId_('BC');
      var req = {
        req_id: rid, received: (t.created_at || '').replace('T', ' ').slice(0, 16), market: mk, company: company,
        vendor_id: m.v ? m.v.vendor_id : '', request_type: rtype, legal_name: legal, first_name: first, last_name: last,
        preferred_name: vdStr_(f.preferred), email: vdStr_(cf.Email || f.email), mobile: vdStr_(cf['Mobile Number'] || f.mobile),
        notify: vdStr_(cf['IC Notification on Result'] || f.notify), client_account: vdStr_(f.client_account),
        submitted_by: '', submitter_email: '', source: 'Asana', asana_gid: t.gid,
        asana_done: t.completed ? (t.completed_at || '').slice(0, 10) : '', status: status, sent: /sent/i.test(sec) ? (t.created_at || '').slice(0, 10) : '',
        badge: t.completed ? 'Delivered' : 'Needed', notes: (sec ? 'Asana section: ' + sec + '. ' : '') + (aStatus ? 'Asana status: ' + aStatus + '. ' : '') + (dupe ? 'Repeat of ' + dupe + '. ' : ''),
        updated: obNow_(), updated_by: 'Asana import', dupe_of: dupe
      };
      reqAppends.push(req);
      byGid2[t.gid] = req; if (!seen[k]) seen[k] = rid; if (dupe) bcr.dupes++;
      bcr.created++;
      if (rtype === OB_REQ_TYPES[0] && first && !dupe) {
        var result = status === 'Cleared' ? 'Clear' : status === 'Not cleared' ? 'Not clear' : '';
        var reqDay = (t.created_at || '').slice(0, 10) || obToday_();
        var prow = { market: mk, vendor_id: m.v ? m.v.vendor_id : '', vendor: m.v ? m.v.dba_name : company,
          roster_company_as_typed: m.v ? '' : company, first_name: first, last_name: last, check_type: 'Standard', source: 'City Wide',
          first_check: reqDay, most_recent_check: reqDay,
          notes: 'Asana request ' + reqDay + (t.completed ? ', closed in Asana ' + (t.completed_at || '').slice(0, 10) + ' with no result recorded. Confirm in Verified First.' : ', open in Asana.') };
        if (result) prow.result = result; else prow.status = 'Pending';
        bcRows.push(prow);
      }
    });
    if (!dry) {
      if (rDirty) reqSh.getRange(1, 1, rVals.length, rCols).setValues(rVals);
      if (reqAppends.length) {
        var rout = reqAppends.map(function (o) { return rHead.map(function (h) { return o[h] == null ? '' : String(o[h]); }); });
        reqSh.getRange(rLast + 1, 1, rout.length, rHead.length).setValues(rout);
      }
      if (bcRows.length) {
        var have = {};
        VD_BC_TABS.forEach(function (b) { var sh = ss.getSheetByName(b.name); if (!sh) return; vdRows_(sh).rows.forEach(function (r) {
          have[b.key + '|' + (vdStr_(r.vendor_id) || obNorm_(r.vendor)) + '|' + vdStr_(r.last_name).toLowerCase() + '|' + vdStr_(r.first_name).toLowerCase()] = 1;
          have[b.key + '|' + obNorm_(r.vendor) + '|' + vdStr_(r.last_name).toLowerCase() + '|' + vdStr_(r.first_name).toLowerCase()] = 1; }); });
        var fresh = bcRows.filter(function (p) {
          return !have[p.market + '|' + (p.vendor_id || obNorm_(p.vendor)) + '|' + p.last_name.toLowerCase() + '|' + p.first_name.toLowerCase()] &&
                 !have[p.market + '|' + obNorm_(p.vendor) + '|' + p.last_name.toLowerCase() + '|' + p.first_name.toLowerCase()];
        });
        bcr.people_skipped_existing = bcRows.length - fresh.length;
        if (fresh.length) {
          try { var up = JSON.parse(vdBcUpsert_({ rows: fresh, reviewed_by: 'Asana import' }).getContent()); bcr.people_added = up.added; bcr.people_updated = up.updated; bcr.people_errors = up.errors; }
          catch (ue) { bcr.people_error = String(ue); }
        }
      }
    }
    report.bc = bcr;
  }
  report.finished = obNow_();
  if (!dry) {
    log({ who: who, action: 'asana import', note: JSON.stringify(report).slice(0, 1900) });
    try {
      var lsh = obTab_(ss, OB_LOG_TAB, OB_LOG_HEADERS, '#636466');
      lsh.getRange(Math.max(lsh.getLastRow(), 1) + 1, 1, logLines.length, OB_LOG_HEADERS.length).setValues(logLines);
    } catch (le) { report.log_error = String(le); }
  }
  return vdOut_(report);
}

// The Asana form wrote its answers into the task description as "Label:\nvalue" pairs.
function obParseBcNotes_(notes) {
  var out = {};
  var map = [
    ['company', /Your Company Name:\s*\n([^\n]*)/i], ['request_type', /What type of request is this\?:\s*\n([^\n]*)/i],
    ['email', /Employee.s Email Address:\s*\n([^\n]*)/i], ['mobile', /Employee.s Mobile Number:\s*\n([^\n]*)/i],
    ['notify', /Notification Preferences[^:]*:\s*\n([^\n]*)/i], ['legal_name', /Full Legal Name[^:]*:\s*\n([^\n]*)/i],
    ['preferred', /Preferred Name[^:]*:\s*\n([^\n]*)/i], ['region', /service region[^:]*:\s*\n([^\n]*)/i],
    ['client_account', /name of the client account[^:]*:\s*\n([^\n]*)/i]
  ];
  map.forEach(function (m) { var r = m[1].exec(notes); if (r) out[m[0]] = r[1].trim(); });
  return out;
}

// Run from the editor (Runner.gs cwRunNow pattern) when a dry run is wanted from the log.
function obImportDryRun() {
  var r = obImportAsana_({ which: 'all', dry: true, who: 'editor' });
  Logger.log(r.getContent().slice(0, 4000));
}
