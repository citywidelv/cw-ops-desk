// ============================================================
// WorkTicketsHub.gs - the work ticket billing queue (Oct 15 2026)
// File in the CW Team Portal Backend project. doPost routes the wt_ prefix here
// (team passcode). Page: cw-ops-desk/work-tickets.html. Alert: one line per FSM on
// the Ops Hub Alerts card ("3 work tickets to bill"), built by wtAlertItems_ below.
//
// Why: handyman and vendor crews submit a Maintenance Work Ticket after the work is
// done. Two FSMs working the same tickets created the same CRM work orders twice
// (Comprehensive Cancer Centers, Aug/Sep 2026, $1,240 double-billed). This queue
// gives every ticket one owner and one check-off, by name, so the second person
// sees "Billed by Jake, Aug 21, WO-729460" instead of billing it again.
//
// Data: the Work Tickets tab of the CW Maintenance Work Tickets book, written by
// the satellite script. This module only reads it and writes these columns:
//   Billed? (A, the checkbox FSMs already use), Status, and the appended columns
//   FSM, Account, Property Group, Billed By, Billed At, Billing Ref, Assigned By,
//   Assigned At. Columns are found by header, never by position, and the appended
//   ones are created on first use. Rows are found by Ticket # at write time, because
//   the satellite inserts new tickets at the top and shifts every row down.
//
// Owner: the FSM column, stamped by the satellite from the customer directory when
// the ticket comes in. Blank FSM -> match the property name to the directory here
// (afMatch_, AccountFsm.gs) and stamp it, so a ticket is only matched once. Still
// blank -> "Unassigned" bucket on the page; someone claims it with Reassign.
//
// Kinds
//   wt_list   {}                                  -> {ok, tickets, roster, generated}
//             tickets = every unbilled ticket (any age; an unbilled ticket never
//             drops off) plus billed / not-billable ones from the last 60 days
//   wt_set    {ticket, status:'Billed'|'Not billable'|'', by, ref} -> {ok, ticket}
//   wt_assign {ticket, fsm, by}                   -> {ok, ticket}
// ============================================================
var WT_SHEET_ID_DEFAULT = '17awrIV6X-Ugaxkw0VLDIH8WVpJ51Ux_5ntNxHu2tzBg'; // CW Maintenance Work Tickets
var WT_TAB = 'Work Tickets';
var WT_EXTRA = ['FSM', 'Account', 'Property Group', 'Billed By', 'Billed At', 'Billing Ref', 'Assigned By', 'Assigned At'];
var WT_DONE_DAYS = 60;
var WT_STATUS = ['Billed', 'Not billable'];

function wtDispatch(d) {
  if (String(d.passcode || '') !== PASSCODE) return _json({ ok: false, error: 'Wrong passcode.' });
  var kind = String(d.kind || '');
  try {
    if (kind === 'wt_list') return _json(wtList_(d));
    if (kind === 'wt_set') return _json(wtSet_(d));
    if (kind === 'wt_assign') return _json(wtAssign_(d));
  } catch (e) {
    return _json({ ok: false, error: String(e && e.message || e) });
  }
  return _json({ ok: false, error: 'Unknown work ticket kind ' + kind });
}

// ------------------------------------------------------------ plumbing -----
function wtSS_() {
  var id = PropertiesService.getScriptProperties().getProperty('WT_SHEET_ID') || WT_SHEET_ID_DEFAULT;
  return SpreadsheetApp.openById(id);
}
function wtSheet_() {
  var ss = wtSS_();
  var sh = ss.getSheetByName(WT_TAB) || ss.getSheets()[0];
  if (!sh) throw new Error('Work Tickets tab not found');
  return sh;
}
// Header -> column number (1-based). Appends the columns this module writes if missing.
function wtHead_(sh) {
  var lastC = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, lastC).getValues()[0].map(alStr_);
  var missing = WT_EXTRA.filter(function (h) { return head.indexOf(h) < 0; });
  if (missing.length) {
    var need = head.length + missing.length;
    if (sh.getMaxColumns() < need) sh.insertColumnsAfter(sh.getMaxColumns(), need - sh.getMaxColumns());
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing])
      .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#D22730').setVerticalAlignment('middle').setWrap(false);
    head = head.concat(missing);
  }
  var col = {};
  head.forEach(function (h, i) { if (h && col[h] === undefined) col[h] = i + 1; });
  return { head: head, col: col };
}
function wtTrue_(v) { return v === true || alStr_(v).toUpperCase() === 'TRUE'; }
function wtLinks_(v) { return alStr_(v).split(/\n+/).map(alStr_).filter(function (u) { return /^https?:\/\//.test(u); }); }
function wtNum_(v) { var n = parseFloat(alStr_(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? '' : n; }
// "Oct 14, 2026" / "Oct 14, 2026 3:02 PM" as the satellite writes them, or a real Date
function wtDate_(v) { return alDate_(v); }
// Sheets hands back real Date objects for cells it recognised as dates or times; show them the way the form wrote them.
function wtText_(v, fmt) { return (v instanceof Date && !isNaN(v.getTime())) ? Utilities.formatDate(v, AL_TZ, fmt) : alStr_(v); }

// One row -> one ticket object the page renders.
function wtRow_(vals, col, rowNo) {
  function g(h) { return col[h] ? vals[col[h] - 1] : ''; }
  var billedBox = wtTrue_(g('Billed?'));
  var status = alStr_(g('Status'));
  var done = billedBox || status === 'Billed' || status === 'Not billable';
  var doneStatus = status === 'Not billable' ? 'Not billable' : (done ? 'Billed' : '');
  var recv = wtDate_(g('Received'));
  var billedAt = wtDate_(g('Billed At'));
  var assignedAt = wtDate_(g('Assigned At'));
  var fsm = alStr_(g('FSM')).toLowerCase();
  if (fsm && !FSM_ROSTER[fsm]) fsm = afFsmKey_(fsm) || '';
  return {
    _row: rowNo,
    id: alStr_(g('Ticket #')),
    received: alIso_(recv), received_nice: recv ? Utilities.formatDate(recv, AL_TZ, 'MMM d, yyyy h:mm a') : alStr_(g('Received')),
    name: alStr_(g('Submitted By')), company: alStr_(g('Company')), email: alStr_(g('Email')), phone: alStr_(g('Phone')),
    property: alStr_(g('Property')), address: alStr_(g('Address')),
    group: alStr_(g('Property Group')), account: alStr_(g('Account')),
    date: wtText_(g('Date of Work'), 'MMM d, yyyy'), requested_by: alStr_(g('Requested By')),
    task: alStr_(g('Task Type')), desc: alStr_(g('Work Performed')),
    start: wtText_(g('Start'), 'h:mm a'), end: wtText_(g('End'), 'h:mm a'), techs: alStr_(g('Techs')), hours: alStr_(g('Labor Hours')),
    mat: alStr_(g('Materials Purchased')), mat_desc: alStr_(g('Materials List')), mat_cost: wtNum_(g('Materials Cost')),
    receipts: wtLinks_(g('Receipt Links')), photos: wtLinks_(g('Photo Links')),
    pdf: alStr_(g('PDF Link')),   // Oct 18 2026: the full ticket PDF built by the satellite
    work_status: alStr_(g('Work Status')), client_checked: alStr_(g('Client Checked')),
    checked_by: alStr_(g('Checked By')), feedback: alStr_(g('Client Feedback')),
    billing_notes: alStr_(g('Billing Notes')), notes: alStr_(g('Notes')),
    fsm: fsm,
    done: done, done_status: doneStatus,
    billed_by: alStr_(g('Billed By')), billed_at: alIso_(billedAt), billed_nice: alNice_(billedAt), ref: alStr_(g('Billing Ref')),
    assigned_by: alStr_(g('Assigned By')), assigned_at: alIso_(assignedAt), assigned_nice: alNice_(assignedAt)
  };
}

function wtAll_() {
  var sh = wtSheet_();
  var h = wtHead_(sh);
  var last = sh.getLastRow();
  var out = [];
  if (last < 2) return { sh: sh, h: h, tickets: out };
  var vals = sh.getRange(2, 1, last - 1, h.head.length).getValues();
  for (var i = 0; i < vals.length; i++) {
    var t = wtRow_(vals[i], h.col, i + 2);
    if (!t.id) continue;
    out.push(t);
  }
  return { sh: sh, h: h, tickets: out };
}

// Stamp an owner on unbilled tickets that have none, from the customer directory.
// Writes FSM + Account once per ticket so the match never flips later.
function wtStampOwners_(sh, h, tickets) {
  var need = tickets.filter(function (t) { return !t.done && !t.fsm && t.property; });
  if (!need.length) return;
  var idx = null;
  try { idx = afIndex_(); } catch (e) { idx = null; }
  if (!idx || !idx.accts.length) return;
  need.forEach(function (t) {
    var m = null;
    try { m = afMatch_(t.property, '', idx); } catch (e) { m = null; }
    if (!m || !m.acct || !m.acct.fsm) return;
    t.fsm = m.acct.fsm; t.account = m.acct.name;
    try {
      sh.getRange(t._row, h.col['FSM']).setValue(m.acct.fsm);
      if (!alStr_(sh.getRange(t._row, h.col['Account']).getValue())) sh.getRange(t._row, h.col['Account']).setValue(m.acct.name);
    } catch (e) { /* row moved under us: next list stamps it */ }
  });
}

// ------------------------------------------------------------ list -----
function wtList_(d) {
  var all = wtAll_();
  wtStampOwners_(all.sh, all.h, all.tickets);
  var out = all.tickets.filter(function (t) {
    if (!t.done) return true;                       // unbilled: never ages out
    var when = t.billed_at ? new Date(t.billed_at) : (t.received ? new Date(t.received) : null);
    return alFresh_(when, WT_DONE_DAYS);
  });
  out.forEach(function (t) { delete t._row; });
  out.sort(function (a, b) { return (b.received || '').localeCompare(a.received || ''); });
  return { ok: true, tickets: out, roster: alRoster_(), done_days: WT_DONE_DAYS, generated: alIso_(new Date()),
           sheet_url: all.sh.getParent().getUrl() + '#gid=' + all.sh.getSheetId() };
}

// Find a ticket row right now (rows shift when the satellite inserts at the top).
function wtFind_(sh, h, id) {
  var last = sh.getLastRow();
  if (last < 2 || !h.col['Ticket #']) return 0;
  var ids = sh.getRange(2, h.col['Ticket #'], last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (alStr_(ids[i][0]) === id) return i + 2;
  return 0;
}
function wtOne_(sh, h, rowNo) {
  var vals = sh.getRange(rowNo, 1, 1, h.head.length).getValues()[0];
  var t = wtRow_(vals, h.col, rowNo);
  delete t._row;
  return t;
}

// ------------------------------------------------------------ check-off -----
function wtSet_(d) {
  var id = alStr_(d.ticket);
  if (!id) return { ok: false, error: 'No ticket number.' };
  var status = alStr_(d.status);
  if (status && WT_STATUS.indexOf(status) < 0) return { ok: false, error: 'Unknown status ' + status };
  var by = alStr_(d.by).slice(0, 60);
  if (status && !by) return { ok: false, error: 'Pick your name first so the team can see who billed it.' };
  var ref = alStr_(d.ref).slice(0, 80);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = wtSheet_();
    var h = wtHead_(sh);
    var row = wtFind_(sh, h, id);
    if (!row) return { ok: false, error: 'Ticket ' + id + ' is not on the sheet any more.' };
    var now = new Date();
    if (status) {
      sh.getRange(row, 1).setValue(status === 'Billed');       // the Billed? checkbox
      sh.getRange(row, h.col['Status']).setValue(status);
      sh.getRange(row, h.col['Billed By']).setValue(by);
      sh.getRange(row, h.col['Billed At']).setValue(Utilities.formatDate(now, AL_TZ, 'MMM d, yyyy h:mm a'));
      sh.getRange(row, h.col['Billing Ref']).setValue(ref);
    } else {
      // Undo: back to the queue. Keep who undid it in Notes so the trail survives.
      sh.getRange(row, 1).setValue(false);
      sh.getRange(row, h.col['Status']).setValue('New');
      var was = alStr_(sh.getRange(row, h.col['Billed By']).getValue());
      sh.getRange(row, h.col['Billed By']).setValue('');
      sh.getRange(row, h.col['Billed At']).setValue('');
      sh.getRange(row, h.col['Billing Ref']).setValue('');
      if (h.col['Notes']) {
        var prev = alStr_(sh.getRange(row, h.col['Notes']).getValue());
        sh.getRange(row, h.col['Notes']).setValue((prev ? prev + ' | ' : '') + 'Reopened by ' + (by || 'someone') + ' ' + alNice_(now) + (was ? ' (was billed by ' + was + ')' : ''));
      }
    }
    return { ok: true, ticket: wtOne_(sh, h, row) };
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------ reassign -----
function wtAssign_(d) {
  var id = alStr_(d.ticket);
  if (!id) return { ok: false, error: 'No ticket number.' };
  var fsm = alStr_(d.fsm).toLowerCase();
  if (fsm && !FSM_ROSTER[fsm]) return { ok: false, error: 'Unknown FSM ' + fsm };
  var by = alStr_(d.by).slice(0, 60);
  if (!by) return { ok: false, error: 'Pick your name first.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = wtSheet_();
    var h = wtHead_(sh);
    var row = wtFind_(sh, h, id);
    if (!row) return { ok: false, error: 'Ticket ' + id + ' is not on the sheet any more.' };
    sh.getRange(row, h.col['FSM']).setValue(fsm);
    sh.getRange(row, h.col['Assigned By']).setValue(by);
    sh.getRange(row, h.col['Assigned At']).setValue(Utilities.formatDate(new Date(), AL_TZ, 'MMM d, yyyy h:mm a'));
    return { ok: true, ticket: wtOne_(sh, h, row) };
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------ alerts card -----
// Oct 18 2026: one line PER TICKET on the Ops Hub Alerts card (was one rolled-up line per
// FSM). Each carries the supplies answer, the receipt count and the PDF link, so the FSM
// sees "Supplies bought: YES $84.50, 2 receipts" or "Supplies bought: NO" without opening
// anything. No status buttons: the billed check-off still happens on work-tickets.html,
// by name. Reassign on the card goes through wt_assign so the queue and the card agree.
function wtAlertItems_() {
  var items = [];
  var all;
  try { all = wtAll_(); } catch (e) { return items; }
  try { wtStampOwners_(all.sh, all.h, all.tickets); } catch (e) {}
  all.tickets.forEach(function (t) {
    if (t.done) return;
    var k = t.fsm || '';
    var region = k && FSM_ROSTER[k] ? FSM_ROSTER[k].region : '';
    var bits = [];
    if (t.task) bits.push(t.task);
    if (t.hours) bits.push(t.hours + (String(t.hours) === '1' ? ' hour' : ' hours'));
    if (t.work_status) bits.push(t.work_status);
    items.push({
      key: 'wt:' + t.id, type: 'ticket',
      fsm: k, region: /&/.test(region) ? '' : region,
      when: t.received, when_nice: t.received_nice,
      from: t.name + (t.company ? ', ' + t.company : ''),
      about: t.property,
      summary: bits.join('. ') + (bits.length ? '.' : ''),
      ticket: t.id, date: t.date, hours: t.hours, techs: t.techs, requested_by: t.requested_by,
      mat: t.mat, mat_cost: t.mat_cost, mat_desc: t.mat_desc, receipts: (t.receipts || []).length,
      pdf: t.pdf, acct_name: t.account, address: t.address,
      email: t.email, phone: t.phone,
      count: 1,
      link: 'work-tickets.html?fsm=' + (k || 'none') + '#' + encodeURIComponent(t.id),
      ref: t.id
    });
  });
  return items;
}
