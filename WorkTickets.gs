/**
 * CW Maintenance Work Tickets - v2
 * Standalone Apps Script. Owns its own Sheet + Drive photo folder (IDs in Script Properties).
 * POST kinds: work_order (kept for page compatibility). GET: ping.
 * v2 restructure: the form is no longer a customer work order REQUEST. It is a
 * completed-work submission (time and materials) from the in-house handyman or a
 * vendor crew, so the operations team can bill the customer.
 * Emails: HTML notification from citywideoflasvegas@gmail.com to both service lines,
 * reply-to the submitter. Photos and receipts saved to Drive named Property_Date_Submitter_N.
 */

var LV_EMAIL = 'lvservicecall@gocitywide.com';
var RN_EMAIL = 'rnservicecall@gocitywide.com';
var LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
var RED = '#D22730', BLACK = '#2D2A26', GREY = '#636466', LIGHT = '#F5F5F5', BORDER = '#E5E5E5';

// Column order matters: doPost writes by position. 'Billed?' is first so FSMs can
// check it without scrolling. Checked = row turns teal (conditional format from setup()).
var HEADERS = ['Billed?','Ticket #','Received','Submitted By','Company','Email','Phone',
  'Property','Address','Date of Work','Requested By','Task Type','Work Performed',
  'Start','End','Techs','Labor Hours',
  'Materials Purchased','Materials List','Materials Cost','Receipts','Receipt Links',
  'Work Status','Client Checked','Checked By','Client Feedback',
  'Photos','Photo Links','Billing Notes','Status','Notes'];

function setup() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty('SHEET_ID');
  var ss;
  if (!ssId) {
    ss = SpreadsheetApp.create('CW Maintenance Work Tickets');
    props.setProperty('SHEET_ID', ss.getId());
  } else {
    ss = SpreadsheetApp.openById(ssId);
  }
  ss.rename('CW Maintenance Work Tickets');
  var sh = ss.getSheets()[0];
  if (sh.getName() !== 'Work Tickets') sh.setName('Work Tickets');
  if (sh.getMaxColumns() < HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), HEADERS.length - sh.getMaxColumns());
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground(RED)
    .setVerticalAlignment('middle').setWrap(false);
  sh.setRowHeight(1, 34);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(2);
  // Billed checkbox column for all data rows
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 1).insertCheckboxes();
  // Teal row when Billed is checked
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$A2=TRUE')
    .setBackground('#CCEBEC')
    .setRanges([sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), HEADERS.length)])
    .build();
  sh.setConditionalFormatRules([rule]);
  // Readable widths + wrapping on the long text columns
  var widths = {1:60, 2:150, 3:150, 4:140, 5:120, 6:180, 7:120, 8:180, 9:220, 10:110,
    11:140, 12:180, 13:320, 14:70, 15:70, 16:60, 17:90, 18:90, 19:220, 20:100,
    21:90, 22:180, 23:150, 24:100, 25:130, 26:130, 27:70, 28:180, 29:220, 30:90, 31:150};
  for (var c in widths) sh.setColumnWidth(Number(c), widths[c]);
  [13, 19, 29].forEach(function (c) {
    sh.getRange(2, c, Math.max(sh.getMaxRows() - 1, 1), 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  });
  [22, 28].forEach(function (c) {
    sh.getRange(2, c, Math.max(sh.getMaxRows() - 1, 1), 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  });
  var folderId = props.getProperty('FOLDER_ID');
  if (!folderId) {
    var folder = DriveApp.createFolder('CW Work Ticket Photos');
    props.setProperty('FOLDER_ID', folder.getId());
  }
  return 'setup ok: sheet=' + ss.getUrl();
}

function doGet(e) {
  // Oct 18 2026: ?backfill=1 builds the PDF for every ticket that has none (idempotent; call until left is 0)
  if (e && e.parameter && e.parameter.backfill) {
    var r; try { r = wtBackfillPdfs(); } catch (err) { r = { ok: false, error: String(err && err.message ? err.message : err) }; }
    return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'cw-work-orders' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var out = { ok: false };
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.website) { // honeypot: pretend success
      return jsonOut({ ok: true, wo_id: 'WT-RECEIVED' });
    }
    if (data.kind === 'snow_report') return jsonOut(handleSnowReport(data));
    if (data.kind === 'wo_lookup') return jsonOut(handleLookup(data));   // property picker (Lookup.gs)
    if (data.kind !== 'work_order') throw new Error('Unknown kind');
    out = handleWorkOrder(data);
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return jsonOut(out);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function clean(s, max) {
  s = String(s == null ? '' : s).trim();
  if (max && s.length > max) s = s.slice(0, max);
  return s;
}

function slug(s) {
  return String(s || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'Unknown';
}

function handleWorkOrder(d) {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  var sh = ss.getSheetByName('Work Tickets') || ss.getSheets()[0];

  var tz = 'America/Los_Angeles';
  var now = new Date();
  var dateStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var stamp = Utilities.formatDate(now, tz, 'yyyyMMdd-HHmmss');
  var woId = 'WT-' + stamp;

  function prettyDate(s) { // 2026-08-07 -> Aug 7, 2026 (no cryptic dates for the FSMs)
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return s;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1];
  }
  function prettyTime(s) { // 14:30 -> 2:30 PM
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
    if (!m) return s;
    var h = Number(m[1]), ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + ':' + m[2] + ' ' + ap;
  }

  var t = {
    woId: woId,
    name: clean(d.name, 80),
    company: clean(d.company, 120),
    email: clean(d.email, 120),
    phone: clean(d.phone, 40),
    property: clean(d.property_name, 200),
    address: clean(d.address, 300),
    dateOfWork: prettyDate(clean(d.date_of_work, 40)),
    requestedBy: clean(d.requested_by, 120),
    task: clean(d.task_type, 120),
    desc: clean(d.description, 4000),
    startTime: prettyTime(clean(d.start_time, 20)),
    endTime: prettyTime(clean(d.end_time, 20)),
    techs: clean(d.techs, 10),
    hours: clean(d.labor_hours, 20),
    matPurchased: clean(d.materials_purchased, 10),
    matDesc: clean(d.materials_desc, 2000),
    matCost: clean(d.materials_cost, 40),
    workStatus: clean(d.work_status, 60),
    clientChecked: clean(d.client_checked, 10),
    checkedBy: clean(d.checked_by, 120),
    feedback: clean(d.client_feedback, 120),
    billing: clean(d.billing_notes, 500)
  };

  if (!t.name) throw new Error('Name is required');
  if (!t.email || t.email.indexOf('@') < 1) throw new Error('A valid email is required');
  if (!t.property) throw new Error('Property name is required');
  if (!t.address) throw new Error('Property address is required');
  if (!t.desc) throw new Error('Describe the work performed');
  if (!t.hours) throw new Error('Total labor hours is required');

  // ---- Photos + receipts -> Drive folder, named Property_Job_Date_Tech_N ----
  var folder = null;
  function saveImages(list, tag, cap) {
    var links = [];
    list = (list && list.length) ? list.slice(0, cap) : [];
    if (!list.length) return links;
    if (!folder) folder = DriveApp.getFolderById(props.getProperty('FOLDER_ID'));
    var base = slug(t.property) + '_' + slug(t.task || 'Job') + '_' + dateStr + '_' + slug(t.name) + (tag ? '_' + tag : '');
    for (var i = 0; i < list.length; i++) {
      try {
        var p = list[i];
        var mime = p.type || 'image/jpeg';
        var ext = mime.indexOf('png') >= 0 ? '.png' : '.jpg';
        var bytes = Utilities.base64Decode(String(p.data || '').replace(/^data:[^,]+,/, ''));
        var blob = Utilities.newBlob(bytes, mime, base + '_' + (i + 1) + ext);
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        links.push(file.getUrl());
      } catch (perr) {
        links.push('SAVE FAILED: ' + perr);
      }
    }
    return links;
  }
  var photoLinks = saveImages(d.photos, '', 10);
  var receiptLinks = saveImages(d.receipts, 'receipt', 6);

  // ---- Sheet row: newest tickets on TOP (insert under the header) ----
  var row = [false, woId, Utilities.formatDate(now, tz, 'MMM d, yyyy h:mm a'), t.name, t.company, t.email, t.phone,
    t.property, t.address, t.dateOfWork, t.requestedBy, t.task, t.desc,
    t.startTime, t.endTime, t.techs, t.hours,
    t.matPurchased, t.matDesc, t.matCost, receiptLinks.length, receiptLinks.join('\n'),
    t.workStatus, t.clientChecked, t.checkedBy, t.feedback,
    photoLinks.length, photoLinks.join('\n'), t.billing, 'New', ''];
  sh.insertRowAfter(1);
  var newRange = sh.getRange(2, 1, 1, row.length);
  newRange.clearFormat(); // do not inherit the red header formatting
  newRange.setValues([row]);
  [13, 19, 29].forEach(function (c) { sh.getRange(2, c).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); });
  [22, 28].forEach(function (c) { sh.getRange(2, c).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP); });
  sh.getRange(2, 1).insertCheckboxes();
  // Oct 15 2026: owner (FSM) and account from the customer directory, for the billing queue (Lookup.gs)
  try { wtStamp_(sh, { group: clean(d.property_group, 40), property: t.property, address: t.address }); } catch (serr) { sh.getRange(2, HEADERS.length).setValue('OWNER STAMP FAILED: ' + serr); }
  // Re-anchor the teal Billed rule: inserting a row at the top pushes the old
  // rule range down, which would leave every new row 2 uncovered.
  var tealRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$A2=TRUE')
    .setBackground('#CCEBEC')
    .setRanges([sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), HEADERS.length)])
    .build();
  sh.setConditionalFormatRules([tealRule]);

  // ---- PDF (Oct 18 2026): the full ticket with receipts and photos embedded ----
  var pdfUrl = '';
  try {
    t.received = Utilities.formatDate(now, tz, 'MMM d, yyyy h:mm a');
    pdfUrl = wtMakePdf_(t, wtImgData_((d.photos || []).slice(0, 10)), wtImgData_((d.receipts || []).slice(0, 6)), folder);
    var pcol = wtPdfCol_(sh);
    if (pdfUrl) sh.getRange(2, pcol).setValue(pdfUrl);
  } catch (perr2) {
    sh.getRange(2, HEADERS.length).setValue('PDF FAILED: ' + perr2);
  }

  // ---- Email ----
  try {
    sendWtEmail(t, photoLinks, receiptLinks, pdfUrl);
  } catch (merr) {
    // Row is saved even if mail fails; log to notes column
    sh.getRange(2, HEADERS.length).setValue('EMAIL FAILED: ' + merr);
  }

  return { ok: true, wo_id: woId, photos: photoLinks.length + receiptLinks.length };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fld(label, value) {
  if (!value) return '';
  return '<tr><td style="padding:7px 14px;font-size:11px;color:' + GREY + ';text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;vertical-align:top;border-bottom:1px solid ' + LIGHT + '">' + label +
    '</td><td style="padding:7px 14px;font-size:14px;color:' + BLACK + ';border-bottom:1px solid ' + LIGHT + '">' + esc(value).replace(/\n/g, '<br>') + '</td></tr>';
}

function linksRow(label, links) {
  if (!links.length) return '';
  return '<tr><td style="padding:7px 14px;font-size:11px;color:' + GREY + ';text-transform:uppercase;letter-spacing:.06em;vertical-align:top;border-bottom:1px solid ' + LIGHT + '">' + label + '</td><td style="padding:7px 14px;border-bottom:1px solid ' + LIGHT + '">' +
    links.map(function (u, i) {
      return '<a href="' + u + '" style="display:inline-block;font-size:13px;font-weight:bold;color:' + RED + ';margin-right:12px">' + label + ' ' + (i + 1) + '</a>';
    }).join('') + '</td></tr>';
}

function sendWtEmail(t, photoLinks, receiptLinks, pdfUrl) {
  var needsReturn = /return|reschedule|not complete|could not/i.test(t.workStatus);
  var subject = 'Work Ticket ' + t.woId + ' | ' + t.property +
    (t.hours ? ' | ' + t.hours + ' hrs' : '') +
    (needsReturn ? ' | RETURN TRIP NEEDED' : '');

  var banner = needsReturn
    ? '<div style="background:' + RED + ';color:#ffffff;font-weight:bold;font-size:14px;padding:10px 22px;letter-spacing:.04em">RETURN TRIP NEEDED - WORK NOT FINISHED</div>'
    : '';

  var timeLine = (t.startTime && t.endTime) ? (t.startTime + ' to ' + t.endTime) : (t.startTime || t.endTime || '');
  var materialsLine = t.matPurchased === 'Yes'
    ? ('Yes' + (t.matCost ? ' | Total cost: $' + t.matCost : '') + (t.matDesc ? '\n' + t.matDesc : ''))
    : (t.matPurchased || '');
  var checkedLine = t.clientChecked === 'Yes'
    ? ('Yes' + (t.checkedBy ? ' | Checked by: ' + t.checkedBy : '') + (t.feedback ? ' | ' + t.feedback : ''))
    : (t.clientChecked ? 'No, the on-site client did not check the work' : '');

  var html =
    '<div style="margin:0;padding:24px;background:' + LIGHT + ';font-family:Verdana,Geneva,sans-serif">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid ' + BORDER + ';border-top:5px solid ' + RED + ';border-radius:10px;overflow:hidden;width:100%">' +
    '<tr><td style="padding:20px 22px 14px"><img src="' + LOGO + '" alt="City Wide Facility Solutions" height="38" style="height:38px;width:auto;display:block"></td></tr>' +
    (banner ? '<tr><td>' + banner + '</td></tr>' : '') +
    '<tr><td style="padding:6px 22px 2px"><div style="font-size:19px;font-weight:bold;color:' + BLACK + '">Maintenance Work Ticket</div>' +
    '<div style="font-size:12px;color:' + GREY + ';margin-top:2px">' + t.woId + ' &bull; Submitted ' + Utilities.formatDate(new Date(), 'America/Los_Angeles', 'EEEE, MMMM d, yyyy h:mm a') + ' PT</div></td></tr>' +
    '<tr><td style="padding:14px 22px 4px"><div style="font-size:11px;font-weight:bold;color:' + RED + ';text-transform:uppercase;letter-spacing:.08em">Billing summary</div></td></tr>' +
    '<tr><td style="padding:6px 22px 10px"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid ' + BORDER + ';border-radius:8px">' +
    fld('Property', t.property) +
    fld('Address', t.address) +
    fld('Date of Work', t.dateOfWork) +
    fld('Time On Site', timeLine) +
    fld('Technicians', t.techs) +
    fld('Total Labor Hours', t.hours) +
    fld('Materials', materialsLine) +
    linksRow('Receipt', receiptLinks) +
    (pdfUrl ? linksRow('Full ticket PDF', [pdfUrl]) : '') +
    fld('Billing Notes', t.billing) +
    '</table></td></tr>' +
    '<tr><td style="padding:8px 22px 4px"><div style="font-size:11px;font-weight:bold;color:' + RED + ';text-transform:uppercase;letter-spacing:.08em">Work details</div></td></tr>' +
    '<tr><td style="padding:6px 22px 22px"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid ' + BORDER + ';border-radius:8px">' +
    fld('Submitted By', t.name) +
    fld('Company', t.company) +
    fld('Email', t.email) +
    fld('Phone', t.phone) +
    fld('Requested By', t.requestedBy) +
    fld('Task Type', t.task) +
    fld('Work Performed', t.desc) +
    fld('Work Status', t.workStatus) +
    fld('Client Check', checkedLine) +
    linksRow('Photo', photoLinks) +
    '</table></td></tr>' +
    '<tr><td style="padding:0 22px 24px;font-size:11px;color:' + GREY + '">Logged automatically to the CW Maintenance Work Tickets sheet. Reply to this email to reach the submitter directly. <span style="font-style:italic;font-weight:bold">GoCityWide.com</span></td></tr>' +
    '</table></div>';

  // Sep 5 2026: routed through the shared digest config. A finished ticket rolls
  // into the 8am / 4pm digest; a ticket that needs a return trip sends now.
  cwRemoteMail_(needsReturn ? 'work_ticket_return' : 'work_ticket', {
    to: LV_EMAIL + ',' + RN_EMAIL,
    replyTo: t.email || LV_EMAIL,
    subject: subject,
    htmlBody: html,
    body: 'Work Ticket ' + t.woId + ' - ' + t.property + ' - ' + t.hours + ' hrs - ' + t.desc,
    digest: { title: t.property + (needsReturn ? ' - RETURN TRIP NEEDED' : ''), id: t.woId, fields: [
      ['Ticket', t.woId], ['Submitted by', t.name + (t.company ? ' (' + t.company + ')' : '') + (t.email ? ' <' + t.email + '>' : '')],
      ['Date of work', t.dateOfWork], ['Task', t.task], ['Work performed', t.desc.slice(0, 300)],
      ['Labor', (t.hours ? t.hours + ' hrs' : '') + (t.techs ? ', ' + t.techs + ' tech(s)' : '') + (timeLine ? ', ' + timeLine : '')],
      ['Materials', materialsLine.replace(/\n/g, ' ')], ['Work status', t.workStatus], ['Client check', checkedLine],
      ['Photos / receipts', (photoLinks.length + receiptLinks.length) ? (photoLinks.length + receiptLinks.length) + ' file(s) in Drive' : ''] ],
      links: [['Work Tickets sheet', SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getUrl()]].concat(pdfUrl ? [['Full ticket PDF', pdfUrl]] : []).concat(photoLinks.slice(0, 3).map(function (u, i) { return ['Photo ' + (i + 1), u]; })) }
  });
}

// ============================================================================
// Oct 18 2026: one PDF per work ticket. Built on submit from the same photo data the
// Drive files are saved from, stored in the photo folder as
// "Work Ticket <id> - <property>.pdf", link written to the PDF Link column.
// The alerts card and the billing queue open it with "View full ticket PDF".
// wtBackfillPdfs() builds the PDF for every older row that has none (GET ?backfill=1).
// ============================================================================
var WT_PDF_COL = 'PDF Link';

function wtHeadCols_(sh) {
  var lastC = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, lastC).getValues()[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  var col = {};
  head.forEach(function (h, i) { if (h && col[h] === undefined) col[h] = i + 1; });
  return { head: head, col: col };
}
// Appends the PDF Link header once and returns its 1-based column.
function wtPdfCol_(sh) {
  var hc = wtHeadCols_(sh);
  if (hc.col[WT_PDF_COL]) return hc.col[WT_PDF_COL];
  var n = hc.head.length + 1;
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  sh.getRange(1, n).setValue(WT_PDF_COL).setFontWeight('bold').setFontColor('#FFFFFF').setBackground(RED).setVerticalAlignment('middle').setWrap(false);
  sh.setColumnWidth(n, 180);
  return n;
}
function wtDriveId_(url) {
  var m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(String(url || '')) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(String(url || ''));
  return m ? m[1] : '';
}
// Image blobs for the PDF: from the submitted data URIs (on submit) or Drive links (backfill).
function wtImgData_(list, links) {
  var out = [];
  (list || []).forEach(function (p) {
    var data = String(p && p.data || '');
    if (!data) return;
    var mime = (p.type || 'image/jpeg');
    out.push('data:' + mime + ';base64,' + data.replace(/^data:[^,]+,/, ''));
  });
  if (out.length) return out;
  (links || []).forEach(function (u) {
    var id = wtDriveId_(u);
    if (!id) return;
    try {
      var b = DriveApp.getFileById(id).getBlob();
      out.push('data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes()));
    } catch (e) {}
  });
  return out;
}
function wtLogoData_() {
  try {
    var b = UrlFetchApp.fetch(LOGO, { muteHttpExceptions: true }).getBlob();
    if (b.getBytes().length > 100) return 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes());
  } catch (e) {}
  return '';
}
function wtPdfHtml_(t, photos, receipts) {
  var logo = wtLogoData_();
  var yes = /^yes$/i.test(t.matPurchased);
  var no = /^no$/i.test(t.matPurchased);
  var cost = String(t.matCost || '').replace(/^\$/, '');
  var costTxt = cost ? '$' + cost : 'cost not given';
  function row(label, value) {
    if (!value) return '';
    return '<tr><td class="l">' + esc(label) + '</td><td class="v">' + esc(value).replace(/\n/g, '<br>') + '</td></tr>';
  }
  var timeLine = (t.startTime && t.endTime) ? (t.startTime + ' to ' + t.endTime) : (t.startTime || t.endTime || '');
  var checkedLine = /^yes$/i.test(t.clientChecked) ? ('Yes' + (t.checkedBy ? ', checked by ' + t.checkedBy : '') + (t.feedback ? '. ' + t.feedback : ''))
    : (t.clientChecked ? 'No, the on-site client did not check the work' : '');
  var supBox;
  if (yes) {
    supBox = '<div class="sup yes"><div class="big">SUPPLIES BOUGHT: YES, ' + esc(costTxt) + '</div>' +
      (t.matDesc ? '<div class="sm">' + esc(t.matDesc) + '</div>' : '') +
      '<div class="sm">' + (receipts.length ? receipts.length + (receipts.length === 1 ? ' receipt' : ' receipts') + ' attached below.' : '<b>NO RECEIPT ATTACHED.</b> Get the receipt from the submitter before billing the materials.') + '</div></div>';
  } else if (no) {
    supBox = '<div class="sup no"><div class="big">SUPPLIES BOUGHT: NO</div><div class="sm">Labor only. Nothing to bill for materials.</div></div>';
  } else {
    supBox = '<div class="sup unk"><div class="big">SUPPLIES BOUGHT: NOT ANSWERED</div><div class="sm">This ticket was submitted before the question was required. Check with the submitter.</div></div>';
  }
  var needsReturn = /return|reschedule|not complete|could not/i.test(t.workStatus);
  var imgs = function (list, title, perRow) {
    if (!list.length) return '';
    var w = perRow === 1 ? '100%' : '48%';
    return '<div class="sec">' + esc(title) + '</div><div class="grid">' + list.map(function (src, i) {
      return '<div class="ph" style="width:' + w + '"><img src="' + src + '"><div class="cap">' + esc(title) + ' ' + (i + 1) + '</div></div>';
    }).join('') + '</div>';
  };
  return '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '@page{size:letter;margin:0.5in}' +
    'body{font-family:Verdana,Geneva,sans-serif;color:' + BLACK + ';font-size:11pt;margin:0}' +
    '.top{border-top:5px solid ' + RED + ';padding:14px 0 6px;display:flex;justify-content:space-between;align-items:flex-start}' +
    '.top img{height:34px}' +
    'h1{font-size:18pt;margin:10px 0 2px}' +
    '.meta{font-size:9.5pt;color:' + GREY + ';margin-bottom:10px}' +
    '.ret{background:' + RED + ';color:#fff;font-weight:bold;padding:8px 12px;margin:8px 0;font-size:11pt}' +
    '.sup{border:2px solid;padding:12px 14px;margin:10px 0 14px;page-break-inside:avoid}' +
    '.sup .big{font-size:14pt;font-weight:bold;letter-spacing:.02em}' +
    '.sup .sm{font-size:10pt;margin-top:4px}' +
    '.sup.yes{border-color:' + RED + ';background:#FFF1F1;color:#B01F27}' +
    '.sup.no{border-color:' + BORDER + ';background:' + LIGHT + ';color:' + BLACK + '}' +
    '.sup.unk{border-color:#C8961E;background:#FFF8E6;color:#7A5A00}' +
    '.sec{font-size:9pt;font-weight:bold;color:' + RED + ';text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px;border-bottom:2px solid ' + RED + ';padding-bottom:3px}' +
    'table{width:100%;border-collapse:collapse;border:1px solid ' + BORDER + '}' +
    'td{padding:6px 10px;border-bottom:1px solid ' + LIGHT + ';vertical-align:top;font-size:10.5pt}' +
    'td.l{width:150px;font-size:8.5pt;color:' + GREY + ';text-transform:uppercase;letter-spacing:.05em;background:#FAFAFA}' +
    '.grid{display:flex;flex-wrap:wrap;gap:2%}' +
    '.ph{margin-bottom:10px;page-break-inside:avoid}' +
    '.ph img{width:100%;height:auto;border:1px solid ' + BORDER + ';display:block}' +
    '.cap{font-size:8.5pt;color:' + GREY + ';margin-top:2px}' +
    '.foot{font-size:8.5pt;color:' + GREY + ';margin-top:16px;border-top:1px solid ' + BORDER + ';padding-top:6px}' +
    '</style></head><body>' +
    '<div class="top">' + (logo ? '<img src="' + logo + '" alt="City Wide Facility Solutions">' : '') + '<div style="text-align:right;font-size:9pt;color:' + GREY + '">Maintenance Work Ticket<br><b style="color:' + BLACK + ';font-size:11pt">' + esc(t.woId) + '</b></div></div>' +
    '<h1>' + esc(t.property) + '</h1>' +
    '<div class="meta">' + esc(t.address) + (t.received ? ' &bull; Received ' + esc(t.received) : '') + (t.account ? ' &bull; Account: ' + esc(t.account) : '') + '</div>' +
    (needsReturn ? '<div class="ret">RETURN TRIP NEEDED. WORK NOT FINISHED.</div>' : '') +
    supBox +
    '<div class="sec">Billing summary</div><table>' +
    row('Date of work', t.dateOfWork) + row('Time on site', timeLine) + row('Technicians', t.techs) + row('Total labor hours', t.hours) +
    row('Supplies bought', yes ? 'Yes, ' + costTxt : (no ? 'No' : 'Not answered')) + row('Supplies list', yes ? t.matDesc : '') +
    row('Billing notes', t.billing) + '</table>' +
    '<div class="sec">Work details</div><table>' +
    row('Submitted by', t.name + (t.company ? ', ' + t.company : '')) + row('Email', t.email) + row('Phone', t.phone) +
    row('Requested by', t.requestedBy) + row('Task type', t.task) + row('Work performed', t.desc) + row('Work status', t.workStatus) + row('Client check', checkedLine) + '</table>' +
    imgs(receipts, 'Receipt', 1) +
    imgs(photos, 'Work photo', 2) +
    '<div class="foot">City Wide Facility Solutions. Logged to the CW Maintenance Work Tickets sheet. GoCityWide.com</div>' +
    '</body></html>';
}
// Builds the PDF, saves it in the photo folder, returns the share link ('' on failure).
function wtMakePdf_(t, photos, receipts, folder) {
  try {
    var html = wtPdfHtml_(t, photos, receipts);
    var name = 'Work Ticket ' + t.woId + ' - ' + slug(t.property).replace(/-/g, ' ') + '.pdf';
    var pdf = Utilities.newBlob(html, 'text/html', name.replace(/\.pdf$/, '.html')).getAs('application/pdf').setName(name);
    if (!folder) folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('FOLDER_ID'));
    var file = folder.createFile(pdf);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (e) {
    return '';
  }
}
// Every row with a Ticket # and no PDF link gets one. Stops short of the 6 minute limit and
// reports how many are left, so it can be called again until done is 0.
function wtBackfillPdfs() {
  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  var sh = ss.getSheetByName('Work Tickets') || ss.getSheets()[0];
  var pdfCol = wtPdfCol_(sh);
  var hc = wtHeadCols_(sh);
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, built: 0, left: 0 };
  var vals = sh.getRange(2, 1, last - 1, hc.head.length).getValues();
  var folder = DriveApp.getFolderById(props.getProperty('FOLDER_ID'));
  var built = 0, left = 0, failed = [];
  function g(r, h) { var c = hc.col[h]; return c ? r[c - 1] : ''; }
  function s(v) { return String(v == null ? '' : v).trim(); }
  function fmt(v, p) { return (v instanceof Date) ? Utilities.formatDate(v, 'America/Los_Angeles', p) : s(v); }
  function links(v) { return s(v).split(/\n+/).map(function (x) { return x.trim(); }).filter(function (x) { return /^https?:\/\//.test(x); }); }
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (!s(g(r, 'Ticket #')) || s(g(r, WT_PDF_COL))) continue;
    if (Date.now() - started > 270000) { left++; continue; }
    var t = {
      woId: s(g(r, 'Ticket #')), received: fmt(g(r, 'Received'), 'MMM d, yyyy h:mm a'),
      name: s(g(r, 'Submitted By')), company: s(g(r, 'Company')), email: s(g(r, 'Email')), phone: s(g(r, 'Phone')),
      property: s(g(r, 'Property')), address: s(g(r, 'Address')), account: s(g(r, 'Account')),
      dateOfWork: fmt(g(r, 'Date of Work'), 'MMM d, yyyy'), requestedBy: s(g(r, 'Requested By')), task: s(g(r, 'Task Type')), desc: s(g(r, 'Work Performed')),
      startTime: fmt(g(r, 'Start'), 'h:mm a'), endTime: fmt(g(r, 'End'), 'h:mm a'), techs: s(g(r, 'Techs')), hours: s(g(r, 'Labor Hours')),
      matPurchased: s(g(r, 'Materials Purchased')), matDesc: s(g(r, 'Materials List')), matCost: s(g(r, 'Materials Cost')),
      workStatus: s(g(r, 'Work Status')), clientChecked: s(g(r, 'Client Checked')), checkedBy: s(g(r, 'Checked By')), feedback: s(g(r, 'Client Feedback')),
      billing: s(g(r, 'Billing Notes'))
    };
    var url = wtMakePdf_(t, wtImgData_(null, links(g(r, 'Photo Links'))), wtImgData_(null, links(g(r, 'Receipt Links'))), folder);
    if (url) { sh.getRange(i + 2, pdfCol).setValue(url); built++; }
    else failed.push(t.woId);
  }
  return { ok: true, built: built, left: left, failed: failed };
}
