/* CW Auth. Build 2026-09-05.
   One team unlock per device for every internal page under citywidelv.github.io.

   How it works
   - Every internal repo publishes under the same origin, so localStorage is shared.
   - The Ops Hub, Sales Hub, BOM Hub, and Team Portal are the only pages that show a
     passcode box. They store the passcode under ONE key (cwOpsHubPass) once the server
     accepts it. The BOM Hub also accepts its own BOM-only passcode (cwBomHubPass).
   - Sub pages never show a passcode box. They call CWAuth.require(). If the device has
     no passcode they bounce to their hub gate with ?next= and come straight back after
     the unlock. If the server later rejects the cached passcode (it was rotated) they
     clear it and bounce the same way.
   - The passcode is checked server side on every write. The cached copy is a
     convenience, not authentication. Never move the check client side.
   - Older keys (cw_sales_auth, cw_exa_auth, cw_vio_auth, cw_ins_auth) are read once and
     migrated into cwOpsHubPass so nobody has to type the passcode again after this ships.

   Load it before the page script:
   <script src="https://citywidelv.github.io/cw-ops-desk/cw-auth.js"></script>
*/
(function(){
  "use strict";
  var WEBHOOK = "https://script.google.com/macros/s/AKfycbzfNnrpidCbWB1DeUNgXvRhDFMQgApfpn-3C9GU45wMEHcJpWFl8ZQVo6PUBSRfEVfRdg/exec";
  var KEY = "cwOpsHubPass";
  var BOMKEY = "cwBomHubPass";
  var LEGACY = ["cw_sales_auth", "cw_exa_auth", "cw_vio_auth", "cw_ins_auth"];
  var MSGKEY = "cwAuthMsg";
  var ORIGIN = "https://citywidelv.github.io/";
  var HUBS = {
    ops:    ORIGIN + "cw-ops-desk/",
    bom:    ORIGIN + "cw-bom-hub/",
    sales:  ORIGIN + "sales-hub/",
    portal: ORIGIN
  };
  var MSG = {
    locked:  "Enter the team passcode once. This browser stays unlocked until the passcode changes.",
    expired: "The team passcode changed. Enter the new one to continue.",
    offline: "Could not reach the server. Check your connection and try again.",
    wrong:   "That passcode is not right. Ask TJ if you need it."
  };

  function ls(fn){ try { return fn(); } catch(e){ return null; } }
  function getTeam(){
    var v = ls(function(){ return localStorage.getItem(KEY); }) || "";
    if(v) return v;
    for(var i = 0; i < LEGACY.length; i++){
      var k = LEGACY[i];
      v = ls(function(){ return localStorage.getItem(k); }) || "";
      if(v){ setTeam(v); return v; }
    }
    return "";
  }
  function getBom(){ return ls(function(){ return localStorage.getItem(BOMKEY); }) || ""; }
  function setTeam(pass){
    ls(function(){ localStorage.setItem(KEY, pass); });
    LEGACY.forEach(function(k){ ls(function(){ localStorage.removeItem(k); }); });
  }
  function setBom(pass){ ls(function(){ localStorage.setItem(BOMKEY, pass); }); }
  function clearTeam(){
    ls(function(){ localStorage.removeItem(KEY); });
    LEGACY.forEach(function(k){ ls(function(){ localStorage.removeItem(k); }); });
  }
  function clearAll(){ clearTeam(); ls(function(){ localStorage.removeItem(BOMKEY); }); }

  /* Server check. Resolves {ok:true, r} / {ok:false, r} / {ok:null} (unreachable). */
  function validate(pass, kind){
    return fetch(WEBHOOK, { method:"POST", headers:{ "Content-Type":"text/plain" },
      body: JSON.stringify({ kind: kind || "auth", passcode: pass }) })
      .then(function(r){ return r.json(); })
      .then(function(r){
        if(r && r.ok === true) return { ok:true, r:r };
        if(r && (r.ok === false || r.error)) return { ok:false, r:r };
        if(r && (r.sections || r.links || r.cards)) return { ok:true, r:r };
        return { ok:false, r:r };
      })
      .catch(function(){ return { ok:null }; });
  }

  function isPassError(msg){ return !msg || /passcode/i.test(String(msg)); }

  function safeNext(u){
    if(!u) return "";
    u = String(u);
    if(u.indexOf(ORIGIN) !== 0) return "";
    if(/[\s<>"']/.test(u)) return "";
    return u;
  }
  function params(){
    var out = {};
    var q = (location.search || "").replace(/^\?/, "");
    q.split("&").forEach(function(p){
      if(!p) return;
      var i = p.indexOf("=");
      var k = decodeURIComponent(i < 0 ? p : p.slice(0, i));
      var v = decodeURIComponent(i < 0 ? "" : p.slice(i + 1).replace(/\+/g, " "));
      out[k] = v;
    });
    return out;
  }
  function stripParams(){
    if(!/[?&](next|reason)=/.test(location.search)) return;
    var keep = [];
    var p = params();
    Object.keys(p).forEach(function(k){ if(k !== "next" && k !== "reason") keep.push(encodeURIComponent(k) + "=" + encodeURIComponent(p[k])); });
    var url = location.pathname + (keep.length ? "?" + keep.join("&") : "") + location.hash;
    try { history.replaceState(null, "", url); } catch(e){}
  }

  /* Sub page: send the device to its hub gate and come back here afterward. */
  function bounce(hub, reason){
    var base = HUBS[hub] || HUBS.ops;
    var here = location.href;
    location.replace(base + "?next=" + encodeURIComponent(here) + "&reason=" + (reason || "locked"));
  }

  /* Sub page: returns the cached passcode synchronously, or bounces and returns "". */
  function require(opts){
    opts = opts || {};
    var hub = opts.hub || "ops";
    var pass = getTeam();
    if(!pass && hub === "bom") pass = getBom();
    if(!pass){ bounce(hub, "locked"); return ""; }
    return pass;
  }

  /* Sub page: the server rejected something. Passcode problems clear the cache and
     bounce; anything else (offline, server error) shows a bar with a retry. */
  function locked(hub, msg){
    if(isPassError(msg)){
      if(hub === "bom"){ clearAll(); } else { clearTeam(); }
      bounce(hub, "expired");
      return;
    }
    banner(msg);
  }
  function banner(msg){
    var b = document.getElementById("cwAuthBar");
    if(!b){
      b = document.createElement("div");
      b.id = "cwAuthBar";
      b.setAttribute("style", "position:fixed;left:0;right:0;top:0;z-index:9999;background:#2D2A26;color:#fff;font-family:Verdana,'Liberation Sans','DejaVu Sans',Geneva,Tahoma,sans-serif;font-size:13px;line-height:1.4;padding:10px 14px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap");
      document.body.appendChild(b);
    }
    b.innerHTML = "";
    var s = document.createElement("span");
    s.textContent = msg || MSG.offline;
    var r = document.createElement("button");
    r.type = "button";
    r.textContent = "Retry";
    r.setAttribute("style", "background:#D22730;color:#fff;border:0;border-radius:6px;padding:8px 14px;font:inherit;font-weight:bold;cursor:pointer;min-height:36px");
    r.onclick = function(){ location.reload(); };
    b.appendChild(s); b.appendChild(r);
  }

  function signOut(){ clearAll(); ls(function(){ localStorage.removeItem("cwOpsName"); }); location.reload(); }

  /* Hub page gate. Wires an existing passcode box. opts:
       hub: "ops" | "sales" | "bom" | "portal"
       kind: "auth" (default) or "vd_bom_auth"
       input, button, err: element ids of the passcode field, Enter button, error line
       note: optional id of the gate's explanatory line (informational messages go there)
       gate, app: element ids to hide / show (either can be omitted)
       showGate(msg) / hideGate(): optional overrides for pages with custom show/hide
       onUnlock(pass, r): called once the page should render (r may be null when the
         cached passcode has not been re-checked yet)
       onValidated(r): called when the server answer for a cached passcode arrives
  */
  function hubGate(opts){
    opts = opts || {};
    var hub = opts.hub || "ops";
    var kind = opts.kind || "auth";
    var p = params();
    var next = safeNext(p.next);
    var reason = p.reason || "";
    stripParams();
    var el = function(id){ return id ? document.getElementById(id) : null; };
    var input = el(opts.input), button = el(opts.button), err = el(opts.err), note = el(opts.note);
    var gate = el(opts.gate), app = el(opts.app);
    var unlocked = false;

    function say(m){ if(err) err.textContent = m || ""; }
    function inform(m){ if(note && m){ note.textContent = m; say(""); } else say(m); }
    function showGate(m){
      if(opts.showGate) opts.showGate(m);
      else {
        if(gate){ gate.classList.remove("hidden"); gate.style.display = ""; }
        if(app) app.classList.add("hidden");
      }
      say(m);
      if(input){ try { input.focus(); } catch(e){} }
    }
    function hideGate(){
      if(opts.hideGate) opts.hideGate();
      else {
        if(gate){ gate.classList.add("hidden"); gate.style.display = "none"; }
        if(app) app.classList.remove("hidden");
      }
      say("");
    }
    function store(pass, r){
      if(hub === "bom"){ if(r && r.who === "bom") setBom(pass); else setTeam(pass); }
      else setTeam(pass);
    }
    function finish(pass, r){
      if(next){ location.replace(next); return; }
      if(unlocked) return;
      unlocked = true;
      hideGate();
      if(opts.onUnlock) opts.onUnlock(pass, r || null);
    }
    function busy(on){
      if(!button) return;
      button.disabled = !!on;
      if(on){ button.setAttribute("data-label", button.textContent); button.textContent = "Checking..."; }
      else button.textContent = button.getAttribute("data-label") || "Enter";
    }
    function submit(){
      var v = input ? String(input.value || "").trim() : "";
      if(!v){ say("Enter the passcode."); return; }
      busy(true);
      validate(v, kind).then(function(res){
        busy(false);
        if(res.ok === true){ store(v, res.r); finish(v, res.r); }
        else if(res.ok === null){ say(MSG.offline); }
        else { say((res.r && res.r.error && !/wrong passcode/i.test(res.r.error)) ? res.r.error : MSG.wrong); if(input){ input.value = ""; input.focus(); } }
      });
    }
    if(button) button.addEventListener("click", function(e){ e.preventDefault(); submit(); });
    if(input) input.addEventListener("keydown", function(e){ if(e.key === "Enter"){ e.preventDefault(); submit(); } });

    /* Cached passcode: unlock now, confirm in the background. With ?next= we confirm
       first so a rotated passcode never ping-pongs between a sub page and the gate. */
    var cands = [];
    var team = getTeam();
    if(team) cands.push({ pass: team, bom: false });
    if(hub === "bom"){ var bp = getBom(); if(bp) cands.push({ pass: bp, bom: true }); }

    if(!cands.length){
      var m = reason === "expired" ? MSG.expired : (reason === "locked" ? MSG.locked : "");
      var stored = ls(function(){ return sessionStorage.getItem(MSGKEY); });
      if(stored){ m = stored; ls(function(){ sessionStorage.removeItem(MSGKEY); }); }
      showGate("");
      inform(m);
      return;
    }
    if(!next){ hideGate(); unlocked = true; if(opts.onUnlock) opts.onUnlock(cands[0].pass, null); }
    else { showGate("Signing you in..."); busy(true); }

    (function tryNext(i){
      if(i >= cands.length){
        /* Every cached passcode was rejected: it was rotated. */
        busy(false);
        if(hub === "bom") clearAll(); else clearTeam();
        if(!next && unlocked){
          ls(function(){ sessionStorage.setItem(MSGKEY, MSG.expired); });
          location.reload();
          return;
        }
        unlocked = false;
        showGate(MSG.expired);
        return;
      }
      var c = cands[i];
      validate(c.pass, kind).then(function(res){
        if(res.ok === true){
          if(c.bom) setBom(c.pass); else setTeam(c.pass);
          if(next){ busy(false); finish(c.pass, res.r); return; }
          if(opts.onValidated) opts.onValidated(res.r, c.pass);
          return;
        }
        if(res.ok === null){
          /* Offline: keep the optimistic unlock, or send them on to the sub page. */
          if(next){ busy(false); location.replace(next); }
          return;
        }
        if(c.bom){ ls(function(){ localStorage.removeItem(BOMKEY); }); } else { clearTeam(); }
        tryNext(i + 1);
      });
    })(0);
  }

  window.CWAuth = {
    KEY: KEY, BOMKEY: BOMKEY, HUBS: HUBS, MSG: MSG, WEBHOOK: WEBHOOK,
    get: getTeam, getBom: getBom, set: setTeam, clear: clearTeam, clearAll: clearAll,
    validate: validate, require: require, locked: locked, bounce: bounce, banner: banner,
    hubGate: hubGate, signOut: signOut, isPassError: isPassError
  };
})();
