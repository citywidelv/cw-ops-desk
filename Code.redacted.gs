// ARCHIVE COPY of the live CW Solicitations Code.gs (deployment v82, Sep 5 2026).
// The two passcode values are replaced with __REDACTED__ on purpose. NEVER load this file into
// the editor wholesale: it would blank the passcodes. Apply targeted edits or restore the values first.

// ============================================================
// CW Solicitations v6 - postings + responses + invoices + supply orders + feed
// Standalone project under citywideoflasvegas@gmail.com; opens the sheet by ID.
// Deploy: Web app, execute as Me, access: Anyone.
//   POST /exec {kind:'posting'|omitted}   -> team posts a solicitation (passcode required)
//   POST /exec {kind:'response'}          -> vendor submits interest/quote
//   POST /exec {kind:'invoice'}           -> vendor monthly invoice (PDF emailed to AP + vendor)
//   POST /exec {kind:'supply_order'}      -> building supply order (region service line)
//   GET  /exec                            -> JSON feed of OPEN solicitations for the vendor site
// Run setup() once after first install; run setupInvoicing() once for the v6 tabs.
// ============================================================

var SHEET_ID = '1ymbqR7LMvA7sbgZe2Ro5o2dNiXhP08Tn9Hw1b-H5AeQ';
var TAB = 'Solicitations';
var RESP_TAB = 'Responses';
var PASSCODE = '__REDACTED__';
var LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
var BOARD_URL = 'https://citywidelv.github.io/cw-vendor-shop/opportunities.html';

var FSM_ROSTER = {
  allison:{ name: 'Allison Donovan',title: 'Facility Solutions Manager',  region: 'Las Vegas',                   territory: 'North', photo: 'https://citywidelv.github.io/cw-ops-desk/images/fsm-allison-donovan.jpg' },
  alex:   { name: 'Alex Manon',     title: 'Facility Solutions Manager',  region: 'Las Vegas',                   photo: 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/Franchise-Location-Uploads/Las_Vegas/IMG_4680.jpg' },
  brett:  { name: 'Brett Stephens', title: 'Facility Solutions Manager',  region: 'Las Vegas',                   photo: 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/Franchise-Location-Uploads/Las_Vegas/IMG_4080.PNG' },
  jake:   { name: 'Jake Schmidt',   title: 'Facility Solutions Manager',  region: 'Las Vegas',                   photo: 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/Franchise-Location-Uploads/Las_Vegas/IMG_3966.jpg' },
  sam:    { name: 'Sam Morse',      title: 'Facility Solutions Manager',  region: 'Northern Nevada',             photo: 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/Franchise-Location-Uploads/Las_Vegas/IMG_5569.jpg' },
  jeremy: { name: 'Jeremy Walker',  title: 'General Manager',             region: 'Northern Nevada',             photo: 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/Franchise-Location-Uploads/Las_Vegas/IMG_3968.jpg' },
  robert: { name: 'Robert Krause',  title: 'Director of Operations',      region: 'Las Vegas',                   photo: 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/Franchise-Location-Uploads/Las_Vegas/IMG_3964.jpg' },
  josh:   { name: 'Joshua Smith',   title: 'Business Operations Manager', region: 'Las Vegas & Northern Nevada', photo: 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/Franchise-Location-Uploads/Las_Vegas/IMG_3963.jpg' },
  tj:     { name: 'TJ Robert',      title: 'Chief Operating Officer',     region: 'Las Vegas & Northern Nevada', photo: 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/Franchise-Location-Uploads/Las_Vegas/IMG_3962.jpg' }
};


var HEADERS = [
  'id', 'posted', 'filled', 'region', 'type', 'trade', 'title',
  'facility_type', 'area', 'sqft', 'restrooms', 'frequency', 'clean_window',
  'start_date', 'walkthrough', 'deadline',
  'pay_type', 'pay_amount', 'pay_period', 'pay_notes',
  'scope_summary', 'chemicals', 'equipment_required', 'equipment_provided',
  'certifications', 'special_requirements',
  'contact_name', 'contact_email', 'contact_phone', 'notes',
  'response_form', 'responses', 'account_name', 'fsm'
];

var RESP_HEADERS = [
  'response_id', 'received', 'posting_id', 'posting_title', 'region', 'trade', 'mode',
  'company', 'contact_name', 'email', 'phone', 'packet_on_file', 'earliest_start',
  'staffing_plan', 'supervision_plan', 'training_plan', 'crew_size', 'equipment',
  'confirmations', 'custom_answers',
  'quote_amount', 'quote_basis', 'quote_details', 'comments', 'account_name', 'pdf_url'
];

var RESP_EMAILS = 'lvservicecall@gocitywide.com,rnservicecall@gocitywide.com';
var REGION_EMAIL = {
  'Las Vegas': 'lvservicecall@gocitywide.com',
  'Northern Nevada': 'rnservicecall@gocitywide.com'
};

// -------- invoices + building supply orders (v6) --------
var INV_TAB = 'Invoices';
var SUP_TAB = 'Supply Orders';
var INV_EMAILS = 'cwlvinvoices@gocitywide.com,cwrninvoices@gocitywide.com';
var INV_HEADERS = [
  'invoice_id', 'received', 'region', 'company', 'contact_name', 'email', 'phone',
  'company_address', 'service_month', 'line_count', 'total', 'lines', 'comments'
];
var SUP_HEADERS = [
  'order_id', 'received', 'region', 'building', 'requester', 'email', 'phone',
  'item_count', 'subtotal', 'items', 'comments'
];

function setupInvoicing() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var iv = ss.getSheetByName(INV_TAB);
  if (!iv) iv = ss.insertSheet(INV_TAB);
  iv.getRange(1, 1, 1, INV_HEADERS.length).setValues([INV_HEADERS])
    .setFontWeight('bold').setBackground('#2D2A26').setFontColor('#FFFFFF');
  iv.setFrozenRows(1);
  var sp = ss.getSheetByName(SUP_TAB);
  if (!sp) sp = ss.insertSheet(SUP_TAB);
  sp.getRange(1, 1, 1, SUP_HEADERS.length).setValues([SUP_HEADERS])
    .setFontWeight('bold').setBackground('#E5B423').setFontColor('#2D2A26');
  sp.setFrozenRows(1);
}

function setup() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(TAB);
  if (!sh) { sh = ss.getSheets()[0]; sh.setName(TAB); }
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setBackground('#2D2A26').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sh.getRange(2, HEADERS.indexOf('filled') + 1, 999, 1).setDataValidation(rule);

  var rs = ss.getSheetByName(RESP_TAB);
  if (!rs) { rs = ss.insertSheet(RESP_TAB); }
  rs.getRange(1, 1, 1, RESP_HEADERS.length).setValues([RESP_HEADERS])
    .setFontWeight('bold').setBackground('#D22730').setFontColor('#FFFFFF');
  rs.setFrozenRows(1);
}

function _nextRow(sh) {
  var ids = sh.getRange(1, 1, sh.getMaxRows(), 1).getValues();
  for (var r = ids.length - 1; r >= 1; r--) {
    if (String(ids[r][0]) !== '') return r + 2;
  }
  return 2;
}

function doPostBase(e) {
  try {
    var __sd = JSON.parse(e.postData.contents);
    if (__sd && __sd.kind === 'sales_event') return handleSalesEvent(__sd);
    if (__sd && __sd.kind === 'sales_undo') return handleSalesUndo(__sd);
  } catch (__se) {}
  var out = { ok: false };
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.kind === 'responses_list') return handleResponsesList(data);
  if (data.kind === 'announcement') return handleAnnouncement(data);
    if (data.kind === 'auth') return handleAuth(data);
    if (data.kind === 'envirox_catalog') return handleEnviroxCatalog(data);
    if (data.kind === 'envirox_order') return handleEnviroxOrder(data);
    if (data.kind === 'vendor_emails') return handleVendorEmails(data);
    if (data.kind === 'setup_vendor_directory') return handleVendorSetup(data);
    if (data.kind === 'docupload') return handleDocUpload(data);
    if (data.kind === 'response') return handleResponse(data);
    if (data.kind === 'snow_report') return handleSnowReport(data);
    if (data.kind === 'invoice_upload') return handleInvoiceUpload(data);
    if (data.kind === 'invoice') return handleInvoice(data);
    if (data.kind === 'supply_order') return handleSupplyOrder(data);
    if (/_save$/.test(String(data.kind || ''))) return handleCalcSave(data);
    if (String(data.kind) === 'invoice_maillog') return handleInvoiceMailLog(data);
    return handlePosting(data);
  } catch (err) {
    out.error = String(err);
    return _json(out);
  }
}

// ------------------------------------------------------------ postings -----
function handlePosting(data) {
  var out = { ok: false };
  if ((data.passcode || '') !== PASSCODE) { out.error = 'Bad passcode'; return _json(out); }
  if (!data.region || !data.type || !data.title || !data.contact_email) {
    out.error = 'Missing required fields'; return _json(out);
  }
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(TAB);
  var prefix = data.region === 'Northern Nevada' ? 'NNV' : 'LV';
  var id = prefix + '-' +
    Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd') + '-' +
    Math.random().toString(36).slice(2, 5).toUpperCase();
  var row = HEADERS.map(function (h) {
    if (h === 'id') return id;
    if (h === 'posted') return new Date();
    if (h === 'filled') return false;
    if (h === 'responses') return 0;
    return (data[h] !== undefined && data[h] !== null) ? String(data[h]) : '';
  });
  var nextRow = _nextRow(sh);
  sh.getRange(nextRow, 1, 1, row.length).setValues([row]);
  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sh.getRange(nextRow, HEADERS.indexOf('filled') + 1).setDataValidation(rule).setValue(false);

  try {
    var to = REGION_EMAIL[data.region] || REGION_EMAIL['Las Vegas'];
    cwMail_('posting', {
      to: to,
      cc: data.contact_email,
      digest: { title: String(data.title || id), id: id, region: String(data.region || ''), fields: [
        ['Posting', id], ['Type', String(data.type || '')], ['Trade', String(data.trade || '')],
        ['Pay', data.pay_type === 'quote' ? 'Quote requested' : ((data.pay_amount || '') + ' ' + (data.pay_period || '')).trim()],
        ['Deadline', String(data.deadline || '')], ['Account (internal)', String(data.account_name || '')],
        ['Posted by', String(data.contact_name || '') + (data.contact_email ? ' <' + data.contact_email + '>' : '')] ],
        links: [['Live board', BOARD_URL], ['Manage posting (check Filled to remove)', ss.getUrl()]] },
      subject: 'New posting: ' + (data.title || id) + ' [' + id + ']',
      body: 'A new opportunity was posted to the Vendor Resource Center.\n\n' +
        'ID: ' + id + '\nTitle: ' + (data.title || '') + '\nType: ' + (data.type || '') +
        '\nRegion: ' + (data.region || '') + '\nTrade: ' + (data.trade || '') +
        '\nPay: ' + (data.pay_type === 'quote' ? 'Quote requested'
          : (data.pay_amount || '') + ' ' + (data.pay_period || '')) +
        '\nDeadline: ' + (data.deadline || '') +
        '\nAccount (internal): ' + (data.account_name || '') +
        '\nPosted by: ' + (data.contact_name || '') + ' <' + (data.contact_email || '') + '>\n\n' +
        'Live board: ' + BOARD_URL + '\n' +
        'Manage (check Filled to remove): ' + ss.getUrl() + '\n'
    });
  } catch (mailErr) {}

  if (String(data.type) === 'project') {
    try { out.notify_emails = _vendorEmails(data.trade, data.region); } catch (ne) { out.notify_emails = []; }
  }
  out.ok = true; out.id = id;
  return _json(out);
}

// ----------------------------------------------------------- responses -----
function handleResponse(data) {
  var out = { ok: false };
  if (data.website) { out.ok = true; out.id = 'ok'; return _json(out); } // honeypot
  if (!data.posting_id || !data.company || !data.contact_name || !data.email) {
    out.error = 'Missing required fields'; return _json(out);
  }
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(TAB);
  var values = sh.getDataRange().getValues();
  var head = values[0];
  var idCol = head.indexOf('id');
  var postRow = -1, posting = null;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(data.posting_id)) {
      postRow = i + 1;
      posting = {};
      for (var c = 0; c < head.length; c++) posting[head[c]] = values[i][c];
      break;
    }
  }
  if (!posting) { out.error = 'Posting not found'; return _json(out); }
  if (posting.filled === true || String(posting.filled).toUpperCase() === 'TRUE') {
    out.error = 'This opportunity has already been filled.'; return _json(out);
  }

  var rs = ss.getSheetByName(RESP_TAB);
  var rid = 'R-' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMddHHmm') +
    '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  var row = RESP_HEADERS.map(function (h) {
    if (h === 'response_id') return rid;
    if (h === 'received') return new Date();
    if (h === 'posting_id') return String(data.posting_id);
    if (h === 'posting_title') return String(posting.title || '');
    if (h === 'region') return String(posting.region || '');
    if (h === 'trade') return String(posting.trade || '');
    if (h === 'account_name') return String(posting.account_name || '');
    if (h === 'quote_details') return String(data.quote_details || '') + (data.quote_file_name ? ' [Quote document attached to email: ' + String(data.quote_file_name).slice(0, 120) + ']' : '');
    if (h === 'quote_amount') {
      var n = Number(String(data.quote_amount || '').replace(/[$,\s]/g, ''));
      return isNaN(n) ? String(data.quote_amount || '') : n;
    }
    return (data[h] !== undefined && data[h] !== null) ? String(data[h]) : '';
  });
  var writeRow = _nextRow(rs);
  rs.getRange(writeRow, 1, 1, row.length).setValues([row]);
  var pdfUrl = '';
  try { pdfUrl = _saveResponsePdf(posting, data, rid); } catch (ePdf) { pdfUrl = ''; }
  if (pdfUrl) {
    var pdfCol = RESP_HEADERS.indexOf('pdf_url') + 1;
    if (pdfCol > 0) rs.getRange(writeRow, pdfCol).setValue(pdfUrl);
  }

  // bump the responses count on the posting row
  var respCol = head.indexOf('responses') + 1;
  if (respCol > 0) {
    var cur = Number(posting.responses) || 0;
    sh.getRange(postRow, respCol).setValue(cur + 1);
  }

  // optional vendor quote document (base64 from respond.html) -> email attachment only, never the Sheet
  var att = null;
  try {
    if (data.quote_file_data) {
      var fb = Utilities.base64Decode(String(data.quote_file_data).replace(/^data:[^;]*;base64,/, ''));
      if (fb.length > 0 && fb.length <= 15728640) {
        att = Utilities.newBlob(fb, String(data.quote_file_type || 'application/pdf'),
          String(data.quote_file_name || 'vendor-quote.pdf').replace(/[^\w. ()-]+/g, '_').slice(0, 120));
      }
    }
  } catch (fe) { att = null; }

  try {
    cwMail_('response', {
      to: RESP_EMAILS,
      cc: String(posting.contact_email || ''),
      digest: { title: (data.mode === 'quote' ? 'Quote: ' : 'Interest: ') + String(data.company || '') + ' for ' + String(posting.account_name || posting.title || data.posting_id),
        id: rid, region: String(posting.region || ''), fields: [
        ['Posting', String(posting.title || '') + ' [' + String(data.posting_id) + ']'], ['FSM', ((FSM_ROSTER[String(posting.fsm || '')] || {}).name || String(posting.contact_name || ''))],
        ['Contact', String(data.contact_name || '') + ' <' + String(data.email || '') + '>' + (data.phone ? ' ' + data.phone : '')],
        ['Quote', data.mode === 'quote' ? (String(data.quote_amount || '') + ' ' + String(data.quote_basis || '')).trim() : ''],
        ['Earliest start', String(data.earliest_start || '')], ['Crew size', String(data.crew_size || '')], ['Packet on file', String(data.packet_on_file || '')],
        ['Comments', String(data.comments || '').slice(0, 300)] ],
        links: [['Responses sheet', ss.getUrl()], ['Response PDF', pdfUrl || ''], ['Live board', BOARD_URL]] },
      replyTo: String(data.email),
      name: (data.mode === 'quote' ? 'Vendor Quote Submitted' : 'Vendor Interest Submitted'),
      subject: (data.mode === 'quote' ? 'New Quote: ' : 'New Interest: ') +
        String(posting.account_name || posting.title || data.posting_id) + ' | ' +
        ((FSM_ROSTER[String(posting.fsm || '')] || {}).name || String(posting.contact_name || '')),
      attachments: att ? [att] : [],
      htmlBody: _responseEmail(rid, posting, data) + (att ? _attachNote(att.getName()) : ''),
      body: 'Vendor response ' + rid + ' for ' + data.posting_id + ' from ' +
        (data.company || '') + '. Open the CW Solicitations sheet, Responses tab.'
    });
  } catch (mailErr) {}

  out.ok = true; out.id = rid;
  return _json(out);
}

function _esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function _kvRow(label, val) {
  if (!val) return '';
  return '<tr><td style="font-family:Verdana,Arial,sans-serif;font-size:12px;color:#636466;' +
    'padding:7px 10px 7px 0;border-bottom:1px solid #eeeeee;vertical-align:top;width:38%;">' +
    label + '</td><td style="font-family:Verdana,Arial,sans-serif;font-size:12px;color:#2d2a26;' +
    'padding:7px 0;border-bottom:1px solid #eeeeee;vertical-align:top;">' + _esc(val) + '</td></tr>';
}

function _responseEmail(rid, posting, d) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var quoteBlock = '';
  if (d.mode === 'quote' && d.quote_amount) {
    quoteBlock =
      '<h2 style="margin:22px 0 8px;font-family:Verdana,Arial,sans-serif;font-size:15px;' +
      'font-weight:bold;color:#2d2a26;border-bottom:2px solid #D22730;padding-bottom:5px;">Their Quote</h2>' +
      '<p style="margin:0 0 4px;font-family:Verdana,Arial,sans-serif;font-size:26px;font-weight:bold;color:#D22730;">' +
      _esc(d.quote_amount) + ' <span style="font-size:13px;font-weight:normal;color:#636466;">' +
      _esc(d.quote_basis || '') + '</span></p>' +
      (d.quote_details ? '<p style="margin:6px 0 0;font-family:Verdana,Arial,sans-serif;font-size:12px;color:#2d2a26;">' +
        _esc(d.quote_details) + '</p>' : '');
  }
  var vendorRows = _kvRow('Account (internal)', posting.account_name) + _kvRow('Company', d.company) + _kvRow('Contact', d.contact_name) +
    _kvRow('Email', d.email) + _kvRow('Phone', d.phone) +
    _kvRow('Vendor packet on file', d.packet_on_file) + _kvRow('Earliest start', d.earliest_start);
  var answerRows = _kvRow('Staffing plan', d.staffing_plan) +
    _kvRow('Supervision & final walk', d.supervision_plan) +
    _kvRow('Training plan', d.training_plan) + _kvRow('Planned crew size', d.crew_size) +
    _kvRow('Equipment they bring', d.equipment) + _kvRow('Trade questions', d.confirmations) +
    _kvRow('Additional questions', d.custom_answers) + _kvRow('Comments', d.comments);
  return '' +
    '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
    '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="600">' +
    '<tr><td style="padding:22px 30px 0;"><img src="' + LOGO + '" width="200" alt="City Wide Facility Solutions" style="display:block;border:0;"></td></tr>' +
    '<tr><td style="padding:18px 30px 30px;">' +
    '<h1 style="margin:0 0 4px;font-family:Verdana,Arial,sans-serif;font-size:19px;font-weight:bold;color:#D22730;">' +
    (d.mode === 'quote' ? 'New Vendor Quote' : 'New Vendor Interest') + '</h1>' +
    '<p style="margin:0 0 18px;font-family:Verdana,Arial,sans-serif;font-size:13px;color:#636466;">' +
    _esc(posting.title) + ' &middot; ' + _esc(posting.region) + ' &middot; Posting ' + _esc(d.posting_id) +
    ' &middot; Response ' + _esc(rid) + '</p>' +
    quoteBlock +
    '<h2 style="margin:22px 0 8px;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#2d2a26;border-bottom:2px solid #D22730;padding-bottom:5px;">The Vendor</h2>' +
    '<table border="0" cellpadding="0" cellspacing="0" width="100%">' + vendorRows + '</table>' +
    (answerRows ? '<h2 style="margin:22px 0 8px;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#2d2a26;border-bottom:2px solid #D22730;padding-bottom:5px;">Their Answers</h2>' +
      '<table border="0" cellpadding="0" cellspacing="0" width="100%">' + answerRows + '</table>' : '') +
    '<table border="0" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>' +
    '<td align="center"><a href="' + ss.getUrl() + '" style="display:inline-block;background-color:#D22730;color:#ffffff;font-family:Verdana,Arial,sans-serif;font-size:13px;font-weight:bold;text-decoration:none;padding:11px 22px;border-radius:4px;">Open the Responses Sheet</a></td>' +
    '<td width="12"></td>' +
    '<td align="center"><a href="' + BOARD_URL + '" style="display:inline-block;background-color:#2d2a26;color:#ffffff;font-family:Verdana,Arial,sans-serif;font-size:13px;font-weight:bold;text-decoration:none;padding:11px 22px;border-radius:4px;">View the Board</a></td>' +
    '</tr></table>' +
    '<p style="margin:18px 0 0;font-family:Verdana,Arial,sans-serif;font-size:11px;color:#999999;">Reply to this email to reach the vendor directly.</p>' +
    '</td></tr></table></td></tr></table>';
}

// ----------------------------------------------------------- invoices ------
function handleInvoice(data) {
  var out = { ok: false };
  if (data.website) { out.ok = true; out.id = 'ok'; return _json(out); } // honeypot
  if (!data.company || !data.contact_name || !data.email || !data.service_month ||
      !data.lines || !data.lines.length) {
    out.error = 'Missing required fields'; return _json(out);
  }
  var lines = [];
  var total = 0;
  for (var i = 0; i < data.lines.length && i < 60; i++) {
    var L = data.lines[i] || {};
    if (!L.account && !L.amount) continue;
    var amt = Number(String(L.amount || '').replace(/[$,\s]/g, ''));
    if (isNaN(amt)) amt = 0;
    total += amt;
    lines.push({
      account: String(L.account || ''), service: String(L.service || ''),
      ref: String(L.ref || ''), amount: amt
    });
  }
  if (!lines.length) { out.error = 'No invoice lines'; return _json(out); }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var iv = ss.getSheetByName(INV_TAB);
  if (!iv) { setupInvoicing(); iv = ss.getSheetByName(INV_TAB); }
  var id = 'INV-' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMddHHmm') +
    '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  var row = INV_HEADERS.map(function (h) {
    if (h === 'invoice_id') return id;
    if (h === 'received') return new Date();
    if (h === 'line_count') return lines.length;
    if (h === 'total') return total;
    if (h === 'lines') return JSON.stringify(lines);
    return (data[h] !== undefined && data[h] !== null) ? String(data[h]) : '';
  });
  iv.getRange(_nextRow(iv), 1, 1, row.length).setValues([row]);

  var pdfName = _invoicePdfName(data, id);
  var pdf = null;
  try {
    pdf = Utilities.newBlob(_invoicePdfHtml(id, data, lines, total), 'text/html', 'inv.html')
      .getAs('application/pdf').setName(pdfName);
  } catch (pdfErr) {}

  var totalStr = _money(total);
  try {
    cwMail_('invoice_int', {
      to: INV_EMAILS,
      replyTo: String(data.email),
      subject: (pdf ? 'Vendor Invoice: ' : 'Vendor Invoice (PDF ATTACHMENT FAILED - see Sheet): ') + data.company + ' | ' + data.service_month +
        ' | ' + totalStr + ' [' + id + ']',
      htmlBody: _invoiceEmail(id, data, lines, total, false),
      body: 'Vendor invoice ' + id + ' from ' + data.company + ' for ' +
        data.service_month + '. Total ' + totalStr + '. PDF attached.',
      attachments: pdf ? [pdf] : []
    });
  } catch (m1) {}
  try {
    cwMail_('invoice_conf', {
      to: String(data.email),
      replyTo: INV_EMAILS,
      subject: 'We received your invoice: ' + data.service_month + ' | ' + totalStr +
        ' [' + id + ']',
      htmlBody: _invoiceEmail(id, data, lines, total, true),
      body: 'City Wide Facility Solutions received your ' + data.service_month +
        ' invoice (' + id + '). Total ' + totalStr + '. A PDF copy is attached.',
      attachments: pdf ? [pdf] : []
    });
  } catch (m2) {}

  out.ok = true; out.id = id;
  return _json(out);
}

function _money(n) {
  var s = Number(n || 0).toFixed(2);
  return '$' + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function _invoicePdfName(d, id) {
  // Match the invoice folder convention: "MM Month YYYY Vendor Name Invoice.pdf"
  var m = String(d.service_month || '');
  var months = ['January','February','March','April','May','June','July','August',
    'September','October','November','December'];
  var prefix = m;
  for (var i = 0; i < months.length; i++) {
    if (m.indexOf(months[i]) === 0) {
      prefix = ('0' + (i + 1)).slice(-2) + ' ' + m;
      break;
    }
  }
  return (prefix + ' ' + (d.company || 'Vendor') + ' Invoice.pdf')
    .replace(/[\\/:*?"<>|]/g, '-');
}

function _invLineRows(lines) {
  var rows = '';
  for (var i = 0; i < lines.length; i++) {
    var L = lines[i];
    rows += '<tr>' +
      '<td style="font-family:Verdana,Arial,sans-serif;font-size:11px;color:#2d2a26;padding:7px 8px;border-bottom:1px solid #eeeeee;">' + (i + 1) + '</td>' +
      '<td style="font-family:Verdana,Arial,sans-serif;font-size:11px;color:#2d2a26;padding:7px 8px;border-bottom:1px solid #eeeeee;">' + _esc(L.account) + '</td>' +
      '<td style="font-family:Verdana,Arial,sans-serif;font-size:11px;color:#2d2a26;padding:7px 8px;border-bottom:1px solid #eeeeee;">' + _esc(L.service) + '</td>' +
      '<td style="font-family:Verdana,Arial,sans-serif;font-size:11px;color:#2d2a26;padding:7px 8px;border-bottom:1px solid #eeeeee;">' + _esc(L.ref) + '</td>' +
      '<td align="right" style="font-family:Verdana,Arial,sans-serif;font-size:11px;color:#2d2a26;padding:7px 8px;border-bottom:1px solid #eeeeee;white-space:nowrap;">' + _money(L.amount) + '</td>' +
      '</tr>';
  }
  return rows;
}

function _invHeadCell(t, align) {
  return '<td align="' + (align || 'left') + '" style="font-family:Verdana,Arial,sans-serif;' +
    'font-size:10px;font-weight:bold;color:#ffffff;background-color:#2d2a26;' +
    'padding:8px;text-transform:uppercase;letter-spacing:0.05em;">' + t + '</td>';
}

function _invoicePdfHtml(id, d, lines, total) {
  // The PDF is the VENDOR's invoice to City Wide: vendor branding up top,
  // never the City Wide logo. Vendor logo (small data URI) if provided,
  // otherwise their company name in large type.
  var brand;
  var lg = String(d.logo || '');
  if (lg.indexOf('data:image/') === 0 && lg.length < 400000) {
    brand = '<img src="' + lg + '" alt="' + _esc(d.company) + '" ' +
      'style="display:block;border:0;max-height:70px;max-width:260px;">';
  } else {
    brand = '<div style="font-family:Verdana,Arial,sans-serif;font-size:24px;' +
      'font-weight:bold;color:#2d2a26;line-height:1.2;max-width:340px;">' +
      _esc(d.company) + '</div>';
  }
  return '<html><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:36px;background:#ffffff;">' +
    '<table border="0" cellpadding="0" cellspacing="0" width="100%">' +
    '<tr><td>' + brand + '</td>' +
    '<td align="right" style="font-family:Verdana,Arial,sans-serif;font-size:26px;font-weight:bold;color:#2d2a26;">INVOICE</td></tr>' +
    '</table>' +
    '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top:26px;">' +
    '<tr>' +
    '<td valign="top" style="font-family:Verdana,Arial,sans-serif;font-size:11px;color:#2d2a26;line-height:1.6;">' +
    '<b style="color:#636466;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;">From</b><br>' +
    '<b>' + _esc(d.company) + '</b><br>' + _esc(d.company_address || '') + '<br>' +
    _esc(d.contact_name) + '<br>' + _esc(d.email) + (d.phone ? '<br>' + _esc(d.phone) : '') + '</td>' +
    '<td valign="top" style="font-family:Verdana,Arial,sans-serif;font-size:11px;color:#2d2a26;line-height:1.6;">' +
    '<b style="color:#636466;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;">Bill To</b><br>' +
    '<b>City Wide Facility Solutions</b><br>Attention: Accounts Payable<br>' +
    _esc(d.region || 'Las Vegas / Northern Nevada') + '</td>' +
    '<td valign="top" align="right" style="font-family:Verdana,Arial,sans-serif;font-size:11px;color:#2d2a26;line-height:1.6;">' +
    '<b style="color:#636466;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;">Invoice</b><br>' +
    'Number: ' + _esc(id) + '<br>Service Month: <b>' + _esc(d.service_month) + '</b><br>' +
    'Submitted: ' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MM/dd/yyyy') + '<br>' +
    'Terms: Net 10th Prox</td>' +
    '</tr></table>' +
    '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top:26px;">' +
    '<tr>' + _invHeadCell('#') + _invHeadCell('Account / Address') + _invHeadCell('Service') +
    _invHeadCell('Work Order #') + _invHeadCell('Amount', 'right') + '</tr>' +
    _invLineRows(lines) +
    '<tr><td colspan="3"></td>' +
    '<td style="font-family:Verdana,Arial,sans-serif;font-size:13px;font-weight:bold;color:#2d2a26;padding:12px 8px;">TOTAL</td>' +
    '<td align="right" style="font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#2d2a26;padding:12px 8px;white-space:nowrap;">' + _money(total) + '</td></tr>' +
    '</table>' +
    (d.comments ? '<p style="font-family:Verdana,Arial,sans-serif;font-size:10px;color:#636466;margin-top:18px;"><b>Notes:</b> ' + _esc(d.comments) + '</p>' : '') +
    '<p style="font-family:Verdana,Arial,sans-serif;font-size:9px;color:#999999;margin-top:30px;border-top:1px solid #eeeeee;padding-top:10px;">' +
    'Submitted through the City Wide Vendor Resource Center. Reference ' + _esc(id) +
    ' on any questions. Payment terms Net 10th Prox.</p>' +
    '</body></html>';
}

function _invoiceEmail(id, d, lines, total, forVendor) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var intro = forVendor
    ? '<h1 style="margin:0 0 4px;font-family:Verdana,Arial,sans-serif;font-size:19px;font-weight:bold;color:#D22730;">We Received Your Invoice</h1>' +
      '<p style="margin:0 0 18px;font-family:Verdana,Arial,sans-serif;font-size:13px;color:#636466;">' +
      'Thank you, ' + _esc(d.contact_name) + '. Your ' + _esc(d.service_month) +
      ' invoice is in with City Wide Accounts Payable. A PDF copy is attached for your records. ' +
      'Payment terms are Net 10th Prox. Reference ' + _esc(id) + ' on any questions.</p>'
    : '<h1 style="margin:0 0 4px;font-family:Verdana,Arial,sans-serif;font-size:19px;font-weight:bold;color:#D22730;">New Vendor Invoice</h1>' +
      '<p style="margin:0 0 18px;font-family:Verdana,Arial,sans-serif;font-size:13px;color:#636466;">' +
      _esc(d.company) + ' &middot; ' + _esc(d.service_month) + ' &middot; ' + _esc(id) +
      ' &middot; PDF attached</p>';
  var infoRows = _kvRow('Company', d.company) + _kvRow('Contact', d.contact_name) +
    _kvRow('Email', d.email) + _kvRow('Phone', d.phone) +
    _kvRow('Region', d.region) + _kvRow('Service Month', d.service_month) +
    _kvRow('Comments', d.comments);
  return '' +
    '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
    '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="640">' +
    '<tr><td style="padding:22px 30px 0;"><img src="' + LOGO + '" width="200" alt="City Wide Facility Solutions" style="display:block;border:0;"></td></tr>' +
    '<tr><td style="padding:18px 30px 30px;">' + intro +
    '<table border="0" cellpadding="0" cellspacing="0" width="100%">' +
    '<tr>' + _invHeadCell('#') + _invHeadCell('Account / Address') + _invHeadCell('Service') +
    _invHeadCell('Work Order #') + _invHeadCell('Amount', 'right') + '</tr>' +
    _invLineRows(lines) +
    '<tr><td colspan="3"></td>' +
    '<td style="font-family:Verdana,Arial,sans-serif;font-size:13px;font-weight:bold;color:#2d2a26;padding:12px 8px;">TOTAL</td>' +
    '<td align="right" style="font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#D22730;padding:12px 8px;white-space:nowrap;">' + _money(total) + '</td></tr>' +
    '</table>' +
    (forVendor ? '' :
      '<h2 style="margin:22px 0 8px;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#2d2a26;border-bottom:2px solid #D22730;padding-bottom:5px;">The Vendor</h2>' +
      '<table border="0" cellpadding="0" cellspacing="0" width="100%">' + infoRows + '</table>' +
      '<table border="0" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>' +
      '<td align="center"><a href="' + ss.getUrl() + '" style="display:inline-block;background-color:#D22730;color:#ffffff;font-family:Verdana,Arial,sans-serif;font-size:13px;font-weight:bold;text-decoration:none;padding:11px 22px;border-radius:4px;">Open the Invoices Sheet</a></td>' +
      '</tr></table>' +
      '<p style="margin:18px 0 0;font-family:Verdana,Arial,sans-serif;font-size:11px;color:#999999;">Reply to this email to reach the vendor directly.</p>') +
    '</td></tr></table></td></tr></table>';
}

// -------------------------------------------------- building supply orders --
function handleSupplyOrder(data) {
  var out = { ok: false };
  if (data.website) { out.ok = true; out.id = 'ok'; return _json(out); } // honeypot
  if (!data.requester || !data.email || !data.building || !data.region ||
      !data.items || !data.items.length) {
    out.error = 'Missing required fields'; return _json(out);
  }
  var items = [];
  var subtotal = 0;
  for (var i = 0; i < data.items.length && i < 80; i++) {
    var it = data.items[i] || {};
    var qty = Math.max(1, Math.min(99, Number(it.qty) || 1));
    var price = Number(it.price) || 0;
    subtotal += price * qty;
    items.push({ name: String(it.name || ''), qty: qty, price: price });
  }
  if (!items.length) { out.error = 'No items selected'; return _json(out); }

  var ss = supSS_();
  var sp = ss.getSheetByName(SUP_TAB);
  if (!sp) { setupInvoicing(); sp = ss.getSheetByName(SUP_TAB); }
  var id = 'SUP-' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMddHHmm') +
    '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  var row = SUP_HEADERS.map(function (h) {
    if (h === 'order_id') return id;
    if (h === 'received') return new Date();
    if (h === 'item_count') return items.length;
    if (h === 'subtotal') return subtotal;
    if (h === 'items') return JSON.stringify(items);
    return (data[h] !== undefined && data[h] !== null) ? String(data[h]) : '';
  });
  sp.getRange(_nextRow(sp), 1, 1, row.length).setValues([row]);

  var to = REGION_EMAIL[data.region] || REGION_EMAIL['Las Vegas'];
  try {
    cwMail_('supply_int', {
      to: to,
      replyTo: String(data.email),
      subject: 'Building Supply Order: ' + data.building + ' [' + id + ']',
      htmlBody: _supplyEmail(id, data, items, subtotal, false),
      body: 'Building supply order ' + id + ' for ' + data.building + ' from ' +
        (data.requester || '') + '. Open the CW Solicitations sheet, Supply Orders tab.'
    });
  } catch (m1) {}
  try {
    cwMail_('supply_conf', {
      to: String(data.email),
      replyTo: to,
      subject: 'Order received: building supplies for ' + data.building + ' [' + id + ']',
      htmlBody: _supplyEmail(id, data, items, subtotal, true),
      body: 'City Wide received your building supply order ' + id + ' for ' +
        data.building + '. Reply to this email with photos of your dispensers if needed.'
    });
  } catch (m2) {}

  out.ok = true; out.id = id;
  return _json(out);
}

function _supplyEmail(id, d, items, subtotal, forVendor) {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var rows = '';
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    rows += '<tr>' +
      '<td style="font-family:Verdana,Arial,sans-serif;font-size:12px;color:#2d2a26;padding:7px 8px;border-bottom:1px solid #eeeeee;">' + _esc(it.name) + '</td>' +
      '<td align="center" style="font-family:Verdana,Arial,sans-serif;font-size:12px;color:#2d2a26;padding:7px 8px;border-bottom:1px solid #eeeeee;">' + it.qty + '</td>' +
      '<td align="right" style="font-family:Verdana,Arial,sans-serif;font-size:12px;color:#2d2a26;padding:7px 8px;border-bottom:1px solid #eeeeee;white-space:nowrap;">' +
      (it.price > 0 ? _money(it.price * it.qty) : 'Priced at fulfillment') + '</td></tr>';
  }
  var intro = forVendor
    ? '<h1 style="margin:0 0 4px;font-family:Verdana,Arial,sans-serif;font-size:19px;font-weight:bold;color:#D22730;">Order Received</h1>' +
      '<p style="margin:0 0 18px;font-family:Verdana,Arial,sans-serif;font-size:13px;color:#636466;">' +
      'Thanks, ' + _esc(d.requester) + '. Your building supply order for <b>' + _esc(d.building) +
      '</b> is in. The City Wide team will confirm availability and delivery. ' +
      'If any items need dispenser matching, reply to this email with photos of the dispensers. ' +
      'Reference ' + _esc(id) + '.</p>'
    : '<h1 style="margin:0 0 4px;font-family:Verdana,Arial,sans-serif;font-size:19px;font-weight:bold;color:#D22730;">New Building Supply Order</h1>' +
      '<p style="margin:0 0 18px;font-family:Verdana,Arial,sans-serif;font-size:13px;color:#636466;">' +
      _esc(d.building) + ' &middot; ' + _esc(d.region) + ' &middot; ' + _esc(id) + '</p>';
  var infoRows = _kvRow('Building / Location', d.building) + _kvRow('Region', d.region) +
    _kvRow('Requested by', d.requester) + _kvRow('Email', d.email) + _kvRow('Phone', d.phone) +
    _kvRow('Comments', d.comments);
  return '' +
    '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
    '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="620">' +
    '<tr><td style="padding:22px 30px 0;"><img src="' + LOGO + '" width="200" alt="City Wide Facility Solutions" style="display:block;border:0;"></td></tr>' +
    '<tr><td style="padding:18px 30px 30px;">' + intro +
    '<table border="0" cellpadding="0" cellspacing="0" width="100%">' +
    '<tr>' + _invHeadCell('Item') + _invHeadCell('Qty', 'center') + _invHeadCell('Price', 'right') + '</tr>' +
    rows +
    '<tr><td></td>' +
    '<td style="font-family:Verdana,Arial,sans-serif;font-size:13px;font-weight:bold;color:#2d2a26;padding:12px 8px;">SUBTOTAL</td>' +
    '<td align="right" style="font-family:Verdana,Arial,sans-serif;font-size:14px;font-weight:bold;color:#D22730;padding:12px 8px;white-space:nowrap;">' + _money(subtotal) + '</td></tr>' +
    '</table>' +
    '<p style="margin:8px 0 0;font-family:Verdana,Arial,sans-serif;font-size:11px;color:#999999;">Standard items are priced when fulfilled. Pricing may exclude applicable taxes.</p>' +
    (forVendor ? '' :
      '<h2 style="margin:22px 0 8px;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;color:#2d2a26;border-bottom:2px solid #D22730;padding-bottom:5px;">The Request</h2>' +
      '<table border="0" cellpadding="0" cellspacing="0" width="100%">' + infoRows + '</table>' +
      '<table border="0" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr>' +
      '<td align="center"><a href="' + ss.getUrl() + '" style="display:inline-block;background-color:#D22730;color:#ffffff;font-family:Verdana,Arial,sans-serif;font-size:13px;font-weight:bold;text-decoration:none;padding:11px 22px;border-radius:4px;">Open the Supply Orders Sheet</a></td>' +
      '</tr></table>' +
      '<p style="margin:18px 0 0;font-family:Verdana,Arial,sans-serif;font-size:11px;color:#999999;">Reply to this email to reach the requester directly.</p>') +
    '</td></tr></table></td></tr></table>';
}

// ---------------------------------------------------------------- feed -----
function doGet(e) {
  try { cwMaybeDigest_(); } catch(_cwd){}
  if (e && e.parameter && e.parameter.sales) return handleSalesFeed();
  var _tp = (e && e.parameter) || {};
  if (_tp.turn && typeof handleTurnGet === 'function') return handleTurnGet(_tp);
  var _calcTools = ['landscape','pressure','restaurant','porter'];
  for (var _ci = 0; _ci < _calcTools.length; _ci++) { if (_tp[_calcTools[_ci]]) return handleCalcList(_calcTools[_ci], _tp[_calcTools[_ci]]); }
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(TAB);
  var values = sh.getDataRange().getValues();
  var head = values[0];
  var items = [];
  for (var i = 1; i < values.length; i++) {
    var rowObj = {};
    for (var c = 0; c < head.length; c++) {
      var cell = values[i][c];
      if (cell instanceof Date) {
        // Sheets auto-converts date-looking cells; render MM/dd/yyyy, time only if set
        var hm = Utilities.formatDate(cell, 'America/Los_Angeles', 'H:m');
        cell = Utilities.formatDate(cell, 'America/Los_Angeles',
          hm === '0:0' ? 'MM/dd/yyyy' : 'MM/dd/yyyy h:mm a');
      }
      rowObj[head[c]] = cell;
    }
    if (rowObj.filled === true || String(rowObj.filled).toUpperCase() === 'TRUE') continue;
    if (!rowObj.id) continue;
    delete rowObj.filled;
    delete rowObj.responses;
    delete rowObj.account_name; // INTERNAL: never expose to vendors
    delete rowObj.notes;
    items.push(rowObj);
  }
  items.forEach(function (it) {
    if (it.fsm && FSM_ROSTER[it.fsm]) it.fsm_info = FSM_ROSTER[it.fsm];
    delete it.contact_phone; delete it.contact_email;
  });
  return _json({ ok: true, count: items.length, items: items });
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
// Ops Hub gate: POST {kind:'auth', passcode} -> link directory.
// The hub links live HERE, not in the public cw-ops-desk repo,
// so only someone with the team passcode can see them.
// ============================================================
var HUB_SECTIONS = [
 { h:'Vendor Solicitations', tag:'Find the Crew',
   sub:'Post work, watch responses come in, and close it out when it fills.',
   cards:[
   { icon:'plus', primary:true, title:'Post an Opportunity', href:'post.html',
     desc:'Contracts and one-time projects. Composes the vendor response form and goes live on the board instantly.', go:'Open the form' },
    { icon:'mail', title:'Request an IC Walkthrough Email',
      href:'https://form.asana.com/?k=lnuBJNlGrHJNAeW8QWbXzA&d=13140959242873',
      desc:'New start or re-start? Send marketing the account details and they build the vendor invite email for the walkthrough.',
      go:'Request the email' },
   { icon:'board', pill:true, title:'Live Opportunities Board', href:'https://citywidelv.github.io/cw-vendor-shop/opportunities.html',
     desc:'What vendors see right now. Check your posting rendered the way you meant it.', go:'View the board' },
   { icon: 'sheet', title: 'Vendor Responses', href: 'responses.html',
      desc: 'Every interest letter and quote as a full readable page, with a PDF for the file. No more squinting at Sheet rows.',
      go: 'Read responses' },
    { icon:'sheet', title:'Solicitations Sheet', href:'https://docs.google.com/spreadsheets/d/1ymbqR7LMvA7sbgZe2Ro5o2dNiXhP08Tn9Hw1b-H5AeQ/edit',
     desc:'Postings and vendor responses side by side. Check Filled to take a posting down; edit any cell and the board updates live.', go:'Open the Sheet' }
 ]},
 { h:'Night Manager & Route Outs', tag:'Every Night',
   sub:'Inspections, the nightly route out, and the tools that ride along.',
   cards:[
   { icon:'clip', title:'Night Manager Inspection', href:'https://form.jotform.com/233486327771060',
     desc:'The nightly building inspection form, photos and all.', go:'Open the form' },
   { icon:'route', title:'Night Manager Route Out',
     desc:'One form for all Las Vegas regions. Submissions are open for everyone to view.',
     links:[
      { label:'Route Out Form', href:'https://form.jotform.com/241440730763149' },
      { label:'View Submissions Table', href:'https://www.jotform.com/tables/241440730763149' },
      { label:'Northern Nevada', href:'https://form.jotform.com/team/253234894174059/nnv-night-manager-route-out' }
     ]},
   { icon:'clock', title:'Comprehensive Cancer Work Orders', href:'https://form.jotform.com/252935932465163',
     desc:'Site-specific work order form for the Comprehensive Cancer account.', go:'Open the form' },
   { icon:'bot', title:'Night Manager AI Tool', href:'https://chatgpt.com/g/g-681233262c3c81918605de9bd3edf7be-city-wide-night-manager-tool',
     desc:'The custom GPT trained for night manager questions in the field.', go:'Open the tool' }
 ]},
 { h:'Pricing & Bid Calculators', tag:'Price the Work',
   sub:'Service-specific calculators for quotes, bids, and scope pricing.',
   cards:[
   { icon:'margin', title:'OS Pricing Tool', href:'https://citywidelv.github.io/cw-ops-desk/os-pricing.html',
     desc:'Other Services and Trade Work quotes. 64 rated services, vendor pay and CW price with full overrides, contract discounts, Excel export, and Exhibit A.', go:'Open the tool' },
   { icon:'home', title:'Apartment Turns', href:'https://citywidelv.github.io/apartment-turns/',
     desc:'Full unit turn and make-ready pricing: cleaning, paint, tub reglaze, repairs, and property rate cards.', go:'Open calculator' },
   { icon:'floor', title:'Strip & Wax', href:'https://citywidelv.github.io/strip-and-wax-calculator/',
     desc:'VCT strip and wax floor pricing by square footage and condition.', go:'Open calculator' },
   { icon:'carpet', title:'Carpet Cleaning', href:'https://citywidelv.github.io/Carpet-Cleaning/',
     desc:'Commercial carpet extraction and bonnet pricing.', go:'Open calculator' },
   { icon:'window', title:'Window Cleaning', href:'https://citywidelv.github.io/windowcleaningcalculator/',
     desc:'Pane counts, interior and exterior, high work pricing.', go:'Open calculator' },
   { icon:'pressure', title:'Pressure Washing', href:'https://citywidelv.github.io/powerwashing/',
     desc:'Flatwork, buildings, and dumpster pads across Nevada markets.', go:'Open calculator' },
   { icon:'postcon', title:'Post-Construction Clean', href:'https://citywidelv.github.io/post-construction-clean/',
     desc:'Rough, final, and touch-up phase cleaning bids.', go:'Open calculator' },
   { icon:'rest', title:'Restaurant Cleaning', href:'https://citywidelv.github.io/restaurants/',
     desc:'Front of house, kitchen, and hood-adjacent service pricing.', go:'Open calculator' },
   { icon:'land', title:'Landscaping Maintenance', href:'https://citywidelv.github.io/landscapingmaintenance/',
     desc:'Commercial grounds maintenance for Nevada markets.', go:'Open calculator' },
   { icon:'porter', title:'Exterior Porter', href:'https://citywidelv.github.io/porter-exterior/',
     desc:'Exterior porter service coverage and pricing.', go:'Open calculator' }
 ]},
 { h:'Analysis & Field Tools', tag:'Know Your Numbers',
   sub:'Margin checks, retention tracking, and the building walk.',
   cards:[
   { icon:'margin', title:'Margin Calculator', href:'https://citywidelv.github.io/margincalculator/',
     desc:'Check the margin before you commit the price. Works for any pay and bill combination.', go:'Open calculator' },
   { icon:'trend', title:'Revenue Retention (TRR)', href:'https://citywidelv.github.io/retentioncalculator/',
     desc:'Total revenue retention tracking across the book of business.', go:'Open calculator' },
   { icon:'survey', title:'Building Survey', href:'https://citywidelv.github.io/BuildingSurvey/',
     desc:'Walk the building and capture what workloading and bidding need.', go:'Open the survey' }
 ]},
 { h:'Team & Admin', tag:'The Back Office',
   sub:'The maps, the tasks, the payroll portal, and the swag.',
   cards:[
   { icon:'map', title:'Accounts Maps',
     desc:'Every account pinned on the map. Plan routes and walkthroughs.',
     links:[
      { label:'Las Vegas', href:'https://www.google.com/maps/d/edit?mid=1ewhUmSrFCo0--ALiJP0O1pLTbH0qlk4&usp=sharing' },
      { label:'Northern Nevada', href:'https://www.google.com/maps/d/u/0/viewer?ll=39.31045610315164%2C-119.69410335&z=10&mid=1_o8DPUf6zH9kiAcZuNEOCAbZLq93nnc' }
     ]},
   { icon:'asana', title:'Asana', href:'https://app.asana.com/',
     desc:'Team tasks and projects.', go:'Open Asana' },
   { icon:'adp', title:'ADP TotalSource', href:'https://online.adp.com/signin/v1/?APPID=WFNPortal&productId=80e309c3-7085-bae1-e053-3505430b5495&returnURL=https://workforcenow.adp.com/&callingAppId=WFN',
     desc:'Payroll, HR, and time off.', go:'Sign in' },
   { icon:'merch', title:'Order CW Merch', href:'https://cwlv.printful.me/',
     desc:'Branded gear for the team.', go:'Open the store' },
   { icon:'merch', title:'Employee Uniform Storefront', href:'https://citywidelv.github.io/cw-ops-desk/uniforms.html',
     desc:'All 272 Bennett uniform items, synced nightly. Employees pick logo, color and size, then submit a request for approval.', go:'Open the storefront' }
 ]},
 { h:'Vendor Resource Center', tag:'What Vendors See',
   sub:'The public site your crews use. Handy when you are walking a vendor through it on the phone.',
   cards:[
   { icon:'home', title:'Resource Center Home', href:'https://citywidelv.github.io/cw-vendor-shop/resources.html',
     desc:'The hub: guides, planner, opportunities, and the shop.', go:'Open the site' },
   { icon:'work', title:'Workloading Guide', href:'https://citywidelv.github.io/cw-vendor-shop/workloading.html',
     desc:'ISSA rates, crew sizing, and the first three cleans playbook.', go:'Open the guide' },
   { icon:'plan', title:'New Building Planner', href:'https://citywidelv.github.io/cw-vendor-shop/planner.html',
     desc:'Starting kit quantities by building size and cleaning type.', go:'Open the planner' },
   { icon:'shop', title:'Vendor Shop', href:'https://citywidelv.github.io/cw-vendor-shop/',
     desc:'Supplies, equipment, and uniforms. Orders hit both service inboxes.', go:'Open the shop' }
 ]}
];

// Added 2026-07-15: vendor packet requests, Exhibit A, CRM and billing tools + hub ribbon nav
var PACKET_LINKS = [
  { label: 'Janitorial - Las Vegas', href: 'https://form.asana.com/?k=RdHag7PTO7L2imrLsWCCVQ&d=13140959242873' },
  { label: 'Other Services - Las Vegas', href: 'https://form.asana.com/?k=uX5QbBSefsA-Gq34EmjeJA&d=13140959242873' },
  { label: 'Janitorial - Northern NV', href: 'https://form.asana.com/?k=fF2mqfxy9BFvXbF-pnLYJA&d=13140959242873' },
  { label: 'Other Services - Northern NV', href: 'https://form.asana.com/?k=J4_mbPCYb_6P2MesPMxUPw&d=13140959242873' }
];
var EXHIBIT_A_URL = 'https://form.asana.com/?k=Ch8IqpDXjkcNqdqvjV5-oA&d=13140959242873';
var CRM_LINKS = [
  { label: 'Open CW Sales CRM', href: 'https://gocitywide.crm.dynamics.com/main.aspx' },
  { label: 'Supply Sales: Create Supply Invoice', href: 'https://supplysales.powerappsportals.com/SignIn?ReturnUrl=%2FCustomer-Select%2F' },
  { label: 'Supply Sales: Request a Supply Item', href: 'https://form.jotform.com/tjroberts/supply-item-request-for-field-sales' },
  { label: 'Create an Extra Charge', href: 'https://apps.powerapps.com/play/e/58e2128b-deac-e675-8cd1-7d879ca63711/a/a052bc89-2125-4efd-88e5-682f1d2dbcd0?tenantId=3b214a92-dd33-4a9c-a070-43f6783d144c&hint=a842db25-40d4-46c0-b151-6ad085ee7345&sourcetime=1756059511414&source=portal' }
];
function _hubSec(tag){
  for (var i = 0; i < HUB_SECTIONS.length; i++) if (HUB_SECTIONS[i].tag === tag) return HUB_SECTIONS[i];
  return HUB_SECTIONS[0];
}
_hubSec('Find the Crew').cards.push({
  icon: 'mail', title: 'Send a Vendor Packet',
  desc: 'Request the vendor packet go out to a potential new IC. Pick the service type and region; the request routes through Asana.',
  links: PACKET_LINKS
}, {
  icon: 'clip', title: 'Exhibit A Request',
  desc: 'Las Vegas only. Sends the DOO everything he needs to format and send the Exhibit A for a new contract.',
  href: EXHIBIT_A_URL, go: 'Request the Exhibit A'
});
_hubSec('The Back Office').cards.push({
  icon: 'work', title: 'CRM & Billing',
  desc: 'Dynamics CRM plus the FSM billing tools inside it: Supply Sales creates the actual supply invoice, field sales requests supply items and special pricing, and extra charges get processed here.',
  links: CRM_LINKS
});
var HUB_NAV = [
  { label: 'Post an Opportunity', href: 'post.html' },
  { label: 'Vendor Packets', items: PACKET_LINKS },
  { label: 'Exhibit A (LV)', href: EXHIBIT_A_URL },
  { label: 'CRM & Billing', items: CRM_LINKS }
];

  var HUB_PASSCODE = '__REDACTED__';
function handleAuth(data) {
  if (String(data.passcode || '') !== HUB_PASSCODE) {
    return _json({ ok: false, error: 'That passcode is not right. Ask TJ if you need it.' });
  }
  return _json({ ok: true, announcements: _annList(), sections: HUB_SECTIONS, nav: HUB_NAV });
}


// ===== Vendor response PDFs + Ops Hub responses viewer (added 2026-07-15) =====
function _folder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function _saveResponsePdf(posting, d, rid) {
  var eh = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var tr = function (label, val) {
    if (val === null || val === undefined || String(val).trim() === '') return '';
    return '<tr><td style="padding:8px 12px;border-top:1px solid #E5E5E5;font-size:10px;font-weight:bold;color:#636466;text-transform:uppercase;letter-spacing:.06em;width:190px;vertical-align:top">' + eh(label) + '</td>' +
      '<td style="padding:8px 12px;border-top:1px solid #E5E5E5;font-size:12px;color:#2D2A26;vertical-align:top">' + eh(val).replace(/\n/g, '<br>') + '</td></tr>';
  };
  var isQuote = String(d.mode || '').toLowerCase() === 'quote';
  var f = (posting && posting.fsm && FSM_ROSTER[posting.fsm]) ? FSM_ROSTER[posting.fsm] : null;
  var html = '<html><body style="font-family:Verdana,Geneva,sans-serif;color:#2D2A26;margin:28px">'
    + '<img src="' + LOGO + '" style="height:34px" alt="City Wide Facility Solutions">'
    + '<div style="height:4px;background:#D22730;margin:14px 0 18px"></div>'
    + '<div style="font-size:10px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;color:#636466">'
    + (isQuote ? 'Vendor Quote' : 'Vendor Interest Letter') + ' &middot; ' + eh(rid) + '</div>'
    + '<h1 style="font-size:19px;margin:4px 0 2px">' + eh(d.company || d.contact_name || 'Vendor') + '</h1>'
    + '<div style="font-size:12px;color:#636466;margin-bottom:16px">For posting ' + eh((posting && posting.id) || d.posting_id || '') + ': ' + eh((posting && posting.title) || '') + '</div>'
    + '<table style="border-collapse:collapse;width:100%;border:1px solid #E5E5E5">'
    + tr('Received', new Date())
    + tr('Contact', (d.contact_name || '') + (d.email ? ' | ' + d.email : '') + (d.phone ? ' | ' + d.phone : ''))
    + tr('Vendor packet on file', d.packet_on_file)
    + tr('Earliest start', d.earliest_start)
    + tr('Staffing plan', d.staffing_plan)
    + tr('Crew size', d.crew_size)
    + tr('Supervision: who performs the final walk', d.supervision_plan)
    + tr('Who trains the crew', d.training_plan)
    + tr('Equipment they bring', d.equipment)
    + tr('Trade questions', d.confirmations)
    + (isQuote ? tr('Quote', String(d.quote_amount || '') + (d.quote_basis ? ' ' + d.quote_basis : '')) : '')
    + (isQuote ? tr('Quote includes', d.quote_details) : '')
    + tr('Comments', d.comments)
    + '</table>'
    + (f ? '<div style="font-size:11px;color:#636466;margin-top:18px">Posting FSM: <b style="color:#2D2A26">' + eh(f.name) + '</b>, ' + eh(f.title) + ' &middot; ' + eh(f.region) + '</div>' : '')
    + '<div style="font-size:9px;color:#999;margin-top:24px;border-top:1px solid #E5E5E5;padding-top:8px">City Wide Facility Solutions &middot; Internal document &middot; GoCityWide.com</div>'
    + '</body></html>';
  var blob = Utilities.newBlob(html, 'text/html', 'resp.html').getAs('application/pdf');
  blob.setName(String(rid) + ' - ' + String(d.company || d.contact_name || 'Vendor').replace(/[\\/:*?"<>|]/g, '') + '.pdf');
  var root = _folder(DriveApp.getRootFolder(), 'CW Vendor Responses');
  var sub = _folder(root, (String((posting && posting.id) || d.posting_id || 'unknown') + ' - ' + String((posting && posting.title) || '')).slice(0, 80).replace(/[\\/:*?"<>|]/g, ''));
  var file = sub.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function handleResponsesList(data) {
  if (String(data.passcode || '') !== PASSCODE) return _json({ ok: false, error: 'Wrong passcode.' });
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var read = function (tabName, keyField) {
    var sh = ss.getSheetByName(tabName);
    if (!sh) return [];
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return [];
    var head = values[0];
    var out = [];
    for (var i = 1; i < values.length; i++) {
      var o = {};
      for (var c = 0; c < head.length; c++) {
        var v0 = values[i][c];
        o[head[c]] = (v0 instanceof Date) ? Utilities.formatDate(v0, Session.getScriptTimeZone(), 'MMM d, yyyy h:mm a') : v0;
      }
      if (String(o[keyField] || '').trim() !== '') out.push(o);
    }
    return out;
  };
  return _json({ ok: true, postings: read(TAB, 'id'), responses: read(RESP_TAB, 'response_id') });
}


// ------------------------------------------------- vendor directory -----
// Tab of vendor emails grouped by trade + region. Populated by the team.
// Drives the "Notify Available Vendors" button on the Ops Desk posting form
// for one-time projects. Run setupVendorDirectory() once to create the tab.
var VENDOR_TAB = 'Vendor Directory';
var VENDOR_HEADERS = ['company', 'contact_name', 'email', 'phone', 'region', 'trades', 'active', 'notes'];
var VENDOR_TRADES = ['Janitorial', 'Day Porter', 'Floor Care (Strip & Wax / Buff)',
  'Carpet Cleaning', 'Window Cleaning', 'Pressure Washing', 'Landscaping',
  'Tree Trimming / Palms', 'Security / Guard Services', 'Street Sweeping',
  'Parking Lot Services', 'Handyman / Repairs', 'Post-Construction Clean',
  'Specialty (Medical / Clean Room / GMP)', 'Other'];

function setupVendorDirectory() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(VENDOR_TAB);
  if (!sh) sh = ss.insertSheet(VENDOR_TAB);
  sh.getRange(1, 1, 1, VENDOR_HEADERS.length).setValues([VENDOR_HEADERS])
    .setFontWeight('bold').setBackground('#2D2A26').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  var cbRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sh.getRange(2, VENDOR_HEADERS.indexOf('active') + 1, 999, 1).setDataValidation(cbRule);
  var regionRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Las Vegas', 'Northern Nevada', 'Both'], true)
    .setAllowInvalid(true).build();
  sh.getRange(2, VENDOR_HEADERS.indexOf('region') + 1, 999, 1).setDataValidation(regionRule);
  sh.getRange(1, VENDOR_HEADERS.indexOf('trades') + 1).setNote(
    'Comma-separated. Use these exact names so matching works:\n' +
    VENDOR_TRADES.join('\n') + '\n\nOr write: All Trades');
  sh.getRange(1, VENDOR_HEADERS.indexOf('active') + 1).setNote(
    'Checked = vendor gets included in notify emails. Uncheck to pause a vendor without deleting the row.');
  sh.setColumnWidth(VENDOR_HEADERS.indexOf('trades') + 1, 320);
}

function _vendorEmails(trade, region) {
  var out = [];
  try {
    var sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(VENDOR_TAB);
    if (!sh) return out;
    var values = sh.getDataRange().getValues();
    if (values.length < 2) return out;
    var head = values[0];
    var cEmail = head.indexOf('email'), cRegion = head.indexOf('region'),
      cTrades = head.indexOf('trades'), cActive = head.indexOf('active');
    if (cEmail < 0 || cTrades < 0) return out;
    var want = String(trade || '').toLowerCase().trim();
    var seen = {};
    for (var i = 1; i < values.length; i++) {
      var email = String(values[i][cEmail] || '').trim();
      if (!email || email.indexOf('@') < 1) continue;
      if (cActive >= 0) {
        var active = values[i][cActive];
        if (!(active === true || String(active).toUpperCase() === 'TRUE')) continue;
      }
      if (cRegion >= 0 && region) {
        var vRegion = String(values[i][cRegion] || '').trim();
        if (vRegion && vRegion !== 'Both' && vRegion !== String(region)) continue;
      }
      var trades = String(values[i][cTrades] || '').split(/[,;\n]/);
      var match = false;
      for (var t = 0; t < trades.length; t++) {
        var tv = trades[t].toLowerCase().trim();
        if (!tv) continue;
        if (tv === 'all trades' || tv === 'all' || tv === want) { match = true; break; }
      }
      if (!match) continue;
      var key = email.toLowerCase();
      if (!seen[key]) { seen[key] = true; out.push(email); }
    }
  } catch (err) {}
  return out;
}

function handleVendorEmails(data) {
  var out = { ok: false };
  if ((data.passcode || '') !== PASSCODE) { out.error = 'Bad passcode'; return _json(out); }
  out.ok = true;
  out.emails = _vendorEmails(data.trade, data.region);
  out.count = out.emails.length;
  return _json(out);
}


function handleVendorSetup(data) {
  var out = { ok: false };
  if ((data.passcode || '') !== PASSCODE) { out.error = 'Bad passcode'; return _json(out); }
  setupVendorDirectory();
  out.ok = true; out.did = 'setupVendorDirectory';
  return _json(out);
}


function _attachNote(name) {
  return '<p style="font-family:Verdana,Arial,sans-serif;font-size:12px;color:#2d2a26;margin:16px 0 0;padding:10px 14px;background:#F5F5F5;border-left:4px solid #D22730;">' +
    '<b style="color:#D22730;">Quote document attached: </b>' + _esc(name) + '</p>';
}


// ------------------------------------------------- uploaded invoices (vendor's own file) ------
function handleInvoiceUpload(data) {
  var out = { ok: false };
  if (data.website) { out.ok = true; out.id = 'ok'; return _json(out); } // honeypot
  if (!data.company || !data.contact_name || !data.email || !data.service_month ||
      !data.file_data || !data.file_name) {
    out.error = 'Missing required fields'; return _json(out);
  }
  var total = Number(String(data.total || '').replace(/[$,\s]/g, ''));
  if (isNaN(total)) total = 0;

  var blob;
  var ct = String(data.file_type || 'application/pdf');
  if (['application/pdf', 'image/png', 'image/jpeg'].indexOf(ct) < 0) {
    out.error = 'Unsupported file type. Please upload a PDF, JPG, or PNG.'; return _json(out);
  }
  try {
    blob = Utilities.newBlob(Utilities.base64Decode(String(data.file_data)), ct,
      String(data.file_name).replace(/[\\\/:*?"<>|]/g, '-'));
  } catch (bErr) { out.error = 'Could not read the uploaded file. Please try again.'; return _json(out); }
  if (blob.getBytes().length > 15 * 1024 * 1024) {
    out.error = 'File is too large. Please keep it under 10 MB.'; return _json(out);
  }

  // AP always gets a PDF: wrap photo uploads (JPG/PNG) into a PDF page
  var attach = blob;
  if (ct !== 'application/pdf') {
    try {
      var imgHtml = '<html><body style="margin:0;padding:0;">' +
        '<img src="data:' + ct + ';base64,' + String(data.file_data) +
        '" style="width:100%;display:block;">' +
        '</body></html>';
      attach = Utilities.newBlob(imgHtml, 'text/html', 'upload.html')
        .getAs('application/pdf')
        .setName(String(blob.getName()).replace(/\.(png|jpe?g)$/i, '') + '.pdf');
    } catch (convErr) { attach = blob; }
  }

  var ss = SpreadsheetApp.openById(SHEET_ID);
  var iv = ss.getSheetByName(INV_TAB);
  if (!iv) { setupInvoicing(); iv = ss.getSheetByName(INV_TAB); }
  var id = 'INV-' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMddHHmm') +
    '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  var row = INV_HEADERS.map(function (h) {
    if (h === 'invoice_id') return id;
    if (h === 'received') return new Date();
    if (h === 'line_count') return 0;
    if (h === 'total') return total;
    if (h === 'lines') return 'UPLOADED FILE: ' + blob.getName();
    return (data[h] !== undefined && data[h] !== null) ? String(data[h]) : '';
  });
  iv.getRange(_nextRow(iv), 1, 1, row.length).setValues([row]);

  var totalStr = _money(total);
  try {
    cwMail_('invup_int', {
      to: INV_EMAILS,
      replyTo: String(data.email),
      subject: 'Vendor Invoice (uploaded): ' + data.company + ' | ' + data.service_month +
        ' | ' + totalStr + ' [' + id + ']',
      htmlBody: _uploadInvoiceEmail(id, data, totalStr, false),
      body: 'Uploaded vendor invoice ' + id + ' from ' + data.company + ' for ' +
        data.service_month + '. Stated total ' + totalStr + '. Vendor file attached.',
      attachments: [attach]
    });
  } catch (m1) {}
  try {
    cwMail_('invup_conf', {
      to: String(data.email),
      replyTo: INV_EMAILS,
      subject: 'We received your invoice: ' + data.service_month + ' | ' + totalStr + ' [' + id + ']',
      htmlBody: _uploadInvoiceEmail(id, data, totalStr, true),
      body: 'City Wide Facility Solutions received your uploaded invoice (' + id + '). ' +
        'Stated total ' + totalStr + '. A copy of your file is attached.',
      attachments: [attach]
    });
  } catch (m2) {}

  out.ok = true; out.id = id;
  return _json(out);
}

function _uploadInvoiceEmail(id, d, totalStr, forVendor) {
  var intro = forVendor
    ? '<h1 style="margin:0 0 4px;font-family:Verdana,Arial,sans-serif;font-size:19px;font-weight:bold;color:#D22730;">We Received Your Invoice</h1>' +
      '<p style="margin:0 0 18px;font-family:Verdana,Arial,sans-serif;font-size:13px;color:#636466;">' +
      'Thank you, ' + _esc(d.contact_name) + '. Your ' + _esc(d.service_month) +
      ' invoice is in with City Wide Accounts Payable, exactly as you uploaded it. ' +
      'Payment terms are Net 10th Prox. Reference ' + _esc(id) + ' on any questions.</p>'
    : '<h1 style="margin:0 0 4px;font-family:Verdana,Arial,sans-serif;font-size:19px;font-weight:bold;color:#D22730;">New Vendor Invoice (Uploaded File)</h1>' +
      '<p style="margin:0 0 18px;font-family:Verdana,Arial,sans-serif;font-size:13px;color:#636466;">' +
      _esc(d.company) + ' &middot; ' + _esc(d.service_month) + ' &middot; ' + _esc(id) +
      ' &middot; the vendor uploaded their own invoice file; it is attached. The total below is as stated by the vendor and has not been checked against the file.</p>';
  var infoRows = _kvRow('Company', d.company) + _kvRow('Contact', d.contact_name) +
    _kvRow('Email', d.email) + _kvRow('Phone', d.phone) +
    _kvRow('Region', d.region) + _kvRow('Service Month', d.service_month) +
    _kvRow('Stated Total', totalStr) + _kvRow('File', d.file_name) +
    _kvRow('Comments', d.comments);
  return '' +
    '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
    '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="640">' +
    '<tr><td style="padding:22px 30px 0;"><img src="' + LOGO + '" width="200" alt="City Wide Facility Solutions" style="display:block;border:0;"></td></tr>' +
    '<tr><td style="padding:18px 30px 30px;">' + intro +
    '<table border="0" cellpadding="0" cellspacing="0" width="100%">' + infoRows + '</table>' +
    '<p style="font-family:Verdana,Arial,sans-serif;font-size:9px;color:#999999;margin-top:30px;border-top:1px solid #eeeeee;padding-top:10px;">' +
    'Submitted through the City Wide Vendor Resource Center. Reference ' + _esc(id) +
    ' on any questions. Payment terms Net 10th Prox.</p>' +
    '</td></tr></table></td></tr></table>';
}
/* ===== Ops Wall announcements (v7, 2026-07-29) ===== */
var ANN_TAB = 'Announcements';
function _annSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(ANN_TAB);
  if (!sh) {
    sh = ss.insertSheet(ANN_TAB);
    sh.appendRow(['id', 'ts', 'name', 'message', 'pinned']);
    sh.setFrozenRows(1);
  }
  return sh;
}
function _annList() {
  try {
    var sh = _annSheet();
    var last = sh.getLastRow();
    if (last < 2) return [];
    var start = Math.max(2, last - 49);
    var rows = sh.getRange(start, 1, last - start + 1, 5).getValues();
    var out = [];
    rows.forEach(function(r) {
      if (!r[0]) return;
      out.push({ id: String(r[0]), ts: (r[1] instanceof Date) ? r[1].toISOString() : String(r[1]),
        name: String(r[2]), message: String(r[3]), pinned: !!r[4] });
    });
    out.reverse();
    return out;
  } catch (e) { return []; }
}
function handleAnnouncement(data) {
  if (String(data.passcode || '') !== PASSCODE) {
    return _json({ ok: false, error: 'Not authorized. Open the hub and sign in again.' });
  }
  var name = String(data.name || '').trim().slice(0, 60);
  var message = String(data.message || '').trim().slice(0, 1000);
  if (!name || !message) return _json({ ok: false, error: 'Name and message are required.' });
  var sh = _annSheet();
  var id = 'A-' + new Date().getTime();
  var ts = new Date();
  sh.appendRow([id, ts, name, message, '']);
  return _json({ ok: true, announcement: { id: id, ts: ts.toISOString(), name: name, message: message, pinned: false } });
}


// ============================================================
// Calculator saved-work store (landscape, pressure, restaurant tools)
// POST kind '<tool>_save' upserts (del:true deletes); GET ?<tool>=<user> lists.
// Added July 2026 with the Landscaping Maintenance rebuild.
// ============================================================
var CALC_SAVES_TAB = 'Calc Saves';
function _calcSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(CALC_SAVES_TAB);
  if (!sh) { sh = ss.insertSheet(CALC_SAVES_TAB); sh.getRange(1, 1, 1, 6).setValues([['tool', 'id', 'user', 'name', 'ts', 'payload']]); }
  return sh;
}
function handleCalcSave(data) {
  var tool = String(data.kind || '').replace(/_save$/, '');
  var id = String(data.id || '');
  var user = String(data.user || '').trim();
  if (!tool || !id || !user) return _json({ ok: false, error: 'Missing tool, id or user' });
  var sh = _calcSheet();
  var values = sh.getDataRange().getValues();
  if (data.del) {
    for (var i = values.length - 1; i >= 1; i--) {
      if (String(values[i][0]) === tool && String(values[i][1]) === id && String(values[i][2]).trim().toLowerCase() === user.toLowerCase()) sh.deleteRow(i + 1);
    }
    return _json({ ok: true, deleted: true });
  }
  var payload = typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload || {});
  var name = String(data.name || 'Untitled').slice(0, 120);
  var ts = String(data.ts || new Date().toISOString());
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === tool && String(values[r][1]) === id) {
      sh.getRange(r + 1, 1, 1, 6).setValues([[tool, id, user, name, ts, payload]]);
      return _json({ ok: true, updated: true });
    }
  }
  sh.appendRow([tool, id, user, name, ts, payload]);
  return _json({ ok: true });
}
function handleCalcList(tool, user) {
  var sh = _calcSheet();
  var values = sh.getDataRange().getValues();
  var items = [];
  var u = String(user || '').trim().toLowerCase();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== tool) continue;
    if (String(values[i][2]).trim().toLowerCase() !== u) continue;
    var ts = values[i][4]; if (ts instanceof Date) ts = ts.toISOString();
    items.push({ id: String(values[i][1]), name: String(values[i][3]), ts: String(ts || ''), payload: String(values[i][5] || '') });
  }
  items.reverse();
  if (items.length > 40) items = items.slice(0, 40);
  return _json({ ok: true, items: items });
}
// ================================================================ EnvirOx ===
// EnvirOx supplier order guide (envirox.html in cw-ops-desk).
// Catalog lives in the ENVIROX_TAB of this Sheet; edit prices/ratios there.
// tiers format: "250:88.79;500:82.23" (weight-floor:price) or "0" = no charge.
// auto format: "hcH*4" | "hcO*1" | "hcAll*1" | "lit:hcH" | "flat10:hcO" | "".
var ENVIROX_TAB = 'EnvirOx Catalog';
var ENVIROX_ORD_TAB = 'EnvirOx Orders';
var ENVIROX_HEADERS = ['sku','name','line','category','pack','uom','lbs','tiers','auto','note','star','active'];
var ENVIROX_ORD_HEADERS = ['order_id','received','requester','email','phone','po','chem_lbs','total','min_met','items','notes','region'];

function setupEnviroxCatalog() {
  var ss = supSS_();
  var sh = ss.getSheetByName(ENVIROX_TAB);
  if (!sh) sh = ss.insertSheet(ENVIROX_TAB);
  sh.getRange(1, 1, 1, ENVIROX_HEADERS.length).setValues([ENVIROX_HEADERS])
    .setFontWeight('bold').setBackground('#2D2A26').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  if (sh.getLastRow() < 2) {
    var seed = ENVIROX_SEED.map(function (r) { return r.concat([1]); });
    sh.getRange(2, 1, seed.length, ENVIROX_HEADERS.length).setValues(seed);
  }
  var os = ss.getSheetByName(ENVIROX_ORD_TAB);
  if (!os) os = ss.insertSheet(ENVIROX_ORD_TAB);
  os.getRange(1, 1, 1, ENVIROX_ORD_HEADERS.length).setValues([ENVIROX_ORD_HEADERS])
    .setFontWeight('bold').setBackground('#D22730').setFontColor('#FFFFFF');
  os.setFrozenRows(1);
  fixDispenserPricing();
}

function handleEnviroxCatalog(data) {
  var out = { ok: false };
  if ((data.passcode || '') !== PASSCODE) { out.error = 'bad_passcode'; return _json(out); }
  var ss = supSS_();
  var sh = ss.getSheetByName(ENVIROX_TAB);
  if (!sh || sh.getLastRow() < 2) { out.error = 'no_catalog'; return _json(out); }
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, ENVIROX_HEADERS.length).getValues();
  var rows = [];
  vals.forEach(function (v) {
    if (String(v[0]) === '') return;
    if (String(v[11]) === '0' || String(v[11]).toLowerCase() === 'false') return;
    rows.push([String(v[0]), String(v[1]), String(v[2]), String(v[3]), String(v[4]),
      String(v[5]), Number(v[6]) || 0, String(v[7]), String(v[8]), String(v[9]),
      Number(v[10]) || 0]);
  });
  out.ok = true; out.rows = rows;
  return _json(out);
}

function handleEnviroxOrder(data) {
  var out = { ok: false };
  if (data.website) { out.ok = true; return _json(out); } // honeypot
  if ((data.passcode || '') !== PASSCODE) { out.error = 'bad_passcode'; return _json(out); }
  if (!data.requester || !data.email) { out.error = 'Missing name or email'; return _json(out); }
  var ss = supSS_();
  var sh = ss.getSheetByName(ENVIROX_ORD_TAB);
  if (!sh) { setupEnviroxCatalog(); sh = ss.getSheetByName(ENVIROX_ORD_TAB); }
  var id = 'EOX-' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd') + '-' +
    Math.random().toString(36).slice(2, 5).toUpperCase();
  var items = (data.items || []);
  var itemsTxt = items.map(function (i) {
    return i.sku + ' x' + i.qty + (i.free ? ' (no charge)' : ' @ $' + Number(i.price).toFixed(2));
  }).join('\n');
  sh.appendRow([id, new Date(), String(data.requester), String(data.email),
    String(data.phone || ''), String(data.po || ''), Number(data.chem_lbs) || 0,
    Number(data.total) || 0, data.min_met ? 'YES' : 'NO', itemsTxt, String(data.notes || ''),
    String(data.region || 'Las Vegas')]);

  var rowsHtml = items.map(function (i) {
    return '<tr><td style="padding:5px 8px;border-bottom:1px solid #eee">' + _esc(i.sku) + '</td>' +
      '<td style="padding:5px 8px;border-bottom:1px solid #eee">' + _esc(i.name) + '</td>' +
      '<td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right">' + Number(i.qty) + '</td>' +
      '<td style="padding:5px 8px;border-bottom:1px solid #eee;text-align:right">' +
      (i.free ? 'No charge' : '$' + (Number(i.price) * Number(i.qty)).toFixed(2)) + '</td></tr>';
  }).join('');
  var minMet = !!data.min_met;
  var html = '<div style="font-family:Verdana,Geneva,sans-serif;font-size:13px;color:#2D2A26;max-width:640px">' +
    '<img src="' + LOGO + '" alt="City Wide Facility Solutions" height="38" style="height:38px;width:auto"><br><br>' +
    '<h2 style="font-size:17px;margin:0 0 4px">EnvirOx order ' + id + ' is ready to send</h2>' +
    '<p style="color:#636466;margin:0 0 14px">Logged from the Ops Desk EnvirOx Order Guide by ' + _esc(data.requester) + '.</p>' +
    '<table style="border-collapse:collapse;width:100%;font-size:12.5px">' +
    '<tr><th style="text-align:left;background:#2D2A26;color:#fff;padding:6px 8px">Item</th>' +
    '<th style="text-align:left;background:#2D2A26;color:#fff;padding:6px 8px">Description</th>' +
    '<th style="text-align:right;background:#2D2A26;color:#fff;padding:6px 8px">Qty</th>' +
    '<th style="text-align:right;background:#2D2A26;color:#fff;padding:6px 8px">Ext</th></tr>' + rowsHtml +
    '<tr><td colspan="3" style="padding:7px 8px;font-weight:bold;border-top:2px solid #2D2A26">Total &middot; ' +
    (Number(data.chem_lbs) || 0) + ' lbs chemical</td>' +
    '<td style="padding:7px 8px;font-weight:bold;text-align:right;border-top:2px solid #2D2A26">$' +
    (Number(data.total) || 0).toFixed(2) + '</td></tr></table>' +
    '<p style="margin:14px 0;padding:10px 14px;border-radius:6px;font-weight:bold;' +
    (minMet ? 'background:#EDF7EF;color:#1E7B34">250 lb chemical minimum met - freight prepaid.'
            : 'background:#FBEAEB;color:#B01F27">UNDER the 250 lb minimum - EnvirOx adds freight below 250 lbs.') + '</p>' +
    (data.po ? '<p style="margin:0 0 4px"><b>PO:</b> ' + _esc(data.po) + '</p>' : '') +
    (data.notes ? '<p style="margin:0 0 14px"><b>Notes:</b> ' + _esc(data.notes) + '</p>' : '') +
    '<div style="border:2px solid #D22730;border-radius:6px;padding:10px 14px;margin-top:6px">' +
    '<b style="color:#D22730;text-transform:uppercase;font-size:11px;letter-spacing:.08em">Send it in</b><br>' +
    'Attach the PDF order sheet (or forward this email) to <b>orders@enviroxclean.com</b>, ' +
    'or call <b>1-800-281-9604</b>, or fax <b>217-442-2568</b>.<br>' +
    'Customer No. <b>' + _esc(data.custno || 'CWLASVEGAS') + '</b> &middot; 1% 20 / Net 30 &middot; R&amp;L Carriers, truck with liftgate, M-F 11 AM-5 PM.<br>' +
    'Ship to: ' + _esc(data.ship_to || '3215 W Charleston Blvd, Suite 130, Las Vegas, NV 89102') + '.</div>' +
    '<p style="color:#636466;font-size:11px;margin-top:14px">City Wide Facility Solutions &middot; Las Vegas &middot; GoCityWide.com</p></div>';
  try {
    cwMail_('envirox', {
      to: String(data.email),
      cc: (REGION_EMAIL[String(data.region || 'Las Vegas')] || 'lvservicecall@gocitywide.com'),
      subject: 'EnvirOx order ' + id + ' (' + String(data.region || 'Las Vegas') + ') - ready to send to EnvirOx',
      htmlBody: html
    });
  } catch (e) {}
  out.ok = true; out.id = id;
  return _json(out);
}

var ENVIROX_SEED = [
["A-112-02H","H2Orange2 Hyper-Concentrate 112 Sanitizer/Virucide Cleaner","H","chem","(2) 1/2 Gal","Case of 2",11,"250:88.79;500:82.23;1000:78.61","","Our standard - Product #1. EPA, NSF C1.",1],
["A-113-02H","Green Certified Multi-Purpose Cleaner Hyper-Concentrate","H","chem","(2) 1/2 Gal","Case of 2",11,"250:76.65;500:70.99;1000:67.04","","Green Seal GS-37, NSF C1.",0],
["A-114-02H","Green Certified Neutral Floor Cleaner Hyper-Concentrate","H","chem","(2) 1/2 Gal","Case of 2",11,"250:71.93;500:66.60;1000:62.51","","Green Seal GS-37.",0],
["A-116-02H","Green Certified H2Orange2 Classic Hyper-Concentrate","H","chem","(2) 1/2 Gal","Case of 2",11,"250:76.65;500:70.99;1000:67.04","","EcoLogo UL2759, NSF C1.",0],
["A-121-02H","Green Certified H2O2 Lavender Multi-Purpose Hyper-Concentrate","H","chem","(2) 1/2 Gal","Case of 2",11,"250:74.48;500:68.96;1000:65.15","","Green Seal GS-37, NSF C1.",0],
["A-130-02H","Green Certified H2O2 Orange Tile & Grout Renovator Hyper-Concentrate","H","chem","(2) 1/2 Gal","Case of 2",11,"250:95.05;500:88.01;1000:84.38","","EcoLogo UL2759, NSF C1.",0],
["A-141-02H","Green Certified Mineral Shock Concentrate","H","chem","(2) 1/2 Gal","Case of 2",11,"250:63.16;500:58.47;1000:56.46","","EcoLogo UL2759.",0],
["A-143-02H","Green Certified Industrial Degreaser Hyper-Concentrate","H","chem","(2) 1/2 Gal","Case of 2",11,"250:48.47;500:44.87;1000:41.01","","EcoLogo UL2759, NSF A1.",0],
["8-272-4PKSQ","H2Orange2 Concentrate 117 Kit - Simple Measures","H","chem","1 Kit","Each",15,"250:101.50;500:96.88;1000:94.37","","Portion-pack starter kit.",0],
["117-06SQ","H2Orange2 Concentrate 117 - Simple Measures","H","chem","(6) 32 oz","Case",15,"250:94.22;500:89.74;1000:87.47","","EPA, NSF C1, CRI.",0],
["115-06SQ","OxiFresh Odor Eliminator - Simple Measures","H","chem","(6) 32 oz","Case",15,"250:62.37;500:65.49;1000:58.65","","Tier prices as published by EnvirOx.",0],
["119-06SQ","LVT Renew - Simple Measures","H","chem","(6) 32 oz","Case",15,"250:78.57;500:74.57;1000:73.09","","EcoLogo, NSF C1.",0],
["A-252-MDD-YGR","Absolute TRIO Dispenser (YGR)","H","disp","1 Count","Each",0,"0","hcAll*1","No charge: EnvirOx earns you 1 dispenser per 2 chemical cases and has credited extras on our past orders.",0],
["A-IN-112-YGR-KIT","Trio Installation Kit - H2Orange2 112","H","kit","1 Count","Each",0,"0","hcH*1","One per new TRIO going on a wall.",0],
["A8-112L","Bottle & Spray Head - Light Duty Green, 112 Silk-Screened","H","bottle","1 Count","Each",0,"250:2.60","hcH*4","",0],
["A8-112H","Bottle & Spray Head - Heavy Duty Red, 112 Silk-Screened","H","bottle","1 Count","Each",0,"250:2.60","hcH*4","",0],
["AS-112","Bottle Sticker - H2Orange2 H-C 112","H","sticker","1 Count","Each",0,"0","hcH*8","One per spray bottle in service.",0],
["A9-112L","Secondary Label - Light Duty Green 112","H","label","1 Count","Each",0,"250:0.27","hcH*4","Extra labels for relabeling bottles.",0],
["A9-112H","Secondary Label - Heavy Duty Red 112","H","label","1 Count","Each",0,"250:0.27","hcH*4","Extra labels for relabeling bottles.",0],
["ACW-112-YGR-1","Wall Chart - H2Orange2 112 YGR TRIO","H","chart","1 Count","Each",0,"0","hcH*1","Hangs next to each TRIO dispenser.",0],
["ACP-112-YGR-PCK","Pocket Chart - 112 YGR TRIO with Lanyard","H","chart","1 Count","Each",0,"0","hcH*1","",0],
["A9-855-112","Product Literature - H2Orange2 H-C 112","H","lit","1 Count","Each",0,"0","lit:hcH","Packs of 25.",0],
["A9-855-BEN","Literature - SIX Great Benefits","H","lit","1 Count","Each",0,"0","lit:hcH","Packs of 25.",0],
["SDS-112","SDS Sheets - H2Orange2 H-C 112","H","sds","1 Count","Each",0,"0","flat10:hcH","No-charge; EnvirOx bills it as MISCNOCHARGE.",0],
["4-252-KEY","Wall Mount Dispenser Key","H","equip","1 Count","Each",0,"250:2.48","","",0],
["7-644-N","Trigger Spray Head (fits 28mm)","H","equip","1 Count","Each",0,"250:1.18","","",0],
["A-145-02H","OxiGenesis Hyper-Concentrate Disinfectant - Light Floral","O","chem","(2) 1/2 Gal","Case of 2",11,"500:104.57;1000:99.98;2000:93.89;5000:88.15;10000:82.44;20000:81.68","","EPA, NSF D1. Zone 3 pricing.",1],
["A-145-02HUN","OxiGenesis Hyper-Concentrate Disinfectant - Fragrance Free","O","chem","(2) 1/2 Gal","Case of 2",11,"500:104.57;1000:99.98;2000:93.89;5000:88.15;10000:82.44;20000:81.68","","EPA, NSF D1. Zone 3 pricing.",0],
["122-06Q","OxiGenesis Disinfectant RTU","O","chem","(6) 32 oz","Case",16,"500:30.70;1000:29.27;2000:27.39;5000:25.63;10000:23.85;20000:23.63","","Ready to use - no dispenser needed.",0],
["122-12Q","OxiGenesis Disinfectant RTU","O","chem","(12) 32 oz","Case",29,"500:55.25;1000:52.71;2000:49.31;5000:46.13;10000:42.95;20000:42.52","","Ready to use - no dispenser needed.",0],
["A-IN-145-YGBR-KIT","Installation Kit - OxiGenesis Hyper-Concentrate","O","kit","1 Count","Each",0,"0","hcO*1","One per dispenser running OxiGenesis.",0],
["A8-145G","OxiGenesis Bottle & Spray Head - Light Duty Green","O","bottle","1 Count","Each",0,"500:2.60","hcO*4","",0],
["A8-145R","OxiGenesis Bottle & Spray Head - Heavy Duty Red","O","bottle","1 Count","Each",0,"500:2.60","hcO*4","",0],
["A8-145B","OxiGenesis Bottle & Spray Head - Regular Duty Blue","O","bottle","1 Count","Each",0,"500:2.60","","Optional third color.",0],
["A9-145G","OxiGenesis Secondary Label - Light Duty Green","O","label","1 Count","Each",0,"500:0.27","hcO*4","Extra labels.",0],
["A9-145R","OxiGenesis Secondary Label - Heavy Duty Red","O","label","1 Count","Each",0,"500:0.27","hcO*4","Extra labels.",0],
["A9-145B","OxiGenesis Secondary Label - Regular Duty Blue","O","label","1 Count","Each",0,"500:0.27","","",0],
["ACW-145-DIS","Wall Chart - OxiGenesis Disinfectant Cleaner","O","chart","1 Count","Each",0,"0","hcO*1","",0],
["ACW-145-SM","Wall Chart - OxiGenesis Bathroom/Floor","O","chart","1 Count","Each",0,"0","hcO*1","",0],
["ACW-145-YGBR-1","Wall Chart - OxiGenesis General","O","chart","1 Count","Each",0,"0","hcO*1","",0],
["ACP-145-YGBR-PCK","Pocket Chart - OxiGenesis YGBR with Lanyard","O","chart","1 Count","Each",0,"0","hcO*1","",0],
["A9-855-145","Product Literature - OxiGenesis Hyper-Concentrate","O","lit","1 Count","Each",0,"0","lit:hcO","Packs of 25.",0],
["A9-855-BEN-145","Literature - OxiGenesis 6 Great Benefits","O","lit","1 Count","Each",0,"0","lit:hcO","Packs of 25.",0],
["SDS-145","SDS Sheets - OxiGenesis","O","sds","1 Count","Each",0,"0","flat10:hcO","No-charge; EnvirOx bills it as MISCNOCHARGE.",0],
["A-252-MDD-YGBR","Absolute Multi Dispenser for OxiGenesis (YGBR)","O","disp","1 Count","Each",0,"500:187.00","","Billed at $187 unless EnvirOx credits it - the TRIO above is the no-charge route.",0]
];

// One-off (safe to re-run): dispensers are always free to City Wide.
function fixDispenserPricing() {
  var ss = supSS_();
  var sh = ss.getSheetByName(ENVIROX_TAB);
  if (!sh) return;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var r = 0; r < vals.length; r++) {
    var sku = String(vals[r][0]);
    if (sku.indexOf('A-252-MDD') === 0) {
      sh.getRange(r + 2, 8).setValue('0');
      sh.getRange(r + 2, 10).setValue('Always no charge to City Wide - ships free with chemical orders.');
    }
  }
}


/* ============================================================
   SNOW & ICE SERVICE VERIFICATION REPORTS
   Added August 2026. Self-contained: does not depend on the
   other helpers in this project.
   ============================================================ */

var SNOW_TAB     = 'Snow Reports';
var SNOW_FOLDER  = 'CW Snow Reports';
var SNOW_TO      = 'rnservicecall@gocitywide.com';

var SNOW_HEADERS = [
  'report_id','received','status','flags',
  'service_date','vendor_company','contact_name','phone','email',
  'business_name','service_address','visit_type',
  'arrival_time','departure_time','hours_on_site','minimum_applied',
  'depth_on_arrival','conditions',
  'crew_count','crew_names','hand_crew_hours',
  'truck_ct','truck_hrs','blower_ct','blower_hrs','skid_ct','skid_hrs',
  'heavy_ct','heavy_hrs','dump_ct','dump_hrs','flag_ct','flag_hrs','equipment_note',
  'ice_applied','ice_bags','ice_source','ice_approver',
  'areas_not_serviced','notes',
  'gps_lat','gps_lng','gps_accuracy',
  'photo_count','photo_folder','photo_exif_time','photo_exif_lat','photo_exif_lng',
  'vendor_total'
];

var SNOW_RATES = { hand:65.00, truck:146.25, blower:78.00, skid:172.25,
                   heavy:260.00, dump:120.25, flag:97.50, bag:35.75 };
var SNOW_MIN_HOURS = 2;

function setupSnow(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SNOW_TAB) || ss.insertSheet(SNOW_TAB);
  sh.getRange(1, 1, 1, SNOW_HEADERS.length).setValues([SNOW_HEADERS])
    .setFontWeight('bold').setBackground('#2D2A26').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  return 'Snow Reports tab ready with ' + SNOW_HEADERS.length + ' columns.';
}

function _snowSheet(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SNOW_TAB);
  if (!sh){ setupSnow(); sh = ss.getSheetByName(SNOW_TAB); }
  return sh;
}

function _snowSub(parent, name){
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function _snowRoot(){
  var it = DriveApp.getFoldersByName(SNOW_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(SNOW_FOLDER);
}

function _snowSafe(s){
  return String(s || 'Unknown').replace(/[^A-Za-z0-9 _.-]/g, '').substring(0, 60).trim() || 'Unknown';
}

function _snowEsc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _snowMoney(n){
  return '$' + (Number(n) || 0).toFixed(2).replace(/(\d)(?=(\d{3})+\.)/g, '$1,');
}

function _snowMiles(a, b, c, d){
  if (a == null || b == null || c == null || d == null) return null;
  var R = 3958.8, r = Math.PI / 180;
  var p1 = a * r, p2 = c * r, dp = (c - a) * r, dl = (d - b) * r;
  var h = Math.sin(dp/2) * Math.sin(dp/2) +
          Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function _snowPay(d){
  var on = Number(d.hours_on_site) || 0;
  var bill = function(h){ return (on > 0 && on < SNOW_MIN_HOURS) ? Math.max(h, SNOW_MIN_HOURS) : h; };
  var lines = [], total = 0;

  var ch = Number(d.hand_crew_hours) || 0;
  if (ch > 0){
    var bh = bill(ch), amt = bh * SNOW_RATES.hand;
    lines.push([(Number(d.crew_count) || 0) + ' on hand crew, ' + bh.toFixed(2) + ' person hours', amt]);
    total += amt;
  }
  (d.equipment || []).forEach(function(e){
    var rate = SNOW_RATES[e.key];
    if (!rate) return;
    var n = Number(e.count) || 0, h = bill(Number(e.hours) || 0);
    if (!n || !h) return;
    var a = n * h * rate;
    lines.push([e.label + ', ' + n + ' x ' + h.toFixed(2) + ' hours', a]);
    total += a;
  });
  if (String(d.ice_applied) === 'Yes' && String(d.ice_source || '').indexOf('My own') === 0){
    var bags = Number(d.ice_bags) || 0;
    if (bags){ var ab = bags * SNOW_RATES.bag; lines.push([bags + ' bags of vendor ice melt', ab]); total += ab; }
  }
  return { lines: lines, total: Math.round(total * 100) / 100 };
}

function _snowFlags(d, pay, dupe, exif){
  var f = [];
  var on = Number(d.hours_on_site) || 0;
  if (on > 8) f.push('LONG VISIT ' + on.toFixed(2) + 'h');
  if (Number(d.ice_bags) > 12 && !String(d.ice_approver || '').trim()) f.push('HEAVY PRODUCT, NO APPROVER');
  if (dupe) f.push('POSSIBLE DUPLICATE');
  if (d.minimum_applied) f.push('2H MINIMUM APPLIED');
  if (d.equipment_note) f.push('EQUIP HOURS DIFFER');
  if (String(d.areas_not_serviced || '').trim()) f.push('AREAS NOT SERVICED');
  if (Math.abs(pay.total - (Number(d.vendor_total) || 0)) > 0.02) f.push('TOTAL RECALCULATED');
  if (exif.miles != null && exif.miles > 0.5) f.push('PHOTOS ' + exif.miles.toFixed(1) + ' MI FROM SUBMISSION');
  if (d.gps_lat == null) f.push('NO LOCATION CAPTURED');
  return f.join(' | ');
}

function handleSnowReport(data){
  var out = function(o){
    return ContentService.createTextOutput(JSON.stringify(o))
      .setMimeType(ContentService.MimeType.JSON);
  };
  try {
    if (data.website) return out({ ok: true, id: 'SNW-0000' });

    var sh = _snowSheet();
    var last = sh.getLastRow();
    var id = 'SNW-' + ('0000' + Math.max(last, 1)).slice(-4);

    var dupe = false;
    if (last > 1){
      var idx = {};
      SNOW_HEADERS.forEach(function(h, i){ idx[h] = i; });
      var vals = sh.getRange(2, 1, last - 1, SNOW_HEADERS.length).getValues();
      for (var i = 0; i < vals.length; i++){
        if (String(vals[i][idx.vendor_company]).toLowerCase() === String(data.company).toLowerCase() &&
            String(vals[i][idx.service_address]).toLowerCase() === String(data.service_address).toLowerCase() &&
            String(vals[i][idx.service_date]) === String(data.service_date)){ dupe = true; break; }
      }
    }

    var photos = data.photos || [];
    var folderUrl = '', links = [];
    var exif = { time: '', lat: '', lng: '', miles: null };
    if (photos.length){
      var dayFolder = _snowSub(_snowSub(_snowSub(_snowRoot(),
        _snowSafe(data.business_name)), String(data.service_date)), id);
      photos.forEach(function(p, n){
        try {
          var blob = Utilities.newBlob(Utilities.base64Decode(p.data), p.type || 'image/jpeg',
            id + '-' + p.slot + '-' + (n + 1) + '.jpg');
          var file = dayFolder.createFile(blob);
          links.push({ slot: p.slot, url: file.getUrl() });
          if (!exif.time && p.exif_time){
            exif.time = p.exif_time; exif.lat = p.exif_lat || ''; exif.lng = p.exif_lng || '';
          }
        } catch (err) { }
      });
      folderUrl = dayFolder.getUrl();
    }
    if (exif.lat && data.gps_lat != null){
      exif.miles = _snowMiles(Number(exif.lat), Number(exif.lng),
                              Number(data.gps_lat), Number(data.gps_lng));
    }

    var pay = _snowPay(data);
    var flags = _snowFlags(data, pay, dupe, exif);

    var eq = {};
    (data.equipment || []).forEach(function(e){ eq[e.key] = e; });
    var ct = function(k){ return eq[k] ? Number(eq[k].count) : ''; };
    var hr = function(k){ return eq[k] ? Number(eq[k].hours) : ''; };

    var row = [
      id, new Date(), 'New', flags,
      data.service_date, data.company, data.contact_name, data.phone, data.email,
      data.business_name, data.service_address, data.visit_type,
      data.arrival_time, data.departure_time, Number(data.hours_on_site) || 0,
      data.minimum_applied ? 'Yes' : 'No',
      data.depth_on_arrival, data.conditions,
      Number(data.crew_count) || 0, data.crew_names, Number(data.hand_crew_hours) || 0,
      ct('truck'), hr('truck'), ct('blower'), hr('blower'), ct('skid'), hr('skid'),
      ct('heavy'), hr('heavy'), ct('dump'), hr('dump'), ct('flag'), hr('flag'),
      data.equipment_note,
      data.ice_applied, Number(data.ice_bags) || 0, data.ice_source, data.ice_approver,
      data.areas_not_serviced, data.notes,
      data.gps_lat, data.gps_lng, data.gps_accuracy,
      photos.length, folderUrl, exif.time, exif.lat, exif.lng,
      pay.total
    ];
    sh.appendRow(row);

    try { _snowEmail(id, data, pay, flags, folderUrl, links); } catch (err) { }

    return out({ ok: true, id: id, total: pay.total });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function _snowEmail(id, d, pay, flags, folderUrl, links){
  var red = '#D22730', black = '#2D2A26', grey = '#636466';
  var row = function(l, v){
    return '<tr><td style="padding:6px 12px 6px 0;color:' + grey +
      ';font:12px Verdana,sans-serif;white-space:nowrap">' + _snowEsc(l) +
      '</td><td style="padding:6px 0;font:13px Verdana,sans-serif;color:' + black +
      ';font-weight:bold">' + _snowEsc(v) + '</td></tr>';
  };
  var payRows = pay.lines.map(function(l){
    return '<tr><td style="padding:5px 0;font:12.5px Verdana,sans-serif;color:' + black + '">' +
      _snowEsc(l[0]) + '</td><td align="right" style="padding:5px 0;font:12.5px Verdana,sans-serif;' +
      'font-weight:bold;color:' + black + '">' + _snowMoney(l[1]) + '</td></tr>';
  }).join('');

  var byslot = {};
  links.forEach(function(l){ (byslot[l.slot] = byslot[l.slot] || []).push(l.url); });
  var photoHtml = Object.keys(byslot).map(function(s){
    return '<div style="font:12px Verdana,sans-serif;color:' + black + ';padding:3px 0">' +
      '<b>' + _snowEsc(s) + '</b> ' + byslot[s].map(function(u, i){
        return '<a href="' + u + '" style="color:' + red + '">' + (i + 1) + '</a>';
      }).join(' &middot; ') + '</div>';
  }).join('');

  var flagHtml = flags
    ? '<div style="background:#FDECEC;border-left:4px solid ' + red + ';padding:10px 14px;' +
      'margin:0 0 16px;font:12.5px Verdana,sans-serif;color:#8f1a20;font-weight:bold">' +
      _snowEsc(flags) + '</div>'
    : '';

  var html =
    '<div style="max-width:640px;margin:0 auto;font-family:Verdana,sans-serif">' +
    '<div style="background:' + black + ';padding:18px 22px">' +
    '<img src="https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png" ' +
    'height="38" style="height:38px;width:auto;display:block" alt="City Wide Facility Solutions"></div>' +
    '<div style="padding:22px">' +
    '<div style="font:11px Verdana,sans-serif;color:' + red + ';font-weight:bold;letter-spacing:.08em">' +
    'SNOW &amp; ICE SERVICE REPORT ' + _snowEsc(id) + '</div>' +
    '<h2 style="font:bold 19px Verdana,sans-serif;color:' + black + ';margin:6px 0 4px">' +
    _snowEsc(d.business_name) + '</h2>' +
    '<div style="font:13px Verdana,sans-serif;color:' + grey + ';margin-bottom:18px">' +
    _snowEsc(d.service_address) + '</div>' +
    flagHtml +
    '<table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:18px">' +
    row('Vendor', d.company + ' (' + d.contact_name + ', ' + d.phone + ')') +
    row('Service date', d.service_date + '  ' + d.visit_type) +
    row('On site', d.arrival_time + ' to ' + d.departure_time +
        '  (' + (Number(d.hours_on_site) || 0).toFixed(2) + ' hours)') +
    row('Snow depth on arrival', d.depth_on_arrival) +
    row('Conditions', d.conditions || 'not stated') +
    row('Crew on site', (Number(d.crew_count) || 0) + ' people, ' +
        (Number(d.hand_crew_hours) || 0).toFixed(2) + ' person hours') +
    row('Ice melt', String(d.ice_applied) === 'Yes'
        ? (Number(d.ice_bags) || 0) + ' bags, ' + (d.ice_source || '') : 'None applied') +
    (d.ice_approver ? row('Extra product approved by', d.ice_approver) : '') +
    (d.equipment_note ? row('Equipment hours note', d.equipment_note) : '') +
    (d.areas_not_serviced ? row('Not serviced', d.areas_not_serviced) : '') +
    (d.notes ? row('Notes', d.notes) : '') +
    row('Submitted from', (d.gps_lat != null)
        ? (Number(d.gps_lat).toFixed(5) + ', ' + Number(d.gps_lng).toFixed(5) +
           '  (+/- ' + (d.gps_accuracy || '?') + ' m)') : 'location not captured') +
    '</table>' +
    '<div style="font:bold 13px Verdana,sans-serif;color:' + black + ';border-bottom:2px solid ' +
    red + ';padding-bottom:6px;margin-bottom:8px">Vendor pay for this visit</div>' +
    '<table cellpadding="0" cellspacing="0" style="width:100%">' + payRows +
    '<tr><td style="border-top:2px solid ' + black + ';padding:9px 0;font:bold 13px Verdana,sans-serif">' +
    'Total</td><td align="right" style="border-top:2px solid ' + black +
    ';padding:9px 0;font:bold 17px Verdana,sans-serif;color:' + red + '">' +
    _snowMoney(pay.total) + '</td></tr></table>' +
    (photoHtml ? '<div style="font:bold 13px Verdana,sans-serif;color:' + black +
      ';border-bottom:2px solid ' + red + ';padding-bottom:6px;margin:20px 0 8px">Photos</div>' +
      photoHtml + (folderUrl ? '<div style="margin-top:8px"><a href="' + folderUrl +
      '" style="color:' + red + ';font:12px Verdana,sans-serif;font-weight:bold">' +
      'Open the photo folder</a></div>' : '') : '') +
    '</div>' +
    '<div style="background:#F5F5F5;padding:14px 22px;font:11px Verdana,sans-serif;color:' + grey + '">' +
    'Filed from the Vendor Resource Center. Vendors do not invoice for snow and ice work. ' +
    'Pay is calculated from this report at the rates in their Exhibit A.</div></div>';

  cwMail_('snow_int', {
    to: SNOW_TO,
    replyTo: d.email,
    subject: 'Snow Report ' + id + ' - ' + d.business_name + ' - ' + d.service_date +
             (flags ? ' - REVIEW' : ''),
    htmlBody: html
  });

  if (d.email){
    cwMail_('snow_conf', {
      to: d.email,
      subject: 'Your snow report ' + id + ' for ' + d.business_name,
      htmlBody: html
    });
  }
}


/* ===== SALES HUB (Call Block Tracker) =====
   Data lives in its own spreadsheet (SALES_SHEET_ID), NOT this project's Solicitations sheet.
   Run setupSalesHub() once, paste the logged ID into SALES_SHEET_ID, save, deploy NEW VERSION. */
var SALES_SHEET_ID = '1lNnyL8ScefUmlnx-dt_VCDGMpgj4DU80kpE1ryXNMIA';

function setupSalesHub(){
  var ss;
  if (SALES_SHEET_ID && SALES_SHEET_ID.indexOf('PASTE') === -1){
    ss = SpreadsheetApp.openById(SALES_SHEET_ID);
  } else {
    ss = SpreadsheetApp.create('CW Sales Hub Tracker');
  }
  var log = ss.getSheetByName('Log') || ss.insertSheet('Log');
  if (log.getLastRow() === 0) log.appendRow(['timestamp','date','name','type','source']);
  var roster = ss.getSheetByName('Roster') || ss.insertSheet('Roster');
  if (roster.getLastRow() === 0){
    roster.appendRow(['name','active']);
    [['Scott',1],['Neal',1],['Jeremy',1],['Justin',1]].forEach(function(r){roster.appendRow(r);});
  }
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  Logger.log('SALES SHEET ID: ' + ss.getId());
  Logger.log('SALES SHEET URL: ' + ss.getUrl());
  return ss.getId();
}

function salesJson_(o){
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function salesSS_(){ return SpreadsheetApp.openById(SALES_SHEET_ID); }

function salesRoster_(){
  var vals = salesSS_().getSheetByName('Roster').getDataRange().getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++){
    var n = String(vals[i][0] || '').trim();
    var act = vals[i][1];
    if (n && String(act) !== '0' && act !== false) out.push(n);
  }
  return out;
}

function handleSalesFeed(){
  var vals = salesSS_().getSheetByName('Log').getDataRange().getValues();
  var cutoff = new Date(Date.now() - 95 * 86400000);
  var events = [];
  for (var i = 1; i < vals.length; i++){
    var ts = vals[i][0];
    if (ts instanceof Date && ts < cutoff) continue;
    var d = vals[i][1], n = String(vals[i][2] || ''), t = String(vals[i][3] || '');
    if (d instanceof Date) d = Utilities.formatDate(d, 'America/Los_Angeles', 'yyyy-MM-dd');
    d = String(d).slice(0, 10);
    if (d && n && t) events.push({ d: d, n: n, t: t });
  }
  return salesJson_({ ok: true, roster: salesRoster_(), events: events,
    today: Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd') });
}

function handleSalesEvent(data){
  var name = String(data.name || '').trim();
  var type = String(data.type || '').trim();
  if (['appt','sale'].indexOf(type) === -1) return salesJson_({ ok: false, error: 'bad type' });
  if (salesRoster_().indexOf(name) === -1) return salesJson_({ ok: false, error: 'unknown name' });
  var now = new Date();
  salesSS_().getSheetByName('Log').appendRow([
    now, Utilities.formatDate(now, 'America/Los_Angeles', 'yyyy-MM-dd'), name, type, 'sales-hub'
  ]);
  return salesJson_({ ok: true });
}

function handleSalesUndo(data){
  var name = String(data.name || '').trim();
  var type = String(data.type || '').trim();
  var sh = salesSS_().getSheetByName('Log');
  var vals = sh.getDataRange().getValues();
  var cutoff = Date.now() - 10 * 60000;
  for (var i = vals.length - 1; i >= 1; i--){
    var ts = vals[i][0];
    if (ts instanceof Date && ts.getTime() < cutoff) break;
    if (String(vals[i][2]) === name && String(vals[i][3]) === type){
      sh.deleteRow(i + 1);
      return salesJson_({ ok: true, removed: true });
    }
  }
  return salesJson_({ ok: true, removed: false });
}


// ============================================================
// ACCOUNT CLEANER TRACKER  (appended block, do not reorder)
// Vendors report adding or removing a cleaner at a City Wide
// account. Free text in, server-side matching, append-only log.
// Nothing here ever returns a City Wide account list or vendor
// list to a public page.
// ============================================================

var AC_PROP_ID      = 'AC_SHEET_ID';
var AC_EV           = 'Events';
var AC_ROS          = 'Roster';
var AC_ACC          = 'Accounts';
var AC_VEN          = 'Vendors';
var AC_ALI          = 'Aliases';
var AC_CONFIRM_BACK = true;   // set false to kill the vendor-facing "did you mean" reply
var AC_AUTO         = 0.80;   // at or above: treat as matched
var AC_MAYBE        = 0.62;   // at or above: suggest to an FSM, still Needs Review
var AC_PARENT_FOLDER = 'Team Portal';

var AC_EV_HEAD = ['event_id','received','submission_id','action','company_raw','company_matched',
  'vendor_key','submitter_name','submitter_email','submitter_phone','cleaner_first','cleaner_last',
  'cleaner_key','account_raw','account_matched','match_confidence','background_check','bg_check_date',
  'bg_check_by','age_confirmed','role','start_date','last_day','removal_reason','note_1','note_2',
  'status','reviewed_by','reviewed_at','review_note','region','source'];

var AC_ROS_HEAD = ['roster_key','account_matched','account_raw','company_matched','vendor_key',
  'cleaner_first','cleaner_last','cleaner_key','role','status','background_check','age_confirmed',
  'start_date','last_day','region','flags','first_seen','last_event','last_event_id'];

var AC_ACC_HEAD = ['account_name','region','aliases','active'];
var AC_VEN_HEAD = ['company_name','region','vendor_key','access_code','aliases','active'];
var AC_ALI_HEAD = ['typed_text','resolves_to','kind','added_by','added_at'];

// ---------- sheet plumbing ----------

function acId_(){
  var id = PropertiesService.getScriptProperties().getProperty(AC_PROP_ID);
  if (!id) throw new Error('Account Cleaner Tracker sheet not created yet. Run acSetup() once.');
  return id;
}
function acSS_(){ return SpreadsheetApp.openById(acId_()); }
function acTab_(name, head){
  var ss = acSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (head && sh.getLastRow() === 0){
    sh.getRange(1,1,1,head.length).setValues([head]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,head.length).setFontWeight('bold').setBackground('#2D2A26').setFontColor('#FFFFFF');
  }
  return sh;
}
function acNextRow_(sh){
  // the appendRow / validation bug parks rows at 1001; scan column A instead
  var vals = sh.getRange(1,1,Math.max(sh.getMaxRows(),1),1).getValues();
  for (var i=0;i<vals.length;i++){ if (String(vals[i][0]).trim()==='') return i+1; }
  return vals.length+1;
}
function acAppend_(sh, head, obj){
  var row = head.map(function(h){ return obj[h]===undefined||obj[h]===null ? '' : obj[h]; });
  var r = acNextRow_(sh);
  if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 20);
  sh.getRange(r,1,1,head.length).setValues([row]);
  return r;
}
function acRows_(name, head){
  var sh = acTab_(name, head);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var w = head.length;
  var vals = sh.getRange(2,1,last-1,w).getValues();
  var out = [];
  for (var i=0;i<vals.length;i++){
    if (String(vals[i][0]).trim()==='') continue;
    var o = { _row: i+2 };
    for (var c=0;c<w;c++){ // AC_DATEFMT: Sheets hands back Date objects; JSON would ship raw ISO
      var cv = vals[i][c];
      if (Object.prototype.toString.call(cv) === '[object Date]'){
        var hasTime = cv.getHours() || cv.getMinutes();
        cv = Utilities.formatDate(cv, 'America/Los_Angeles', hasTime ? 'MM/dd/yyyy hh:mm a' : 'MM/dd/yyyy');
      }
      o[head[c]] = cv;
    }
    out.push(o);
  }
  return out;
}

function acSetup(){
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(AC_PROP_ID);
  if (!id){
    var ss = SpreadsheetApp.create('Account Cleaner Tracker');
    id = ss.getId();
    props.setProperty(AC_PROP_ID, id);
    try {
      var it = DriveApp.getFoldersByName(AC_PARENT_FOLDER);
      if (it.hasNext()){
        var f = DriveApp.getFileById(id);
        it.next().addFile(f);
        DriveApp.getRootFolder().removeFile(f);
      }
    } catch(err){}
    try { ss.getSheets()[0].setName(AC_EV); } catch(err){}
  }
  acTab_(AC_EV,  AC_EV_HEAD);
  acTab_(AC_ROS, AC_ROS_HEAD);
  acTab_(AC_ACC, AC_ACC_HEAD);
  acTab_(AC_VEN, AC_VEN_HEAD);
  acTab_(AC_ALI, AC_ALI_HEAD);
  return id;
}
function acWhere(){ return PropertiesService.getScriptProperties().getProperty(AC_PROP_ID) || 'not created'; }

// ---------- normalizing and matching ----------

var AC_STOP = {the:1,a:1,an:1,of:1,at:1,and:1,inc:1,incorporated:1,llc:1,llp:1,lp:1,ltd:1,co:1,
  corp:1,corporation:1,company:1,group:1,holdings:1,services:1,service:1,
  suite:1,ste:1,unit:1,bldg:1,building:1,bld:1,floor:1,fl:1,no:1,number:1};

function acNorm_(s){
  s = String(s===null||s===undefined?'':s).toLowerCase();
  s = s.replace(/&/g,' and ');
  s = s.replace(/[‘’“”]/g,'');
  s = s.replace(/[^a-z0-9]+/g,' ');
  s = s.replace(/\s+/g,' ').trim();
  return s;
}
function acTokens_(s){
  var t = acNorm_(s).split(' ');
  var out = [];
  for (var i=0;i<t.length;i++){ if (t[i] && !AC_STOP[t[i]]) out.push(t[i]); }
  return out.length ? out : acNorm_(s).split(' ').filter(String);
}
function acKey_(s){ return acTokens_(s).sort().join(''); }

function acLev_(a,b){
  if (a===b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  var prev = [], cur = [], i, j;
  for (j=0;j<=b.length;j++) prev[j]=j;
  for (i=1;i<=a.length;i++){
    cur[0]=i;
    for (j=1;j<=b.length;j++){
      var cost = a.charAt(i-1)===b.charAt(j-1) ? 0 : 1;
      cur[j] = Math.min(cur[j-1]+1, prev[j]+1, prev[j-1]+cost);
    }
    for (j=0;j<=b.length;j++) prev[j]=cur[j];
  }
  return prev[b.length];
}
function acDice_(at, bt){
  if (!at.length || !bt.length) return 0;
  var m = {}, hit = 0, i;
  for (i=0;i<at.length;i++) m[at[i]] = (m[at[i]]||0)+1;
  for (i=0;i<bt.length;i++){ if (m[bt[i]]>0){ m[bt[i]]--; hit++; } }
  return (2*hit)/(at.length+bt.length);
}
function acScore_(typed, canon){
  var tn = acNorm_(typed), cn = acNorm_(canon);
  if (!tn || !cn) return 0;
  if (tn === cn) return 1;
  var tt = acTokens_(typed), ct = acTokens_(canon);
  if (tt.join(' ') === ct.join(' ')) return 0.99;
  var dice = acDice_(tt, ct);
  var maxlen = Math.max(tn.length, cn.length);
  var edit = 1 - (acLev_(tn, cn) / maxlen);
  if (edit < 0) edit = 0;
  var s = (0.62*dice) + (0.38*edit);
  // a full containment of the shorter side is a strong signal
  var cover = tn.length / Math.max(cn.length, 1); // AC_FIX3
  if (cover >= 0.6 && tn.length >= 4 && cn.indexOf(tn) >= 0) s = Math.max(s, 0.86);
  if (cover >= 0.6 && cn.length >= 4 && tn.indexOf(cn) >= 0) s = Math.max(s, 0.86);
  // every meaningful token of the typed string appears in the canonical one
  if (tt.length && ct.length){
    var all = true;
    for (var i=0;i<tt.length;i++){ if (ct.indexOf(tt[i]) < 0) all = false; }
    if (all && tt.length >= Math.ceil(ct.length * 0.6)) s = Math.max(s, 0.82); // AC_FIX4
  }
  var ta = tt.slice().sort().join(''), ca = ct.slice().sort().join(''); // AC_FIX1
  if (ta.length >= 6 && ca.length >= 6){
    var e2 = 1 - (acLev_(ta, ca) / Math.max(ta.length, ca.length));
    if (e2 > s) s = e2;
  }
  return s > 1 ? 1 : s;
}

// candidates: [{name, region, aliases}]
function acBest_(typed, candidates){
  var best = { name:'', region:'', score:0 };
  if (!acNorm_(typed)) return best;
  for (var i=0;i<candidates.length;i++){
    var c = candidates[i];
    var s = acScore_(typed, c.name);
    var al = String(c.aliases||'').split('|');
    for (var j=0;j<al.length;j++){
      if (!al[j].trim()) continue;
      var s2 = acScore_(typed, al[j]);
      if (s2 > s) s = s2;
    }
    if (s > best.score) best = { name:c.name, region:c.region||'', score:s };
  }
  return best;
}
function acAccounts_(){
  return acRows_(AC_ACC, AC_ACC_HEAD)
    .filter(function(r){ return String(r.active)!=='0' && String(r.active).toLowerCase()!=='false'; })
    .map(function(r){ return { name:String(r.account_name).trim(), region:r.region, aliases:r.aliases }; })
    .filter(function(r){ return r.name; });
}
function acVendors_(){
  return acRows_(AC_VEN, AC_VEN_HEAD)
    .filter(function(r){ return String(r.active)!=='0' && String(r.active).toLowerCase()!=='false'; })
    .map(function(r){ return { name:String(r.company_name).trim(), region:r.region,
                               aliases:r.aliases, vendor_key:r.vendor_key }; })
    .filter(function(r){ return r.name; });
}
function acAliasLookup_(typed, kind){
  var rows = acRows_(AC_ALI, AC_ALI_HEAD);
  var t = acKey_(typed);
  for (var i=0;i<rows.length;i++){
    if (String(rows[i].kind) !== kind) continue;
    if (acKey_(rows[i].typed_text) === t) return String(rows[i].resolves_to);
  }
  return '';
}

// ---------- ids ----------
function acRand_(n){
  var s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', o = '';
  for (var i=0;i<n;i++) o += s.charAt(Math.floor(Math.random()*s.length));
  return o;
}
function acStamp_(){ return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MM/dd/yyyy hh:mm a'); }
function acToday_(){ return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MM/dd/yyyy'); }

// ---------- public dispatch ----------

function acDispatch(kind, d){
  try {
    if (kind === 'cleaner_setup')  return acJson_(acAuthOk_(d) ? { ok:true, id:acSetup() } : { ok:false, error:'Wrong passcode.' });
    if (kind === 'cleaner_check')  return acJson_(acCheck_(d));
    if (kind === 'cleaner_event')  return acJson_(acEvent_(d));
    if (kind === 'cleaner_admin')  return acJson_(acAdmin_(d));
    if (kind === 'cleaner_review') return acJson_(acReview_(d));
    if (kind === 'cleaner_seed')   return acJson_(acSeed_(d));
    if (kind === 'cleaner_roster') return acJson_({ ok:false, error:'Vendor sign in is not enabled yet.' });
    return acJson_({ ok:false, error:'Unknown request.' });
  } catch(err){
    return acJson_({ ok:false, error:String(err && err.message ? err.message : err) });
  }
}
function acJson_(o){
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- confirm back ----------
// Returns AT MOST ONE suggestion, only when the typed string is already
// a near match. Never a list, never a browse, never any other field.
function acCheck_(d){
  if (!AC_CONFIRM_BACK) return { ok:true, suggestion:'' };
  var field = String(d.field||'account');
  var typed = String(d.value||'').trim();
  if (typed.length < 4) return { ok:true, suggestion:'' };
  var pool = field === 'company' ? acVendors_() : acAccounts_();
  var best = acBest_(typed, pool);
  var ctn = acNorm_(typed), ccn = acNorm_(best.name); // AC_FIX5
  var ccover = ctn.length / Math.max(ccn.length, 1);
  var ctt = acTokens_(typed), cct = acTokens_(best.name);
  var ctok = cct.length ? ctt.filter(function(x){ return cct.indexOf(x) >= 0; }).length / cct.length : 0;
  if (ccover < 0.75 || ctok < 0.34) return { ok:true, suggestion:'' };
  if (best.score >= AC_AUTO && acNorm_(best.name) !== acNorm_(typed)){
    return { ok:true, suggestion: best.name };
  }
  return { ok:true, suggestion:'' };
}

// ---------- vendor submission ----------

function acEvent_(d){
  if (String(d.website||'').trim()) return { ok:true, id:'RECEIVED' };   // honeypot

  var action = String(d.action||'add').toLowerCase() === 'remove' ? 'remove' : 'add';
  var first  = String(d.cleaner_first||'').trim();
  var last   = String(d.cleaner_last||'').trim();
  var comp   = String(d.company||'').trim();
  if (!comp)  return { ok:false, error:'Company name is required.' };
  if (!first && !last) return { ok:false, error:'Cleaner name is required.' };

  var subId = 'ACS-' + Utilities.formatDate(new Date(),'America/Los_Angeles','yyMMdd') + '-' + acRand_(4);

  var vAlias = acAliasLookup_(comp, 'vendor');
  var vendors = acVendors_();
  var vBest = vAlias ? { name:vAlias, region:'', score:1 } : acBest_(comp, vendors);
  var compMatched = vBest.score >= AC_MAYBE ? vBest.name : '';
  var vendorKey   = compMatched ? acKey_(compMatched) : ('RAW:' + acKey_(comp));
  if (!compMatched){ // AC_FIX2
    var seenC = {}, candC = [];
    acRows_(AC_EV, AC_EV_HEAD).forEach(function(e){
      if (String(e.action||'') !== 'add') return; // only a company that actually added someone
      var cr = String(e.company_raw||'').trim();
      if (cr && !seenC[acKey_(cr)]){ seenC[acKey_(cr)] = 1; candC.push({ name:cr, region:e.region, aliases:'' }); }
    });
    var pbC = acBest_(comp, candC);
    if (pbC.score >= 0.70) vendorKey = 'RAW:' + acKey_(pbC.name);
  }
  var region = String(d.region||'').trim() || vBest.region || '';

  var cleanerKey = vendorKey + '::' + acKey_(first + ' ' + last);

  var accountsIn = [];
  var raw = d.accounts;
  if (Object.prototype.toString.call(raw) === '[object Array]'){
    for (var i=0;i<raw.length;i++){ if (String(raw[i]).trim()) accountsIn.push(String(raw[i]).trim()); }
  } else if (String(raw||'').trim()){
    accountsIn = String(raw).split('\n').map(function(x){ return x.trim(); }).filter(String);
  }

  var flags = [];
  var bg  = String(d.background_check||'').trim();
  var age = String(d.age_confirmed||'').trim();
  if (action === 'add'){
    if (bg && bg.toLowerCase() !== 'yes') flags.push('Background check: ' + bg);
    if (age && age.toLowerCase() !== 'yes') flags.push('Not confirmed 18 or older');
    if (!accountsIn.length) return { ok:false, error:'Tell us at least one building.' };
  }

  var evSh = acTab_(AC_EV, AC_EV_HEAD);
  var written = [], needsReview = false, matchedNames = [];

  if (action === 'add'){
    var accounts = acAccounts_();
    for (var a=0;a<accountsIn.length;a++){
      var typed = accountsIn[a];
      var alias = acAliasLookup_(typed, 'account');
      var b = alias ? { name:alias, region:'', score:1 } : acBest_(typed, accounts);
      var matched = '', conf = 'none', status = 'Active';
      if (b.score >= AC_AUTO){ matched = b.name; conf = 'high'; }
      else if (b.score >= AC_MAYBE){ matched = b.name; conf = 'medium'; status = 'Needs Review'; }
      else { conf = 'none'; status = 'Needs Review'; }
      if (!region && b.region) region = b.region;
      if (flags.length) status = 'Needs Review';
      if (status === 'Needs Review') needsReview = true;
      if (matched) matchedNames.push(matched);

      var id = 'ACE-' + acRand_(6);
      acAppend_(evSh, AC_EV_HEAD, {
        event_id:id, received:acStamp_(), submission_id:subId, action:'add',
        company_raw:comp, company_matched:compMatched, vendor_key:vendorKey,
        submitter_name:String(d.submitter_name||''), submitter_email:String(d.submitter_email||''),
        submitter_phone:String(d.submitter_phone||''),
        cleaner_first:first, cleaner_last:last, cleaner_key:cleanerKey,
        account_raw:typed, account_matched:matched, match_confidence:conf,
        background_check:bg, bg_check_date:String(d.bg_check_date||''), bg_check_by:String(d.bg_check_by||''),
        age_confirmed:age, role:String(d.role||''), start_date:String(d.start_date||''),
        note_1:String(d.note_1||''), note_2:String(d.note_2||''),
        status:status, region:region, source:'vendor form'
      });
      written.push(id);
    }
  } else {
    acRebuild_();
    var ros = acRows_(AC_ROS, AC_ROS_HEAD).filter(function(r){
      return String(r.vendor_key) === vendorKey && String(r.status) === 'Active';
    });
    var names = ros.map(function(r){ return { name:(r.cleaner_first+' '+r.cleaner_last).trim(),
                                              region:r.region, key:r.cleaner_key, row:r }; });
    var pBest = { score:0 };
    for (var p=0;p<names.length;p++){
      var s = acScore_(first + ' ' + last, names[p].name);
      if (s > pBest.score) { pBest = { score:s }; cleanerKey = names[p].key; }
    }
    var matchedPerson = pBest.score >= 0.72;
    if (!matchedPerson) cleanerKey = vendorKey + '::' + acKey_(first + ' ' + last);

    var targets = ros.filter(function(r){ return String(r.cleaner_key) === cleanerKey; });
    if (accountsIn.length){
      var accs2 = acAccounts_();
      var wanted = accountsIn.map(function(t){
        var al = acAliasLookup_(t,'account');
        var bb = al ? { name:al, score:1 } : acBest_(t, accs2);
        return bb.score >= AC_MAYBE ? acKey_(bb.name) : acKey_(t);
      });
      targets = targets.filter(function(r){
        return wanted.indexOf(acKey_(r.account_matched || r.account_raw)) >= 0;
      });
    }

    var rmStatus = (matchedPerson && targets.length) ? 'Pending Removal' : 'Needs Review';
    if (rmStatus === 'Needs Review') needsReview = true;

    var list = targets.length ? targets : [ { account_matched:'', account_raw:(accountsIn[0]||''), region:region } ];
    for (var t2=0;t2<list.length;t2++){
      var id2 = 'ACE-' + acRand_(6);
      acAppend_(evSh, AC_EV_HEAD, {
        event_id:id2, received:acStamp_(), submission_id:subId, action:'remove',
        company_raw:comp, company_matched:compMatched, vendor_key:vendorKey,
        submitter_name:String(d.submitter_name||''), submitter_email:String(d.submitter_email||''),
        submitter_phone:String(d.submitter_phone||''),
        cleaner_first:first, cleaner_last:last, cleaner_key:cleanerKey,
        account_raw:String(list[t2].account_raw||''), account_matched:String(list[t2].account_matched||''),
        match_confidence: matchedPerson ? (pBest.score>=0.9?'high':'medium') : 'none',
        role:String(d.role||''), last_day:String(d.last_day||''),
        removal_reason:String(d.removal_reason||''),
        note_1:String(d.note_1||''), note_2:String(d.note_2||''),
        status:rmStatus, region:region || String(list[t2].region||''), source:'vendor form'
      });
      written.push(id2);
      if (list[t2].account_matched) matchedNames.push(list[t2].account_matched);
    }
  }

  acRebuild_();
  try { acNotify_(subId, action, comp, compMatched, first, last, matchedNames, flags, needsReview, region, d); } catch(err){}

  var out = { ok:true, id:subId, count:written.length, needs_review:needsReview };
  if (AC_CONFIRM_BACK && matchedNames.length) out.matched = matchedNames;
  return out;
}

// ---------- roster rebuild (Roster is derived; Events is the record) ----------

function acRebuild_(){
  var ev = acRows_(AC_EV, AC_EV_HEAD);
  var map = {}, order = [];
  for (var i=0;i<ev.length;i++){
    var e = ev[i];
    var act = String(e.action||'').toLowerCase();
    if (act.indexOf('fsm_') === 0) continue;

    var acct = String(e.account_matched||'').trim();
    var acctKey = acct ? acKey_(acct) : ('RAW:' + acKey_(e.account_raw));

    if (act === 'add'){
      var k = e.vendor_key + '|' + e.cleaner_key + '|' + acctKey;
      var r = map[k];
      if (!r){ r = map[k] = { roster_key:k, first_seen:e.received }; order.push(k); }
      r.account_matched = acct;
      r.account_raw     = e.account_raw;
      r.company_matched = e.company_matched;
      r.vendor_key      = e.vendor_key;
      r.cleaner_first   = e.cleaner_first;
      r.cleaner_last    = e.cleaner_last;
      r.cleaner_key     = e.cleaner_key;
      r.role            = e.role;
      r.background_check= e.background_check;
      r.age_confirmed   = e.age_confirmed;
      r.start_date      = e.start_date;
      r.region          = e.region;
      r.last_event      = e.received;
      r.last_event_id   = e.event_id;
      r.last_day        = '';
      var st = String(e.status||'Active');
      r.status = (st === 'Needs Review') ? 'Needs Review' : 'Active';
      var f = [];
      if (String(e.background_check||'').toLowerCase() !== 'yes') f.push('background check ' + (e.background_check||'not answered'));
      if (String(e.age_confirmed||'').toLowerCase() !== 'yes') f.push('age not confirmed');
      if (!acct) f.push('building not matched');
      r.flags = f.join('; ');
    } else if (act === 'remove'){
      var st2 = String(e.status||'Pending Removal');
      var keys = [];
      for (var k2 in map){
        var rr = map[k2];
        if (rr.vendor_key !== e.vendor_key) continue;
        if (String(rr.cleaner_key) !== String(e.cleaner_key)) continue;
        if (acct || String(e.account_raw||'').trim()){
          var rk2 = rr.account_matched ? acKey_(rr.account_matched) : ('RAW:' + acKey_(rr.account_raw)); if (acctKey !== rk2) continue;
        }
        keys.push(k2);
      }
      for (var q=0;q<keys.length;q++){
        var t = map[keys[q]];
        if (st2 === 'Removed'){ t.status = 'Removed'; t.last_day = e.last_day || e.reviewed_at || ''; }
        else if (st2 === 'Rejected'){ t.status = 'Active'; }
        else if (st2 === 'Needs Review'){ t.status = 'Needs Review'; }
        else { t.status = 'Pending Removal'; t.last_day = e.last_day || ''; }
        t.last_event = e.received; t.last_event_id = e.event_id;
      }
    }
  }
  var sh = acTab_(AC_ROS, AC_ROS_HEAD);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2,1,last-1,AC_ROS_HEAD.length).clearContent();
  if (!order.length) return;
  var out = order.map(function(k){
    var r = map[k];
    return AC_ROS_HEAD.map(function(h){ return r[h]===undefined||r[h]===null ? '' : r[h]; });
  });
  if (out.length + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), out.length + 20);
  sh.getRange(2,1,out.length,AC_ROS_HEAD.length).setValues(out);
}

// ---------- FSM side (passcode required) ----------

function acAuthOk_(d){ return String(d.passcode||'') === PASSCODE; }

function acAdmin_(d){
  if (!acAuthOk_(d)) return { ok:false, error:'Wrong passcode.' };
  acRebuild_();
  var roster = acRows_(AC_ROS, AC_ROS_HEAD);
  var events = acRows_(AC_EV, AC_EV_HEAD);
  var review = events.filter(function(e){
    var s = String(e.status||'');
    return s === 'Needs Review' || s === 'Pending Removal';
  });
  return {
    ok:true,
    roster: roster,
    review: review,
    accounts: acAccounts_().map(function(a){ return a.name; }),
    sheet_url: 'https://docs.google.com/spreadsheets/d/' + acId_() + '/edit',
    counts: {
      active: roster.filter(function(r){ return r.status==='Active'; }).length,
      pending: roster.filter(function(r){ return r.status==='Pending Removal'; }).length,
      review: roster.filter(function(r){ return r.status==='Needs Review'; }).length,
      removed: roster.filter(function(r){ return r.status==='Removed'; }).length
    }
  };
}

function acReview_(d){
  if (!acAuthOk_(d)) return { ok:false, error:'Wrong passcode.' };
  var op   = String(d.op||'');
  var eid  = String(d.event_id||'');
  var who  = String(d.reviewed_by||'FSM');
  var note = String(d.review_note||'');
  var sh   = acTab_(AC_EV, AC_EV_HEAD);
  var rows = acRows_(AC_EV, AC_EV_HEAD);
  var target = null;
  for (var i=0;i<rows.length;i++){ if (String(rows[i].event_id) === eid) target = rows[i]; }
  if (!target) return { ok:false, error:'That event was not found.' };

  var col = function(h){ return AC_EV_HEAD.indexOf(h) + 1; };
  var setC = function(h,v){ sh.getRange(target._row, col(h)).setValue(v); };

  if (op === 'confirm_removal'){
    setC('status','Removed');
    if (!target.last_day) setC('last_day', acToday_());
  } else if (op === 'reject_removal'){
    setC('status','Rejected');
  } else if (op === 'resolve_account'){
    var canon = String(d.account_matched||'').trim();
    if (!canon) return { ok:false, error:'Pick a building.' };
    setC('account_matched', canon);
    setC('match_confidence','fsm');
    setC('status', String(target.action)==='remove' ? 'Pending Removal' : 'Active');
    if (String(d.remember||'') === '1' && String(target.account_raw||'').trim()){
      acAppend_(acTab_(AC_ALI, AC_ALI_HEAD), AC_ALI_HEAD, {
        typed_text:target.account_raw, resolves_to:canon, kind:'account',
        added_by:who, added_at:acStamp_()
      });
    }
  } else if (op === 'clear_flag'){
    setC('status','Active');
  } else {
    return { ok:false, error:'Unknown action.' };
  }
  setC('reviewed_by', who);
  setC('reviewed_at', acStamp_());
  if (note) setC('review_note', note);

  acAppend_(sh, AC_EV_HEAD, {
    event_id:'ACE-' + acRand_(6), received:acStamp_(), submission_id:target.submission_id,
    action:'fsm_' + op, company_raw:target.company_raw, company_matched:target.company_matched,
    vendor_key:target.vendor_key, cleaner_first:target.cleaner_first, cleaner_last:target.cleaner_last,
    cleaner_key:target.cleaner_key, account_raw:target.account_raw,
    account_matched:String(d.account_matched||target.account_matched||''),
    status:'Logged', reviewed_by:who, reviewed_at:acStamp_(), review_note:note || ('ref ' + eid),
    region:target.region, source:'ops hub'
  });
  acRebuild_();
  return { ok:true };
}

// ---------- seeding (passcode required, additive, never deletes) ----------

function acSeed_(d){
  if (!acAuthOk_(d)) return { ok:false, error:'Wrong passcode.' };
  var addedA = 0, addedV = 0;
  var region = String(d.region||'');
  if (Object.prototype.toString.call(d.accounts) === '[object Array]'){
    var sh = acTab_(AC_ACC, AC_ACC_HEAD);
    var have = {};
    acRows_(AC_ACC, AC_ACC_HEAD).forEach(function(r){ have[acKey_(r.account_name)] = 1; });
    var rowsA = [];
    d.accounts.forEach(function(n){
      n = String(n||'').trim();
      if (!n || have[acKey_(n)]) return;
      have[acKey_(n)] = 1;
      rowsA.push([n, region, '', 1]);
    });
    if (rowsA.length){
      var r0 = acNextRow_(sh);
      if (r0 + rowsA.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rowsA.length + 20);
      sh.getRange(r0,1,rowsA.length,AC_ACC_HEAD.length).setValues(rowsA);
      addedA = rowsA.length;
    }
  }
  if (Object.prototype.toString.call(d.vendors) === '[object Array]'){
    var shv = acTab_(AC_VEN, AC_VEN_HEAD);
    var haveV = {};
    acRows_(AC_VEN, AC_VEN_HEAD).forEach(function(r){ haveV[acKey_(r.company_name)] = 1; });
    var rowsV = [];
    d.vendors.forEach(function(n){
      n = String(n||'').trim();
      if (!n || haveV[acKey_(n)]) return;
      haveV[acKey_(n)] = 1;
      rowsV.push([n, region, acKey_(n), '', '', 1]);
    });
    if (rowsV.length){
      var rv = acNextRow_(shv);
      if (rv + rowsV.length > shv.getMaxRows()) shv.insertRowsAfter(shv.getMaxRows(), rowsV.length + 20);
      shv.getRange(rv,1,rowsV.length,AC_VEN_HEAD.length).setValues(rowsV);
      addedV = rowsV.length;
    }
  }
  return { ok:true, accounts_added:addedA, vendors_added:addedV };
}

// ---------- notification ----------

function acNotify_(subId, action, compRaw, compMatched, first, last, accts, flags, needsReview, region, d){
  if (!needsReview && !flags.length) return;
  var to = /north/i.test(String(region)) ? 'rncompliance@gocitywide.com' : 'lvcompliance@gocitywide.com';
  var rows = '';
  var add = function(k,v){
    if (!v) return;
    rows += '<tr><td style="padding:6px 12px 6px 0;color:#636466;font-size:12px;white-space:nowrap;vertical-align:top">'
         + k + '</td><td style="padding:6px 0;font-size:13px;color:#2D2A26">' + acEsc_(v) + '</td></tr>';
  };
  add('Submission', subId);
  add('Action', action === 'add' ? 'Adding a cleaner' : 'Removing a cleaner');
  add('Crew company', compRaw + (compMatched && acNorm_(compMatched)!==acNorm_(compRaw) ? ' (matched to ' + compMatched + ')' : ''));
  add('Cleaner', (first + ' ' + last).trim());
  add('Buildings matched', accts.join(', '));
  add('Region', region);
  add('Submitted by', String(d.submitter_name||'') + (d.submitter_email ? ' | ' + d.submitter_email : ''));
  add('Why this needs a look', flags.length ? flags.join('; ') : 'A building or a person could not be matched with confidence');

  var html = '<div style="font-family:Verdana,Geneva,Tahoma,sans-serif;background:#F5F5F5;padding:24px">'
    + '<div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #E5E5E5;border-radius:10px;overflow:hidden">'
    + '<div style="padding:18px 24px;border-bottom:1px solid #E5E5E5">'
    + '<img src="' + LOGO + '" alt="City Wide Facility Solutions" height="38" style="height:38px;width:auto;display:block"></div>'
    + '<div style="padding:22px 24px">'
    + '<div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#D22730">Account Cleaner Tracker</div>'
    + '<h1 style="font-size:19px;color:#2D2A26;margin:6px 0 4px">A cleaner update needs review</h1>'
    + '<p style="font-size:13px;color:#636466;margin:0 0 16px">Open the Cleaner Roster page on the Ops Hub to resolve it.</p>'
    + '<table style="border-collapse:collapse;width:100%">' + rows + '</table>'
    + '</div>'
    + '<div style="padding:14px 24px;background:#2D2A26;color:#9a9894;font-size:11px">'
    + 'City Wide Facility Solutions of Nevada &middot; GoCityWide.com</div>'
    + '</div></div>';

  cwMail_('cleaner', { to:to, subject:'Cleaner tracker review needed: ' + (first+' '+last).trim() + ' (' + subId + ')',
                      htmlBody:html, name:'City Wide Facility Solutions',
                      digest: { title: (action === 'add' ? 'Add: ' : 'Remove: ') + (first + ' ' + last).trim() + ' (' + compRaw + ')', id: subId, region: String(region || ''), fields: [
                        ['Crew company', compRaw + (compMatched && acNorm_(compMatched)!==acNorm_(compRaw) ? ' (matched to ' + compMatched + ')' : '')],
                        ['Buildings matched', accts.join(', ')], ['Submitted by', String(d.submitter_name||'') + (d.submitter_email ? ' | ' + d.submitter_email : '')],
                        ['Why it needs a look', flags.length ? flags.join('; ') : 'A building or a person could not be matched with confidence'] ],
                        links: [['Cleaner roster page (Ops Hub)', 'https://citywidelv.github.io/cw-ops-desk/cleaners.html']] } });
}
function acEsc_(s){
  return String(s===null||s===undefined?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function acPurgeTest(){
  var sh = acTab_(AC_EV, AC_EV_HEAD);
  var rows = acRows_(AC_EV, AC_EV_HEAD);
  var n = 0;
  rows.forEach(function(r){
    if (/^zztest/i.test(String(r.company_raw)) || /^zztest/i.test(String(r.submitter_name))){
      sh.getRange(r._row,1,1,AC_EV_HEAD.length).clearContent();
      n++;
    }
  });
  acRebuild_();
  return n;
}

function doPost(e){
  try { cwMaybeDigest_(); } catch(_cwd){}
  var d = null;
  try { d = JSON.parse(e.postData.contents); } catch(err){ d = null; }
  if (d && d.kind && String(d.kind).indexOf('vio_') === 0) return vioDispatch(d);
  if (d && String(d.kind||"").indexOf('ins_') === 0) return insDispatch(d);
  if (d && String(d.kind||"").indexOf('vd_') === 0) return vdDispatch(d);
      if (d && String(d.kind||'').indexOf('cleaner_') === 0) return acDispatch(String(d.kind), d);
  if (d && String(d.kind||'').indexOf('audit_') === 0) return audDispatch(d);
    if (d && String(d.kind||'').indexOf('staff_') === 0) return staffDispatch(d);
  return doPostBase(e);
}


// ============================================================
// Quota router + digest engine v2 (Sep 5 2026; v1 Aug 18 2026)
// Every internal / confirmation send routes through cwMail_(tag, opts).
// Mode per tag comes from the SendConfig sheet tab, else CW_DEFAULT_MODE:
//   send   = MailApp now
//   digest = queue to the Digest tab; goes out in the 8am and 4pm digests
//   weekly = queue; goes out only in the Monday 8am weekly rollup
//   skip   = drop (the page already showed an on-screen receipt)
// Hard rules that no config can change:
//   * a message carrying an attachment always sends now (a digest cannot
//     carry the file, and the file exists nowhere else for some flows)
//   * the sheet / Drive record is written by the handler BEFORE cwMail_ runs,
//     so digest or skip can never lose a submission
//   * any error inside the router falls back to a plain MailApp send
// The digest runs from cwDigestTick(): a time trigger if one is installed,
// and opportunistically from doGet / doPost (first hit after 8am, after 4pm,
// and Monday after 8am). Marker cells J1 / K1 on the Digest tab make each
// slot fire once, and a script lock stops two hits from sending twice.
// Weekly rollup (Monday 8am) recaps everything queued in the last 7 days,
// digested or immediate, so one email shows the whole week.
// ============================================================
var CW_DEFAULT_MODE = {
  posting: 'digest', response: 'digest', cleaner: 'digest',
  work_ticket: 'digest', uniform_int: 'digest',
  invoice_conf: 'skip', supply_conf: 'skip', invup_conf: 'skip', snow_conf: 'skip', coiupload_conf: 'skip'
};
var CW_DIGEST_HEAD = ['queued', 'tag', 'to', 'subject', 'summary', 'sent', 'cadence', 'details', 'cc'];
var CW_DIGEST_SLOT_CELL = 'K1';   // last slot key sent, e.g. d20260905-16
var CW_DIGEST_WEEK_CELL = 'L1';   // last weekly key sent, e.g. w20260907
var CW_DIGEST_SENDER = 'City Wide Ops Digest';
var CW_TAG_LABEL = {
  posting: 'New opportunities posted', response: 'Vendor responses to opportunities',
  cleaner: 'Cleaner tracker reviews', work_ticket: 'Maintenance work tickets',
  uniform_int: 'Uniform requests', work_ticket_return: 'Work tickets needing a return trip', invoice_int: 'Vendor invoices', invup_int: 'Vendor invoices (uploaded)',
  coiupload_int: 'Insurance and compliance uploads', supply_int: 'Building supply orders',
  envirox: 'EnvirOx orders', profile_int: 'Vendor profile change requests', profile_alert: 'Profile change alerts to vendors',
  snow_int: 'Snow reports', uniform_conf: 'Uniform request confirmations'
};

function cwSendCfg_() {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sh = ss.getSheetByName('SendConfig');
    var cfg = {};
    if (sh) {
      var v = sh.getDataRange().getValues();
      for (var i = 1; i < v.length; i++) { var k = String(v[i][0] || '').trim(); if (k) cfg[k] = String(v[i][1] || '').trim().toLowerCase(); }
    }
    return cfg;
  } catch (e) { return {}; }
}
function cwMode_(tag) { var cfg = cwSendCfg_(); if (cfg[tag]) return cfg[tag]; return CW_DEFAULT_MODE[tag] || 'send'; }

function cwMail_(tag, opts) {
  var mode; try { mode = cwMode_(tag); } catch (e) { mode = 'send'; }
  var hasFile = !!(opts && opts.attachments && opts.attachments.length);
  try {
    if (mode === 'skip') return;
    if ((mode === 'digest' || mode === 'weekly') && !hasFile) {
      try { cwQueueDigest_(tag, opts, mode === 'weekly' ? 'weekly' : 'daily'); return; } catch (dq) { /* fall through to send */ }
    }
    var r = MailApp.sendEmail(opts);
    try { cwQueueDigest_(tag, opts, 'immediate'); } catch (li) {}
    return r;
  } catch (e) { try { return MailApp.sendEmail(opts); } catch (e2) { return; } }
}

function cwDigestSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName('Digest');
  if (!sh) { sh = ss.insertSheet('Digest'); sh.appendRow(CW_DIGEST_HEAD); sh.setFrozenRows(1); }
  else {
    var head = sh.getRange(1, 1, 1, CW_DIGEST_HEAD.length).getValues()[0];
    for (var i = 0; i < CW_DIGEST_HEAD.length; i++) {
      if (String(head[i] || '') !== CW_DIGEST_HEAD[i]) sh.getRange(1, i + 1).setValue(CW_DIGEST_HEAD[i]);
    }
  }
  return sh;
}

// details = { title, fields:[[label, value]...], links:[[label, url]...], region, id }
// Handlers may pass opts.digest with that shape; otherwise the subject and a
// text summary of the body are used.
function cwQueueDigest_(tag, opts, cadence) {
  var sh = cwDigestSheet_();
  var to = String(opts && opts.to || '');
  var cc = String(opts && opts.cc || '');
  var subj = String(opts && opts.subject || '');
  var body = String(opts && opts.body || '');
  if (!body && opts && opts.htmlBody) body = String(opts.htmlBody).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  var det = '';
  try { if (opts && opts.digest) det = JSON.stringify(opts.digest).slice(0, 45000); } catch (je) { det = ''; }
  sh.appendRow([new Date(), tag, to, subj, body.slice(0, 400), cadence === 'immediate', cadence || 'daily', det, cc]);
}

// ------------------------------------------------------------ the tick -----
// Cheap when nothing is due: a 10 minute cache memo, then two cell reads.
function cwDigestTick() {
  var cache = null;
  try { cache = CacheService.getScriptCache(); if (cache.get('cwDigestChecked')) return 'checked recently'; } catch (ce) { cache = null; }
  var lock = null;
  try { lock = LockService.getScriptLock(); if (!lock.tryLock(0)) return 'busy'; } catch (le) { lock = null; }
  var out = [];
  try {
    var sh = cwDigestSheet_();
    var now = new Date();
    var ymd = Utilities.formatDate(now, 'America/Los_Angeles', 'yyyyMMdd');
    var hour = Number(Utilities.formatDate(now, 'America/Los_Angeles', 'H'));
    var dow = Utilities.formatDate(now, 'America/Los_Angeles', 'u');  // 1 = Monday
    var slot = hour >= 16 ? '16' : (hour >= 8 ? '08' : '');
    var sCell = sh.getRange(CW_DIGEST_SLOT_CELL), wCell = sh.getRange(CW_DIGEST_WEEK_CELL);
    if (slot) {
      var key = 'd' + ymd + '-' + slot;
      if (String(sCell.getValue()) !== key) {
        sCell.setValue(key);
        try { out.push('slot ' + slot + ': ' + cwSendSlotDigest_(slot)); } catch (e1) { out.push('slot error ' + e1); }
      }
    }
    if (dow === '1' && hour >= 8) {
      var wkey = 'w' + ymd;
      if (String(wCell.getValue()) !== wkey) {
        wCell.setValue(wkey);
        try { out.push('weekly: ' + cwSendWeeklyRollup_()); } catch (e2) { out.push('weekly error ' + e2); }
      }
    }
    if (cache) { try { cache.put('cwDigestChecked', '1', 600); } catch (cp) {} }
  } catch (e) { out.push('tick error ' + e); }
  finally { if (lock) { try { lock.releaseLock(); } catch (lr) {} } }
  return out.join(' | ') || 'nothing due';
}
function cwMaybeDigest_() { try { cwDigestTick(); } catch (e) {} }

// ----------------------------------------------------------- senders -----
function cwRows_(sh) {
  var v = sh.getDataRange().getValues();
  var rows = [];
  for (var i = 1; i < v.length; i++) {
    var r = v[i];
    if (!r[0] && !r[1]) continue;
    var det = null; try { det = r[7] ? JSON.parse(r[7]) : null; } catch (pe) { det = null; }
    rows.push({ i: i, queued: r[0] instanceof Date ? r[0] : new Date(r[0]), tag: String(r[1] || ''), to: String(r[2] || ''),
      subject: String(r[3] || ''), summary: String(r[4] || ''), sent: (r[5] === true || String(r[5]).toUpperCase() === 'TRUE'),
      cadence: String(r[6] || 'daily').toLowerCase(), details: det, cc: String(r[8] || '') });
  }
  return rows;
}
function cwGroupByTo_(rows) {
  var groups = {};
  rows.forEach(function (r) {
    var key = r.to.toLowerCase().split(/[,;\s]+/).filter(Boolean).sort().join(',');
    if (!groups[key]) groups[key] = { to: key, cc: {}, rows: [] };
    r.cc.toLowerCase().split(/[,;\s]+/).filter(Boolean).forEach(function (c) { if (key.indexOf(c) < 0) groups[key].cc[c] = 1; });
    groups[key].rows.push(r);
  });
  return Object.keys(groups).map(function (k) { return groups[k]; });
}

// Morning (08) or afternoon (16) digest: every unsent daily-cadence row.
function cwSendSlotDigest_(slot) {
  var sh = cwDigestSheet_();
  var rows = cwRows_(sh).filter(function (r) { return !r.sent && r.cadence === 'daily'; });
  if (!rows.length) return 'nothing to send';
  var label = slot === '16' ? 'Afternoon digest' : 'Morning digest';
  var when = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'EEE MMM d') + (slot === '16' ? ', 4 PM' : ', 8 AM');
  var sentCount = 0;
  cwGroupByTo_(rows).forEach(function (g) {
    var cc = Object.keys(g.cc).join(',');
    var html = cwDigestHtml_(label, when, g.rows, 'Items since the last digest. Full records are in the sheets linked on each item.');
    MailApp.sendEmail({ to: g.to, cc: cc, name: CW_DIGEST_SENDER,
      subject: 'City Wide ' + label.toLowerCase() + ' - ' + when + ' (' + g.rows.length + (g.rows.length === 1 ? ' item)' : ' items)'),
      htmlBody: html, body: cwDigestPlain_(label, when, g.rows) });
    sentCount++;
  });
  rows.forEach(function (r) { sh.getRange(r.i + 1, 6).setValue(true); });
  return 'sent ' + rows.length + ' item(s) in ' + sentCount + ' email(s)';
}

// Monday rollup: everything queued in the last 7 days (digested or immediate)
// plus any unsent weekly-cadence rows, grouped the same way.
function cwSendWeeklyRollup_() {
  var sh = cwDigestSheet_();
  var since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  var all = cwRows_(sh);
  var rows = all.filter(function (r) { return (r.cadence === 'weekly' && !r.sent) || (r.queued >= since); });
  if (!rows.length) return 'nothing to send';
  var when = 'week of ' + Utilities.formatDate(since, 'America/Los_Angeles', 'MMM d') + ' to ' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'MMM d');
  var sentCount = 0;
  cwGroupByTo_(rows).forEach(function (g) {
    var html = cwDigestHtml_('Weekly rollup', when, g.rows, 'Everything that came through in the last 7 days, including notices that were sent right away. Items marked "sent immediately" already reached you when they happened.');
    MailApp.sendEmail({ to: g.to, cc: Object.keys(g.cc).join(','), name: CW_DIGEST_SENDER,
      subject: 'City Wide weekly rollup - ' + when + ' (' + g.rows.length + (g.rows.length === 1 ? ' item)' : ' items)'),
      htmlBody: html, body: cwDigestPlain_('Weekly rollup', when, g.rows) });
    sentCount++;
  });
  rows.forEach(function (r) { if (!r.sent) sh.getRange(r.i + 1, 6).setValue(true); });
  return 'sent ' + rows.length + ' item(s) in ' + sentCount + ' email(s)';
}

// -------------------------------------------------------------- HTML -----
function cwDigestHtml_(label, when, rows, note) {
  var F = 'font-family:Verdana,Arial,sans-serif;';
  var byTag = {}; var order = [];
  rows.forEach(function (r) { if (!byTag[r.tag]) { byTag[r.tag] = []; order.push(r.tag); } byTag[r.tag].push(r); });
  var chips = order.map(function (t) {
    return '<td style="padding:0 8px 8px 0;"><div style="' + F + 'font-size:12px;color:#2d2a26;background:#F5F5F5;border:1px solid #E5E5E5;border-radius:6px;padding:8px 12px;white-space:nowrap;">' +
      '<b style="color:#D22730;font-size:16px;">' + byTag[t].length + '</b>&nbsp; ' + _esc(CW_TAG_LABEL[t] || t) + '</div></td>';
  }).join('');
  var sections = order.map(function (t) {
    var items = byTag[t].map(function (r) { return cwDigestItem_(r, F); }).join('');
    return '<h2 style="margin:26px 0 10px;' + F + 'font-size:14px;font-weight:bold;color:#2d2a26;border-bottom:2px solid #D22730;padding-bottom:5px;text-transform:uppercase;letter-spacing:0.04em;">' +
      _esc(CW_TAG_LABEL[t] || t) + ' <span style="color:#636466;font-weight:normal;text-transform:none;letter-spacing:0;">(' + byTag[t].length + ')</span></h2>' + items;
  }).join('');
  return '' +
    '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td align="center" style="padding:20px 0;">' +
    '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="680" style="max-width:680px;">' +
    '<tr><td style="padding:24px 30px 0;"><img src="' + LOGO + '" height="38" alt="City Wide Facility Solutions" style="display:block;border:0;height:38px;width:auto;"></td></tr>' +
    '<tr><td style="padding:18px 30px 0;"><div style="background:#2d2a26;color:#ffffff;' + F + 'font-size:15px;font-weight:bold;padding:12px 16px;letter-spacing:0.5px;">' +
    _esc(label.toUpperCase()) + ' <span style="font-weight:normal;color:#cfcdca;">&middot; ' + _esc(when) + '</span></div></td></tr>' +
    '<tr><td style="padding:16px 30px 0;"><p style="margin:0 0 12px;' + F + 'font-size:12px;color:#636466;line-height:1.5;">' + _esc(note) + '</p>' +
    '<table border="0" cellpadding="0" cellspacing="0"><tr>' + chips + '</tr></table></td></tr>' +
    '<tr><td style="padding:0 30px 30px;">' + sections +
    '<p style="margin:26px 0 0;' + F + 'font-size:11px;line-height:1.6;color:#999999;">Sent by the City Wide platform digest. Which notices are immediate and which roll up here is set on the SendConfig tab of the CW Solicitations sheet. GoCityWide.com</p>' +
    '</td></tr></table></td></tr></table>';
}

function cwDigestItem_(r, F) {
  var d = r.details || {};
  var title = String(d.title || r.subject || '(no subject)');
  var stamp = Utilities.formatDate(r.queued, 'America/Los_Angeles', 'EEE h:mm a');
  var fields = (d.fields || []).filter(function (f) { return f && f[1] !== undefined && f[1] !== null && String(f[1]) !== ''; });
  var rowsHtml = fields.map(function (f) {
    return '<tr><td style="padding:3px 12px 3px 0;' + F + 'font-size:11px;color:#636466;white-space:nowrap;vertical-align:top;">' + _esc(String(f[0])) + '</td>' +
      '<td style="padding:3px 0;' + F + 'font-size:12px;color:#2d2a26;">' + _esc(String(f[1])) + '</td></tr>';
  }).join('');
  if (!fields.length && r.summary) rowsHtml = '<tr><td style="padding:3px 0;' + F + 'font-size:12px;color:#2d2a26;line-height:1.5;">' + _esc(r.summary) + '</td></tr>';
  var links = (d.links || []).filter(function (l) { return l && l[1]; }).map(function (l) {
    return '<a href="' + String(l[1]).replace(/"/g, '') + '" style="' + F + 'font-size:12px;font-weight:bold;color:#D22730;text-decoration:none;margin-right:16px;">' + _esc(String(l[0])) + ' &rarr;</a>';
  }).join('');
  var flag = r.cadence === 'immediate' ? '<span style="' + F + 'font-size:10px;font-weight:bold;color:#0AA6A9;letter-spacing:0.06em;text-transform:uppercase;margin-left:8px;">sent immediately</span>' : '';
  return '<div style="border:1px solid #E5E5E5;border-left:4px solid #D22730;border-radius:0 6px 6px 0;padding:12px 14px;margin:0 0 10px;">' +
    '<p style="margin:0 0 6px;' + F + 'font-size:13px;font-weight:bold;color:#2d2a26;">' + _esc(title) + flag +
    '<span style="font-weight:normal;color:#999999;font-size:11px;margin-left:8px;">' + _esc(stamp) + (d.region ? ' &middot; ' + _esc(String(d.region)) : '') + '</span></p>' +
    (rowsHtml ? '<table border="0" cellpadding="0" cellspacing="0" width="100%">' + rowsHtml + '</table>' : '') +
    (links ? '<p style="margin:8px 0 0;">' + links + '</p>' : '') +
    '</div>';
}

function cwDigestPlain_(label, when, rows) {
  var l = [label + ' - ' + when, ''];
  rows.forEach(function (r) {
    var d = r.details || {};
    l.push('* ' + (d.title || r.subject) + (r.cadence === 'immediate' ? ' [sent immediately]' : ''));
    (d.fields || []).forEach(function (f) { if (f && f[1]) l.push('    ' + f[0] + ': ' + f[1]); });
    if (!(d.fields || []).length && r.summary) l.push('    ' + r.summary);
    (d.links || []).forEach(function (k) { if (k && k[1]) l.push('    ' + k[0] + ': ' + k[1]); });
    l.push('');
  });
  return l.join('\n');
}

// ----------------------------------------------- editor Run helpers -----
// Optional time triggers (need the script.scriptapp scope once). The tick is
// idempotent, so triggers and the opportunistic path can both run.
function cwInstallDigestTrigger() {
  var trigs = ScriptApp.getProjectTriggers();
  var out = [];
  trigs.forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'cwSendDailyDigest' || h === 'cwSendWeeklyDigest') { ScriptApp.deleteTrigger(t); out.push('removed old ' + h); }
  });
  var have = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'cwDigestTick'; }).length;
  if (have < 2) {
    ScriptApp.newTrigger('cwDigestTick').timeBased().atHour(8).nearMinute(5).everyDays(1).inTimezone('America/Los_Angeles').create();
    ScriptApp.newTrigger('cwDigestTick').timeBased().atHour(16).nearMinute(5).everyDays(1).inTimezone('America/Los_Angeles').create();
    out.push('installed 8am + 4pm ticks');
  } else out.push('ticks present');
  Logger.log(out.join(', ')); return out.join(', ');
}
// Force the current slot's digest now (ignores the once-per-slot marker). Marks rows sent.
function cwSendDigestNow() { var r = cwSendSlotDigest_(Number(Utilities.formatDate(new Date(), 'America/Los_Angeles', 'H')) >= 16 ? '16' : '08'); Logger.log(r); return r; }
function cwSendWeeklyNow() { var r = cwSendWeeklyRollup_(); Logger.log(r); return r; }
// Backward-compatible names (old triggers, old notes)
function cwSendDailyDigest() { return cwSendDigestNow(); }
function cwSendWeeklyDigest() { return cwSendWeeklyNow(); }
function cwDigestStatus() {
  var sh = cwDigestSheet_();
  var rows = cwRows_(sh);
  var pending = rows.filter(function (r) { return !r.sent && r.cadence !== 'immediate'; }).length;
  var s = 'slot marker ' + sh.getRange(CW_DIGEST_SLOT_CELL).getValue() + ' | weekly marker ' + sh.getRange(CW_DIGEST_WEEK_CELL).getValue() +
    ' | rows ' + rows.length + ' | pending ' + pending + ' | config ' + JSON.stringify(cwSendCfg_());
  Logger.log(s); return s;
}
function cwQuotaSetup() {
  cwDigestSheet_();
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var s = ss.getSheetByName('SendConfig');
  if (!s) { s = ss.insertSheet('SendConfig'); s.appendRow(['tag', 'mode']); }
  var have = {}; var v = s.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) have[String(v[i][0]).trim()] = i + 1;
  var want = [['posting', 'digest'], ['response', 'digest'], ['cleaner', 'digest'], ['work_ticket', 'digest'], ['uniform_int', 'digest'],
    ['invoice_int', 'send'], ['invup_int', 'send'], ['coiupload_int', 'send'], ['supply_int', 'send'], ['envirox', 'send'],
    ['profile_int', 'send'], ['profile_alert', 'send'], ['snow_int', 'send'], ['uniform_conf', 'send'], ['work_ticket_return', 'send'],
    ['invoice_conf', 'skip'], ['supply_conf', 'skip'], ['invup_conf', 'skip'], ['snow_conf', 'skip'], ['coiupload_conf', 'skip']];
  var added = [];
  want.forEach(function (w) { if (!have[w[0]]) { s.appendRow(w); added.push(w[0] + '=' + w[1]); } });
  return 'SendConfig rows added: ' + (added.join(', ') || 'none') + '. Existing rows left as they were.';
}
function cwDigestOn() {
  var ss = SpreadsheetApp.openById(SHEET_ID); var sh = ss.getSheetByName('SendConfig'); var v = sh.getDataRange().getValues(); var out = [];
  var want = ['posting', 'response', 'cleaner', 'work_ticket', 'uniform_int'];
  for (var i = 1; i < v.length; i++) { var tag = String(v[i][0]).trim(); if (want.indexOf(tag) >= 0 && String(v[i][1]) !== 'digest') { sh.getRange(i + 1, 2).setValue('digest'); out.push(tag + '->digest'); } }
  Logger.log(out.join(',') || 'already on'); return out.join(',') || 'already on';
}
function cwDigestOff() {
  var ss = SpreadsheetApp.openById(SHEET_ID); var sh = ss.getSheetByName('SendConfig'); var v = sh.getDataRange().getValues(); var out = [];
  var want = ['posting', 'response', 'cleaner', 'work_ticket', 'uniform_int'];
  for (var i = 1; i < v.length; i++) { var tag = String(v[i][0]).trim(); if (want.indexOf(tag) >= 0) { sh.getRange(i + 1, 2).setValue('send'); out.push(tag + '->send'); } }
  Logger.log(out.join(',')); return out.join(',');
}

// Queues two sample rows addressed to `to` and sends a digest with ONLY those rows, so the
// engine can be proven without emailing the service inboxes. Rows are marked sent.
function cwDigestSelfTest(to) {
  to = to || Session.getEffectiveUser().getEmail();
  var sh = cwDigestSheet_();
  cwQueueDigest_('posting', { to: to, subject: 'ZZ SELFTEST posting', body: 'selftest', digest: { title: 'ZZ SELFTEST posting - Night clean, Spring Valley', id: 'LV-TEST', region: 'Las Vegas',
    fields: [['Posting', 'LV-TEST'], ['Type', 'recurring'], ['Pay', '$1,200 per month'], ['Posted by', 'Ops Hub']], links: [['Live board', BOARD_URL]] } }, 'daily');
  cwQueueDigest_('response', { to: to, subject: 'ZZ SELFTEST response', body: 'selftest', digest: { title: 'ZZ SELFTEST interest: Sample Crew LLC for Night clean', id: 'R-TEST', region: 'Las Vegas',
    fields: [['Contact', 'Sample Vendor <vendor@example.com> 702-555-0100'], ['Earliest start', 'Next week'], ['Crew size', '2']], links: [['Responses sheet', SpreadsheetApp.openById(SHEET_ID).getUrl()]] } }, 'daily');
  var rows = cwRows_(sh).filter(function (r) { return !r.sent && r.cadence === 'daily' && r.to.toLowerCase() === String(to).toLowerCase() && /ZZ SELFTEST/.test(r.subject); });
  var when = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'EEE MMM d h:mm a');
  MailApp.sendEmail({ to: to, name: CW_DIGEST_SENDER, subject: 'City Wide digest SELF-TEST - ' + when + ' (' + rows.length + ' items)',
    htmlBody: cwDigestHtml_('Self-test digest', when, rows, 'Two sample items queued by cwDigestSelfTest. Real digests go out at 8 AM and 4 PM.'), body: cwDigestPlain_('Self-test digest', when, rows) });
  rows.forEach(function (r) { sh.getRange(r.i + 1, 6).setValue(true); });
  var s = 'self-test digest sent to ' + to + ' with ' + rows.length + ' rows';
  Logger.log(s); return s;
}

function handleInvoiceMailLog(data){
  var out={ok:false};
  try {
    if (data.website) return _json({ok:true, id:'IM-HP'});
    var company=String(data.company||'').trim();
    var email=String(data.email||'').trim();
    var region=String(data.region||'').trim();
    var month=String(data.service_month||'').trim();
    var total=Number(String(data.total||'').replace(/[$,\s]/g,''));
    if(!company || email.indexOf('@')<1 || !region || !month || !total || isNaN(total)){ out.error='Missing required fields'; return _json(out); }
    var ss=SpreadsheetApp.openById(SHEET_ID);
    var sh=ss.getSheetByName('Invoices'); if(!sh){ setupInvoicing(); sh=ss.getSheetByName('Invoices'); }
    var stamp=Utilities.formatDate(new Date(),'America/Los_Angeles','yyMMddHHmm');
    var id='IM-'+stamp+'-'+Math.random().toString(36).slice(2,5).toUpperCase();
    var row=[id, new Date(), region, company, String(data.contact_name||''), email, String(data.phone||''), '', month, 0, total, 'mailto - vendor emailed invoice file directly to AP', String(data.comments||'')];
    var r=_nextRow(sh);
    sh.getRange(r,1,1,row.length).setValues([row]);
    return _json({ok:true, id:id});
  } catch(e){ out.error=String(e); return _json(out); }
}
