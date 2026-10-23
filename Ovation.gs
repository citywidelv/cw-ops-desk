/**
 * CW Ovation Hub - backend for citywidelv.github.io/ovation-hub/ (Oct 22 2026).
 *
 * The Ovation Hub is a client-facing hub for Ovation Property Management staff and the
 * day porters working their properties. It has its OWN passcode (script property
 * OV_PASSCODE), checked here on every call. Ovation staff and porters never see the team
 * passcode. The FSM review queue (review.html) is team-passcode only.
 *
 * Routed from doPost: kinds starting ov_ come here.
 *   Client kinds (Ovation passcode only, script property OV_PASSCODE; the team passcode does
 *   NOT open the client side, per TJ Oct 22 2026):
 *     ov_auth          -> passcode check for the hub gate
 *     ov_submit        -> save one report (observation / work request) or one porter checklist
 *     ov_photo_put     -> store one photo (JPEG, base64) for a submission
 *     ov_feed          -> porter view of Ovation reports and requests, anonymised (no name, role, phone, email, City Wide notes)
 *     ov_feed_get      -> one report, anonymised, with its photo file ids
 *     ov_feed_photo    -> one report photo (file must sit in the Reports and Requests folder)
 *     ov_library       -> porter view of submitted checklists (index only, no City Wide notes)
 *     ov_pdf_get       -> the FSM-built PDF for one checklist, base64, so the porter library can open it
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
 *     ov_digest_list   -> everything not yet sent to a property (checklists + reports), for digest.html
 *     ov_digest_send   -> one property's weekly digest: HTML email + one PDF per item, marks each Sent
 *
 * Oct 23 2026 (TJ): everything submitted on the hub reaches the FSM.
 *   - Every New checklist and every New report is an item on the Ops Hub Alerts card
 *     (ovAlertItems_, read by Alerts.gs alList_; keys ovc:<id> / ovr:<id>, types ovcheck / ovreport).
 *     Marking it on the card writes the status back here (ovAlertSet_), and marking it on
 *     review.html takes it off the card, so the two never disagree. Open items also ride at
 *     the top of the 10 AM / 6 PM Ops digests until marked (cwOpenSupplyAlerts_ in Code.gs).
 *   - A report (Ovation staff, or a porter emergency / maintenance request from
 *     porter-report.html) emails ops the moment it lands: Config!report_notify plus the
 *     property's fsm_email, plus Config!emergency_notify on an emergency. Checklists still
 *     send no mail on submit (TJ, Oct 22).
 *   - Weekly digest to the property: digest.html lists every unsent checklist and report by
 *     property and date; the FSM ticks the ones to send and one email per property goes out
 *     with a PDF per item. PDFs the FSM never built are built here (ovBuildPdf_, HTML to PDF,
 *     photos embedded) and filed like the browser-built ones, so the porter library sees them.
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
  ['cc_always', '', 'Always CC these addresses on PDFs sent to the property. Comma separated.'],
  ['emergency_notify', '', 'Extra addresses emailed on a porter EMERGENCY report, on top of report_notify and the property FSM. Comma separated.']
];
function ovConfigEnsure_() { try { ovConfig_(); } catch (e) {} }

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
  return String(d.passcode || '') === c;
}

function ovDispatch(d) {
  var kind = String(d.kind || '');
  try {
    if (kind === 'ov_auth') {
      if (!ovClientPass_()) return ovOut_({ ok: false, error: 'The Ovation Hub passcode has not been set yet. Ask City Wide.' });
      return ovIsClient_(d) ? ovOut_({ ok: true, hub: 'ovation' }) : ovOut_({ ok: false, error: 'Wrong passcode' });
    }
    var client = ['ov_submit', 'ov_photo_put', 'ov_feed', 'ov_feed_get', 'ov_feed_photo', 'ov_library', 'ov_pdf_get'];
    if (client.indexOf(kind) >= 0) {
      if (!ovIsClient_(d)) return ovOut_({ ok: false, error: 'Bad passcode' });
    } else {
      if (!ovIsTeam_(d)) return ovOut_({ ok: false, error: 'Bad passcode' });
    }
    if (kind === 'ov_submit') return ovSubmit_(d);
    if (kind === 'ov_photo_put') return ovPhotoPut_(d);
    if (kind === 'ov_feed') return ovFeed_(d);
    if (kind === 'ov_feed_get') return ovFeedGet_(d);
    if (kind === 'ov_feed_photo') return ovFeedPhoto_(d);
    if (kind === 'ov_library') return ovLibrary_(d);
    if (kind === 'ov_pdf_get') return ovPdfGet_(d);
    if (kind === 'ov_list') return ovList_(d);
    if (kind === 'ov_get') return ovGet_(d);
    if (kind === 'ov_photo_get') return ovPhotoGet_(d);
    if (kind === 'ov_update') return ovUpdate_(d);
    if (kind === 'ov_pdf_put') return ovPdfPut_(d);
    if (kind === 'ov_send') return ovSend_(d);
    if (kind === 'ov_properties') return ovProperties_(d);
    if (kind === 'ov_property_set') return ovPropertySet_(d);
    if (kind === 'ov_config') return ovOut_({ ok: true, config: ovConfig_() });
    if (kind === 'ov_digest_list') return ovDigestList_(d);
    if (kind === 'ov_digest_send') return ovDigestSend_(d);
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
      if (val instanceof Date) val = ovCell_(headers[c], val);
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
// Sheets turns a yyyy-mm-dd string into a Date; hand dates back as the day, not an instant.
function ovCell_(header, d) {
  if (header === 'service_date') return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return d.toISOString();
}
function ovConfig_() {
  var sh = ovConfigTab_();
  var out = {};
  var last = sh.getLastRow();
  var v = last < 2 ? [] : sh.getRange(2, 1, last - 1, 2).getValues();
  v.forEach(function (r) { if (r[0]) out[String(r[0]).trim()] = String(r[1] === null || r[1] === undefined ? '' : r[1]).trim(); });
  // Keys added to the seed after the tab was created get appended once, so no Run step is needed.
  OV_CONFIG_SEED.forEach(function (row) { if (!(row[0] in out)) { try { sh.appendRow(row); } catch (e) {} out[row[0]] = String(row[1] || ''); } });
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
  headers.forEach(function (h, i) { var v = rowVals[i]; index[h] = v instanceof Date ? ovCell_(h, v) : v; });
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
  var m = data.match(/^data:application\/pdf;(?:[^,]*;)?base64,(.+)$/);
  if (!m) return ovOut_({ ok: false, error: 'Expected a base64 PDF' });
  var bytes = Utilities.base64Decode(m[1]);
  if (bytes.length > 24000000) return ovOut_({ ok: false, error: 'PDF too large to email (24 MB cap)' });
  var sh = ovSheetFor_(type), headers = ovHeadersFor_(type);
  var r = ovFindRow_(sh, id);
  if (!r) return ovOut_({ ok: false, error: 'Not found' });
  var name = ovStr_(d.filename || (id + '.pdf'), 160).replace(/[\\/:*?"<>|]/g, '-');
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  var file = ovStorePdf_(type, sh, headers, r, Utilities.newBlob(bytes, 'application/pdf', name));
  return ovOut_({ ok: true, fileId: file.getId(), url: file.getUrl(), name: name });
}
// Files one PDF under <type folder>/PDFs, trashes the one it replaces, writes pdf_file on the row.
function ovStorePdf_(type, sh, headers, r, blob) {
  var folder = ovSub_(type === 'report' ? 'Reports and Requests' : 'Porter Checklists');
  var pdfs = folder.getFoldersByName('PDFs');
  var pdfFolder = pdfs.hasNext() ? pdfs.next() : folder.createFolder('PDFs');
  var old = String(sh.getRange(r, headers.indexOf('pdf_file') + 1).getValue() || '');
  if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) {} }
  var file = pdfFolder.createFile(blob);
  sh.getRange(r, headers.indexOf('pdf_file') + 1).setValue(file.getId());
  sh.getRange(r, headers.indexOf('updated_at') + 1).setValue(ovNow_());
  return file;
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
    var m = String(d.pdf).match(/^data:application\/pdf;(?:[^,]*;)?base64,(.+)$/);
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

// ------------------------------------------------- porter-facing views --
// Porters see what Ovation staff asked for, never who asked. Contact details and
// City Wide's internal notes stay on the team side.
var OV_FEED_COLS = ['id', 'created_at', 'property', 'mode', 'category', 'subcategory', 'urgency', 'summary', 'status', 'photos', 'updated_at'];
function ovAnonDoc_(doc) {
  var out = {};
  ['id', 'created_at', 'property', 'mode', 'category', 'subcategory', 'urgency', 'location', 'summary', 'notes', 'hazard_notes', 'status', 'response', 'photos', 'reviewed_at'].forEach(function (k) { if (doc[k] !== undefined) out[k] = doc[k]; });
  out.answers = (doc.answers || []).filter(function (a) { return a && a.id !== 'approver'; });
  return out;
}
function ovFeed_(d) {
  var sh = ovReports_();
  var rows = ovRows_(sh, OV_REPORT_HEADERS);
  var property = String(d.property || '');
  var since = Date.now() - 1000 * 60 * 60 * 24 * (Number(d.days) || 60);
  rows = rows.filter(function (r) {
    if (property && String(r.property) !== property) return false;
    if (ovIsPorterReport_(r)) return false;   // Oct 23 2026: porter emergencies and maintenance requests go to City Wide, not back to the porter feed
    var t = Date.parse(String(r.created_at || ''));
    return !t || t >= since;
  });
  rows.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  var out = rows.slice(0, Number(d.limit) || 150).map(function (r) { var o = {}; OV_FEED_COLS.forEach(function (k) { o[k] = r[k]; }); return o; });
  return ovOut_({ ok: true, rows: out });
}
function ovFeedGet_(d) {
  var id = String(d.id || '');
  if (ovTypeOf_(id) !== 'report') return ovOut_({ ok: false, error: 'Bad id' });
  var sh = ovReports_();
  var r = ovFindRow_(sh, id);
  if (!r) return ovOut_({ ok: false, error: 'Not found' });
  if (ovIsPorterReport_({ role: sh.getRange(r, OV_REPORT_HEADERS.indexOf('role') + 1).getValue(), mode: sh.getRange(r, OV_REPORT_HEADERS.indexOf('mode') + 1).getValue() })) return ovOut_({ ok: false, error: 'Not found' });
  var fileId = String(sh.getRange(r, OV_REPORT_HEADERS.indexOf('json_file') + 1).getValue() || '');
  if (!fileId) return ovOut_({ ok: false, error: 'No saved data' });
  var doc = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
  doc.status = String(sh.getRange(r, OV_REPORT_HEADERS.indexOf('status') + 1).getValue() || doc.status || 'New');
  var files = {};
  try {
    var it = ovFolderFor_('report').searchFiles("title contains '" + id + "_ph_' and trashed = false");
    while (it.hasNext()) { var f = it.next(); var mm = f.getName().match(/_(ph_[\w-]+)\.jpg$/); if (mm) files[mm[1]] = f.getId(); }
  } catch (e) {}
  return ovOut_({ ok: true, doc: ovAnonDoc_(doc), photo_files: files });
}
function ovFeedPhoto_(d) {
  var fileId = String(d.fileId || '');
  if (!fileId) return ovOut_({ ok: false, error: 'Missing fileId' });
  var file;
  try { file = DriveApp.getFileById(fileId); } catch (e) { return ovOut_({ ok: false, error: 'Photo not found' }); }
  if (!file || file.isTrashed() || !/_ph_[\w-]+\.jpg$/.test(file.getName())) return ovOut_({ ok: false, error: 'Photo not found' });
  // Only photos filed under Reports and Requests leave through this door.
  var ok = false, reportsId = ovFolderFor_('report').getId();
  var parents = file.getParents();
  while (parents.hasNext()) { if (parents.next().getId() === reportsId) ok = true; }
  if (!ok) return ovOut_({ ok: false, error: 'Photo not found' });
  return ovOut_({ ok: true, fileId: fileId, data: 'data:image/jpeg;base64,' + Utilities.base64Encode(file.getBlob().getBytes()) });
}
var OV_LIB_COLS = ['id', 'created_at', 'service_date', 'weekday', 'property', 'porter', 'areas_done', 'areas_na', 'tasks_checked', 'tasks_total', 'photos', 'status', 'sent_at'];
function ovLibrary_(d) {
  var sh = ovChecks_();
  var rows = ovRows_(sh, OV_CHECK_HEADERS);
  var property = String(d.property || '');
  if (property) rows = rows.filter(function (r) { return String(r.property) === property; });
  rows.sort(function (a, b) { return String(b.service_date + b.created_at).localeCompare(String(a.service_date + a.created_at)); });
  var out = rows.slice(0, Number(d.limit) || 200).map(function (r) { var o = {}; OV_LIB_COLS.forEach(function (k) { o[k] = r[k]; }); o.has_pdf = !!r.pdf_file; return o; });
  return ovOut_({ ok: true, rows: out });
}
function ovPdfGet_(d) {
  var id = String(d.id || '');
  var type = ovTypeOf_(id);
  if (!type) return ovOut_({ ok: false, error: 'Bad id' });
  var sh = ovSheetFor_(type), headers = ovHeadersFor_(type);
  var r = ovFindRow_(sh, id);
  if (!r) return ovOut_({ ok: false, error: 'Not found' });
  var pdfId = String(sh.getRange(r, headers.indexOf('pdf_file') + 1).getValue() || '');
  if (!pdfId) return ovOut_({ ok: false, error: 'No PDF yet. City Wide has not built it.' });
  var file;
  try { file = DriveApp.getFileById(pdfId); } catch (e) { return ovOut_({ ok: false, error: 'PDF not found' }); }
  if (!file || file.isTrashed()) return ovOut_({ ok: false, error: 'PDF not found' });
  var bytes = file.getBlob().getBytes();
  return ovOut_({ ok: true, name: file.getName(), size: bytes.length, data: 'data:application/pdf;base64,' + Utilities.base64Encode(bytes) });
}

// --------------------------------------------------------------- notify --
function ovEsc_(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
// A porter emergency or maintenance request submitted from porter-report.html. role is Porter and
// mode starts with "Porter". These never show on the porter feed and email ops at once.
function ovIsPorterReport_(r) {
  return /^porter/i.test(String(r && r.mode || '')) || String(r && r.role || '').toLowerCase() === 'porter';
}
function ovIsEmergency_(r) { return /emergency/i.test(String(r && r.mode || '')) || /emergency/i.test(String(r && r.urgency || '')); }
var OV_REVIEW_URL = 'https://citywidelv.github.io/ovation-hub/review.html';
var OV_LOGO_OV = 'https://citywidelv.github.io/ovation-hub/ovation-logo.png';

// Immediate email for every report: Ovation staff reports and requests, porter emergencies and
// maintenance requests. To = Config!report_notify + the property's fsm_email (Properties tab);
// an emergency adds Config!emergency_notify. Branded shell when the platform helpers are present.
function ovNotifyReport_(doc) {
  var cfg = ovConfig_();
  var prop = ovPropIndex_()[String(doc.property || '').trim().toLowerCase()] || {};
  var porter = ovIsPorterReport_(doc), emergency = ovIsEmergency_(doc);
  var to = ovEmails_(cfg.report_notify).concat(ovEmails_(prop.fsm_email));
  if (emergency) to = to.concat(ovEmails_(cfg.emergency_notify));
  var seen = {}; to = to.filter(function (a) { var k = a.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
  if (!to.length) return '';
  var isReq = /request/i.test(String(doc.mode || ''));
  var label = emergency ? 'EMERGENCY' : porter ? 'Porter maintenance request' : isReq ? 'Ovation work request' : 'Ovation report';
  var subject = label + ' - ' + doc.property + (doc.category ? ' - ' + doc.category : '') + (!emergency && doc.urgency && /urgent|today/i.test(doc.urgency) ? ' (' + doc.urgency + ')' : '');
  var fields = [
    ['Property', doc.property], ['From', [doc.submitter, doc.role].filter(Boolean).join(', ')],
    ['Phone', doc.phone], ['Email', doc.email], ['Type', doc.mode], ['Category', doc.category],
    ['Detail', doc.subcategory], ['Urgency', doc.urgency], ['Where', doc.location],
    ['Submitted', ovNice_(doc.created_at)], ['FSM', prop.fsm || '']
  ];
  (doc.answers || []).forEach(function (a) {
    if (!a || !a.q) return;
    var v = Array.isArray(a.a) ? a.a.join(', ') : a.a;
    if (v) fields.push([a.q, v]);
  });
  if (doc.notes) fields.push(['Anything else', doc.notes]);
  var n = (doc.photos || []).length;
  var link = OV_REVIEW_URL + '?t=report&id=' + encodeURIComponent(doc.id);
  var html;
  if (typeof cwShell_ === 'function' && typeof cwFacts_ === 'function' && typeof cwButton_ === 'function') {
    var F = 'font-family:Verdana,Arial,sans-serif;';
    var inner = (emergency ? '<div style="background:#FDF1F2;border:2px solid #D22730;border-radius:6px;padding:12px 14px;margin:0 0 14px;' + F + 'font-size:14px;font-weight:bold;color:#D22730;">EMERGENCY reported by the porter. Call them back now.</div>' : '') +
      '<p style="margin:0 0 10px;' + F + 'font-size:15px;font-weight:bold;color:#2d2a26;">' + ovEsc_(doc.property) + ' <span style="font-weight:normal;color:#999999;font-size:12px;">' + ovEsc_(label) + '</span></p>' +
      (doc.summary ? '<p style="margin:0 0 12px;' + F + 'font-size:13px;color:#2d2a26;line-height:1.55;">' + ovEsc_(doc.summary).replace(/\n/g, '<br>') + '</p>' : '') +
      cwFacts_(fields) +
      (n ? '<p style="margin:10px 0 0;' + F + 'font-size:12px;color:#636466;">' + n + (n === 1 ? ' photo' : ' photos') + ' in the review queue.</p>' : '') +
      cwButton_('Open in the review queue', link) +
      '<p style="margin:14px 0 0;' + F + 'font-size:11px;color:#999999;">This item stays on the Ops Hub Alerts card and in the daily digest until someone marks it.</p>';
    html = cwShell_('Ovation Hub', (emergency ? 'EMERGENCY' : 'New ' + (porter ? 'porter request' : isReq ? 'work request' : 'report')), inner);
  } else {
    var rows = fields.filter(function (f) { return f[1]; }).map(function (f) {
      return '<tr><td style="padding:4px 10px 4px 0;color:#636466;white-space:nowrap;vertical-align:top">' + ovEsc_(f[0]) + '</td><td style="padding:4px 0">' + ovEsc_(f[1]) + '</td></tr>';
    }).join('');
    html = '<div style="font-family:Verdana,Geneva,sans-serif;font-size:14px;color:#2D2A26;line-height:1.5">' +
      '<p style="font-size:16px;font-weight:bold;margin:0 0 10px">' + ovEsc_(subject) + '</p>' +
      (doc.summary ? '<p style="margin:0 0 12px">' + ovEsc_(doc.summary).replace(/\n/g, '<br>') + '</p>' : '') +
      '<table style="border-collapse:collapse;font-size:13px">' + rows + '</table>' +
      (n ? '<p style="font-size:12px;color:#636466">' + n + ' photo(s) attached in the review queue.</p>' : '') +
      '<p><a href="' + link + '" style="background:#D22730;color:#fff;text-decoration:none;font-weight:bold;padding:10px 16px;border-radius:6px;display:inline-block">Open in the review queue</a></p></div>';
  }
  var plain = subject + '\n\n' + (doc.summary || '') + '\n\n' + fields.filter(function (f) { return f[1]; }).map(function (f) { return f[0] + ': ' + f[1]; }).join('\n') + '\n\n' + link;
  var opts = { to: to.join(','), subject: subject, body: plain, htmlBody: html, name: cfg.sender_name || 'City Wide Facility Solutions' };
  var rt = ovEmails_(doc.email)[0];
  if (rt) opts.replyTo = rt;
  if (typeof cwMail_ === 'function') cwMail_(emergency ? 'ovation_emergency' : 'ovation', opts); else MailApp.sendEmail(opts);
  return to.join(',');
}
function ovNice_(iso) {
  var t = Date.parse(String(iso || ''));
  if (!t) return String(iso || '');
  return Utilities.formatDate(new Date(t), 'America/Los_Angeles', 'EEE MMM d, h:mm a');
}
function ovDay_(ymd) {
  var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(ymd || '');
  return Utilities.formatDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12), 'America/Los_Angeles', 'EEEE, MMM d, yyyy');
}
function ovPropIndex_() {
  var out = {};
  try { ovRows_(ovProps_(), OV_PROP_HEADERS).forEach(function (p) { if (p.property) out[String(p.property).trim().toLowerCase()] = p; }); } catch (e) {}
  return out;
}

// --------------------------------------------------- Ops Hub Alerts (Oct 23 2026) --
// Every New checklist and every New report is an alert. Alerts.gs alList_ concatenates this
// list; the hub shows type ovcheck under "Requests and reports" with one button (Approve) and
// type ovreport with Reviewed / Scheduled / Done. The FSM comes from the Properties tab.
function ovAlertItems_() {
  var items = [];
  var props = ovPropIndex_();
  var days = (typeof AL_DAYS !== 'undefined') ? AL_DAYS : 45;
  function fsmOf(property) {
    var p = props[String(property || '').trim().toLowerCase()];
    return (p && p.fsm && typeof alFsmKey_ === 'function') ? alFsmKey_(p.fsm) : '';
  }
  function stamp(iso) {
    var t = Date.parse(String(iso || ''));
    var d = t ? new Date(t) : null;
    return { when: (d && typeof alIso_ === 'function') ? alIso_(d) : String(iso || ''), nice: (d && typeof alNice_ === 'function') ? alNice_(d) : ovNice_(iso), fresh: !d || (Date.now() - d.getTime()) <= days * 86400000 };
  }
  ovRows_(ovChecks_(), OV_CHECK_HEADERS).forEach(function (r) {
    if (String(r.status || 'New') !== 'New') return;
    var s = stamp(r.created_at);
    if (!s.fresh) return;
    var bits = [ovDay_(r.service_date), (r.areas_done || 0) + ' areas serviced', (r.tasks_checked || 0) + ' of ' + (r.tasks_total || 0) + ' tasks', (r.photos || 0) + (Number(r.photos) === 1 ? ' photo' : ' photos')];
    if (r.followups) bits.push('Reported to the property: ' + ovStr_(r.followups, 160));
    if (r.supplies) bits.push('Supplies low: ' + ovStr_(r.supplies, 100));
    items.push({
      key: 'ovc:' + r.id, type: 'ovcheck', fsm: fsmOf(r.property), region: 'Las Vegas',
      when: s.when, when_nice: s.nice,
      from: String(r.porter || 'Porter'), about: String(r.property || ''),
      summary: bits.join(' - '), email: '', phone: '',
      link: OV_REVIEW_URL + '?t=checklist&id=' + encodeURIComponent(r.id), ref: String(r.id)
    });
  });
  ovRows_(ovReports_(), OV_REPORT_HEADERS).forEach(function (r) {
    if (String(r.status || 'New') !== 'New') return;
    var s = stamp(r.created_at);
    if (!s.fresh) return;
    var emergency = ovIsEmergency_(r), porter = ovIsPorterReport_(r);
    var bits = [String(r.mode || '') + (r.category ? ': ' + r.category : '')];
    if (r.urgency && !emergency) bits.push(String(r.urgency));
    if (r.summary) bits.push(ovStr_(r.summary, 220));
    items.push({
      key: 'ovr:' + r.id, type: 'ovreport', fsm: fsmOf(r.property), region: 'Las Vegas',
      when: s.when, when_nice: s.nice,
      from: String(r.submitter || '') + (r.role ? ' (' + r.role + ')' : ''), about: String(r.property || ''),
      summary: (emergency ? 'EMERGENCY - ' : '') + bits.join(' - '),
      email: porter ? '' : String(r.email || ''), phone: String(r.phone || ''),
      urgent: emergency,
      link: OV_REVIEW_URL + '?t=report&id=' + encodeURIComponent(r.id), ref: String(r.id)
    });
  });
  return items;
}
// Hub check-off -> Ovation sheet. Approved on a checklist is stored as Reviewed (the status
// review.html already filters on). An undo (blank status) puts it back to New.
function ovAlertSet_(key, status, by) {
  var m = String(key || '').match(/^ov([cr]):(.+)$/);
  if (!m) return false;
  var sheetStatus = !status ? 'New' : (status === 'Approved' ? 'Reviewed' : status);
  return ovSetStatus_(m[2], sheetStatus, by);
}
function ovSetStatus_(id, status, by) {
  var type = ovTypeOf_(id);
  if (!type) return false;
  var sh = ovSheetFor_(type), headers = ovHeadersFor_(type);
  var r = ovFindRow_(sh, id);
  if (!r) return false;
  var now = ovNow_();
  sh.getRange(r, headers.indexOf('status') + 1).setValue(status);
  sh.getRange(r, headers.indexOf('updated_at') + 1).setValue(now);
  try {
    var fileId = String(sh.getRange(r, headers.indexOf('json_file') + 1).getValue() || '');
    if (fileId) {
      var f = DriveApp.getFileById(fileId);
      var doc = JSON.parse(f.getBlob().getDataAsString());
      doc.status = status;
      if (status !== 'New') { doc.reviewed_by = ovStr_(by, 120); doc.reviewed_at = now; }
      f.setContent(JSON.stringify(doc));
    }
  } catch (e) {}
  return true;
}

// ------------------------------------------------ weekly digest to the property --
var OV_SENT_DONE = { sent: 1 };
function ovDigestList_(d) {
  var props = ovPropIndex_();
  function keep(r) { return String(r.status || 'New').toLowerCase() !== 'sent'; }
  var checks = ovRows_(ovChecks_(), OV_CHECK_HEADERS).filter(keep).map(function (r) {
    return { id: r.id, type: 'checklist', property: r.property, service_date: r.service_date, weekday: r.weekday, day: ovDay_(r.service_date),
      porter: r.porter, status: r.status || 'New', areas_done: r.areas_done, areas_na: r.areas_na, tasks_checked: r.tasks_checked, tasks_total: r.tasks_total,
      photos: r.photos, followups: ovStr_(r.followups, 200), supplies: ovStr_(r.supplies, 120), has_pdf: !!r.pdf_file, created_at: r.created_at };
  });
  var reports = ovRows_(ovReports_(), OV_REPORT_HEADERS).filter(keep).map(function (r) {
    return { id: r.id, type: 'report', property: r.property, created_at: r.created_at, day: ovNice_(r.created_at), service_date: String(r.created_at || '').slice(0, 10),
      submitter: r.submitter, role: r.role, mode: r.mode, category: r.category, subcategory: r.subcategory, urgency: r.urgency, status: r.status || 'New',
      summary: ovStr_(r.summary, 200), photos: r.photos, has_pdf: !!r.pdf_file, porter: ovIsPorterReport_(r), emergency: ovIsEmergency_(r) };
  });
  var names = {};
  checks.concat(reports).forEach(function (x) { names[String(x.property)] = 1; });
  var properties = Object.keys(names).sort().map(function (n) {
    var p = props[n.toLowerCase()] || {};
    return { property: n, contact_name: p.contact_name || '', contact_email: p.contact_email || '', cc_email: p.cc_email || '', fsm: p.fsm || '', fsm_email: p.fsm_email || '' };
  });
  return ovOut_({ ok: true, checklists: checks, reports: reports, properties: properties, config: { cc_always: ovConfig_().cc_always || '' } });
}

// ids = the items ticked on digest.html, all for ONE property. One email, one PDF per item.
function ovDigestSend_(d) {
  var ids = d.ids;
  if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch (e) { ids = String(ids).split(/[,\s]+/); } }
  ids = (ids || []).map(function (x) { return String(x || '').trim(); }).filter(function (x) { return /^ov[rc]_[\w-]{1,40}$/.test(x); });
  if (!ids.length) return ovOut_({ ok: false, error: 'Tick at least one item' });
  if (ids.length > 14) return ovOut_({ ok: false, error: 'Send at most 14 items in one email. Split the rest into a second send.' });
  var to = ovEmails_(d.to);
  if (!to.length) return ovOut_({ ok: false, error: 'Enter at least one valid To address' });
  var cfg = ovConfig_();
  var cc = ovEmails_(d.cc).concat(ovEmails_(cfg.cc_always));
  var seen = {}; cc = cc.filter(function (a) { var k = a.toLowerCase(); if (seen[k] || to.some(function (t) { return t.toLowerCase() === k; })) return false; seen[k] = 1; return true; });
  var by = ovStr_(d.fsm_name, 120);
  // Load every item first so nothing sends if one is missing.
  var items = [], property = '', bytes = 0;
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i], type = ovTypeOf_(id);
    var sh = ovSheetFor_(type), headers = ovHeadersFor_(type);
    var r = ovFindRow_(sh, id);
    if (!r) return ovOut_({ ok: false, error: 'Not found: ' + id });
    var row = {}; var vals = sh.getRange(r, 1, 1, headers.length).getValues()[0];
    headers.forEach(function (h, c) { var v = vals[c]; row[h] = v instanceof Date ? ovCell_(h, v) : v; });
    if (!property) property = String(row.property || '');
    if (String(row.property || '') !== property) return ovOut_({ ok: false, error: 'Send one property at a time. ' + id + ' belongs to ' + row.property + '.' });
    var doc = JSON.parse(DriveApp.getFileById(String(row.json_file)).getBlob().getDataAsString());
    items.push({ id: id, type: type, sh: sh, headers: headers, r: r, row: row, doc: doc });
  }
  // One PDF per item: the FSM's own if built, else built here now and filed the same way.
  var attachments = [];
  for (var j = 0; j < items.length; j++) {
    var it = items[j], blob = null;
    if (it.row.pdf_file) { try { blob = DriveApp.getFileById(String(it.row.pdf_file)).getBlob(); } catch (e2) { blob = null; } }
    if (!blob) {
      blob = ovBuildPdf_(it.type, it.doc, by);
      ovStorePdf_(it.type, it.sh, it.headers, it.r, blob);
    }
    bytes += blob.getBytes().length;
    attachments.push(blob);
  }
  if (bytes > 22000000) return ovOut_({ ok: false, error: 'These PDFs add up to ' + Math.round(bytes / 1048576) + ' MB, over the 22 MB email cap. Tick fewer items and send twice.' });
  var checks = items.filter(function (x) { return x.type === 'checklist'; }).sort(function (a, b) { return String(a.row.service_date).localeCompare(String(b.row.service_date)); });
  var reports = items.filter(function (x) { return x.type === 'report'; }).sort(function (a, b) { return String(a.row.created_at).localeCompare(String(b.row.created_at)); });
  var dates = checks.map(function (x) { return String(x.row.service_date); }).concat(reports.map(function (x) { return String(x.row.created_at).slice(0, 10); })).filter(Boolean).sort();
  var span = dates.length ? (dates[0] === dates[dates.length - 1] ? ovDay_(dates[0]) : ovDay_(dates[0]).replace(/^\w+, /, '') + ' to ' + ovDay_(dates[dates.length - 1]).replace(/^\w+, /, '')) : '';
  var subject = ovStr_(d.subject || ('City Wide weekly service report - ' + property + (span ? ' - ' + span : '')), 200);
  var msg = ovStr_(d.message || ('Hello,\n\nAttached are the day porter service reports for ' + property + (span ? ' for ' + span : '') + '. Each day is its own PDF with the areas serviced, the tasks completed and photos from the shift.\n\nReply to this email with any questions.\n\nThank you,\nCity Wide Facility Solutions'), 5000);
  var html = ovDigestHtml_(property, span, msg, checks, reports, by);
  var plain = msg + '\n\n' + checks.map(function (x) { return '* ' + ovDay_(x.row.service_date) + ' - ' + x.row.porter + ' - ' + x.row.areas_done + ' areas, ' + x.row.tasks_checked + ' of ' + x.row.tasks_total + ' tasks' + (x.row.followups ? ' - ' + x.row.followups : ''); })
    .concat(reports.map(function (x) { return '* ' + ovNice_(x.row.created_at) + ' - ' + x.row.mode + (x.row.category ? ': ' + x.row.category : '') + (x.doc.response ? ' - City Wide: ' + x.doc.response : ''); })).join('\n');
  var opts = { to: to.join(','), subject: subject, body: plain, htmlBody: html, name: cfg.sender_name || 'City Wide Facility Solutions', attachments: attachments };
  if (cc.length) opts.cc = cc.join(',');
  var replyTo = ovEmails_(d.reply_to)[0] || cfg.reply_to || '';
  if (replyTo) opts.replyTo = replyTo;
  if (typeof cwMail_ === 'function') cwMail_('ovation_digest', opts); else MailApp.sendEmail(opts);
  var now = ovNow_(), sentTo = to.concat(cc).join(', ');
  items.forEach(function (it) {
    it.sh.getRange(it.r, it.headers.indexOf('status') + 1).setValue('Sent');
    it.sh.getRange(it.r, it.headers.indexOf('sent_at') + 1).setValue(now);
    it.sh.getRange(it.r, it.headers.indexOf('sent_to') + 1).setValue(sentTo);
    it.sh.getRange(it.r, it.headers.indexOf('updated_at') + 1).setValue(now);
    try {
      var f = DriveApp.getFileById(String(it.row.json_file));
      it.doc.status = 'Sent'; it.doc.sent_at = now; it.doc.sent_to = sentTo; it.doc.sent_by = by; it.doc.sent_in = 'digest';
      f.setContent(JSON.stringify(it.doc));
    } catch (e3) {}
  });
  return ovOut_({ ok: true, property: property, sent: ids, sent_to: to, cc: cc, sent_at: now, built: items.filter(function (x) { return !x.row.pdf_file; }).length });
}

function ovDigestHtml_(property, span, msg, checks, reports, by) {
  var F = 'font-family:Verdana,Arial,sans-serif;';
  var e = ovEsc_;
  function card(title, sub, facts, accent) {
    var rows = facts.filter(function (p) { return p && p[1] !== undefined && p[1] !== null && String(p[1]) !== ''; }).map(function (p) {
      return '<tr><td width="1%" style="padding:4px 14px 4px 0;' + F + 'font-size:11px;color:#636466;white-space:nowrap;vertical-align:top;">' + e(p[0]) + '</td><td style="padding:4px 0;' + F + 'font-size:13px;color:#2d2a26;line-height:1.45;">' + e(p[1]).replace(/\n/g, '<br>') + '</td></tr>';
    }).join('');
    return '<div style="border:1px solid #E5E5E5;border-left:4px solid ' + (accent || '#D22730') + ';border-radius:0 6px 6px 0;padding:12px 14px;margin:0 0 10px;">' +
      '<p style="margin:0 0 6px;' + F + 'font-size:14px;font-weight:bold;color:#2d2a26;">' + e(title) + (sub ? '<span style="font-weight:normal;color:#999999;font-size:11px;margin-left:8px;">' + e(sub) + '</span>' : '') + '</p>' +
      (rows ? '<table border="0" cellpadding="0" cellspacing="0" width="100%">' + rows + '</table>' : '') + '</div>';
  }
  var body = msg.split(/\n{2,}/).map(function (p) { return '<p style="margin:0 0 12px;' + F + 'font-size:13px;color:#2d2a26;line-height:1.55;">' + e(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
  var inner = body;
  if (checks.length) {
    inner += '<h2 style="margin:22px 0 10px;' + F + 'font-size:13px;font-weight:bold;color:#2d2a26;border-bottom:2px solid #D22730;padding-bottom:5px;text-transform:uppercase;letter-spacing:0.04em;">Daily service reports <span style="color:#636466;font-weight:normal;text-transform:none;letter-spacing:0;">(' + checks.length + ', each attached as a PDF)</span></h2>';
    checks.forEach(function (x) {
      var r = x.row;
      inner += card(ovDay_(r.service_date), 'Porter ' + r.porter, [
        ['Areas serviced', (r.areas_done || 0) + (r.areas_na ? ' (' + r.areas_na + ' not serviced that day)' : '')],
        ['Daily tasks', (r.tasks_checked || 0) + ' of ' + (r.tasks_total || 0) + ' completed'],
        ['Photos', r.photos || 0],
        ['Reported to the property', r.followups], ['Supplies running low', r.supplies], ['Note from City Wide', x.doc.fsm_notes]
      ]);
    });
  }
  if (reports.length) {
    inner += '<h2 style="margin:22px 0 10px;' + F + 'font-size:13px;font-weight:bold;color:#2d2a26;border-bottom:2px solid #2d2a26;padding-bottom:5px;text-transform:uppercase;letter-spacing:0.04em;">Reports and requests <span style="color:#636466;font-weight:normal;text-transform:none;letter-spacing:0;">(' + reports.length + ', each attached as a PDF)</span></h2>';
    reports.forEach(function (x) {
      var r = x.row;
      inner += card(String(r.mode || '') + (r.category ? ': ' + r.category : ''), ovNice_(r.created_at), [
        ['From', [r.submitter, r.role].filter(Boolean).join(', ')], ['Where', x.doc.location], ['Urgency', r.urgency], ['Summary', r.summary],
        ['City Wide response', x.doc.response], ['Note from City Wide', x.doc.fsm_notes]
      ], '#2d2a26');
    });
  }
  inner += '<p style="margin:18px 0 0;' + F + 'font-size:12px;color:#636466;">' + (by ? e(by) + ', ' : '') + 'City Wide Facility Solutions | Las Vegas<br>3215 W Charleston Blvd, Suite 130, Las Vegas, NV 89102 | 702-483-1874</p>';
  var LOGOURL = (typeof LOGO !== 'undefined') ? LOGO : 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
  return '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
    '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="680" style="max-width:680px;">' +
    '<tr><td style="padding:24px 30px 0;"><table border="0" cellpadding="0" cellspacing="0" width="100%"><tr>' +
    '<td><img src="' + LOGOURL + '" height="38" alt="City Wide Facility Solutions" style="display:block;border:0;height:38px;width:auto;"></td>' +
    '<td align="right"><img src="' + OV_LOGO_OV + '" height="30" alt="Ovation Property Management" style="display:block;border:0;height:30px;width:auto;"></td></tr></table></td></tr>' +
    '<tr><td style="padding:18px 30px 0;"><div style="background:#2d2a26;color:#ffffff;' + F + 'font-size:15px;font-weight:bold;padding:12px 16px;letter-spacing:0.5px;">' +
    e(property.toUpperCase()) + (span ? ' <span style="font-weight:normal;color:#cfcdca;">&middot; ' + e(span) + '</span>' : '') + '</div></td></tr>' +
    '<tr><td style="padding:18px 30px 30px;">' + inner +
    '<p style="margin:26px 0 0;' + F + 'font-size:11px;line-height:1.6;color:#999999;">Prepared for Ovation Property Management by City Wide Facility Solutions. GoCityWide.com</p>' +
    '</td></tr></table></td></tr></table>';
}

// ------------------------------------------------ server-side PDF (HTML to PDF) --
// Same content as the browser-built PDF on review.html, built here when the FSM never built one.
// Photos come from the Drive folder and are embedded as data URIs. The converter has an
// unpublished size ceiling, so on failure it retries with half the photos (NightInspection.gs pattern).
function ovLogoData_(key, url) {
  var cache = null;
  try { cache = CacheService.getScriptCache(); var hit = cache.get(key); if (hit) return hit; } catch (e) { cache = null; }
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return '';
    var ct = String(res.getHeaders()['Content-Type'] || 'image/png').split(';')[0];
    var data = 'data:' + ct + ';base64,' + Utilities.base64Encode(res.getContent());
    if (cache && data.length < 95000) { try { cache.put(key, data, 21600); } catch (e2) {} }
    return data;
  } catch (e3) { return ''; }
}
function ovPhotoFiles_(type, id) {
  var files = {};
  try {
    var it = ovFolderFor_(type).searchFiles("title contains '" + id + "_ph_' and trashed = false");
    while (it.hasNext()) { var f = it.next(); var mm = f.getName().match(/_(ph_[\w-]+)\.jpg$/); if (mm) files[mm[1]] = f; }
  } catch (e) {}
  return files;
}
function ovBuildPdf_(type, doc, by) {
  var e = ovEsc_;
  var files = ovPhotoFiles_(type, String(doc.id));
  var photoData = {};
  function pdata(pid) {
    if (photoData[pid] !== undefined) return photoData[pid];
    var f = files[pid]; var out = '';
    if (f) { try { out = 'data:image/jpeg;base64,' + Utilities.base64Encode(f.getBlob().getBytes()); } catch (e2) { out = ''; } }
    photoData[pid] = out; return out;
  }
  var cw = ovLogoData_('ov_logo_cw', (typeof LOGO !== 'undefined') ? LOGO : 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png');
  var ov = ovLogoData_('ov_logo_ov', OV_LOGO_OV);
  var isCheck = type === 'checklist';
  var prop = ovPropIndex_()[String(doc.property || '').trim().toLowerCase()] || {};
  var title = isCheck ? 'Day Porter Daily Service Report' : (/request/i.test(String(doc.mode || '')) ? 'Work Request' : 'Service Report');
  var css = '<style>body{font-family:Verdana,Geneva,sans-serif;font-size:10.5px;color:#2D2A26;margin:26px 30px}' +
    'table{border-collapse:collapse}.hd{width:100%}.hd td{vertical-align:middle}' +
    'h1{font-size:17px;margin:14px 0 2px;color:#2D2A26}h2{font-size:12px;margin:14px 0 4px;padding:0 0 3px 6px;border-left:4px solid #D22730;color:#2D2A26}' +
    '.rule{height:3px;background:#D22730;margin:6px 0 10px}.ttl{font-size:12px;font-weight:bold;margin-top:6px}.sub{font-size:9px;color:#636466}' +
    '.meta td{padding:2px 8px 2px 0;font-size:10px}.meta td.k{color:#636466;width:120px}.meta td.v{font-weight:bold}' +
    '.tasks{width:100%}.tasks td{padding:2px 4px;font-size:10px;vertical-align:top;border-bottom:1px solid #eeeeee}.tasks td.s{width:72px;color:#636466;white-space:nowrap}' +
    '.tasks td.s.ok{color:#1f8a4c;font-weight:bold}.tasks td.s.no{color:#D22730;font-weight:bold}.note{font-style:italic;color:#636466;margin:4px 0 0}' +
    '.ph{width:100%;margin-top:6px}.ph td{width:50%;padding:3px;vertical-align:top}.ph img{width:100%;max-height:230px;border:1px solid #ddd}' +
    '.para{white-space:pre-wrap;line-height:1.45}.foot{margin-top:16px;font-size:8.5px;color:#636466;border-top:1px solid #ddd;padding-top:6px}' +
    '</style>';
  var head = '<table class="hd"><tr><td>' + (cw ? '<img src="' + cw + '" style="height:30px">' : '<b>City Wide Facility Solutions</b>') + '</td><td style="text-align:right">' + (ov ? '<img src="' + ov + '" style="height:28px">' : '<b>Ovation Property Management</b>') + '</td></tr></table>' +
    '<div class="ttl">' + e(title) + ' <span class="sub" style="float:right;font-weight:normal">Prepared for Ovation Property Management by City Wide Facility Solutions</span></div><div class="rule"></div>';
  function metaRows(pairs) { return '<table class="meta">' + pairs.filter(function (p) { return p[1]; }).map(function (p) { return '<tr><td class="k">' + e(p[0]) + '</td><td class="v">' + e(p[1]) + '</td></tr>'; }).join('') + '</table>'; }
  var sections = [];   // each: { html, photos:[pid...] } so a retry can drop photos evenly
  var html = head;
  if (isCheck) {
    var areasIn = (doc.areas || []).filter(function (a) { return !a.na; });
    var tDone = 0, tAll = 0; areasIn.forEach(function (a) { (a.tasks || []).forEach(function (t) { if (t.f === 'daily') { tAll++; if (t.done) tDone++; } }); });
    var passes = (doc.passes || []).filter(function (p) { return p.done; }).map(function (p) { return String(p.t).replace(/\s*\(.*\)$/, ''); });
    html += '<h1>' + e(doc.property) + '</h1>' + metaRows([['Date', (doc.weekday ? doc.weekday + ', ' : '') + doc.service_date], ['Address', prop.address], ['Porter', doc.porter],
      ['Shift', doc.shift_start ? doc.shift_start + (doc.shift_end ? ' to ' + doc.shift_end : '') : ''], ['Areas serviced', areasIn.length + ' of ' + (doc.areas || []).length],
      ['Daily tasks', tDone + ' of ' + tAll + ' completed'], ['Passes', passes.join(', ')]]);
    if (doc.fsm_notes) html += '<h2>Note from City Wide</h2><div class="para">' + e(doc.fsm_notes) + '</div>';
    areasIn.forEach(function (a) {
      var daily = (a.tasks || []).filter(function (t) { return t.f === 'daily'; }), extra = (a.tasks || []).filter(function (t) { return t.f !== 'daily' && t.done; });
      var s = '<h2>' + e(a.name) + ' <span class="sub">' + daily.filter(function (t) { return t.done; }).length + ' of ' + daily.length + ' daily tasks</span></h2><table class="tasks">' +
        daily.map(function (t) { return '<tr><td class="s ' + (t.done ? 'ok' : 'no') + '">' + (t.done ? 'Done' : 'Not done') + '</td><td>' + e(t.t) + '</td></tr>'; }).join('') +
        extra.map(function (t) { return '<tr><td class="s ok">Done</td><td>' + e(t.t) + ' <span class="sub">(' + (t.f === 'weekly' ? 'weekly' : 'monthly') + ')</span></td></tr>'; }).join('') + '</table>' +
        (a.floors ? '<div class="sub" style="margin-top:3px">Floors: <b>' + e(a.floors) + '</b></div>' : '') + (a.note ? '<div class="note">Note: ' + e(a.note) + '</div>' : '');
      sections.push({ html: s, photos: (a.photos || []).map(function (p) { return p.pid; }) });
    });
    var left = (doc.areas || []).filter(function (a) { return a.na; });
    if (left.length) sections.push({ html: '<h2>Not serviced today</h2><div class="sub">' + e(left.map(function (a) { return a.name; }).join(', ')) + '</div>', photos: [] });
    if (doc.followups || (doc.followup_tags || []).length || (doc.photos || []).length) {
      sections.push({ html: '<h2>Reported to the property</h2>' + ((doc.followup_tags || []).length ? '<div><b>' + e(doc.followup_tags.join(' | ')) + '</b></div>' : '') + (doc.followups ? '<div class="para">' + e(doc.followups) + '</div>' : ''), photos: (doc.photos || []).map(function (p) { return p.pid; }) });
    }
    if (doc.supplies) sections.push({ html: '<h2>Supplies running low</h2><div class="para">' + e(doc.supplies) + '</div>', photos: [] });
  } else {
    html += '<h1>' + e(doc.property) + '</h1>' + metaRows([['Submitted', ovNice_(doc.created_at)], ['Address', prop.address], ['From', [doc.submitter, doc.role].filter(Boolean).join(', ')],
      ['Contact', [doc.phone, doc.email].filter(Boolean).join('  |  ')], ['Type', String(doc.mode || '') + (doc.category ? ': ' + doc.category : '')], ['Where', doc.location], ['Urgency', doc.urgency]]);
    var det = '<h2>Details</h2>';
    if (doc.summary) det += '<div class="para"><b>' + e(doc.summary) + '</b></div>';
    (doc.answers || []).forEach(function (a) { var v = Array.isArray(a.a) ? a.a.join(', ') : a.a; if (!v) return; det += '<div class="sub" style="margin-top:6px">' + e(a.q) + '</div><div><b>' + e(v) + '</b></div>'; });
    if (doc.notes) det += '<div class="sub" style="margin-top:6px">Anything else</div><div class="para">' + e(doc.notes) + '</div>';
    sections.push({ html: det, photos: [] });
    if ((doc.photos || []).length) sections.push({ html: '<h2>Photos</h2>', photos: doc.photos.map(function (p) { return p.pid; }) });
    if (doc.response) sections.push({ html: '<h2>City Wide response</h2><div class="para">' + e(doc.response) + '</div>', photos: [] });
    if (doc.fsm_notes) sections.push({ html: '<h2>Note from City Wide</h2><div class="para">' + e(doc.fsm_notes) + '</div>', photos: [] });
  }
  var foot = '<div class="foot">Reviewed by ' + e(by || 'City Wide Facility Solutions') + ' on ' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMMM d, yyyy') + '. Reference ' + e(doc.id) + '.<br>City Wide Facility Solutions | 3215 W Charleston Blvd, Suite 130, Las Vegas, NV 89102 | 702-483-1874 | LasVegas.GoCityWide.com</div></body></html>';
  function photosHtml(pids, cap) {
    var list = pids.map(pdata).filter(Boolean).slice(0, cap);
    if (!list.length) return '';
    var h = '<table class="ph"><tr>';
    list.forEach(function (src, i) { if (i && i % 2 === 0) h += '</tr><tr>'; h += '<td><img src="' + src + '"></td>'; });
    if (list.length % 2 === 1) h += '<td></td>';
    return h + '</tr></table>';
  }
  var most = 0; sections.forEach(function (s) { most = Math.max(most, s.photos.length); });
  var cap = Math.max(most, 1), blob = null, lastErr = null;
  var name = (isCheck ? 'Porter Report - ' : 'City Wide Report - ') + String(doc.property) + ' - ' + (isCheck ? doc.service_date : String(doc.created_at || '').slice(0, 10)) + '.pdf';
  name = name.replace(/[\\/:*?"<>|]/g, '-');
  for (var attempt = 0; attempt < 4 && !blob; attempt++) {
    var full = '<!doctype html><html><head><meta charset="utf-8">' + css + '</head><body>' + html + sections.map(function (s) { return s.html + photosHtml(s.photos, cap); }).join('') + foot;
    try { blob = Utilities.newBlob(full, 'text/html', name.replace(/\.pdf$/, '.html')).getAs('application/pdf').setName(name); }
    catch (pe) { lastErr = pe; if (cap <= 0) break; cap = Math.floor(cap / 2); }
  }
  if (!blob) throw lastErr || new Error('PDF conversion failed');
  return blob;
}
// Run helper: builds one PDF without a page, so the converter can be proven from the editor.
function ovBuildPdfRun(id) {
  id = id || '';
  var type = ovTypeOf_(id); if (!type) throw new Error('pass an ovc_/ovr_ id');
  var sh = ovSheetFor_(type), headers = ovHeadersFor_(type), r = ovFindRow_(sh, id);
  var doc = JSON.parse(DriveApp.getFileById(String(sh.getRange(r, headers.indexOf('json_file') + 1).getValue())).getBlob().getDataAsString());
  var blob = ovBuildPdf_(type, doc, 'Editor test');
  var f = ovStorePdf_(type, sh, headers, r, blob);
  Logger.log('PDF ' + f.getName() + ' ' + blob.getBytes().length + ' bytes ' + f.getUrl());
}

// Run helper (Runner.gs cwRunNow pattern): provisions the book and folder without a page.
function ovProvisionRun() {
  ovReports_(); ovChecks_(); ovProps_(); ovConfigTab_(); ovConfigEnsure_();
  Logger.log('CW Ovation Hub book: ' + ovSS_().getUrl());
  Logger.log('CW Ovation Hub folder: ' + ovFolder_().getUrl());
}
