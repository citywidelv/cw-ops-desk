// DoNotEmail.gs. Sep 17 2026.
// File in the CW Solicitations Apps Script project.
// Routing: doPost in Code.gs routes any kind starting 'dne_' to dneDispatch(d).
//
// One do not email list for the whole platform, kept on the "Do Not Email" tab
// of the CW Vendor Directory book and worked from the Ops Hub page
// vendor-dne.html (also linked from the Admin Hub). Nobody has to open the Sheet.
//
// What the list blocks (TJ, Sep 17 2026): marketing type email only.
//   blocked   vendor messages (vm_send), opportunity emails, new vendor invites
//   NOT blocked  violation notices, COI requests, background check notices, and
//             receipts for things the vendor submits. Those are notices tied to
//             work the vendor holds and they must keep a paper trail.
//
// How it is enforced, so no picker can forget it:
//   1. vdList_ tags every vendor whose address is on the list with dne:true. The
//      opportunity panel (notify.js) and the messaging page drop those rows.
//   2. vmSend_ filters its recipient list through dneFilter_ on the server. If the
//      list cannot be read the send is refused, never sent unfiltered.
//   3. vdInvite_ refuses an address on the list.
//
// The list is keyed by EMAIL ADDRESS, not by vendor row, so it covers a vendor
// that sits on both market tabs, a re-import of the same vendor, and an address
// that is not in the directory at all. Rows are never deleted. Lifting a block
// stamps removed_by and removed, which is also the audit trail.
//
// Removing a vendor from every list uses the directory's existing hide column.
// Nothing new was added to VD_HEADERS.
//
// POST {kind:'dne_list',   passcode}
//   -> {ok, blocked:[..], vendors:[..], lifted:[..]}
// POST {kind:'dne_add',    passcode, by, reason, vendor_ids:[..], emails:[..]}
//   -> {ok, added:[..], already:[..], no_email:[..], live:[..]}
// POST {kind:'dne_remove', passcode, by, email}
//   -> {ok, lifted}
// POST {kind:'dne_hide',   passcode, by, reason, vendor_id, hide:true|false}
//   -> {ok, vendor, hidden}

var DNE_TAB = 'Do Not Email';
var DNE_HEAD = ['email', 'vendor_id', 'vendor', 'status_when_added', 'region', 'reason',
  'added_by', 'added', 'removed_by', 'removed'];

// Vendor-facing footer. Reviewed Sep 17 2026 against 15 USC 7704(a)(3) to (a)(5):
// reply is the opt out, the reply mailbox must keep working 30 days, the request
// must be honored inside 10 business days, and the email must carry a street
// address. The last sentence is about reaching a vendor at all. It is not a
// penalty for opting out of announcements, and the wording keeps those apart.
var DNE_FOOTER = 'To stop these emails, reply and ask to be taken off our lists. ' +
  'You will stop hearing about new work. Notices about buildings you hold will still come to this address. ' +
  'A vendor we cannot reach by email cannot stay active with City Wide.';
var DNE_FOOTER_SHORT = 'To stop these emails, reply and ask to be taken off our lists.';

var DNE_ALERT_TO = {
  'Las Vegas': 'lvservicecall@gocitywide.com',
  'Northern Nevada': 'rnservicecall@gocitywide.com'
};

function dneDispatch(d) {
  if (String(d.passcode || '') === '' || String(d.passcode || '') !== vdPass_()) {
    return vdOut_({ ok: false, error: 'Wrong passcode.' });
  }
  var kind = String(d.kind || '');
  try {
    if (kind === 'dne_list') return dneList_(d);
    if (kind === 'dne_add') return dneAdd_(d);
    if (kind === 'dne_remove') return dneRemove_(d);
    if (kind === 'dne_hide') return dneHide_(d);
  } catch (e) {
    return vdOut_({ ok: false, error: String(e && e.message || e) });
  }
  return vdOut_({ ok: false, error: 'Unknown kind ' + kind });
}

// ------------------------------------------------------------ helpers ------

function dneToday_() { return Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd'); }
function dneEmailOk_(s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim()); }

// A directory email cell sometimes holds two addresses. Every one of them counts.
function dneEmails_(raw) {
  return String(raw == null ? '' : raw).toLowerCase().split(/[\s,;]+/)
    .map(function (s) { return s.replace(/^<|>$/g, '').trim(); })
    .filter(function (s) { return dneEmailOk_(s); });
}

function dneSheet_(ss, create) {
  var sh = ss.getSheetByName(DNE_TAB);
  if (!sh && create) {
    sh = ss.insertSheet(DNE_TAB);
    sh.getRange(1, 1, 1, DNE_HEAD.length).setValues([DNE_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setTabColor('#2D2A26');
  }
  return sh;
}

// Every list row as an object plus its sheet row number.
function dneRows_(ss) {
  var sh = dneSheet_(ss, false);
  if (!sh || sh.getLastRow() < 2) return [];
  var vals = sh.getRange(1, 1, sh.getLastRow(), DNE_HEAD.length).getValues();
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var o = { _row: i + 1 };
    for (var c = 0; c < DNE_HEAD.length; c++) o[DNE_HEAD[c]] = vdStr_(vals[i][c]);
    o.email = o.email.toLowerCase();
    if (o.email) out.push(o);
  }
  return out;
}

// {address: true} for every address blocked right now. A row with a removed date
// is history, not a block.
function dneSet_(ss) {
  var set = {};
  dneRows_(ss || vdSS_()).forEach(function (r) { if (!r.removed) set[r.email] = true; });
  return set;
}

function dneHas_(set, rawEmail) {
  return dneEmails_(rawEmail).some(function (e) { return set[e] === true; });
}

// Used by every marketing type sender. Throws if the list cannot be read, and
// the caller must treat a throw as "do not send".
function dneFilter_(emails) {
  var set = dneSet_(vdSS_());
  var ok = [], blocked = [];
  (emails || []).forEach(function (e) {
    var s = String(e || '').trim().toLowerCase();
    if (!s) return;
    if (set[s] === true) blocked.push(s); else ok.push(s);
  });
  return { ok: ok, blocked: blocked };
}

// Footer lines for a marketing type email: the office street address for each
// market named, then the opt out wording.
function dneFooterText_(markets, short) {
  var lines = [];
  (markets || []).forEach(function (m) {
    var mk = (typeof INS_MARKETS !== 'undefined') ? INS_MARKETS[m] : null;
    if (mk) lines.push(mk.label + ', ' + mk.addr1 + ', ' + mk.addr2);
  });
  lines.push(short ? DNE_FOOTER_SHORT : DNE_FOOTER);
  return lines.join('\n');
}

// Writes one cell on a vendor row, finding the column by the sheet's own header
// row so a moved column can never be written to by position.
function dneSetCell_(sh, row, header, value) {
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return vdStr_(h); });
  var i = head.indexOf(header);
  if (i < 0) return false;
  sh.getRange(row, i + 1).setValue(value);
  return true;
}

function dneStamp_(r, text) {
  var note = text + (r.internal_notes ? ' | ' + r.internal_notes : '');
  dneSetCell_(r._sheet, r._row, 'internal_notes', note);
  dneSetCell_(r._sheet, r._row, 'updated', dneToday_());
}

// ------------------------------------------------------------ dne_list -----

function dneList_(d) {
  var ss = vdSS_();
  var rows = dneRows_(ss);
  var set = {};
  rows.forEach(function (r) { if (!r.removed) set[r.email] = true; });

  var vendors = [];
  vdAllRows_(ss).forEach(function (r) {
    if (!r.dba_name) return;
    vendors.push({
      id: r.vendor_id, name: r.dba_name, legal: r.legal_name, contact: r.contact_name,
      email: r.email, status: r.status, region: vdRegion_(r.region),
      live: VD_LIVE_STATUS.indexOf(r.status) >= 0,
      hidden: vdTrue_(r.hide), dne: dneHas_(set, r.email)
    });
  });
  vendors.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });

  function pub(r) {
    return { email: r.email, vendor_id: r.vendor_id, vendor: r.vendor, status: r.status_when_added,
      region: r.region, reason: r.reason, added_by: r.added_by, added: r.added,
      removed_by: r.removed_by, removed: r.removed };
  }
  var blocked = rows.filter(function (r) { return !r.removed; }).map(pub).reverse();
  var lifted = rows.filter(function (r) { return !!r.removed; }).map(pub).reverse().slice(0, 25);
  return vdOut_({ ok: true, blocked: blocked, lifted: lifted, vendors: vendors,
    footer: DNE_FOOTER, generated: new Date().toISOString() });
}

// ------------------------------------------------------------ dne_add ------

function dneAdd_(d) {
  var by = vdStr_(d.by);
  var reason = vdStr_(d.reason);
  if (!by) return vdOut_({ ok: false, error: 'Type your name so the log shows who did this.' });
  var ids = (d.vendor_ids || []).map(function (x) { return vdStr_(x); }).filter(function (x) { return x; });
  var typed = [];
  (d.emails || []).forEach(function (e) { typed = typed.concat(dneEmails_(e)); });
  if (!ids.length && !typed.length) return vdOut_({ ok: false, error: 'Pick a vendor or type an email address.' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = vdSS_();
    var sh = dneSheet_(ss, true);
    var set = dneSet_(ss);
    var all = vdAllRows_(ss).filter(function (r) { return r.dba_name; });
    var today = dneToday_();

    // address -> what we know about it
    var want = {}, noEmail = [];
    ids.forEach(function (id) {
      var hit = all.filter(function (r) { return r.vendor_id === id; });
      hit.forEach(function (r) {
        var ems = dneEmails_(r.email);
        if (!ems.length) { noEmail.push(r.dba_name); return; }
        ems.forEach(function (e) { want[e] = want[e] || r; });
      });
    });
    typed.forEach(function (e) {
      if (want[e]) return;
      var r = all.filter(function (x) { return dneEmails_(x.email).indexOf(e) >= 0; })[0];
      want[e] = r || { vendor_id: '', dba_name: '', status: '', region: '' };
    });

    var added = [], already = [], liveHits = {}, newRows = [];
    Object.keys(want).forEach(function (e) {
      if (set[e] === true) { already.push(e); return; }
      var r = want[e];
      newRows.push([e, r.vendor_id || '', r.dba_name || '', r.status || '',
        r.dba_name ? vdRegion_(r.region) : '', reason, by, today, '', '']);
      added.push(e);
      set[e] = true;
    });
    if (newRows.length) {
      sh.getRange(sh.getLastRow() + 1, 1, newRows.length, DNE_HEAD.length).setValues(newRows);
    }

    // Stamp every directory row that carries a newly blocked address, so anyone
    // reading the Sheet sees it on the vendor row too.
    if (added.length) {
      all.forEach(function (r) {
        var ems = dneEmails_(r.email);
        if (!ems.some(function (e) { return added.indexOf(e) >= 0; })) return;
        dneStamp_(r, 'DO NOT EMAIL ' + today + ' (' + by + ')' + (reason ? '. ' + reason : ''));
        if (VD_LIVE_STATUS.indexOf(r.status) >= 0 && !vdTrue_(r.hide)) liveHits[r.vendor_id] = r;
      });
    }

    var live = Object.keys(liveHits).map(function (k) { return liveHits[k]; });
    if (live.length) dneAlert_(live, by, reason);

    return vdOut_({ ok: true, added: added, already: already, no_email: noEmail,
      live: live.map(function (r) { return r.dba_name; }) });
  } finally { lock.releaseLock(); }
}

// An Active, Waiting for Account or In Progress vendor went on the list. The
// market office hears about it so a person calls them. Nothing else changes.
function dneAlert_(live, by, reason) {
  var byMarket = {};
  live.forEach(function (r) {
    var reg = vdRegion_(r.region);
    (reg === 'Both' ? ['Las Vegas', 'Northern Nevada'] : [reg]).forEach(function (m) {
      (byMarket[m] = byMarket[m] || []).push(r);
    });
  });
  Object.keys(byMarket).forEach(function (m) {
    var to = DNE_ALERT_TO[m];
    if (!to) return;
    var names = byMarket[m].map(function (r) { return r.dba_name + ' (' + r.status + ')'; });
    var body = 'Put on the do not email list by ' + by + '.\n\n' + names.join('\n') + '\n\n' +
      (reason ? 'Reason given. ' + reason + '\n\n' : '') +
      'They no longer get opportunity emails, vendor messages or invites, and they no longer show in those pickers. ' +
      'Violation notices, COI requests and background check notices still send.\n\n' +
      'These vendors hold or are being set up for work. Call them and confirm we can still reach them.';
    try {
      var opts = { to: to, name: 'City Wide Ops Hub',
        subject: 'Do not email. ' + names.length + ' working vendor' + (names.length === 1 ? '' : 's') + ' in ' + m, body: body };
      if (typeof cwMail_ === 'function') cwMail_('dne_active', opts); else cwSend_(opts);
    } catch (e) {}
  });
}

// ------------------------------------------------------------ dne_remove ---

function dneRemove_(d) {
  var by = vdStr_(d.by);
  var emails = dneEmails_(d.email);   // a directory cell can hold two addresses; lift them all
  var email = emails.join(', ');
  if (!by) return vdOut_({ ok: false, error: 'Type your name so the log shows who did this.' });
  if (!emails.length) return vdOut_({ ok: false, error: 'No email address given.' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = vdSS_();
    var sh = dneSheet_(ss, false);
    var today = dneToday_();
    var n = 0;
    dneRows_(ss).forEach(function (r) {
      if (emails.indexOf(r.email) < 0 || r.removed) return;
      sh.getRange(r._row, DNE_HEAD.indexOf('removed_by') + 1, 1, 2).setValues([[by, today]]);
      n++;
    });
    if (!n) return vdOut_({ ok: false, error: email + ' is not on the list.' });
    vdAllRows_(ss).forEach(function (r) {
      if (!r.dba_name || !dneEmails_(r.email).some(function (e) { return emails.indexOf(e) >= 0; })) return;
      dneStamp_(r, 'Do not email lifted ' + today + ' (' + by + ')');
    });
    return vdOut_({ ok: true, lifted: email });
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------ dne_hide -----

// Remove a vendor from every list on the platform, or put them back. This is the
// directory's existing hide checkbox. The row stays on the Sheet.
function dneHide_(d) {
  var by = vdStr_(d.by);
  var id = vdStr_(d.vendor_id);
  var hide = d.hide === true || String(d.hide).toUpperCase() === 'TRUE';
  var reason = vdStr_(d.reason);
  if (!by) return vdOut_({ ok: false, error: 'Type your name so the log shows who did this.' });
  if (!id) return vdOut_({ ok: false, error: 'No vendor picked.' });

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = vdSS_();
    var hit = vdAllRows_(ss).filter(function (r) { return r.dba_name && r.vendor_id === id; });
    if (!hit.length) return vdOut_({ ok: false, error: 'Vendor ' + id + ' was not found.' });
    var today = dneToday_();
    hit.forEach(function (r) {
      if (!dneSetCell_(r._sheet, r._row, 'hide', hide)) throw new Error('The hide column is missing on ' + r._tab + '.');
      dneStamp_(r, (hide ? 'REMOVED FROM ALL LISTS ' : 'Restored to lists ') + today + ' (' + by + ')' + (reason ? '. ' + reason : ''));
    });
    return vdOut_({ ok: true, vendor: hit[0].dba_name, hidden: hide });
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------ run helper ---

// Editor > Run (through Runner.gs). Creates the tab and logs the counts.
function dneSetupRun() {
  var ss = vdSS_();
  dneSheet_(ss, true);
  Logger.log('Do Not Email tab ready. Blocked now: ' + Object.keys(dneSet_(ss)).length);
}
