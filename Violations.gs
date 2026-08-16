// ============================================================
// Violations.gs - IC violation notices (added Aug 2026)
// New FILE in the CW Solicitations Apps Script project.
// Routing: doPost wrapper routes any kind starting 'vio_' to vioDispatch(data).
// Kinds: vio_setup, vio_seed, vio_roster, vio_submit  (all POST, passcode-gated)
// Safety: while Config live != TRUE, every send is forced to TEST mode:
//   recipient becomes lvservicecall@gocitywide.com and subject is prefixed TEST.
// Sender: LV -> MailApp from this account, display name "No Reply at City Wide".
//   NNV -> relay POST to the Reno account's web app (VIO_RENO_URL + VIO_SECRET).
//   If the Reno relay is not configured, NNV sends fall back to LV sending and
//   the response flags relay_missing so the page can warn.
// ============================================================

var VIO_TABS = { LOG: 'Notices', ROSTER: 'Roster', ISSUERS: 'Issuers', CONFIG: 'Config', DD: 'Dropdowns' };

var VIO_LOG_HEADERS = [
  'notice_id', 'issued', 'test', 'market', 'level', 'nature', 'issuer_name', 'issuer_email',
  'ic_dba', 'ic_owner', 'ic_email', 'vendor_no', 'account', 'inspection_date',
  'findings_summary', 'findings_json', 'cure_text', 'chargeback_amount', 'chargeback_reason',
  'fsm_name', 'doo_name', 'email_status', 'status', 'corrected_date', 'notes', 'source', 'photos',
  'approve_token', 'approver_email', 'approved_by', 'approved_date', 'payload_json'
];

var VIO_ROSTER_HEADERS = ['market', 'dba', 'owner', 'email', 'legal_name', 'vendor_no', 'ic_type', 'status', 'hide'];
var VIO_ISSUER_HEADERS = ['name', 'email', 'active'];
var VIO_DD_HEADERS = ['type_key', 'type_label', 'hint', 'item'];

var VIO_DD_SEED = [
  ['chemicals', 'Incorrect or non-compliant chemicals', 'OSHA hazard communication. The formal one.', 'Unlabeled chemical container on site'],
  ['chemicals', '', '', 'Chemical not on the client approved list'],
  ['chemicals', '', '', 'SDS sheet missing from the janitor closet'],
  ['chemicals', '', '', 'Improper secondary container or dilution'],
  ['chemicals', '', '', 'Prohibited chemical used on a protected surface'],
  ['chemicals', '', '', 'Other (describe in the details box)'],
  ['background', 'Person without a background check', 'Person may work pending results only after the request is submitted.', 'Person on site with no approved background check on file'],
  ['background', '', '', 'Unreported new crew member working the account'],
  ['background', '', '', 'No badge issued for a person on site'],
  ['background', '', '', 'Other (describe in the details box)'],
  ['unauthorized', 'Unauthorized person on site', 'People who are not crew at all. A badge is what authorizes presence in a client building.', 'Person on site who is not an employee of the IC (friend, family member, or other non-crew person)'],
  ['unauthorized', '', '', 'Crew member brought a helper or guest not reported to City Wide'],
  ['unauthorized', '', '', 'Person on site refused or was unable to identify themselves'],
  ['unauthorized', '', '', 'Person remained on site after being denied access or asked to leave'],
  ['unauthorized', '', '', 'Other (describe in the details box)'],
  ['ineligible', 'Person not cleared to work City Wide accounts', 'Screening based. The finding is clearance, never the person\'s history. Do not name records in the details.', 'Person working after background screening returned disqualifying results'],
  ['ineligible', '', '', 'Person previously denied a badge found working a City Wide account'],
  ['ineligible', '', '', 'Person removed from an account found back on a City Wide site'],
  ['ineligible', '', '', 'Person appears to have been screened under a different name or identity'],
  ['ineligible', '', '', 'Other (describe in the details box)'],
  ['minor', 'Person under 18 on site', 'Labor law. Zero tolerance; suggested level starts at 2.', 'Person under the age of 18 performing work at the account'],
  ['minor', '', '', 'Person under the age of 18 present during service (including children of crew members)'],
  ['minor', '', '', 'Other (describe in the details box)'],
  ['uniform', 'Uniform or badge violation', 'Badges and uniforms are required in every client building.', 'Crew member out of uniform'],
  ['uniform', '', '', 'No City Wide badge worn'],
  ['uniform', '', '', 'No photo ID matching the badge'],
  ['uniform', '', '', 'Other (describe in the details box)'],
  ['scope', 'Scope of work not executed', 'Measured against the Exhibit A scope.', 'Area not cleaned'],
  ['scope', '', '', 'Contracted task not performed'],
  ['scope', '', '', 'Building not finaled'],
  ['scope', '', '', 'Missed service entirely'],
  ['scope', '', '', 'Other (describe in the details box)'],
  ['meeting', 'Missed meeting or scheduled inspection', 'Communication Guidelines: 15-minute grace, then $55.38 per hour or portion thereof.', 'Failed to meet the Night Manager at the scheduled time'],
  ['meeting', '', '', 'Failed to meet the Facility Solutions Manager at the scheduled time'],
  ['meeting', '', '', 'Failed to appear for a scheduled corrective action meeting with the FSM'],
  ['meeting', '', '', 'Work not complete when the Night Manager arrived for a scheduled inspection'],
  ['meeting', '', '', 'Other (describe in the details box)'],
  ['availability', 'Availability or communication failure', 'Start-of-shift availability and the one-hour callback are in the signed Communication Guidelines.', 'Not reachable at the start of the service period to speak with the Night Manager'],
  ['availability', '', '', 'Night Manager call or message not returned within one hour'],
  ['availability', '', '', 'No reachable supervisor with decision-making authority while crew was on site'],
  ['availability', '', '', 'Other (describe in the details box)'],
  ['complaint', 'Complaint response failure', 'The complaint itself is not the violation. Failing to respond, resolve, or verify per policy is.', 'No response to a complaint notification'],
  ['complaint', '', '', 'Complaint not resolved by 10:00 PM the next service period'],
  ['complaint', '', '', 'Complaint still unresolved past 24 hours'],
  ['complaint', '', '', 'Failed to meet the acting Night Manager to verify complaint resolution'],
  ['complaint', '', '', 'Other (describe in the details box)'],
  ['security', 'Security, property, or confidentiality violation', 'Material term. The signed policy allows immediate termination without opportunity to cure.', 'Facility not secured; doors or entry points left unlocked'],
  ['security', '', '', 'Client property removed without written authorization'],
  ['security', '', '', 'Client information accessed, photographed, or shared'],
  ['security', '', '', 'Keys or access cards lost, uncontrolled, or not returned'],
  ['security', '', '', 'Account work delegated or subcontracted without written authorization'],
  ['security', '', '', 'Refused or failed to cooperate with a compliance inspection or audit'],
  ['security', '', '', 'Other (describe in the details box)']
];

var VIO_SRC_SEED = [
  ['source', 'How was this documented', 'Named in the vendor email only for our own inspections.', 'Night Manager inspection'],
  ['source', '', '', 'FSM inspection'],
  ['source', '', '', 'Customer email'],
  ['source', '', '', 'Customer phone call'],
  ['source', '', '', 'Customer walkthrough'],
  ['source', '', '', 'Other']
];

var VIO_REGION_SERVICE = {
  'Las Vegas': 'lvservicecall@gocitywide.com',
  'Northern Nevada': 'rnservicecall@gocitywide.com'
};
var VIO_TEST_TO = 'lvservicecall@gocitywide.com';
var VIO_SENDER_NAME = 'No Reply at City Wide';
var VIO_LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
var VIO_BG_LINK = 'https://form.asana.com/?k=FRCnQmbTGjAVPieFt4bnWQ&d=13140959242873';
var VIO_HUB_PAPERWORK = 'https://citywidelv.github.io/cw-vendor-shop/new-vendors.html';
var VIO_APPROVE_URL = 'https://citywidelv.github.io/cw-ops-desk/violation-approve.html';
var VIO_DEFAULT_APPROVERS = [
  ['approver_lv', 'rkrause@gocitywide.com'],
  ['approver_nnv', 'tjroberts@gocitywide.com']
];

function vioPass_() {
  try { if (typeof PASSCODE !== 'undefined') return PASSCODE; } catch (e) {}
  return PropertiesService.getScriptProperties().getProperty('PASSCODE') || '';
}

function vioDispatch(data) {
  var kind = String(data.kind || '');
  // Approval-page kinds are keyed by their one-time token, not the team passcode.
  if (kind === 'vio_pending') return vioPending_(data);
  if (kind === 'vio_approve') return vioApprove_(data);
  if (kind === 'vio_discard') return vioDiscard_(data);
  if ((data.passcode || '') !== vioPass_()) return _json({ ok: false, error: 'Bad passcode' });
  if (kind === 'vio_setup') return vioSetup_(data);
  if (kind === 'vio_seed') return vioSeed_(data);
  if (kind === 'vio_ddsync') return vioDdSync_(data);
  if (kind === 'vio_roster') return vioRoster_(data);
  if (kind === 'vio_submit') return vioSubmit_(data);
  if (kind === 'vio_photo') return vioPhoto_(data);
  return _json({ ok: false, error: 'Unknown vio kind' });
}

// Rewrites the Dropdowns tab from the seed so type order matches the seed order.
function vioDdSync_(data) {
  var sh = vioSS_().getSheetByName(VIO_TABS.DD);
  var rows = VIO_DD_SEED.concat(VIO_SRC_SEED);
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, VIO_DD_HEADERS.length).clearContent();
  }
  sh.getRange(2, 1, rows.length, VIO_DD_HEADERS.length).setValues(rows);
  return _json({ ok: true, rows: rows.length });
}

function vioSS_() {
  var id = PropertiesService.getScriptProperties().getProperty('VIO_SHEET_ID');
  if (!id) throw new Error('Run vio_setup first (no VIO_SHEET_ID)');
  return SpreadsheetApp.openById(id);
}

function vioSetup_(data) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('VIO_SHEET_ID');
  var ss;
  if (id) { ss = SpreadsheetApp.openById(id); }
  else {
    ss = SpreadsheetApp.create('CW Violation Notices');
    props.setProperty('VIO_SHEET_ID', ss.getId());
    try {
      var folders = DriveApp.getFoldersByName('Ops Hub');
      if (folders.hasNext()) {
        DriveApp.getFileById(ss.getId()).moveTo(folders.next());
      }
    } catch (e) {}
  }
  function tab(name, headers, color) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground(color).setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    return sh;
  }
  var log = tab(VIO_TABS.LOG, VIO_LOG_HEADERS, '#D22730');
  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  log.getRange(2, VIO_LOG_HEADERS.indexOf('test') + 1, 999, 1).setDataValidation(rule);
  tab(VIO_TABS.ROSTER, VIO_ROSTER_HEADERS, '#2D2A26');
  var isr = tab(VIO_TABS.ISSUERS, VIO_ISSUER_HEADERS, '#636466');
  if (isr.getLastRow() < 2) {
    isr.getRange(2, 1, 8, 3).setValues([
      ['TJ Roberts', 'tjroberts@gocitywide.com', 'TRUE'],
      ['Jake Schmidt', '', 'TRUE'],
      ['Alex Manon', '', 'TRUE'],
      ['Brett Stephens', '', 'TRUE'],
      ['Robert Krause', '', 'TRUE'],
      ['Sam Morse', '', 'TRUE'],
      ['Jeremy Walker', '', 'TRUE'],
      ['Joshua Smith', '', 'TRUE']
    ]);
  }
  var dd = tab(VIO_TABS.DD, VIO_DD_HEADERS, '#636466');
  if (dd.getLastRow() < 2) {
    dd.getRange(2, 1, VIO_DD_SEED.length, 4).setValues(VIO_DD_SEED);
  }
  var ddVals = dd.getDataRange().getValues();
  var ddHave = {};
  for (var di = 1; di < ddVals.length; di++) { ddHave[String(ddVals[di][0]).trim()] = true; }
  var ddAdd = [];
  VIO_DD_SEED.concat(VIO_SRC_SEED).forEach(function (r) {
    if (!ddHave[String(r[0])]) ddAdd.push(r);
  });
  if (ddAdd.length) {
    dd.getRange(dd.getLastRow() + 1, 1, ddAdd.length, 4).setValues(ddAdd);
  }
  var cfg = tab(VIO_TABS.CONFIG, ['key', 'value'], '#636466');
  if (cfg.getLastRow() < 2) {
    cfg.getRange(2, 1, 6, 2).setValues([
      ['live', 'FALSE'],
      ['doo_name', 'Robert Krause'],
      ['doo_nnv', 'Jeremy Walker'],
      ['chargeback_rate', '25'],
      ['chargeback_min_hours', '2'],
      ['background_link', VIO_BG_LINK]
    ]);
  }
  // Sync any missing config keys (idempotent), e.g. the market approvers.
  var cfgVals = cfg.getDataRange().getValues();
  var cfgHave = {};
  for (var ci = 1; ci < cfgVals.length; ci++) { cfgHave[String(cfgVals[ci][0]).trim()] = true; }
  var cfgAdd = VIO_DEFAULT_APPROVERS.filter(function (p) { return !cfgHave[p[0]]; });
  if (cfgAdd.length) {
    cfg.getRange(cfg.getLastRow() + 1, 1, cfgAdd.length, 2).setValues(cfgAdd);
  }
  var first = ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 4) ss.deleteSheet(first);
  return _json({ ok: true, sheet_id: ss.getId(), url: ss.getUrl() });
}

function vioPhoto_(data) {
  if (!data.data || !data.name) return _json({ ok: false, error: 'Missing photo data' });
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('VIO_PHOTO_FOLDER');
  var folder;
  if (folderId) {
    try { folder = DriveApp.getFolderById(folderId); } catch (e) { folder = null; }
  }
  if (!folder) {
    folder = DriveApp.createFolder('CW Violation Photos');
    props.setProperty('VIO_PHOTO_FOLDER', folder.getId());
  }
  var bytes = Utilities.base64Decode(String(data.data));
  var blob = Utilities.newBlob(bytes, String(data.mime || 'image/jpeg'), String(data.name));
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var id = file.getId();
  return _json({ ok: true, id: id,
    img: 'https://drive.google.com/uc?export=view&id=' + id,
    view: 'https://drive.google.com/file/d/' + id + '/view' });
}

function vioRecipients_(raw) {
  return String(raw || '').split(/[,;]+/).map(function (s) { return s.trim(); })
    .filter(function (s) { return s.indexOf('@') > 0; }).join(',');
}

function vioSeed_(data) {
  var rows = data.rows || [];
  if (!rows.length) return _json({ ok: false, error: 'No rows' });
  var sh = vioSS_().getSheetByName(VIO_TABS.ROSTER);
  var out = rows.map(function (r) {
    return VIO_ROSTER_HEADERS.map(function (h, i) { return r[i] !== undefined ? String(r[i]) : ''; });
  });
  sh.getRange(sh.getLastRow() + 1, 1, out.length, VIO_ROSTER_HEADERS.length).setValues(out);
  return _json({ ok: true, added: out.length });
}

function vioConfig_(ss) {
  var vals = ss.getSheetByName(VIO_TABS.CONFIG).getDataRange().getValues();
  var cfg = {};
  for (var i = 1; i < vals.length; i++) cfg[String(vals[i][0])] = String(vals[i][1]);
  return cfg;
}

function vioKey_(dba, vendorNo) {
  var v = String(vendorNo || '').trim();
  return v && v !== 'TEST' ? 'v:' + v : 'd:' + String(dba || '').trim().toLowerCase();
}

function vioRoster_(data) {
  var ss = vioSS_();
  var rv = ss.getSheetByName(VIO_TABS.ROSTER).getDataRange().getValues();
  var roster = [];
  for (var i = 1; i < rv.length; i++) {
    if (String(rv[i][8]).toUpperCase() === 'TRUE') continue; // hide
    if (!rv[i][1]) continue;
    roster.push({
      market: rv[i][0], dba: rv[i][1], owner: rv[i][2], email: rv[i][3],
      vendor_no: rv[i][5], ic_type: rv[i][6], status: rv[i][7]
    });
  }
  var iv = ss.getSheetByName(VIO_TABS.ISSUERS).getDataRange().getValues();
  var issuers = [];
  for (var j = 1; j < iv.length; j++) {
    if (String(iv[j][2]).toUpperCase() !== 'TRUE') continue;
    if (!iv[j][0]) continue;
    issuers.push({ name: iv[j][0], email: iv[j][1] });
  }
  // prior notices per vendor, last 365 days, excluding test rows
  var lv = ss.getSheetByName(VIO_TABS.LOG).getDataRange().getValues();
  var hist = {};
  var cutoff = Date.now() - 365 * 24 * 3600 * 1000;
  var stIdx = VIO_LOG_HEADERS.indexOf('status');
  for (var k = 1; k < lv.length; k++) {
    var row = lv[k];
    if (!row[0]) continue;
    if (row[2] === true || String(row[2]).toUpperCase() === 'TRUE') continue;
    var st = String(row[stIdx] || '');
    if (st === 'Pending approval' || st === 'Discarded') continue; // not issued notices
    var when = row[1] instanceof Date ? row[1].getTime() : Date.parse(row[1]);
    if (!(when > cutoff)) continue;
    var key = vioKey_(row[8], row[11]);
    if (!hist[key]) hist[key] = [];
    hist[key].push({
      notice_id: row[0],
      issued: row[1] instanceof Date ? Utilities.formatDate(row[1], 'America/Los_Angeles', 'MMM d, yyyy') : String(row[1]),
      level: row[4], account: row[12], summary: row[14]
    });
  }
  // dropdowns
  var dv = ss.getSheetByName(VIO_TABS.DD).getDataRange().getValues();
  var dropdowns = [];
  var byKey = {};
  for (var q = 1; q < dv.length; q++) {
    var ddkey = String(dv[q][0]).trim();
    if (!ddkey || !dv[q][3]) continue;
    if (!byKey[ddkey]) {
      byKey[ddkey] = { type: ddkey, label: String(dv[q][1] || ddkey), hint: String(dv[q][2] || ''), items: [] };
      dropdowns.push(byKey[ddkey]);
    }
    if (dv[q][1] && !byKey[ddkey].labelSet) { byKey[ddkey].label = String(dv[q][1]); byKey[ddkey].labelSet = true; }
    byKey[ddkey].items.push(String(dv[q][3]));
  }
  var cfg = vioConfig_(ss);
  return _json({ ok: true, roster: roster, issuers: issuers, history: hist, dropdowns: dropdowns, config: {
    live: cfg.live, doo_name: cfg.doo_name, doo_nnv: cfg.doo_nnv,
    chargeback_rate: cfg.chargeback_rate, chargeback_min_hours: cfg.chargeback_min_hours,
    background_link: cfg.background_link,
    approver_lv: cfg.approver_lv || '', approver_nnv: cfg.approver_nnv || ''
  } });
}

// ------------------------------------------------------------ submit -----
function vioSubmit_(d) {
  var ss = vioSS_();
  var cfg = vioConfig_(ss);
  var live = String(cfg.live).toUpperCase() === 'TRUE';
  var test = !live || d.test === true || String(d.test).toUpperCase() === 'TRUE';

  if (!d.market || !d.ic || !d.ic.dba || !d.issuer_name || !d.account ||
      !(d.findings && d.findings.length)) {
    return _json({ ok: false, error: 'Missing required fields' });
  }
  var notify = vioRecipients_(d.notify_email || (d.ic && d.ic.email));
  if (!test && !notify) return _json({ ok: false, error: 'No valid notification email' });

  var prefix = d.market === 'Northern Nevada' ? 'NNV' : 'LV';
  var nid = 'VN-' + prefix + '-' +
    Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd') + '-' +
    Math.random().toString(36).slice(2, 5).toUpperCase();

  var level = Number(d.level) || 1;
  var html = vioEmail_(nid, d, cfg, level, test);
  var subjBase = (level === 3 ? 'Final Notice of Non-Compliance' :
    level === 2 ? 'Second Notice of Non-Compliance' : 'Notice of Non-Compliance') +
    ' | ' + d.account + ' | ' +
    Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d, yyyy');
  var subject = (test ? 'TEST | ' : '') + subjBase;

  // Approval step: nothing goes to the vendor from here. The notice is stored as
  // Pending approval and the market approver (Config: approver_lv / approver_nnv)
  // gets a review link keyed by a one-time token.
  var token = Utilities.getUuid().replace(/-/g, '') + Math.random().toString(36).slice(2, 10);
  var approver = d.market === 'Northern Nevada' ? (cfg.approver_nnv || '') : (cfg.approver_lv || '');
  if (!approver) approver = VIO_TEST_TO;
  var approveLink = VIO_APPROVE_URL + '?t=' + token;
  var apprSubject = (test ? 'TEST | ' : '') + 'Approval required | ' +
    (level === 3 ? 'Final notice' : level === 2 ? 'Second notice' : 'Notice') +
    ' | ' + d.ic.dba + ' | ' + d.account;
  var apprTo = test ? VIO_TEST_TO : approver;
  var emailStatus = '';
  try {
    MailApp.sendEmail({ to: apprTo, subject: apprSubject,
      htmlBody: vioApprovalEmail_(nid, d, level, test, approveLink, html, approver),
      name: VIO_SENDER_NAME,
      body: 'Notice ' + nid + ' is awaiting approval. Review at ' + approveLink });
    emailStatus = test ? 'TEST approval request sent to ' + VIO_TEST_TO :
      'awaiting approval by ' + approver;
  } catch (mailErr) {
    emailStatus = 'APPROVAL SEND FAILED: ' + String(mailErr);
  }

  var summary = (d.findings || []).map(function (f) {
    return f.label + (f.items && f.items.length ? ' (' + f.items.join('; ') + ')' : '');
  }).join(' | ');

  var sh = ss.getSheetByName(VIO_TABS.LOG);
  var row = VIO_LOG_HEADERS.map(function (h) {
    switch (h) {
      case 'notice_id': return nid;
      case 'issued': return new Date();
      case 'test': return test;
      case 'market': return d.market;
      case 'level': return level;
      case 'nature': return d.nature || '';
      case 'issuer_name': return d.issuer_name || '';
      case 'issuer_email': return d.issuer_email || '';
      case 'ic_dba': return d.ic.dba || '';
      case 'ic_owner': return d.ic.owner || '';
      case 'ic_email': return notify || d.ic.email || '';
      case 'vendor_no': return d.ic.vendor_no || '';
      case 'account': return d.account || '';
      case 'inspection_date': return d.inspection_date || '';
      case 'findings_summary': return summary;
      case 'findings_json': return JSON.stringify(d.findings || []);
      case 'cure_text': return d.cure_text || '';
      case 'chargeback_amount': return level === 2 ? (Number(d.chargeback_amount) || '') : '';
      case 'chargeback_reason': return d.chargeback_reason || '';
      case 'fsm_name': return d.fsm_name || '';
      case 'doo_name': return d.doo_name || cfg.doo_name || '';
      case 'email_status': return emailStatus;
      case 'status': return 'Pending approval';
      case 'source': return d.source || '';
      case 'photos': return (d.photos || []).map(function (p) { return p.view || p.img || ''; }).join('\n');
      case 'approve_token': return token;
      case 'approver_email': return approver;
      case 'payload_json': return (function () {
        var clean = JSON.parse(JSON.stringify(d));
        delete clean.passcode; delete clean.kind;
        return JSON.stringify(clean);
      })();
      default: return '';
    }
  });
  var nextRow = _nextRow(sh);
  sh.getRange(nextRow, 1, 1, row.length).setValues([row]);
  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sh.getRange(nextRow, VIO_LOG_HEADERS.indexOf('test') + 1).setDataValidation(rule).setValue(test);

  return _json({ ok: true, notice_id: nid, test: test, pending: true,
    approver: approver, email_status: emailStatus });
}

// ------------------------------------------------------- approval flow -----
function vioSendVendor_(market, test, to, cc, replyTo, subject, html, nid) {
  var emailStatus = '';
  var relayMissing = false;
  if (market === 'Northern Nevada' && !test) {
    var relayUrl = PropertiesService.getScriptProperties().getProperty('VIO_RENO_URL');
    var relaySecret = PropertiesService.getScriptProperties().getProperty('VIO_SECRET');
    if (relayUrl && relaySecret) {
      var resp = UrlFetchApp.fetch(relayUrl, {
        method: 'post', contentType: 'text/plain',
        payload: JSON.stringify({ secret: relaySecret, to: to, cc: cc, replyTo: replyTo,
          subject: subject, htmlBody: html, name: VIO_SENDER_NAME }),
        muteHttpExceptions: true, followRedirects: true
      });
      var rj = {}; try { rj = JSON.parse(resp.getContentText()); } catch (pe) {}
      if (rj.ok) { emailStatus = 'sent via Reno'; }
      else { emailStatus = 'RELAY FAILED, sent from LV'; relayMissing = true; }
    } else { relayMissing = true; }
    if (relayMissing) {
      MailApp.sendEmail({ to: to, cc: cc, replyTo: replyTo, subject: subject,
        htmlBody: html, name: VIO_SENDER_NAME,
        body: 'Notice ' + nid + '. Open in an HTML mail client.' });
      emailStatus = emailStatus === 'RELAY FAILED, sent from LV' ? emailStatus :
        'sent from LV (no Reno relay configured)';
    }
  } else {
    MailApp.sendEmail({ to: to, cc: cc, replyTo: replyTo, subject: subject,
      htmlBody: html, name: VIO_SENDER_NAME,
      body: 'Notice ' + nid + '. Open in an HTML mail client.' });
    emailStatus = test ? 'TEST sent to ' + VIO_TEST_TO : 'sent';
  }
  return { emailStatus: emailStatus, relayMissing: relayMissing };
}

function vioTokenRow_(ss, token) {
  if (!token) return null;
  var sh = ss.getSheetByName(VIO_TABS.LOG);
  var vals = sh.getDataRange().getValues();
  var tIdx = VIO_LOG_HEADERS.indexOf('approve_token');
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][tIdx] || '') === String(token)) {
      return { sheet: sh, rowNum: i + 1, vals: vals[i] };
    }
  }
  return null;
}

function vioCell_(hit, header, value) {
  var c = VIO_LOG_HEADERS.indexOf(header) + 1;
  if (c > 0) hit.sheet.getRange(hit.rowNum, c).setValue(value);
}

function vioPending_(data) {
  var ss = vioSS_();
  var hit = vioTokenRow_(ss, data.token);
  if (!hit) return _json({ ok: false, error: 'No notice found for this link' });
  var H = function (h) { return hit.vals[VIO_LOG_HEADERS.indexOf(h)]; };
  var status = String(H('status') || '');
  var payload = {};
  try { payload = JSON.parse(String(H('payload_json') || '{}')); } catch (e) {}
  var test = H('test') === true || String(H('test')).toUpperCase() === 'TRUE';
  var level = Number(H('level')) || 1;
  var cfg = vioConfig_(ss);
  var html = '';
  try { html = vioEmail_(String(H('notice_id')), payload, cfg, level, test); } catch (e2) {
    return _json({ ok: false, error: 'Could not rebuild the notice: ' + e2 });
  }
  return _json({ ok: true, status: status, notice: {
    notice_id: H('notice_id'), market: H('market'), level: level, test: test,
    ic_dba: H('ic_dba'), ic_owner: H('ic_owner'), ic_email: H('ic_email'),
    account: H('account'), issuer_name: H('issuer_name'),
    issued: H('issued') instanceof Date ?
      Utilities.formatDate(H('issued'), 'America/Los_Angeles', 'MMM d, yyyy h:mm a') : String(H('issued')),
    approver_email: H('approver_email'), approved_by: H('approved_by'),
    findings_summary: H('findings_summary'), html: html
  } });
}

function vioApprove_(data) {
  var ss = vioSS_();
  var hit = vioTokenRow_(ss, data.token);
  if (!hit) return _json({ ok: false, error: 'No notice found for this link' });
  var H = function (h) { return hit.vals[VIO_LOG_HEADERS.indexOf(h)]; };
  var status = String(H('status') || '');
  if (status !== 'Pending approval') {
    return _json({ ok: false, error: 'This notice was already handled (status: ' + status + ')' });
  }
  var payload = {};
  try { payload = JSON.parse(String(H('payload_json') || '{}')); } catch (e) {}
  if (!payload.ic) return _json({ ok: false, error: 'Stored notice payload is unreadable' });
  var cfg = vioConfig_(ss);
  var test = H('test') === true || String(H('test')).toUpperCase() === 'TRUE';
  var level = Number(H('level')) || 1;
  var nid = String(H('notice_id'));
  var html = String(data.html || '');
  if (!html) { try { html = vioEmail_(nid, payload, cfg, level, test); } catch (e2) {} }
  if (!html) return _json({ ok: false, error: 'No notice body to send' });
  var notify = vioRecipients_(payload.notify_email || (payload.ic && payload.ic.email));
  if (!test && !notify) return _json({ ok: false, error: 'No valid vendor email on this notice' });
  var subjBase = (level === 3 ? 'Final Notice of Non-Compliance' :
    level === 2 ? 'Second Notice of Non-Compliance' : 'Notice of Non-Compliance') +
    ' | ' + H('account') + ' | ' +
    Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d, yyyy');
  var subject = (test ? 'TEST | ' : '') + subjBase;
  var to = test ? VIO_TEST_TO : notify;
  var cc = String(H('issuer_email') || '');
  var replyTo = VIO_REGION_SERVICE[H('market')] || VIO_REGION_SERVICE['Las Vegas'];
  var sent;
  try {
    sent = vioSendVendor_(String(H('market')), test, to, cc, replyTo, subject, html, nid);
  } catch (mailErr) {
    sent = { emailStatus: 'SEND FAILED: ' + String(mailErr), relayMissing: false };
  }
  vioCell_(hit, 'status', 'Open');
  vioCell_(hit, 'email_status', sent.emailStatus);
  vioCell_(hit, 'approved_by', String(data.approver_name || H('approver_email') || 'Director'));
  vioCell_(hit, 'approved_date', new Date());
  if (data.html) vioCell_(hit, 'notes', String(H('notes') || '') + (H('notes') ? ' | ' : '') + 'Body edited at approval');
  return _json({ ok: true, notice_id: nid, test: test, email_status: sent.emailStatus,
    relay_missing: sent.relayMissing });
}

function vioDiscard_(data) {
  var ss = vioSS_();
  var hit = vioTokenRow_(ss, data.token);
  if (!hit) return _json({ ok: false, error: 'No notice found for this link' });
  var H = function (h) { return hit.vals[VIO_LOG_HEADERS.indexOf(h)]; };
  var status = String(H('status') || '');
  if (status !== 'Pending approval') {
    return _json({ ok: false, error: 'This notice was already handled (status: ' + status + ')' });
  }
  vioCell_(hit, 'status', 'Discarded');
  vioCell_(hit, 'email_status', 'discarded at approval, never sent');
  vioCell_(hit, 'approved_by', String(H('approver_email') || ''));
  vioCell_(hit, 'approved_date', new Date());
  if (data.reason) vioCell_(hit, 'notes', String(H('notes') || '') + (H('notes') ? ' | ' : '') + 'Discard reason: ' + String(data.reason));
  return _json({ ok: true, notice_id: String(H('notice_id')), discarded: true });
}

function vioApprovalEmail_(nid, d, level, test, approveLink, noticeHtml, approver) {
  var meta = function (k, v) {
    return '<tr><td style="padding:2px 12px 2px 0;font-family:Verdana,Arial,sans-serif;font-size:12px;' +
      'color:#636466;white-space:nowrap;">' + k + '</td><td style="padding:2px 0;font-family:Verdana,' +
      'Arial,sans-serif;font-size:12px;color:#2d2a26;">' + v + '</td></tr>';
  };
  return '' +
    '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
    '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="660">' +
    (test ? '<tr><td style="background:#E5B423;padding:8px 30px;font-family:Verdana,Arial,sans-serif;font-size:12px;font-weight:bold;color:#2d2a26;">TEST. Routed to the service inbox; nothing reaches a vendor or approver until live.</td></tr>' : '') +
    '<tr><td style="padding:22px 30px 0;"><img src="' + VIO_LOGO + '" width="200" alt="City Wide Facility Solutions" style="display:block;border:0;"></td></tr>' +
    '<tr><td style="padding:16px 30px 0;">' +
    '<div style="background:#2D2A26;color:#ffffff;font-family:Verdana,Arial,sans-serif;font-size:16px;font-weight:bold;padding:12px 16px;letter-spacing:0.5px;">DIRECTOR APPROVAL REQUIRED</div></td></tr>' +
    '<tr><td style="padding:16px 30px 0;">' +
    vioP_('A violation notice is staged and will not reach the vendor until you approve it. ' +
      'Review the notice below. To make edits or approve and send, open the approval page.') +
    '<table border="0" cellpadding="0" cellspacing="0">' +
    meta('Notice', nid) +
    meta('Submitted by', _esc(d.issuer_name || '')) +
    meta('Vendor', _esc(d.ic.dba + (d.ic.owner ? ', ' + d.ic.owner : ''))) +
    meta('Account', _esc(d.account || '')) +
    meta('Market', _esc(d.market || '')) +
    meta('Level', String(level)) +
    meta('Approver', _esc(approver || '')) +
    '</table>' +
    '<p style="margin:16px 0 20px;"><a href="' + approveLink + '" style="background:#D22730;color:#ffffff;' +
    'font-family:Verdana,Arial,sans-serif;font-size:14px;font-weight:bold;text-decoration:none;' +
    'padding:12px 22px;display:inline-block;">Review, Edit, and Approve</a></p>' +
    '<p style="margin:0 0 16px;font-family:Verdana,Arial,sans-serif;font-size:11px;color:#999999;">' +
    'Anyone with this link can approve the notice. Do not forward this email.</p>' +
    '<div style="border-top:2px solid #eeeeee;margin:0 0 4px;"></div>' +
    '<p style="margin:10px 0 0;font-family:Verdana,Arial,sans-serif;font-size:11px;color:#999999;">Preview of the vendor notice:</p>' +
    '</td></tr>' +
    '<tr><td style="padding:0;">' + noticeHtml + '</td></tr>' +
    '</table></td></tr></table>';
}

// ------------------------------------------------------------ email -----
function vioP_(txt) {
  return '<p style="margin:0 0 12px;font-family:Verdana,Arial,sans-serif;font-size:13px;' +
    'line-height:1.55;color:#2d2a26;">' + txt + '</p>';
}

function vioFindingBlock_(n, f, cfg) {
  var req = '', cure = '';
  var items = (f.items || []).map(_esc).join('</li><li>');
  var itemsHtml = items ? '<ul style="margin:6px 0 10px 18px;padding:0;font-family:Verdana,Arial,' +
    'sans-serif;font-size:13px;line-height:1.55;color:#2d2a26;"><li>' + items + '</li></ul>' : '';
  var detail = f.detail ? vioP_(_esc(f.detail)) : '';
  if (f.type === 'chemicals') {
    req = vioP_('Your Independent Contractor Agreement and Orientation Booklet acknowledgment require ' +
      'OSHA-compliant labeling on every chemical and current SDS sheets posted in the janitor closet.' +
      (f.client_mandate ? ' This account operates under a client chemical directive attached to your ' +
      'Exhibit A. Only listed products may be used or stored on site.' : '')) +
      vioP_('Chemical labeling and hazard communication are federal OSHA obligations of your company ' +
      'as the employer. City Wide treats this finding with the seriousness it carries.');
    cure = vioP_('<b>Required correction:</b> Correct this immediately. Remove or properly label the ' +
      'containers and restore SDS coverage before your next scheduled service.');
  } else if (f.type === 'background') {
    req = vioP_('Every person working a City Wide account must have a City Wide approved background ' +
      'check on file before a badge is issued. This protects the client and their assets and is a ' +
      'condition of your agreement.');
    cure = vioP_('<b>Required correction:</b> Submit a background check request for this person before ' +
      'your next scheduled service: <a href="' + (cfg.background_link || VIO_BG_LINK) +
      '" style="color:#D22730;">Background Check &amp; Name Badge request</a> (also under Paperwork on ' +
      'the <a href="' + VIO_HUB_PAPERWORK + '" style="color:#D22730;">Vendor Resource Center</a>). ' +
      'The person may continue working pending results only after the request is submitted. A person ' +
      'without a submitted request does not return to the account.');
  } else if (f.type === 'uniform') {
    req = vioP_('Badges are issued when compliance paperwork is on file and must be worn visibly at all ' +
      'times on site, with matching photo ID. Uniforms are required in every client building. Your signed ' +
      'compliance packet provides that repeated badge violations within any 90-day period may result in ' +
      'suspension or termination of service assignments. Orders go through the vendor store on the ' +
      'Resource Center.');
    cure = vioP_('<b>Required correction:</b> Fix this before your next scheduled service.');
  } else if (f.type === 'meeting') {
    req = vioP_('The Communication Guidelines signed with your Independent Contractor Agreement require ' +
      'on-time arrival for scheduled meetings and inspections, with a 15-minute grace period. Time beyond ' +
      'the grace period is chargeable at $55.38 per hour, or portion thereof, for the additional City Wide ' +
      'time required. The same guidelines credit you at the same rate when City Wide is late; that remains ' +
      'your right.');
    cure = vioP_('<b>Required correction:</b> The chargeable time incurred here will be reflected against ' +
      'your monthly payment as provided in the Communication Guidelines. Confirm the rescheduled time with ' +
      'your Facility Solutions Manager and keep every scheduled commitment going forward.');
  } else if (f.type === 'availability') {
    req = vioP_('The Communication Guidelines signed with your Independent Contractor Agreement require ' +
      'that you, or a supervisor with decision-making authority, be reachable to speak with the Night ' +
      'Manager at the start of each service period and whenever your staff is working in a building, and ' +
      'that Night Manager calls be returned within one hour.');
    cure = vioP_('<b>Required correction:</b> Restore a working contact path before your next scheduled ' +
      'service. Confirm your current phone number with your Facility Solutions Manager and ensure your ' +
      'voicemail identifies a designated supervisor who can act when you are unavailable.');
  } else if (f.type === 'complaint') {
    req = vioP_('A client complaint by itself is not a violation, and this notice is not about the ' +
      'underlying complaint. It addresses the failure to follow the required response process. The ' +
      'Communication Guidelines signed with your Independent Contractor Agreement and the Client ' +
      'Complaint Policy in your Orientation Booklet require complaints to be resolved by 10:00 PM the ' +
      'next service period unless otherwise agreed in writing, with the acting Night Manager verifying ' +
      'the resolution.');
    cure = vioP_('<b>Required correction:</b> Resolve the open complaint at your next scheduled service ' +
      'at the latest, and meet the acting Night Manager to verify the resolution. If City Wide performs ' +
      'or assigns work to close the complaint, that time and expense is chargeable per Section 7.1 of ' +
      'your Independent Contractor Agreement, $25 per hour with a 2-hour minimum.');
  } else if (f.type === 'unauthorized') {
    req = vioP_('A City Wide badge is what authorizes a person to be present in a client building. ' +
      'Your Orientation Booklet acknowledgment provides that a badge is issued only when compliance ' +
      'documentation is on file and signifies that the person is authorized to be present. No other ' +
      'person, including family members, friends, or unreported helpers, may be inside a client ' +
      'facility during service. This protects the client, their assets, and your company.');
    cure = vioP_('<b>Required correction:</b> Remove any unauthorized person from the site ' +
      'immediately. Only badged members of your crew enter a City Wide account. Before your next ' +
      'scheduled service, confirm with your Facility Solutions Manager that every person working ' +
      'this account is documented and badged.');
  } else if (f.type === 'ineligible') {
    req = vioP_('The City Wide approved background check described in your Orientation Booklet ' +
      'exists to protect the client and their assets and is a condition of your agreement. A person ' +
      'whose screening returned disqualifying results, or who has been denied a badge, is not ' +
      'cleared to work any City Wide account.') +
      vioP_('Whether and how your company employs any person remains your decision as the employer. ' +
      'Access to City Wide client facilities is separate, is conditioned on clearance, and is not ' +
      'negotiable. Placing a person who is not cleared on a client site is treated as a serious ' +
      'compliance failure regardless of intent.');
    cure = vioP_('<b>Required correction:</b> Remove this person from all City Wide accounts ' +
      'immediately; they do not return to any City Wide client facility. Confirm the removal in ' +
      'writing to your Facility Solutions Manager before your next scheduled service. City Wide ' +
      'reserves all rights under your Independent Contractor Agreement, up to and including ' +
      'reassignment of affected accounts, where a person who is not cleared is knowingly placed ' +
      'on site.');
  } else if (f.type === 'minor') {
    req = vioP_('The Wage and Labor Laws section of your Orientation Booklet, acknowledged at ' +
      'orientation, states that workers in any building must be at least 18 years of age and ' +
      'requires compliance with federal, state, and local labor laws at all times. A person under ' +
      '18 cannot hold a City Wide badge and is never authorized inside a client facility during ' +
      'service, whether working or accompanying your crew.') +
      vioP_('This is a legal compliance matter as well as a contractual one. City Wide treats it ' +
      'as among the most serious findings it documents.');
    cure = vioP_('<b>Required correction:</b> Remove the person from the site immediately; they do ' +
      'not return to any City Wide account. Before your next scheduled service, confirm in writing ' +
      'to your Facility Solutions Manager that no person under 18 will be present at any City Wide ' +
      'account and what changed to ensure it. A further finding of this type results in ' +
      'reassignment of the account regardless of your notice history, and City Wide reserves all ' +
      'rights under your Independent Contractor Agreement.');
  } else if (f.type === 'security') {
    req = vioP_('The Security &amp; Property Protection Policy signed with your compliance packet is a ' +
      'material term of your Independent Contractor Agreement. It covers securing every entry point, ' +
      'client property, client information, and key control, and it extends to everyone on your crew. ' +
      'Violation of this policy constitutes a material breach and permits immediate termination of the ' +
      'Agreement without prior notice or opportunity to cure. This notice documents the finding; it does ' +
      'not waive that right.');
    cure = vioP_('<b>Required correction:</b> Correct this immediately and confirm in writing to your ' +
      'Facility Solutions Manager, before your next scheduled service, what changed to prevent a ' +
      'recurrence. You are responsible and liable for any resulting damages or losses.');
  } else {
    req = vioP_('Your Exhibit A lists the contracted scope for this account. Finaling every account ' +
      'nightly is a City Wide client commitment.');
    cure = vioP_('<b>Required correction:</b> Correct the listed items at your next scheduled service. ' +
      'City Wide may perform or assign interim work; that time and expense is chargeable per Section 7.1 ' +
      'of your Independent Contractor Agreement and the Missed Service standard in your Orientation ' +
      'Booklet, $25 per hour with a 2-hour minimum.');
  }
  return '<div style="border-left:4px solid #D22730;padding:2px 0 2px 14px;margin:0 0 18px;">' +
    '<p style="margin:0 0 6px;font-family:Verdana,Arial,sans-serif;font-size:14px;font-weight:bold;' +
    'color:#2d2a26;">Finding ' + n + ': ' + _esc(f.label) + '</p>' +
    itemsHtml + detail + req + cure + '</div>';
}

function vioEmail_(nid, d, cfg, level, test) {
  var natureLine = '';
  if (d.nature === 'Disregard of a documented requirement' || d.nature === 'Deliberate') {
    natureLine = vioP_('The requirement at issue is documented and acknowledged in your agreement. ' +
      'City Wide is not treating this finding as an oversight.');
  } else if (d.nature === 'Repeat issue') {
    natureLine = vioP_('This condition repeats an issue previously brought to your attention.');
  }
  var ladder = '';
  var rate = cfg.chargeback_rate || '25';
  var minH = cfg.chargeback_min_hours || '2';
  if (level === 1) {
    ladder = vioP_('<b>This is a first notice.</b> A further finding within 12 months results in a ' +
      'Compliance Chargeback against your monthly payment at the acknowledged standard of $' + rate +
      ' per hour, ' + minH + '-hour minimum, for City Wide\'s time and expense to re-inspect and ' +
      'verify correction.');
  } else if (level === 2) {
    var amt = Number(d.chargeback_amount) || (Number(rate) * Number(minH));
    ladder = vioP_('<b>This is a second notice within 12 months.</b> A Compliance Chargeback of $' +
      amt + ' will appear on your monthly payment per your Independent Contractor Agreement and ' +
      'Orientation Booklet acknowledgment, covering City Wide\'s time and expense to re-inspect and ' +
      'verify correction. A further finding results in reassignment of the account.');
  } else {
    ladder = vioP_('<b>This is a final notice.</b> City Wide is reassigning ' + _esc(d.account) +
      (d.effective_date ? ' effective ' + _esc(d.effective_date) : '') +
      ', documented by an Exhibit A change. Your Facility Solutions Manager will coordinate the transition.');
  }
  var sourceLine = '';
  if (d.source && /inspection/i.test(String(d.source))) {
    sourceLine = vioP_('Documented during a ' + _esc(d.source) +
      (d.inspection_date ? ' on ' + _esc(d.inspection_date) : '') + '.');
  }
  var photoBlock = '';
  if (d.photos && d.photos.length) {
    photoBlock = '<p style="margin:0 0 6px;font-family:Verdana,Arial,sans-serif;font-size:14px;' +
      'font-weight:bold;color:#2d2a26;">Documentation</p>';
    d.photos.forEach(function (p) {
      if (!p || !p.img) return;
      photoBlock += '<a href="' + (p.view || p.img) + '"><img src="' + p.img +
        '" width="300" style="display:block;border:1px solid #dddddd;margin:0 0 10px;max-width:100%;" alt="Documentation photo"></a>';
    });
  }
  var blocks = '';
  (d.findings || []).forEach(function (f, i) { blocks += vioFindingBlock_(i + 1, f, cfg); });
  var contact = vioP_('City Wide will verify at re-inspection. Questions go to your Facility ' +
    'Solutions Manager, ' + _esc(d.fsm_name || 'your FSM') +
    (d.doo_name || cfg.doo_name ? ', or Director of Operations, ' + _esc(d.doo_name || cfg.doo_name) : '') + '.');
  var testBanner = test ? '<tr><td style="background:#E5B423;padding:8px 30px;font-family:Verdana,' +
    'Arial,sans-serif;font-size:12px;font-weight:bold;color:#2d2a26;">TEST NOTICE. Not issued to a vendor.' +
    '</td></tr>' : '';
  return '' +
    '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
    '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="640">' +
    testBanner +
    '<tr><td style="padding:22px 30px 0;"><img src="' + VIO_LOGO + '" width="200" alt="City Wide Facility Solutions" style="display:block;border:0;"></td></tr>' +
    '<tr><td style="padding:16px 30px 0;">' +
    '<div style="background:#D22730;color:#ffffff;font-family:Verdana,Arial,sans-serif;font-size:16px;' +
    'font-weight:bold;padding:12px 16px;letter-spacing:0.5px;">' +
    (level === 3 ? 'FINAL NOTICE OF NON-COMPLIANCE' : level === 2 ? 'SECOND NOTICE OF NON-COMPLIANCE' : 'NOTICE OF NON-COMPLIANCE') +
    '</div></td></tr>' +
    '<tr><td style="padding:16px 30px 28px;">' +
    '<p style="margin:0 0 4px;font-family:Verdana,Arial,sans-serif;font-size:13px;color:#636466;">' +
    _esc(d.ic.dba) + (d.ic.owner ? ', attn ' + _esc(d.ic.owner) : '') + '</p>' +
    '<p style="margin:0 0 16px;font-family:Verdana,Arial,sans-serif;font-size:12px;color:#636466;">' +
    'Account: ' + _esc(d.account) + ' &middot; Inspection date: ' + _esc(d.inspection_date || '') +
    ' &middot; Notice ' + nid + '</p>' +
    vioP_('This notice documents a compliance finding at ' + _esc(d.account) + '.') +
    sourceLine + natureLine + blocks + photoBlock + ladder + contact +
    '<p style="margin:18px 0 0;font-family:Verdana,Arial,sans-serif;font-size:11px;color:#999999;">' +
    'City Wide Facility Solutions &middot; GoCityWide.com &middot; Issued through the City Wide ' +
    'compliance program. Please do not reply to this address; replies route to the service desk.</p>' +
    '</td></tr></table></td></tr></table>';
}

function vioSetupRun() {
  Logger.log(vioSetup_({}).getContent());
}

function vioDdSyncRun() {
  Logger.log(vioDdSync_({}).getContent());
}
