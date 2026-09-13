/* CW Nav. Build 2026-09-13.
   Shared menu renderer for the hubs that used to carry their nav as hand-edited HTML
   (Team Portal, Sales Hub, Vendor Hub). The Ops Hub and Admin Hub keep their own
   renderers and only swap their MENU data for window.CW_NAV.

   Contract
   - Each hub repo carries a nav.js at its root that sets window.CW_NAV. The Site Admin
     hub (cw-admin-hub/site-admin.html) publishes it. Load nav.js BEFORE this file.
   - The page keeps its shipped markup. This renderer only replaces it when a manifest
     for the right hub is present and well formed, so a missing or broken nav.js
     degrades to yesterday's menu, never to no menu.
   - Manifest shape, one for every hub:
       { hub, label, menu:[ TOP ], quick:[ LEAF ] }
       TOP  = { label, href?, icon?, page?, note?, style?, hidden?, items:[ ITEM ] }
       (Portal: style "dbis" colours a sidecard, style "strip" renders a long narrow box above the grid)
       ITEM = LEAF | { ghead:"Heading" } | { sub:"Cascade label", items:[ ITEM ] }
       LEAF = { label, href, tag?, primary?, cta?, hidden? }
     hidden:true on anything leaves it out of the render without deleting it.

   Load it:
   <script src="nav.js"></script>
   <script src="https://citywidelv.github.io/cw-ops-desk/cw-nav.js"></script>
*/
(function(){
  "use strict";
  function esc(s){ return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function external(href){ return /^https?:/.test(href) && href.indexOf("citywidelv.github.io") < 0; }
  function tgt(href){ return external(href) ? ' target="_blank" rel="noopener"' : ''; }
  function shown(list){ return (list || []).filter(function(it){ return it && !it.hidden; }); }
  function manifest(hub){
    var n = window.CW_NAV;
    if(!n || typeof n !== "object" || n.hub !== hub || !Array.isArray(n.menu)) return null;
    return n;
  }
  function here(href){
    if(!href || /^https?:/.test(href) || href.charAt(0) === "#") return false;
    var file = (location.pathname.split("/").pop() || "index.html");
    var target = href.split(/[?#]/)[0];
    if(target === "" || target === "./") target = "index.html";
    return target === file;
  }

  /* ---------- Vendor Hub: <header class="site-head"> <nav> ---------- */
  function vendor(navEl){
    var n = manifest("vendor");
    navEl = navEl || document.querySelector(".site-head nav");
    if(!n || !navEl) return false;
    var html = "";
    shown(n.menu).forEach(function(top){
      if(top.items){
        var lab = top.href ? esc(top.href) : "#";
        var oc = top.href ? "" : ' onclick="return false;"';
        html += '<div class="dd"><a class="dd-label' + (here(top.href) ? ' active' : '') + '" href="' + lab + '"' + oc + '>' + esc(top.label) + '</a><div class="dd-menu">';
        shown(top.items).forEach(function(it){
          if(it.ghead) html += '<div class="dd-head">' + esc(it.ghead) + '</div>';
          else if(it.sub) shown(it.items).forEach(function(x){ if(x.ghead) html += '<div class="dd-head">' + esc(x.ghead) + '</div>'; else if(x.href) html += '<a href="' + esc(x.href) + '"' + tgt(x.href) + '>' + esc(x.label) + '</a>'; });
          else if(it.href) html += '<a href="' + esc(it.href) + '"' + tgt(it.href) + '>' + esc(it.label) + '</a>';
        });
        html += '</div></div>';
      } else if(top.href){
        var cls = [];
        if(top.cta) cls.push("btn-order");
        if(/opportunities\.html/.test(top.href) && !top.cta) cls.push("nav-opps");
        if(here(top.href) && !top.cta) cls.push("active");
        html += '<a href="' + esc(top.href) + '"' + (cls.length ? ' class="' + cls.join(" ") + '"' : '') + tgt(top.href) + '>' + esc(top.label) + '</a>';
      }
    });
    navEl.innerHTML = html;
    return true;
  }

  /* ---------- Sales Hub: the Sales Tools panel ---------- */
  function sales(panelEl){
    var n = manifest("sales");
    panelEl = panelEl || document.getElementById("toolsPanel");
    if(!n || !panelEl) return false;
    var tops = shown(n.menu);
    if(!tops.length) return false;
    var top = tops[0];
    var html = "";
    shown(top.items).forEach(function(it){
      if(it.ghead) html += '<div class="grouphead">' + esc(it.ghead) + '</div>';
      else if(it.sub){ html += '<div class="grouphead">' + esc(it.sub) + '</div>'; shown(it.items).forEach(function(x){ if(x.href) html += '<a href="' + esc(x.href) + '"' + tgt(x.href) + '>' + esc(x.label) + '</a>'; }); }
      else if(it.href) html += '<a' + (it.primary ? ' class="primary"' : '') + ' href="' + esc(it.href) + '"' + tgt(it.href) + '>' + esc(it.label) + '</a>';
    });
    if(top.note) html += '<div class="menunote">' + esc(top.note) + '</div>';
    panelEl.innerHTML = html;
    var btn = document.getElementById("toolsBtn");
    if(btn && top.label) btn.innerHTML = esc(top.label) + ' <span class="caret">&#9660;</span>';
    return true;
  }

  /* ---------- Team Portal: the sidecards ---------- */
  function portal(asideEl){
    var n = manifest("portal");
    asideEl = asideEl || document.querySelector("aside");
    if(!n || !asideEl) return false;
    var html = "", strip = "";
    shown(n.menu).forEach(function(card){
      if(card.style === "strip"){
        /* a long narrow box spanning the team grid, e.g. the Site Admin link */
        if(card.href) strip += '<a class="strip" href="' + esc(card.href) + '"' + tgt(card.href) + '><b>' + esc(card.label) + '</b>' + (card.note ? '<span>' + esc(card.note) + '</span>' : '') + '<span class="go">Open &rarr;</span></a>';
        return;
      }
      html += '<div class="sidecard' + (card.style ? ' ' + esc(card.style) : '') + '"><h3>' + esc(card.label) + '</h3>';
      if(card.note) html += '<div class="sub">' + esc(card.note) + '</div>';
      shown(card.items).forEach(function(it){
        if(it.ghead) html += '<div class="ghead">' + esc(it.ghead) + '</div>';
        else if(it.sub){ html += '<div class="ghead">' + esc(it.sub) + '</div>'; shown(it.items).forEach(function(x){ if(x.href) html += '<a class="lnk" href="' + esc(x.href) + '"' + tgt(x.href) + '>' + esc(x.label) + '</a>'; }); }
        else if(it.href) html += '<a class="lnk" href="' + esc(it.href) + '"' + tgt(it.href) + '>' + esc(it.label) + '</a>';
      });
      html += '</div>';
    });
    asideEl.innerHTML = html;
    var host = document.getElementById("adminstrip");
    if(host) host.innerHTML = strip;
    return true;
  }

  /* Strip hidden items from an Ops / Admin style tree so their own renderers can use it. */
  function prune(list){
    return shown(list).map(function(it){
      var o = {};
      Object.keys(it).forEach(function(k){ o[k] = it[k]; });
      if(Array.isArray(it.items)) o.items = prune(it.items);
      return o;
    });
  }
  /* Ops / Admin: returns the manifest menu (pruned) or null so the page keeps its MENU. */
  function menuFor(hub){
    var n = manifest(hub);
    if(!n) return null;
    var m = prune(n.menu);
    return m.length ? m : null;
  }
  function quickFor(hub){
    var n = manifest(hub);
    if(!n || !Array.isArray(n.quick)) return null;
    var q = shown(n.quick);
    return q.length ? q : null;
  }

  window.CWNav = { vendor: vendor, sales: sales, portal: portal, menuFor: menuFor, quickFor: quickFor, prune: prune, manifest: manifest, here: here };
})();
