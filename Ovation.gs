/**
 * CW Ovation Hub - backend for citywidelv.github.io/ovation-hub/ (Oct 22 2026).
 *
 * The Ovation Hub is a client-facing hub for Ovation Property Management staff and the
 * day porters working their properties. It has its OWN passcode (script property
 * OV_PASSCODE), checked here on every call. Ovation staff and porters never see the team
 * passcode. The FSM review queue (review.html) is team-passcode only.
 *
 * Routed from doPost: kinds starting ov_ come here.
 *   Client kinds (Ovation passcode OR team passcode):
 *     ov_auth          -> passcode check for the hub gate
 *     ov_submit        -> save one report (observation / work request) or one porter checklist
 *     ov_photo_put     -> store one photo (JPEG, base64) for a submission
 *   Team kinds (team passcode only):
 *     ov_list          -> index rows for the review queue (type: report | checklist)
 *     ov_get           -> one submission, full JSON, plus its photo file ids
 *     ov_photo_get     -> one photo back as base64
 *     ov_update        -> FSM edits (doc, status, fsm_notes)
 *     ov_pdf_put       -> store the FSM-built PDF in the folder
 *     ov_send          -> email the PDF to the property, mark Sent
 *     ov_properties    -> Properties tab (contacts per property)
 *     ov_property_set  -> upsert one property's contact / fsm
 *     ov_config        -> read the Config tab
 *
 * Storage is self-provisioning (Inventory.gs / BuildingSurveys.gs pattern). First use
 * creates the "CW Ovation Hub" spreadsheet and the "CW Ovation Hub" Drive folder, stores
 * the ids in script properties OVATION_SHEET_ID / OVATION_FOLDER_ID and adds TJ as editor.
 * The sheet is an index only. Each submission is one JSON file; photos and PDFs are files.
 *
 * Emails: a porter checklist never sends mail. A report or request emails the address in
 * Config!report_notify (seeded to tjroberts@gocitywide.com) through cwMail_ so the
 * SendConfig tag "ovation" can skip it. The FSM-initiated ov_send goes out with the PDF
 * attached (cwMail_ tag "ovation_send"), display name City Wide Facility Solutions.
 */
var OV_SHEET_PROP = 'OVATION_SHEET_ID';
var OV_FOLDER_PROP = 'OVATION_FOLDER_ID';
var OV_PASS_PROP = 'OV_PASSCODE';
var OV_EDITOR = 'tjroberts@gocitywide.com';
var OV_TAB_REPORTS = 'Reports';
var OV_TAB_CHECKS = 'Checklists';
var OV_TAB_PROPS = 'Properties';
var OV_TAB_CONFIG = 'Config';

var OV_REPORT_HEADERS = ['id', 'created_at', 'property', 'submitter', 'role', 'phone', 'email', 'mode', 'category',
  'subcategory', 'urgency', 'summary', 'status', 'fsm_notes', 'sent_at', 'sent_to', 'photos', 'json_file', 'pdf_file', 'updated_at'];
var OV_CHECK_HEADERS = ['id', 'created_at', 'service_date', 'weekday', 'property', 'porter', 'shift_start', 'shift_end',
  'areas_done', 'areas_na', 'tasks_checked', 'tasks_total', 'photos', 'followups', 'supplies', 'status', 'fsm_notes',
  'sent_at', 'sent_to', 'json_file', 'pdf_file', 'updated_at'];
var OV_PROP_HEADERS = ['property', 'group', 'type', 'address', 'awarded', 'start', 'porter_days', 'contact_name', 'contact_email', 'cc_email', 'fsm', 'fsm_email', 'notes'];
var OV_CONFIG_HEADERS = ['key', 'value', 'what it does'];

// Seed list. The page carries the same list baked in (ov-shared.js) so it paints with no
// fetch; this tab exists so contacts and the FSM per property can be kept without a deploy.
var OV_PROPERTIES_SEED = [
  // property, group, type, address, awarded, start, porter_days
  ['Aspire at Echelon', 'Mid-Rise', 'Mid-rise (Aspire premier)', '8850 Echelon Point Dr, Las Vegas, NV 89149', '', '', ''],
  ['Aspire at Flamingo Grand', 'Mid-Rise', 'Mid-rise (Aspire premier)', '4335 S Grand Canyon Dr, Las Vegas, NV 89147', 'Y', '2027-01-01', 7],
  ['Aspire at Redwood', 'Mid-Rise', 'Mid-rise (Aspire premier)', '6755 W Arby Ave, Las Vegas, NV 89118', 'Y', '2026-11-01', 7],
  ['Altessa', 'Mid-Rise', 'Mid-rise (Summerlin)', '100 Park Vista Dr, Las Vegas, NV 89138', 'Y', '2027-01-01', 5],
  ['Arzano', 'Mid-Rise', 'Mid-rise', '6275 Boulder Hwy, Las Vegas, NV 89122', '', '', ''],
  ['Arzano II', 'Mid-Rise', 'Mid-rise (new build)', '6275 Boulder Hwy, Las Vegas, NV 89122', '', '', ''],
  ['Elevate', 'Mid-Rise', 'Mid-rise', '111 S Gibson Rd, Henderson, NV 89012', '', '', ''],
  ['Inspire', 'Mid-Rise', 'Mid-rise', '2656 N Buffalo Dr, Las Vegas, NV 89128', '', '', ''],
  ['Radiance at Grand Canyon', 'Mid-Rise', 'Mid-rise', '9860 W Tropicana Ave, Las Vegas, NV 89147', '', '', ''],
  ['Radiance at Rock Springs', 'Mid-Rise', 'Mid-rise', '1501 Rock Springs Dr, Las Vegas, NV 89128', 'Y', '2027-01-01', 5],
  ['Adiamo', 'Garden-Style', 'Garden / mid-rise hybrid', '1350 W Horizon Ridge Pkwy, Henderson, NV 89012', 'Y', '2027-01-01', 5],
  ['Aspire at Alper', 'Garden-Style', 'Garden', '1130 Alper Center Dr, Henderson, NV 89052', 'Y', '2027-01-01', 5],
  ['Aspire at Grand Canyon', 'Garden-Style', 'Garden', '9950 W Tropicana Ave, Las Vegas, NV 89147', '', '', ''],
  ['Aspire at Paseo & Imagine', 'Garden-Style', 'Garden', '1480 Paseo Verde Pkwy, Henderson, NV 89012', 'Y', '2027-01-01', 7],
  ['Aspire at Sunridge Heights', 'Garden-Style', 'Garden', '3161 Sunridge Heights Pkwy, Henderson, NV 89052', 'Y', '2027-01-01', 5],
  ['Aspire at Tropicana', 'Garden-Style', 'Garden', '9110 W Tropicana Ave, Las Vegas, NV 89147', '', '', ''],
  ['Chateau Calais', 'Garden-Style', 'Garden', '975 Seven Hills Dr, Henderson, NV 89052', '', '', ''],
  ['Diamond Vista', 'Garden-Style', 'Townhome', '3779 Autzen Stadium Way, Las Vegas, NV 89115', '', '', ''],
  ['The Grove', 'Garden-Style', 'Garden', '2901 N Rainbow Blvd, Las Vegas, NV 89108', '', '', ''],
  ['Madera', 'Garden-Style', 'Garden (Summerlin)', '2600 S Town Center Dr, Las Vegas, NV 89135', '', '', ''],
  ['Positano', 'Garden-Style', 'Garden', '10115 Jeffreys St, Las Vegas, NV 89183', 'Y', '2027-01-01', 5],
  ['San Croix', 'Garden-Style', 'Garden', '8000 W Spring Mountain Rd, Las Vegas, NV 89117', '', '', ''],
  ['Summer Winds', 'Garden-Style', 'Garden', '2725 W Wigwam Ave, Las Vegas, NV 89123', '', '', ''],
  ['Tesora I & II', 'Garden-Style', 'Garden (two phases)', '9465 W Post Rd, Las Vegas, NV 89148', 'Y', '2027-01-01', 5],
  ['Tivoli', 'Garden-Style', 'Garden', '4650 N Rainbow Blvd, Las Vegas, NV 89108', 'Y', '2027-01-01', 5],
  ['Tuscany', 'Garden-Style', 'Garden', '725 S Hualapai Way, Las Vegas, NV 89145', '', '', ''],
  ['Venicia', 'Garden-Style', 'Garden', '3644 S Fort Apache Rd, Las Vegas, NV 89147', 'Y', '2027-01-01', 5],
  ['Viviani', 'Garden-Style', 'Garden', '9625 W Russell Rd, Las Vegas, NV 89148', '', '', ''],
  ['Acapella', 'Heirloom (55+)', '55+ Affordable', '5025 E Mohave Ave, Las Vegas, NV 89104', '', '', ''],
  ['Arioso', 'Heirloom (55+)', '55+ Affordable', '9270 S Quarterhorse Ln, Las Vegas, NV 89178', '', '', ''],
  ['Capriccio', 'Heirloom (55+)', '55+ Affordable', '9420 W Wigwam Ave, Las Vegas, NV 89178', '', '', ''],
  ['Crescendo', 'Heirloom (55+)', '55+ Affordable', '9550 W Russell Rd, Las Vegas, NV 89148', '', '', ''],
  ['Ensemble', 'Heirloom (55+)', '55+ Affordable', '2675 W Agate Ave, Las Vegas, NV 89123', '', '', ''],
  ['Harmony', 'Heirloom (55+)', '55+ Affordable', '4200 N Tenaya Way, Las Vegas, NV 89129', '', '', ''],
  ['Heirloom at Pebble', 'Heirloom (55+)', '55+ Affordable', '2325 E Torino Ave, Las Vegas, NV 89123', '', '', ''],
  ['Heirloom at Rome', 'Heirloom (55+)', '55+ Affordable', '4850 W Rome Blvd, Las Vegas, NV 89131', '', '', ''],
  ['Heirloom at Torrey Pines', 'Heirloom (55+)', '55+ Affordable', '6540 W Arby Ave, Las Vegas, NV 89118', '', '', ''],
  ['Melody', 'Heirloom (55+)', '55+ Affordable', '8680 W Oquendo Rd, Las Vegas, NV 89148', '', '', ''],
  ['Minuet', 'Heirloom (55+)', '55+ Affordable', '4652 N Rainbow Blvd, Las Vegas, NV 89108', '', '', ''],
  ['Tempo', 'Heirloom (55+)', '55+ Affordable', '5625 S Hollywood Blvd, Las Vegas, NV 89122', '', '', '']
];
var OV_CONFIG_SEED = [
  ['report_notify', 'tjroberts@gocitywide.com', 'Who is emailed when an Ovation report or work request comes in. Comma separated. Blank = nobody.'],
  ['sender_name', 'City Wide Facility Solutions', 'Display name on emails sent from the review queue.'],
  ['reply_to', 'lvservicecall@gocitywide.com', 'Reply-to on emails sent to the property when the FSM has no email on the Properties tab.'],
  ['cc_always', '', 'Always CC these addresses on PDFs sent to the property. Comma separated.']
];

function ovTeamPass_() {
  try { if (typeof PASSCODE !== 'undefined') return PASSCODE; } catch (e) {}
  return PropertiesService.getScriptProperties().getProperty('PASSCODE') || '';
}
function ovClientPass_() {
  return String(PropertiesService.getScriptProperties().getProperty(OV_PASS_PROP) || '');
}
function ovOut_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function ovIsTeam_(d) { var t = ovTeamPass_(); return !!t && String(d.passcode || '') === t; }
function ovIsClient_(d) {
  var c = ovClientPass_();
  if (!c) return false;
  return String(d.passcode || '') === c || ovIsTeam_(d);
}

function ovDispatch(d) {
  var kind = String(d.kind || '');
  try {
    if (kind === 'ov_auth') {
      if (!ovClientPass_()) return ovOut_({ ok: false, error: 'The Ovation Hub passcode has not been set yet. Ask City Wide.' });
      return ovIsClient_(d) ? ovOut_({ ok: true, hub: 'ovation', team: ovIsTeam_(d) }) : ovOut_({ ok: false, error: 'Wrong passcode' });
    }
    var client = ['ov_submit', 'ov_photo_put'];
    if (client.indexOf(kind) >= 0) {
      if (!ovIsClient_(d)) return ovOut_({ ok: false, error: 'Bad passcode' });
    } else {
      if (!ovIsTeam_(d)) return ovOut_({ ok: false, error: 'Bad passcode' });
    }
    if (kind === 'ov_submit') return ovSubmit_(d);
    if (kind === 'ov_photo_put') return ovPhotoPut_(d);
    if (kind === 'ov_list') return ovList_(d);
    if (kind === 'ov_get') return ovGet_(d);
    if (kind === 'ov_photo_get') return ovPhotoGet_(d);
    if (kind === 'ov_update') return ovUpdate_(d);
    if (kind === 'ov_pdf_put') return ovPdfPut_(d);
    if (kind === 'ov_send') return ovSend_(d);
    if (kind === 'ov_properties') return ovProperties_(d);
    if (kind === 'ov_property_set') return ovPropertySet_(d);
    if (kind === 'ov_config') return ovOut_({ ok: true, config: ovConfig_() });
    return ovOut_({ ok: false, error: 'Unknown ov kind' });
  } catch (err) {
    return ovOut_({ ok: false, error: String(err && err.message || err) });
  }
}

// ---------------------------------------------------------------- storage --
function ovSS_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(OV_SHEET_PROP) || '';
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('CW Ovation Hub');
    props.setProperty(OV_SHEET_PROP, ss.getId());
    try { DriveApp.getFileById(ss.getId()).addEditor(OV_EDITOR); } catch (e) {}
    try { DriveApp.getFileById(ss.getId()).moveTo(ovFolder_()); } catch (e2) {}
  }
  return ss;
}
function ovTab_(name, headers, seed) {
  var ss = ovSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    var first = ss.getSheets()[0];
    if (first && first.getName() === 'Sheet1' && first.getLastRow() === 0) { sh = first; sh.setName(name); }
    else sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#D22730').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    if (seed && seed.length) {
      var rows = seed.map(function (r) { var o = r.slice(); while (o.length < headers.length) o.push(''); return o; });
      sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
  }
  return sh;
}
function ovReports_() { return ovTab_(OV_TAB_REPORTS, OV_REPORT_HEADERS); }
function ovChecks_() { return ovTab_(OV_TAB_CHECKS, OV_CHECK_HEADERS); }
function ovProps_() { return ovTab_(OV_TAB_PROPS, OV_PROP_HEADERS, OV_PROPERTIES_SEED); }
function ovConfigTab_() { return ovTab_(OV_TAB_CONFIG, OV_CONFIG_HEADERS, OV_CONFIG_SEED); }

function ovFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(OV_FOLDER_PROP) || '';
  var folder = null;
  if (id) { try { folder = DriveApp.getFolderById(id); } catch (e) { folder = null; } }
  if (!folder) {
    folder = DriveApp.createFolder('CW Ovation Hub');
    props.setProperty(OV_FOLDER_PROP, folder.getId());
    try { folder.addEditor(OV_EDITOR); } catch (e) {}
  }
  return folder;
}
// One subfolder per submission type keeps 20 photos a day from piling into one list.
function ovSub_(name) {
  var root = ovFolder_();
  var it = root.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return root.createFolder(name);
}
function ovTypeOf_(id) { return /^ovr_/.test(id) ? 'report' : (/^ovc_/.test(id) ? 'checklist' : ''); }
function ovSheetFor_(type) { return type === 'report' ? ovReports_() : ovChecks_(); }
function ovHeadersFor_(type) { return type === 'report' ? OV_REPORT_HEADERS : OV_CHECK_HEADERS; }
function ovFolderFor_(type) { return ovSub_(type === 'report' ? 'Reports and Requests' : 'Porter Checklists'); }

function ovRows_(sh, headers) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var v = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var rows = [];
  for (var i = 0; i < v.length; i++) {
    if (!v[i][0]) continue;
    var o = { _row: i + 2 };
    for (var c = 0; c < headers.length; c++) {
      var val = v[i][c];
      if (val instanceof Date) val = val.toISOString();
      o[headers[c]] = val;
    }
    rows.push(o);
  }
  return rows;
}
function ovFindRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}
function ovConfig_() {
  var sh = ovConfigTab_();
  var out = {};
  var last = sh.getLastRow();
  if (last < 2) return out;
  var v = sh.getRange(2, 1, last - 1, 2).getValues();
  v.forEach(function (r) { if (r[0]) out[String(r[0]).trim()] = String(r[1] === null || r[1] === undefined ? '' : r[1]).trim(); });
  return out;
}
function ovStr_(v, n) { return String(v === undefined || v === null ? '' : v).slice(0, n || 500); }
function ovNow_() { return new Date().toISOString(); }

// --------------------------------------------------------------- metadata --
function ovReportMeta_(doc) {
  return {
    id: ovStr_(doc.id, 60),
    created_at: ovStr_(doc.created_at || ovNow_(), 40),
    property: ovStr_(doc.property, 120),
    submitter: ovStr_(doc.submitter, 120),
    role: ovStr_(doc.role, 80),
    phone: ovStr_(doc.phone, 40),
    email: ovStr_(doc.email, 120),
    mode: ovStr_(doc.mode, 40),
    category: ovStr_(doc.category, 80),
    subcategory: ovStr_(doc.subcategory, 120),
    urgency: ovStr_(doc.urgency, 40),
    summary: ovStr_(doc.summary, 400),
    status: ovStr_(doc.status || 'New', 30),
    fsm_notes: ovStr_(doc.fsm_notes, 2000),
    sent_at: ovStr_(doc.sent_at, 40),
    sent_to: ovStr_(doc.sent_to, 300),
    photos: (doc.photos || []).length,
    updated_at: ovNow_()
  };
}
function ovCheckMeta_(doc) {
  var areas = doc.areas || [];
  var done = 0, na = 0, checked = 0, total = 0, photos = 0;
  areas.forEach(function (a) {
    if (a.na) { na++; return; }
    done++;
    (a.tasks || []).forEach(function (t) { total++; if (t.done) checked++; });
    photos += (a.photos || []).length;
  });
  photos += (doc.photos || []).length;
  return {
    id: ovStr_(doc.id, 60),
    created_at: ovStr_(doc.created_at || ovNow_(), 40),
    service_date: ovStr_(doc.service_date, 20),
    weekday: ovStr_(doc.weekday, 12),
    property: ovStr_(doc.property, 120),
    porter: ovStr_(doc.porter, 120),
    shift_start: ovStr_(doc.shift_start, 12),
    shift_end: ovStr_(doc.shift_end, 12),
    areas_done: done, areas_na: na, tasks_checked: checked, tasks_total: total, photos: photos,
    followups: ovStr_(doc.followups, 400),
    supplies: ovStr_(doc.supplies, 400),
    status: ovStr_(doc.status || 'New', 30),
    fsm_notes: ovStr_(doc.fsm_notes, 2000),
    sent_at: ovStr_(doc.sent_at, 40),
    sent_to: ovStr_(doc.sent_to, 300),
    updated_at: ovNow_()
  };
}
function ovStripBytes_(doc) {
  // Photo bytes never ride in the JSON. Pages upload them with ov_photo_put.
  (doc.photos || []).forEach(function (p) { delete p.data; delete p.preview; });
  (doc.areas || []).forEach(function (a) { (a.photos || []).forEach(function (p) { delete p.data; delete p.preview; }); });
  return doc;
}

function ovUpsert_(type, doc, keepStatus) {
  var meta = type === 'report' ? ovReportMeta_(doc) : ovCheckMeta_(doc);
  var headers = ovHeadersFor_(type);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = ovSheetFor_(type);
    var folder = ovFolderFor_(type);
    var r = ovFindRow_(sh, meta.id);
    var fileId = r ? String(sh.getRange(r, headers.indexOf('json_file') + 1).getValue() || '') : '';
    var pdfId = r ? String(sh.getRange(r, headers.indexOf('pdf_file') + 1).getValue() || '') : '';
    if (r && keepStatus) {
      meta.status = String(sh.getRange(r, headers.indexOf('status') + 1).getValue() || meta.status);
      meta.sent_at = String(sh.getRange(r, headers.indexOf('sent_at') + 1).getValue() || '');
      meta.sent_to = String(sh.getRange(r, headers.indexOf('sent_to') + 1).getValue() || '');
    }
    var json = JSON.stringify(doc);
    var file = null;
    if (fileId) { try { file = DriveApp.getFileById(fileId); } catch (e) { file = null; } }
    if (file) file.setContent(json);
    else { file = folder.createFile(meta.id + '.json', json, 'application/json'); fileId = file.getId(); }
    var row = headers.map(function (h) {
      if (h === 'json_file') return fileId;
      if (h === 'pdf_file') return pdfId;
      return meta[h] !== undefined ? meta[h] : '';
    });
    if (!r) r = sh.getLastRow() + 1;
    sh.getRange(r, 1, 1, row.length).setValues([row]);
  } finally {
    lock.releaseLock();
  }
  return meta;
}

// ------------------------------------------------------------------ kinds --
function ovSubmit_(d) {
  var doc = d.doc;
  if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch (e) { doc = null; } }
  if (!doc || !doc.id) return ovOut_({ ok: false, error: 'Missing submission' });
  var type = ovTypeOf_(String(doc.id));
  if (!type || !/^ov[rc]_[\w-]{1,40}$/.test(String(doc.id))) return ovOut_({ ok: false, error: 'Bad id' });
  if (!doc.property) return ovOut_({ ok: false, error: 'Pick the property' });
  ovStripBytes_(doc);
  doc.created_at = doc.created_at || ovNow_();
  doc.status = doc.status || 'New';
  var meta = ovUpsert_(type, doc, true);
  var notified = '';
  if (type === 'report' && !d.resubmit) {
    try { notified = ovNotifyReport_(doc); } catch (e) { notified = ''; }
  }
  return ovOut_({ ok: true, id: meta.id, type: type, notified: notified });
}

function ovPhotoPut_(d) {
  var id = String(d.id || ''), pid = String(d.pid || '');
  var type = ovTypeOf_(id);
  if (!type || !/^ov[rc]_[\w-]{1,40}$/.test(id) || !/^ph_[\w-]{1,40}$/.test(pid)) return ovOut_({ ok: false, error: 'Bad ids' });
  var data = String(d.data || '');
  var m = data.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
  if (!m) return ovOut_({ ok: false, error: 'Photo must be a base64 JPEG' });
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 2500000) return ovOut_({ ok: false, error: 'Photo too large' });
  var name = id + '_' + pid + '.jpg';
  var folder = ovFolderFor_(type);
  var existing = folder.getFilesByName(name);
  while (existing.hasNext()) { existing.next().setTrashed(true); }
  var file = folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', name));
  return ovOut_({ ok: true, pid: pid, fileId: file.getId() });
}

function ovList_(d) {
  var type = String(d.type || 'checklist') === 'report' ? 'report' : 'checklist';
  var sh = ovSheetFor_(type);
  var rows = ovRows_(sh, ovHeadersFor_(type));
  var status = String(d.status || '');
  var property = String(d.property || '');
  rows = rows.filter(function (r) {
    if (status && String(r.status) !== status) return false;
    if (property && String(r.property) !== property) return false;
    return true;
  });
  rows.forEach(function (r) { delete r._row; delete r.json_file; r.has_pdf = !!r.pdf_file; delete r.pdf_file; });
  rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var limit = Number(d.limit) || 300;
  if (rows.length > limit) rows = rows.slice(0, limit);
  return ovOut_({ ok: true, type: type, rows: rows, url: sh.getParent().getUrl() });
}

function ovGet_(d) {
  var id = String(d.id || '');
  var type = ovTypeOf_(id);
  if (!type) return ovOut_({ ok: false, error: 'Bad id' });
  var sh = ovSheetFor_(type), headers = ovHeadersFor_(type);
  var r = ovFindRow_(sh, id);
  if (!r) return ovOut_({ ok: false, error: 'Not found' });
  var rowVals = sh.getRange(r, 1, 1, headers.length).getValues()[0];
  var index = {};
  headers.forEach(function (h, i) { var v = rowVals[i]; index[h] = v instanceof Date ? v.toISOString() : v; });
  var fileId = String(index.json_file || '');
  if (!fileId) return ovOut_({ ok: false, error: 'No saved data' });
  var doc = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
  // Photo files, by pid, so the page can fetch only what it shows.
  var files = {};
  try {
    var it = ovFolderFor_(type).searchFiles("title contains '" + id + "_ph_' and trashed = false");
    while (it.hasNext()) {
      var f = it.next();
      var mm = f.getName().match(/_(ph_[\w-]+)\.jpg$/);
      if (mm) files[mm[1]] = f.getId();
    }
  } catch (e) {}
  delete index.json_file;
  var pdfUrl = '';
  if (index.pdf_file) { try { pdfUrl = DriveApp.getFileById(String(index.pdf_file)).getUrl(); } catch (e2) { pdfUrl = ''; } }
  return ovOut_({ ok: true, type: type, doc: doc, index: index, photo_files: files, pdf_url: pdfUrl });
}

function ovPhotoGet_(d) {
  var fileId = String(d.fileId || '');
  if (!fileId) return ovOut_({ ok: false, error: 'Missing fileId' });
  var file = DriveApp.getFileById(fileId);
  if (!file || file.isTrashed()) return ovOut_({ ok: false, error: 'Photo not found' });
  return ovOut_({ ok: true, fileId: fileId, data: 'data:image/jpeg;base64,' + Utilities.base64Encode(file.getBlob().getBytes()) });
}

function ovUpdate_(d) {
  var doc = d.doc;
  if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch (e) { doc = null; } }
  var id = String((doc && doc.id) || d.id || '');
  var type = ovTypeOf_(id);
  if (!type) return ovOut_({ ok: false, error: 'Bad id' });
  var sh = ovSheetFor_(type), headers = ovHeadersFor_(type);
  var r = ovFindRow_(sh, id);
  if (!r) return ovOut_({ ok: false, error: 'Not found' });
  if (!doc) {
    // Status / notes only
    var fileId = String(sh.getRange(r, headers.indexOf('json_file') + 1).getValue() || '');
    doc = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
  }
  ovStripBytes_(doc);
  if (d.status) doc.status = ovStr_(d.status, 30);
  if (d.fsm_notes !== undefined) doc.fsm_notes = ovStr_(d.fsm_notes, 2000);
  if (d.reviewed_by) doc.reviewed_by = ovStr_(d.reviewed_by, 120);
  doc.reviewed_at = ovNow_();
  // Dropped photos: trash the files the FSM removed.
  var drop = d.drop_photos || [];
  if (drop.length) {
    try {
      var folder = ovFolderFor_(type);
      drop.forEach(function (pid) {
        if (!/^ph_[\w-]{1,40}$/.test(String(pid))) return;
        var it = folder.getFilesByName(id + '_' + pid + '.jpg');
        while (it.hasNext()) it.next().setTrashed(true);
      });
    } catch (e2) {}
  }
  var meta = ovUpsert_(type, doc, false);
  return ovOut_({ ok: true, id: meta.id, status: meta.status });
}

function ovPdfPut_(d) {
  var id = String(d.id || '');
  var type = ovTypeOf_(id);
  if (!type) return ovOut_({ ok: false, error: 'Bad id' });
  var data = String(d.data || '');
  var m = data.match(/^data:application\/pdf;base64,(.+)$/);
  if (!m) return ovOut_({ ok: false, error: 'Expected a base64 PDF' });
  var bytes = Utilities.base64Decode(m[1]);
  if (bytes.length > 24000000) return ovOut_({ ok: false, error: 'PDF too large to email (24 MB cap)' });
  var sh = ovSheetFor_(type), headers = ovHeadersFor_(type);
  var r = ovFindRow_(sh, id);
  if (!r) return ovOut_({ ok: false, error: 'Not found' });
  var name = ovStr_(d.filename || (id + '.pdf'), 160).replace(/[\\/:*?"<>|]/g, '-');
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  var folder = ovSub_(type === 'report' ? 'Reports and Requests' : 'Porter Checklists');
  var pdfs = folder.getFoldersByName('PDFs');
  var pdfFolder = pdfs.hasNext() ? pdfs.next() : folder.createFolder('PDFs');
  var old = String(sh.getRange(r, headers.indexOf('pdf_file') + 1).getValue() || '');
  if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) {} }
  var file = pdfFolder.createFile(Utilities.newBlob(bytes, 'application/pdf', name));
  sh.getRange(r, headers.indexOf('pdf_file') + 1).setValue(file.getId());
  sh.getRange(r, headers.indexOf('updated_at') + 1).setValue(ovNow_());
  return ovOut_({ ok: true, fileId: file.getId(), url: file.getUrl(), name: name });
}

function ovEmails_(s) {
  return String(s || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
}

function ovSend_(d) {
  var id = String(d.id || '');
  var type = ovTypeOf_(id);
  if (!type) return ovOut_({ ok: false, error: 'Bad id' });
  var sh = ovSheetFor_(type), headers = ovHeadersFor_(type);
  var r = ovFindRow_(sh, id);
  if (!r) return ovOut_({ ok: false, error: 'Not found' });
  var to = ovEmails_(d.to);
  if (!to.length) return ovOut_({ ok: false, error: 'Enter at least one valid To address' });
  var cfg = ovConfig_();
  var cc = ovEmails_(d.cc).concat(ovEmails_(cfg.cc_always));
  var pdfId = String(sh.getRange(r, headers.indexOf('pdf_file') + 1).getValue() || '');
  var blob = null;
  if (d.pdf) {
    var m = String(d.pdf).match(/^data:application\/pdf;base64,(.+)$/);
    if (m) {
      var put = JSON.parse(ovPdfPut_({ id: id, data: d.pdf, filename: d.filename }).getContent());
      if (!put.ok) return ovOut_({ ok: false, error: put.error });
      pdfId = put.fileId;
    }
  }
  if (!pdfId) return ovOut_({ ok: false, error: 'Build the PDF before sending' });
  blob = DriveApp.getFileById(pdfId).getBlob();
  var subject = ovStr_(d.subject || ('City Wide ' + (type === 'report' ? 'report' : 'porter checklist') + ' - ' + String(sh.getRange(r, headers.indexOf('property') + 1).getValue() || '')), 200);
  var msg = ovStr_(d.message || 'Attached is the report from City Wide Facility Solutions.', 5000);
  var html = '<div style="font-family:Verdana,Geneva,sans-serif;font-size:14px;color:#2D2A26;line-height:1.5">' +
    msg.split(/\n{2,}/).map(function (p) { return '<p>' + ovEsc_(p).replace(/\n/g, '<br>') + '</p>'; }).join('') +
    '<p style="font-size:12px;color:#636466">City Wide Facility Solutions | Las Vegas<br>' +
    (d.fsm_name ? ovEsc_(d.fsm_name) + '<br>' : '') + '3215 W Charleston Blvd, Suite 130, Las Vegas, NV 89102<br>702-483-1874</p></div>';
  var opts = {
    to: to.join(','),
    subject: subject,
    body: msg,
    htmlBody: html,
    name: cfg.sender_name || 'City Wide Facility Solutions',
    attachments: [blob]
  };
  if (cc.length) opts.cc = cc.join(',');
  var replyTo = ovEmails_(d.reply_to)[0] || cfg.reply_to || '';
  if (replyTo) opts.replyTo = replyTo;
  if (typeof cwMail_ === 'function') cwMail_('ovation_send', opts); else MailApp.sendEmail(opts);
  var now = ovNow_();
  sh.getRange(r, headers.indexOf('status') + 1).setValue('Sent');
  sh.getRange(r, headers.indexOf('sent_at') + 1).setValue(now);
  sh.getRange(r, headers.indexOf('sent_to') + 1).setValue(to.concat(cc).join(', '));
  sh.getRange(r, headers.indexOf('updated_at') + 1).setValue(now);
  // Mirror into the JSON so the record is whole.
  try {
    var fileId = String(sh.getRange(r, headers.indexOf('json_file') + 1).getValue() || '');
    var f = DriveApp.getFileById(fileId);
    var doc = JSON.parse(f.getBlob().getDataAsString());
    doc.status = 'Sent'; doc.sent_at = now; doc.sent_to = to.concat(cc).join(', '); doc.sent_by = ovStr_(d.fsm_name, 120);
    f.setContent(JSON.stringify(doc));
  } catch (e) {}
  return ovOut_({ ok: true, sent_to: to, cc: cc, sent_at: now });
}

function ovProperties_(d) {
  var sh = ovProps_();
  var rows = ovRows_(sh, OV_PROP_HEADERS);
  rows.forEach(function (r) { delete r._row; });
  return ovOut_({ ok: true, properties: rows, url: sh.getParent().getUrl() });
}
function ovPropertySet_(d) {
  var name = ovStr_(d.property, 120);
  if (!name) return ovOut_({ ok: false, error: 'Missing property' });
  var sh = ovProps_();
  var last = sh.getLastRow();
  var r = 0;
  if (last >= 2) {
    var names = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < names.length; i++) if (String(names[i][0]).trim().toLowerCase() === name.toLowerCase()) { r = i + 2; break; }
  }
  if (!r) { r = last + 1; sh.getRange(r, 1).setValue(name); }
  ['contact_name', 'contact_email', 'cc_email', 'fsm', 'fsm_email', 'notes'].forEach(function (k) {
    if (d[k] !== undefined) sh.getRange(r, OV_PROP_HEADERS.indexOf(k) + 1).setValue(ovStr_(d[k], 300));
  });
  return ovOut_({ ok: true, property: name });
}

// --------------------------------------------------------------- notify --
function ovEsc_(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function ovNotifyReport_(doc) {
  var cfg = ovConfig_();
  var to = ovEmails_(cfg.report_notify);
  if (!to.length) return '';
  var isReq = /request/i.test(String(doc.mode || ''));
  var subject = (isReq ? 'Ovation work request' : 'Ovation report') + ' - ' + doc.property + (doc.category ? ' - ' + doc.category : '') + (doc.urgency && /urgent|today/i.test(doc.urgency) ? ' (' + doc.urgency + ')' : '');
  var fields = [
    ['Property', doc.property], ['From', [doc.submitter, doc.role].filter(Boolean).join(', ')],
    ['Phone', doc.phone], ['Email', doc.email], ['Type', doc.mode], ['Category', doc.category],
    ['Detail', doc.subcategory], ['Urgency', doc.urgency], ['Where', doc.location], ['Submitted', doc.created_at]
  ];
  var rows = fields.filter(function (f) { return f[1]; }).map(function (f) {
    return '<tr><td style="padding:4px 10px 4px 0;color:#636466;white-space:nowrap;vertical-align:top">' + ovEsc_(f[0]) + '</td><td style="padding:4px 0">' + ovEsc_(f[1]) + '</td></tr>';
  }).join('');
  var answers = '';
  (doc.answers || []).forEach(function (a) {
    if (!a || !a.q) return;
    var v = Array.isArray(a.a) ? a.a.join(', ') : a.a;
    if (!v) return;
    answers += '<tr><td style="padding:4px 10px 4px 0;color:#636466;vertical-align:top">' + ovEsc_(a.q) + '</td><td style="padding:4px 0">' + ovEsc_(v) + '</td></tr>';
  });
  var html = '<div style="font-family:Verdana,Geneva,sans-serif;font-size:14px;color:#2D2A26;line-height:1.5">' +
    '<p style="font-size:16px;font-weight:bold;margin:0 0 10px">' + ovEsc_(subject) + '</p>' +
    (doc.summary ? '<p style="margin:0 0 12px">' + ovEsc_(doc.summary).replace(/\n/g, '<br>') + '</p>' : '') +
    '<table style="border-collapse:collapse;font-size:13px">' + rows + answers + '</table>' +
    ((doc.photos || []).length ? '<p style="font-size:12px;color:#636466">' + (doc.photos || []).length + ' photo(s) attached in the review queue.</p>' : '') +
    '<p><a href="https://citywidelv.github.io/ovation-hub/review.html?t=report&id=' + encodeURIComponent(doc.id) + '" style="background:#D22730;color:#fff;text-decoration:none;font-weight:bold;padding:10px 16px;border-radius:6px;display:inline-block">Open in the review queue</a></p>' +
    '</div>';
  var opts = { to: to.join(','), subject: subject, body: subject + '\n\n' + (doc.summary || ''), htmlBody: html, name: cfg.sender_name || 'City Wide Facility Solutions' };
  var rt = ovEmails_(doc.email)[0];
  if (rt) opts.replyTo = rt;
  if (typeof cwMail_ === 'function') cwMail_('ovation', opts); else MailApp.sendEmail(opts);
  return to.join(',');
}

// Run helper (Runner.gs cwRunNow pattern): provisions the book and folder without a page.
function ovProvisionRun() {
  ovReports_(); ovChecks_(); ovProps_(); ovConfigTab_();
  Logger.log('CW Ovation Hub book: ' + ovSS_().getUrl());
  Logger.log('CW Ovation Hub folder: ' + ovFolder_().getUrl());
}
