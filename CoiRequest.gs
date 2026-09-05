// ============================================================
// CoiRequest.gs - customer certificate of insurance (COI) requests (Sep 5 2026)
// File in the CW Solicitations Apps Script project.
// Routing: vdDispatch in VendorDirectory.gs hands every kind starting 'vd_coi_'
// to coiDispatch(data) AFTER the passcode check (team passcode, or the BOM Hub
// passcode because the kinds below are in VD_BOM_KINDS). Code.gs is untouched.
// Kinds: vd_coi_setup, vd_coi_context, vd_coi_submit, vd_coi_rows, vd_coi_status
//
// Direction: this is a CUSTOMER asking City Wide for a certificate that names the
// customer. It is the opposite of Insurance.gs / Uploads.gs, which collect vendor
// certificates coming IN. Do not merge the two.
//
// Flow: a rep or FSM answers the questions on cw-ops-desk/coi-request.html and
// pastes the customer's own email. The page renders the broker checklist and posts
// it here with the structured answers and any sample file. This file:
//   1. stores the sample file(s) in Drive (Team Portal / Ops Hub / COI Requests / <market>),
//   2. writes ONE row to the "COI Requests" tab of the CW Solicitations sheet,
//   3. sends ONE email to the market compliance inbox (LVcompliance@ for Las Vegas,
//      rncompliance@ for Northern Nevada), reply-to the requester, files attached.
// Row and Drive first, mail last and never fatal. No confirmations, no copies,
// by decision (shared 100 recipient per day MailApp cap). While data.test is true
// the email goes to COI_TEST_TO with a TEST prefix and the row is flagged test.
//
// Status lives on the row (Requested, Sent to broker, Received, Delivered to
// customer) and is changed from cw-bom-hub/coi-log.html through vd_coi_status.
// Nothing here deletes a row. Test rows are kept and flagged, never removed.
// ============================================================

var COI_TAB = 'COI Requests';
var COI_FOLDER_PROP = 'COI_FOLDER_ID';
var COI_FOLDER_PATH = ['Team Portal', 'Ops Hub', 'COI Requests'];
var COI_TEST_TO = 'lvservicecall@gocitywide.com';
var COI_SENDER = 'City Wide COI Requests';
var COI_LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
var COI_LOG_URL = 'https://citywidelv.github.io/cw-bom-hub/coi-log.html';

var COI_STATUSES = ['Requested', 'Sent to broker', 'Received', 'Delivered to customer'];

// Named insured follows the market. Spelled the way it appears on the policy.
var COI_MARKETS = {
  'Las Vegas': {
    key: 'LV',
    entity: 'Low Drag, LLC dba City Wide Facility Solutions',
    compliance: 'LVcompliance@gocitywide.com',
    label: 'City Wide Facility Solutions of Las Vegas'
  },
  'Northern Nevada': {
    key: 'NNV',
    entity: 'Dash Two, LLC dba City Wide Facility Solutions',
    compliance: 'rncompliance@gocitywide.com',
    label: 'City Wide Facility Solutions of Northern Nevada'
  }
};

var COI_MAX_FILES = 3;
var COI_MAX_EACH = 8 * 1024 * 1024;
var COI_MAX_TOTAL = 15 * 1024 * 1024;
var COI_OK_EXT = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx', 'eml', 'msg', 'txt'];

var COI_HEADERS = [
  'request_id', 'submitted', 'test', 'status', 'status_date', 'status_by',
  'market', 'named_insured', 'requester_name', 'requester_email', 'requester_role',
  'account_name', 'customer_contact', 'needed_by', 'reason',
  'holder_name', 'holder_address', 'deliver_to',
  'additional_insureds', 'ai_lines', 'pnc', 'wos_gl', 'wos_wc',
  'limits_summary', 'endorsement_forms', 'blanket_ok',
  'description_wording', 'job_reference',
  'side_documents', 'portal', 'separate_certs', 'standing_renewal',
  'flags', 'other_asks', 'raw_email',
  'sample_files', 'sample_links', 'checklist_text', 'answers_json',
  'mail_status', 'history', 'notes', 'cert_link', 'delivered_date'
];

// ------------------------------------------------------------ plumbing -----

function coiOut_(o) { return vdOut_(o); }

function coiDispatch(data) {
  var kind = String(data.kind || '');
  try {
    if (kind === 'vd_coi_setup')   return coiSetup_(data);
    if (kind === 'vd_coi_context') return coiContext_(data);
    if (kind === 'vd_coi_submit')  return coiSubmit_(data);
    if (kind === 'vd_coi_rows')    return coiRows_(data);
    if (kind === 'vd_coi_status')  return coiStatus_(data);
  } catch (err) {
    return coiOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
  return coiOut_({ ok: false, error: 'Unknown coi kind' });
}

function coiStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Los_Angeles', 'yyyy-MM-dd');
  return String(v == null ? '' : v).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
}
function coiNow_() { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd HH:mm'); }
function coiEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function coiClean_(s) {
  return String(s == null ? '' : s).replace(/[\\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

function coiSS_() {
  // Same book as the vendor Documents tab (Uploads.gs): the CW Solicitations sheet.
  return SpreadsheetApp.openById(SHEET_ID);
}

function coiSheet_() {
  var ss = coiSS_();
  var sh = ss.getSheetByName(COI_TAB);
  if (!sh) sh = ss.insertSheet(COI_TAB);
  var have = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] : [];
  if (have.join('|') !== COI_HEADERS.join('|')) {
    sh.getRange(1, 1, 1, COI_HEADERS.length).setValues([COI_HEADERS])
      .setFontWeight('bold').setBackground('#D22730').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  }
  return sh;
}

// First empty row by request_id. getLastRow() counts validation ranges painted
// down the status column, which is the row-1001 bug the other tabs hit.
function coiNextRow_(sh) {
  var vals = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = 1; i < vals.length; i++) if (!coiStr_(vals[i][0])) return i + 1;
  return vals.length + 1;
}

function coiFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(COI_FOLDER_PROP);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var parent = DriveApp.getRootFolder();
  COI_FOLDER_PATH.forEach(function (name) {
    var it = parent.getFoldersByName(name);
    parent = it.hasNext() ? it.next() : parent.createFolder(name);
  });
  props.setProperty(COI_FOLDER_PROP, parent.getId());
  return parent;
}
function coiMarketFolder_(marketName) {
  var root = coiFolder_();
  var it = root.getFoldersByName(marketName);
  return it.hasNext() ? it.next() : root.createFolder(marketName);
}

function coiRowsRaw_(sh) {
  var vals = sh.getDataRange().getValues();
  var head = (vals[0] || []).map(coiStr_);
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    if (!coiStr_(vals[i][0])) continue;
    var o = { _row: i + 1 };
    for (var c = 0; c < head.length; c++) {
      var v = vals[i][c];
      if (v instanceof Date) v = Utilities.formatDate(v, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm');
      o[head[c]] = String(v == null ? '' : v);
    }
    rows.push(o);
  }
  return rows;
}

// -------------------------------------------------------------- setup -----

function coiSetup_(data) {
  var sh = coiSheet_();
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(COI_STATUSES, true).setAllowInvalid(true).build();
  sh.getRange(2, COI_HEADERS.indexOf('status') + 1, 2000, 1).setDataValidation(rule);
  sh.setColumnWidth(COI_HEADERS.indexOf('account_name') + 1, 220);
  sh.setColumnWidth(COI_HEADERS.indexOf('holder_name') + 1, 220);
  sh.setColumnWidth(COI_HEADERS.indexOf('checklist_text') + 1, 320);
  sh.setColumnWidth(COI_HEADERS.indexOf('raw_email') + 1, 320);
  var folder = coiFolder_();
  return coiOut_({ ok: true, sheet_url: coiSS_().getUrl(), tab: COI_TAB, folder_url: folder.getUrl(),
    gid: sh.getSheetId() });
}

// Everything the request page needs on load: the staff roster (from Staff.gs's
// sheet when it exists), markets, and the status list.
function coiContext_(data) {
  var staff = [];
  try {
    if (typeof staffSS_ === 'function') {
      var sh = staffSS_().getSheetByName('Staff');
      if (sh) {
        var v = sh.getDataRange().getValues();
        for (var i = 1; i < v.length; i++) {
          if (!v[i][0]) continue;
          if (String(v[i][5]).toUpperCase() === 'FALSE') continue;
          staff.push({ name: String(v[i][0]), role: String(v[i][1] || ''),
            market: String(v[i][2] || ''), email: String(v[i][4] || '') });
        }
      }
    }
  } catch (e) {}
  var markets = {};
  Object.keys(COI_MARKETS).forEach(function (k) {
    markets[k] = { key: COI_MARKETS[k].key, entity: COI_MARKETS[k].entity, compliance: COI_MARKETS[k].compliance };
  });
  return coiOut_({ ok: true, staff: staff, markets: markets, statuses: COI_STATUSES, test_to: COI_TEST_TO });
}

// ------------------------------------------------------------- submit -----

function coiSubmit_(data) {
  var out = { ok: false };
  var market = COI_MARKETS[coiStr_(data.market)];
  if (!market) { out.error = 'Pick the market: Las Vegas or Northern Nevada.'; return coiOut_(out); }

  var a = data.answers || {};
  var req = function (k, msg) { if (!coiStr_(a[k])) { throw new Error(msg); } };
  req('requester_name', 'Who is asking? Your name is required.');
  req('requester_email', 'Your email is required so the BOM can reply to you.');
  req('account_name', 'The customer / account name is required.');
  req('holder_name', 'The certificate holder name is required. It is the customer entity, exactly as they wrote it.');
  req('holder_address', 'The certificate holder address is required.');
  req('raw_email', 'Paste the customer\'s own words. The broker works from them when a question is unclear.');
  if (coiStr_(a.requester_email).indexOf('@') < 1) throw new Error('That requester email does not look right.');

  var checklist = coiStr_(data.checklist_text);
  if (!checklist) throw new Error('The checklist came through empty. Reload the page and try again.');
  var sections = Array.isArray(data.sections) ? data.sections : [];
  var isTest = data.test === true || String(data.test) === 'true';

  // ---- Files: decode everything before writing anything.
  var files = Array.isArray(data.files) ? data.files : [];
  if (files.length > COI_MAX_FILES) throw new Error('Up to ' + COI_MAX_FILES + ' files per request.');
  var blobs = [], total = 0;
  for (var i = 0; i < files.length; i++) {
    var f = files[i] || {};
    var name = coiClean_(f.name || 'sample').slice(0, 120) || 'sample';
    var ext = (name.lastIndexOf('.') >= 0 ? name.slice(name.lastIndexOf('.') + 1) : '').toLowerCase();
    if (COI_OK_EXT.indexOf(ext) < 0) throw new Error('"' + name + '" is not an accepted file type (PDF, image, Word, Excel, or email export).');
    var ct = String(f.type || 'application/octet-stream');
    var b;
    try { b = Utilities.newBlob(Utilities.base64Decode(String(f.data || '')), ct, name); }
    catch (be) { throw new Error('Could not read "' + name + '". Attach it again.'); }
    var n = b.getBytes().length;
    if (!n) throw new Error('"' + name + '" came through empty. Attach it again.');
    if (n > COI_MAX_EACH) throw new Error('"' + name + '" is over 8 MB. Compress it and try again.');
    total += n;
    if (total > COI_MAX_TOTAL) throw new Error('All files together must stay under 15 MB.');
    blobs.push(b);
  }

  var stamp = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd');
  var id = 'COI-' + market.key + '-' + stamp + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  var account = coiStr_(a.account_name);

  // ---- Drive first: the sample is the copy of record for what the customer sent.
  var links = [], names = [];
  if (blobs.length) {
    try {
      var folder = coiMarketFolder_(coiStr_(data.market));
      for (var j = 0; j < blobs.length; j++) {
        var stored = folder.createFile(blobs[j].copyBlob()
          .setName(id + ' - ' + coiClean_(account) + ' - ' + blobs[j].getName()));
        links.push(stored.getUrl());
        names.push(blobs[j].getName());
      }
    } catch (dErr) {
      throw new Error('The file could not be stored in Drive (' + String(dErr && dErr.message ? dErr.message : dErr) +
        '). Try again, or submit without the file and email it to ' + market.compliance + ' with the request number.');
    }
  }

  // ---- Row second, before any mail.
  var sh = coiSheet_();
  var now = coiNow_();
  var who = coiStr_(a.requester_name);
  var summary = data.summary || {};
  var rec = {
    request_id: id, submitted: new Date(), test: isTest ? 'TRUE' : '', status: COI_STATUSES[0],
    status_date: now, status_by: who,
    market: coiStr_(data.market), named_insured: market.entity,
    requester_name: who, requester_email: coiStr_(a.requester_email), requester_role: coiStr_(a.requester_role),
    account_name: account, customer_contact: coiStr_(summary.customer_contact),
    needed_by: coiStr_(a.needed_by), reason: coiStr_(a.reason),
    holder_name: coiStr_(a.holder_name), holder_address: coiStr_(a.holder_address),
    deliver_to: coiStr_(summary.deliver_to),
    additional_insureds: coiStr_(summary.additional_insureds), ai_lines: coiStr_(summary.ai_lines),
    pnc: coiStr_(a.pnc), wos_gl: coiStr_(a.wos_gl), wos_wc: coiStr_(a.wos_wc),
    limits_summary: coiStr_(summary.limits), endorsement_forms: coiStr_(a.ai_forms_specified),
    blanket_ok: coiStr_(a.ai_form_type),
    description_wording: coiStr_(a.desc_exact), job_reference: coiStr_(summary.job_reference),
    side_documents: coiStr_(summary.side_documents), portal: coiStr_(summary.portal),
    separate_certs: coiStr_(summary.separate_certs), standing_renewal: coiStr_(a.standing_renewal),
    flags: coiStr_(summary.flags), other_asks: coiStr_(a.other_asks), raw_email: coiStr_(a.raw_email),
    sample_files: names.join(', '), sample_links: links.join('\n'),
    checklist_text: checklist, answers_json: JSON.stringify(a).slice(0, 45000),
    mail_status: 'pending', history: now + ' Requested by ' + who + (isTest ? ' (TEST)' : ''),
    notes: '', cert_link: '', delivered_date: ''
  };
  var row = COI_HEADERS.map(function (h) { return rec[h] == null ? '' : rec[h]; });
  var at = coiNextRow_(sh);
  sh.getRange(at, 1, 1, COI_HEADERS.length).setValues([row]);

  // ---- Mail last. One recipient. Never fatal.
  var to = isTest ? COI_TEST_TO : market.compliance;
  var subject = (isTest ? '[TEST] ' : '') + 'COI request | ' + account + ' | ' + coiStr_(data.market) + ' | ' + id;
  var mailStatus = '';
  var quota = -1;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (qe) {}
  if (quota === 0) {
    mailStatus = 'NOT SENT: daily email quota exhausted';
  } else {
    try {
      var opts = {
        to: to,
        replyTo: rec.requester_email,
        name: COI_SENDER,
        subject: subject,
        htmlBody: coiEmailHtml_(id, rec, market, sections, names, links, isTest),
        body: (isTest ? 'TEST. Real requests go to ' + market.compliance + '.\n\n' : '') + checklist +
          (links.length ? '\n\nSample files in Drive:\n' + links.join('\n') : '') +
          '\n\nRequest log: ' + COI_LOG_URL
      };
      if (blobs.length) opts.attachments = blobs;
      MailApp.sendEmail(opts);
      mailStatus = 'sent to ' + to + ' ' + now;
    } catch (mErr) {
      mailStatus = 'MAIL FAILED: ' + String(mErr && mErr.message ? mErr.message : mErr);
    }
  }
  sh.getRange(at, COI_HEADERS.indexOf('mail_status') + 1).setValue(mailStatus);

  out.ok = true;
  out.id = id;
  out.row = at;
  out.sent_to = to;
  out.mail_status = mailStatus;
  out.files = names.length;
  out.links = links;
  return coiOut_(out);
}

// ---------------------------------------------------------------- rows -----

function coiRows_(data) {
  var sh = coiSheet_();
  var rows = coiRowsRaw_(sh);
  rows.reverse();
  return coiOut_({ ok: true, rows: rows, statuses: COI_STATUSES, sheet_url: coiSS_().getUrl(), gid: sh.getSheetId() });
}

// ------------------------------------------------------------- status -----

// {row, request_id, status?, note?, cert_link?, who}. request_id must match the
// row, so a row that moved (sorted sheet) is refused instead of overwritten.
function coiStatus_(data) {
  var sh = coiSheet_();
  var rowNo = parseInt(data.row, 10);
  var id = coiStr_(data.request_id);
  if (!rowNo || rowNo < 2 || !id) throw new Error('Which request? Reload the log and try again.');
  var current = sh.getRange(rowNo, 1, 1, COI_HEADERS.length).getValues()[0];
  if (coiStr_(current[0]) !== id) throw new Error('That request moved on the sheet. Reload the log and try again.');

  var status = coiStr_(data.status);
  var note = coiStr_(data.note);
  var link = coiStr_(data.cert_link);
  var who = coiStr_(data.who) || 'BOM Hub';
  var now = coiNow_();
  if (status && COI_STATUSES.indexOf(status) < 0) throw new Error('Status must be one of: ' + COI_STATUSES.join(', '));
  if (!status && !note && !link) throw new Error('Nothing to change.');

  var col = function (h) { return COI_HEADERS.indexOf(h) + 1; };
  var hist = coiStr_(current[col('history') - 1]);
  var lines = [];
  if (status && status !== coiStr_(current[col('status') - 1])) {
    sh.getRange(rowNo, col('status')).setValue(status);
    sh.getRange(rowNo, col('status_date')).setValue(now);
    sh.getRange(rowNo, col('status_by')).setValue(who);
    if (status === 'Delivered to customer') sh.getRange(rowNo, col('delivered_date')).setValue(now);
    lines.push(now + ' ' + status + ' (' + who + ')');
  }
  if (note) {
    var notes = coiStr_(current[col('notes') - 1]);
    sh.getRange(rowNo, col('notes')).setValue((notes ? notes + '\n' : '') + now + ' ' + who + ': ' + note);
    lines.push(now + ' Note by ' + who + ': ' + note);
  }
  if (link) {
    sh.getRange(rowNo, col('cert_link')).setValue(link);
    lines.push(now + ' Certificate link saved (' + who + ')');
  }
  if (lines.length) sh.getRange(rowNo, col('history')).setValue((hist ? hist + '\n' : '') + lines.join('\n'));

  var fresh = coiRowsRaw_(sh).filter(function (r) { return r.request_id === id; })[0] || null;
  return coiOut_({ ok: true, row: fresh });
}

// -------------------------------------------------------------- email -----

function coiTd_(label, value, flag) {
  var bg = flag ? 'background:#FFF4D6;' : '';
  return '<tr><td style="padding:5px 12px 5px 10px;font-family:Verdana,Arial,sans-serif;font-size:11.5px;' +
    'color:#636466;white-space:nowrap;vertical-align:top;border-bottom:1px solid #F0F0F0;' + bg + '">' + coiEsc_(label) + '</td>' +
    '<td style="padding:5px 10px 5px 0;font-family:Verdana,Arial,sans-serif;font-size:12.5px;color:#2d2a26;' +
    'vertical-align:top;border-bottom:1px solid #F0F0F0;' + bg + (flag ? 'font-weight:bold;' : '') + '">' +
    coiEsc_(value).replace(/\n/g, '<br>') + '</td></tr>';
}

function coiEmailHtml_(id, rec, market, sections, names, links, isTest) {
  var body = '';
  var internal = '';
  sections.forEach(function (s) {
    if (!s || !Array.isArray(s.lines) || !s.lines.length) return;
    var rows = '';
    s.lines.forEach(function (l) {
      if (!l) return;
      rows += coiTd_(String(l.label || ''), String(l.value || ''), !!l.flag);
    });
    var block =
      '<p style="margin:18px 0 6px;font-family:Verdana,Arial,sans-serif;font-size:11px;font-weight:bold;' +
      'letter-spacing:1px;text-transform:uppercase;color:#D22730;">' + coiEsc_(String(s.title || '')) + '</p>' +
      '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #E5E5E5;">' + rows + '</table>';
    if (s.internal) internal += block; else body += block;
  });

  var filesHtml = '';
  if (links.length) {
    filesHtml = '<p style="margin:18px 0 4px;font-family:Verdana,Arial,sans-serif;font-size:12.5px;color:#2d2a26;">' +
      'The customer\'s sample or spec is attached and stored in Drive:</p>' +
      '<p style="margin:0;font-family:Verdana,Arial,sans-serif;font-size:11.5px;line-height:1.7;word-break:break-all;">' +
      links.map(function (u, i) { return '<a href="' + u + '" style="color:#D22730;">' + coiEsc_(names[i] || u) + '</a>'; }).join('<br>') + '</p>';
  }

  return '' +
  '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
  '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="680" style="max-width:680px;">' +
  '<tr><td style="padding:24px 30px 0;"><img src="' + COI_LOGO + '" height="38" alt="City Wide Facility Solutions" style="display:block;border:0;height:38px;width:auto;"></td></tr>' +
  (isTest ? '<tr><td style="padding:14px 30px 0;"><div style="background:#E5B423;color:#2d2a26;font-family:Verdana,Arial,sans-serif;font-size:12px;font-weight:bold;padding:8px 12px;">TEST REQUEST. A real one goes to ' + coiEsc_(market.compliance) + '.</div></td></tr>' : '') +
  '<tr><td style="padding:18px 30px 0;"><div style="background:#D22730;color:#ffffff;font-family:Verdana,Arial,sans-serif;font-size:16px;font-weight:bold;padding:12px 16px;letter-spacing:0.5px;">CERTIFICATE OF INSURANCE REQUEST</div></td></tr>' +
  '<tr><td style="padding:16px 30px 0;">' +
  '<table border="0" cellpadding="0" cellspacing="0" width="100%">' +
  coiTd_('Request', id) +
  coiTd_('Customer', rec.account_name) +
  coiTd_('Market', rec.market) +
  coiTd_('Named insured', rec.named_insured) +
  coiTd_('Needed by', rec.needed_by || 'Not given') +
  coiTd_('Requested by', rec.requester_name + (rec.requester_role ? ' (' + rec.requester_role + ')' : '') + ', ' + rec.requester_email) +
  '</table>' +
  '<p style="margin:16px 0 0;font-family:Verdana,Arial,sans-serif;font-size:12.5px;line-height:1.6;color:#2d2a26;">' +
  'Broker checklist below, in the order a certificate is filled. Forward it to the broker as is; the internal block at the bottom is for City Wide only.</p>' +
  body + filesHtml +
  '</td></tr>' +
  '<tr><td style="padding:22px 30px 0;">' +
  '<div style="border-top:3px solid #2d2a26;padding-top:12px;">' +
  '<p style="margin:0 0 4px;font-family:Verdana,Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#2d2a26;">Internal only. Trim before forwarding to the broker.</p>' +
  internal +
  '<p style="margin:14px 0 4px;font-family:Verdana,Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#636466;">Customer\'s own words</p>' +
  '<div style="background:#F5F5F5;border:1px solid #E5E5E5;padding:10px 12px;font-family:Verdana,Arial,sans-serif;font-size:12px;line-height:1.55;color:#2d2a26;white-space:pre-wrap;">' + coiEsc_(rec.raw_email) + '</div>' +
  '</div></td></tr>' +
  '<tr><td style="padding:22px 30px 26px;">' +
  '<a href="' + COI_LOG_URL + '" style="display:inline-block;background:#D22730;color:#ffffff;font-family:Verdana,Arial,sans-serif;font-size:12.5px;font-weight:bold;text-decoration:none;padding:10px 18px;">Open the COI request log</a>' +
  '<p style="margin:14px 0 0;font-family:Verdana,Arial,sans-serif;font-size:10.5px;line-height:1.6;color:#636466;">Reply to this email to reach the requester. Update the status on the BOM Hub log as the certificate moves. City Wide Facility Solutions &middot; GoCityWide.com</p>' +
  '</td></tr></table></td></tr></table>';
}

// Run once from the editor after deploying: creates the tab, the status dropdown,
// and the Drive folder. Safe to run again.
function coiSetupRun() {
  var r = coiSetup_({});
  Logger.log(r.getContent());
}
