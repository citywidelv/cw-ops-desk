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
  if (String(d.passcode || '') !== PASSCODE) return _json({ ok: false, error: 'Wrong passcode.' });
  var kind = String(d.kind || '');
  if (kind === 'vm_quota') return vmQuota_(d);
  if (kind === 'vm_send') return vmSend_(d);
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
  if (!to.length) return _json({ ok: false, error: 'No valid vendor email addresses in the batch.' });
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
    var ss = SpreadsheetApp.openById(SHEET_ID);
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
    skipped: skipped, status: status, error: errs.join(' | '), quota_left: vmQuotaLeft_() });
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
