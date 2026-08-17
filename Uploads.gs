// ============================================================
// Uploads.gs - vendor compliance document intake (Aug 17 2026)
// New FILE in the CW Solicitations Apps Script project.
//
// Why this file exists: doPost in Code.gs has always routed kind 'docupload'
// to handleDocUpload(data), but that function was never defined anywhere in the
// project. Every submission from cw-vendor-shop/upload.html threw a
// ReferenceError, which the doPost try/catch turned into
//   {"ok":false,"error":"ReferenceError: handleDocUpload is not defined"}
// and the page printed that string to the vendor. The Documents tab had headers
// and zero rows, so nothing had ever come through. This is that function.
//
// Order of operations is deliberate: the file is written to Drive and the row is
// written to the sheet BEFORE any email is attempted. A compliance document that
// a vendor was told to send must never be lost because a mail quota ran out, so
// mail failures are recorded on the row and never fail the upload.
// ============================================================

var DOC_TAB = 'Documents';

var DOC_HEADERS = [
  'doc_id', 'received', 'doc_type', 'coi_coverage', 'region', 'entity', 'uploader_role',
  'company', 'agency', 'first_name', 'last_name', 'email', 'phone', 'comments',
  'file_names', 'drive_links', 'mail_status'
];

// Entity and mailbox follow the region the vendor picked, exactly like the
// insurance request emails. The legal names are spelled the way they have to
// appear on an ACORD 25 certificate holder box.
var DOC_REGIONS = {
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

// Mirrors the limits the upload page already enforces in the browser. Restated
// here because a browser check is a courtesy, not a control.
var DOC_MAX_EACH = 10 * 1024 * 1024;
var DOC_MAX_TOTAL = 15 * 1024 * 1024;
var DOC_MAX_COUNT = 4;
var DOC_OK_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

var DOC_SENDER = 'City Wide Compliance';
var DOC_LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';

// ------------------------------------------------------------ storage -----
function docFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DOC_UPLOAD_FOLDER');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  var f = DriveApp.createFolder('CW Vendor Compliance Uploads');
  props.setProperty('DOC_UPLOAD_FOLDER', f.getId());
  return f;
}

function docSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(DOC_TAB);
  if (!sh) sh = ss.insertSheet(DOC_TAB);
  var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  // Only rewrite the header when it does not already match, so an existing tab
  // with rows in it is never disturbed.
  if (have.join('|') !== DOC_HEADERS.join('|')) {
    sh.getRange(1, 1, 1, DOC_HEADERS.length).setValues([DOC_HEADERS])
      .setFontWeight('bold').setBackground('#D22730').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

function docClean_(s) {
  return String(s == null ? '' : s).replace(/[\\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

// -------------------------------------------------------------- intake -----
function handleDocUpload(data) {
  var out = { ok: false };

  // Honeypot, same contract as the invoice upload: a bot that fills the hidden
  // field gets a clean success and nothing is stored.
  if (data.website) { out.ok = true; out.id = 'ok'; return _json(out); }

  var region = DOC_REGIONS[String(data.region || '').trim()];
  if (!region) { out.error = 'Pick your region: Las Vegas or Northern Nevada.'; return _json(out); }

  var docType = String(data.doc_type || '').trim();
  if (!docType) { out.error = 'Tell us what you are uploading.'; return _json(out); }

  var company = String(data.company || '').trim();
  var first = String(data.first_name || '').trim();
  var last = String(data.last_name || '').trim();
  var email = String(data.email || '').trim();
  if (!company) { out.error = 'The vendor company name is required.'; return _json(out); }
  if (!first || !last) { out.error = 'Your first and last name are required.'; return _json(out); }
  if (email.indexOf('@') < 1) { out.error = 'A valid email is required so we can reach you.'; return _json(out); }

  var files = data.files || [];
  if (!files.length) { out.error = 'Attach your document first: a PDF or a clear photo.'; return _json(out); }
  if (files.length > DOC_MAX_COUNT) {
    out.error = 'Up to ' + DOC_MAX_COUNT + ' files per submission.'; return _json(out);
  }

  // Decode everything before writing anything, so a bad file in the middle of the
  // set cannot leave half a submission on record.
  var blobs = [], total = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i] || {};
    var ct = String(f.type || 'application/pdf');
    var name = docClean_(f.name || 'document').slice(0, 120) || 'document';
    if (DOC_OK_TYPES.indexOf(ct) < 0) {
      out.error = '"' + name + '" is not a PDF or a photo (JPG, PNG).'; return _json(out);
    }
    var b;
    try {
      b = Utilities.newBlob(Utilities.base64Decode(String(f.data || '')), ct, name);
    } catch (be) {
      out.error = 'Could not read "' + name + '". Attach it again.'; return _json(out);
    }
    var n = b.getBytes().length;
    if (!n) { out.error = '"' + name + '" came through empty. Attach it again.'; return _json(out); }
    if (n > DOC_MAX_EACH) {
      out.error = '"' + name + '" is over 10 MB. Compress it and try again.'; return _json(out);
    }
    total += n;
    if (total > DOC_MAX_TOTAL) {
      out.error = 'All files together must stay under 15 MB.'; return _json(out);
    }
    blobs.push(b);
  }

  var stamp = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd');
  var docId = 'DOC-' + region.key + '-' + stamp + '-' +
    Math.random().toString(36).slice(2, 5).toUpperCase();

  // ---- Drive first. This is the copy of record.
  var links = [], names = [];
  try {
    var folder = docFolder_();
    for (var j = 0; j < blobs.length; j++) {
      var stored = folder.createFile(blobs[j].copyBlob()
        .setName(docId + ' - ' + docClean_(company) + ' - ' + blobs[j].getName()));
      links.push(stored.getUrl());
      names.push(blobs[j].getName());
    }
  } catch (dErr) {
    out.error = 'We could not store your file. Email it to ' + region.compliance +
      ' and we will take it from there. Reference ' + docId + '.';
    return _json(out);
  }

  var coverage = String(data.coi_coverage || '').trim();
  var role = String(data.uploader_role || 'Vendor').trim();
  var agency = String(data.agency || '').trim();
  var phone = String(data.phone || '').trim();
  var comments = String(data.comments || '').trim();

  // ---- Then the row. Written before any mail so the record survives a mail failure.
  var sh = docSheet_();
  var row = [docId, new Date(), docType, coverage, data.region, region.entity, role,
    company, agency, first, last, email, phone, comments,
    names.join(', '), links.join('\n'), 'pending'];
  var at = _nextRow(sh);
  sh.getRange(at, 1, 1, DOC_HEADERS.length).setValues([row]);

  // ---- Mail last, and never fatal.
  var mailStatus = [];
  try {
    MailApp.sendEmail({
      to: region.compliance,
      replyTo: email,
      name: DOC_SENDER,
      subject: docType + ' received | ' + company +
        (coverage ? ' | ' + coverage : '') + ' | ' + docId,
      htmlBody: docTeamEmail_(docId, docType, coverage, region, role, company, agency,
        first, last, email, phone, comments, names, links),
      body: docTeamPlain_(docId, docType, coverage, region, role, company, agency,
        first, last, email, phone, comments, names, links),
      attachments: blobs
    });
    mailStatus.push('team sent');
  } catch (tErr) {
    mailStatus.push('TEAM MAIL FAILED: ' + String(tErr));
  }

  try {
    MailApp.sendEmail({
      to: email,
      replyTo: region.compliance,
      name: DOC_SENDER,
      subject: 'We received your ' + docType.toLowerCase() + ' | ' + docId,
      htmlBody: docVendorEmail_(docId, docType, coverage, region, company, names),
      body: docVendorPlain_(docId, docType, coverage, region, company, names)
    });
    mailStatus.push('confirmation sent');
  } catch (vErr) {
    mailStatus.push('CONFIRMATION FAILED: ' + String(vErr));
  }

  sh.getRange(at, DOC_HEADERS.indexOf('mail_status') + 1).setValue(mailStatus.join(' | '));

  out.ok = true;
  out.id = docId;
  out.files = names.length;
  return _json(out);
}

// ------------------------------------------------------------- emails -----
function docRow_(label, value) {
  if (!value) return '';
  return '<tr><td style="padding:4px 14px 4px 0;font-family:Verdana,Arial,sans-serif;font-size:12px;' +
    'color:#636466;white-space:nowrap;vertical-align:top;">' + _esc(label) + '</td>' +
    '<td style="padding:4px 0;font-family:Verdana,Arial,sans-serif;font-size:13px;color:#2d2a26;">' +
    _esc(value) + '</td></tr>';
}

function docTeamEmail_(id, docType, coverage, region, role, company, agency,
                       first, last, email, phone, comments, names, links) {
  return '' +
  '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%">' +
  '<tr><td align="center" style="padding:20px 0;">' +
  '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;">' +
  '<tr><td style="padding:24px 30px 0;">' +
  '<img src="' + DOC_LOGO + '" height="38" alt="City Wide Facility Solutions" ' +
  'style="display:block;border:0;height:38px;width:auto;"></td></tr>' +
  '<tr><td style="padding:18px 30px 0;">' +
  '<div style="background:#D22730;color:#ffffff;font-family:Verdana,Arial,sans-serif;font-size:16px;' +
  'font-weight:bold;padding:12px 16px;letter-spacing:0.5px;">' + _esc(docType.toUpperCase()) + ' RECEIVED</div>' +
  '</td></tr>' +
  '<tr><td style="padding:18px 30px 30px;">' +
  '<table border="0" cellpadding="0" cellspacing="0" width="100%">' +
  docRow_('Reference', id) +
  docRow_('Vendor', company) +
  docRow_('Document', docType) +
  docRow_('Coverage', coverage) +
  docRow_('Region', region.label) +
  docRow_('Certificate holder', region.entity) +
  docRow_('Sent by', first + ' ' + last + (role && role !== 'Vendor' ? ' (' + role + ')' : '')) +
  docRow_('Agency', agency) +
  docRow_('Email', email) +
  docRow_('Phone', phone) +
  docRow_('Files', names.join(', ')) +
  docRow_('Notes', comments) +
  '</table>' +
  '<p style="margin:18px 0 0;font-family:Verdana,Arial,sans-serif;font-size:13px;line-height:1.6;' +
  'color:#2d2a26;">The files are attached and stored in Drive:</p>' +
  '<p style="margin:6px 0 0;font-family:Verdana,Arial,sans-serif;font-size:12px;line-height:1.7;' +
  'word-break:break-all;">' +
  links.map(function (u) { return '<a href="' + u + '" style="color:#D22730;">' + _esc(u) + '</a>'; }).join('<br>') +
  '</p>' +
  '<p style="margin:18px 0 0;font-family:Verdana,Arial,sans-serif;font-size:12px;line-height:1.6;' +
  'color:#636466;">Reply to this email to reach ' + _esc(first + ' ' + last) + ' directly. ' +
  'Every submission is logged on the Documents tab of the CW Solicitations sheet.</p>' +
  '</td></tr></table></td></tr></table>';
}

function docTeamPlain_(id, docType, coverage, region, role, company, agency,
                       first, last, email, phone, comments, names, links) {
  var l = [];
  l.push(docType.toUpperCase() + ' RECEIVED', '');
  l.push('Reference: ' + id);
  l.push('Vendor: ' + company);
  if (coverage) l.push('Coverage: ' + coverage);
  l.push('Region: ' + region.label);
  l.push('Certificate holder: ' + region.entity);
  l.push('Sent by: ' + first + ' ' + last + (role && role !== 'Vendor' ? ' (' + role + ')' : ''));
  if (agency) l.push('Agency: ' + agency);
  l.push('Email: ' + email);
  if (phone) l.push('Phone: ' + phone);
  l.push('Files: ' + names.join(', '));
  if (comments) l.push('Notes: ' + comments);
  l.push('', 'Stored in Drive:');
  links.forEach(function (u) { l.push(u); });
  return l.join('\n');
}

function docVendorEmail_(id, docType, coverage, region, company, names) {
  return '' +
  '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%">' +
  '<tr><td align="center" style="padding:20px 0;">' +
  '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;">' +
  '<tr><td style="padding:24px 30px 0;">' +
  '<img src="' + DOC_LOGO + '" height="38" alt="City Wide Facility Solutions" ' +
  'style="display:block;border:0;height:38px;width:auto;"></td></tr>' +
  '<tr><td style="padding:18px 30px 30px;">' +
  '<p style="margin:0 0 14px;font-family:Verdana,Arial,sans-serif;font-size:14px;line-height:1.6;' +
  'color:#2d2a26;">We received your ' + _esc(docType.toLowerCase()) +
  (coverage ? ' for ' + _esc(coverage) : '') + '.</p>' +
  '<div style="border-left:4px solid #D22730;padding:10px 0 10px 14px;margin:0 0 20px;">' +
  '<p style="margin:0 0 4px;font-family:Verdana,Arial,sans-serif;font-size:12px;color:#636466;' +
  'text-transform:uppercase;letter-spacing:0.5px;">Reference</p>' +
  '<p style="margin:0;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;' +
  'color:#2d2a26;">' + _esc(id) + '</p></div>' +
  '<p style="margin:0 0 14px;font-family:Verdana,Arial,sans-serif;font-size:14px;line-height:1.6;' +
  'color:#2d2a26;">On file for ' + _esc(company) + ': ' + _esc(names.join(', ')) + '</p>' +
  '<p style="margin:0 0 14px;font-family:Verdana,Arial,sans-serif;font-size:14px;line-height:1.6;' +
  'color:#2d2a26;">The ' + _esc(region.label) + ' compliance team has it. If anything is missing ' +
  'or the certificate holder does not match, they will contact you.</p>' +
  '<div style="border-top:2px solid #eeeeee;margin:22px 0 0;"></div>' +
  '<p style="margin:14px 0 0;font-family:Verdana,Arial,sans-serif;font-size:11px;line-height:1.6;' +
  'color:#999999;">' + _esc(region.entity) + '<br>' +
  '<a href="mailto:' + region.compliance + '" style="color:#999999;">' + region.compliance + '</a>' +
  ' &middot; GoCityWide.com</p>' +
  '</td></tr></table></td></tr></table>';
}

function docVendorPlain_(id, docType, coverage, region, company, names) {
  var l = [];
  l.push('We received your ' + docType.toLowerCase() + (coverage ? ' for ' + coverage : '') + '.', '');
  l.push('Reference: ' + id);
  l.push('On file for ' + company + ': ' + names.join(', '), '');
  l.push('The ' + region.label + ' compliance team has it. If anything is missing or the ' +
    'certificate holder does not match, they will contact you.', '');
  l.push(region.entity);
  l.push(region.compliance + ' | GoCityWide.com');
  return l.join('\n');
}

// ------------------------------------------------- editor Run helpers -----
// Run once so the deployed web app only ever has to open an existing folder,
// rather than create one on a vendor's request.
function docSetupRun() {
  var f = docFolder_();
  var sh = docSheet_();
  Logger.log('Folder: ' + f.getName() + ' (' + f.getId() + ')');
  Logger.log('Tab: ' + sh.getName() + ', rows: ' + sh.getLastRow());
}
