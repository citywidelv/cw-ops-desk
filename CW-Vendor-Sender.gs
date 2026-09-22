// CW Vendor Sender. Sep 17 2026.
//
// Standalone web app owned by the company Workspace mailbox (cwfs-nv.com). It
// does one job: send and schedule vendor email for the Ops Hub, so vendor mail
// stops spending the old Gmail's 100 a day that violation and insurance
// notices also need. Same kinds as VendorMessages.gs in CW Solicitations:
// vm_quota, vm_send, vm_queue, vm_queue_status, vm_queue_cancel.
//
// No passcode is stored here. A passcode is checked by asking the main CW
// Solicitations script (kind "auth") and the answer is cached for 10 minutes.
// The queue and the send log live in this script's own Sheet, made on first use.
//
// Do not email list: the list lives in the main script (DoNotEmail.gs). This
// script asks the main script for it (kind "dne_list") when a send is scheduled
// and again right before every email. If the list cannot be read, nothing sends.
// The timer has no page behind it, so the last good passcode is kept in this
// script's own properties (VS_PASS) for that one call. It is never logged.
//
// Rule from TJ: vendors are ALWAYS blind copied. They must never see each other.

var VS_MAIN = 'https://script.google.com/macros/s/AKfycbzfNnrpidCbWB1DeUNgXvRhDFMQgApfpn-3C9GU45wMEHcJpWFl8ZQVo6PUBSRfEVfRdg/exec';
var INS_LOGO = 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
var INS_MARKETS = {
  'Las Vegas':       { label: 'City Wide Facility Solutions of Las Vegas',       addr1: '3215 W Charleston Blvd, Suite 130', addr2: 'Las Vegas, NV 89102' },
  'Northern Nevada': { label: 'City Wide Facility Solutions of Northern Nevada', addr1: '1000 Bible Way, Suite 2',           addr2: 'Reno, NV 89502' }
};

// Run once from the editor. Grants the permissions and shows what this mailbox can send a day.
function vsSetup() {
  var left = MailApp.getRemainingDailyQuota();
  var ss = vsBook_();
  Logger.log('Daily sends left on this mailbox: ' + left);
  Logger.log('Log and queue sheet: ' + ss.getUrl());
  return left;
}

function _json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  var d = {};
  try { d = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return _json({ ok: false, error: 'Bad request.' }); }
  if (String(d.kind || '').indexOf('vm_') !== 0) return _json({ ok: false, error: 'Unknown kind ' + String(d.kind || '') });
  try { return vmDispatch(d); } catch (err2) { return _json({ ok: false, error: 'Sender error: ' + String(err2 && err2.message || err2) }); }
}
function doGet() { return _json({ ok: true, service: 'CW Vendor Sender' }); }

function vsPassOk_(pass) {
  pass = String(pass || '');
  if (!pass) return false;
  var key = 'p:' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pass));
  var cache = CacheService.getScriptCache();
  if (cache.get(key) === '1') return true;
  try {
    var r = UrlFetchApp.fetch(VS_MAIN, { method: 'post', contentType: 'text/plain', payload: JSON.stringify({ kind: 'auth', passcode: pass }),
      followRedirects: true, muteHttpExceptions: true });
    var j = JSON.parse(r.getContentText());
    if (j && j.ok === true) { cache.put(key, '1', 600); return true; }
  } catch (e) {}
  return false;
}

function vsRememberPass_(pass) {
  VS_CUR_PASS = String(pass || '');
  try { var p = PropertiesService.getScriptProperties(); if (p.getProperty('VS_PASS') !== VS_CUR_PASS) p.setProperty('VS_PASS', VS_CUR_PASS); } catch (e) {}
}
var VS_CUR_PASS = '';

// Same wording as DNE_FOOTER in DoNotEmail.gs (approved by TJ Sep 17 2026). Keep the two in step.
var DNE_FOOTER = 'To stop these emails, reply and ask to be taken off our lists. ' +
  'You will stop hearing about new work. Notices about buildings you hold will still come to this address. ' +
  'A vendor we cannot reach by email cannot stay active with City Wide.';

// Throws if the list cannot be read. Callers treat a throw as "do not send".
function dneFilter_(emails) {
  var pass = VS_CUR_PASS || PropertiesService.getScriptProperties().getProperty('VS_PASS') || '';
  if (!pass) throw new Error('No passcode on file yet.');
  // Sep 22 2026: the blocked list is cached for 5 minutes. Every send used to make a
  // round trip to the main script for the whole directory, and that hop is what made
  // a send take one to four minutes. A vendor added to the list is blocked within 5 min.
  var cache = null, blockedList = null;
  try { cache = CacheService.getScriptCache(); var hit = cache.get('dne_blocked_v1'); if (hit) blockedList = JSON.parse(hit); } catch (e) { blockedList = null; }
  if (!blockedList) {
    // The main script is sometimes busy for a moment. Try three times before giving up.
    var j = null, lastErr = '';
    for (var attempt = 0; attempt < 3 && !(j && j.ok === true && j.blocked); attempt++) {
      if (attempt) Utilities.sleep(2000);
      try {
        var r = UrlFetchApp.fetch(VS_MAIN, { method: 'post', contentType: 'text/plain', payload: JSON.stringify({ kind: 'dne_list', passcode: pass }),
          followRedirects: true, muteHttpExceptions: true });
        j = JSON.parse(r.getContentText());
        if (!(j && j.ok === true && j.blocked)) lastErr = (j && j.error) || 'The main script did not answer.';
      } catch (e) { j = null; lastErr = String(e && e.message || e); }
    }
    if (!(j && j.ok === true && j.blocked)) throw new Error(lastErr || 'The main script did not answer.');
    blockedList = j.blocked.map(function (b) { return String(b && b.email || '').trim().toLowerCase(); }).filter(function (e) { return e; });
    try { if (cache) cache.put('dne_blocked_v1', JSON.stringify(blockedList), 300); } catch (e) {}
  }
  var set = {};
  blockedList.forEach(function (e) { set[e] = true; });
  var ok = [], blocked = [];
  (emails || []).forEach(function (e) {
    var s = String(e || '').trim().toLowerCase();
    if (!s) return;
    if (set[s] === true) blocked.push(s); else ok.push(s);
  });
  return { ok: ok, blocked: blocked };
}

function vsBook_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('VS_SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  var ss = SpreadsheetApp.create('CW Vendor Sender Log');
  props.setProperty('VS_SHEET_ID', ss.getId());
  return ss;
}

// VendorMessages.gs. Sep 11 2026.
//
// Vendor messages sent from the Ops Hub (vendor-messages.html): uniforms and
// supplies reminders, audit scheduling, invoice reminders, custom notes, and
// so on. The page picks the vendors from the Vendor Directory (vd_list) and the
// wording; this side sends from the platform Gmail with the chosen display
// name, every vendor on BCC, and logs a row per batch on the Vendor Messages
// tab of the CW Solicitations book.
//
// Rule from TJ: vendors are ALWAYS blind copied. They must never see each other.
// The To line is the office mailbox the replies go to, never a vendor.
//
// POST {kind:'vm_quota', passcode}                        -> {ok, quota_left, senders, reply_to}
// POST {kind:'vm_send',  passcode, sender:'lv'|'nnv'|'both', reply_to, template,
//       subject, body, to:[emails], by, test, test_to}   -> {ok, batch_id, sent, chunks, quota_left, skipped:[..]}
//
// The shared consumer Gmail quota is about 100 recipients a day across every
// email these scripts send, so a batch is capped and the quota is checked
// before anything goes out. Big blasts belong on the Outlook path, which the
// page offers without touching this script.

var VM_LOG_TAB = 'Vendor Messages';
var VM_LOG_HEAD = ['sent', 'test', 'batch_id', 'sent_by', 'sender_name', 'reply_to', 'template',
  'subject', 'recipients', 'recipient_list', 'status', 'error'];
var VM_BATCH_MAX = 50;      // recipients per send request
var VM_CHUNK = 20;          // BCC addresses per message
var VM_SENDERS = {
  lv:   { name: 'City Wide of Las Vegas',       reply: 'lvservicecall@gocitywide.com', markets: ['Las Vegas'] },
  nnv:  { name: 'City Wide of Northern Nevada', reply: 'rnservicecall@gocitywide.com', markets: ['Northern Nevada'] },
  both: { name: 'City Wide Nevada',             reply: 'lvservicecall@gocitywide.com', markets: ['Las Vegas', 'Northern Nevada'] }
};

function vmDispatch(d) {
  if (!vsPassOk_(d.passcode)) return _json({ ok: false, error: 'Wrong passcode.' });
  vsRememberPass_(d.passcode);
  var kind = String(d.kind || '');
  if (kind === 'vm_quota') return vmQuota_(d);
  if (kind === 'vm_send') return vmSend_(d);
  if (kind === 'vm_queue') return vmQueue_(d);
  if (kind === 'vm_queue_status') return vmQueueStatus_(d);
  if (kind === 'vm_queue_cancel') return vmQueueCancel_(d);
  return _json({ ok: false, error: 'Unknown kind ' + kind });
}

function vmQuotaLeft_() { try { return MailApp.getRemainingDailyQuota(); } catch (e) { return -1; } }
function vmEmailOk_(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim()); }

function vmQuota_(d) {
  var senders = {};
  Object.keys(VM_SENDERS).forEach(function (k) { senders[k] = { name: VM_SENDERS[k].name, reply: VM_SENDERS[k].reply }; });
  return _json({ ok: true, quota_left: vmQuotaLeft_(), batch_max: VM_BATCH_MAX, chunk: VM_CHUNK, senders: senders });
}

function vmSend_(d) {
  var sk = String(d.sender || 'lv').toLowerCase();
  var sender = VM_SENDERS[sk];
  if (!sender) return _json({ ok: false, error: 'Unknown sender ' + sk });
  var replyTo = vmEmailOk_(d.reply_to) ? String(d.reply_to).trim() : sender.reply;
  var subject = String(d.subject || '').trim();
  var body = String(d.body || '').replace(/\r/g, '').trim();
  if (!subject) return _json({ ok: false, error: 'The subject is empty.' });
  if (!body) return _json({ ok: false, error: 'The message is empty.' });
  if (/\{[a-z_]+\}/i.test(subject + ' ' + body)) {
    return _json({ ok: false, error: 'The message still has an unfilled placeholder: ' + (subject + ' ' + body).match(/\{[a-z_]+\}/i)[0] + '. Nothing was sent.' });
  }

  var test = d.test === true || String(d.test).toUpperCase() === 'TRUE';
  var testTo = String(d.test_to || '').trim();
  if (test && !vmEmailOk_(testTo)) return _json({ ok: false, error: 'Test mode needs a valid test address.' });

  var seen = {}, to = [], skipped = [];
  (d.to || []).forEach(function (e) {
    var s = String(e || '').trim().toLowerCase();
    if (!vmEmailOk_(s)) { if (s) skipped.push(s); return; }
    if (seen[s]) return;
    seen[s] = 1; to.push(s);
  });
  // Sep 17 2026: the do not email list (DoNotEmail.gs) is enforced here, on the server,
  // whatever the page sent. If the list cannot be read, nothing goes out.
  var blocked = [];
  try {
    var cut = dneFilter_(to);
    to = cut.ok; blocked = cut.blocked;
  } catch (dneErr) {
    return _json({ ok: false, error: 'Could not read the do not email list, so nothing was sent. ' + String(dneErr && dneErr.message || dneErr) });
  }
  if (!to.length) return _json({ ok: false, blocked: blocked, error: blocked.length ?
    'Everyone in this batch is on the do not email list. Nothing was sent.' : 'No valid vendor email addresses in the batch.' });
  if (to.length > VM_BATCH_MAX) {
    return _json({ ok: false, error: 'Batch of ' + to.length + ' is over the Gmail limit of ' + VM_BATCH_MAX +
      '. Send it in smaller runs, or use Outlook for the whole list.' });
  }

  var chunks = [];
  for (var i = 0; i < to.length; i += VM_CHUNK) chunks.push(to.slice(i, i + VM_CHUNK));
  var need = test ? chunks.length : to.length + chunks.length;   // BCC addresses plus the To line per message
  var quota = vmQuotaLeft_();
  if (quota >= 0 && quota < need) {
    return _json({ ok: false, error: 'Only ' + quota + ' sends left on today\'s shared Gmail quota, and this batch needs ' + need +
      '. Nothing was sent. Send fewer, wait until tomorrow, or use Outlook.' });
  }

  var now = new Date();
  var stamp = Utilities.formatDate(now, 'America/Los_Angeles', 'yyyy-MM-dd HH:mm');
  var batchId = 'VM-' + Utilities.formatDate(now, 'America/Los_Angeles', 'yyMMdd') + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  var html = vmHtml_(body, sender, test, to.length);
  var plain = (test ? 'TEST. Live send would have gone to ' + to.length + ' vendors on BCC.\n\n' : '') + body + '\n\n' + vmFooterText_(sender);

  var sent = 0, errs = [];
  chunks.forEach(function (c, n) {
    try {
      var opts = {
        to: test ? testTo : replyTo,
        replyTo: replyTo,
        name: sender.name,
        subject: (test ? '[TEST ' + to.length + ' vendors] ' : '') + subject,
        htmlBody: html,
        body: plain
      };
      if (!test) opts.bcc = c.join(',');
      MailApp.sendEmail(opts);
      sent += test ? 0 : c.length;
    } catch (e) { errs.push('Chunk ' + (n + 1) + ': ' + String(e && e.message || e)); }
  });

  var status = errs.length ? (sent ? 'partial' : 'failed') : 'sent';
  try {
    var ss = vsBook_();
    var log = ss.getSheetByName(VM_LOG_TAB);
    if (!log) {
      log = ss.insertSheet(VM_LOG_TAB);
      log.getRange(1, 1, 1, VM_LOG_HEAD.length).setValues([VM_LOG_HEAD]).setFontWeight('bold');
      log.setFrozenRows(1);
    }
    log.appendRow([stamp, test, batchId, String(d.by || ''), sender.name, replyTo, String(d.template || ''),
      subject, test ? 0 : sent, to.join(', '), status, errs.join(' | ')]);
  } catch (e) { errs.push('Log: ' + String(e && e.message || e)); }

  return _json({ ok: !errs.length || sent > 0, batch_id: batchId, test: test, sent: sent, chunks: chunks.length,
    skipped: skipped, blocked: blocked, status: status, error: errs.join(' | '), quota_left: vmQuotaLeft_() });
}

function vmEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function vmFooterText_(sender) {
  var lines = [];
  sender.markets.forEach(function (m) {
    var mk = (typeof INS_MARKETS !== 'undefined') ? INS_MARKETS[m] : null;
    if (mk) lines.push(mk.label + ', ' + mk.addr1 + ', ' + mk.addr2);
    else lines.push('City Wide Facility Solutions of ' + m);
  });
  lines.push('Replies go to ' + sender.reply + '.');
  lines.push(DNE_FOOTER);
  return lines.join('\n');
}

// Plain text from the page -> branded HTML. Blank line = paragraph. Lines that
// start with "- " make a list. A line written as "Button text: https://..."
// on its own becomes a red button. Bare URLs become links.
function vmHtml_(text, sender, test, count) {
  var logo = (typeof INS_LOGO !== 'undefined') ? INS_LOGO : 'https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png';
  var paras = String(text).split(/\n{2,}/);
  var inner = paras.map(function (p) {
    var lines = p.split('\n').filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return '';
    if (lines.every(function (l) { return /^\s*-\s+/.test(l); })) {
      return '<ul style="margin:0 0 14px;padding-left:22px;">' + lines.map(function (l) {
        return '<li style="margin:0 0 4px;">' + vmLinkify_(vmEsc_(l.replace(/^\s*-\s+/, ''))) + '</li>';
      }).join('') + '</ul>';
    }
    var m = lines.length === 1 && lines[0].trim().match(/^([^:]{2,60}):\s+(https?:\/\/\S+)$/);
    if (m) {
      return '<p style="margin:4px 0 18px;"><a href="' + vmEsc_(m[2]) + '" style="display:inline-block;background:#D22730;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:6px;">' +
        vmEsc_(m[1]) + '</a></p>';
    }
    return '<p style="margin:0 0 14px;">' + vmLinkify_(lines.map(vmEsc_).join('<br>')) + '</p>';
  }).join('');
  var banner = test ? '<div style="background:#fff6d8;border:1px solid #E5B423;padding:10px 14px;font-size:12px;margin:0 0 14px;">TEST. The live send would go to ' + count + ' vendors, each on BCC.</div>' : '';
  var foot = vmFooterText_(sender).split('\n').map(vmEsc_).join('<br>');
  return '<div style="background:#f4f5f7;padding:24px 12px;font-family:Verdana,Geneva,Tahoma,sans-serif;color:#2D2A26;font-size:14px;line-height:1.55;">' +
    '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;">' +
    '<tr><td style="padding:22px 28px 10px;"><img src="' + logo + '" alt="City Wide Facility Solutions" style="height:40px;width:auto;display:block;"></td></tr>' +
    '<tr><td style="height:4px;background:#D22730;font-size:0;line-height:0;">&nbsp;</td></tr>' +
    '<tr><td style="padding:22px 28px 8px;">' + banner + inner + '</td></tr>' +
    '<tr><td style="padding:14px 28px 24px;border-top:1px solid #eee;font-size:11.5px;color:#636466;line-height:1.5;">' + foot + '</td></tr></table></div>';
}

function vmLinkify_(html) {
  return html.replace(/(https?:\/\/[^\s<]+)/g, function (u) {
    var tail = '';
    var m = u.match(/[.,;:)]+$/); if (m) { tail = m[0]; u = u.slice(0, -tail.length); }
    return '<a href="' + u + '" style="color:#D22730;font-weight:bold;">' + u + '</a>' + tail;
  });
}

// Run from the editor: sends one test to the address below and logs it.
function vmSelfTest() {
  var r = vmSend_({ sender: 'both', template: 'selftest', subject: 'Vendor messages self test',
    body: 'This is a test of the vendor messages sender.\n\nOpen the shop: https://citywidelv.github.io/cw-vendor-hub/shop/\n\n- one\n- two',
    to: ['vendor1@example.com', 'vendor2@example.com'], by: 'selftest', test: true, test_to: 'citywideoflasvegas@gmail.com' });
  Logger.log(r.getContent());
}

// ---------------------------------------------------------------------------
// Queue. Sep 17 2026.
//
// One click on the page, any size list. The page posts vm_queue with everyone
// picked; this side writes one row per vendor on the Vendor Message Queue tab
// and a timed trigger (vmDrain) works through it: one email of up to VM_CHUNK
// vendors on BCC every 10 minutes, 7am to 7pm Pacific, never letting the day's
// shared Gmail quota fall below VM_RESERVE so violation and insurance notices
// can still go out. What does not fit today goes tomorrow. Nobody has to come
// back and click again.
//
// A vendor already queued or sent for the same template (one posting is one
// template, "opportunity:<id>") is skipped, so nobody gets the same job twice
// no matter who on the team queues it.
//
// POST {kind:'vm_queue', passcode, sender, reply_to, template, subject, body, to:[..], by}
//        -> {ok, batch_id, queued, already, skipped, sent_now, pending, quota_left, per_day}
// POST {kind:'vm_queue_status', passcode, template}
//        -> {ok, quota_left, reserve, per_day, pending_all, emails:{addr:'sent Sep 17'|'queued'}, batches:[..]}
// POST {kind:'vm_queue_cancel', passcode, template}     -> {ok, cancelled}

var VM_Q_TAB = 'Vendor Message Queue';
var VM_Q_HEAD = ['queued', 'batch_id', 'template', 'email', 'status', 'sent_at', 'error'];
var VM_B_TAB = 'Vendor Message Batches';
var VM_B_HEAD = ['queued', 'batch_id', 'sent_by', 'sender', 'reply_to', 'template', 'subject', 'body', 'total'];
var VM_RESERVE = 5;         // small cushion. Notices do not use this mailbox.
var VM_DAILY = 100;         // what Google allows this mailbox a day right now. Only used for the "about N days" estimate.
var VM_QUEUE_MAX = 1500;    // vendors per vm_queue request
var VM_DRAIN_FN = 'vmDrain';
var VM_TZ = 'America/Los_Angeles';

function vmTab_(ss, name, head) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function vmRows_(sh) {
  var last = sh.getLastRow();
  return last < 2 ? [] : sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}
function vmPerDay_() { var u = VM_DAILY - VM_RESERVE; return Math.max(0, u - Math.ceil(u / (VM_CHUNK + 1))); }
function vmDay_(d) { try { return Utilities.formatDate(new Date(d), VM_TZ, 'MMM d'); } catch (e) { return ''; } }

function vmEnsureTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === VM_DRAIN_FN; });
  if (!has) ScriptApp.newTrigger(VM_DRAIN_FN).timeBased().everyMinutes(10).create();
}
function vmDropTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === VM_DRAIN_FN) ScriptApp.deleteTrigger(t); });
}

function vmQueue_(d) {
  var sk = String(d.sender || 'lv').toLowerCase();
  var sender = VM_SENDERS[sk];
  if (!sender) return _json({ ok: false, error: 'Unknown sender ' + sk });
  var replyTo = vmEmailOk_(d.reply_to) ? String(d.reply_to).trim() : sender.reply;
  var subject = String(d.subject || '').trim();
  var body = String(d.body || '').replace(/\r/g, '').trim();
  var template = String(d.template || 'custom').trim();
  if (!subject) return _json({ ok: false, error: 'The subject is empty.' });
  if (!body) return _json({ ok: false, error: 'The message is empty.' });
  if (/\{[a-z_]+\}/i.test(subject + ' ' + body)) {
    return _json({ ok: false, error: 'The message still has an unfilled placeholder: ' + (subject + ' ' + body).match(/\{[a-z_]+\}/i)[0] + '. Nothing was scheduled.' });
  }
  var seen = {}, to = [], skipped = [];
  (d.to || []).forEach(function (e) {
    var s = String(e || '').trim().toLowerCase();
    if (!vmEmailOk_(s)) { if (s) skipped.push(s); return; }
    if (seen[s]) return;
    seen[s] = 1; to.push(s);
  });
  var blocked = [];
  try { var cut = dneFilter_(to); to = cut.ok; blocked = cut.blocked; }
  catch (dneErr) { return _json({ ok: false, error: 'Could not read the do not email list, so nothing was scheduled. ' + String(dneErr && dneErr.message || dneErr) }); }
  if (!to.length) return _json({ ok: false, blocked: blocked, error: blocked.length ?
    'Everyone picked is on the do not email list. Nothing was scheduled.' : 'No valid vendor email addresses were picked.' });
  if (to.length > VM_QUEUE_MAX) return _json({ ok: false, error: 'That is ' + to.length + ' vendors. One request can schedule ' + VM_QUEUE_MAX + '.' });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return _json({ ok: false, error: 'The sender is busy. Nothing was scheduled. Try again in a minute.' });
  var batchId, fresh, already = 0;
  try {
    var ss = vsBook_();
    var q = vmTab_(ss, VM_Q_TAB, VM_Q_HEAD), b = vmTab_(ss, VM_B_TAB, VM_B_HEAD);
    var had = {};
    vmRows_(q).forEach(function (r) {
      if (String(r[2]) === template && (r[4] === 'pending' || r[4] === 'sent')) had[String(r[3]).toLowerCase()] = 1;
    });
    fresh = to.filter(function (e) { if (had[e]) { already++; return false; } return true; });
    if (!fresh.length) return _json({ ok: false, error: 'Everyone picked has already been emailed about this, or is already scheduled. Nothing new was added.', already: already });
    var now = new Date();
    batchId = 'VQ-' + Utilities.formatDate(now, VM_TZ, 'yyMMdd') + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
    b.appendRow([now, batchId, String(d.by || ''), sk, replyTo, template, subject, body, fresh.length]);
    var rows = fresh.map(function (e) { return [now, batchId, template, e, 'pending', '', '']; });
    q.getRange(q.getLastRow() + 1, 1, rows.length, VM_Q_HEAD.length).setValues(rows);
    SpreadsheetApp.flush();
    vmEnsureTrigger_();
  } catch (e) {
    return _json({ ok: false, error: 'Could not schedule: ' + String(e && e.message || e) });
  } finally { lock.releaseLock(); }

  var first = vmDrainOnce_(true);           // the first email goes now so the sender sees it start
  var st = vmPending_();
  return _json({ ok: true, batch_id: batchId, queued: fresh.length, already: already, skipped: skipped, blocked: blocked,
    sent_now: first.sent, pending: st.pending, quota_left: vmQuotaLeft_(), per_day: vmPerDay_(), note: first.note });
}

function vmPending_() {
  var n = 0;
  try { vmRows_(vmTab_(vsBook_(), VM_Q_TAB, VM_Q_HEAD)).forEach(function (r) { if (r[4] === 'pending') n++; }); } catch (e) {}
  return { pending: n };
}

// Timed trigger entry point.
function vmDrain() { vmDrainOnce_(false); }

// Sends at most one email (up to VM_CHUNK vendors on BCC) from the oldest batch.
function vmDrainOnce_(fromPage) {
  var out = { sent: 0, note: '' };
  var hour = Number(Utilities.formatDate(new Date(), VM_TZ, 'H'));
  if (hour < 7 || hour >= 19) { out.note = 'Outside 7am to 7pm. Sending picks up at 7am.'; return out; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(fromPage ? 5000 : 0)) { out.note = 'busy'; return out; }
  try {
    var ss = vsBook_();
    var q = vmTab_(ss, VM_Q_TAB, VM_Q_HEAD), b = vmTab_(ss, VM_B_TAB, VM_B_HEAD);
    var rows = vmRows_(q), pick = [], batchId = '';
    for (var i = 0; i < rows.length && pick.length < VM_CHUNK; i++) {
      if (rows[i][4] !== 'pending') continue;
      if (!batchId) batchId = String(rows[i][1]);
      if (String(rows[i][1]) === batchId) pick.push(i);
    }
    if (!pick.length) { vmDropTrigger_(); out.note = 'Queue is empty.'; return out; }
    var quota = vmQuotaLeft_();
    if (quota >= 0) {
      var room = quota - VM_RESERVE - 1;      // one for the To line
      if (room < 1) { out.note = 'Today\'s sends are used up. The rest go out tomorrow.'; return out; }
      if (pick.length > room) pick = pick.slice(0, room);
    }
    // The list is checked again right before each email, because a vendor can ask to be
    // taken off while their row is still waiting. If the list cannot be read, nothing goes.
    try {
      var cutNow = dneFilter_(pick.map(function (ix) { return String(rows[ix][3]); }));
      if (cutNow.blocked.length) {
        var isBlocked = {}; cutNow.blocked.forEach(function (e) { isBlocked[e] = 1; });
        var nowStamp = new Date();
        pick = pick.filter(function (ix) {
          if (!isBlocked[String(rows[ix][3]).toLowerCase()]) return true;
          q.getRange(ix + 2, 5, 1, 3).setValues([['blocked', nowStamp, 'On the do not email list.']]);
          return false;
        });
        if (!pick.length) { out.note = 'That group was all on the do not email list.'; return out; }
      }
    } catch (dneErr2) { out.note = 'Could not read the do not email list. Nothing sent this round.'; return out; }
    var meta = null;
    vmRows_(b).forEach(function (r) { if (String(r[1]) === batchId) meta = r; });
    var stamp = new Date();
    function mark(status, err) {
      pick.forEach(function (ix) { q.getRange(ix + 2, 5, 1, 3).setValues([[status, stamp, err || '']]); });
    }
    if (!meta) { mark('failed', 'Batch details are missing.'); return out; }
    var sender = VM_SENDERS[String(meta[3])] || VM_SENDERS.lv;
    var replyTo = vmEmailOk_(meta[4]) ? String(meta[4]) : sender.reply;
    var subject = String(meta[6]), body = String(meta[7]);
    var emails = pick.map(function (ix) { return String(rows[ix][3]); });
    var status = 'sent', err = '';
    try {
      MailApp.sendEmail({ to: replyTo, replyTo: replyTo, name: sender.name, subject: subject,
        htmlBody: vmHtml_(body, sender, false, emails.length), body: body + '\n\n' + vmFooterText_(sender), bcc: emails.join(',') });
      out.sent = emails.length;
    } catch (e) { status = 'failed'; err = String(e && e.message || e); out.note = err; }
    mark(status, err);
    try {
      var log = vmTab_(ss, VM_LOG_TAB, VM_LOG_HEAD);
      log.appendRow([Utilities.formatDate(stamp, VM_TZ, 'yyyy-MM-dd HH:mm'), false, batchId, String(meta[2]), sender.name, replyTo,
        String(meta[5]), subject, status === 'sent' ? emails.length : 0, emails.join(', '), status, err]);
    } catch (e2) {}
    return out;
  } catch (e) { out.note = String(e && e.message || e); return out; }
  finally { lock.releaseLock(); }
}

function vmQueueStatus_(d) {
  var template = String(d.template || '').trim();
  var emails = {}, batches = {}, order = [], pendingAll = 0;
  try {
    vmRows_(vmTab_(vsBook_(), VM_Q_TAB, VM_Q_HEAD)).forEach(function (r) {
      if (r[4] === 'pending') pendingAll++;
      if (!template || String(r[2]) !== template) return;
      var id = String(r[1]), st = String(r[4]), em = String(r[3]).toLowerCase();
      if (!batches[id]) { batches[id] = { batch_id: id, queued: vmDay_(r[0]), pending: 0, sent: 0, failed: 0, cancelled: 0, blocked: 0 }; order.push(id); }
      if (batches[id][st] != null) batches[id][st]++;
      if (st === 'sent') emails[em] = 'sent ' + vmDay_(r[5]);
      else if (st === 'pending' && !emails[em]) emails[em] = 'queued';
    });
  } catch (e) { return _json({ ok: false, error: 'Could not read the queue: ' + String(e && e.message || e) }); }
  return _json({ ok: true, quota_left: vmQuotaLeft_(), reserve: VM_RESERVE, per_day: vmPerDay_(), chunk: VM_CHUNK,
    pending_all: pendingAll, emails: emails, batches: order.map(function (k) { return batches[k]; }) });
}

function vmQueueCancel_(d) {
  var template = String(d.template || '').trim();
  if (!template) return _json({ ok: false, error: 'Nothing to cancel.' });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return _json({ ok: false, error: 'The sender is busy. Try again in a minute.' });
  var n = 0;
  try {
    var q = vmTab_(vsBook_(), VM_Q_TAB, VM_Q_HEAD), now = new Date();
    vmRows_(q).forEach(function (r, i) {
      if (String(r[2]) === template && r[4] === 'pending') { q.getRange(i + 2, 5, 1, 3).setValues([['cancelled', now, String(d.by || '')]]); n++; }
    });
  } catch (e) { return _json({ ok: false, error: String(e && e.message || e) }); }
  finally { lock.releaseLock(); }
  return _json({ ok: true, cancelled: n });
}
