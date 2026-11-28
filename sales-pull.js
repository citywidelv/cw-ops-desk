// City Wide Nevada Sales Hub scorecard pull. Build 2026-11-28.
// Run on a signed-in tab at https://gocitywide.crm.dynamics.com/api/data/v9.2/WhoAmI.
// Las Vegas runs in CW LV's Chrome, Northern Nevada in NNV Chrome. Send ONE javascript call:
//   window.SALESCFG = { market:'lv', people:['Scott Obst', ...], asOf:'2026-11-27', skipDays:['2026-11-26'], uniqBs:['Josh McElhinny'] };
// followed by this whole file. The result is written into the page as JSON between SCSTART and SCEND
// and into window.name, which survives navigating the tab to the Sales Hub, where it is posted with sc_put.
//
// Definitions are copied from the weekly sales report engine (crm_pull.js), so the hub and the weekly
// report always agree:
//   Activities = completed emails, phone calls and field visits, by actual end. Weeks run Monday to Sunday, 13 weeks.
//   Appointments = Building Survey Appointment category appointments by created date, not canceled.
//   Proposals = completed Proposal Delivery appointments by scheduled start. $ proposed is their Amount Proposed.
//   JS won and lost = quotes that are not OS type, by closed date, at JS monthly agreement value.
//   Started business = monthly-invoiced agreements (Active, Pending, Setup Complete) by start date, at total
//     agreement price, credited to the owner of the agreement's quote.
//   Pipeline = every open JS quote by estimated start date. This pull also lists each open quote.
// Two rules TJ set for the weekly report are applied here in code instead of by hand:
//   skipDays: activities logged on a sales holiday are not counted (Nov 27 2026).
//   uniqBs: for the people named, a building survey counts once per account (Josh, Nov 13 2026).
// people must be the same list the weekly report uses for the market (sellers, FSMs and marketing), because
// started business for the market counts every one of them. No goals and no names live in this file.
await (async () => {
  const C = window.SALESCFG;
  const B = '/api/data/v9.2/';
  const H = { 'Accept': 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0',
              'Prefer': 'odata.include-annotations="*",odata.maxpagesize=5000' };
  const FV = '@OData.Community.Display.V1.FormattedValue';
  const get = async p => { const r = await fetch(B + p, { headers: H, credentials: 'include' }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j; };
  const all = async p => { let out = [], u = B + p; while (u) { const r = await fetch(u, { headers: H, credentials: 'include' }); const j = await r.json(); if (j.error) throw new Error(j.error.message); out = out.concat(j.value); u = j['@odata.nextLink']; } return out; };
  const local = s => new Date(s + 'T00:00:00');               // local midnight
  const ymd = d => { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const utc = d => new Date(d).toISOString();
  const cl = (s, n) => String(s || '').replace(/[\n\r​]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

  // ---- dates. Everything follows from asOf unless it is passed in.
  const A = local(C.asOf);
  C.nw = C.nw || 13;
  C.mStart = C.mStart || ymd(new Date(A.getFullYear(), A.getMonth(), 1));
  if (!C.w0) { const mon = new Date(A); mon.setDate(A.getDate() - ((A.getDay() + 6) % 7)); mon.setDate(mon.getDate() - 7 * (C.nw - 1)); C.w0 = ymd(mon); }
  const q0 = Math.floor(A.getMonth() / 3) * 3;
  C.startedFrom = C.startedFrom || ymd(new Date(A.getFullYear(), q0, 1));
  if (!C.startedTo) { const qEnd = new Date(A.getFullYear(), q0 + 3, 0), nEnd = new Date(A.getFullYear(), A.getMonth() + 2, 0); C.startedTo = ymd(qEnd > nEnd ? qEnd : nEnd); }
  const skip = new Set(C.skipDays || []), uniq = new Set(C.uniqBs || []);
  const t0 = local(C.w0).getTime(), mS = local(C.mStart).getTime();
  const endT = A.getTime() + 864e5;                          // exclusive
  const W0 = utc(local(C.w0));

  const who = await get('WhoAmI');
  const me = await get(`systemusers(${who.UserId})?$select=fullname`);

  // ---- people
  const users = await all(`systemusers?$select=fullname,systemuserid,isdisabled&$filter=` + C.people.map(n => `fullname eq '${n.replace(/'/g, "''")}'`).join(' or '));
  const U = {};
  users.sort((a, b) => (a.isdisabled ? 1 : 0) - (b.isdisabled ? 1 : 0)).forEach(u => { if (!U[u.fullname]) U[u.fullname] = u.systemuserid; });
  const inv = {}; Object.entries(U).forEach(([n, i]) => inv[i] = n);
  const ids = Object.values(U);
  if (!ids.length) throw new Error('none of the people were found in this CRM');
  const own = '(' + ids.map(i => `_ownerid_value eq ${i}`).join(' or ') + ')';

  // ---- weekly / month buckets
  const P = {};
  const add = (o, key, d, v) => {
    const n = inv[o]; if (!n || !d) return;
    const t = (/^\d{4}-\d{2}-\d{2}$/.test(d) ? local(d) : new Date(d)).getTime(); if (t >= endT) return;   // date-only fields are local dates
    const p = P[n] = P[n] || {};
    const w = Math.floor((t - t0) / 604800000);
    if (w >= 0 && w < C.nw) { (p['w_' + key] = p['w_' + key] || Array(C.nw).fill(0))[w] += v; if (w === C.nw - 1) p['lw_' + key] = (p['lw_' + key] || 0) + v; }
    if (t >= mS) p['m_' + key] = (p['m_' + key] || 0) + v;
  };

  // Activities = completed emails, phone calls and field visits, by actual end
  const acts = await all(`activitypointers?$select=activitytypecode,actualend,_ownerid_value&$filter=statecode eq 1 and actualend ge ${W0} and ${own}`);
  let skipped = 0;
  acts.forEach(a => {
    const t = a.activitytypecode;
    if (!['email', 'phonecall', 'cwm_fieldvisit'].includes(t)) return;
    if (a.actualend && skip.has(ymd(a.actualend))) { skipped++; return; }
    add(a._ownerid_value, 'act', a.actualend, 1);
    if (t === 'phonecall') add(a._ownerid_value, 'call', a.actualend, 1);
    if (t === 'cwm_fieldvisit') add(a._ownerid_value, 'fv', a.actualend, 1);
  });
  // Appointments = Building Survey appointments by created date (not cancelled)
  // Proposals = completed Proposal Delivery appointments by scheduled start, $ = Amount Proposed
  const BS = '0c8d5d22-d253-ef11-a317-6045bdff1835', PD = '90633f84-bb5b-ef11-a317-7c1e52023f04';
  const ap = await all(`appointments?$select=_cwm_activitycategory_value,createdon,scheduledstart,statecode,cwm_amtproposed,_ownerid_value,_regardingobjectid_value&$filter=(createdon ge ${W0} or scheduledstart ge ${W0}) and ${own}`);
  const dup = new Set(), once = new Set();   // same owner + account + day (+ amount) logged twice counts once
  ap.slice().sort((a, b) => String(a.createdon).localeCompare(String(b.createdon))).forEach(a => {
    const c = a._cwm_activitycategory_value;
    const dk = [a._ownerid_value, c, a._regardingobjectid_value, ymd(c === PD ? a.scheduledstart : a.createdon), a.cwm_amtproposed || 0].join('|');
    if (a._regardingobjectid_value && dup.has(dk)) return; dup.add(dk);
    if (c === BS && a.statecode !== 2) {
      if (uniq.has(inv[a._ownerid_value]) && a._regardingobjectid_value) { const k = a._ownerid_value + '|' + a._regardingobjectid_value; if (once.has(k)) return; once.add(k); }
      add(a._ownerid_value, 'bs', a.createdon, 1);
    }
    if (c === PD && a.statecode === 1) { add(a._ownerid_value, 'prop', a.scheduledstart, 1); add(a._ownerid_value, 'propd', a.scheduledstart, a.cwm_amtproposed || 0); }
  });
  // Quotes. OS = quote type 2. JS = every other type (JS, Both, blank), monthly agreement value.
  // Won = state Won, Lost = status Lost, both by closed-on date.
  const Q = await all(`quotes?$select=quoteid,name,quotenumber,cwm_quotetype,statecode,statuscode,closedon,totalamount,cwm_jsmonthlyagreementvalue,_ownerid_value,_customerid_value,cwm_eststartdate&$filter=(modifiedon ge ${W0} or statecode eq 0 or statecode eq 1) and ${own}`);
  Q.forEach(x => {
    const ty = x.cwm_quotetype, s = x.statecode, d = x.closedon; if (!d) return;
    const lost = s === 3 && x.statuscode === 5;
    if (ty !== 2 && s === 2) { add(x._ownerid_value, 'jsWon', d, 1); add(x._ownerid_value, 'jsWond', d, x.cwm_jsmonthlyagreementvalue || 0); }
    if (ty !== 2 && lost) add(x._ownerid_value, 'jsLost', d, 1);
  });
  for (const p of Object.values(P)) for (const k in p) p[k] = typeof p[k] === 'number' ? Math.round(p[k]) : p[k].map(Math.round);

  // ---- open JS pipeline by estimated start (past due = est start before as-of date), with one row per quote
  const pipe = {}, quotes = [];
  const asOfT = A.getTime();
  Q.filter(x => (x.statecode === 0 || x.statecode === 1) && x.cwm_quotetype !== 2).forEach(x => {
    const n = inv[x._ownerid_value]; if (!n) return;
    const ed = x.cwm_eststartdate ? x.cwm_eststartdate.slice(0, 10) : null;
    const days = ed ? (local(ed).getTime() - asOfT) / 864e5 : null;
    const b = ed == null ? 'nodate' : days < 0 ? 'pastdue' : days <= 30 ? 'd30' : days <= 90 ? 'd90' : 'later';
    const c = (pipe[n] = pipe[n] || {})[b] = (pipe[n][b] || [0, 0]); c[0]++; c[1] += x.cwm_jsmonthlyagreementvalue || 0;
    quotes.push([n, cl(x['_customerid_value' + FV] || x.name, 48), b, ed || '', Math.round(x.cwm_jsmonthlyagreementvalue || 0)]);
  });
  for (const p of Object.values(pipe)) for (const c of Object.values(p)) c[1] = Math.round(c[1]);

  // ---- started business: monthly-invoiced agreements (Active, Pending, Setup Complete) starting in the window,
  //      at current total agreement price, credited to the owner of the agreement's quote
  const ag = await all(`cwm_agreementheaders?$select=cwm_agreementstartdate,cwm_totalagreementprice,cwm_invoicefrequency,statuscode,_cwm_quote_value,_cwm_accountname_value&$filter=cwm_agreementstartdate ge ${C.startedFrom} and cwm_agreementstartdate le ${C.startedTo} and cwm_invoicefrequency eq 122190001 and (statuscode eq 1 or statuscode eq 771610001 or statuscode eq 771610002)`);
  const qids = [...new Set(ag.map(a => a._cwm_quote_value).filter(Boolean))];
  const QQ = {};
  for (let i = 0; i < qids.length; i += 40) (await all(`quotes?$select=_ownerid_value,cwm_quotetype&$filter=` + qids.slice(i, i + 40).map(q => `quoteid eq ${q}`).join(' or '))).forEach(q => QQ[q.quoteid] = q);
  const started = [];
  ag.forEach(a => {
    const q = QQ[a._cwm_quote_value]; if (!q) return;
    const n = q['_ownerid_value' + FV]; if (!C.people.includes(n)) return;
    started.push([n, cl(a['_cwm_accountname_value' + FV], 60), Math.round((a.cwm_totalagreementprice || 0) * 100) / 100, ymd(a.cwm_agreementstartdate), q['cwm_quotetype' + FV] || 'JS', a['statuscode' + FV]]);
  });

  const out = { market: C.market, mStart: C.mStart, asOf: C.asOf, w0: C.w0, nw: C.nw, startedFrom: C.startedFrom, startedTo: C.startedTo,
    pulled: new Date().toISOString(), crmUser: me.fullname, people: C.people, found: Object.keys(U), skipDays: [...skip], skipped, P, pipe, quotes, started };
  window.name = JSON.stringify(out);
  document.body.innerHTML = ''; const el = document.createElement('article'); el.style.whiteSpace = 'pre-wrap'; el.textContent = 'SCSTART' + JSON.stringify(out) + 'SCEND'; document.body.appendChild(el);
  return 'user ' + me.fullname + ' | people ' + Object.keys(U).length + ' of ' + C.people.length + ' | activities ' + acts.length + ' | appointments ' + ap.length + ' | quotes ' + Q.length + ' | open ' + quotes.length + ' | started ' + started.length;
})();
