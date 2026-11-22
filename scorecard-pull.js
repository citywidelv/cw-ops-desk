// City Wide Nevada FSM scorecard pull. Build 2026-11-21.
// Run on a signed-in tab at https://gocitywide.crm.dynamics.com/api/data/v9.2/WhoAmI.
// Las Vegas runs in CW LV's Chrome (CRM user Joshua Smith), Northern Nevada in NNV Chrome. Send ONE javascript call:
//   window.SCFG = { market:'lv', fsms:['Brett Stephens','Alejandro Manon','Jake Schmidt','Robert Krause'], mStart:'2026-11-01', asOf:'2026-11-21',
//     cfg:{ people:[{name:'Brett Stephens',label:'Brett Stephens',role:'FSM',order:1,goal:{type:'flat',amount:65000}}, ...], holidays:['2026-11-11','2026-11-26'] } };
// cfg is passed through untouched; the Ops Hub uses it for display names, goals, order and business-day pace.
// followed by this whole file. The result is written into the page as JSON between SCSTART and
// SCEND; read it with get_page_text. Definitions match the weekly report engine (crm_pull.js):
// OS done = work orders completed in the month (Completed or Posted) at subtotal, credited to the
// quote owner when that owner is an FSM, otherwise to the FSM on the service account. OS open =
// OS quotes won in the month by an FSM with no completed work order yet. Inspections follow the
// Operations Dashboard helper columns. Lines are the work order service lines of those work orders.
await (async () => {
const C = window.SCFG;
const B = '/api/data/v9.2/';
const H = { 'Accept': 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0', 'Prefer': 'odata.include-annotations="*",odata.maxpagesize=5000' };
const FV = '@OData.Community.Display.V1.FormattedValue';
const get = async p => { const r = await fetch(B + p, { headers: H, credentials: 'include' }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j; };
const all = async p => { let out = [], u = B + p; while (u) { const r = await fetch(u, { headers: H, credentials: 'include' }); const j = await r.json(); if (j.error) throw new Error(j.error.message); out = out.concat(j.value); u = j['@odata.nextLink']; } return out; };
const fx = async (set, xml) => {
let out = [], page = 1, cookie = null;
for (;;) {
const ck = cookie ? ` paging-cookie="${cookie.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}"` : '';
const j = await get(`${set}?fetchXml=${encodeURIComponent(xml.replace('<fetch', `<fetch page="${page}" count="5000"${ck}`))}`);
out = out.concat(j.value);
if (!j['@Microsoft.Dynamics.CRM.morerecords']) break;
cookie = decodeURIComponent(decodeURIComponent(j['@Microsoft.Dynamics.CRM.fetchxmlpagingcookie'].match(/pagingcookie="([^"]*)"/)[1]));
page++;
}
return out;
};
const local = s => new Date(s + 'T00:00:00');
const ymd = d => { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const utc = d => new Date(d).toISOString();
const mS = local(C.mStart).getTime(), asOfT = local(C.asOf).getTime(), endT = asOfT + 864e5;
const cl = (s, n) => String(s || '').replace(/[\n\r​]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const who = await get('WhoAmI');
const me = await get(`systemusers(${who.UserId})?$select=fullname`);
const users = await all(`systemusers?$select=fullname,systemuserid,isdisabled&$filter=` + C.fsms.map(n => `fullname eq '${n.replace(/'/g, "''")}'`).join(' or '));
const U = {}; users.sort((a, b) => (a.isdisabled ? 1 : 0) - (b.isdisabled ? 1 : 0)).forEach(u => { if (!U[u.fullname]) U[u.fullname] = u.systemuserid; });
const inv = {}; Object.entries(U).forEach(([n, i]) => inv[i] = n);
const F = {}; C.fsms.forEach(f => F[f] = { osDone: 0, osOpen: 0, route: 0, accts: 0, insDue: 0, insCred: 0, insBehind: 0 });

// ---- work orders completed this month
const WOC = await all(`msdyn_workorders?$select=msdyn_name,msdyn_completedon,msdyn_subtotalamount,_cwm_originatingquote_value,_msdyn_serviceaccount_value&$filter=msdyn_completedon ge ${utc(local(C.mStart))} and msdyn_completedon lt ${utc(new Date(endT))} and (msdyn_systemstatus eq 690970003 or msdyn_systemstatus eq 690970004)`);
const wAcc = [...new Set(WOC.map(w => w._msdyn_serviceaccount_value).filter(Boolean))], AF = {}, AN = {};
for (let i = 0; i < wAcc.length; i += 40) (await all(`accounts?$select=name,_cwm_fsm_value&$filter=` + wAcc.slice(i, i + 40).map(a => `accountid eq ${a}`).join(' or '))).forEach(a => { AF[a.accountid] = a['_cwm_fsm_value' + FV] || ''; AN[a.accountid] = a.name || ''; });
const wQ = [...new Set(WOC.map(w => w._cwm_originatingquote_value).filter(Boolean))], WQ = {};
for (let i = 0; i < wQ.length; i += 40) (await all(`quotes?$select=quotenumber,_ownerid_value&$filter=` + wQ.slice(i, i + 40).map(q => `quoteid eq ${q}`).join(' or '))).forEach(q => WQ[q.quoteid] = q);
const woFsm = {}, woInfo = {};
WOC.forEach(w => {
const q = WQ[w._cwm_originatingquote_value], qo = q ? q['_ownerid_value' + FV] : '';
const f = C.fsms.includes(qo) ? qo : AF[w._msdyn_serviceaccount_value];
if (!C.fsms.includes(f)) return;
woFsm[w.msdyn_workorderid] = f; woInfo[w.msdyn_workorderid] = { acct: AN[w._msdyn_serviceaccount_value] || '', d: ymd(w.msdyn_completedon).slice(5) };
if (w.msdyn_subtotalamount > 0) F[f].osDone += w.msdyn_subtotalamount;
});
// ---- service lines on those work orders: billed, cost, vendor
const SV = await all(`msdyn_workorderservices?$select=msdyn_name,msdyn_totalamount,msdyn_totalcost,_cwm_independentcontractor_value,_msdyn_workorder_value&$filter=msdyn_workorder/msdyn_completedon ge ${utc(local(C.mStart))} and msdyn_workorder/msdyn_completedon lt ${utc(new Date(endT))}`);
const lines = [];
SV.forEach(l => { const f = woFsm[l._msdyn_workorder_value]; if (!f) return; const i = woInfo[l._msdyn_workorder_value];
lines.push([i.d, f, cl(i.acct, 44), cl(l.msdyn_name, 34), Math.round(l.msdyn_totalamount || 0), Math.round(l.msdyn_totalcost || 0), cl(l['_cwm_independentcontractor_value' + FV], 32)]); });
// ---- OS quotes won this month by an FSM, not completed yet
const ids = Object.values(U), doneQ = new Set(wQ);
if (ids.length) {
const Q = await all(`quotes?$select=quoteid,closedon,totalamount,_ownerid_value&$filter=cwm_quotetype eq 2 and statecode eq 2 and closedon ge ${C.mStart} and closedon le ${C.asOf} and (` + ids.map(i => `_ownerid_value eq ${i}`).join(' or ') + ')');
Q.forEach(x => { const n = inv[x._ownerid_value]; if (!n || !F[n] || doneQ.has(x.quoteid)) return; F[n].osOpen += x.totalamount || 0; });
}
// ---- route and inspections (Operations Dashboard rules, full-month expectation)
const AGI = await fx('cwm_agreementheaders', `<fetch distinct="true"><entity name="cwm_agreementheader"><attribute name="cwm_agreementheaderid"/><attribute name="cwm_agreementstartdate"/><attribute name="cwm_accountname"/><attribute name="cwm_fsm"/><attribute name="cwm_totalagreementprice"/><attribute name="cwm_invoicefrequency"/><filter type="and"><condition attribute="statecode" operator="eq" value="0"/><condition attribute="statuscode" operator="eq" value="1"/><condition attribute="cwm_agreementstartdate" operator="olderthan-x-days" value="1"/></filter><link-entity name="account" from="accountid" to="cwm_accountname" link-type="outer" alias="acc"><attribute name="cwm_inspectionfrequency"/></link-entity></entity></fetch>`);
const INS = await all(`cwm_inspections?$select=cwm_dateofinspection,_regardingobjectid_value&$filter=cwm_dateofinspection ge ${utc(local(C.mStart))} and statecode ne 2`);
const cnt = {}; INS.forEach(i => { const t = new Date(i.cwm_dateofinspection).getTime(); if (t >= mS && t < endT) cnt[i._regardingobjectid_value] = (cnt[i._regardingobjectid_value] || 0) + 1; });
const seen = new Set(), mEnd = new Date(local(C.asOf).getFullYear(), local(C.asOf).getMonth() + 1, 0).getTime();
AGI.forEach(a => {
const f = a['_cwm_fsm_value' + FV] || ''; if (!F[f]) return; const o = F[f];
if (a.cwm_invoicefrequency === 122190001) o.route += a.cwm_totalagreementprice || 0;
const id = a._cwm_accountname_value; if (seen.has(id)) return; seen.add(id); o.accts++;
const st = new Date(a.cwm_agreementstartdate); st.setHours(0, 0, 0, 0);
const fr = a['acc.cwm_inspectionfrequency'];
const ex = days => days === 0 ? 0 : fr === 771610000 ? Math.floor(days / 7) : fr === 771610001 ? Math.floor(days / 14) : fr === 771610002 ? 1 : fr === 771610003 ? 0.33 : 0;
const c = cnt[id] || 0;
const e = ex(Math.max(0, Math.round((asOfT - Math.max(st.getTime(), mS)) / 864e5) + 1));
const eM = ex(Math.max(0, Math.round((mEnd - Math.max(st.getTime(), mS)) / 864e5) + 1));
o.insDue += eM; o.insCred += Math.min(eM, c); if (e - c >= 1) o.insBehind++;
});
Object.values(F).forEach(o => { o.osDone = Math.round(o.osDone); o.osOpen = Math.round(o.osOpen); o.route = Math.round(o.route); o.insDue = Math.round(o.insDue * 10) / 10; o.insCred = Math.round(o.insCred * 10) / 10; });
const out = { market: C.market, mStart: C.mStart, asOf: C.asOf, pulled: new Date().toISOString(), crmUser: me.fullname, cfg: C.cfg || null, fsms: F, lines: lines };
window.name = JSON.stringify(out); // survives the tab navigating to the Ops Hub, where it is posted with sc_put
document.body.innerHTML = ''; const a = document.createElement('article'); a.style.whiteSpace = 'pre-wrap'; a.textContent = 'SCSTART' + JSON.stringify(out) + 'SCEND'; document.body.appendChild(a);
return 'user ' + me.fullname + ' | work orders ' + WOC.length + ' | lines ' + lines.length + ' | agreements ' + AGI.length + ' | inspections ' + INS.length;
})();
