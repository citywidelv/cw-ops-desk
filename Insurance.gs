// ============================================================
// Insurance.gs - vendor certificate of insurance requests (Aug 2026)
// New FILE in the CW Solicitations Apps Script project.
// Routing: doPost in Code.gs routes any kind starting 'ins_' to insDispatch(data).
// Kinds: ins_setup, ins_roster, ins_send  (all POST, passcode-gated)
//
// Purpose: an FSM picks a market, builds a list of vendors whose certificate on
// file has expired, marks the coverage needed per vendor, and fires ONE separate
// branded email per vendor. The email's only job is one click on one button that
// lands the vendor (or their agent) on the existing upload page with the region,
// document type and coverage already selected.
//
// Safety: while InsConfig ins_live != TRUE, EVERY send is forced to the internal
// inbox (InsConfig ins_test_to) with a TEST-prefixed subject and a TEST banner.
// Nothing reaches a vendor until TJ flips ins_live to TRUE.
//
// Deliberately NOT here: no approval gate (this is a records request, not a
// violation), no Reno relay (both markets send from the LV Gmail by decision;
// every entity string is driven off the selected market instead), no new
// deployment, no changes to any vio_* code or tab.
// ============================================================

var INS_TABS = { LOG: 'Insurance', CONFIG: 'InsConfig', ROSTER: 'Roster', ISSUERS: 'Issuers' };

var INS_LOG_HEADERS = [
  'request_id', 'batch_id', 'sent', 'test', 'market', 'vendor_dba', 'vendor_owner',
  'vendor_email', 'vendor_no', 'coverage', 'issuer_name', 'issuer_email', 'entry',
  'upload_link', 'form_attached', 'email_status', 'notes'
];

// Everything entity-specific lives here and is selected by market. Nothing below
// may be hardcoded into the email body.
var INS_MARKETS = {
  'Las Vegas': {
    key: 'LV',
    roster_key: 'LV',
    label: 'City Wide Facility Solutions of Las Vegas',
    entity: 'Low Drag, LLC dba City Wide Facility Solutions',
    addr1: '3215 W Charleston Blvd, Suite 130',
    addr2: 'Las Vegas, NV 89102',
    compliance: 'LVCompliance@gocitywide.com',
    region_param: 'lv',
    form_cfg: 'ins_form_lv',
    form_drive_cfg: 'ins_form_drive_lv'
  },
  'Northern Nevada': {
    key: 'NNV',
    roster_key: 'NNV',
    label: 'City Wide Facility Solutions of Northern Nevada',
    entity: 'Dash Two, LLC dba City Wide Facility Solutions',
    addr1: '1000 Bible Way, Suite 2',
    addr2: 'Reno, NV 89502',
    compliance: 'rncompliance@gocitywide.com',
    region_param: 'nnv',
    form_cfg: 'ins_form_nnv',
    form_drive_cfg: 'ins_form_drive_nnv'
  }
};

var INS_COVERAGE = {
  gl:   { label: 'General Liability',                          param: 'gl',   hasGL: true,  hasWC: false },
  wc:   { label: "Workers' Compensation",                      param: 'wc',   hasGL: false, hasWC: true  },
  both: { label: "General Liability and Workers' Compensation", param: 'both', hasGL: true,  hasWC: true  }
};

var INS_LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
// City Wide Teal, the approved secondary accent. White on this teal measures 3.0:1,
// which carries large bold text only, so the whole callout is set 19px bold.
var INS_TEAL = '#0AA6A9';
var INS_UPLOAD_URL = 'https://citywidelv.github.io/cw-vendor-shop/upload.html';

// The live, vendor-facing revision of each request form. new-vendors.html links
// these same files, so the attachment and the website can never disagree.
// Both are config values so the revision can be changed without a deployment.
var INS_DEFAULTS = [
  ['ins_live', 'FALSE'],
  ['ins_test_to', 'lvservicecall@gocitywide.com'],
  ['ins_sender_name', 'City Wide Compliance'],
  ['ins_batch_max', '25'],
  ['ins_dup_days', '14'],
  ['ins_upload_url', INS_UPLOAD_URL],
  ['ins_payment_notice', 'Updated certificates must be on file before your next payment can be issued.'],
  ['ins_form_lv', 'https://citywidelv.github.io/cw-vendor-shop/pdfs/COI-Request-Las-Vegas.pdf'],
  ['ins_form_nnv', 'https://citywidelv.github.io/cw-vendor-shop/pdfs/COI-Request-Northern-Nevada.pdf'],
  ['ins_form_drive_lv', ''],
  ['ins_form_drive_nnv', '']
];

function insPass_() {
  try { if (typeof PASSCODE !== 'undefined') return PASSCODE; } catch (e) {}
  return PropertiesService.getScriptProperties().getProperty('PASSCODE') || '';
}

function insDispatch(data) {
  var kind = String(data.kind || '');
  if ((data.passcode || '') !== insPass_()) return _json({ ok: false, error: 'Bad passcode' });
  if (kind === 'ins_setup') return insSetup_(data);
  if (kind === 'ins_roster') return insRoster_(data);
  if (kind === 'ins_send') return insSend_(data);
  if (kind === 'ins_form') return insForm_(data);
  if (kind === 'ins_exp') return insExp_(data);
  return _json({ ok: false, error: 'Unknown ins kind' });
}

// Shares the CW Violation Notices spreadsheet, because the IC Roster and Issuers
// already live there. Insurance writes ONLY to its own two tabs.
function insSS_() {
  var id = PropertiesService.getScriptProperties().getProperty('VIO_SHEET_ID');
  if (!id) throw new Error('No VIO_SHEET_ID script property. Run vio_setup once first.');
  return SpreadsheetApp.openById(id);
}

function insSetup_(data) {
  var ss = insSS_();
  function tab(name, headers, color) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground(color).setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    return sh;
  }
  var log = tab(INS_TABS.LOG, INS_LOG_HEADERS, '#D22730');
  var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  log.getRange(2, INS_LOG_HEADERS.indexOf('test') + 1, 999, 1).setDataValidation(rule);

  var cfg = tab(INS_TABS.CONFIG, ['key', 'value'], '#636466');
  var have = {};
  var vals = cfg.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) have[String(vals[i][0]).trim()] = true;
  var add = INS_DEFAULTS.filter(function (p) { return !have[p[0]]; });
  if (add.length) cfg.getRange(cfg.getLastRow() + 1, 1, add.length, 2).setValues(add);

  return _json({ ok: true, sheet_id: ss.getId(), url: ss.getUrl(), config_added: add.length });
}

function insConfig_(ss) {
  var sh = ss.getSheetByName(INS_TABS.CONFIG);
  var cfg = {};
  INS_DEFAULTS.forEach(function (p) { cfg[p[0]] = p[1]; });
  if (!sh) return cfg;
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    var k = String(vals[i][0]).trim();
    if (k) cfg[k] = String(vals[i][1]);
  }
  return cfg;
}

function insMarket_(name) {
  return INS_MARKETS[String(name || '').trim()] || null;
}

function insCoverage_(code) {
  var c = String(code || '').trim().toLowerCase();
  if (c === 'gl' || c === 'general liability') return INS_COVERAGE.gl;
  if (c === 'wc' || c === "workers' compensation" || c === 'workers compensation') return INS_COVERAGE.wc;
  if (c === 'both') return INS_COVERAGE.both;
  return null;
}

function insEmails_(raw) {
  return String(raw || '').split(/[,;]+/).map(function (s) { return s.trim(); })
    .filter(function (s) { return s.indexOf('@') > 0; }).join(',');
}

// -------------------------------------------------- roster expiry sync -----
// The Roster tab is shared with the violation notice picklist, which reads
// columns A through I by fixed index. Expiry is written to J and K, past the end
// of what that code touches, so this cannot affect violations.
var INS_ROSTER_GL_COL = 10;   // J
var INS_ROSTER_WC_COL = 11;   // K

// Vendor numbers arrive with and without leading zeros depending on whether a
// sheet or an export produced them. Compare on the digits alone.
function insVno_(v) {
  return String(v == null ? '' : v).replace(/[^0-9]/g, '').replace(/^0+/, '');
}

// Accepts rows of {vno, gl, wc} and writes the two expiry cells for each match.
// Reports anything it could not match rather than guessing.
function insExp_(data) {
  var rows = data.rows || [];
  if (!rows.length) return _json({ ok: false, error: 'No rows' });
  var ss = insSS_();
  var sh = ss.getSheetByName(INS_TABS.ROSTER);
  if (!sh) return _json({ ok: false, error: 'No Roster tab' });

  sh.getRange(1, INS_ROSTER_GL_COL).setValue('gl_exp').setFontWeight('bold')
    .setBackground('#2D2A26').setFontColor('#FFFFFF');
  sh.getRange(1, INS_ROSTER_WC_COL).setValue('wc_exp').setFontWeight('bold')
    .setBackground('#2D2A26').setFontColor('#FFFFFF');

  var vals = sh.getDataRange().getValues();
  var rowByVno = {}, rowByDba = {};
  for (var i = 1; i < vals.length; i++) {
    var v = insVno_(vals[i][5]);
    if (v) rowByVno[v] = i + 1;
    var d = String(vals[i][1] || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();
    if (d) rowByDba[d] = i + 1;
  }

  var wrote = 0, missed = [];
  rows.forEach(function (r) {
    var target = rowByVno[insVno_(r.vno)] ||
      rowByDba[String(r.dba || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase()];
    if (!target) { missed.push(String(r.dba || r.vno || '?')); return; }
    sh.getRange(target, INS_ROSTER_GL_COL).setValue(String(r.gl || ''));
    sh.getRange(target, INS_ROSTER_WC_COL).setValue(String(r.wc || ''));
    if (r.hide === true || String(r.hide).toUpperCase() === 'TRUE') {
      sh.getRange(target, 9).setValue('TRUE');
    }
    wrote++;
  });
  return _json({ ok: true, updated: wrote, unmatched: missed });
}

// A blank date is unknown, never treated as expired. Dates far in the future
// (Business Central uses 3000-01-01 for "not applicable") are treated as none.
function insExpiryState_(raw, todayMs) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return { state: 'unknown', label: '' };
  var d = s instanceof Date ? s : new Date(s);
  if (isNaN(d.getTime())) return { state: 'unknown', label: '' };
  if (d.getFullYear() >= 2900) return { state: 'none', label: '' };
  var days = Math.floor((d.getTime() - todayMs) / 86400000);
  var label = Utilities.formatDate(d, 'America/Los_Angeles', 'MMM d, yyyy');
  if (days < 0) return { state: 'expired', label: label, days: days };
  if (days <= 30) return { state: 'soon', label: label, days: days };
  return { state: 'ok', label: label, days: days };
}

// ------------------------------------------------------------ roster -----
function insRoster_(data) {
  var ss = insSS_();
  var cfg = insConfig_(ss);

  var roster = [];
  var today = new Date().getTime();
  var rsh = ss.getSheetByName(INS_TABS.ROSTER);
  if (rsh) {
    var rv = rsh.getDataRange().getValues();
    for (var i = 1; i < rv.length; i++) {
      if (!rv[i][1]) continue;                                    // no dba
      if (String(rv[i][8]).toUpperCase() === 'TRUE') continue;     // hide
      var mk = String(rv[i][0]).trim().toUpperCase() === 'NNV' ? 'Northern Nevada' : 'Las Vegas';
      var gl = insExpiryState_(rv[i][INS_ROSTER_GL_COL - 1], today);
      var wc = insExpiryState_(rv[i][INS_ROSTER_WC_COL - 1], today);
      roster.push({
        market: mk, dba: String(rv[i][1]), owner: String(rv[i][2] || ''),
        email: String(rv[i][3] || ''), vendor_no: String(rv[i][5] || ''),
        status: String(rv[i][7] || ''),
        gl: gl, wc: wc
      });
    }
  }

  var issuers = [];
  var ish = ss.getSheetByName(INS_TABS.ISSUERS);
  if (ish) {
    var iv = ish.getDataRange().getValues();
    for (var j = 1; j < iv.length; j++) {
      if (!iv[j][0]) continue;
      if (String(iv[j][2]).toUpperCase() !== 'TRUE') continue;
      issuers.push({ name: String(iv[j][0]), email: String(iv[j][1] || '') });
    }
  }

  // Recent requests, for the duplicate guard on the page.
  var recent = {};
  var days = Number(cfg.ins_dup_days) || 14;
  var cutoff = Date.now() - days * 24 * 3600 * 1000;
  var lsh = ss.getSheetByName(INS_TABS.LOG);
  if (lsh && lsh.getLastRow() > 1) {
    var lv = lsh.getDataRange().getValues();
    var iSent = INS_LOG_HEADERS.indexOf('sent');
    var iTest = INS_LOG_HEADERS.indexOf('test');
    var iMk = INS_LOG_HEADERS.indexOf('market');
    var iEm = INS_LOG_HEADERS.indexOf('vendor_email');
    var iDba = INS_LOG_HEADERS.indexOf('vendor_dba');
    var iCov = INS_LOG_HEADERS.indexOf('coverage');
    for (var k = 1; k < lv.length; k++) {
      if (!lv[k][0]) continue;
      var when = lv[k][iSent] instanceof Date ? lv[k][iSent].getTime() : Date.parse(lv[k][iSent]);
      if (!(when > cutoff)) continue;
      var key = String(lv[k][iMk]) + '|' + String(lv[k][iDba]).trim().toLowerCase();
      var isTest = lv[k][iTest] === true || String(lv[k][iTest]).toUpperCase() === 'TRUE';
      var prev = recent[key];
      if (!prev || when > prev.ms) {
        recent[key] = {
          ms: when,
          when: Utilities.formatDate(new Date(when), 'America/Los_Angeles', 'MMM d'),
          coverage: String(lv[k][iCov] || ''),
          test: isTest
        };
      }
    }
  }

  var quota = -1;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}

  return _json({
    ok: true, roster: roster, issuers: issuers, recent: recent, quota: quota,
    config: {
      live: String(cfg.ins_live).toUpperCase() === 'TRUE',
      test_to: cfg.ins_test_to,
      batch_max: Number(cfg.ins_batch_max) || 25,
      dup_days: days,
      sender_name: cfg.ins_sender_name,
      upload_url: cfg.ins_upload_url || INS_UPLOAD_URL
    },
    markets: Object.keys(INS_MARKETS)
  });
}

// ------------------------------------------------------- request form -----
// The request form is stored in Drive, not fetched over the network at send
// time. Two reasons: the deployment is not authorized for UrlFetchApp (the same
// gap that would break the violations Reno relay), and an outbound fetch is one
// more thing that can fail mid-batch. Refresh a form with kind ins_form.
function insFormFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('INS_FORM_FOLDER');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {}
  }
  var f = DriveApp.createFolder('CW Insurance Request Forms');
  props.setProperty('INS_FORM_FOLDER', f.getId());
  return f;
}

// Accepts the PDF as base64 and files it in Drive, then points the market's
// config key at it. Same pattern the violations photo upload already uses.
function insForm_(data) {
  var mk = insMarket_(data.market);
  if (!mk) return _json({ ok: false, error: 'Pick a market: Las Vegas or Northern Nevada' });
  if (!data.data) return _json({ ok: false, error: 'No file data' });
  var name = String(data.name || ('COI-Request-' + mk.key + '.pdf'));
  var folder = insFormFolder_();

  // Replace any earlier copy rather than piling up revisions.
  var old = folder.getFilesByName(name);
  while (old.hasNext()) { old.next().setTrashed(true); }

  var blob = Utilities.newBlob(Utilities.base64Decode(String(data.data)),
    String(data.mime || 'application/pdf'), name);
  var file = folder.createFile(blob);

  var ss = insSS_();
  var cfg = ss.getSheetByName(INS_TABS.CONFIG);
  var vals = cfg.getDataRange().getValues();
  var wrote = false;
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === mk.form_drive_cfg) {
      cfg.getRange(i + 1, 2).setValue(file.getId());
      wrote = true;
      break;
    }
  }
  if (!wrote) {
    cfg.getRange(cfg.getLastRow() + 1, 1, 1, 2).setValues([[mk.form_drive_cfg, file.getId()]]);
  }
  return _json({ ok: true, market: data.market, file_id: file.getId(), name: name,
    bytes: blob.getBytes().length });
}

// Drive first, network second, and a clear failure third. Never sends an email
// without the form, because the body tells the vendor to hand it to their agent.
function insAttachment_(cfg, mk) {
  var driveId = String(cfg[mk.form_drive_cfg] || '').trim();
  var name = 'Certificate of Insurance Request - ' +
    (mk.key === 'NNV' ? 'Northern Nevada' : 'Las Vegas') + '.pdf';
  if (driveId) {
    try {
      var blob = DriveApp.getFileById(driveId).getBlob().setName(name);
      return { blob: blob, name: name, source: 'drive' };
    } catch (de) {
      return { error: 'the stored form file could not be opened (' + String(de) + ')' };
    }
  }
  var url = String(cfg[mk.form_cfg] || '');
  if (!url) return { error: 'no form is configured for this market' };
  try {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() !== 200) {
      return { error: 'form download returned HTTP ' + resp.getResponseCode() };
    }
    return { blob: resp.getBlob().setName(name), name: name, source: 'url' };
  } catch (fe) {
    return { error: 'no form stored in Drive for this market, and downloading it failed (' +
      String(fe) + '). Run kind ins_form once per market to file the PDF in Drive.' };
  }
}

// -------------------------------------------------------------- send -----
function insLink_(cfg, mk, cov, company) {
  return (cfg.ins_upload_url || INS_UPLOAD_URL) +
    '?doc=coi&cov=' + cov.param + '&region=' + mk.region_param +
    // encodeURIComponent leaves ' and ! alone. Mail clients that auto-link plain
    // text routinely stop at an apostrophe, which would truncate the URL for any
    // vendor named like "O'Brien & Sons". Encode them too.
    '&company=' + encodeURIComponent(String(company || ''))
      .replace(/'/g, '%27').replace(/!/g, '%21');
}

function insSend_(d) {
  var ss = insSS_();
  var cfg = insConfig_(ss);
  var live = String(cfg.ins_live).toUpperCase() === 'TRUE';
  var test = !live || d.test === true || String(d.test).toUpperCase() === 'TRUE';
  var testTo = insEmails_(cfg.ins_test_to) || 'lvservicecall@gocitywide.com';

  var mk = insMarket_(d.market);
  if (!mk) return _json({ ok: false, error: 'Pick a market: Las Vegas or Northern Nevada' });
  if (!d.issuer_name) return _json({ ok: false, error: 'Issuer name is required' });

  var vendors = d.vendors || [];
  if (!vendors.length) return _json({ ok: false, error: 'No vendors in the batch' });

  var batchMax = Number(cfg.ins_batch_max) || 25;
  if (vendors.length > batchMax) {
    return _json({ ok: false, error: 'Batch of ' + vendors.length + ' is over the limit of ' +
      batchMax + '. Send it in smaller runs.' });
  }

  // Shared consumer-Gmail quota. Refuse the whole batch rather than half-send it.
  var quota = -1;
  try { quota = MailApp.getRemainingDailyQuota(); } catch (e) {}
  if (quota >= 0 && quota < vendors.length) {
    return _json({ ok: false, error: 'Only ' + quota + ' emails left on today\'s shared Google quota, ' +
      'and this batch needs ' + vendors.length + '. Nothing was sent. Try again tomorrow or send fewer.' });
  }

  // Resolve the market's request form once and reuse the blob for every email.
  var got = insAttachment_(cfg, mk);
  if (got.error) {
    return _json({ ok: false, error: 'Could not attach the request form: ' + got.error +
      '. Nothing was sent, because the email tells the vendor to hand the attached form to their agent.' });
  }
  var attachment = got.blob, formName = got.name;

  var stamp = Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyMMdd');
  var batchId = 'INS-B-' + stamp + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  var senderName = cfg.ins_sender_name || 'City Wide Compliance';

  var results = [], rows = [];
  vendors.forEach(function (v, n) {
    var cov = insCoverage_(v.coverage);
    var company = String(v.dba || '').trim();
    var to = insEmails_(v.email);
    var rid = 'INS-' + mk.key + '-' + stamp + '-' +
      (Math.random().toString(36).slice(2, 5) + n).toUpperCase().slice(0, 4);

    if (!company) {
      results.push({ ok: false, dba: '(blank)', error: 'No company name on this row' });
      return;
    }
    if (!cov) {
      results.push({ ok: false, dba: company, error: 'No coverage selected' });
      return;
    }
    if (!to) {
      results.push({ ok: false, dba: company, error: 'No valid email address' });
      return;
    }

    var link = insLink_(cfg, mk, cov, company);
    var notice = String(cfg.ins_payment_notice || '').trim();
    var html = insEmail_(company, v.owner, mk, cov, link, test, formName, notice);
    var plain = insPlain_(company, mk, cov, link, test, notice);
    var subject = (test ? 'TEST | ' : '') +
      'Certificate of insurance request | City Wide Facility Solutions';
    var actualTo = test ? testTo : to;
    var status = '';
    var sentOk = false;
    try {
      MailApp.sendEmail({
        to: actualTo,
        replyTo: mk.compliance,
        name: senderName,
        subject: subject,
        htmlBody: html,
        body: plain,
        attachments: [attachment]
      });
      sentOk = true;
      status = test ? 'TEST sent to ' + actualTo : 'sent';
    } catch (mailErr) {
      status = 'SEND FAILED: ' + String(mailErr);
    }

    results.push({ ok: sentOk, dba: company, email: test ? actualTo : to,
      coverage: cov.label, request_id: rid, status: status, link: link });

    rows.push(INS_LOG_HEADERS.map(function (h) {
      switch (h) {
        case 'request_id': return rid;
        case 'batch_id': return batchId;
        case 'sent': return new Date();
        case 'test': return test;
        case 'market': return d.market;
        case 'vendor_dba': return company;
        case 'vendor_owner': return String(v.owner || '');
        case 'vendor_email': return to;
        case 'vendor_no': return String(v.vendor_no || '');
        case 'coverage': return cov.label;
        case 'issuer_name': return String(d.issuer_name || '');
        case 'issuer_email': return String(d.issuer_email || '');
        case 'entry': return v.manual ? 'manual' : 'roster';
        case 'upload_link': return link;
        case 'form_attached': return formName;
        case 'email_status': return status;
        case 'notes': return String(v.notes || '');
        default: return '';
      }
    }));
  });

  if (rows.length) {
    var sh = ss.getSheetByName(INS_TABS.LOG);
    if (!sh) { insSetup_({}); sh = ss.getSheetByName(INS_TABS.LOG); }
    var start = _nextRow(sh);
    sh.getRange(start, 1, rows.length, INS_LOG_HEADERS.length).setValues(rows);
    var rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    sh.getRange(start, INS_LOG_HEADERS.indexOf('test') + 1, rows.length, 1)
      .setDataValidation(rule).setValue(test);
  }

  var sentCount = results.filter(function (r) { return r.ok; }).length;
  return _json({ ok: true, batch_id: batchId, test: test, market: d.market,
    sent: sentCount, failed: results.length - sentCount, results: results,
    quota_left: (function () { try { return MailApp.getRemainingDailyQuota(); } catch (e) { return -1; } })() });
}

// ------------------------------------------------------------ email -----
function insP_(txt) {
  return '<p style="margin:0 0 14px;font-family:Verdana,Arial,sans-serif;font-size:14px;' +
    'line-height:1.6;color:#2d2a26;">' + txt + '</p>';
}

function insEmail_(company, owner, mk, cov, link, test, formName, notice) {
  var testBanner = test ?
    '<tr><td style="background:#E5B423;padding:8px 30px;font-family:Verdana,Arial,sans-serif;' +
    'font-size:12px;font-weight:bold;color:#2d2a26;">TEST. Routed to the internal inbox. ' +
    'Not issued to a vendor.</td></tr>' : '';

  // Additional Insured wording appears only when General Liability is part of the
  // request. For a Workers' Compensation only request it is left out entirely.
  var agentPoints =
    '<li style="margin:0 0 8px;">The certificate holder box must read exactly as shown on the ' +
    'attached request form, letter for letter.</li>' +
    (cov.hasGL ?
      '<li style="margin:0 0 8px;">The Additional Insured mark must be present on the General ' +
      'Liability line.</li>' : '');

  return '' +
  '<table bgcolor="#f4f4f4" border="0" cellpadding="0" cellspacing="0" width="100%">' +
  '<tr><td align="center" style="padding:20px 0;">' +
  '<table bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;">' +
  testBanner +
  '<tr><td style="padding:24px 30px 0;">' +
  '<img src="' + INS_LOGO + '" height="38" alt="City Wide Facility Solutions" ' +
  'style="display:block;border:0;height:38px;width:auto;"></td></tr>' +

  '<tr><td style="padding:18px 30px 0;">' +
  '<div style="background:#D22730;color:#ffffff;font-family:Verdana,Arial,sans-serif;font-size:16px;' +
  'font-weight:bold;padding:12px 16px;letter-spacing:0.5px;">CERTIFICATE OF INSURANCE REQUEST</div>' +
  '</td></tr>' +

  '<tr><td style="padding:18px 30px 30px;">' +
  '<p style="margin:0 0 16px;font-family:Verdana,Arial,sans-serif;font-size:13px;color:#636466;">' +
  _esc(company) + (owner ? ', attn ' + _esc(owner) : '') + '</p>' +

  insP_('The certificate of insurance we have on file for ' + _esc(company) +
    ' has expired and we have not received an updated form.') +

  '<div style="border-left:4px solid #D22730;padding:10px 0 10px 14px;margin:0 0 22px;">' +
  '<p style="margin:0 0 4px;font-family:Verdana,Arial,sans-serif;font-size:12px;color:#636466;' +
  'text-transform:uppercase;letter-spacing:0.5px;">Coverage needed</p>' +
  '<p style="margin:0;font-family:Verdana,Arial,sans-serif;font-size:15px;font-weight:bold;' +
  'color:#2d2a26;">' + cov.label + '</p></div>' +

  (notice ?
    '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" ' +
    'style="margin:0 0 22px;"><tr><td bgcolor="' + INS_TEAL + '" align="center" ' +
    'style="background-color:' + INS_TEAL + ';padding:18px 22px;font-family:Verdana,Arial,sans-serif;' +
    'font-size:19px;line-height:1.45;font-weight:bold;color:#ffffff;text-align:center;">' +
    _esc(notice) + '</td></tr></table>' : '') +

  '<table border="0" cellpadding="0" cellspacing="0" style="margin:0 0 12px;"><tr>' +
  '<td bgcolor="#D22730" style="border-radius:6px;">' +
  '<a href="' + link + '" style="background:#D22730;color:#ffffff;font-family:Verdana,Arial,sans-serif;' +
  'font-size:17px;font-weight:bold;text-decoration:none;padding:18px 34px;display:inline-block;' +
  'border-radius:6px;">Submit a new certificate</a></td></tr></table>' +

  '<p style="margin:0 0 22px;font-family:Verdana,Arial,sans-serif;font-size:12px;line-height:1.5;' +
  'color:#636466;word-break:break-all;">Or paste this into your browser:<br>' +
  '<a href="' + link + '" style="color:#636466;">' + _esc(link) + '</a></p>' +

  '<p style="margin:0 0 8px;font-family:Verdana,Arial,sans-serif;font-size:14px;font-weight:bold;' +
  'color:#2d2a26;">Before your agent issues it</p>' +
  '<ul style="margin:0 0 14px 18px;padding:0;font-family:Verdana,Arial,sans-serif;font-size:14px;' +
  'line-height:1.6;color:#2d2a26;">' + agentPoints + '</ul>' +

  insP_('The attached request form has everything your agent needs. Hand it to them.') +
  insP_('Your agent or broker can send the certificate directly. The form tells them how.') +

  '<div style="border-top:2px solid #eeeeee;margin:22px 0 0;"></div>' +
  '<p style="margin:14px 0 0;font-family:Verdana,Arial,sans-serif;font-size:11px;line-height:1.6;' +
  'color:#999999;">' +
  _esc(mk.entity) + '<br>' + _esc(mk.addr1) + '<br>' + _esc(mk.addr2) + '<br>' +
  '<a href="mailto:' + mk.compliance + '" style="color:#999999;">' + mk.compliance + '</a>' +
  ' &middot; GoCityWide.com</p>' +
  '</td></tr></table></td></tr></table>';
}

// Real plain-text alternative. Carries the URL so the email survives image
// blocking, plain-text clients, and text-only previews.
function insPlain_(company, mk, cov, link, test, notice) {
  var lines = [];
  if (test) lines.push('TEST. Routed to the internal inbox. Not issued to a vendor.', '');
  lines.push('CERTIFICATE OF INSURANCE REQUEST', '');
  lines.push(company, '');
  lines.push('The certificate of insurance we have on file for ' + company +
    ' has expired and we have not received an updated form.', '');
  lines.push('Coverage needed: ' + cov.label, '');
  if (notice) {
    lines.push('***************************************************');
    lines.push(notice.toUpperCase());
    lines.push('***************************************************', '');
  }
  lines.push('Submit a new certificate here:', link, '');
  lines.push('Before your agent issues it:');
  lines.push('- The certificate holder box must read exactly as shown on the attached request form, letter for letter.');
  if (cov.hasGL) {
    lines.push('- The Additional Insured mark must be present on the General Liability line.');
  }
  lines.push('');
  lines.push('The attached request form has everything your agent needs. Hand it to them.');
  lines.push('Your agent or broker can send the certificate directly. The form tells them how.', '');
  lines.push(mk.entity);
  lines.push(mk.addr1);
  lines.push(mk.addr2);
  lines.push(mk.compliance + ' | GoCityWide.com');
  return lines.join('\n');
}

// ------------------------------------------------- editor Run helpers -----
function insSetupRun() {
  Logger.log(insSetup_({}).getContent());
}

function insQuotaRun() {
  Logger.log('MailApp remaining daily quota: ' + MailApp.getRemainingDailyQuota());
}
