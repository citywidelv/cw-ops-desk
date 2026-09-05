// ============================================================
// Profile.gs - vendor profile change requests (Sep 5 2026)
// File in the CW Solicitations Apps Script project.
// Routing: doPost in Code.gs routes kind 'profile_update' to handleProfileUpdate(data).
//
// Public form: cw-vendor-hub/profile-update.html (no login, no passcode, honeypot).
// Nothing here changes a vendor record. Every submission is a PENDING REQUEST:
//   1. files (bank letter, W-9) go to a Drive folder that only the team can open
//   2. the row lands on the standalone "CW Vendor Profile Requests" sheet
//   3. a handoff email goes to the region's compliance inbox (LV / NNV)
//   4. if the Vendor Directory has an email on file that differs from the
//      submitter, that address gets a short "a change was requested" notice
// A person verifies with the vendor at the contact ALREADY ON FILE, then makes
// the edits in the other systems by hand and marks the row Verified / Applied.
// The sheet never holds banking data, only the Drive link to the letter.
// ============================================================

var PROF_TAB = 'Requests';
var PROF_PROP_SHEET = 'PROFILE_SHEET_ID';
var PROF_PROP_FOLDER = 'PROFILE_UPLOAD_FOLDER';
var PROF_SENDER = 'City Wide Compliance';
var PROF_LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
var PROF_MAX_EACH = 10 * 1024 * 1024;
var PROF_MAX_TOTAL = 15 * 1024 * 1024;
var PROF_MAX_COUNT = 4;
var PROF_OK_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
var PROF_STATUSES = ['Pending', 'Verified', 'Applied', 'Rejected'];

var PROF_HEADERS = [
  'request_id', 'received', 'status', 'region', 'entity', 'company', 'vendor_no_given',
  'matched_vendor_id', 'submitted_by', 'role', 'callback_phone', 'submitter_email', 'changes',
  'notif_email', 'notif_mode', 'ledger_email', 'ledger_mode', 'phone_main', 'phone_mobile',
  'contact_name', 'contact_title', 'contact_email', 'contact_phone', 'contact_replaces',
  'address', 'name_new', 'entity_change', 'bank_letter', 'bank_reason', 'bank_effective',
  'other_text', 'notes', 'file_names', 'drive_links', 'on_file_snapshot',
  'verified_by', 'verified_on', 'applied_by', 'applied_on', 'team_notes', 'mail_status'
];

var PROF_REGIONS = {
  'Las Vegas': {
    key: 'LV',
    entity: 'Low Drag, LLC dba City Wide Facility Solutions',
    compliance: 'LVCompliance@gocitywide.com',
    label: 'City Wide Facility Solutions of Las Vegas'
  },
  'Northern Nevada': {
    key: 'NNV',
    entity: 'Dash Two, LLC dba City Wide Facility Solutions',
    compliance: 'rncompliance@gocitywide.com',
    label: 'City Wide Facility Solutions of Northern Nevada'
  }
};

var PROF_CHANGE_LABEL = {
  notif: 'Notification email', ledger: 'Ledger / accounting email', phone: 'Phone numbers',
  contact: 'Primary contact', address: 'Mailing / business address', name: 'Company name or DBA',
  bank: 'Bank account (bank letter)', other: 'Something else'
};

// Where each change has to be applied by hand. These are the systems TJ's notes
// name for vendor records. Edit here if a system is added or retired.
var PROF_SYSTEMS = {
  notif: ['Vendor Directory sheet (email)', 'CRM vendor contact', 'emfluence vendor group contact', 'CW Violation Notices roster (notification email)'],
  ledger: ['Business Central vendor card (email / remittance)', 'PandaDoc ledger letter recipient'],
  phone: ['Vendor Directory sheet (phone / business_phone)', 'CRM vendor contact', 'CW Violation Notices roster'],
  contact: ['Vendor Directory sheet (contact_name / email / phone)', 'CRM vendor contact', 'emfluence vendor group contact', 'PandaDoc recipient for ledgers and agreements'],
  address: ['Business Central vendor card (address)', 'Vendor Directory sheet (business_address / city_state)', 'Ask for an updated W-9 if the W-9 address changed'],
  name: ['New W-9 on file (required)', 'IC agreement re-signed or amended in the new name', 'Certificate of insurance re-issued in the new name', 'Business Central vendor card', 'Vendor Directory sheet (dba_name / legal_name)', 'CRM vendor record', 'IC folder renamed'],
  bank: ['CALL the vendor at the phone number ON FILE (never the number in this request) and confirm', 'Confirm the account name on the letter matches the legal name on the W-9', 'Business Central vendor bank account / payment method', 'File the letter in the IC folder as "Bank Letter - Vendor - YYYY-MM-DD.pdf"'],
  other: ['Read the request and route to whoever owns that field']
};

// ------------------------------------------------------------ storage -----
function profFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROF_PROP_FOLDER);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('CW Vendor Profile Requests (files)');
  props.setProperty(PROF_PROP_FOLDER, f.getId());
  return f;
}

function profSS_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROF_PROP_SHEET);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ss = SpreadsheetApp.create('CW Vendor Profile Requests');
  props.setProperty(PROF_PROP_SHEET, ss.getId());
  try {
    var it = DriveApp.getFoldersByName('Team Portal');
    if (it.hasNext()) {
      var folder = it.next();
      var file = DriveApp.getFileById(ss.getId());
      folder.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    }
  } catch (e) {}
  return ss;
}

function profSheet_() {
  var ss = profSS_();
  var sh = ss.getSheetByName(PROF_TAB);
  if (!sh) {
    sh = ss.getSheets()[0];
    if (sh.getName() === 'Sheet1' && sh.getLastRow() === 0) sh.setName(PROF_TAB);
    else sh = ss.insertSheet(PROF_TAB);
  }
  var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  if (have.join('|') !== PROF_HEADERS.join('|')) {
    sh.getRange(1, 1, 1, PROF_HEADERS.length).setValues([PROF_HEADERS])
      .setFontWeight('bold').setBackground('#D22730').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setFrozenColumns(3);
    var rows = Math.max(sh.getMaxRows() - 1, 1);
    var statusCol = PROF_HEADERS.indexOf('status') + 1;
    sh.getRange(2, statusCol, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(PROF_STATUSES, true).build());
    var all = sh.getRange(2, 1, rows, PROF_HEADERS.length);
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$C2="Applied"').setBackground('#CCEBEC').setRanges([all]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$C2="Verified"').setBackground('#FBF3DC').setRanges([all]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$C2="Rejected"').setBackground('#E5E5E5').setFontColor('#636466').setRanges([all]).build()
    ]);
    var widths = { 1: 150, 2: 130, 3: 90, 4: 110, 6: 200, 13: 180, 25: 220, 33: 180, 34: 220, 35: 260, 40: 220, 41: 200 };
    for (var c in widths) sh.setColumnWidth(Number(c), widths[c]);
  }
  return sh;
}

function profClean_(s) {
  return String(s == null ? '' : s).replace(/[\\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}
function profStr_(v, max) {
  var s = String(v == null ? '' : v).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  return max ? s.slice(0, max) : s;
}
function profNorm_(s) {
  return profStr_(s).toLowerCase().replace(/\b(llc|inc|corp|co|ltd|l\.l\.c\.|dba)\b/g, '').replace(/[^a-z0-9]/g, '');
}
function profEmailOk_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '')); }

// Best-effort lookup in the Vendor Directory so the handoff shows what is on file
// NOW next to what was requested. Never returned to the vendor: enumeration risk.
function profLookup_(company, region, emails, vendorNo) {
  var out = { found: false, count: 0 };
  try {
    var rows = vdAllRows_(vdSS_());
    var want = profNorm_(company);
    var em = (emails || []).map(function (e) { return profStr_(e).toLowerCase(); }).filter(Boolean);
    var vn = profStr_(vendorNo);
    var hits = rows.filter(function (r) {
      if (vn && r.bc_vendor_no && profStr_(r.bc_vendor_no) === vn) return true;
      if (want && (profNorm_(r.dba_name) === want || profNorm_(r.legal_name) === want)) return true;
      if (em.length && r.email && em.indexOf(profStr_(r.email).toLowerCase()) >= 0) return true;
      return false;
    });
    // prefer the row in the requested region, then live statuses
    var inRegion = hits.filter(function (r) { return String(r.region || '').indexOf(region) >= 0 || String(r.region || '') === 'Both'; });
    var pick = (inRegion.length ? inRegion : hits)[0];
    out.count = hits.length;
    if (pick) {
      out.found = true;
      out.vendor_id = profStr_(pick.vendor_id);
      out.status = profStr_(pick.status);
      out.dba_name = profStr_(pick.dba_name);
      out.legal_name = profStr_(pick.legal_name);
      out.contact_name = profStr_(pick.contact_name);
      out.email = profStr_(pick.email);
      out.phone = profStr_(pick.phone);
      out.business_phone = profStr_(pick.business_phone);
      out.business_address = [profStr_(pick.business_address), profStr_(pick.city_state)].filter(Boolean).join(', ');
      out.bc_vendor_no = profStr_(pick.bc_vendor_no);
      out.region = profStr_(pick.region);
    }
  } catch (e) { out.error = String(e); }
  return out;
}

// -------------------------------------------------------------- intake -----
function handleProfileUpdate(data) {
  var out = { ok: false };
  if (data.website) { out.ok = true; out.id = 'ok'; return _json(out); } // honeypot

  var region = PROF_REGIONS[profStr_(data.region)];
  if (!region) { out.error = 'Pick your region: Southern Nevada or Northern Nevada.'; return _json(out); }
  var company = profStr_(data.company, 160);
  var submitter = profStr_(data.submitter, 120);
  var role = profStr_(data.role, 60);
  var callback = profStr_(data.callback, 60);
  var semail = profStr_(data.submitter_email, 160);
  if (!company) { out.error = 'Your company name is required.'; return _json(out); }
  if (!submitter) { out.error = 'Your name is required.'; return _json(out); }
  if (!callback) { out.error = 'A phone number where we can reach you is required.'; return _json(out); }
  if (!profEmailOk_(semail)) { out.error = 'A valid email is required so we can reach you.'; return _json(out); }

  var changes = (data.changes || []).map(function (c) { return profStr_(c, 20); })
    .filter(function (c) { return PROF_CHANGE_LABEL[c]; });
  if (!changes.length) { out.error = 'Check at least one thing that changed.'; return _json(out); }
  var has = function (k) { return changes.indexOf(k) >= 0; };

  var f = {
    notif_email: has('notif') ? profStr_(data.notif_email, 160) : '',
    notif_mode: has('notif') ? profStr_(data.notif_mode, 60) : '',
    ledger_email: has('ledger') ? profStr_(data.ledger_email, 160) : '',
    ledger_mode: has('ledger') ? profStr_(data.ledger_mode, 60) : '',
    phone_main: has('phone') ? profStr_(data.phone_main, 60) : '',
    phone_mobile: has('phone') ? profStr_(data.phone_mobile, 60) : '',
    contact_name: has('contact') ? profStr_(data.contact_name, 120) : '',
    contact_title: has('contact') ? profStr_(data.contact_title, 80) : '',
    contact_email: has('contact') ? profStr_(data.contact_email, 160) : '',
    contact_phone: has('contact') ? profStr_(data.contact_phone, 60) : '',
    contact_replaces: has('contact') ? profStr_(data.contact_replaces, 120) : '',
    address: has('address') ? profStr_(data.address, 300) : '',
    name_new: has('name') ? profStr_(data.name_new, 160) : '',
    entity_change: has('name') ? profStr_(data.entity_change, 80) : '',
    bank_reason: has('bank') ? profStr_(data.bank_reason, 80) : '',
    bank_effective: has('bank') ? profStr_(data.bank_effective, 120) : '',
    other_text: has('other') ? profStr_(data.other_text, 2000) : '',
    notes: profStr_(data.notes, 2000)
  };
  if (has('notif') && !profEmailOk_(f.notif_email)) { out.error = 'Enter the new notification email.'; return _json(out); }
  if (has('ledger') && !profEmailOk_(f.ledger_email)) { out.error = 'Enter the new ledger / accounting email.'; return _json(out); }
  if (has('phone') && !f.phone_main && !f.phone_mobile) { out.error = 'Enter at least one new phone number.'; return _json(out); }
  if (has('contact') && !f.contact_name) { out.error = 'Enter the new contact\'s name.'; return _json(out); }
  if (has('address') && !f.address) { out.error = 'Enter the new address.'; return _json(out); }
  if (has('name') && !f.name_new) { out.error = 'Enter the new company name.'; return _json(out); }
  if (has('other') && !f.other_text) { out.error = 'Tell us what else should be updated.'; return _json(out); }

  // ---- files: decode everything before writing anything
  var files = data.files || [];
  if (files.length > PROF_MAX_COUNT) { out.error = 'Up to ' + PROF_MAX_COUNT + ' files per request.'; return _json(out); }
  var blobs = [], slots = [], total = 0;
  for (var i = 0; i < files.length; i++) {
    var fl = files[i] || {};
    var ct = profStr_(fl.type || 'application/pdf');
    var name = profClean_(fl.name || 'document').slice(0, 120) || 'document';
    var slot = profStr_(fl.slot, 40) || 'Document';
    if (PROF_OK_TYPES.indexOf(ct) < 0) { out.error = '"' + name + '" is not a PDF or a photo (JPG, PNG).'; return _json(out); }
    var b;
    try { b = Utilities.newBlob(Utilities.base64Decode(String(fl.data || '')), ct, name); }
    catch (be) { out.error = 'Could not read "' + name + '". Attach it again.'; return _json(out); }
    var n = b.getBytes().length;
    if (!n) { out.error = '"' + name + '" came through empty. Attach it again.'; return _json(out); }
    if (n > PROF_MAX_EACH) { out.error = '"' + name + '" is over 10 MB. Compress it and try again.'; return _json(out); }
    total += n;
    if (total > PROF_MAX_TOTAL) { out.error = 'All files together must stay under 15 MB.'; return _json(out); }
    blobs.push(b); slots.push(slot);
  }
  var hasBankFile = slots.some(function (s) { return /bank/i.test(s); });
  if (has('bank') && !hasBankFile) { out.error = 'Attach the bank letter or voided check for the new account.'; return _json(out); }

  var stamp = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd');
  var reqId = 'PR-' + region.key + '-' + stamp + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();

  // ---- Drive first. Copy of record for the letter / W-9.
  var links = [], names = [];
  if (blobs.length) {
    try {
      var folder = profFolder_();
      for (var j = 0; j < blobs.length; j++) {
        var stored = folder.createFile(blobs[j].copyBlob()
          .setName(reqId + ' - ' + slots[j] + ' - ' + profClean_(company) + ' - ' + blobs[j].getName()));
        links.push(stored.getUrl());
        names.push(slots[j] + ': ' + blobs[j].getName());
      }
    } catch (dErr) {
      out.error = 'We could not store your file. Email it to ' + region.compliance + ' with reference ' + reqId + '.';
      return _json(out);
    }
  }

  // ---- Directory lookup (internal only)
  var onFile = profLookup_(company, profStr_(data.region), [semail, f.contact_email], profStr_(data.vendor_no, 40));
  var snapshot = onFile.found
    ? ['vendor_id ' + onFile.vendor_id, 'status ' + onFile.status, 'dba ' + onFile.dba_name,
       'contact ' + onFile.contact_name, 'email ' + onFile.email, 'phone ' + onFile.phone,
       'business_phone ' + onFile.business_phone, 'address ' + onFile.business_address,
       'bc_no ' + onFile.bc_vendor_no, 'matches ' + onFile.count].filter(function (s) { return !/ $/.test(s); }).join(' | ')
    : 'NO DIRECTORY MATCH' + (onFile.error ? ' (' + onFile.error + ')' : '');

  // ---- Row before any mail
  var sh = profSheet_();
  var row = PROF_HEADERS.map(function (h) {
    switch (h) {
      case 'request_id': return reqId;
      case 'received': return new Date();
      case 'status': return 'Pending';
      case 'region': return profStr_(data.region);
      case 'entity': return region.entity;
      case 'company': return company;
      case 'vendor_no_given': return profStr_(data.vendor_no, 40);
      case 'matched_vendor_id': return onFile.found ? onFile.vendor_id : '';
      case 'submitted_by': return submitter;
      case 'role': return role;
      case 'callback_phone': return callback;
      case 'submitter_email': return semail;
      case 'changes': return changes.map(function (c) { return PROF_CHANGE_LABEL[c]; }).join(', ');
      case 'bank_letter': return has('bank') ? (hasBankFile ? 'Yes - see drive_links' : 'Requested, no file') : '';
      case 'file_names': return names.join(', ');
      case 'drive_links': return links.join('\n');
      case 'on_file_snapshot': return snapshot;
      case 'mail_status': return 'pending';
      default: return f[h] !== undefined ? f[h] : '';
    }
  });
  var at = _nextRow(sh);
  sh.getRange(at, 1, 1, PROF_HEADERS.length).setValues([row]);
  var sheetUrl = sh.getParent().getUrl() + '#gid=' + sh.getSheetId() + '&range=A' + at;

  // ---- Mail last, never fatal. Attachments force an immediate send in cwMail_.
  var mailStatus = [];
  var subjectBits = changes.map(function (c) { return PROF_CHANGE_LABEL[c]; }).join(', ');
  try {
    cwMail_('profile_int', {
      to: region.compliance,
      replyTo: semail,
      name: PROF_SENDER,
      subject: 'Profile change request | ' + company + ' | ' + subjectBits + ' | ' + reqId + ' | VERIFY BEFORE APPLYING',
      htmlBody: profTeamEmail_(reqId, region, company, submitter, role, callback, semail, changes, f, onFile, names, links, sheetUrl, hasBankFile),
      body: profTeamPlain_(reqId, region, company, submitter, role, callback, semail, changes, f, onFile, names, links, sheetUrl),
      attachments: blobs
    });
    mailStatus.push('team sent');
  } catch (tErr) { mailStatus.push('TEAM MAIL FAILED: ' + String(tErr)); }

  // Fraud control: tell the address already on file, if it is a different one.
  var oldEmail = onFile.found ? profStr_(onFile.email).toLowerCase() : '';
  if (oldEmail && profEmailOk_(oldEmail) && oldEmail !== semail.toLowerCase()) {
    try {
      cwMail_('profile_alert', {
        to: oldEmail,
        replyTo: region.compliance,
        name: PROF_SENDER,
        subject: 'A change to your City Wide vendor profile was requested | ' + reqId,
        htmlBody: profAlertEmail_(reqId, region, company, changes),
        body: profAlertPlain_(reqId, region, company, changes)
      });
      mailStatus.push('alert sent to email on file');
    } catch (aErr) { mailStatus.push('ALERT FAILED: ' + String(aErr)); }
  } else {
    mailStatus.push(oldEmail ? 'alert not needed (same email)' : 'no email on file for alert');
  }
  sh.getRange(at, PROF_HEADERS.indexOf('mail_status') + 1).setValue(mailStatus.join(' | '));

  out.ok = true; out.id = reqId; out.files = names.length;
  return _json(out);
}

// ------------------------------------------------------------- emails -----
function profRow_(label, value, strong) {
  if (!value) return '';
  return '<tr><td style="padding:5px 14px 5px 0;font-family:Verdana,Arial,sans-serif;font-size:12px;' +
    'color:#636466;white-space:nowrap;vertical-align:top;">' + _esc(label) + '</td>' +
    '<td style="padding:5px 0;font-family:Verdana,Arial,sans-serif;font-size:13px;color:#2d2a26;' +
    (strong ? 'font-weight:bold;' : '') + '">' + _esc(value) + '</td></tr>';
}
function profH_(t) {
  return '<h2 style="margin:22px 0 8px;font-family:Verdana,Arial,sans-serif;font-size:14px;font-weight:bold;' +
    'color:#2d2a26;border-bottom:2px solid #D22730;padding-bottom:5px;">' + t + '</h2>';
}
function profChangeRows_(changes, f) {
  var h = '';
  var has = function (k) { return changes.indexOf(k) >= 0; };
  if (has('notif')) h += profRow_('Notification email', f.notif_email + (f.notif_mode ? ' (' + f.notif_mode + ')' : ''), true);
  if (has('ledger')) h += profRow_('Ledger / accounting email', f.ledger_email + (f.ledger_mode ? ' (' + f.ledger_mode + ')' : ''), true);
  if (has('phone')) { h += profRow_('Main business phone', f.phone_main, true); h += profRow_('Primary contact mobile', f.phone_mobile, true); }
  if (has('contact')) {
    h += profRow_('New primary contact', [f.contact_name, f.contact_title].filter(Boolean).join(', '), true);
    h += profRow_('Contact email', f.contact_email, true);
    h += profRow_('Contact phone', f.contact_phone, true);
    h += profRow_('Replaces', f.contact_replaces);
  }
  if (has('address')) h += profRow_('New address', f.address, true);
  if (has('name')) { h += profRow_('New company name', f.name_new, true); h += profRow_('New entity or EIN?', f.entity_change); }
  if (has('bank')) { h += profRow_('Bank account', 'NEW BANK LETTER ATTACHED - do not apply until verified by phone', true); h += profRow_('Reason', f.bank_reason); h += profRow_('Take effect', f.bank_effective); }
  if (has('other')) h += profRow_('Something else', f.other_text, true);
  if (f.notes) h += profRow_('Vendor notes', f.notes);
  return h;
}

function profTeamEmail_(id, region, company, submitter, role, callback, semail, changes, f, onFile, names, links, sheetUrl, hasBankFile) {
  var hasBank = changes.indexOf('bank') >= 0, hasName = changes.indexOf('name') >= 0;
  var onFileRows = onFile.found
    ? profRow_('Directory match', onFile.dba_name + (onFile.legal_name && onFile.legal_name !== onFile.dba_name ? ' (' + onFile.legal_name + ')' : '') +
        ' - ' + onFile.vendor_id + (onFile.status ? ', ' + onFile.status : '') + (onFile.bc_vendor_no ? ', BC ' + onFile.bc_vendor_no : '') +
        (onFile.count > 1 ? ' (' + onFile.count + ' possible matches, check)' : '')) +
      profRow_('Contact on file', onFile.contact_name) +
      profRow_('Email on file', onFile.email) +
      profRow_('Phone on file', [onFile.phone, onFile.business_phone].filter(Boolean).join(' / ')) +
      profRow_('Address on file', onFile.business_address)
    : profRow_('Directory match', 'None found. Look the vendor up in the Vendor Directory and CRM before calling.');
  var steps = [];
  steps.push('Call or email the vendor at the contact ON FILE (above), not the contact in this request. Confirm the request came from them.');
  if (hasBank) steps.push('Bank letter: read the account name off the attached letter and confirm it matches the legal name on the W-9. Do not apply from a voicemail or a reply to this email.');
  if (hasName) steps.push('Name change: a new W-9 is required before anything else changes. ' + (f.entity_change && /Yes/i.test(f.entity_change) ? 'They said it is a NEW ENTITY or EIN: new agreement and new COI too.' : 'They said same entity, name or DBA only.'));
  steps.push('Mark the row Verified on the request log, make the edits in the systems below, then mark it Applied and tell the vendor.');
  var sys = '';
  changes.forEach(function (c) {
    sys += '<p style="margin:10px 0 4px;font-family:Verdana,Arial,sans-serif;font-size:12px;font-weight:bold;color:#2d2a26;">' + _esc(PROF_CHANGE_LABEL[c]) + '</p><ul style="margin:0 0 0 18px;padding:0;">' +
      (PROF_SYSTEMS[c] || []).map(function (s) { return '<li style="font-family:Verdana,Arial,sans-serif;font-size:12px;color:#2d2a26;margin:0 0 3px;">' + _esc(s) + '</li>'; }).join('') + '</ul>';
  });
  return '' +
  '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
  '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;">' +
  '<tr><td style="padding:24px 30px 0;"><img src="' + PROF_LOGO + '" height="38" alt="City Wide Facility Solutions" style="display:block;border:0;height:38px;width:auto;"></td></tr>' +
  '<tr><td style="padding:18px 30px 0;"><div style="background:#D22730;color:#ffffff;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;padding:12px 16px;letter-spacing:0.5px;">' +
  'PROFILE CHANGE REQUEST - NOT YET APPLIED</div></td></tr>' +
  '<tr><td style="padding:18px 30px 30px;">' +
  '<p style="margin:0 0 6px;font-family:Verdana,Arial,sans-serif;font-size:18px;font-weight:bold;color:#2d2a26;">' + _esc(company) + '</p>' +
  '<p style="margin:0 0 14px;font-family:Verdana,Arial,sans-serif;font-size:13px;color:#636466;">' + _esc(region.label) + ' &middot; ' + _esc(id) + ' &middot; ' +
  _esc(changes.map(function (c) { return PROF_CHANGE_LABEL[c]; }).join(', ')) + '</p>' +
  '<div style="border:2px solid #2d2a26;border-radius:6px;padding:12px 16px;margin:0 0 6px;">' +
  '<p style="margin:0 0 6px;font-family:Verdana,Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:#D22730;">Do this first</p>' +
  '<ol style="margin:0 0 0 18px;padding:0;">' + steps.map(function (s) { return '<li style="font-family:Verdana,Arial,sans-serif;font-size:13px;line-height:1.5;color:#2d2a26;margin:0 0 5px;">' + _esc(s) + '</li>'; }).join('') + '</ol></div>' +
  profH_('Requested change') + '<table border="0" cellpadding="0" cellspacing="0" width="100%">' + profChangeRows_(changes, f) + '</table>' +
  profH_('On file now (Vendor Directory)') + '<table border="0" cellpadding="0" cellspacing="0" width="100%">' + onFileRows + '</table>' +
  profH_('Who sent this') + '<table border="0" cellpadding="0" cellspacing="0" width="100%">' +
  profRow_('Name', submitter + (role ? ' (' + role + ')' : '')) + profRow_('Callback phone given', callback) + profRow_('Email given', semail) +
  profRow_('Files', names.join(', ')) + '</table>' +
  (links.length ? '<p style="margin:10px 0 0;font-family:Verdana,Arial,sans-serif;font-size:12px;line-height:1.7;word-break:break-all;">' +
    links.map(function (u) { return '<a href="' + u + '" style="color:#D22730;">' + _esc(u) + '</a>'; }).join('<br>') + '</p>' : '') +
  profH_('Where to apply it') + sys +
  '<table border="0" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td align="center">' +
  '<a href="' + sheetUrl + '" style="display:inline-block;background-color:#D22730;color:#ffffff;font-family:Verdana,Arial,sans-serif;font-size:13px;font-weight:bold;text-decoration:none;padding:11px 22px;border-radius:4px;">Open the request log (mark Verified / Applied)</a></td></tr></table>' +
  '<p style="margin:18px 0 0;font-family:Verdana,Arial,sans-serif;font-size:11px;line-height:1.6;color:#999999;">Reply to this email to reach ' + _esc(submitter) + ' at the email they gave. ' +
  (onFile.found && onFile.email && onFile.email.toLowerCase() !== semail.toLowerCase() ? 'A short notice that a change was requested also went to the email on file (' + _esc(onFile.email) + ').' : '') +
  ' Files are stored in Drive under CW Vendor Profile Requests (files). The sheet holds no bank details, only the link.</p>' +
  '</td></tr></table></td></tr></table>';
}

function profTeamPlain_(id, region, company, submitter, role, callback, semail, changes, f, onFile, names, links, sheetUrl) {
  var l = ['PROFILE CHANGE REQUEST - NOT YET APPLIED', '', 'Vendor: ' + company, 'Region: ' + region.label, 'Reference: ' + id,
    'Changes: ' + changes.map(function (c) { return PROF_CHANGE_LABEL[c]; }).join(', '), ''];
  l.push('DO THIS FIRST: contact the vendor at the contact ON FILE (not the one in this request) and confirm.');
  if (changes.indexOf('bank') >= 0) l.push('BANK LETTER attached. Never apply without the phone call.');
  l.push('');
  l.push('Requested:');
  Object.keys(f).forEach(function (k) { if (f[k]) l.push('  ' + k + ': ' + f[k]); });
  l.push('', 'On file now: ' + (onFile.found ? (onFile.dba_name + ' ' + onFile.vendor_id + ' | contact ' + onFile.contact_name + ' | ' + onFile.email + ' | ' + [onFile.phone, onFile.business_phone].filter(Boolean).join(' / ')) : 'no directory match'));
  l.push('', 'Sent by: ' + submitter + (role ? ' (' + role + ')' : '') + ' | ' + callback + ' | ' + semail);
  if (names.length) l.push('Files: ' + names.join(', '));
  links.forEach(function (u) { l.push(u); });
  l.push('', 'Request log: ' + sheetUrl);
  return l.join('\n');
}

function profAlertEmail_(id, region, company, changes) {
  return '' +
  '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
  '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;">' +
  '<tr><td style="padding:24px 30px 0;"><img src="' + PROF_LOGO + '" height="38" alt="City Wide Facility Solutions" style="display:block;border:0;height:38px;width:auto;"></td></tr>' +
  '<tr><td style="padding:18px 30px 30px;">' +
  '<p style="margin:0 0 14px;font-family:Verdana,Arial,sans-serif;font-size:14px;line-height:1.6;color:#2d2a26;">Someone asked City Wide to update the profile on file for <b>' + _esc(company) + '</b>: ' +
  _esc(changes.map(function (c) { return PROF_CHANGE_LABEL[c].toLowerCase(); }).join(', ')) + '.</p>' +
  '<p style="margin:0 0 14px;font-family:Verdana,Arial,sans-serif;font-size:14px;line-height:1.6;color:#2d2a26;">Nothing has changed yet. A City Wide team member will confirm it with your company first.</p>' +
  '<p style="margin:0 0 14px;font-family:Verdana,Arial,sans-serif;font-size:14px;line-height:1.6;color:#2d2a26;"><b>If this request did not come from your company, reply to this email now</b> or contact ' +
  '<a href="mailto:' + region.compliance + '" style="color:#D22730;">' + region.compliance + '</a>. Reference ' + _esc(id) + '.</p>' +
  '<div style="border-top:2px solid #eeeeee;margin:22px 0 0;"></div>' +
  '<p style="margin:14px 0 0;font-family:Verdana,Arial,sans-serif;font-size:11px;line-height:1.6;color:#999999;">' + _esc(region.entity) + ' &middot; GoCityWide.com</p>' +
  '</td></tr></table></td></tr></table>';
}
function profAlertPlain_(id, region, company, changes) {
  return 'Someone asked City Wide to update the profile on file for ' + company + ': ' +
    changes.map(function (c) { return PROF_CHANGE_LABEL[c].toLowerCase(); }).join(', ') + '.\n\n' +
    'Nothing has changed yet. A City Wide team member will confirm it with your company first.\n\n' +
    'If this request did not come from your company, reply to this email now or contact ' + region.compliance + '. Reference ' + id + '.\n\n' +
    region.entity + ' | GoCityWide.com';
}

// ------------------------------------------------- editor Run helpers -----
// Run once from the editor so the web app never has to create the sheet or the
// folder on a vendor's request (and so the sheet lands under Team Portal).
function profSetupRun() {
  var f = profFolder_();
  var sh = profSheet_();
  Logger.log('Folder: ' + f.getName() + ' (' + f.getId() + ')');
  Logger.log('Sheet: ' + sh.getParent().getName() + ' ' + sh.getParent().getUrl() + ' rows: ' + sh.getLastRow());
  return sh.getParent().getUrl();
}
