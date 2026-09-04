/* CW Ops Hub: Email Vendors panel (build 2026-09-04c)
   Shared by post.html (right after a posting goes live) and postings.html
   (any open posting). Pulls the live Vendor Directory (vd_list), matches
   vendors to the posting's region and trade, and opens the poster's own mail
   app (Outlook) with the selected vendors in BCC via mailto. Nothing is sent
   by the platform; the email goes out from whoever clicks.

   Lists shown, always for the posting's region only:
     1. Matched to the trade: Active vendors + Potential vendors, all checked.
     2. Every other service type in the directory, one group per type, built
        from the live Service Types tab (plus any slug a vendor row carries that
        the tab does not list yet), so new types appear with no code change.
        Unchecked by default. Select all per group, or one by one.
        One-time projects show these groups open; contracts tuck them behind
        "Show every service type".
   A vendor tagged with several types appears in each group; checking or
   unchecking them anywhere flips every copy, and the BCC list is deduped.

   Usage: CWNotify.render(containerEl, posting, passcode)
   posting needs: id, region, type, trade, title, facility_type, area, sqft,
   restrooms, pay_type, pay_amount, pay_period, deadline, contact_name
*/
(function (w) {
  var WEBHOOK = "https://script.google.com/macros/s/AKfycbzfNnrpidCbWB1DeUNgXvRhDFMQgApfpn-3C9GU45wMEHcJpWFl8ZQVo6PUBSRfEVfRdg/exec";
  var HUB = "https://citywidelv.github.io/cw-vendor-hub/";
  var MAILTO_MAX = 1800;   // Outlook truncates long mailto links; batch above this

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
    ".cwn .tot{font-size:13px;font-weight:700}.cwn .msg{font-size:12.5px;color:#636466}" +
    ".cwn .warn{font-size:12.5px;color:#636466;background:#FFF8E5;border:1px dashed #E5B423;border-radius:8px;padding:8px 12px;margin-top:10px}" +
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
  function money(v) {
    var n = Number(String(v == null ? "" : v).replace(/[$,]/g, ""));
    if (isNaN(n) || n <= 0) return str(v);
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(v) { var n = Number(String(v == null ? "" : v).replace(/,/g, "")); return isNaN(n) || n <= 0 ? "" : n.toLocaleString("en-US"); }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  function titleCase(slug) {
    return String(slug).split("-").map(function (p) { return p ? p.charAt(0).toUpperCase() + p.slice(1) : p; }).join(" ")
      .replace(/\bHvac\b/, "HVAC");
  }

  function payLine(p, short) {
    if (String(p.pay_type) === "set" && str(p.pay_amount)) {
      return money(p.pay_amount) + " " + (str(p.pay_period) || "per month");
    }
    return short ? "Quote requested" : "Quote requested. You price the work.";
  }
  function detailLink(p) {
    var id = str(p.id);
    return /^(LV|NNV)-/.test(id) ? HUB + "respond.html?id=" + encodeURIComponent(id) : HUB + "opportunities.html";
  }
  function buildEmail(p) {
    var trade = str(p.trade).replace(/ \(.*\)/, "");
    var subject = "New " + trade + " Opportunity: " + (str(p.facility_type) || str(p.title)) +
      (str(p.area) ? ", " + str(p.area) : "") + ". " + payLine(p, true);
    var lines = ["Hi team,", "", "We have a new opportunity and we would love to have you on it.", ""];
    lines.push("Industry: " + (str(p.facility_type) || "See posting"));
    lines.push("Area: " + (str(p.area) || str(p.region)));
    lines.push("Size: " + (num(p.sqft) ? num(p.sqft) + " sq ft" : "See posting"));
    lines.push("Restrooms: " + (num(p.restrooms) || "See posting"));
    lines.push("Pay: " + payLine(p));
    lines.push("");
    lines.push("See the full posting and let us know you are interested here:");
    lines.push(detailLink(p));
    lines.push("");
    lines.push((str(p.deadline) ? "Please respond by " + str(p.deadline) + ". " : "") + "First qualified answers get the walkthrough.");
    lines.push("");
    lines.push("Thank you,");
    lines.push(str(p.contact_name) || "City Wide Operations");
    lines.push("City Wide Facility Solutions");
    return { subject: subject, body: lines.join("\r\n") };
  }

  function loadDirectory(passcode) {
    if (cache) return Promise.resolve(cache);
    return fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ kind: "vd_list", passcode: passcode }) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the Vendor Directory.");
        cache = r; return r;
      });
  }

  // Build the groups for one posting. Region-only, no Do Not Contact / Inactive,
  // no blank emails, one row per vendor per group, deduped by email at send time.
  function pickVendors(dir, posting) {
    var rk = regionKey(posting.region), slugs = slugsFor(posting.trade);
    var mActive = [], mPotential = [], noEmail = [], byType = {}, vendors = [];
    (dir.vendors || []).forEach(function (v) {
      if (!v.regions || v.regions.indexOf(rk) < 0) return;
      var st = str(v.status);
      if (st === "Do Not Contact" || st === "Inactive") return;
      if (!v.live && !v.prospect) return;
      var em = str(v.email).toLowerCase();
      var rec = { id: v.vendor_id, name: str(v.dba_name), email: em, status: st, live: !!v.live,
                  slugs: (v.slugs || []).slice() };
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
    return { active: mActive, potential: mPotential, types: typeGroups, noEmail: noEmail, slugs: slugs, total: vendors.length };
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
    loadDirectory(passcode).then(function (dir) {
      draw(container, posting, pickVendors(dir, posting));
    }).catch(function (e) {
      container.innerHTML = '<h3>Email vendors about this posting</h3>' +
        '<div class="sub">' + esc(e.message || "Could not load the Vendor Directory.") + '</div>';
    });
  }

  function rowHtml(v, checked) {
    return '<label class="row" data-e="' + esc(v.email) + '" data-s="' + esc((v.name + " " + v.email + " " + v.status + " " + v.slugs.join(" ")).toLowerCase()) + '">' +
      '<input type="checkbox"' + (checked ? ' checked' : '') + ' value="' + esc(v.email) + '">' +
      '<span class="nm">' + esc(v.name) + '</span>' +
      '<span class="st ' + (v.live ? "live" : "pros") + '">' + esc(v.status || "Prospect") + '</span>' +
      '<span class="em">' + esc(v.email) + '</span></label>';
  }
  function groupHtml(key, label, rows, checked, closed, empty) {
    var h = '<div class="grp' + (closed ? ' closed' : '') + '" data-g="' + esc(key) + '"><div class="gh"><span class="car">' + (closed ? '&#9654;' : '&#9660;') + '</span>' + esc(label) +
      ' <span class="cnt"><span class="sel">' + (checked ? rows.length : 0) + '</span> of ' + rows.length + ' selected</span>' +
      '<button type="button" class="lk" data-act="all">Select all</button>' +
      '<button type="button" class="lk" data-act="none">Uncheck all</button></div><div class="rows">';
    if (!rows.length) h += '<div class="noem">' + esc(empty || "Nobody with an email on file.") + '</div>';
    rows.forEach(function (v) { h += rowHtml(v, checked); });
    return h + '</div></div>';
  }

  function draw(box, posting, pick) {
    var trade = str(posting.trade).replace(/ \(.*\)/, "");
    var isProject = String(posting.type) === "project";
    var mail = buildEmail(posting);
    var h = '<h3>Email vendors about this posting</h3>' +
      '<div class="sub">Vendors matched to this trade are checked. Uncheck anyone who should not hear about this job (for example a vendor being replaced on the account); search to find them fast. Add other service types below, a whole group or one by one. Opens a new email in your own mail app with the selected vendors in BCC. Nothing sends until you hit Send.</div>' +
      '<div class="tools"><input type="search" placeholder="Find a vendor&hellip;"></div>';
    if (!pick.slugs.length) {
      h += '<div class="warn">The trade "' + esc(posting.trade) + '" is not mapped to a directory service type yet, so nobody is pre-checked. Pick from the service type groups below.</div>';
    }
    h += '<h4>Matched to ' + esc(trade) + ' in ' + esc(posting.region) + '</h4>';
    h += groupHtml("m-active", "Active " + trade + " vendors", pick.active, true, false, "No active vendors with an email on file for " + trade + " in " + posting.region + ".");
    h += groupHtml("m-potential", "Potential " + trade + " vendors", pick.potential, true, false, "No potential vendors with an email on file for " + trade + " in " + posting.region + ".");
    var otherCount = pick.types.reduce(function (n, g) { return n + g.rows.length; }, 0);
    h += '<div class="others' + (isProject ? '' : ' closed') + '"><h4>Every other service type in ' + esc(posting.region) +
      ' <span style="font-weight:400;text-transform:none;letter-spacing:0">(' + pick.types.length + ' types, ' + otherCount + ' vendors, none checked)</span>' +
      '<button type="button" class="lk" data-act="others">' + (isProject ? "Hide" : "Show every service type") + '</button></h4>';
    if (!pick.types.length) h += '<div class="grp"><div class="noem">No other vendors in this region.</div></div>';
    pick.types.forEach(function (g) {
      h += groupHtml("t-" + g.slug, g.label, g.rows, false, !isProject, "");
    });
    h += '</div>';
    if (pick.noEmail.length) {
      h += '<div class="msg" style="margin-top:10px">No email on file (cannot be included): ' +
        esc(pick.noEmail.map(function (v) { return v.name; }).join(", ")) + '</div>';
    }
    h += '<div class="pv"><b>The email. Edit it here before you open it</b>' +
      '<input type="text" class="ed-subj" value="' + esc(mail.subject) + '">' +
      '<textarea class="ed-body" rows="16">' + esc(mail.body) + '</textarea></div>' +
      '<div class="acts"><span class="tot"></span><span class="btns"></span>' +
      '<button type="button" class="btn ghost" data-act="copy">Copy addresses</button><span class="msg copied"></span></div>' +
      '<div class="warn hidden" data-w="batch"></div>';
    box.innerHTML = h;

    var search = box.querySelector("input[type=search]");
    search.addEventListener("input", function () {
      var q = search.value.trim().toLowerCase();
      Array.prototype.forEach.call(box.querySelectorAll(".row"), function (r) {
        r.classList.toggle("hide", !!q && r.getAttribute("data-s").indexOf(q) < 0);
      });
      // a search opens every group so the hit is visible
      if (q) Array.prototype.forEach.call(box.querySelectorAll(".grp.closed, .others.closed"), function (g) { g.classList.remove("closed"); });
      syncCarets();
    });
    function syncCarets() {
      Array.prototype.forEach.call(box.querySelectorAll(".grp"), function (g) {
        g.querySelector(".car").innerHTML = g.classList.contains("closed") ? "&#9654;" : "&#9660;";
      });
      var o = box.querySelector(".others"), ob = box.querySelector('[data-act="others"]');
      if (o && ob) ob.textContent = o.classList.contains("closed") ? "Show every service type" : "Hide";
    }
    box.querySelector('[data-act="others"]').addEventListener("click", function () {
      box.querySelector(".others").classList.toggle("closed"); syncCarets();
    });
    Array.prototype.forEach.call(box.querySelectorAll(".gh"), function (gh) {
      gh.addEventListener("click", function (e) {
        if (e.target && e.target.classList.contains("lk")) return;
        gh.parentNode.classList.toggle("closed"); syncCarets();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll(".gh .lk"), function (b) {
      b.addEventListener("click", function () {
        var on = b.getAttribute("data-act") === "all";
        Array.prototype.forEach.call(b.closest(".grp").querySelectorAll(".row input"), function (c) { setEmail(c.value, on); });
        update();
      });
    });
    // A vendor in several groups is one checkbox in spirit: flip every copy.
    function setEmail(email, on) {
      Array.prototype.forEach.call(box.querySelectorAll('.row input[value="' + email.replace(/"/g, '\\"') + '"]'), function (c) { c.checked = on; });
    }
    box.addEventListener("change", function (e) {
      if (e.target && e.target.type === "checkbox") { setEmail(e.target.value, e.target.checked); update(); }
    });
    box.querySelector('[data-act="copy"]').addEventListener("click", function () {
      var list = selected().join("; ");
      var done = function () { box.querySelector(".copied").textContent = "Copied. Paste into the BCC field."; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(list).then(done, function () { fallback(list); done(); });
      else { fallback(list); done(); }
    });
    function fallback(t) { var ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta); }
    function selected() {
      var out = [], seen = {};
      Array.prototype.forEach.call(box.querySelectorAll(".row input:checked"), function (c) {
        if (!seen[c.value]) { seen[c.value] = 1; out.push(c.value); }
      });
      return out;
    }
    function update() {
      Array.prototype.forEach.call(box.querySelectorAll(".grp"), function (g) {
        g.querySelector(".sel").textContent = g.querySelectorAll(".row input:checked").length;
      });
      Array.prototype.forEach.call(box.querySelectorAll(".row"), function (r) {
        r.classList.toggle("off", !r.querySelector("input").checked);
      });
      var emails = selected();
      box.querySelector(".tot").textContent = emails.length + " vendor" + (emails.length === 1 ? "" : "s") + " in BCC";
      var subj = box.querySelector(".ed-subj").value, body = box.querySelector(".ed-body").value.replace(/\r?\n/g, "\r\n");
      var base = "mailto:?subject=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(body) + "&bcc=";
      var batches = [], cur = [];
      emails.forEach(function (em) {
        if (cur.length && (base + encodeURIComponent(cur.concat([em]).join(","))).length > MAILTO_MAX) { batches.push(cur); cur = []; }
        cur.push(em);
      });
      if (cur.length) batches.push(cur);
      var holder = box.querySelector(".btns"); holder.innerHTML = "";
      if (!batches.length) {
        var a0 = document.createElement("a"); a0.className = "btn"; a0.setAttribute("aria-disabled", "true");
        a0.textContent = "Open Email"; holder.appendChild(a0);
      }
      batches.forEach(function (b, i) {
        var a = document.createElement("a"); a.className = "btn"; a.style.margin = "2px 6px 2px 0";
        a.href = base + encodeURIComponent(b.join(","));
        a.textContent = batches.length > 1 ? "Open Email " + (i + 1) + " of " + batches.length + " (" + b.length + ")" : "Open Email (" + b.length + " in BCC)";
        holder.appendChild(a);
      });
      var wn = box.querySelector('[data-w="batch"]');
      wn.classList.toggle("hidden", batches.length < 2);
      if (batches.length > 1) wn.textContent = "Mail apps cap how many addresses one link can carry, so this list is split into " +
        batches.length + " emails. Send each one, or click Copy addresses and paste everyone into the BCC of a single email.";
    }
    box.querySelector(".ed-subj").addEventListener("input", update);
    box.querySelector(".ed-body").addEventListener("input", update);
    update();
  }

  w.CWNotify = { render: render, buildEmail: buildEmail, pickVendors: pickVendors, slugsFor: slugsFor, _reset: function () { cache = null; } };
})(window);
