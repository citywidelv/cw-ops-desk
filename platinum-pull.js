/* platinum-pull.js (Nov 28 2026). Road to Platinum helper for the FSM Scorecard Morning Refresh.
   Runs inside a signed-in Business Central tab (CW LV's Chrome). The task navigates the tab to one
   list page at a time and then calls one of these. Nothing here navigates, writes or posts.

   Definition (checked against the franchisor's Platinum Club Standings, Nov 2026):
     revenue = posted sales invoices (Amount, before tax)
             - posted sales credit memos (Amount)
             + G/L entries on 21800 Deferred Revenue for sales documents (deposits count when billed, not when invoiced)
             excluding customers marked Out of Territory in the CRM (cwm_outofterritory)
     rpc growth = (recent 12 months - prior 12 months) / territory population

   Use:
     window.CW_PLAT.list(['No.','Customer Name','Posting Date','Amount'])   -> raw rows of the list on screen
     window.CW_PLAT.invoices(OOT)      page 143 -> {rows,total,oot,days:{YYYY-MM-DD:[total,oot]}}
     window.CW_PLAT.creditMemos(OOT)   page 144 -> {rows,total,oot}            (dates are not on screen; filter by URL range)
     window.CW_PLAT.deferred()         page 20 filtered to 21800 -> {rows,adj,days:{YYYY-MM-DD:adj}} sales documents only
   OOT is an array of exact BC customer names. Amounts come back as numbers rounded to cents. */
(function () {
  function num(s) { return parseFloat(String(s || '0').replace(/[,$]/g, '')) || 0; }
  function r2(x) { return Math.round(x * 100) / 100; }
  function iso(us) { var p = String(us || '').split('/'); return p.length === 3 ? p[2] + '-' + p[0].padStart(2, '0') + '-' + p[1].padStart(2, '0') : ''; }
  async function list(fields) {
    var d = document.querySelector('iframe').contentDocument;
    var ts = Array.prototype.slice.call(d.querySelectorAll('table'));
    var t = ts[1]; var p = t;
    while (p && !(p.scrollHeight > p.clientHeight + 5 && getComputedStyle(p).overflowY != 'visible')) p = p.parentElement;
    var H = Array.prototype.map.call(ts[0].querySelectorAll('th'), function (h) { return h.innerText.trim().replace(/\n/g, ' '); });
    var F = fields.map(function (n) { return H.indexOf(n); });
    if (F.some(function (i) { return i < 0; })) throw new Error('missing column ' + fields[F.findIndex(function (i) { return i < 0; })]);
    var seen = new Map();
    if (p) p.scrollTop = 0;
    await new Promise(function (r) { setTimeout(r, 800); });
    for (var k = 0; k < 900; k++) {
      Array.prototype.forEach.call(t.rows, function (row) {
        var c = Array.prototype.map.call(row.cells, function (x) { return x.innerText.trim(); });
        var key = c[F[0]];
        if (key) seen.set(key + '|' + c[F[1]] + '|' + c[F[2]], F.map(function (i) { return c[i] || ''; }));
      });
      window.__plat_progress = 'rows ' + seen.size + ' step ' + k;
      if (!p || p.scrollTop + p.clientHeight >= p.scrollHeight - 2) break;
      p.scrollTop += p.clientHeight - 40;
      await new Promise(function (r) { setTimeout(r, 400); });
    }
    return Array.from(seen.values());
  }
  async function invoices(OOT) {
    OOT = OOT || [];
    var v = await list(['No.', 'Customer Name', 'Posting Date', 'Amount']);
    var R = { rows: v.length, total: 0, oot: 0, days: {} };
    v.forEach(function (x) {
      var a = num(x[3]), day = iso(x[2]), o = OOT.indexOf(x[1]) >= 0;
      R.total += a; if (o) R.oot += a;
      var dd = R.days[day] || [0, 0]; dd[0] = r2(dd[0] + a); if (o) dd[1] = r2(dd[1] + a); R.days[day] = dd;
    });
    R.total = r2(R.total); R.oot = r2(R.oot);
    return R;
  }
  async function creditMemos(OOT) {
    OOT = OOT || [];
    var v = await list(['No.', 'Customer Name', 'Amount']);
    var R = { rows: v.length, total: 0, oot: 0 };
    v.forEach(function (x) { var a = num(x[2]); R.total += a; if (OOT.indexOf(x[1]) >= 0) R.oot += a; });
    R.total = r2(R.total); R.oot = r2(R.oot);
    return R;
  }
  async function deferred() {
    var v = await list(['Document No.', 'Amount ($)', 'Posting Date', 'Document Type']);
    var R = { rows: 0, adj: 0, days: {} };
    v.forEach(function (x) {
      if (!/^\d{11}$/.test(x[0])) return;              /* sales documents only; PCM journal entries are cash, not revenue */
      if (x[3] !== 'Invoice' && x[3] !== 'Credit Memo') return;
      var a = num(x[1]), day = iso(x[2]);
      R.rows++; R.adj = r2(R.adj + a); R.days[day] = r2((R.days[day] || 0) + a);
    });
    return R;
  }
  window.CW_PLAT = { list: list, invoices: invoices, creditMemos: creditMemos, deferred: deferred, version: '2026-11-28' };
})();
