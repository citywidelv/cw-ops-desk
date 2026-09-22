/* CW Ops Hub: Email Vendors panel (build 2026-09-21a: Open in mail app fallback beside Schedule and Send)
   Shared by post.html (right after a posting goes live) and postings.html
   (any open posting). Pulls the live Vendor Directory (vd_list), matches
   vendors to the posting's region and trade, and sends a short branded HTML
   email through the company Gmail (kind vm_queue, CW Vendor Sender script). Every
   send is logged on the Vendor Messages tab.

   Fallback (TJ, Sep 21 2026): when the hub sender is down, "Open in mail app"
   opens the same email in the sender's own mail app (Outlook, Apple Mail) with
   To = the office mailbox and every checked vendor in BCC, split into batches
   because mail apps cap how long a mailto link can be. Plain text, no logo,
   and nothing is logged on the hub, so the Emailed tags do not update.

   Rule from TJ: vendors are ALWAYS blind copied. The To line is the office
   mailbox. No path here puts a vendor in To or CC. Do not add one.

   The email is deliberately short: a new opportunity, the trade, the industry,
   the area of town, and one red button to the posting. No pay, no size.

   Lists shown, always for the posting's region only:
     1. Matched to the trade: Active vendors + Potential vendors, open, NOT
        pre-checked. The sender checks who gets it, or uses "Pick next 50".
     2. Every other service type in the directory, one group per type, built
        from the live Service Types tab (plus any slug a vendor row carries that
        the tab does not list yet), so new types appear with no code change.
   A vendor tagged with several types appears in each group; checking or
   unchecking them anywhere flips every copy, and the BCC list is deduped.

   One click, any size list: the page posts vm_queue with everyone checked and
   the script works through the list on a timer, 20 vendors per email every 10
   minutes, inside the day's Gmail allowance (VendorMessages.gs, Queue section).
   Who already got a posting comes back from vm_queue_status, so the "Emailed"
   and "Scheduled" tags are shared by the whole team, and the server refuses to
   queue the same vendor twice for one posting.

   The red button: vm_send turns a line written as "Words: https://link",
   alone in its own paragraph, into a button. buildEmail writes one.

   Usage: CWNotify.render(containerEl, posting, passcode)
   posting needs: id, region, trade, title, facility_type, area, contact_name
*/
(function (w) {
  var WEBHOOK = "https://script.google.com/macros/s/AKfycbzfNnrpidCbWB1DeUNgXvRhDFMQgApfpn-3C9GU45wMEHcJpWFl8ZQVo6PUBSRfEVfRdg/exec";
  var HUB = "https://citywidelv.github.io/cw-vendor-hub/";
  // CW Vendor Sender: standalone script owned by citywidenv@cwfs-nv.com. Vendor email sends from that mailbox, not the old Gmail.
  var SEND_WEBHOOK = "https://script.google.com/macros/s/AKfycbx5bqTwNq4_DFNXR1Z4mCAzMZ5GZzgmUFphrjvJYGXQ5DRpTtgjaaq7MFvapE9pCSMiOQ/exec";
  var OPT_OUT = "To stop these emails, reply and ask to be taken off our lists. You will stop hearing about new work. Notices about buildings you hold will still come to this address. A vendor we cannot reach by email cannot stay active with City Wide.";
  var LOGO = "https://emailer.emfluence.com/clients/citywide/uploadedfiles/signature_logo.png";
  var BATCH_MAX = 50, CHUNK = 20;   // must match VM_BATCH_MAX / VM_CHUNK in VendorMessages.gs
  var MAILTO_MAX = 1800;            // longest mailto: link that Outlook and Apple Mail open reliably
  var OPT_OUT_SHORT = "To stop these emails, reply and ask to be taken off our lists.";
  var SENDERS = {
    lv:  { name: "City Wide of Las Vegas",       reply: "lvservicecall@gocitywide.com", foot: "City Wide Facility Solutions of Las Vegas, 3215 W Charleston Blvd, Suite 130, Las Vegas, NV 89102" },
    nnv: { name: "City Wide of Northern Nevada", reply: "rnservicecall@gocitywide.com", foot: "City Wide Facility Solutions of Northern Nevada, 1000 Bible Way, Suite 2, Reno, NV 89502" }
  };

  // Posting trade (post.html select text) -> Vendor Directory service slugs.
  // Janitorial and Day Porter share the cleaning pool (TJ, Sep 4 2026).
  var TRADE_SLUGS = {
    "janitorial": ["janitorial", "day-porter"],
    "day porter": ["janitorial", "day-porter"],
    "floor care": ["floor-care"],
    "carpet cleaning": ["floor-care"],
    "tile & grout": ["floor-care"],
    "upholstery cleaning": ["floor-care"],
    "window cleaning": ["window-cleaning"],
    "high dusting": ["janitorial", "window-cleaning"],
    "duct & vent": ["hvac"],
    "post-construction": ["janitorial"],
    "specialty": ["janitorial"],
    "pressure washing": ["pressure-washing"],
    "landscaping": ["landscaping"],
    "tree trimming": ["landscaping"],
    "snow removal": ["snow-removal"],
    "parking lot": ["parking-lot"],
    "street sweeping": ["parking-lot"],
    "graffiti": ["pressure-washing", "painting"],
    "solar panel": ["window-cleaning", "pressure-washing"],
    "trash bin": ["pressure-washing", "waste"],
    "handyman": ["handyman"],
    "flooring installation": ["construction", "handyman"],
    "painting": ["painting"],
    "pest control": ["pest-control"],
    "hvac": ["hvac"],
    "plumbing": ["plumbing"],
    "electrical": ["electrical"],
    "junk removal": ["waste"],
    "water / flood": ["restoration"],
    "security": ["security"]
  };
  var CSS = ".cwn{background:#fff;border:1px solid #E5E5E5;border-radius:12px;padding:20px;text-align:left;margin-top:16px;font-size:13.5px;color:#2D2A26;line-height:1.5}" +
    ".cwn h3{font-size:15px;margin:0 0 4px}.cwn .sub{font-size:12.5px;color:#636466;margin-bottom:12px}" +
    ".cwn h4{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#636466;margin:16px 0 8px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}" +
    ".cwn h4 .lk{margin-left:auto}" +
    ".cwn .tools{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:10px 0 4px}" +
    ".cwn input[type=search]{font-family:inherit;font-size:13px;border:1.5px solid #E5E5E5;border-radius:20px;padding:8px 14px;min-width:240px;flex:1}" +
    ".cwn .grp{border:1px solid #E5E5E5;border-radius:10px;margin-bottom:10px;overflow:hidden;background:#fff}" +
    ".cwn .gh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;background:#F5F5F5;font-weight:700;font-size:13px;cursor:pointer;user-select:none}" +
    ".cwn .gh .car{font-size:10px;color:#636466;width:12px;flex:none}" +
    ".cwn .gh .cnt{font-weight:400;color:#636466;font-size:12px}" +
    ".cwn .lk{font-size:12px;font-weight:700;color:#D22730;cursor:pointer;background:none;border:none;font-family:inherit;padding:0}" +
    ".cwn .gh .lk:first-of-type{margin-left:auto}.cwn .gh .lk+.lk{margin-left:12px}" +
    ".cwn .rows{max-height:260px;overflow:auto}.cwn .grp.closed .rows{display:none}" +
    ".cwn .row{display:flex;align-items:center;gap:10px;padding:7px 14px;border-top:1px solid #F0F0F0;font-size:13px;cursor:pointer}" +
    ".cwn .row:hover{background:#FAFAFA}.cwn .row.off{opacity:.45}.cwn .row.hide{display:none}" +
    ".cwn .row input{width:16px;height:16px;accent-color:#D22730;flex:none}" +
    ".cwn .row .nm{font-weight:700;flex:1;min-width:120px}.cwn .row .em{color:#636466;font-size:12px;word-break:break-all}" +
    ".cwn .st{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:4px;padding:2px 7px;background:#F5F5F5;border:1px solid #E5E5E5;color:#636466;white-space:nowrap}" +
    ".cwn .st.live{background:#E6F5EA;border-color:#1E7B34;color:#1E7B34}" +
    ".cwn .st.pros{background:#FBF3D6;border-color:#E5B423;color:#2D2A26}" +
    ".cwn .noem{padding:8px 14px;font-size:12px;color:#636466;border-top:1px solid #F0F0F0}" +
    ".cwn .others.closed .grp{display:none}" +
    ".cwn .pv{background:#2D2A26;color:#fff;border-radius:8px;padding:12px 16px;font-size:12.5px;white-space:pre-wrap;line-height:1.5;margin:14px 0}" +
    ".cwn .pv b{color:#E5B423;font-size:10px;letter-spacing:.1em;text-transform:uppercase;display:block;margin-bottom:6px}" +
    ".cwn .pv input,.cwn .pv textarea{width:100%;font-family:inherit;font-size:13px;color:#2D2A26;background:#fff;border:1.5px solid #E5E5E5;border-radius:8px;padding:9px 12px;line-height:1.5}" +
    ".cwn .pv input{margin-bottom:8px;font-weight:700}.cwn .pv textarea{resize:vertical;min-height:200px}" +
    ".cwn .pv input:focus,.cwn .pv textarea:focus{outline:none;border-color:#D22730}" +
    ".cwn .acts{display:flex;gap:10px;flex-wrap:wrap;align-items:center}" +
    ".cwn .btn{font-family:inherit;font-size:14px;font-weight:700;background:#D22730;color:#fff;border:none;border-radius:8px;padding:12px 22px;cursor:pointer;text-decoration:none;display:inline-block}" +
    ".cwn .btn:hover{background:#B01F27}.cwn .btn.ghost{background:#fff;color:#2D2A26;border:2px solid #E5E5E5}" +
    ".cwn .btn[aria-disabled=true]{opacity:.45;pointer-events:none}" +
    ".cwn .msg{font-size:12.5px;color:#636466}" +
    ".cwn .warn{font-size:12.5px;color:#636466;background:#FFF8E5;border:1px dashed #E5B423;border-radius:8px;padding:8px 12px;margin-top:10px}" +
    ".cwn .st.was{background:#EAF1FB;border-color:#3B6FB6;color:#1F4E8C}" +
    ".cwn .row.was .nm{font-weight:400}" +
    ".cwn .hint{font-size:11.5px;color:#cfcfcf;margin-top:8px;line-height:1.5}" +
    ".cwn .mailpv{border:1px solid #E5E5E5;border-radius:10px;background:#f4f5f7;padding:18px 10px;margin:0 0 14px}" +
    ".cwn .mailpv .env{max-width:640px;margin:0 auto 10px;font-size:12px;color:#636466;line-height:1.6}" +
    ".cwn .mailpv .env b{color:#2D2A26}" +
    ".cwn .mailpv .card{max-width:640px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;font-size:14px;line-height:1.55}" +
    ".cwn .mailpv .card .lg{padding:22px 28px 10px}.cwn .mailpv .card .lg img{height:40px;width:auto;display:block}" +
    ".cwn .mailpv .card .bar{height:4px;background:#D22730}" +
    ".cwn .mailpv .card .bd{padding:22px 28px 8px}.cwn .mailpv .card .bd p{margin:0 0 14px}.cwn .mailpv .card .bd ul{margin:0 0 14px;padding-left:22px}" +
    ".cwn .mailpv .card .bd a{color:#D22730;font-weight:700}" +
    ".cwn .mailpv .card .bd a.cta{display:inline-block;background:#D22730;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px}" +
    ".cwn .mailpv .card .ft{padding:14px 28px 24px;border-top:1px solid #eee;font-size:11.5px;color:#636466;line-height:1.5}" +
    ".cwn .qstat{font-size:13px;background:#EAF1FB;border:1px solid #3B6FB6;color:#1F4E8C;border-radius:8px;padding:10px 14px;margin:0 0 12px}" +
    ".cwn .qstat .lk{margin-left:10px}" +
    ".cwn .sendbar{border:2px solid #E5E5E5;border-radius:10px;padding:14px 16px;background:#FAFAFA}" +
    ".cwn .sendbar .line{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px}" +
    ".cwn .sendbar .line:last-child{margin-bottom:0}" +
    ".cwn .sendbar label{font-size:12px;color:#636466}" +
    ".cwn .sendbar input[type=text],.cwn .sendbar input[type=email]{font-family:inherit;font-size:16px;border:1.5px solid #E5E5E5;border-radius:8px;padding:8px 12px;min-width:200px}" +
    ".cwn .tot{font-size:15px;font-weight:700;padding:6px 12px;border-radius:8px;background:#fff;border:1.5px solid #E5E5E5;transition:background .25s}" +
    ".cwn .tot.flash{background:#FBF3D6}" +
    ".cwn .btn.sm{font-size:12.5px;padding:8px 14px}" +
    ".cwn .btn:disabled{opacity:.45;cursor:default}" +
    ".cwn .done{font-size:13px;background:#E6F5EA;border:1px solid #1E7B34;color:#14532d;border-radius:8px;padding:10px 14px;margin-top:10px}" +
    ".cwn .err{font-size:13px;background:#FDECEC;border:1px solid #D22730;color:#8c1a20;border-radius:8px;padding:10px 14px;margin-top:10px}" +
    ".cwn .mailtos{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}" +
    ".cwn .mailtos .btn{font-size:13px;padding:10px 16px}" +
    ".cwn .hidden{display:none!important}";

  var cache = null;      // vd_list result for this page load
  var cssDone = false;

  function esc(s) { var d = document.createElement("div"); d.textContent = String(s == null ? "" : s); return d.innerHTML; }
  function str(v) { return v == null ? "" : String(v).trim(); }
  function regionKey(region) { return /northern|nnv|reno/i.test(String(region)) ? "nnv" : "lv"; }
  function slugsFor(trade) {
    var t = String(trade || "").toLowerCase();
    var keys = Object.keys(TRADE_SLUGS);
    for (var i = 0; i < keys.length; i++) if (t.indexOf(keys[i]) === 0) return TRADE_SLUGS[keys[i]];
    for (i = 0; i < keys.length; i++) if (t.indexOf(keys[i]) >= 0) return TRADE_SLUGS[keys[i]];
    return [];
  }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  function titleCase(slug) {
    return String(slug).split("-").map(function (p) { return p ? p.charAt(0).toUpperCase() + p.slice(1) : p; }).join(" ")
      .replace(/\bHvac\b/, "HVAC");
  }

  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function detailLink(p) {
    var id = str(p.id);
    return /^(LV|NNV)-/.test(id) ? HUB + "respond.html?id=" + encodeURIComponent(id) : HUB + "opportunities.html";
  }
  // Short on purpose (TJ, Sep 17 2026): new opportunity, trade, industry, area,
  // one button. No pay, no size, no deadline. The posting carries the detail.
  function buildEmail(p) {
    var trade = str(p.trade).replace(/ \(.*\)/, "");
    var area = str(p.area) || str(p.region);
    var subject = "New " + trade + " Opportunity" + (area ? " in " + area : "");
    var facts = ["Service: " + trade];
    if (str(p.facility_type)) facts.push("Industry: " + str(p.facility_type));
    if (area) facts.push("Area of town: " + area);
    var body = ["Hi team,",
      "We have a new opportunity available.",
      facts.join("\n"),
      "View This Opportunity: " + detailLink(p),
      "Thank you,\n" + SENDERS[regionKey(p.region)].name];
    return { subject: subject, body: body.join("\n\n") };
  }

  // Same rules as vmHtml_ in VendorMessages.gs, so the preview matches what sends.
  function linkify(h) {
    return h.replace(/(https?:\/\/[^\s<]+)/g, function (u) {
      var t = "", m = u.match(/[.,;:)]+$/); if (m) { t = m[0]; u = u.slice(0, -t.length); }
      return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>' + t;
    });
  }
  function renderBody(text) {
    return String(text).replace(/\r/g, "").split(/\n{2,}/).map(function (p) {
      var lines = p.split("\n").filter(function (l) { return l.trim() !== ""; });
      if (!lines.length) return "";
      if (lines.every(function (l) { return /^\s*-\s+/.test(l); })) {
        return "<ul>" + lines.map(function (l) { return "<li>" + linkify(esc(l.replace(/^\s*-\s+/, ""))) + "</li>"; }).join("") + "</ul>";
      }
      var m = lines.length === 1 && lines[0].trim().match(/^([^:]{2,60}):\s+(https?:\/\/\S+)$/);
      if (m) return '<p><a class="cta" href="' + esc(m[2]) + '" target="_blank" rel="noopener">' + esc(m[1]) + "</a></p>";
      return "<p>" + linkify(lines.map(esc).join("<br>")) + "</p>";
    }).join("");
  }

  function post(payload, passcode) {
    payload.passcode = passcode;
    return fetch(SEND_WEBHOOK, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); });
  }

  function loadDirectory(passcode) {
    if (cache) return Promise.resolve(cache);
    return fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ kind: "vd_list", passcode: passcode }) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the Vendor Directory.");
        // The main script now and then answers ok with no vendors in it. Never keep or draw that.
        if (!r.vendors || !r.vendors.length) throw new Error("The vendor list came back empty. That happens now and then when the main script is busy.");
        cache = r; return r;
      });
  }

  // Build the groups for one posting. Region-only, no Do Not Contact / Inactive,
  // no blank emails, one row per vendor per group, deduped by email at send time.
  function pickVendors(dir, posting) {
    var rk = regionKey(posting.region), slugs = slugsFor(posting.trade);
    var mActive = [], mPotential = [], noEmail = [], dne = [], byType = {}, vendors = [];
    (dir.vendors || []).forEach(function (v) {
      if (!v.regions || v.regions.indexOf(rk) < 0) return;
      var st = str(v.status);
      if (st === "Do Not Contact" || st === "Inactive") return;
      if (!v.live && !v.prospect) return;
      var em = str(v.email).toLowerCase();
      var rec = { id: v.vendor_id, name: str(v.dba_name), email: em, status: st, live: !!v.live,
                  slugs: (v.slugs || []).slice() };
      if (v.dne) { dne.push(rec); return; }   // Sep 17 2026: on the do not email list (vendor-dne.html)
      if (!validEmail(em)) { noEmail.push(rec); return; }
      vendors.push(rec);
      var matched = slugs.length && rec.slugs.some(function (s) { return slugs.indexOf(s) >= 0; });
      if (matched) { (rec.live ? mActive : mPotential).push(rec); return; }
      var typed = rec.slugs.filter(function (s) { return s; });
      if (!typed.length) typed = ["unclassified"];
      typed.forEach(function (s) { (byType[s] = byType[s] || []).push(rec); });
    });
    var byName = function (a, b) {
      if (a.live !== b.live) return a.live ? -1 : 1;
      return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    };
    mActive.sort(byName); mPotential.sort(byName);
    // Service type groups: the live Service Types tab order first, then any slug a
    // vendor carries that the tab does not list, so new types show up automatically.
    var names = {}, order = [];
    (dir.types || []).forEach(function (t) { names[t.slug] = t.name || titleCase(t.slug); order.push(t.slug); });
    Object.keys(byType).sort().forEach(function (s) { if (order.indexOf(s) < 0) order.push(s); });
    var typeGroups = [];
    order.forEach(function (s) {
      if (!byType[s] || !byType[s].length) return;
      byType[s].sort(byName);
      typeGroups.push({ slug: s, label: names[s] || titleCase(s), rows: byType[s] });
    });
    return { active: mActive, potential: mPotential, types: typeGroups, noEmail: noEmail, dne: dne, slugs: slugs, total: vendors.length };
  }

  function ensureCss() {
    if (cssDone) return; cssDone = true;
    var s = document.createElement("style"); s.textContent = CSS; document.head.appendChild(s);
  }

  function render(container, posting, passcode) {
    ensureCss();
    container.className = (container.className || "").replace(/\bcwn\b/, "") + " cwn";
    container.innerHTML = '<h3>Email vendors about this posting</h3>' +
      '<div class="sub">Loading the Vendor Directory&hellip;</div>';
    // The status read (who already got this posting, sends left today) is best effort. If it fails the panel still works and the
    // server still checks the quota before anything goes out.
    var quotaP = post({ kind: "vm_queue_status", template: "opportunity:" + str(posting.id) }, passcode).then(function (q) { return q && q.ok ? q : null; }, function () { return null; });
    Promise.all([loadDirectory(passcode), quotaP]).then(function (rs) {
      draw(container, posting, pickVendors(rs[0], posting), passcode, rs[1]);
    }).catch(function (e) {
      container.innerHTML = '<h3>Email vendors about this posting</h3>' +
        '<div class="sub">' + esc(e.message || "Could not load the Vendor Directory.") + '</div>' +
        '<button type="button" class="btn sm" data-act="retry">Try again</button>';
      container.querySelector('[data-act="retry"]').addEventListener("click", function () { cache = null; render(container, posting, passcode); });
    });
  }

  function rowHtml(v, sentOn) {
    return '<label class="row off' + (sentOn ? ' was' : '') + '" data-e="' + esc(v.email) + '" data-s="' + esc((v.name + " " + v.email + " " + v.status + " " + v.slugs.join(" ")).toLowerCase()) + '">' +
      '<input type="checkbox" value="' + esc(v.email) + '">' +
      '<span class="nm">' + esc(v.name) + '</span>' +
      '<span class="st was' + (sentOn ? '' : ' hidden') + '">' + esc(tagText(sentOn)) + '</span>' +
      '<span class="st ' + (v.live ? "live" : "pros") + '">' + esc(v.status || "Prospect") + '</span>' +
      '<span class="em">' + esc(v.email) + '</span></label>';
  }
  function tagText(v) { v = String(v || ""); return !v ? "" : v === "queued" ? "Scheduled" : "Emailed " + v.replace(/^sent\s*/, ""); }
  function groupHtml(key, label, rows, closed, empty, sentMap) {
    var h = '<div class="grp' + (closed ? ' closed' : '') + '" data-g="' + esc(key) + '"><div class="gh"><span class="car">' + (closed ? '&#9654;' : '&#9660;') + '</span>' + esc(label) +
      ' <span class="cnt"><span class="sel">0</span> of ' + rows.length + ' selected</span>' +
      '<button type="button" class="lk" data-act="next">Pick next 50</button>' +
      '<button type="button" class="lk" data-act="all">Select all</button>' +
      '<button type="button" class="lk" data-act="none">Uncheck all</button></div><div class="rows">';
    if (!rows.length) h += '<div class="noem">' + esc(empty || "Nobody with an email on file.") + '</div>';
    rows.forEach(function (v) { h += rowHtml(v, sentMap[v.email] || ""); });
    return h + '</div></div>';
  }

  function draw(box, posting, pick, passcode, status) {
    var trade = str(posting.trade).replace(/ \(.*\)/, "");
    var isProject = String(posting.type) === "project";
    var rk = regionKey(posting.region), sender = SENDERS[rk];
    var mail = buildEmail(posting);
    var template = "opportunity:" + str(posting.id);
    var quota = status && typeof status.quota_left === "number" ? status.quota_left : -1;
    var reserve = status && typeof status.reserve === "number" ? status.reserve : 25;
    var perDay = status && status.per_day ? status.per_day : 71;
    var sentMap = (status && status.emails) || {};     // email -> "sent Sep 17" | "queued", from the server, shared by the whole team
    var armed = false, busy = false;

    var h = '<h3>Email vendors about this posting</h3>' +
      '<div class="sub"><b>1.</b> Check the vendors who should hear about this job. Nobody is checked to start. ' +
      '<b>2.</b> Look over the email. <b>3.</b> Click Schedule and Send once. The hub sends it for you as ' + esc(sender.name) +
      ', 20 vendors at a time every 10 minutes, every vendor on BCC so nobody sees anybody else. You can close the page. ' +
      'If the hub sender is down, use <b>Open in mail app</b> instead and send it from Outlook yourself.</div>' +
      '<div class="qstat hidden"></div>' +
      '<div class="tools"><input type="search" placeholder="Find a vendor&hellip;"></div>';
    if (!pick.slugs.length) {
      h += '<div class="warn">The trade "' + esc(posting.trade) + '" is not mapped to a directory service type yet. Pick from the service type groups below.</div>';
    }
    h += '<h4>Matched to ' + esc(trade) + ' in ' + esc(posting.region) + '</h4>';
    h += groupHtml("m-active", "Active " + trade + " vendors", pick.active, false, "No active vendors with an email on file for " + trade + " in " + posting.region + ".", sentMap);
    h += groupHtml("m-potential", "Potential " + trade + " vendors", pick.potential, false, "No potential vendors with an email on file for " + trade + " in " + posting.region + ".", sentMap);
    var otherCount = pick.types.reduce(function (n, g) { return n + g.rows.length; }, 0);
    h += '<div class="others' + (isProject ? '' : ' closed') + '"><h4>Every other service type in ' + esc(posting.region) +
      ' <span style="font-weight:400;text-transform:none;letter-spacing:0">(' + pick.types.length + ' types, ' + otherCount + ' vendors)</span>' +
      '<button type="button" class="lk" data-act="others">' + (isProject ? "Hide" : "Show every service type") + '</button></h4>';
    if (!pick.types.length) h += '<div class="grp"><div class="noem">No other vendors in this region.</div></div>';
    pick.types.forEach(function (g) { h += groupHtml("t-" + g.slug, g.label, g.rows, !isProject, "", sentMap); });
    h += '</div>';
    if (pick.dne && pick.dne.length) {
      h += '<div class="msg" style="margin-top:10px">On the do not email list (left out): ' +
        esc(pick.dne.map(function (v) { return v.name; }).join(", ")) + '. <a href="vendor-dne.html">Change the list</a></div>';
    }
    if (pick.noEmail.length) {
      h += '<div class="msg" style="margin-top:10px">No email on file (cannot be included): ' +
        esc(pick.noEmail.map(function (v) { return v.name; }).join(", ")) + '</div>';
    }
    h += '<div class="pv"><b>The email. Edit it here</b>' +
      '<input type="text" class="ed-subj" value="' + esc(mail.subject) + '">' +
      '<textarea class="ed-body" rows="14">' + esc(mail.body) + '</textarea>' +
      '<div class="hint">Keep a blank line between paragraphs. The line written as "View This Opportunity: https://..." becomes the red button. Change the words before the colon to rename the button. Keep the link on that same line.</div></div>' +
      '<h4>What the vendor sees</h4>' +
      '<div class="mailpv"><div class="env"></div><div class="card"><div class="lg"><img src="' + LOGO + '" alt="City Wide Facility Solutions"></div><div class="bar"></div>' +
      '<div class="bd"></div><div class="ft">' + esc(sender.foot) + '<br>Replies go to ' + esc(sender.reply) + '.<br>' + esc(OPT_OUT) + '</div></div></div>' +
      '<div class="sendbar">' +
      '<div class="line"><label>Your name, for the send log <input type="text" class="by" autocomplete="name"></label></div>' +
      '<div class="line"><span class="tot"></span><button type="button" class="btn ghost sm" data-act="refresh">Refresh count</button>' +
      '<button type="button" class="btn" data-act="send">Schedule and Send</button>' +
      '<button type="button" class="btn ghost sm hidden" data-act="cancel">Cancel</button></div>' +
      '<div class="line"><button type="button" class="btn ghost sm" data-act="mailapp">Open in mail app</button>' +
      '<span class="msg mailnote">Backup if the hub sender is down. Opens this email in Outlook or your own mail app with the vendors in BCC. Nothing is logged on the hub.</span></div>' +
      '<div class="mailtos hidden"></div>' +
      '<div class="line"><label>Send a test copy to <input type="email" class="testto" placeholder="you@gocitywide.com" autocomplete="email"></label>' +
      '<button type="button" class="btn ghost sm" data-act="test">Send me a test</button>' +
      '<button type="button" class="btn ghost sm" data-act="copy">Copy addresses</button><span class="msg copied"></span></div>' +
      '<div class="msg quota"></div></div>' +
      '<div class="warn hidden" data-w="batch"></div><div class="done hidden"></div><div class="err hidden"></div>';
    box.innerHTML = h;

    function q(sel) { return box.querySelector(sel); }
    function qa(sel) { return Array.prototype.slice.call(box.querySelectorAll(sel)); }
    var sendBtn = q('[data-act="send"]'), cancelBtn = q('[data-act="cancel"]'), testBtn = q('[data-act="test"]');
    q(".by").value = lsGet("cwVmBy") || str(posting.contact_name);
    q(".testto").value = lsGet("cwVmTest");

    var search = q("input[type=search]");
    search.addEventListener("input", function () {
      var s = search.value.trim().toLowerCase();
      qa(".row").forEach(function (r) { r.classList.toggle("hide", !!s && r.getAttribute("data-s").indexOf(s) < 0); });
      // a search opens every group so the hit is visible
      if (s) qa(".grp.closed, .others.closed").forEach(function (g) { g.classList.remove("closed"); });
      syncCarets();
    });
    function syncCarets() {
      qa(".grp").forEach(function (g) {
        var c = g.querySelector(".car"); if (c) c.innerHTML = g.classList.contains("closed") ? "&#9654;" : "&#9660;";
      });
      var o = q(".others"), ob = q('[data-act="others"]');
      if (o && ob) ob.textContent = o.classList.contains("closed") ? "Show every service type" : "Hide";
    }
    q('[data-act="others"]').addEventListener("click", function () { q(".others").classList.toggle("closed"); syncCarets(); });
    qa(".gh").forEach(function (gh) {
      gh.addEventListener("click", function (e) {
        if (e.target && e.target.classList.contains("lk")) return;
        gh.parentNode.classList.toggle("closed"); syncCarets();
      });
    });
    qa(".gh .lk").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.getAttribute("data-act"), grp = b.closest(".grp");
        var boxes = Array.prototype.slice.call(grp.querySelectorAll(".row input"));
        if (act === "next") {
          // Next batch in this group: skip anyone already checked or already emailed,
          // stop when the send is as big as one send can be right now.
          var room = 50;
          boxes.forEach(function (c) {
            if (room <= 0 || c.checked || sentMap[c.value]) return;
            setEmail(c.value, true); room--;
          });
          grp.classList.remove("closed"); syncCarets();
        } else {
          boxes.forEach(function (c) { setEmail(c.value, act === "all"); });
        }
        update();
      });
    });
    // A vendor in several groups is one checkbox in spirit: flip every copy.
    function setEmail(email, on) {
      qa('.row input[value="' + email.replace(/"/g, '\\"') + '"]').forEach(function (c) { c.checked = on; });
    }
    box.addEventListener("change", function (e) {
      if (e.target && e.target.type === "checkbox") { setEmail(e.target.value, e.target.checked); update(); }
    });
    q('[data-act="copy"]').addEventListener("click", function () {
      var list = selected().join("; ");
      var done = function () { q(".copied").textContent = "Copied. Paste into the BCC field, never To or CC."; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(list).then(done, function () { fallback(list); done(); });
      else { fallback(list); done(); }
    });
    function fallback(t) { var ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta); }
    function selected() {
      var out = [], seen = {};
      qa(".row input:checked").forEach(function (c) { if (!seen[c.value]) { seen[c.value] = 1; out.push(c.value); } });
      return out;
    }
    function show(sel, html) { var n = q(sel); n.innerHTML = html || ""; n.classList.toggle("hidden", !html); }
    function disarm() {
      armed = false; sendBtn.textContent = "Schedule and Send"; cancelBtn.classList.add("hidden");
    }
    function preview() {
      q(".mailpv .env").innerHTML = '<div><b>From</b> ' + esc(sender.name) + '</div><div><b>To</b> ' + esc(sender.reply) +
        '</div><div><b>BCC</b> ' + selected().length + ' vendor' + (selected().length === 1 ? '' : 's') + ', each one hidden from the others</div>' +
        '<div><b>Subject</b> ' + (esc(q(".ed-subj").value.trim()) || "(no subject yet)") + '</div>';
      q(".mailpv .bd").innerHTML = q(".ed-body").value.trim() ? renderBody(q(".ed-body").value) : '<p style="color:#636466">Nothing written yet.</p>';
    }
    function update() {
      disarm();
      qa(".grp").forEach(function (g) {
        var s = g.querySelector(".sel"); if (s) s.textContent = g.querySelectorAll(".row input:checked").length;
      });
      qa(".row").forEach(function (r) { r.classList.toggle("off", !r.querySelector("input").checked); });
      var n = selected().length;
      q(".tot").textContent = n + " vendor" + (n === 1 ? "" : "s") + " selected";
      sendBtn.disabled = busy || !n;
      var u = quota < 0 ? perDay : Math.max(0, quota - reserve), today = Math.max(0, u - Math.ceil(u / (CHUNK + 1)));
      var wmsg = "";
      if (n && n > today) {
        var days = perDay ? Math.ceil((n - today) / perDay) + (today ? 1 : 0) : 0;
        wmsg = "<b>" + n + " vendors will take about " + days + " day" + (days === 1 ? "" : "s") + ".</b> About " + Math.min(n, today) +
          " can go today and about " + perDay + " a day after that. The vendor mailbox allows about 100 a day for now. You still only click once. The hub keeps sending on its own.";
      }
      show('[data-w="batch"]', wmsg);
      q(".quota").textContent = quota >= 0 ? "Vendor emails left today: " + Math.max(0, quota - reserve) + "." : "";
      preview();
    }
    // Open in mail app: same To, BCC, subject and body, through a mailto: link. Mail apps cap the link length,
    // so a long list becomes several emails; each one is offered as its own button.
    function openMailApp() {
      var holder = q(".mailtos"); holder.innerHTML = ""; holder.classList.add("hidden");
      show(".err", "");
      var subj = q(".ed-subj").value.trim(), body = q(".ed-body").value.replace(/\r/g, "").trim(), emails = selected();
      var why = !subj ? "Write a subject first." : !body ? "Write the message first." : !emails.length ? "Check at least one vendor." : "";
      if (why) { show(".err", esc(why)); return; }
      var text = (body + "\n\n" + sender.foot + "\n" + OPT_OUT_SHORT).replace(/\n/g, "\r\n");
      var base = "mailto:" + sender.reply + "?subject=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(text) + "&bcc=";
      // A long edited body eats the link budget. Always leave room for at least ~25 addresses per email.
      var cap = Math.max(MAILTO_MAX, base.length + 900);
      var batches = [], cur = [];
      emails.forEach(function (em) {
        if (cur.length && (base + encodeURIComponent(cur.concat([em]).join(","))).length > cap) { batches.push(cur); cur = []; }
        cur.push(em);
      });
      if (cur.length) batches.push(cur);
      if (batches.length === 1) { window.location.href = base + encodeURIComponent(batches[0].join(",")); return; }
      batches.forEach(function (b, i) {
        var a = document.createElement("a"); a.className = "btn ghost"; a.href = base + encodeURIComponent(b.join(","));
        a.textContent = "Open email " + (i + 1) + " of " + batches.length + " (" + b.length + " in BCC)";
        holder.appendChild(a);
      });
      var note = document.createElement("div"); note.className = "msg";
      note.style.width = "100%";
      note.textContent = "Mail apps cap how many addresses one link can carry, so this list is split into " + batches.length + " emails. Open and send each one. Every vendor is in BCC.";
      holder.appendChild(note);
      holder.classList.remove("hidden");
    }
    q('[data-act="mailapp"]').addEventListener("click", openMailApp);
    q('[data-act="refresh"]').addEventListener("click", function () {
      update(); var t = q(".tot"); t.classList.add("flash"); setTimeout(function () { t.classList.remove("flash"); }, 600);
    });
    cancelBtn.addEventListener("click", function () { disarm(); });
    q(".ed-subj").addEventListener("input", function () { disarm(); preview(); });
    q(".ed-body").addEventListener("input", function () { disarm(); preview(); });

    function setBusy(on) { busy = on; sendBtn.disabled = on; testBtn.disabled = on; if (!on) update(); }
    function send(test) {
      if (busy) return;
      show(".done", ""); show(".err", "");
      var subj = q(".ed-subj").value.trim(), body = q(".ed-body").value.replace(/\r/g, "").trim();
      var by = q(".by").value.trim(), testTo = q(".testto").value.trim(), emails = selected();
      var why = "";
      if (!subj) why = "Write a subject first.";
      else if (!body) why = "Write the message first.";
      else if (!by) why = "Put your name in so the send log shows who sent it.";
      else if (test && !validEmail(testTo)) why = "Type the address the test copy should go to.";
      else if (!test && !emails.length) why = "Check at least one vendor.";
      if (why) { disarm(); show(".err", esc(why)); return; }
      lsSet("cwVmBy", by); if (testTo) lsSet("cwVmTest", testTo);
      if (!test && !armed) {
        armed = true; sendBtn.textContent = "Yes, send to " + emails.length + " vendor" + (emails.length === 1 ? "" : "s");
        cancelBtn.classList.remove("hidden"); return;
      }
      disarm(); setBusy(true);
      (test ? testBtn : sendBtn).textContent = "Sending...";
      var payload = test
        ? { kind: "vm_send", sender: rk, reply_to: sender.reply, template: template, subject: subj, body: body,
            to: emails.length && emails.length <= BATCH_MAX ? emails : [testTo], by: by, test: true, test_to: testTo }
        : { kind: "vm_queue", sender: rk, reply_to: sender.reply, template: template, subject: subj, body: body, to: emails, by: by };
      post(payload, passcode).then(function (r) {
        testBtn.textContent = "Send me a test";
        if (r && typeof r.quota_left === "number") quota = r.quota_left;
        if (!r || !r.ok) {
          setBusy(false);
          show(".err", /unknown kind/i.test((r && r.error) || "") ? "The scheduler is not switched on in the script yet. Nothing was sent." : esc((r && r.error) || "Could not send."));
          return;
        }
        if (test) { setBusy(false); show(".done", "<b>Test copy sent to " + esc(testTo) + ".</b> No vendor got anything. Check how it looks, then schedule the real one."); return; }
        show(".done", "<b>Scheduled " + r.queued + " vendor" + (r.queued === 1 ? "" : "s") + ".</b> " +
          (r.sent_now ? "The first " + r.sent_now + " just went out. " : "") +
          (r.pending ? r.pending + " are waiting and go out on their own, 20 every 10 minutes between 7am and 7pm. You can close this page." : "That is everyone.") +
          (r.blocked && r.blocked.length ? "<br>" + r.blocked.length + " left out because they are on the do not email list." : "") +
          (r.already ? "<br>" + r.already + " were skipped because they already got this one or are already scheduled." : "") +
          (r.skipped && r.skipped.length ? "<br>Skipped bad addresses: " + esc(r.skipped.join(", ")) : "") +
          (r.note && !r.sent_now ? "<br>" + esc(r.note) : ""));
        refreshStatus(function () { setBusy(false); });
      })
      .catch(function () {
        testBtn.textContent = "Send me a test"; setBusy(false);
        show(".err", "Could not reach the server. It may or may not have scheduled. Click Refresh status at the top before trying again. Nobody can get it twice either way.");
      });
    }

    // Shared, server side record of who got this posting: tags the rows and fills the status strip.
    function applyStatus(st) {
      if (!st || !st.ok) return;
      sentMap = st.emails || {};
      if (typeof st.quota_left === "number") quota = st.quota_left;
      qa(".row").forEach(function (row) {
        var c = row.querySelector("input"), v = sentMap[c.value] || "", tag = row.querySelector(".st.was");
        row.classList.toggle("was", !!v); tag.textContent = tagText(v); tag.classList.toggle("hidden", !v);
        if (v) c.checked = false;
      });
      var sent = 0, pend = 0, failed = 0;
      (st.batches || []).forEach(function (b) { sent += b.sent || 0; pend += b.pending || 0; failed += b.failed || 0; });
      var strip = q(".qstat");
      strip.classList.toggle("hidden", !(sent || pend || failed));
      strip.innerHTML = "<b>This posting so far:</b> " + sent + " emailed, " + pend + " waiting to go" + (failed ? ", " + failed + " failed" : "") + ". " +
        '<button type="button" class="lk" data-act="qrefresh">Refresh status</button>' +
        (pend ? ' <button type="button" class="lk" data-act="qcancel">Stop the ones still waiting</button>' : "");
    }
    function refreshStatus(then) {
      post({ kind: "vm_queue_status", template: template }, passcode).then(function (st) { applyStatus(st); update(); if (then) then(); },
        function () { if (then) then(); });
    }
    var stopArmed = false;
    q(".qstat").addEventListener("click", function (e) {
      var act = e.target && e.target.getAttribute("data-act");
      if (act === "qrefresh") { e.target.textContent = "Refreshing..."; refreshStatus(); }
      if (act === "qcancel") {
        if (!stopArmed) { stopArmed = true; e.target.textContent = "Yes, stop them"; return; }
        stopArmed = false; e.target.textContent = "Stopping...";
        post({ kind: "vm_queue_cancel", template: template, by: q(".by").value.trim() }, passcode).then(function () { refreshStatus(); }, function () { refreshStatus(); });
      }
    });
    applyStatus(status);
    sendBtn.addEventListener("click", function () { send(false); });
    testBtn.addEventListener("click", function () { send(true); });
    update();
  }

  w.CWNotify = { render: render, buildEmail: buildEmail, pickVendors: pickVendors, slugsFor: slugsFor, _reset: function () { cache = null; } };
})(window);
