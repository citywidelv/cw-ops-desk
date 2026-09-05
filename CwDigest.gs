// ============================================================
// CwDigest.gs - digest-aware send for satellite Apps Script projects
// (CW Maintenance Work Tickets, CW Uniform Requests). Sep 5 2026.
// Same contract as cwMail_ in the CW Solicitations project:
//   mode per tag from the SendConfig tab of the CW Solicitations sheet
//   (send | digest | weekly | skip, default send). digest/weekly rows go to
//   that sheet's Digest tab and ride the 8am / 4pm / Monday digests sent by
//   CW Solicitations. Attachments always send now. Any failure = plain send.
//   The handler must write its own sheet row BEFORE calling this.
// ============================================================
var CW_SOL_SHEET_ID = '1ymbqR7LMvA7sbgZe2Ro5o2dNiXhP08Tn9Hw1b-H5AeQ';

function cwRemoteMode_(tag) {
  try {
    var sc = SpreadsheetApp.openById(CW_SOL_SHEET_ID).getSheetByName('SendConfig');
    if (!sc) return 'send';
    var v = sc.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (String(v[i][0]).trim() === tag) return String(v[i][1] || 'send').trim().toLowerCase() || 'send';
  } catch (e) {}
  return 'send';
}

function cwRemoteQueue_(tag, opts, cadence) {
  var sh = SpreadsheetApp.openById(CW_SOL_SHEET_ID).getSheetByName('Digest');
  if (!sh) throw new Error('no Digest tab');
  var body = String(opts.body || '');
  if (!body && opts.htmlBody) body = String(opts.htmlBody).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  var det = ''; try { if (opts.digest) det = JSON.stringify(opts.digest).slice(0, 45000); } catch (j) {}
  sh.appendRow([new Date(), tag, String(opts.to || ''), String(opts.subject || ''), body.slice(0, 400), cadence === 'immediate', cadence, det, String(opts.cc || '')]);
}

function cwRemoteMail_(tag, opts) {
  var mode = cwRemoteMode_(tag);
  var hasFile = !!(opts.attachments && opts.attachments.length);
  try {
    if (mode === 'skip') return;
    if ((mode === 'digest' || mode === 'weekly') && !hasFile) {
      try { cwRemoteQueue_(tag, opts, mode === 'weekly' ? 'weekly' : 'daily'); return; } catch (q) { /* fall through */ }
    }
    var r = MailApp.sendEmail(opts);
    try { cwRemoteQueue_(tag, opts, 'immediate'); } catch (l) {}
    return r;
  } catch (e) { try { return MailApp.sendEmail(opts); } catch (e2) { return; } }
}
