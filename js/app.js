(() => {
"use strict";
/* ---------- utilitaires ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad = n => String(n).padStart(2, "0");
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const toUTC = s => { const [y,m,d] = String(s).split("-").map(Number); return Date.UTC(y, (m||1)-1, d||1); };
const days = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
const addDays = (s, n) => { const t = new Date(toUTC(s) + n*864e5); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth()+1)}-${pad(t.getUTCDate())}`; };
const fmtD = s => { if (!s) return ""; const [y,m,d] = s.split("-"); return `${d}/${m}/${y}`; };
const fmtN = (n, dec = 0) => n == null || n === "" || isNaN(n) ? "" : Number(n).toLocaleString("fr-FR", {minimumFractionDigits: dec, maximumFractionDigits: dec});
const fmtE = n => fmtN(n, 0) + " €";
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const GESTATION = 285, DIAG_APRES = 35, VIDE_ALERTE = 90;
const MOIS = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"];
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
             set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

function tagHTML(num, big) {
  const n = String(num || "").replace(/\s/g, "").toUpperCase();
  if (!n) return '<span class="muted">—</span>';
  let head = n.slice(0, -4), w = n.slice(-4);
  if (/^FR\d{10}$/.test(n)) head = `FR ${n.slice(2,4)} ${n.slice(4,8)} `;
  return `<span class="tag${big ? " big" : ""}">${esc(head)}<b>${esc(w)}</b></span>`;
}

/* ---------- référentiels ---------- */
const RACES = ["Charolaise","Limousine","Blonde d'Aquitaine","Aubrac","Salers","Parthenaise","Rouge des Prés","Gasconne","Bazadaise","Angus","Croisée"];
const CATEGORIES = ["Vache","Génisse","Taureau","Veau","Broutard","Bœuf","Taurillon"];
const STATUTS = ["Présent","Vendu","Mort","Réformé"];
const EV = {
  "Pesée": {g:"prod", f:[["poids","Poids (kg)","number"]]},
  "Chaleur": {g:"repro", f:[]},
  "Saillie / IA": {g:"repro", f:[["methode","Méthode","select",["IA","Saillie naturelle"]],["taureau","Taureau","text"]]},
  "Diagnostic gestation": {g:"repro", f:[["resultat","Résultat","select",["Positive","Négative"]],["methode","Méthode","select",["Échographie","Fouille","Prise de sang"]]]},
  "Vêlage": {g:"repro", f:[["facilite","Facilité de vêlage","select",["1 – Sans aide","2 – Aide facile","3 – Aide difficile","4 – Césarienne","5 – Embryotomie"]],["veauNumero","N° national du veau","text"],["veauNom","Nom du veau","text"],["veauSexe","Sexe du veau","select",["F","M"]],["veauPoids","Poids de naissance (kg)","number"],["veauEtat","État du veau","select",["Vivant","Mort-né"]],["veauLot","Lot du veau","text"]]},
  "Sevrage": {g:"prod", f:[["poids","Poids au sevrage (kg)","number"]]},
  "Avortement": {g:"repro", f:[]},
  "Traitement": {g:"sante", f:[["produit","Produit","text"],["motif","Motif","text"],["dose","Dose / voie","text"],["delaiViande","Délai d'attente viande (jours)","number"],["veterinaire","Vétérinaire","text"],["ordonnance","N° d'ordonnance","text"]]},
  "Vaccination": {g:"sante", f:[["produit","Vaccin","text"],["motif","Maladie visée","text"],["delaiViande","Délai d'attente viande (jours)","number"]]},
  "Note": {g:"note", f:[]},
  "Changement de lot": {g:"lot", f:[], interne:true}, // créé automatiquement, pas dans le formulaire
};
const BULK_OK = ["Traitement","Vaccination","Sevrage","Saillie / IA","Chaleur","Note"];

/* ---------- stockage (IndexedDB sur l'appareil + synchronisation, voir store.js) ---------- */
const S = Store.S;
const COLS_DB = Store.COLS;
let mode = "init", readOnly = false;
const loaded = { animaux:false, evenements:false, finances:false, boucles:false };

async function put(col, id, data, opts = {}) {
  const clean = {}; Object.entries(data).forEach(([k, v]) => { if (k !== "id" && v !== undefined) clean[k] = v; });
  const all = col === "animaux" ? avecVeaux([{col, id, data: clean}]) : [{col, id, data: clean}];
  try { await Store.write([...all, ...lotChangeItems(all, opts.lotDate)]); if (suiveurs(all)) toast(`${suiveurs(all)} veau${suiveurs(all) > 1 ? "x suivent" : " suit"} sa mère dans le lot « ${clean.lot || "sans lot"} ».`); }
  catch (e) { handleErr(e); throw e; }
}
/* veaux sous la mère : tant qu'aucun « Sevrage » n'est saisi, le veau suit sa mère quand elle change de lot.
   Garde-fou : au-delà de AGE_SUIVI_MAX mois (animaux nés avant le suivi du sevrage), il ne suit plus. */
const AGE_SUIVI_MAX = 12;
function veauxSousMere(m) {
  if (!m || !m.numero) return [];
  const n = norm(m.numero), today = todayISO();
  const sevres = new Set([...S.evenements.values()].filter(e => e.type === "Sevrage").map(e => e.animal));
  return presents().filter(k => norm(k.mere) === n && !sevres.has(k.id) && k.naissance && days(k.naissance, today) / 30.4375 < AGE_SUIVI_MAX);
}
function avecVeaux(items, skip) {
  const ids = new Set(items.map(i => i.id)), out = [...items];
  for (const it of items) {
    if (it.col !== "animaux" || it.deleted) continue;
    const old = S.animaux.get(it.id); if (!old) continue;
    const avant = old.lot || "", apres = (it.data && it.data.lot) || "";
    if (avant === apres || (skip && skip(avant, apres))) continue;
    for (const k of veauxSousMere(old)) {
      if (ids.has(k.id) || (k.lot || "") === apres) continue;
      ids.add(k.id); const d = {...k}; delete d.id; if (apres) d.lot = apres; else delete d.lot;
      out.push({col: "animaux", id: k.id, data: d, suit: true});
    }
  }
  return out;
}
const suiveurs = items => items.filter(i => i.suit).length;
/* historique des lots : un évènement « Changement de lot » à chaque fois que le lot d'un animal change */
const LOT_EV = "Changement de lot";
function lotChangeItems(items, date, skip) {
  const out = [], saisi = new Date().toISOString();
  for (const it of items) {
    if (it.col !== "animaux" || it.deleted) continue;
    const avant = S.animaux.get(it.id)?.lot || "", apres = (it.data && it.data.lot) || "";
    if (avant === apres || (skip && skip(avant, apres))) continue;
    out.push({col: "evenements", id: newId(), data: {type: LOT_EV, date: date || todayISO(), animal: it.id, lotAvant: avant, lotApres: apres, saisi}});
  }
  return out;
}
async function del(col, id) {
  try { await Store.del(col, id); } catch (e) { handleErr(e); throw e; }
}
function handleErr(e) {
  const c = e && e.code;
  if (c === "readonly") { readOnly = true; toast("Modification refusée : vous avez un accès en lecture seule."); schedule(); }
  else if (e && e.name === "QuotaExceededError") toast("La mémoire de l'appareil est pleine : libérez de la place pour continuer.");
  else toast("L'enregistrement a échoué sur cet appareil. Réessayez.");
}
function syncState() {
  const st = Store.state;
  mode = st.farm === Store.LOCAL ? "local" : "cloud";
  readOnly = st.role === "viewer";
  COLS_DB.forEach(c => loaded[c] = st.phase === "ready");
}

async function boot() {
  Store.on("change", () => { syncState(); schedule(); planSaillies(); });
  Store.on("status", () => { syncState(); renderStatus(); schedule(); });
  Store.on("message", m => toast(m));
  await Store.init();
  syncState(); schedule();
}

/* ---------- calculs dérivés ---------- */
let D = new Map(), evByAnimal = new Map(), byNumero = new Map();
// âge exact en années, mois et jours révolus entre deux dates « AAAA-MM-JJ »
function ageAMJ(from, to) {
  if (!from || !to || to < from) return null;
  const [y1, m1, d1] = from.split("-").map(Number), [y2, m2, d2] = to.split("-").map(Number);
  // date « anniversaire » après n mois (jour ramené à la fin du mois si besoin : né un 31)
  const after = n => { const t = new Date(Date.UTC(y1, m1 - 1 + n, 1)), last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(Math.min(d1, last))}`; };
  let n = (y2 - y1) * 12 + (m2 - m1);
  while (n > 0 && after(n) > to) n--;
  const d = days(after(n), to), y = Math.floor(n / 12), m = n % 12;
  return {y, m, d, txt: `${pad(y)}/${pad(m)}/${pad(d)}`};
}
function derive() {
  const today = todayISO();
  evByAnimal = new Map();
  for (const e of S.evenements.values()) { if (!evByAnimal.has(e.animal)) evByAnimal.set(e.animal, []); evByAnimal.get(e.animal).push(e); }
  for (const l of evByAnimal.values()) l.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  byNumero = new Map(); for (const a of S.animaux.values()) if (a.numero) byNumero.set(norm(a.numero), a);
  const kidsByMere = new Map();
  for (const k of S.animaux.values()) if (k.mere) { const m = norm(k.mere); if (!kidsByMere.has(m)) kidsByMere.set(m, []); kidsByMere.get(m).push(k); }
  D = new Map();
  for (const a of S.animaux.values()) {
    const evs = evByAnimal.get(a.id) || [];
    const ref = a.statut && a.statut !== "Présent" && a.dateSortie ? a.dateSortie : today;
    const d = { age: a.naissance ? Math.max(0, Math.floor(days(a.naissance, ref) / 30.4375)) : null };
    if (a.naissance) {
      d.ageJours = Math.max(0, days(a.naissance, ref));
      // années révolues : l'anniversaire de cette année est-il passé ?
      const ans = +ref.slice(0, 4) - +a.naissance.slice(0, 4) - (ref.slice(5) < a.naissance.slice(5) ? 1 : 0);
      d.ageAns = Math.max(0, ans);
      d.ageAMJ = ageAMJ(a.naissance, ref);
    }
    // pesées
    const pts = []; if (a.poidsNaissance && a.naissance) pts.push({date: a.naissance, poids: +a.poidsNaissance});
    evs.filter(e => (e.type === "Pesée" || e.type === "Sevrage") && e.poids).forEach(e => pts.push({date: e.date, poids: +e.poids}));
    pts.sort((x, y) => x.date.localeCompare(y.date)); d.pesees = pts;
    if (pts.length) { const l = pts[pts.length-1]; d.poids = l.poids; d.datePesee = l.date;
      if (pts.length > 1) { const p = pts[pts.length-2]; const j = days(p.date, l.date); if (j > 0) d.gmq = Math.round((l.poids - p.poids) / j * 1000); } }
    // reproduction : vêlages saisis + naissances de ses veaux connus (import EDE, saisie d'un veau)
    // sans vêlage saisi ce jour-là ; des jumeaux nés le même jour comptent pour un seul vêlage
    const velagesEv = evs.filter(e => e.type === "Vêlage");
    const kids = a.sexe === "F" && a.numero ? (kidsByMere.get(norm(a.numero)) || []) : [];
    const velDates = new Set(velagesEv.map(e => e.date)), naiss = [];
    for (const k of kids) if (k.naissance && !velDates.has(k.naissance)) { velDates.add(k.naissance); naiss.push({type: "Vêlage", date: k.naissance, naissance: true}); }
    const timeline = naiss.length ? [...evs, ...naiss].sort((x, y) => (x.date || "").localeCompare(y.date || "")) : evs;
    const velages = timeline.filter((e, i, l) => e.type === "Vêlage" && !l.slice(0, i).some(x => x.type === "Vêlage" && x.date === e.date));
    d.nbVelages = velages.length;
    if (velages.length) d.dernierVelage = velages[velages.length-1].date;
    if (velages.length > 1) { let s = 0; for (let i = 1; i < velages.length; i++) s += days(velages[i-1].date, velages[i].date); d.ivv = Math.round(s / (velages.length - 1)); }
    if (a.sexe === "F") {
      let lv = null;
      for (const k of (kidsByMere.get(norm(a.numero)) || [])) if (k.naissance && (!lv || k.naissance > lv.date)) lv = {date:k.naissance, numero:norm(k.numero), nom:k.nom, sexe:k.sexe};
      for (const e of velagesEv) if (!lv || e.date >= lv.date) {
        if (e.veauNumero) { const k = byNumero.get(norm(e.veauNumero)); lv = {date:e.date, numero:norm(e.veauNumero), nom:e.veauNom || k?.nom, sexe:e.veauSexe || k?.sexe}; }
        else if (e.veauEtat === "Mort-né") lv = {date:e.date, mortne:true};
      }
      d.dernierVeau = lv;
    }
    const eligible = a.sexe === "F" && (a.categorie === "Vache" || a.categorie === "Génisse");
    if (eligible) {
      let st = "Vide", ia = null, taureaux = [];
      const sn = e => e.methode === "Saillie naturelle";
      for (const e of timeline) {
        if (e.type === "Vêlage" || e.type === "Avortement") { st = "Vide"; ia = null; taureaux = []; }
        else if (e.type === "Saillie / IA") {
          // taureaux successifs dans le lot : on garde la 1re mise au taureau (vêlage possible au plus tôt)
          if (ia && sn(ia) && sn(e) && (st === "Inséminée" || st === "Gestante")) { if (e.taureau && !taureaux.includes(e.taureau)) taureaux.push(e.taureau); }
          else { st = "Inséminée"; ia = e; taureaux = e.taureau ? [e.taureau] : []; }
        }
        else if (e.type === "Diagnostic gestation") { st = e.resultat === "Positive" ? "Gestante" : "Vide"; if (st === "Vide") ia = null; }
      }
      d.repro = st;
      if (ia && (st === "Gestante" || st === "Inséminée")) { d.velagePrevu = addDays(ia.date, GESTATION); d.dateIA = ia.date; d.taureau = taureaux.join(" puis ") || ia.taureau; d.saillieNat = sn(ia); }
      if (st === "Inséminée" && ia && days(ia.date, today) >= DIAG_APRES) d.aDiagnostiquer = true;
      if (st === "Vide" && d.dernierVelage) d.joursVide = days(d.dernierVelage, today);
    }
    // santé
    const soins = evs.filter(e => e.type === "Traitement" || e.type === "Vaccination");
    if (soins.length) { const l = soins[soins.length-1]; d.dernierTraitement = `${l.produit || l.type} (${fmtD(l.date)})`; }
    let fin = null; soins.forEach(e => { const n = +e.delaiViande; if (n > 0) { const f = addDays(e.date, n); if (!fin || f > fin) fin = f; } });
    d.finDelai = fin; d.enDelai = !!fin && fin >= today && (a.statut || "Présent") === "Présent";
    const sev = evs.filter(e => e.type === "Sevrage"); if (sev.length) d.sevrage = sev[sev.length - 1].date;
    d.sousMere = !d.sevrage && !!a.mere && (a.statut || "Présent") === "Présent" && d.age != null && d.age < AGE_SUIVI_MAX && byNumero.has(norm(a.mere));
    D.set(a.id, d);
  }
}
const norm = n => String(n || "").replace(/\s/g, "").toUpperCase();
const animalLabel = a => a ? `${(a.numero || "").replace(/\s/g,"").slice(-4)}${a.nom ? " · " + a.nom : ""}` : "?";

function reproPill(d) {
  if (!d || !d.repro) return "";
  const cls = {Gestante:"ok", "Inséminée":"info", Vide:"warn"}[d.repro] || "";
  return `<span class="pill ${cls}">${esc(d.repro)}</span>`;
}

/* ---------- colonnes de la liste ---------- */
const COLS = [
  {k:"numero", l:"N° national", fixed:true, v:a=>a.numero, s:a=>norm(a.numero).slice(-4) + norm(a.numero), h:a=>tagHTML(a.numero)},
  {k:"travail", l:"N° travail", v:a=>norm(a.numero).slice(-4), s:a=>norm(a.numero).slice(-4) + norm(a.numero), mono:true},
  {k:"nom", l:"Nom"},
  {k:"sexe", l:"Sexe"},
  {k:"race", l:"Race"},
  {k:"categorie", l:"Catégorie"},
  {k:"lot", l:"Lot"},
  {k:"naissance", l:"Naissance", t:"date"},
  {k:"age", l:"Âge (mois)", t:"num", v:(a,d)=>d.age},
  {k:"ageAns", l:"Âge (AA/MM/JJ)", v:(a,d)=>d.ageAMJ?.txt, s:a=>D.get(a.id)?.ageJours, mono:true},
  {k:"ageJours", l:"Âge (jours)", t:"num", v:(a,d)=>d.ageJours},
  {k:"mere", l:"Mère", v:a=>a.mere, h:a=>{ if (!a.mere) return ""; const nm = byNumero.get(norm(a.mere))?.nom || a.mereNom; return `<span class="mono">${esc(norm(a.mere).slice(-4))}</span>${nm ? " " + esc(nm) : ""}`; }},
  {k:"pere", l:"Père"},
  {k:"origine", l:"Origine"},
  {k:"dateEntree", l:"Date d'entrée", t:"date"},
  {k:"statut", l:"Statut", h:a=>{const s=a.statut||"Présent"; return `<span class="pill ${s==="Présent"?"ok":s==="Mort"?"crit":""}">${esc(s)}</span>`;}},
  {k:"dateSortie", l:"Date de sortie", t:"date"},
  {k:"motifSortie", l:"Motif de sortie"},
  {k:"poids", l:"Dernier poids (kg)", t:"num", v:(a,d)=>d.poids},
  {k:"datePesee", l:"Date pesée", t:"date", v:(a,d)=>d.datePesee},
  {k:"gmq", l:"GMQ (g/j)", t:"num", v:(a,d)=>d.gmq},
  {k:"repro", l:"État repro", v:(a,d)=>d.repro, h:(a,d)=>reproPill(d)},
  {k:"velagePrevu", l:"Vêlage prévu", t:"date", v:(a,d)=>d.velagePrevu},
  {k:"taureau", l:"Taureau / IA", v:(a,d)=>d.taureau},
  {k:"dernierVeau", l:"Dernier veau", v:(a,d)=>d.dernierVeau ? (d.dernierVeau.mortne ? "Mort-né" : d.dernierVeau.numero) : null,
    h:(a,d)=>{ const v = d.dernierVeau; if (!v) return ""; if (v.mortne) return `<span class="pill crit">Mort-né</span> <small class="muted">${fmtD(v.date)}</small>`;
      return `${tagHTML(v.numero)} ${esc(v.nom || "")} <small class="muted">${esc(v.sexe || "")} · ${fmtD(v.date)}</small>`; }},
  {k:"nbVelages", l:"Nb vêlages", t:"num", v:(a,d)=>a.sexe==="F" ? d.nbVelages : null},
  {k:"dernierVelage", l:"Dernier vêlage", t:"date", v:(a,d)=>d.dernierVelage},
  {k:"ivv", l:"IVV moyen (j)", t:"num", v:(a,d)=>d.ivv},
  {k:"dernierTraitement", l:"Dernier traitement", v:(a,d)=>d.dernierTraitement},
  {k:"finDelai", l:"Fin délai viande", t:"date", v:(a,d)=>d.finDelai, h:(a,d)=>d.finDelai ? (d.enDelai ? `<span class="pill crit">${fmtD(d.finDelai)}</span>` : fmtD(d.finDelai)) : ""},
  {k:"prixVente", l:"Prix de vente (€)", t:"num"},
  {k:"notes", l:"Notes", wrap:true},
];
const colVal = (c, a, d) => c.v ? c.v(a, d) : a[c.k];
const DEFAULT_COLS = ["numero","nom","sexe","race","categorie","lot","age","ageAns","ageJours","poids","repro","dernierVeau","velagePrevu","finDelai"];

/* ---------- état de l'interface ---------- */
const UI = ls.get("registre-ui-v1", null) || {};
UI.cols = UI.cols || DEFAULT_COLS.slice();
UI.f = UI.f || {q:"", statut:["Présent"], sexe:[], categorie:[], race:[], lot:[], repro:[], delai:[], ageMin:"", ageMax:""};
UI.sort = UI.sort || {k:"numero", dir:1};
UI.santeYear = UI.santeYear || "Toutes";
if ((UI.v || 1) < 3) { for (const k of ["ageJours", "ageAns"]) if (!UI.cols.includes(k)) { const i = UI.cols.indexOf("age"); UI.cols.splice(i >= 0 ? i + 1 : UI.cols.length, 0, k); } }
if ((UI.v || 1) < 2) { if (!UI.cols.includes("dernierVeau")) { const i = UI.cols.indexOf("repro"); UI.cols.splice(i >= 0 ? i + 1 : UI.cols.length, 0, "dernierVeau"); } UI.v = 2; }
if (UI.v < 3) UI.v = 3;
const saveUI = () => ls.set("registre-ui-v1", {v:UI.v, cols:UI.cols, f:UI.f, sort:UI.sort, santeYear:UI.santeYear, dash:UI.dash});
let selected = new Set();
let view = "tableau";

let pending = false;
function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; render(); }); }

/* ---------- rendu principal ---------- */
function render() {
  const allLoaded = COLS_DB.every(c => loaded[c]);
  document.querySelectorAll("#tabs a").forEach(a => { if (a.dataset.v === view) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current"); });
  const app = $("#app");
  const ph = Store.state.phase;
  if (ph === "login" || ph === "choose") {
    const k = ph + JSON.stringify(Store.state.farms) + (Store.state.user?.email || "");
    if (app.dataset.screen !== k) { app.dataset.screen = k; app.innerHTML = ph === "login" ? vLogin() : vChoose(); }
    renderBulk(); return;
  }
  delete app.dataset.screen;
  if (!allLoaded) { app.innerHTML = `<div class="loading">Chargement du registre…</div>`; renderBulk(); return; }
  derive();
  const keepScroll = $(".tablebox")?.scrollLeft;
  app.innerHTML = banners() + ({tableau:vTableau, animaux:vAnimaux, repro:vRepro, sante:vSante, pesees:vPesees}[view] || vTableau)();
  if (keepScroll && $(".tablebox")) $(".tablebox").scrollLeft = keepScroll;
  renderBulk();
}

function banners() {
  let h = "";
  const st = Store.state;
  if (swWaiting) h += `<div class="banner"><span class="grow"><b>Nouvelle version de l'application disponible.</b></span><button class="btn sm primary" data-act="sw-update">Mettre à jour</button></div>`;
  if (mode === "local") h += Store.configured
    ? `<div class="banner warn"><span class="grow">Mode local : les données restent sur cet appareil uniquement. Connectez-vous pour les partager avec vos autres appareils et vos associés.</span><button class="btn sm" data-act="show-login">Se connecter</button></div>`
    : `<div class="banner warn"><span class="grow">Mode local : les données restent sur cet appareil uniquement. Exportez régulièrement une sauvegarde (menu Compte). La synchronisation entre appareils se règle dans config.js (voir le guide).</span></div>`;
  if (mode === "cloud" && st.authProblem) h += `<div class="banner warn"><span class="grow">Votre session a expiré.${st.pending ? ` ${st.pending} modification${st.pending > 1 ? "s attendent" : " attend"} d'être envoyée${st.pending > 1 ? "s" : ""}.` : ""} Reconnectez-vous pour synchroniser.</span><button class="btn sm" data-act="show-login">Se reconnecter</button></div>`;
  if (mode === "cloud" && st.needsMigration) h += `<div class="banner warn"><span class="grow">Le stock de boucles reste pour l'instant sur cet appareil : la base Supabase doit être mise à jour. ${st.role === "owner" ? "Dans Supabase, relancez le script <b>supabase/schema.sql</b> (SQL Editor → Run), puis rechargez l'application." : "Prévenez le propriétaire de l'exploitation."}</span></div>`;
  if (mode === "cloud" && localN && !readOnly) h += `<div class="banner"><span class="grow">${localN} enregistrement${localN > 1 ? "s" : ""} saisi${localN > 1 ? "s" : ""} en mode local sur cet appareil ${localN > 1 ? "ne sont" : "n'est"} pas dans l'exploitation « ${esc(st.farmName)} ».</span><button class="btn sm primary" data-act="migrate-local">Les ajouter à l'exploitation</button><button class="btn sm" data-act="discard-local">Ignorer</button></div>`;
  if (readOnly) h += `<div class="banner"><span class="grow">Vous consultez ce registre en lecture seule.</span></div>`;
  const ex = [...S.animaux.values(), ...S.evenements.values(), ...S.finances.values()].filter(x => x.exemple).length;
  if (ex && !readOnly) h += `<div class="banner"><span class="grow"><b>Données d'exemple.</b> Le troupeau affiché sert de démonstration. Effacez-le quand vous commencez à saisir vos animaux.</span><button class="btn sm" data-act="clear-examples">Effacer les exemples</button></div>`;
  return h;
}

const presents = () => [...S.animaux.values()].filter(a => (a.statut || "Présent") === "Présent");

function emptyHerd() {
  return `<div class="panel empty"><h3>Aucun animal dans le registre</h3><p>Importez l'inventaire de votre EDE ou ajoutez votre premier bovin avec son numéro national.</p>${readOnly ? "" : `<div class="row" style="justify-content:center"><button class="btn" data-act="import">Importer l'inventaire EDE</button><button class="btn primary" data-act="new-animal">Ajouter un animal</button></div>`}</div>`;
}

/* ---- vêlages d'une année ----
   Compte à la fois les vêlages saisis et les veaux nés sur l'exploitation cette année-là
   (import EDE, saisie d'un animal). Un même vêlage n'est compté qu'une fois : la clé est
   « mère + date », ce qui regroupe aussi les jumeaux ; sans mère connue, le veau compte seul. */
const NE_ICI = o => !o || o === "Né sur l'exploitation";
function velagesAnnee(yr) {
  const keys = new Set();
  for (const e of S.evenements.values()) {
    if (e.type !== "Vêlage" || !(e.date || "").startsWith(yr)) continue;
    const m = S.animaux.get(e.animal);
    keys.add(m && m.numero ? `${norm(m.numero)}|${e.date}` : `e:${e.id}`);
  }
  for (const a of S.animaux.values()) {
    if (!(a.naissance || "").startsWith(yr) || !NE_ICI(a.origine)) continue;
    keys.add(a.mere ? `${norm(a.mere)}|${a.naissance}` : `n:${norm(a.numero) || a.id}`);
  }
  return keys.size;
}

/* ---- notifications à l'EDE (naissances et sorties) ----
   Une naissance ou une sortie saisie dans l'application reste « à notifier » jusqu'à ce qu'on touche « Notifié ».
   Les animaux venus d'un import EDE sont déjà connus de l'EDE. Les évènements antérieurs à NOTIF_DEPUIS
   (mise en service de cette fonction) ne sont pas listés. */
const NOTIF_DEPUIS = "2026-10-01";
const RACE_CODE = n => (Object.entries(RACE_CODES).find(([, r]) => r === n) || [])[0];
function notifState() {
  const today = todayISO(), naiss = [], sorties = [];
  for (const a of S.animaux.values()) {
    if (NE_ICI(a.origine) && a.naissance && a.naissance >= NOTIF_DEPUIS && !a.notifNaissance) naiss.push({a, j: days(a.naissance, today)});
    if ((a.statut || "Présent") !== "Présent" && a.dateSortie && a.dateSortie >= NOTIF_DEPUIS && !a.notifSortie) sorties.push({a, j: days(a.dateSortie, today)});
  }
  naiss.sort((x, y) => y.j - x.j); sorties.sort((x, y) => y.j - x.j);
  return {naiss, sorties};
}
// niveau d'urgence selon l'ancienneté (en jours)
const lvlNaiss = j => j >= 20 ? "crit" : j >= 7 ? "warn" : "info";
const lvlSortie = j => j >= 7 ? "crit" : j >= 3 ? "warn" : "info";
const ilYa = j => j <= 0 ? "aujourd'hui" : j === 1 ? "hier" : `il y a ${j} j`;
const raceTxt = r => r ? `${r}${RACE_CODE(r) ? ` (${RACE_CODE(r)})` : ""}` : "";
function edeTexte(a, kind) {
  if (kind === "sortie") return [`Sortie ${norm(a.numero)}`, `le ${fmtD(a.dateSortie)}`, a.statut, a.motifSortie].filter(Boolean).join(" · ");
  return [`Naissance ${norm(a.numero)}`, `née le ${fmtD(a.naissance)}`, a.sexe === "F" ? "femelle" : a.sexe === "M" ? "mâle" : "", raceTxt(a.race), a.mere && `mère ${norm(a.mere)}`, a.pere && `père ${a.pere}`].filter(Boolean).join(" · ");
}
function edePanel() {
  const {naiss, sorties} = notifState();
  if (!naiss.length && !sorties.length) return "";
  const btns = (a, kind) => `<td class="n" style="white-space:nowrap"><button class="btn ghost sm" data-act="ede-copy" data-k="${kind}" data-id="${esc(a.id)}">Copier</button>${readOnly ? "" : `<button class="btn sm primary" data-act="ede-ok" data-k="${kind}" data-id="${esc(a.id)}">Notifié</button>`}</td>`;
  const jours = (j, lvl) => `<td class="n"><span class="pill ${lvl}">${esc(ilYa(j))}</span></td>`;
  return `<section class="panel" id="ede"><div class="spread" style="margin-bottom:6px"><h3>À notifier à l'EDE</h3><span class="pill warn">${naiss.length + sorties.length}</span></div>
  <p class="hint" style="margin:0 0 10px">Recopiez ces informations sur le site de votre EDE (le bouton « Copier » met la ligne dans le presse-papiers), puis touchez « Notifié ».</p>
  ${naiss.length ? `<div class="spread" style="margin:6px 0"><span class="flabel">Naissances (${naiss.length})</span>${readOnly || naiss.length < 2 ? "" : `<button class="btn sm" data-act="ede-all" data-k="naissance">Tout marquer notifié</button>`}</div>
  <div class="tablebox"><table><thead><tr><th class="first">Veau</th><th>Né le</th><th>Sexe</th><th>Race (code)</th><th>Mère</th><th>Père</th><th class="n">Délai</th><th></th></tr></thead><tbody>
  ${naiss.map(({a, j}) => `<tr data-act="open-animal" data-id="${esc(a.id)}"><td class="first">${tagHTML(a.numero)} ${esc(a.nom || "")}</td><td>${fmtD(a.naissance)}</td><td>${esc(a.sexe || "")}</td><td>${esc(raceTxt(a.race))}</td><td>${a.mere ? tagHTML(a.mere) : `<span class="pill warn">à compléter</span>`}</td><td>${esc(a.pere || "")}</td>${jours(j, lvlNaiss(j))}${btns(a, "naissance")}</tr>`).join("")}
  </tbody></table></div>` : ""}
  ${sorties.length ? `<div class="spread" style="margin:14px 0 6px"><span class="flabel">Sorties (${sorties.length})</span>${readOnly || sorties.length < 2 ? "" : `<button class="btn sm" data-act="ede-all" data-k="sortie">Tout marquer notifié</button>`}</div>
  <div class="tablebox"><table><thead><tr><th class="first">Animal</th><th>Sortie le</th><th>Statut</th><th>Motif</th><th class="n">Délai</th><th></th></tr></thead><tbody>
  ${sorties.map(({a, j}) => `<tr data-act="open-animal" data-id="${esc(a.id)}"><td class="first">${tagHTML(a.numero)} ${esc(a.nom || "")}</td><td>${fmtD(a.dateSortie)}</td><td>${esc(a.statut)}</td><td>${esc(a.motifSortie || "")}</td>${jours(j, lvlSortie(j))}${btns(a, "sortie")}</tr>`).join("")}
  </tbody></table></div>` : ""}
  </section>`;
}
function edeAlerts() {
  const {naiss, sorties} = notifState(), out = [], rank = {crit: 3, warn: 2, info: 1};
  const worst = (l, f) => l.map(x => f(x.j)).sort((p, q) => rank[q] - rank[p])[0];
  if (naiss.length) out.push({lvl: worst(naiss, lvlNaiss), go: "tableau", anchor: "ede", t: `${naiss.length} naissance${naiss.length > 1 ? "s" : ""} à notifier à l'EDE`, s: `La plus ancienne : ${ilYa(naiss[0].j)}`, o: 4});
  if (sorties.length) out.push({lvl: worst(sorties, lvlSortie), go: "tableau", anchor: "ede", t: `${sorties.length} sortie${sorties.length > 1 ? "s" : ""} à notifier à l'EDE`, s: `La plus ancienne : ${ilYa(sorties[0].j)}`, o: 4});
  return out;
}
function edeFiche(a) {
  const lignes = [];
  if (NE_ICI(a.origine) && a.naissance && a.naissance >= NOTIF_DEPUIS) {
    lignes.push(a.notifNaissance
      ? `<div class="row"><span class="pill ok">Naissance notifiée</span><span class="hint">${a.notifNaissance === "EDE" ? "connue de l'EDE (import)" : `le ${fmtD(a.notifNaissance)}`}</span>${readOnly || a.notifNaissance === "EDE" ? "" : `<button class="btn ghost sm" data-act="ede-undo" data-k="naissance" data-id="${esc(a.id)}">Annuler</button>`}</div>`
      : `<div class="row"><span class="pill warn">Naissance à notifier à l'EDE</span>${readOnly ? "" : `<button class="btn sm primary" data-act="ede-ok" data-k="naissance" data-id="${esc(a.id)}">Notifiée</button>`}</div>`);
  }
  if ((a.statut || "Présent") !== "Présent" && a.dateSortie && a.dateSortie >= NOTIF_DEPUIS) {
    lignes.push(a.notifSortie
      ? `<div class="row"><span class="pill ok">Sortie notifiée</span><span class="hint">${a.notifSortie === "EDE" ? "connue de l'EDE (import)" : `le ${fmtD(a.notifSortie)}`}</span>${readOnly || a.notifSortie === "EDE" ? "" : `<button class="btn ghost sm" data-act="ede-undo" data-k="sortie" data-id="${esc(a.id)}">Annuler</button>`}</div>`
      : `<div class="row"><span class="pill warn">Sortie à notifier à l'EDE</span>${readOnly ? "" : `<button class="btn sm primary" data-act="ede-ok" data-k="sortie" data-id="${esc(a.id)}">Notifiée</button>`}</div>`);
  }
  return lignes.length ? `<div class="fgroup"><span class="flabel">EDE</span>${lignes.join("")}</div>` : "";
}
async function edeMark(ids, kind, value) {
  const f = kind === "sortie" ? "notifSortie" : "notifNaissance", items = [];
  for (const id of ids) { const a = S.animaux.get(id); if (!a) continue; const d = {...a}; delete d.id; if (value) d[f] = value; else delete d[f]; items.push({col: "animaux", id, data: d}); }
  try { await Store.write(items); return true; } catch (e) { handleErr(e); return false; }
}

/* ---- vaches âgées (à surveiller pour la réforme) ---- */
const AGE_VIEILLES = 9; // années révolues
function vieillesVaches() {
  return presents().filter(a => a.sexe === "F" && D.get(a.id).ageAMJ && D.get(a.id).ageAMJ.y >= AGE_VIEILLES)
    .sort((x, y) => D.get(y.id).ageJours - D.get(x.id).ageJours);
}
function vieillesPanel() {
  const l = vieillesVaches(); if (!l.length) return "";
  return `<section class="panel attention" id="vieilles"><div class="spread" style="margin-bottom:10px"><h3>⚠ Vaches de plus de ${AGE_VIEILLES} ans <span class="pill warn">${l.length}</span></h3><button class="btn sm" data-act="voir-vieilles">Voir dans la liste</button></div>
  <div class="tablebox"><table><thead><tr><th class="first">Animal</th><th>Nom</th><th>Âge (AA/MM/JJ)</th><th class="n">Vêlages</th><th>Dernier vêlage</th><th>État repro</th><th>Lot</th></tr></thead><tbody>
  ${l.map(a => { const d = D.get(a.id); return `<tr data-act="open-animal" data-id="${esc(a.id)}"><td class="first">${tagHTML(a.numero)}</td><td>${esc(a.nom || "")}</td><td class="mono"><b>${esc(d.ageAMJ.txt)}</b></td><td class="n">${fmtN(d.nbVelages)}</td><td>${fmtD(d.dernierVelage)}</td><td>${reproPill(d)}</td><td>${esc(a.lot || "")}</td></tr>`; }).join("")}
  </tbody></table></div></section>`;
}

/* ---- tableau de bord ---- */
/* ---- tableau de bord personnalisable : blocs, ordre et largeur (réglage propre à chaque appareil) ---- */
const DASH_BLOCS = {
  kpis: "Chiffres clés", vieilles: "Vaches de plus de 9 ans", ede: "À notifier à l'EDE", alertes: "À surveiller",
  effectif: "Effectif par catégorie", lots: "Effectif par lot", velages: "Prochains vêlages", recents: "Derniers évènements",
};
const DASH_DEFAUT = [
  {k: "kpis", on: true, w: "full"}, {k: "vieilles", on: true, w: "full"}, {k: "ede", on: true, w: "full"},
  {k: "alertes", on: true, w: "half"}, {k: "effectif", on: true, w: "half"}, {k: "recents", on: true, w: "full"},
  {k: "velages", on: false, w: "half"}, {k: "lots", on: false, w: "half"},
];
function dashConfig() {
  const cur = Array.isArray(UI.dash) ? UI.dash.filter(x => DASH_BLOCS[x.k]) : [];
  for (const d of DASH_DEFAUT) if (!cur.some(x => x.k === d.k)) cur.push({...d}); // nouveaux blocs ajoutés à la fin
  return cur;
}
function vTableau() {
  const pr = presents(), today = todayISO();
  if (!S.animaux.size) return `<div class="spread"><h2>Tableau de bord</h2></div>` + emptyHerd();
  const byCat = {}; pr.forEach(a => { const c = a.categorie || "Autre"; byCat[c] = (byCat[c] || 0) + 1; });
  const fem = pr.filter(a => D.get(a.id).repro);
  const gest = fem.filter(a => ["Gestante","Inséminée"].includes(D.get(a.id).repro)).length;
  const yr = String(new Date().getFullYear());
  const bars = obj => { const max = Math.max(1, ...Object.values(obj)); return `<div class="bars">${Object.entries(obj).sort((a,b)=>b[1]-a[1]).map(([c,n]) => `<div class="bar"><span>${esc(c)}</span><span class="tr"><i style="width:${n/max*100}%"></i></span><b class="num" style="text-align:right">${n}</b></div>`).join("")}</div>`; };
  const blocs = {
    kpis: () => `<div class="kpis">
      <div class="kpi"><b>${pr.length}</b><span>Animaux présents</span></div>
      <div class="kpi"><b>${byCat["Vache"] || 0}</b><span>Vaches</span></div>
      <div class="kpi"><b>${gest}<small class="muted" style="font-size:.5em"> / ${fem.length}</small></b><span>Gestantes ou IA</span></div>
      <div class="kpi"><b>${velagesAnnee(yr)}</b><span>Vêlages ${yr}</span></div></div>`,
    vieilles: vieillesPanel,
    ede: edePanel,
    alertes: () => { const alerts = buildAlerts();
      return `<section class="panel"><h3>À surveiller</h3>${alerts.length ? `<div class="alerts">${alerts.slice(0, 12).map(alertHTML).join("")}</div>${alerts.length > 12 ? `<p class="hint">+ ${alerts.length - 12} autres alertes dans les onglets Reproduction et Santé.</p>` : ""}` : `<p class="muted">Rien d'urgent : aucun vêlage imminent, diagnostic en retard ni délai d'attente en cours.</p>`}</section>`; },
    effectif: () => `<section class="panel"><h3>Effectif par catégorie</h3>${bars(byCat)}</section>`,
    lots: () => { const l = {}; pr.forEach(a => { const k = a.lot || "Sans lot"; l[k] = (l[k] || 0) + 1; }); return `<section class="panel"><h3>Effectif par lot</h3>${bars(l)}</section>`; },
    velages: () => { const v = pr.filter(a => D.get(a.id).velagePrevu && ["Gestante","Inséminée"].includes(D.get(a.id).repro)).sort((x, y) => D.get(x.id).velagePrevu.localeCompare(D.get(y.id).velagePrevu)).slice(0, 10);
      return `<section class="panel"><h3>Prochains vêlages</h3>${v.length ? `<div class="tablebox"><table><tbody>${v.map(a => { const d = D.get(a.id), j = days(today, d.velagePrevu);
        return `<tr data-act="open-animal" data-id="${esc(a.id)}"><td>${tagHTML(a.numero)} ${esc(a.nom || "")}</td><td>${fmtD(d.velagePrevu)}</td><td>${reproPill(d)}</td><td class="n">${j < 0 ? `<span class="pill crit">${j} j</span>` : `${j} j`}</td></tr>`; }).join("")}</tbody></table></div>` : `<p class="muted">Aucun vêlage prévu.</p>`}</section>`; },
    recents: () => { const recent = [...S.evenements.values()].filter(e => e.type !== LOT_EV).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8);
      return `<section class="panel"><h3>Derniers évènements</h3>${recent.length ? `<div class="timeline">${recent.map(e => evHTML(e, true)).join("")}</div>` : `<p class="muted">Aucun évènement saisi.</p>`}</section>`; },
  };
  const cells = dashConfig().filter(x => x.on).map(x => { const h = blocs[x.k](); return h ? `<div class="${x.w === "half" ? "half" : "full"}" data-bloc="${x.k}">${h}</div>` : ""; }).join("");
  return `
  <div class="spread"><h2>Tableau de bord</h2><div class="row"><button class="btn" data-act="dash-config">Personnaliser</button>${readOnly ? "" : `<button class="btn" data-act="new-event">+ Évènement</button><button class="btn primary" data-act="new-animal">+ Animal</button>`}</div></div>
  <div class="dash">${cells || `<div class="full"><p class="muted">Aucun bloc affiché : touchez « Personnaliser » pour en choisir.</p></div>`}</div>`;
}
function dashDlg() {
  const c = dashConfig();
  openDlg(`<div class="dlg-head"><h3>Personnaliser le tableau de bord</h3><button class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body">
    <p class="hint" style="margin:0">Cochez les blocs à afficher, changez leur ordre avec les flèches et choisissez leur largeur. Deux blocs « demi-largeur » qui se suivent se placent côte à côte (sur téléphone, ils s'affichent l'un sous l'autre). Ce réglage est propre à cet appareil.</p>
    <div class="tablebox"><table><tbody>
    ${c.map((x, i) => `<tr><td style="width:34px"><input type="checkbox" class="dashOn" data-k="${x.k}" ${x.on ? "checked" : ""} aria-label="Afficher ${esc(DASH_BLOCS[x.k])}"></td>
      <td class="wrap"><b>${esc(DASH_BLOCS[x.k])}</b></td>
      <td><select class="search dashW" data-k="${x.k}" style="flex:none;min-width:0;padding:5px 8px" aria-label="Largeur"><option value="full" ${x.w !== "half" ? "selected" : ""}>Pleine largeur</option><option value="half" ${x.w === "half" ? "selected" : ""}>Demi-largeur</option></select></td>
      <td class="n" style="white-space:nowrap"><button class="btn ghost sm" data-act="dash-up" data-k="${x.k}" ${i === 0 ? "disabled" : ""} aria-label="Monter">▲</button><button class="btn ghost sm" data-act="dash-down" data-k="${x.k}" ${i === c.length - 1 ? "disabled" : ""} aria-label="Descendre">▼</button></td></tr>`).join("")}
    </tbody></table></div>
  </div>
  <div class="dlg-foot"><button class="btn" data-act="dash-reset">Disposition par défaut</button><span style="flex:1"></span><button class="btn primary" data-act="close">Terminé</button></div>`);
}
function dashSet(fn) { const c = dashConfig(); fn(c); UI.dash = c; saveUI(); schedule(); dashDlg(); }

function buildAlerts() {
  const today = todayISO(), out = [];
  for (const a of presents()) {
    const d = D.get(a.id);
    if (d.velagePrevu && (d.repro === "Gestante" || d.repro === "Inséminée")) { const j = days(today, d.velagePrevu); if (j <= 30) out.push({lvl: j <= 7 ? "crit" : "warn", a, t:`Vêlage ${d.repro === "Gestante" ? "prévu" : "possible"} ${j < 0 ? `dépassé de ${-j} j` : j === 0 ? "aujourd'hui" : `dans ${j} j`}`, s:`Terme le ${fmtD(d.velagePrevu)}${d.repro === "Inséminée" ? ` (${d.saillieNat ? "saillie naturelle" : "IA"} non confirmée)` : ""}${d.taureau ? ` · ${d.taureau}` : ""}`, o: j}); }
    if (d.aDiagnostiquer) out.push({lvl:"info", a, t:"Diagnostic de gestation à faire", s:`IA / saillie le ${fmtD(d.dateIA)} (${days(d.dateIA, today)} j)`, o: 40});
    if (a.categorie === "Vache" && d.repro === "Vide" && d.joursVide > VIDE_ALERTE) out.push({lvl:"warn", a, t:`Vide depuis ${d.joursVide} j`, s:`Dernier vêlage le ${fmtD(d.dernierVelage)}`, o: 60});
    if (d.enDelai) out.push({lvl:"crit", a, t:"Délai d'attente viande en cours", s:`Ne pas vendre avant le ${fmtD(addDays(d.finDelai, 1))}`, o: 5});
  }
  out.push(...edeAlerts());
  const sb = stockState();
  if (sb.total && sb.dispo.length < BOUCLES_ALERTE) out.push({lvl: sb.dispo.length ? "warn" : "crit", go: "repro", t: sb.dispo.length ? `Stock de boucles bas : ${sb.dispo.length} restante${sb.dispo.length > 1 ? "s" : ""}` : "Plus de boucles en stock pour les veaux", s: "Commandez une nouvelle série auprès de l'EDE", o: 50});
  return out.sort((x, y) => x.o - y.o);
}
const alertHTML = x => x.go ? `<button class="alert ${x.lvl}" data-act="goto-view" data-v="${x.go}" data-anchor="${x.anchor || "stock"}"><span class="t"><b>${esc(x.t)}</b><small>${esc(x.s)}</small></span><span class="muted">›</span></button>` : `<button class="alert ${x.lvl}" data-act="open-animal" data-id="${esc(x.a.id)}"><span class="t"><b>${esc(x.t)}</b><small>${esc(x.s)}</small></span>${tagHTML(x.a.numero)}</button>`;

/* ---- liste des animaux ---- */
function distinct(k) { const s = new Set(); for (const a of S.animaux.values()) { const v = a[k]; if (v) s.add(v); } return [...s].sort((a,b)=>a.localeCompare(b,"fr")); }
function filtered() {
  const f = UI.f, q = f.q.trim().toLowerCase();
  return [...S.animaux.values()].filter(a => {
    const d = D.get(a.id);
    if (f.statut.length && !f.statut.includes(a.statut || "Présent")) return false;
    for (const k of ["sexe","categorie","race","lot"]) if (f[k].length && !f[k].includes(a[k])) return false;
    if (f.repro.length && !f.repro.includes(d.repro || "Sans objet")) return false;
    if (f.delai.length) { const v = d.enDelai ? "En délai d'attente" : "Libre"; if (!f.delai.includes(v)) return false; }
    if (f.ageMin !== "" && (d.age == null || d.age < +f.ageMin)) return false;
    if (f.ageMax !== "" && (d.age == null || d.age > +f.ageMax)) return false;
    if (q) { const hay = [a.numero, a.nom, a.race, a.lot, a.mere, a.pere, a.notes, a.categorie].join(" ").toLowerCase().replace(/\s/g, ""); if (!hay.includes(q.replace(/\s/g, ""))) return false; }
    return true;
  });
}
function sorted(list) {
  const c = COLS.find(x => x.k === UI.sort.k) || COLS[0], dir = UI.sort.dir;
  return list.sort((a, b) => {
    let x = c.s ? c.s(a) : colVal(c, a, D.get(a.id)), y = c.s ? c.s(b) : colVal(c, b, D.get(b.id));
    if (x == null || x === "") return 1; if (y == null || y === "") return -1;
    if (c.t === "num") return (x - y) * dir;
    return String(x).localeCompare(String(y), "fr", {numeric:true}) * dir;
  });
}
function chipGroup(key, label, opts) {
  if (!opts.length) return "";
  return `<div class="fgroup"><span class="flabel">${label}</span><div class="chips">${opts.map(o => `<button class="chip" data-act="chip" data-k="${key}" data-v="${esc(o)}" aria-pressed="${UI.f[key].includes(o)}">${esc(o)}</button>`).join("")}</div></div>`;
}
function vAnimaux() {
  if (!S.animaux.size) return `<div class="spread"><h2>Animaux</h2></div>` + emptyHerd();
  const list = sorted(filtered());
  const cols = COLS.filter(c => c.fixed || UI.cols.includes(c.k));
  const f = UI.f;
  const nActive = ["statut","sexe","categorie","race","lot","repro","delai"].reduce((s,k)=>s+f[k].length,0) + (f.ageMin!==""?1:0) + (f.ageMax!==""?1:0);
  const head = cols.map((c, i) => `<th class="sortable${c.t==="num"?" n":""}${i===0?" first":""}" data-act="sort" data-k="${c.k}" scope="col"${c.k==="numero"?' title="Trié par numéro de travail"':""}>${esc(c.l)}${UI.sort.k===c.k?(UI.sort.dir>0?" ▲":" ▼"):""}</th>`).join("");
  const allSel = list.length && list.every(a => selected.has(a.id));
  const rows = list.map(a => { const d = D.get(a.id);
    return `<tr data-act="open-animal" data-id="${esc(a.id)}" class="${selected.has(a.id)?"sel":""}"><td data-act="noop"><input type="checkbox" aria-label="Sélectionner" data-act="select" data-id="${esc(a.id)}" ${selected.has(a.id)?"checked":""}></td>${cols.map((c,i) => {
      const v = colVal(c, a, d); let h = c.h ? c.h(a, d) : c.t === "date" ? fmtD(v) : c.t === "num" ? fmtN(v) : esc(v);
      if (c.mono) h = `<span class="mono">${h}</span>`;
      return `<td class="${c.t==="num"?"n":""}${i===0?" first":""}${c.wrap?" wrap":""}">${h ?? ""}</td>`; }).join("")}</tr>`; }).join("");
  return `
  <div class="spread"><h2>Animaux <span class="muted num" style="font-size:.6em">${list.length} / ${S.animaux.size}</span></h2>
    <div class="row"><button class="btn" data-act="lots">Lots</button>${readOnly ? "" : `<button class="btn" data-act="import">Importer (EDE, Excel)</button>`}${exportAvail ? `<button class="btn" data-act="export">Exporter CSV</button>` : ""}${readOnly ? "" : `<button class="btn primary" data-act="new-animal">+ Animal</button>`}</div></div>
  <div class="toolbar"><input class="search" id="q" type="search" placeholder="Rechercher un numéro, un nom, une race, un lot…" value="${esc(f.q)}" aria-label="Rechercher"></div>
  <details class="filters" ${UI.openF ? "open" : ""} data-k="openF"><summary>Filtres${nActive ? ` <span class="pill info">${nActive} actif${nActive>1?"s":""}</span>` : ""}</summary>
    <div class="fbody">
      ${chipGroup("statut","Statut",STATUTS)}
      ${chipGroup("sexe","Sexe",["F","M"])}
      ${chipGroup("categorie","Catégorie",CATEGORIES.filter(c=>distinct("categorie").includes(c)).concat(distinct("categorie").filter(c=>!CATEGORIES.includes(c))))}
      ${chipGroup("race","Race",distinct("race"))}
      ${chipGroup("lot","Lot",distinct("lot"))}
      ${chipGroup("repro","État de reproduction",["Gestante","Inséminée","Vide","Sans objet"])}
      ${chipGroup("delai","Délai d'attente viande",["En délai d'attente","Libre"])}
      <div class="fgroup"><span class="flabel">Âge en mois</span><div class="range"><input class="search" type="number" min="0" id="ageMin" placeholder="min" value="${esc(f.ageMin)}" aria-label="Âge minimum"><span>à</span><input class="search" type="number" min="0" id="ageMax" placeholder="max" value="${esc(f.ageMax)}" aria-label="Âge maximum"></div></div>
      <div class="row"><button class="btn sm" data-act="reset-filters">Réinitialiser les filtres</button></div>
    </div></details>
  <details class="filters" ${UI.openC ? "open" : ""} data-k="openC"><summary>Colonnes affichées <span class="pill">${cols.length}</span></summary>
    <div class="fbody"><div class="cols">${COLS.map(c => `<label><input type="checkbox" data-act="col" data-k="${c.k}" ${c.fixed||UI.cols.includes(c.k)?"checked":""} ${c.fixed?"disabled":""}>${esc(c.l)}</label>`).join("")}</div>
    <div class="row"><button class="btn sm" data-act="cols-all">Tout cocher</button><button class="btn sm" data-act="cols-default">Colonnes par défaut</button></div></div></details>
  ${list.length ? `<div class="tablebox"><table><thead><tr><th style="width:34px"><input type="checkbox" aria-label="Tout sélectionner" data-act="select-all" ${allSel?"checked":""}></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
   : `<div class="panel empty"><h3>Aucun animal ne correspond</h3><p>Élargissez les filtres ou la recherche.</p><button class="btn" data-act="reset-filters">Réinitialiser les filtres</button></div>`}`;
}

/* ---- stock de boucles pour les veaux ---- */
// Une boucle est « utilisée » dès qu'un animal ou un vêlage porte son numéro : rien à cocher à la main.
const BOUCLES_ALERTE = 5;
const byNum = (x, y) => x.n.localeCompare(y.n, "fr", {numeric:true});
function stockState() {
  const usedBy = new Map();
  for (const a of S.animaux.values()) if (a.numero) usedBy.set(norm(a.numero), {a});
  for (const e of S.evenements.values()) if (e.type === "Vêlage" && e.veauNumero) { const n = norm(e.veauNumero); if (!usedBy.has(n)) usedBy.set(n, {e}); }
  const dispo = [], used = [], lost = [];
  for (const b of S.boucles.values()) {
    const n = norm(b.numero || b.id), u = usedBy.get(n), x = {b, n, u};
    (u ? used : b.statut === "Perdue" ? lost : dispo).push(x);
  }
  dispo.sort(byNum); used.sort(byNum); lost.sort(byNum);
  return {dispo, used, lost, total: S.boucles.size};
}
const nextTag = () => stockState().dispo[0]?.n || "";
const dlBoucles = () => `<datalist id="dlBoucles">${stockState().dispo.slice(0, 300).map(x => `<option value="${esc(x.n)}">`).join("")}</datalist>`;
function tagSeries(first, n) {
  const m = norm(first).match(/^([A-Z]{2})(\d{8,12})$/); if (!m) return null;
  if (m[1] === "FR" && m[2].length !== 10) return null;
  const out = [], len = m[2].length, start = Number(m[2]);
  for (let i = 0; i < n; i++) { const s = String(start + i).padStart(len, "0"); if (s.length > len) break; out.push(m[1] + s); }
  return out;
}
function stockPanel() {
  const st = stockState(), nd = st.dispo.length, s = (k, one, many) => k > 1 ? many : one;
  const usedRows = [...st.used.map(x => {
      const who = x.u.a ? `${tagHTML(x.u.a.numero)} ${esc(x.u.a.nom || "")}` : `Vêlage de ${esc(animalLabel(S.animaux.get(x.u.e.animal)))}`;
      return `<tr data-act="tag-menu" data-id="${esc(x.b.id)}"><td class="first">${tagHTML(x.n)}</td><td><span class="pill">Utilisée</span></td><td>${who}</td><td>${fmtD(x.u.a ? x.u.a.naissance || x.u.a.dateEntree : x.u.e.date)}</td></tr>`; }),
    ...st.lost.map(x => `<tr data-act="tag-menu" data-id="${esc(x.b.id)}"><td class="first">${tagHTML(x.n)}</td><td><span class="pill crit">Perdue / abîmée</span></td><td></td><td>${fmtD(x.b.perdueLe)}</td></tr>`)].join("");
  return `<section class="panel" id="stock"><div class="spread" style="margin-bottom:10px"><h3>Boucles pour les veaux</h3>${readOnly ? "" : `<button class="btn sm" data-act="add-tags">+ Ajouter des boucles</button>`}</div>
  ${!st.total ? `<p class="muted" style="margin:0">Enregistrez ici les boucles reçues de l'EDE : la prochaine boucle libre sera proposée automatiquement à chaque vêlage.</p>` : `
  <div class="row" style="margin-bottom:10px"><span class="pill ${nd < BOUCLES_ALERTE ? "warn" : "ok"}">${nd} ${s(nd, "disponible", "disponibles")}</span><span class="pill">${st.used.length} ${s(st.used.length, "utilisée", "utilisées")}</span>${st.lost.length ? `<span class="pill crit">${st.lost.length} ${s(st.lost.length, "perdue", "perdues")}</span>` : ""}</div>
  ${nd ? `<p class="hint" style="margin:0 0 8px">Prochaine boucle proposée au vêlage : ${tagHTML(st.dispo[0].n)}</p>
    <div class="chips">${st.dispo.slice(0, 60).map(x => `<button class="tagbtn" data-act="tag-menu" data-id="${esc(x.b.id)}" aria-label="Boucle ${esc(x.n)}">${tagHTML(x.n)}</button>`).join("")}${nd > 60 ? `<span class="muted">+ ${nd - 60} autres</span>` : ""}</div>`
    : `<p class="muted" style="margin:0">Plus aucune boucle disponible : ajoutez la prochaine série reçue de l'EDE.</p>`}
  ${usedRows ? `<details class="filters" data-k="openStock" ${UI.openStock ? "open" : ""} style="margin-top:12px"><summary>Boucles utilisées et perdues</summary><div class="fbody"><div class="tablebox"><table><thead><tr><th class="first">Boucle</th><th>État</th><th>Animal</th><th>Date</th></tr></thead><tbody>${usedRows}</tbody></table></div></div></details>` : ""}`}
  </section>`;
}
function addTagsForm() {
  const all = [...S.boucles.values()].map(b => ({n: norm(b.numero || b.id)})).sort(byNum);
  const sugg = all.length ? (tagSeries(all[all.length - 1].n, 2) || [])[1] || "" : "";
  openDlg(`<form id="fTags">
  <div class="dlg-head"><h3>Ajouter des boucles</h3><button type="button" class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body">
    <p class="hint" style="margin:0">Saisissez le premier numéro de la série reçue de l'EDE et le nombre de boucles : les numéros suivants sont calculés automatiquement.</p>
    <div class="form">${fld("tFirst", "Premier numéro *", inp("tFirst", sugg, "text", 'required placeholder="FR 12 0123 8001" autocomplete="off"'))}${fld("tCount", "Nombre de boucles *", inp("tCount", 20, "number", 'min="1" max="500" step="1" required inputmode="numeric"'))}</div>
    <p id="tPreview" style="margin:0"></p>
  </div>
  <div class="dlg-foot"><button type="button" class="btn" data-act="close">Annuler</button><button class="btn primary" type="submit">Ajouter au stock</button></div>
  </form>`);
  tagsPreview();
}
function tagsList() { return tagSeries($("#tFirst")?.value || "", Math.max(0, Math.min(500, Math.floor(+$("#tCount")?.value || 0)))); }
function tagsPreview() {
  const p = $("#tPreview"); if (!p) return;
  const list = tagsList();
  if (!list) { p.innerHTML = `<span class="hint">Numéro attendu : FR suivi de 10 chiffres, par exemple FR 12 0123 8001.</span>`; return; }
  if (!list.length) { p.innerHTML = ""; return; }
  const known = new Set([...S.boucles.values()].map(b => norm(b.numero || b.id)));
  const dup = list.filter(n => known.has(n)).length, nw = list.length - dup;
  p.innerHTML = `${list.length > 1 ? `De ${tagHTML(list[0])} à ${tagHTML(list[list.length - 1])}` : tagHTML(list[0])} : <b>${nw}</b> boucle${nw > 1 ? "s" : ""} à ajouter${dup ? ` <span class="muted">(${dup} déjà en stock, ignorée${dup > 1 ? "s" : ""})</span>` : ""}.`;
}
async function saveTags() {
  const list = tagsList();
  if (!list || !list.length) return toast("Vérifiez le premier numéro (FR suivi de 10 chiffres) et le nombre de boucles.");
  const known = new Set([...S.boucles.values()].map(b => norm(b.numero || b.id))), today = todayISO();
  const items = list.filter(n => !known.has(n)).map(n => ({col: "boucles", id: n, data: {numero: n, statut: "Disponible", ajoutLe: today}}));
  if (!items.length) return toast("Ces boucles sont déjà toutes dans le stock.");
  try { await Store.write(items); toast(`${items.length} boucle${items.length > 1 ? "s ajoutées" : " ajoutée"} au stock.`); closeDlg(); } catch (e) { handleErr(e); }
}
function tagMenu(id) {
  const b = S.boucles.get(id); if (!b) return closeDlg();
  const n = norm(b.numero || id), x = stockState().used.find(y => y.b.id === id), u = x && x.u, lost = b.statut === "Perdue";
  const etat = u ? (u.a ? `Utilisée par ${esc(animalLabel(u.a))}.` : `Utilisée lors du vêlage de ${esc(animalLabel(S.animaux.get(u.e.animal)))} le ${fmtD(u.e.date)}.`)
    : lost ? `Marquée perdue ou abîmée${b.perdueLe ? ` le ${fmtD(b.perdueLe)}` : ""}.` : `Disponible${b.ajoutLe ? `, ajoutée au stock le ${fmtD(b.ajoutLe)}` : ""}.`;
  openDlg(`<div class="dlg-head"><div class="row">${tagHTML(n, true)}</div><button class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body"><p style="margin:0">${etat}</p></div>
  <div class="dlg-foot">${readOnly ? "" : `<button class="btn danger" data-act="tag-delete" data-id="${esc(id)}">Supprimer du stock</button><span style="flex:1"></span>`}
    ${u && u.a ? `<button class="btn primary" data-act="open-animal" data-id="${esc(u.a.id)}">Voir l'animal</button>`
      : readOnly || u ? "" : lost ? `<button class="btn primary" data-act="tag-restock" data-id="${esc(id)}">Remettre en stock</button>`
      : `<button class="btn" data-act="tag-lost" data-id="${esc(id)}">Perdue / abîmée</button>`}</div>`);
}
async function tagSet(id, change, msg) {
  const b = S.boucles.get(id); if (!b) return;
  const d = {...b, ...change}; delete d.id; Object.keys(d).forEach(k => d[k] === undefined && delete d[k]);
  try { await put("boucles", id, d); toast(msg); closeDlg(); } catch {}
}

/* ---- reproduction ---- */
function vRepro() {
  const today = todayISO();
  const fem = presents().filter(a => D.get(a.id).repro);
  if (!fem.length) return `<h2>Reproduction</h2>${stockPanel()}<div class="panel empty"><h3>Aucune femelle reproductrice</h3><p>Les vaches et génisses présentes apparaîtront ici avec leur état de gestation.</p></div>`;
  const gest = fem.filter(a => D.get(a.id).velagePrevu).sort((a,b)=>D.get(a.id).velagePrevu.localeCompare(D.get(b.id).velagePrevu));
  const diag = fem.filter(a => D.get(a.id).aDiagnostiquer);
  const vides = fem.filter(a => D.get(a.id).repro === "Vide").sort((a,b)=>(D.get(b.id).joursVide||0)-(D.get(a.id).joursVide||0));
  const allV = [...S.evenements.values()].filter(e => e.type === "Vêlage");
  const yr = String(new Date().getFullYear());
  const vAn = allV.filter(e => (e.date||"").startsWith(yr));
  const ivvs = fem.map(a => D.get(a.id).ivv).filter(Boolean);
  const ivv = ivvs.length ? Math.round(ivvs.reduce((s,x)=>s+x,0)/ivvs.length) : null;
  const diff = vAn.filter(e => e.facilite && +e.facilite[0] >= 3).length;
  const morts = vAn.filter(e => e.veauEtat === "Mort-né").length;
  const vaches = fem.filter(a => a.categorie === "Vache").length;
  const row = (a, extra) => `<tr data-act="open-animal" data-id="${esc(a.id)}"><td class="first">${tagHTML(a.numero)}</td><td>${esc(a.nom||"")}</td><td>${esc(a.categorie||"")}</td>${extra}</tr>`;
  return `
  <div class="spread"><h2>Reproduction</h2>${readOnly?"":`<button class="btn primary" data-act="new-event" data-type="Saillie / IA">+ Saillie / IA</button>`}</div>
  <div class="kpis">
    <div class="kpi"><b>${gest.filter(a=>D.get(a.id).repro==="Gestante").length}</b><span>Gestantes confirmées</span></div>
    <div class="kpi"><b>${diag.length}</b><span>À diagnostiquer</span></div>
    <div class="kpi"><b>${vides.length}</b><span>Vides</span></div>
    <div class="kpi"><b>${velagesAnnee(yr)}</b><span>Vêlages ${yr}</span></div>
    <div class="kpi"><b>${ivv ?? "—"}</b><span>IVV moyen (j)</span></div>
    <div class="kpi"><b>${vAn.length ? Math.round(diff/vAn.length*100) : 0}%</b><span>Vêlages difficiles</span></div>
    <div class="kpi"><b>${vAn.length ? Math.round(morts/vAn.length*100) : 0}%</b><span>Mortinatalité</span></div>
  </div>
  ${stockPanel()}
  <section class="panel"><h3>Vêlages prévus</h3><p class="hint">Terme calculé à ${GESTATION} jours après la dernière saillie ou IA.</p>
  ${gest.length ? `<div class="tablebox"><table><thead><tr><th class="first">Animal</th><th>Nom</th><th>Catégorie</th><th>État</th><th>IA / saillie</th><th>Taureau</th><th>Terme</th><th class="n">Jours</th></tr></thead><tbody>${gest.map(a=>{const d=D.get(a.id);const j=days(today,d.velagePrevu);return row(a,`<td>${reproPill(d)}</td><td>${fmtD(d.dateIA)}</td><td>${esc(d.taureau||"")}</td><td>${fmtD(d.velagePrevu)}</td><td class="n">${j<=7?`<span class="pill ${j<0?"crit":"warn"}">${j}</span>`:j}</td>`);}).join("")}</tbody></table></div>` : `<p class="muted">Aucune gestation en cours.</p>`}</section>
  <div class="grid2">
  <section class="panel"><h3>Diagnostics à faire</h3><p class="hint">Inséminées depuis au moins ${DIAG_APRES} jours sans diagnostic.</p>
  ${diag.length ? `<div class="tablebox"><table><thead><tr><th class="first">Animal</th><th>Nom</th><th>Catégorie</th><th>IA le</th><th class="n">Jours</th></tr></thead><tbody>${diag.map(a=>{const d=D.get(a.id);return row(a,`<td>${fmtD(d.dateIA)}</td><td class="n">${days(d.dateIA,today)}</td>`);}).join("")}</tbody></table></div>`:`<p class="muted">Aucun diagnostic en attente.</p>`}</section>
  <section class="panel"><h3>Femelles vides</h3><p class="hint">Alerte au-delà de ${VIDE_ALERTE} jours après vêlage.</p>
  ${vides.length ? `<div class="tablebox"><table><thead><tr><th class="first">Animal</th><th>Nom</th><th>Catégorie</th><th>Dernier vêlage</th><th class="n">Jours vide</th></tr></thead><tbody>${vides.map(a=>{const d=D.get(a.id);return row(a,`<td>${fmtD(d.dernierVelage)}</td><td class="n">${d.joursVide!=null?(d.joursVide>VIDE_ALERTE?`<span class="pill warn">${d.joursVide}</span>`:d.joursVide):"—"}</td>`);}).join("")}</tbody></table></div>`:`<p class="muted">Aucune femelle vide.</p>`}</section>
  </div>
  <section class="panel"><h3>Vêlages enregistrés</h3>${allV.length ? `<div class="tablebox"><table><thead><tr><th class="first">Mère</th><th>Date</th><th>Facilité</th><th>Veau</th><th>Sexe</th><th class="n">Poids (kg)</th><th>État</th></tr></thead><tbody>${allV.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,60).map(e=>{const m=S.animaux.get(e.animal);return `<tr data-act="open-animal" data-id="${esc(e.animal)}"><td class="first">${m?tagHTML(m.numero):"?"}</td><td>${fmtD(e.date)}</td><td>${esc(e.facilite||"")}</td><td>${e.veauNumero?tagHTML(e.veauNumero):""} ${esc(e.veauNom||"")}</td><td>${esc(e.veauSexe||"")}</td><td class="n">${fmtN(e.veauPoids)}</td><td>${e.veauEtat==="Mort-né"?`<span class="pill crit">Mort-né</span>`:esc(e.veauEtat||"")}</td></tr>`;}).join("")}</tbody></table></div>` : `<p class="muted">Aucun vêlage enregistré.</p>`}</section>`;
}

/* ---- santé ---- */
function vSante() {
  const soins = [...S.evenements.values()].filter(e => e.type === "Traitement" || e.type === "Vaccination");
  const years = ["Toutes", ...[...new Set(soins.map(e => (e.date||"").slice(0,4)))].sort().reverse()];
  if (!years.includes(String(UI.santeYear))) UI.santeYear = "Toutes";
  const list = soins.filter(e => UI.santeYear === "Toutes" || (e.date||"").startsWith(UI.santeYear)).sort((a,b)=>b.date.localeCompare(a.date));
  const enDelai = presents().filter(a => D.get(a.id).enDelai);
  return `
  <div class="spread"><h2>Santé</h2>${readOnly?"":`<div class="row"><button class="btn" data-act="new-event" data-type="Vaccination">+ Vaccination</button><button class="btn primary" data-act="new-event" data-type="Traitement">+ Traitement</button></div>`}</div>
  <section class="panel"><h3>Délais d'attente viande en cours</h3>
  ${enDelai.length ? `<div class="alerts">${enDelai.map(a=>{const d=D.get(a.id);return alertHTML({lvl:"crit",a,t:`Interdit à l'abattage jusqu'au ${fmtD(d.finDelai)} inclus`,s:d.dernierTraitement||""});}).join("")}</div>` : `<p class="muted">Aucun animal en délai d'attente : tous peuvent partir à l'abattoir.</p>`}</section>
  <section class="panel"><div class="spread" style="margin-bottom:10px"><h3>Registre des traitements</h3>
    <label class="row hint">Année <select id="santeYear" class="search" style="flex:none;min-width:0;padding:6px 8px">${years.map(y=>`<option ${String(UI.santeYear)===y?"selected":""}>${y}</option>`).join("")}</select></label></div>
  ${list.length ? `<div class="tablebox"><table><thead><tr><th class="first">Date</th><th>Animal</th><th>Type</th><th>Produit</th><th>Motif</th><th>Dose / voie</th><th class="n">Délai (j)</th><th>Fin délai</th><th>Vétérinaire</th><th>Ordonnance</th></tr></thead><tbody>${list.map(e=>{const a=S.animaux.get(e.animal);return `<tr data-act="open-animal" data-id="${esc(e.animal)}"><td class="first">${fmtD(e.date)}</td><td>${a?tagHTML(a.numero):"?"}</td><td>${esc(e.type)}</td><td>${esc(e.produit||"")}</td><td>${esc(e.motif||"")}</td><td>${esc(e.dose||"")}</td><td class="n">${fmtN(e.delaiViande)}</td><td>${+e.delaiViande>0?fmtD(addDays(e.date,+e.delaiViande)):""}</td><td>${esc(e.veterinaire||"")}</td><td class="mono">${esc(e.ordonnance||"")}</td></tr>`;}).join("")}</tbody></table></div>` : `<p class="muted">Aucun traitement enregistré${UI.santeYear!=="Toutes"?" pour cette année":""}.</p>`}
  </section>`;
}

/* ---- pesées ---- */
function vPesees() {
  const pr = presents().filter(a => D.get(a.id).pesees.length);
  const byLot = {};
  pr.forEach(a => { const d = D.get(a.id); if (d.gmq == null) return; const l = a.lot || "Sans lot"; (byLot[l] = byLot[l] || []).push(d.gmq); });
  const lots = Object.entries(byLot).map(([l, v]) => [l, Math.round(v.reduce((s,x)=>s+x,0)/v.length), v.length]).sort((a,b)=>b[1]-a[1]);
  const max = Math.max(1, ...lots.map(x => x[1]));
  const list = pr.sort((a,b)=>(D.get(b.id).datePesee||"").localeCompare(D.get(a.id).datePesee||""));
  return `
  <div class="spread"><h2>Pesées et croissance</h2>${readOnly?"":`<button class="btn primary" data-act="weigh-session">Séance de pesée</button>`}</div>
  ${lots.length ? `<section class="panel"><h3>GMQ moyen par lot</h3><p class="hint">Gain moyen quotidien entre les deux dernières pesées, en grammes par jour.</p><div class="bars">${lots.map(([l,g,n])=>`<div class="bar"><span>${esc(l)} <small class="muted">(${n})</small></span><span class="tr"><i style="width:${Math.max(0,g)/max*100}%"></i></span><b class="num" style="text-align:right">${g}</b></div>`).join("")}</div></section>` : ""}
  <section class="panel"><h3>Dernières pesées</h3>${list.length ? `<div class="tablebox"><table><thead><tr><th class="first">Animal</th><th>Nom</th><th>Lot</th><th class="n">Âge (mois)</th><th>Date</th><th class="n">Poids (kg)</th><th class="n">GMQ (g/j)</th></tr></thead><tbody>${list.map(a=>{const d=D.get(a.id);return `<tr data-act="open-animal" data-id="${esc(a.id)}"><td class="first">${tagHTML(a.numero)}</td><td>${esc(a.nom||"")}</td><td>${esc(a.lot||"")}</td><td class="n">${fmtN(d.age)}</td><td>${fmtD(d.datePesee)}</td><td class="n">${fmtN(d.poids)}</td><td class="n">${fmtN(d.gmq)}</td></tr>`;}).join("")}</tbody></table></div>` : `<div class="empty"><h3>Aucune pesée</h3><p>Lancez une séance de pesée pour saisir les poids d'un lot d'un coup.</p></div>`}</section>`;
}

/* ---------- évènements (affichage) ---------- */
function evDetail(e) {
  const p = [];
  if (e.type === "Pesée") p.push(`${fmtN(e.poids)} kg`);
  if (e.type === "Saillie / IA") p.push([e.methode, e.taureau].filter(Boolean).join(" · "));
  if (e.type === "Diagnostic gestation") p.push([e.resultat, e.methode].filter(Boolean).join(" · "));
  if (e.type === "Vêlage") p.push([e.facilite, e.veauSexe && `veau ${e.veauSexe}`, e.veauPoids && `${e.veauPoids} kg`, e.veauEtat].filter(Boolean).join(" · "));
  if (e.type === "Traitement" || e.type === "Vaccination") p.push([e.produit, e.motif, e.dose, +e.delaiViande > 0 && `attente ${e.delaiViande} j`, e.veterinaire].filter(Boolean).join(" · "));
  if (e.type === LOT_EV) p.push(`${e.lotAvant || "sans lot"} → ${e.lotApres || "sans lot"}`);
  if (e.commentaire) p.push(e.commentaire);
  return p.filter(Boolean).join(" — ");
}
function evHTML(e, withAnimal, canDel) {
  const g = (EV[e.type] || {}).g, a = S.animaux.get(e.animal);
  return `<div class="ev ${g}"><span class="d">${fmtD(e.date)}</span><span class="x"><b>${esc(e.type)}</b>${withAnimal && a ? ` ${tagHTML(a.numero)} ${esc(a.nom||"")}` : ""}<small>${esc(evDetail(e))}</small></span>${canDel && !readOnly ? `<button class="btn ghost sm" data-act="del-event" data-id="${esc(e.id)}" aria-label="Supprimer l'évènement">✕</button>` : withAnimal && a ? `<button class="btn ghost sm" data-act="open-animal" data-id="${esc(a.id)}">Fiche</button>` : ""}</div>`;
}

/* ---------- dialogues ---------- */
const dlg = $("#dlg");
function openDlg(html) { dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); const f = dlg.querySelector("input:not([type=hidden]),select"); }
function closeDlg() { if (dlg.open) dlg.close(); }
dlg.addEventListener("click", e => { if (e.target === dlg) closeDlg(); });

function sparkline(pts) {
  if (pts.length < 2) return "";
  const W = 520, H = 130, L = 36, B = 20, T = 10;
  const t0 = toUTC(pts[0].date), t1 = toUTC(pts[pts.length-1].date) || t0 + 1;
  const mn = 0, mx = Math.ceil(Math.max(...pts.map(p=>p.poids)) / 100) * 100;
  const sx = d => L + (W - L - 10) * (toUTC(d) - t0) / Math.max(1, t1 - t0), sy = v => T + (H - T - B) * (1 - (v - mn) / (mx - mn));
  const line = pts.map(p => `${sx(p.date)},${sy(p.poids)}`).join(" ");
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe de poids">`;
  [0, mx/2, mx].forEach(v => s += `<line x1="${L}" x2="${W-10}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--line)"/><text x="${L-6}" y="${sy(v)+4}" text-anchor="end">${v}</text>`);
  s += `<polygon points="${sx(pts[0].date)},${sy(0)} ${line} ${sx(pts[pts.length-1].date)},${sy(0)}" fill="var(--brand)" opacity=".12"/>`;
  s += `<polyline points="${line}" fill="none" stroke="var(--brand)" stroke-width="2"/>`;
  pts.forEach((p, i) => s += `<circle cx="${sx(p.date)}" cy="${sy(p.poids)}" r="${i===pts.length-1?4.5:3}" fill="${i===pts.length-1?"var(--tag)":"var(--brand)"}" stroke="var(--surface)" stroke-width="1.5"><title>${fmtD(p.date)} : ${p.poids} kg</title></circle>`);
  s += `<text x="${L}" y="${H-4}">${fmtD(pts[0].date)}</text><text x="${W-10}" y="${H-4}" text-anchor="end">${fmtD(pts[pts.length-1].date)}</text>`;
  return s + `</svg>`;
}

function showAnimal(id) {
  const a = S.animaux.get(id); if (!a) return closeDlg();
  derive(); const d = D.get(id), evs = (evByAnimal.get(id) || []).slice().reverse();
  const kids = [...S.animaux.values()].filter(k => a.numero && norm(k.mere) === norm(a.numero));
  const mere = a.mere && byNumero.get(norm(a.mere));
  const info = [["Sexe", a.sexe === "F" ? "Femelle" : a.sexe === "M" ? "Mâle" : ""], ["Race", a.race], ["Catégorie", a.categorie], ["Lot", a.lot],
    ["Naissance", a.naissance ? `${fmtD(a.naissance)} (${d.age} mois)` : ""],
    ["Sevrage", d.sevrage ? fmtD(d.sevrage) : d.sousMere ? "Non sevré (suit sa mère)" : ""],
    ["Âge (AA/MM/JJ)", d.ageAMJ ? `${d.ageAMJ.txt} (${d.ageAMJ.y} an${d.ageAMJ.y > 1 ? "s" : ""}, ${d.ageAMJ.m} mois, ${d.ageAMJ.d} jour${d.ageAMJ.d > 1 ? "s" : ""})` : ""], ["Âge (jours)", a.naissance ? `${fmtN(d.ageJours)} jour${d.ageJours > 1 ? "s" : ""}` : ""], ["Origine", a.origine], ["Entrée", fmtD(a.dateEntree)],
    ["Mère", mere ? `<a href="#" data-act="open-animal" data-id="${esc(mere.id)}">${esc(animalLabel(mere))}</a>` : esc(a.mere ? `${norm(a.mere).slice(-4)}${a.mereNom ? " · " + a.mereNom : ""}` : "")], ["Père", a.pere],
    ["Poids de naissance", a.poidsNaissance ? `${a.poidsNaissance} kg` : ""], ["Dernier poids", d.poids ? `${fmtN(d.poids)} kg (${fmtD(d.datePesee)})` : ""], ["GMQ", d.gmq != null ? `${d.gmq} g/j` : ""],
    ["Vêlages", a.sexe === "F" && d.nbVelages ? `${d.nbVelages}${d.ivv ? ` · IVV ${d.ivv} j` : ""}` : ""], ["Vêlage prévu", fmtD(d.velagePrevu)],
    ["Sortie", a.dateSortie ? `${fmtD(a.dateSortie)}${a.motifSortie ? " · " + a.motifSortie : ""}` : ""], ["Prix de vente", a.prixVente ? fmtE(a.prixVente) : ""]]
    .filter(x => x[1]).map(([k, v]) => `<div><span>${k}</span>${["Mère"].includes(k) ? v : esc(v)}</div>`).join("");
  const s = a.statut || "Présent";
  openDlg(`
  <div class="dlg-head"><div class="row">${tagHTML(a.numero, true)}<h3>${esc(a.nom || "")}</h3></div><button class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body">
    <div class="row"><span class="pill ${s==="Présent"?"ok":s==="Mort"?"crit":""}">${esc(s)}</span>${reproPill(d)}${d.enDelai ? `<span class="pill crit">Délai d'attente jusqu'au ${fmtD(d.finDelai)}</span>` : ""}${d.aDiagnostiquer ? `<span class="pill info">Diagnostic à faire</span>` : ""}</div>
    <div class="info">${info}</div>
    ${lotsSuccessifs(a)}
    ${edeFiche(a)}
    ${a.notes ? `<p style="margin:0">${esc(a.notes)}</p>` : ""}
    ${d.pesees.length > 1 ? `<div><span class="flabel">Croissance</span>${sparkline(d.pesees)}</div>` : ""}
    ${kids.length ? `<div class="fgroup"><span class="flabel">Descendance (${kids.length})</span><div class="chips">${kids.map(k => `<button class="chip" data-act="open-animal" data-id="${esc(k.id)}">${esc(animalLabel(k))}${k.statut && k.statut !== "Présent" ? " · " + esc(k.statut) : ""}</button>`).join("")}</div></div>` : ""}
    <div class="fgroup"><div class="spread"><span class="flabel">Historique (${evs.length})</span>${readOnly ? "" : `<button class="btn sm" data-act="new-event" data-animal="${esc(id)}">+ Évènement</button>`}</div>
    ${evs.length ? `<div class="timeline">${evs.map(e => evHTML(e, false, true)).join("")}</div>` : `<p class="muted">Aucun évènement pour cet animal.</p>`}</div>
  </div>
  ${readOnly ? "" : `<div class="dlg-foot"><button class="btn danger" data-act="ask-del-animal" data-id="${esc(id)}">Supprimer</button><span style="flex:1"></span><button class="btn primary" data-act="edit-animal" data-id="${esc(id)}">Modifier</button></div>`}`);
}

const opt = (list, v) => list.map(o => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("");
function fld(id, label, html, full) { return `<div class="field${full ? " full" : ""}"><label for="${id}">${label}</label>${html}</div>`; }
const inp = (id, v, type = "text", extra = "") => `<input id="${id}" name="${id}" type="${type}" value="${esc(v ?? "")}" ${extra}>`;

function animalForm(id) {
  const a = id ? S.animaux.get(id) : {statut:"Présent", origine:"Né sur l'exploitation", sexe:"F"};
  const lots = distinct("lot"), races = [...new Set([...RACES, ...distinct("race")])];
  openDlg(`
  <form id="fAnimal" data-id="${esc(id || "")}">
  <div class="dlg-head"><h3>${id ? "Modifier l'animal" : "Nouvel animal"}</h3><button type="button" class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body"><div class="form">
    ${fld("numero","N° national *", inp("numero", a.numero, "text", 'required placeholder="FR 12 3456 7890" autocomplete="off"' + (id ? "" : ' list="dlBoucles"')) + (id ? "" : dlBoucles()))}
    ${fld("nom","Nom", inp("nom", a.nom))}
    ${fld("sexe","Sexe", `<select id="sexe" name="sexe">${opt(["F","M"], a.sexe)}</select>`)}
    ${fld("race","Race", inp("race", a.race, "text", 'list="dlRaces"') + `<datalist id="dlRaces">${races.map(r=>`<option value="${esc(r)}">`).join("")}</datalist>`)}
    ${fld("categorie","Catégorie", `<select id="categorie" name="categorie">${opt(CATEGORIES, a.categorie)}</select>`)}
    ${fld("lot","Lot / bâtiment", inp("lot", a.lot, "text", 'list="dlLots"') + `<datalist id="dlLots">${lots.map(r=>`<option value="${esc(r)}">`).join("")}</datalist>`)}
    ${fld("naissance","Date de naissance", inp("naissance", a.naissance, "date"))}
    ${fld("poidsNaissance","Poids de naissance (kg)", inp("poidsNaissance", a.poidsNaissance, "number", 'min="0" step="0.5"'))}
    ${fld("mere","N° de la mère", inp("mere", a.mere, "text", 'list="dlMeres"') + `<datalist id="dlMeres">${[...S.animaux.values()].filter(x=>x.sexe==="F"&&x.numero).map(x=>`<option value="${esc(x.numero)}">${esc(x.nom||"")}</option>`).join("")}</datalist>`)}
    ${fld("pere","Père (nom ou n°)", inp("pere", a.pere))}
    ${fld("origine","Origine", `<select id="origine" name="origine">${opt(["Né sur l'exploitation","Acheté"], a.origine)}</select>`)}
    ${fld("dateEntree","Date d'entrée", inp("dateEntree", a.dateEntree, "date"))}
    ${fld("statut","Statut", `<select id="statut" name="statut">${opt(STATUTS, a.statut || "Présent")}</select>`)}
    ${fld("dateSortie","Date de sortie", inp("dateSortie", a.dateSortie, "date"))}
    ${fld("motifSortie","Motif de sortie", inp("motifSortie", a.motifSortie, "text", 'placeholder="Vente broutard, abattoir, réforme…"'))}
    ${fld("prixVente","Prix de vente (€)", inp("prixVente", a.prixVente, "number", 'min="0" step="1"'))}
    ${fld("notes","Notes", `<textarea id="notes" name="notes">${esc(a.notes || "")}</textarea>`, true)}
  </div></div>
  <div class="dlg-foot"><button type="button" class="btn" data-act="${id ? "back-animal" : "close"}" data-id="${esc(id||"")}">Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div>
  </form>`);
}

function eventForm({animalIds = [], type = "Pesée"} = {}) {
  const bulk = animalIds.length > 1;
  const types = bulk ? BULK_OK : Object.keys(EV).filter(k => !EV[k].interne);
  if (!types.includes(type)) type = types[0];
  const opts = [...S.animaux.values()].filter(a => (a.statut||"Présent")==="Présent").sort((a,b)=>norm(a.numero).slice(-4).localeCompare(norm(b.numero).slice(-4)));
  const one = animalIds.length === 1 ? S.animaux.get(animalIds[0]) : null;
  openDlg(`
  <form id="fEvent" data-ids="${esc(animalIds.join(","))}">
  <div class="dlg-head"><h3>Nouvel évènement</h3><button type="button" class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body">
    ${bulk ? `<p style="margin:0"><b>${animalIds.length} animaux sélectionnés</b> recevront le même évènement.</p>`
      : one ? `<div class="row">${tagHTML(one.numero)} <b>${esc(one.nom||"")}</b></div>`
      : fld("evAnimal","Animal *", `<select id="evAnimal" name="evAnimal" required><option value="">Choisir…</option>${opts.map(a=>`<option value="${esc(a.id)}">${esc(animalLabel(a))} — ${esc(a.categorie||"")}</option>`).join("")}</select>`, true)}
    <div class="form">
      ${fld("evType","Type", `<select id="evType" name="evType">${opt(types, type)}</select>`)}
      ${fld("evDate","Date", inp("evDate", todayISO(), "date", "required"))}
    </div>
    <div class="form" id="evFields">${evFields(type, animalIds.length === 1 ? animalIds[0] : "")}</div>
    ${fld("commentaire","Commentaire", `<textarea id="commentaire" name="commentaire"></textarea>`, true)}
  </div>
  <div class="dlg-foot"><button type="button" class="btn" data-act="close">Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div>
  </form>`);
}
function lotVeau(animalId) { const m = animalId && S.animaux.get(animalId); return m && m.lot ? m.lot : `Veaux ${($("#evDate")?.value || todayISO()).slice(0, 4)}`; }
const evAnimalCourant = () => { const f = $("#fEvent"); return f && f.dataset.ids ? f.dataset.ids.split(",")[0] : $("#evAnimal")?.value || ""; };
function evFields(type, animalId) {
  const fs = (EV[type] || {f:[]}).f;
  let h = fs.map(([k, l, t, o]) => k === "veauLot" ? fld("ef_veauLot", l, `<input id="ef_veauLot" name="veauLot" type="text" list="dlLotsVeau" autocomplete="off" value="${esc(lotVeau(animalId))}"><datalist id="dlLotsVeau">${distinct("lot").map(x => `<option value="${esc(x)}">`).join("")}</datalist>`) : k === "veauNumero" ? fld("ef_" + k, l, `<input id="ef_veauNumero" name="veauNumero" type="text" list="dlBoucles" autocomplete="off" placeholder="FR 12 0123 4567" value="${esc(nextTag())}">${dlBoucles()}`) : fld("ef_" + k, l, t === "select" ? `<select id="ef_${k}" name="${k}">${opt(o, o[0])}</select>` : `<input id="ef_${k}" name="${k}" type="${t}" ${t==="number"?'min="0" step="any"':""}>`)).join("");
  if (type === "Vêlage") { const nd = stockState().dispo.length;
    h += `<p class="hint full" style="grid-column:1/-1;margin:0">Si vous saisissez le numéro d'un veau vivant, il est ajouté automatiquement au troupeau avec sa mère et son père.</p>`;
    h += `<p class="hint full" style="grid-column:1/-1;margin:0">${nd ? `Numéro proposé : la prochaine boucle libre du stock (${nd} disponible${nd > 1 ? "s" : ""}). Effacez-le si le veau n'est pas bouclé, ou scannez sa boucle.` : `Astuce : enregistrez vos boucles dans Reproduction → « Boucles pour les veaux » pour qu'elles soient proposées ici.`}</p>`; }
  if (type === "Traitement") h += `<p class="hint" style="grid-column:1/-1;margin:0">Le délai d'attente bloque l'animal dans les alertes jusqu'à sa date de fin.</p>`;
  return h;
}

function weighSession() {
  const lots = distinct("lot");
  const lot = UI.weighLot && lots.includes(UI.weighLot) ? UI.weighLot : lots[0] || "";
  const list = presents().filter(a => !lot || a.lot === lot).sort((a,b)=>norm(a.numero).slice(-4).localeCompare(norm(b.numero).slice(-4)));
  openDlg(`
  <form id="fWeigh">
  <div class="dlg-head"><h3>Séance de pesée</h3><button type="button" class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body">
    <div class="form">${fld("wLot","Lot", `<select id="wLot">${opt(lots, lot)}</select>`)}${fld("wDate","Date", inp("wDate", todayISO(), "date", "required"))}</div>
    <p class="hint" style="margin:0">Laissez vide les animaux non pesés.</p>
    <div class="tablebox"><table><thead><tr><th>Animal</th><th class="n">Dernier poids</th><th class="n">Poids (kg)</th></tr></thead><tbody>
    ${list.map(a => { const d = D.get(a.id); return `<tr><td>${tagHTML(a.numero)} ${esc(a.nom||"")}</td><td class="n muted">${d.poids ? fmtN(d.poids) : "—"}</td><td class="n"><input type="number" min="0" step="0.5" inputmode="decimal" data-wid="${esc(a.id)}" id="w_${esc(a.id)}" aria-label="Poids ${esc(animalLabel(a))}" style="width:90px;padding:6px 8px;border:1px solid var(--line);border-radius:var(--r);background:var(--bg);text-align:right"></td></tr>`; }).join("")}
    </tbody></table></div>
  </div>
  <div class="dlg-foot"><button type="button" class="btn" data-act="close">Annuler</button><button class="btn primary" type="submit">Enregistrer les pesées</button></div>
  </form>`);
}

function confirmDlg(title, text, act, id, label) {
  openDlg(`<div class="dlg-head"><h3>${esc(title)}</h3><button class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body"><p style="margin:0">${text}</p></div>
  <div class="dlg-foot"><button class="btn" data-act="close">Annuler</button><button class="btn danger solid" data-act="${act}" data-id="${esc(id||"")}">${esc(label)}</button></div>`);
}

/* ---------- enregistrements ---------- */
const val = (f, n) => { const el = f.querySelector(`[name="${n}"],#${n}`); return el ? el.value.trim() : ""; };
const numOrNull = v => v === "" ? undefined : +v;

async function saveAnimal(form) {
  const id = form.dataset.id || newId(), old = S.animaux.get(id) || {};
  const numero = norm(val(form, "numero"));
  if (!numero) return toast("Le numéro national est obligatoire.");
  const dup = [...S.animaux.values()].find(x => x.id !== id && norm(x.numero) === numero);
  if (dup) return toast(`Le numéro ${numero} existe déjà (${animalLabel(dup)}).`);
  const a = {...old, numero, nom: val(form,"nom"), sexe: val(form,"sexe"), race: val(form,"race"), categorie: val(form,"categorie"), lot: val(form,"lot"),
    naissance: val(form,"naissance"), poidsNaissance: numOrNull(val(form,"poidsNaissance")), mere: norm(val(form,"mere")), pere: val(form,"pere"),
    origine: val(form,"origine"), dateEntree: val(form,"dateEntree"), statut: val(form,"statut"), dateSortie: val(form,"dateSortie"),
    motifSortie: val(form,"motifSortie"), prixVente: numOrNull(val(form,"prixVente")), notes: val(form,"notes")};
  if (a.statut !== "Présent" && !a.dateSortie) a.dateSortie = todayISO();
  delete a.id; if (a.poidsNaissance === undefined) delete a.poidsNaissance; if (a.prixVente === undefined) delete a.prixVente;
  try {
    await put("animaux", id, a);
    toast(form.dataset.id ? "Fiche enregistrée" : "Animal ajouté");
    showAnimal(id);
  } catch {}
}

async function saveEvent(form) {
  let ids = form.dataset.ids ? form.dataset.ids.split(",").filter(Boolean) : [];
  if (!ids.length) { const s = val(form, "evAnimal"); if (!s) return toast("Choisissez un animal."); ids = [s]; }
  const type = val(form, "evType"), date = val(form, "evDate");
  const base = {type, date}; const c = val(form, "commentaire"); if (c) base.commentaire = c;
  (EV[type].f || []).forEach(([k, , t]) => { const v = val(form, k); if (v !== "") base[k] = t === "number" ? +v : v; });
  if (type === "Pesée" && !base.poids) return toast("Indiquez le poids.");
  try {
    for (const aid of ids) await put("evenements", newId(), {...base, animal: aid});
    if (type === "Vêlage" && base.veauNumero && base.veauEtat !== "Mort-né") {
      const m = S.animaux.get(ids[0]); derive(); const dm = D.get(ids[0]) || {};
      const vn = norm(base.veauNumero);
      if (![...S.animaux.values()].some(x => norm(x.numero) === vn)) {
        const veau = {numero: vn, nom: base.veauNom || "", sexe: base.veauSexe || "F", race: m?.race || "", categorie: "Veau", lot: val(form, "veauLot") || undefined,
          naissance: date, mere: norm(m?.numero), pere: lastBull(ids[0]) || "", origine: "Né sur l'exploitation", dateEntree: date, statut: "Présent"};
        if (base.veauPoids) veau.poidsNaissance = base.veauPoids;
        await put("animaux", newId(), veau, {lotDate: date});
      }
    }
    if (type === "Vêlage") { const m = S.animaux.get(ids[0]); if (m && m.categorie === "Génisse") await put("animaux", m.id, {...m, categorie: "Vache"}); }
    toast(ids.length > 1 ? `Évènement ajouté à ${ids.length} animaux` : "Évènement enregistré");
    if (ids.length > 1) { selected.clear(); closeDlg(); schedule(); } else { setTimeout(() => showAnimal(ids[0]), 0); }
  } catch {}
}
function lastBull(id) { const evs = (evByAnimal.get(id) || []).filter(e => e.type === "Saillie / IA"); return evs.length ? evs[evs.length-1].taureau : ""; }

async function saveWeigh(form) {
  const date = $("#wDate").value; const inputs = [...form.querySelectorAll("[data-wid]")].filter(i => i.value !== "");
  if (!inputs.length) return toast("Aucun poids saisi.");
  try { for (const i of inputs) await put("evenements", newId(), {type:"Pesée", date, poids:+i.value, animal:i.dataset.wid}); toast(`${inputs.length} pesée${inputs.length>1?"s":""} enregistrée${inputs.length>1?"s":""}`); closeDlg(); } catch {}
}



async function deleteAnimal(id) {
  const evs = evByAnimal.get(id) || [];
  try { for (const e of evs) await del("evenements", e.id); await del("animaux", id); toast("Animal supprimé"); closeDlg(); } catch {}
}
async function clearExamples() {
  closeDlg(); toast("Suppression des exemples…");
  try {
    for (const c of COLS_DB) for (const x of [...S[c].values()].filter(x => x.exemple)) await del(c, x.id);
    toast("Exemples effacés. Le registre est prêt pour vos animaux.");
  } catch {}
}

/* ---------- import inventaire EDE / Excel / CSV ---------- */
const nh = s => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const IMP_FIELDS = [
  {k:"numero", l:"N° national *", syn:["nunati","numeronational","nnational","numnational","nationalid","numeroidentification","nidentification","identifiant","numeroanimal","nanimal","numerobovin","numero","nbovin"], ex:["mere","pere","travail"]},
  {k:"nom", l:"Nom", syn:["nobovi","nomanimal","nom"], ex:["pere","mere","race","eleveur","detenteur"]},
  {k:"sexe", l:"Sexe", syn:["sexbov","sexe"]},
  {k:"race", l:"Race / type racial", syn:["tyrasu","typeracial","race","coderace"], ex:["mere","pere"]},
  {k:"naissance", l:"Date de naissance", syn:["danais","datedenaissance","datenaissance","nele","nea","naissance"], ex:["lieu","pays","poids","mere","pere","commune"]},
  {k:"poidsNaissance", l:"Poids de naissance", syn:["poidsdenaissance","poidsnaissance"]},
  {k:"mere", l:"N° de la mère", syn:["numere","numeromere","nmere","mere"], ex:["race","nom","date","porteuse"]},
  {k:"mereAlt", l:"N° mère porteuse (si mère vide)", syn:["numeip","porteuse"]},
  {k:"mereNom", l:"Nom de la mère", syn:["nomere","nommere"]},
  {k:"pere", l:"Nom du père", syn:["nopere","nompere","pere","taureau"], ex:["race","date","numero","nupere"]},
  {k:"pereNum", l:"N° du père", syn:["nupere","numeropere","npere"]},
  {k:"dateEntree", l:"Date d'entrée", syn:["dateen","datedentree","dateentree","entreele","entree"], ex:["cause","motif","type"]},
  {k:"origine", l:"Cause d'entrée", syn:["causen","causedentree","causeentree","motifentree","typeentree"]},
  {k:"dateSortie", l:"Date de sortie", syn:["dateso","datedesortie","datesortie","sortiele","sortie"], ex:["cause","motif","type","destination"]},
  {k:"motifSortie", l:"Cause de sortie", syn:["causso","causedesortie","causesortie","motifsortie","typesortie"]},
  {k:"lot", l:"Lot / bâtiment", syn:["lot","batiment","atelier"]},
  {k:"categorie", l:"Catégorie", syn:["categorie"]},
];
const RACE_CODES = {"14":"Aubrac","34":"Limousine","38":"Charolaise","39":"Croisée","46":"Montbéliarde","56":"Normande","66":"Prim'Holstein","71":"Parthenaise","79":"Blonde d'Aquitaine"};
let IMP = null;

function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = "vendor/xlsx.full.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
function parseCSV(text) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || "";
  const sep = [";", "\t", ","].map(c => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i+1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim() !== ""));
}
async function readImportFile(file) {
  const buf = await file.arrayBuffer();
  if (/\.(xlsx|xls|ods)$/i.test(file.name)) {
    await loadXLSX();
    const wb = XLSX.read(buf, {type:"array", cellDates:true});
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:""}).filter(r => r.some(x => String(x).trim() !== ""));
  }
  let text; try { text = new TextDecoder("utf-8", {fatal:true}).decode(buf); } catch { text = new TextDecoder("windows-1252").decode(buf); }
  return parseCSV(text.replace(/^﻿/, ""));
}
function autoMap(headers) {
  const map = {}, used = new Set(), H = headers.map(nh);
  for (const f of IMP_FIELDS) {
    let found = -1;
    for (const s of f.syn) { found = H.findIndex((h, i) => !used.has(i) && h && h.includes(s) && !(f.ex || []).some(x => h.includes(x))); if (found >= 0) break; }
    if (found >= 0) { map[f.k] = found; used.add(found); }
  }
  return map;
}
function detectHeader(rows) {
  let best = 0, score = -1;
  rows.slice(0, 20).forEach((r, i) => { const m = autoMap(r.map(String)); const s = Object.keys(m).length + (m.numero != null ? 2 : 0); if (s > score) { score = s; best = i; } });
  return best;
}
function cvDate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())}`;
  if (typeof v === "number" && v > 1000 && v < 80000) { const t = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth()+1)}-${pad(t.getUTCDate())}`; }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); if (m) { let y = +m[3]; if (y < 100) y += y > 50 ? 1900 : 2000; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  return "";
}
function cvNumero(v) {
  let s = String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^\d{10}$/.test(s)) s = "FR" + s;
  return s;
}
function cvSexe(v) { const s = nh(v); if (["2","f","femelle","fem"].includes(s) || s.startsWith("fem")) return "F"; if (["1","m","male","mal"].includes(s) || s.startsWith("mal")) return "M"; return ""; }
function cvRace(v) { const s = String(v ?? "").trim(); if (!s) return ""; const c = s.match(/^\d{1,2}$/); if (c) return RACE_CODES[String(+s)] || `Code ${s}`; const r = RACES.find(x => nh(x) === nh(s) || nh(s).startsWith(nh(x).slice(0, 6))); return r || s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }
function cvOrigine(v) { const s = nh(v); if (!s) return ""; if (s === "n" || s.startsWith("nais") || s.startsWith("ne")) return "Né sur l'exploitation"; if (s === "a" || s.startsWith("ach")) return "Acheté"; if (s === "p") return "Prêt / pension"; return String(v).trim(); }
const SORTIE_CODES = {b:"Boucherie", e:"Vente pour l'élevage", m:"Mort", h:"Autoconsommation", c:"Prêt / pension", x:"Export"};
function cvSortie(v) { const s = nh(v); return SORTIE_CODES[s] || String(v ?? "").trim(); }
function guessCat(sexe, naissance, numero, mothers) {
  const age = naissance ? days(naissance, todayISO()) / 30.4375 : null;
  if (sexe === "F") { if (mothers.has(numero) || (age != null && age >= 36)) return "Vache"; if (age != null && age < 8) return "Veau"; return "Génisse"; }
  if (sexe === "M") { if (age != null && age < 8) return "Veau"; if (age != null && age >= 24) return "Taureau"; return "Broutard"; }
  return "";
}
function impRecords() {
  const {rows, head, map} = IMP, out = [];
  const get = (r, k) => map[k] != null && map[k] !== "" ? r[map[k]] : undefined;
  const body = rows.slice(head + 1);
  const mothers = new Set([...S.animaux.values()].map(a => norm(a.mere)).filter(Boolean));
  body.forEach(r => { const m = cvNumero(get(r, "mere")); if (m) mothers.add(m); });
  for (const r of body) {
    const numero = cvNumero(get(r, "numero"));
    if (!/^[A-Z]{2}\d{8,12}$/.test(numero)) { out.push({bad:true}); continue; }
    const rec = {numero};
    const t = (k, fn) => { const v = get(r, k); if (v === undefined) return; const c = fn ? fn(v) : String(v ?? "").trim(); if (c !== "" && c != null) rec[k] = c; };
    t("nom"); t("sexe", cvSexe); t("race", cvRace); t("naissance", cvDate); t("mere", cvNumero); t("pere");
    t("mereAlt", cvNumero); t("mereNom"); t("pereNum", cvNumero);
    if (!rec.mere && rec.mereAlt) rec.mere = rec.mereAlt; delete rec.mereAlt;
    if (rec.mereNom && (/^\d{1,4}$/.test(rec.mereNom) || !rec.mere)) delete rec.mereNom;
    if (rec.pereNum) { if (!rec.pere) rec.pere = rec.pereNum; else rec.pere = `${rec.pere} (${rec.pereNum.slice(-4)})`; } delete rec.pereNum;
    t("dateEntree", cvDate); t("origine", cvOrigine); t("dateSortie", cvDate); t("motifSortie", cvSortie); t("lot"); t("categorie");
    t("poidsNaissance", v => { const n = parseFloat(String(v).replace(",", ".")); return n > 0 ? n : ""; });
    if (rec.dateSortie) { const m = nh(rec.motifSortie); rec.statut = /mort|equarr/.test(m) ? "Mort" : /bouch|abatt|reform/.test(m) ? "Réformé" : "Vendu"; }
    else rec.statut = "Présent";
    if (!rec.categorie) rec.categorie = guessCat(rec.sexe, rec.naissance, numero, mothers);
    if (!rec.lot && IMP.lot) rec.lot = IMP.lot;
    out.push({rec, existing: byNumero.get(numero)});
  }
  return out;
}
function importDlg() {
  openDlg(`
  <div class="dlg-head"><h3>Importer un inventaire</h3><button class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body">
    <p style="margin:0">Choisissez l'inventaire de votre cheptel exporté depuis le site de votre EDE (Établissement de l'élevage) ou un tableau Excel. Formats acceptés : .xlsx, .xls, .ods, .csv.</p>
    <ol class="hint" style="margin:0;padding-left:18px"><li>Sur le site de votre EDE, ouvrez l'inventaire des bovins de l'exploitation.</li><li>Exportez-le au format Excel ou CSV.</li><li>Sélectionnez le fichier ci-dessous.</li></ol>
    ${fld("impFile", "Fichier", `<input type="file" id="impFile" accept=".csv,.txt,.xlsx,.xls,.ods">`, true)}
    <div id="impZone"></div>
  </div>`);
}
function impZone() {
  const z = $("#impZone"); if (!z || !IMP) return;
  const headers = IMP.rows[IMP.head].map(String);
  const sample = IMP.rows[IMP.head + 1] || [];
  const recs = impRecords();
  const bad = recs.filter(r => r.bad).length, valid = recs.filter(r => !r.bad);
  const nNew = valid.filter(r => !r.existing).length, nEx = valid.length - nNew;
  const nOut = valid.filter(r => r.rec.statut !== "Présent").length;
  const preview = valid.slice(0, 5);
  z.innerHTML = `
  <div class="fgroup"><span class="flabel">Correspondance des colonnes</span><p class="hint" style="margin:0">Les colonnes sont reconnues automatiquement. Corrigez si besoin.</p>
  <div class="form">${IMP_FIELDS.map(f => fld("map_" + f.k, f.l, `<select id="map_${f.k}" class="impMap" data-f="${f.k}"><option value="">— Ignorer —</option>${headers.map((h, i) => `<option value="${i}" ${IMP.map[f.k] === i ? "selected" : ""}>${esc(h || "Colonne " + (i+1))}${sample[i] !== undefined && sample[i] !== "" ? ` (ex. ${esc(String(sample[i] instanceof Date ? cvDate(sample[i]) : sample[i]).slice(0, 18))})` : ""}</option>`).join("")}</select>`)).join("")}</div></div>
  <div class="form">${fld("impLot", "Lot pour les animaux sans lot", `<input id="impLot" value="${esc(IMP.lot || "")}" placeholder="Facultatif" list="dlImpLots"><datalist id="dlImpLots">${distinct("lot").map(l => `<option value="${esc(l)}">`).join("")}</datalist>`)}
    <div class="field"><label>Options</label><label class="row" style="font-size:.92rem;text-transform:none;letter-spacing:0;color:var(--ink);font-weight:400"><input type="checkbox" id="impUpd" ${IMP.upd ? "checked" : ""}> Mettre à jour les animaux déjà présents</label>
    <label class="row" style="font-size:.92rem;text-transform:none;letter-spacing:0;color:var(--ink);font-weight:400"><input type="checkbox" id="impSkipOut" ${IMP.skipOut ? "checked" : ""}> Ignorer les animaux sortis</label></div></div>
  <div class="kpis"><div class="kpi"><b>${nNew}</b><span>Nouveaux</span></div><div class="kpi"><b>${nEx}</b><span>Déjà présents</span></div><div class="kpi"><b>${nOut}</b><span>Sortis</span></div><div class="kpi"><b style="color:${bad ? "var(--warn)" : "inherit"}">${bad}</b><span>Lignes sans n° valide</span></div></div>
  ${preview.length ? `<div class="tablebox"><table><thead><tr><th>N° national</th><th>Sexe</th><th>Race</th><th>Naissance</th><th>Catégorie</th><th>Mère</th><th>Statut</th></tr></thead><tbody>${preview.map(({rec, existing}) => `<tr><td>${tagHTML(rec.numero)}${existing ? ` <span class="pill">existe</span>` : ""}</td><td>${esc(rec.sexe || "")}</td><td>${esc(rec.race || "")}</td><td>${fmtD(rec.naissance)}</td><td>${esc(rec.categorie || "")}</td><td class="mono">${esc((rec.mere || "").slice(-4))}</td><td>${esc(rec.statut)}</td></tr>`).join("")}</tbody></table></div><p class="hint" style="margin:0">Aperçu des ${preview.length} premières lignes. La catégorie est déduite du sexe, de l'âge et de la présence de veaux quand le fichier ne la donne pas.</p>` : `<p class="muted" style="margin:0">Aucun numéro national reconnu. Vérifiez la colonne choisie pour « N° national ».</p>`}
  <div class="row" style="justify-content:flex-end"><button class="btn primary" data-act="do-import" id="impGo" ${valid.length ? "" : "disabled"}>Importer ${valid.length} anima${valid.length > 1 ? "ux" : "l"}</button></div>`;
}
async function onImportFile(input) {
  const file = input.files && input.files[0]; if (!file) return;
  const z = $("#impZone"); z.innerHTML = `<p class="muted">Lecture du fichier…</p>`;
  try {
    const rows = await readImportFile(file);
    if (!rows.length) { z.innerHTML = `<p class="muted">Le fichier est vide.</p>`; return; }
    const head = detectHeader(rows);
    IMP = {rows, head, map: autoMap(rows[head].map(String)), upd: true, skipOut: false, lot: ""};
    impZone();
  } catch { z.innerHTML = `<p style="color:var(--crit)">Impossible de lire ce fichier. Enregistrez-le en .xlsx ou en .csv puis réessayez.</p>`; }
}
async function runImport() {
  const btn = $("#impGo"); if (!btn || btn.disabled) return;
  const recs = impRecords().filter(r => !r.bad && (IMP.upd || !r.existing) && (!IMP.skipOut || r.rec.statut === "Présent"));
  btn.disabled = true; let ok = 0, fail = 0;
  const items = recs.map(({rec, existing}) => {
    const id = existing ? existing.id : newId();
    const data = existing ? {...existing, ...rec} : {...rec};
    delete data.id; delete data.exemple;
    if (existing && existing.statut && !rec.dateSortie && existing.statut !== "Présent") data.statut = existing.statut;
    // présents dans l'inventaire EDE : naissance (et sortie s'il y en a une) déjà connues de l'EDE
    if (!data.notifNaissance) data.notifNaissance = "EDE";
    if (rec.dateSortie && !data.notifSortie) data.notifSortie = "EDE";
    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
    return {col: "animaux", id, data};
  });
  for (let i = 0; i < items.length; i += 100) {
    const part = items.slice(i, i + 100);
    btn.textContent = `Import… ${Math.min(i + 100, items.length)} / ${items.length}`;
    try { await Store.write([...part, ...lotChangeItems(part)]); ok += part.length; } catch (e) { fail += part.length; if (e && e.code === "readonly") { readOnly = true; break; } }
  }
  closeDlg(); IMP = null; schedule();
  toast(fail ? `${ok} animaux importés, ${fail} en échec. Relancez l'import pour compléter.` : `${ok} animaux importés.`);
}

/* ---------- export CSV ---------- */
const exportAvail = true;
function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], {type: mime}));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function exportCSV() {
  const cols = COLS.filter(c => c.fixed || UI.cols.includes(c.k));
  const q = v => { const s = v == null ? "" : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.map(c => q(c.l)).join(";")];
  for (const a of sorted(filtered())) { const d = D.get(a.id); lines.push(cols.map(c => { const v = colVal(c, a, d); return q(c.t === "date" ? fmtD(v) : c.t === "num" && v != null ? String(v).replace(".", ",") : v); }).join(";")); }
  try { download(`troupeau-${todayISO()}.csv`, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8"); }
  catch { toast("Export impossible sur cet appareil."); }
}

/* ---------- application installable, mises à jour ---------- */
const APP_VERSION = "1.11.0";
let swWaiting = null, installEvt = null, localN = 0;
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then(reg => {
      const watch = w => { if (!w) return; w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) { swWaiting = w; schedule(); } }); };
      if (reg.waiting && navigator.serviceWorker.controller) { swWaiting = reg.waiting; schedule(); }
      watch(reg.installing); reg.addEventListener("updatefound", () => watch(reg.installing));
      setInterval(() => reg.update().catch(() => {}), 3600e3);
    }).catch(e => console.warn("service worker", e));
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (swWaiting && !reloading) { reloading = true; location.reload(); } });
}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; });
window.addEventListener("appinstalled", () => { installEvt = null; toast("Application installée sur cet appareil."); });
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function installHTML() {
  if (standalone()) return `<p class="hint" style="margin:0">L'application est installée sur cet appareil.</p>`;
  if (installEvt) return `<div class="row"><button class="btn primary" data-act="install">Installer l'application</button></div>`;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return `<p class="hint" style="margin:0">Pour l'installer sur iPhone : dans Safari, touchez le bouton Partager puis « Sur l'écran d'accueil ».</p>`;
  return `<p class="hint" style="margin:0">Pour l'installer : menu du navigateur (⋮) puis « Installer l'application » ou « Ajouter à l'écran d'accueil ».</p>`;
}

/* ---------- état de synchronisation (en-tête) ---------- */
function statusInfo() {
  const st = Store.state, on = navigator.onLine, n = st.pending, att = `${n} modification${n > 1 ? "s" : ""} en attente`;
  if (!st.farm || st.farm === Store.LOCAL) return {cls: "local", t: "Mode local", d: "Les données restent sur cet appareil."};
  if (!on) return {cls: "off", t: n ? `Hors ligne · ${att}` : "Hors ligne", d: "Les modifications sont enregistrées sur l'appareil et seront envoyées au retour du réseau."};
  if (st.authProblem) return {cls: "warn", t: n ? `Reconnexion nécessaire · ${att}` : "Reconnexion nécessaire", d: "Session expirée."};
  if (n) return {cls: "wait", t: st.syncing ? `Envoi de ${n} modification${n > 1 ? "s" : ""}…` : att, d: "Envoi en cours vers l'exploitation partagée."};
  return {cls: "on", t: "En ligne", d: st.realtime ? "Synchronisé en temps réel avec les autres appareils." : "Synchronisé."};
}
function renderStatus() {
  const el = $("#syncStatus"); if (!el) return;
  const i = statusInfo();
  el.className = "sync " + i.cls; el.title = i.d;
  el.innerHTML = `<i aria-hidden="true"></i><span>${esc(i.t)}</span>`;
  if (mode === "cloud" && !readOnly) Store.localCount().then(n => { if (n !== localN) { localN = n; schedule(); } }).catch(() => {});
  else if (localN) { localN = 0; }
}
window.addEventListener("online", renderStatus);
window.addEventListener("offline", renderStatus);

/* ---------- écrans de connexion et choix de l'exploitation ---------- */
function vLogin() {
  const st = Store.state, back = st.farm;
  return `<div class="auth panel">
    <h2>Connexion</h2>
    <p class="muted" style="margin:0">Connectez-vous pour retrouver le registre de votre exploitation sur tous vos appareils.</p>
    <form id="fLogin" class="form" style="grid-template-columns:1fr">
      ${fld("loginEmail", "Adresse e-mail", `<input id="loginEmail" type="email" autocomplete="username" required value="${esc(st.user?.email || "")}">`)}
      ${fld("loginPw", "Mot de passe", `<input id="loginPw" type="password" autocomplete="current-password" minlength="6" required>`)}
      <div class="row"><button class="btn primary" type="submit">Se connecter</button><button class="btn" type="button" data-act="sign-up">Créer un compte</button><button class="btn ghost sm" type="button" data-act="reset-pw">Mot de passe oublié ?</button></div>
      <p class="hint" id="loginMsg" style="margin:0" role="status"></p>
    </form>
    <hr>
    ${back ? `<button class="btn" data-act="cancel-login">Revenir au registre</button>`
           : `<p class="hint" style="margin:0">Sans compte, le registre fonctionne seul sur cet appareil (vous pourrez le partager plus tard).</p><div class="row"><button class="btn" data-act="use-local">Continuer sans compte</button></div>`}
  </div>`;
}
const ROLES = {owner: "Propriétaire", editor: "Éditeur", viewer: "Lecture seule"};
function vChoose() {
  const st = Store.state;
  return `<div class="auth panel">
    <h2>Exploitation</h2>
    <p class="muted" style="margin:0">Connecté en tant que <b>${esc(st.user?.email || "")}</b>.</p>
    ${st.farms.length ? `<div class="alerts">${st.farms.map(f => `<button class="alert ok" data-act="select-farm" data-id="${esc(f.farm_id)}"><span class="t"><b>${esc(f.name)}</b><small>${ROLES[f.role] || f.role}</small></span><span class="muted">›</span></button>`).join("")}</div>`
      : `<p style="margin:0">Aucune exploitation pour ce compte. Créez la vôtre, ou demandez au propriétaire de vous inviter avec l'adresse <b>${esc(st.user?.email || "")}</b> puis touchez « Actualiser ».</p>`}
    <form id="fFarm" class="form" style="grid-template-columns:1fr">
      ${fld("farmName", "Créer une nouvelle exploitation", `<input id="farmName" required maxlength="120" placeholder="GAEC du Puech, EARL…">`)}
      <div class="row"><button class="btn primary" type="submit">Créer l'exploitation</button><button class="btn" type="button" data-act="refresh-farms">Actualiser</button></div>
    </form>
    <hr>
    <div class="row">${st.farm ? `<button class="btn" data-act="cancel-login">Revenir au registre</button>` : ""}<button class="btn" data-act="use-local">Utiliser sans compte sur cet appareil</button><button class="btn danger" data-act="sign-out">Se déconnecter</button></div>
  </div>`;
}
async function onLogin(form, signup) {
  const email = $("#loginEmail").value.trim(), pw = $("#loginPw").value, msg = $("#loginMsg");
  if (!email || pw.length < 6) { msg.textContent = "Indiquez votre e-mail et un mot de passe d'au moins 6 caractères."; return; }
  if (!navigator.onLine) { msg.textContent = "Pas de connexion internet : la connexion n'est possible qu'en ligne."; return; }
  form.querySelectorAll("button").forEach(b => b.disabled = true); msg.textContent = signup ? "Création du compte…" : "Connexion…";
  try {
    if (signup) {
      const r = await Store.signUp(email, pw);
      msg.textContent = r === "confirm" ? `Compte créé. Ouvrez l'e-mail envoyé à ${email} et cliquez sur le lien de confirmation, puis connectez-vous ici.` : "Compte créé.";
    } else await Store.signIn(email, pw);
  } catch (e) { msg.textContent = e.message; }
  form.querySelectorAll("button").forEach(b => b.disabled = false);
}

/* ---------- menu Compte et sauvegarde ---------- */
function accountDlg() {
  const st = Store.state, cloud = mode === "cloud", i = statusInfo();
  openDlg(`
  <div class="dlg-head"><h3>Compte et sauvegarde</h3><button class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body">
    <section class="fgroup"><span class="flabel">Synchronisation</span>
    ${cloud ? `<div class="info"><div><span>Exploitation</span>${esc(st.farmName)}</div><div><span>Votre rôle</span>${esc(ROLES[st.role] || "")}</div><div><span>Compte</span>${esc(st.user?.email || "")}</div><div><span>État</span>${esc(i.t)}</div></div>
      <div class="row"><button class="btn sm" data-act="sync-now">Synchroniser maintenant</button><button class="btn sm" data-act="switch-farm">Changer d'exploitation</button><button class="btn sm" data-act="change-pw">Changer le mot de passe</button><button class="btn sm danger" data-act="sign-out">Se déconnecter</button></div>
      <form id="fPw" class="row" hidden><input class="search" id="newPw" type="password" minlength="6" autocomplete="new-password" placeholder="Nouveau mot de passe (6 caractères min.)" required><button class="btn sm primary" type="submit">Enregistrer</button></form>`
    : Store.configured ? `<p style="margin:0">Mode local : le registre est enregistré sur cet appareil uniquement.</p><div class="row"><button class="btn sm primary" data-act="show-login">Se connecter à une exploitation</button></div>`
    : `<p style="margin:0">Mode local : le registre est enregistré sur cet appareil uniquement. La synchronisation n'est pas encore réglée (fichier config.js, voir le guide).</p>`}
    </section>
    ${cloud ? `<section class="fgroup"><span class="flabel">Membres de l'exploitation</span><div id="membersZone"><p class="muted" style="margin:0">Chargement…</p></div></section>` : ""}
    <section class="fgroup"><span class="flabel">Sauvegarde</span>
      <p class="hint" style="margin:0">Un fichier contenant tous les animaux, évènements et boucles en stock. Gardez-en régulièrement une copie (clé USB, e-mail…).</p>
      <div class="row"><button class="btn" data-act="backup-export">Exporter une sauvegarde</button>${readOnly ? "" : `<label class="btn" tabindex="0">Restaurer une sauvegarde<input type="file" id="restoreFile" accept=".json,application/json" hidden></label>`}</div>
    </section>
    <section class="fgroup"><span class="flabel">Application</span>
      ${installHTML()}
      <p class="hint" style="margin:0">Lecteur de boucles électroniques (Allflex, Agrident…) : appairez-le en Bluetooth en « mode clavier », puis scannez une boucle : la fiche de l'animal s'ouvre. Pendant une séance de pesée, le curseur se place sur la ligne de l'animal.</p>
      <p class="hint" style="margin:0">Version ${APP_VERSION}</p>
    </section>
  </div>`);
  if (cloud) loadMembers();
}
async function loadMembers() {
  const z = $("#membersZone"); if (!z) return;
  if (!navigator.onLine) { z.innerHTML = `<p class="muted" style="margin:0">Connexion internet nécessaire pour voir et gérer les membres.</p>`; return; }
  let r; try { r = await Store.members(); } catch (e) { z.innerHTML = `<p style="color:var(--crit);margin:0">${esc(e.message)}</p>`; return; }
  const z2 = $("#membersZone"); if (!z2) return;
  const st = Store.state, owner = st.role === "owner";
  const roleSel = (cls, data, v, dis) => `<select class="search ${cls}" ${data} ${dis ? "disabled" : ""} style="flex:none;min-width:0;padding:5px 8px">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  z2.innerHTML = `
    <div class="tablebox"><table><tbody>${r.members.map(m => { const me = m.user_id === st.user?.id;
      return `<tr><td class="wrap">${esc(m.email || "?")}${me ? ` <span class="pill">vous</span>` : ""}</td><td>${owner ? roleSel("memberRole", `data-user="${esc(m.user_id)}"`, m.role, me) : esc(ROLES[m.role])}</td><td class="n">${owner && !me ? `<button class="btn ghost sm" data-act="remove-member" data-id="${esc(m.user_id)}" aria-label="Retirer">✕</button>` : ""}</td></tr>`; }).join("")}
    ${r.invitations.map(v => `<tr><td class="wrap">${esc(v.email)} <span class="pill warn">invitation en attente</span></td><td>${esc(ROLES[v.role])}</td><td class="n"><button class="btn ghost sm" data-act="invite-mail" data-email="${esc(v.email)}" data-role="${esc(v.role)}">E-mail</button><button class="btn ghost sm" data-act="cancel-invite" data-id="${esc(v.id)}" aria-label="Annuler l'invitation">✕</button></td></tr>`).join("")}
    </tbody></table></div>
    ${owner ? `<form id="fInvite" class="form">
      ${fld("invEmail", "Inviter par e-mail", `<input id="invEmail" type="email" required placeholder="associe@exemple.fr">`)}
      ${fld("invRole", "Rôle", roleSel("", 'id="invRole"', "editor"))}
      <div class="field" style="align-self:end"><button class="btn primary" type="submit">Inviter</button></div>
    </form>
    <p class="hint" style="margin:0">Éditeur : peut tout saisir. Lecture seule : consulte sans modifier. Propriétaire : peut aussi gérer les membres. La personne invitée crée son compte avec cette adresse e-mail et accède aussitôt au registre.</p>` : ""}`;
}
function inviteMail(email, role) {
  const url = location.origin + location.pathname;
  const body = `Bonjour,\n\nJe vous invite sur l'application « GAEC Du Mas Rondole », le carnet d'étable du troupeau de l'exploitation « ${Store.state.farmName} » (rôle : ${ROLES[role] || role}).\n\n1. Ouvrez ${url}\n2. Touchez « Créer un compte » avec cette adresse e-mail : ${email}\n3. Confirmez votre adresse avec le lien reçu par e-mail, puis connectez-vous.\n\nLe registre de l'exploitation apparaîtra automatiquement. Vous pouvez ensuite installer l'application depuis le menu du navigateur.\n`;
  location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent("Invitation – GAEC Du Mas Rondole")}&body=${encodeURIComponent(body)}`;
}

/* ---------- sauvegarde / restauration (fichier JSON) ---------- */
function exportBackup() {
  const o = {format: "registre-troupeau", version: 1, exporteLe: new Date().toISOString()};
  if (Store.state.farmName) o.exploitation = Store.state.farmName;
  COLS_DB.forEach(c => { o[c] = Object.fromEntries([...S[c]].map(([k, v]) => { const {id, ...r} = v; return [k, r]; })); });
  try { download(`mas-rondole-${todayISO()}.json`, JSON.stringify(o, null, 1), "application/json"); toast(`Sauvegarde exportée : ${S.animaux.size} animaux, ${S.evenements.size} évènements, ${S.boucles.size} boucles.`); }
  catch { toast("Export impossible sur cet appareil."); }
}
let RESTORE = null;
function parseBackup(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  if (o.format && o.format !== "registre-troupeau") return null;
  if (!COLS_DB.some(c => o[c] && typeof o[c] === "object")) return null;
  const out = {};
  for (const c of COLS_DB) {
    const src = o[c] || {}, m = new Map();
    const entries = Array.isArray(src) ? src.map(x => [x && x.id, x]) : Object.entries(src);
    for (const [k, v] of entries) { if (k == null || k === "" || !v || typeof v !== "object" || Array.isArray(v)) continue; const {id, ...r} = v; m.set(String(k), r); }
    out[c] = m;
  }
  out.present = new Set(COLS_DB.filter(c => o[c] && typeof o[c] === "object"));
  return out;
}
async function onRestoreFile(input) {
  const file = input.files && input.files[0]; if (!file) return;
  let o; try { o = JSON.parse((await file.text()).replace(/^﻿/, "")); } catch { return toast("Ce fichier n'est pas une sauvegarde lisible (JSON invalide)."); }
  RESTORE = parseBackup(o);
  if (!RESTORE) return toast("Ce fichier n'est pas une sauvegarde de l'application.");
  const n = c => RESTORE[c].size;
  openDlg(`<div class="dlg-head"><h3>Restaurer une sauvegarde</h3><button class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body">
    <p style="margin:0">Le fichier <b>${esc(file.name)}</b>${o.exporteLe ? ` (exporté le ${fmtD(String(o.exporteLe).slice(0, 10))})` : ""} contient <b>${n("animaux")}</b> animaux, <b>${n("evenements")}</b> évènements${n("boucles") ? ` et <b>${n("boucles")}</b> boucles en stock` : ""}.</p>
    ${o.version > 1 ? `<p class="hint" style="margin:0">Cette sauvegarde vient d'une version plus récente de l'application ; les informations connues seront restaurées.</p>` : ""}
    <label class="row"><input type="radio" name="restMode" id="restMerge" checked> Fusionner : ajouter et mettre à jour, sans rien supprimer</label>
    <label class="row"><input type="radio" name="restMode" id="restReplace"> Remplacer : le registre actuel (${S.animaux.size} animaux) est remplacé par la sauvegarde</label>
  </div>
  <div class="dlg-foot"><button class="btn" data-act="close">Annuler</button><button class="btn primary" data-act="do-restore" id="restGo">Restaurer</button></div>`);
}
async function doRestore() {
  if (!RESTORE) return; const btn = $("#restGo"); if (btn) btn.disabled = true;
  const replace = !!$("#restReplace")?.checked, items = [];
  for (const c of COLS_DB) {
    for (const [id, d] of RESTORE[c]) items.push({col: c, id, data: d});
    if (replace && RESTORE.present.has(c)) for (const [id, v] of S[c]) if (!RESTORE[c].has(id)) { const {id: _, ...r} = v; items.push({col: c, id, data: r, deleted: true}); }
  }
  try {
    for (let i = 0; i < items.length; i += 300) { if (btn) btn.textContent = `Restauration… ${Math.min(i + 300, items.length)} / ${items.length}`; await Store.write(items.slice(i, i + 300)); }
    toast(`Sauvegarde restaurée : ${RESTORE.animaux.size} animaux, ${RESTORE.evenements.size} évènements.`);
    RESTORE = null; closeDlg();
  } catch (e) { handleErr(e); if (btn) btn.disabled = false; }
}

/* ---------- lecteur de boucles électroniques (mode clavier) ---------- */
function handleScan(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 10) return;
  const last10 = digits.slice(-10);
  const found = [...S.animaux.values()].filter(x => norm(x.numero).replace(/\D/g, "").slice(-10) === last10)
    .sort((x, y) => ((x.statut || "Présent") === "Présent" ? 0 : 1) - ((y.statut || "Présent") === "Présent" ? 0 : 1));
  const a = found[0];
  const vn = dlg.open && $("#ef_veauNumero");
  if (!a && vn) {
    const t = [...S.boucles.values()].map(b => norm(b.numero || b.id)).find(n => n.replace(/\D/g, "").slice(-10) === last10) || "FR" + last10;
    vn.value = t; toast(`N° du veau : ${t}`); return;
  }
  if (!a) { toast(`Boucle lue (…${last10}) : aucun animal du registre ne porte ce numéro.`); return; }
  if (dlg.open && $("#fLot")) {
    const cb = dlg.querySelector(`.lotcb[data-id="${a.id}"]`);
    if (!cb) { toast(`${animalLabel(a)} n'est pas présent dans le troupeau.`); return; }
    cb.checked = true; lotCount();
    const tr = cb.closest("tr"); tr.hidden = false; dlg.querySelectorAll("tr.scan").forEach(r => r.classList.remove("scan")); tr.classList.add("scan"); tr.scrollIntoView({block: "center"});
    toast(`${animalLabel(a)} coché`); return;
  }
  if (dlg.open && $("#fWeigh")) {
    const w = document.getElementById("w_" + a.id);
    if (!w) { toast(`${animalLabel(a)} n'est pas dans ce lot${a.lot ? ` (lot « ${a.lot} »)` : ""}.`); return; }
    dlg.querySelectorAll("tr.scan").forEach(r => r.classList.remove("scan"));
    const tr = w.closest("tr"); tr.classList.add("scan");
    tr.scrollIntoView({block: "center"}); w.focus(); w.select();
    return;
  }
  const evSel = dlg.open && $("#evAnimal");
  if (evSel) { if ([...evSel.options].some(o => o.value === a.id)) { evSel.value = a.id; toast(`Animal choisi : ${animalLabel(a)}`); } else toast(`${animalLabel(a)} n'est pas présent dans le troupeau.`); return; }
  if (dlg.open && dlg.querySelector("form")) { toast(`Boucle lue : ${animalLabel(a)}. Fermez le formulaire pour ouvrir sa fiche.`); return; }
  showAnimal(a.id);
}
if (window.TagScanner) TagScanner.start(handleScan);

/* ---------- saillies naturelles (taureau présent dans le lot) ----------
   Quand un taureau et une femelle de plus d'un an partagent un lot, un évènement « Saillie / IA »
   (méthode « Saillie naturelle ») est créé pour la femelle, daté du début de leur présence commune,
   et jamais avant son dernier vêlage + 30 jours. Un nouvel évènement est créé à chaque nouveau taureau.
   L'identifiant est fixe par femelle, taureau et cycle : pas de doublon, même entre plusieurs appareils. */
// un vêlage moins de SN_DEJA_PLEINE jours après la mise au taureau prouve que la femelle était déjà pleine
const SN_APRES_VELAGE = 30, SN_DEJA_PLEINE = 255;
const estTaureau = a => a.sexe === "M" && a.categorie === "Taureau";
const taureauLabel = t => [t.nom, `(${norm(t.numero).slice(-4)})`].filter(Boolean).join(" ");
// périodes de présence dans les lots : [{lot, debut, fin}] (debut null = inconnu ; fin null = en cours)
function periodesLots(a) {
  const evs = (evByAnimal.get(a.id) || []).filter(e => e.type === LOT_EV).sort((x, y) => (x.date || "").localeCompare(y.date || "") || (x.saisi || "").localeCompare(y.saisi || ""));
  const per = [];
  if (!evs.length) { if (a.lot) per.push({lot: a.lot, debut: null, fin: null}); return per; }
  if (evs[0].lotAvant) per.push({lot: evs[0].lotAvant, debut: null, fin: evs[0].date});
  evs.forEach((e, i) => { if (e.lotApres) per.push({lot: e.lotApres, debut: e.date, fin: evs[i + 1] ? evs[i + 1].date : null}); });
  const sortie = (a.statut || "Présent") !== "Présent" ? a.dateSortie : null;
  if (sortie) per.forEach(p => { if (!p.fin || p.fin > sortie) p.fin = sortie; });
  return per;
}
function velagesDe(f) {
  const s = new Set();
  (evByAnimal.get(f.id) || []).forEach(e => { if (e.type === "Vêlage" && e.date) s.add(e.date); });
  if (f.numero) for (const k of S.animaux.values()) if (k.naissance && norm(k.mere) === norm(f.numero)) s.add(k.naissance);
  return [...s].sort();
}
function sailliesAFaire() {
  const today = todayISO(), out = [];
  const taureaux = [...S.animaux.values()].filter(estTaureau);
  if (!taureaux.length) return out;
  const pt = taureaux.map(t => ({t, per: periodesLots(t)}));
  for (const f of presents()) {
    if (f.sexe !== "F") continue;
    const perF = periodesLots(f); if (!perF.length) continue;
    const vel = velagesDe(f), evs = evByAnimal.get(f.id) || [];
    const resets = [...vel, ...evs.filter(e => e.type === "Avortement" || (e.type === "Diagnostic gestation" && e.resultat !== "Positive")).map(e => e.date)].sort();
    for (const {t, per} of pt) for (const pb of per) for (const pf of perF) {
      if (pb.lot !== pf.lot) continue;
      // période commune ; un début inconnu est remplacé par aujourd'hui (première détection)
      const s = [pb.debut || today, pf.debut || today].sort()[1], e = [pb.fin || today, pf.fin || today, today].sort()[0];
      if (s > e) continue;
      let c = s;
      if (f.naissance) { const an = addDays(f.naissance, 365); if (c < an) c = an; }
      for (let k = 0; k < 6; k++) {
        const r = vel.filter(v => v <= c).pop();
        if (r && c < addDays(r, SN_APRES_VELAGE)) c = addDays(r, SN_APRES_VELAGE);
        const nxt = vel.find(v => v > c);
        if (nxt && days(c, nxt) <= SN_DEJA_PLEINE) { c = nxt; continue; } // déjà pleine à cette date
        break;
      }
      if (c > e || c > today) continue;
      const cycle = resets.filter(x => x <= c).pop() || "0";
      const id = `sn_${f.id}_${t.id}_${cycle}`;
      if (S.evenements.has(id) || Store.DEL.evenements.has(id) || out.some(x => x.id === id)) continue;
      // déjà gestante (diagnostic positif dans ce cycle) ou saillie déjà notée avec ce taureau : rien à ajouter
      const duCycle = evs.filter(x => x.date >= (cycle === "0" ? "" : cycle) && x.date <= c);
      if (duCycle.some(x => x.type === "Diagnostic gestation" && x.resultat === "Positive")) continue;
      if (evs.some(x => x.type === "Saillie / IA" && x.taureauId === t.id && x.date >= (cycle === "0" ? "" : cycle))) continue;
      out.push({col: "evenements", id, data: {type: "Saillie / IA", date: c, animal: f.id, methode: "Saillie naturelle", taureau: taureauLabel(t), taureauId: t.id, lot: pf.lot, auto: true,
        commentaire: `Automatique : taureau présent dans le lot « ${pf.lot} »`}});
    }
  }
  return out;
}
// saillies automatiques devenues fausses : taureau finalement absent du lot à cette date (saisie après coup),
// ou vêlage survenu trop tôt après (la femelle était déjà pleine) : elle repart alors à vêlage + 30 jours
function sailliesInvalides() {
  const out = [];
  for (const e of S.evenements.values()) {
    if (!e.auto || e.type !== "Saillie / IA" || !e.taureauId) continue;
    const f = S.animaux.get(e.animal), t = S.animaux.get(e.taureauId); if (!f || !t) continue;
    const dans = (per, d) => per.some(p => p.lot === e.lot && (!p.debut || p.debut <= d) && (!p.fin || p.fin >= d));
    const pleine = velagesDe(f).some(v => v > e.date && days(e.date, v) <= SN_DEJA_PLEINE);
    if (!pleine && dans(periodesLots(t), e.date) && dans(periodesLots(f), e.date)) continue;
    const d = {...e}; delete d.id; out.push({col: "evenements", id: e.id, data: d, deleted: true, pleine});
  }
  return out;
}
let snT = null, snBusy = false;
function planSaillies() {
  clearTimeout(snT);
  snT = setTimeout(async () => {
    if (snBusy || readOnly || Store.state.phase !== "ready") return;
    derive(); const del = sailliesInvalides();
    if (del.length) { del.forEach(x => S.evenements.delete(x.id)); derive(); del.forEach(x => S.evenements.set(x.id, {...x.data, id: x.id})); }
    const add = sailliesAFaire().filter(x => !del.some(y => y.id === x.id)), items = [...del, ...add]; if (!items.length) return;
    snBusy = true;
    try { await Store.write(items);
      toast([add.length && `${add.length} saillie${add.length > 1 ? "s naturelles enregistrées" : " naturelle enregistrée"} (taureau présent dans le lot)`, del.filter(x => x.pleine).length && `${del.filter(x => x.pleine).length} saillie${del.filter(x => x.pleine).length > 1 ? "s annulées" : " annulée"} (vêlage survenu : la vache était déjà pleine, nouvelle saillie comptée à vêlage + 30 j)`,
      del.filter(x => !x.pleine).length && `${del.filter(x => !x.pleine).length} saillie${del.filter(x => !x.pleine).length > 1 ? "s automatiques retirées" : " automatique retirée"} (taureau absent du lot à cette date)`].filter(Boolean).join(" · ") + "."); }
    catch (e) { console.warn("saillies", e); } finally { snBusy = false; }
  }, 1500);
}
// historique des taureaux d'un lot : [{t, debut, fin}]
function taureauxDuLot(lot) {
  const out = [];
  for (const t of S.animaux.values()) if (estTaureau(t)) for (const p of periodesLots(t)) if (p.lot === lot) out.push({t, debut: p.debut, fin: p.fin});
  return out.sort((x, y) => (x.debut || "").localeCompare(y.debut || ""));
}
function taureauxTxt(lot) {
  return taureauxDuLot(lot).map(x => `${x.fin ? "" : "<b>"}${esc(taureauLabel(x.t))}${x.fin ? "" : "</b>"} <small class="muted">${x.debut ? (x.fin ? `du ${fmtD(x.debut)} au ${fmtD(x.fin)}` : `depuis le ${fmtD(x.debut)}`) : x.fin ? `jusqu'au ${fmtD(x.fin)}` : "présent"}</small>`).join("<br>");
}

/* ---------- lots ---------- */
// Un lot existe dès qu'au moins un animal y est rangé (champ « lot » de l'animal) : rien d'autre à stocker.
const byTravail = (x, y) => norm(x.numero).slice(-4).localeCompare(norm(y.numero).slice(-4));
function lotsInfo() {
  const m = new Map();
  for (const a of presents()) if (a.lot) { if (!m.has(a.lot)) m.set(a.lot, []); m.get(a.lot).push(a); }
  return [...m.entries()].sort((x, y) => x[0].localeCompare(y[0], "fr", {numeric: true}));
}
function compo(list) {
  const c = {}; list.forEach(a => { const k = a.categorie || "Autre"; c[k] = (c[k] || 0) + 1; });
  return Object.entries(c).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${n} ${k.toLowerCase()}${n > 1 && !/[sx]$/.test(k) ? (/au$/.test(k) ? "x" : "s") : ""}`).join(" · ");
}
function lotsDlg() {
  const l = lotsInfo(), sans = presents().filter(a => !a.lot).length;
  openDlg(`<div class="dlg-head"><h3>Lots</h3><button class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body">
    ${l.length ? `<div class="tablebox"><table><thead><tr><th>Lot</th><th class="n">Animaux</th><th>Composition</th><th>Taureau</th><th></th></tr></thead><tbody>
      ${l.map(([n, as]) => `<tr data-act="lot-voir" data-lot="${esc(n)}"><td><b>${esc(n)}</b></td><td class="n">${as.length}</td><td class="wrap">${esc(compo(as))}</td><td class="wrap">${taureauxTxt(n)}</td><td class="n" style="white-space:nowrap"><button class="btn ghost sm" data-act="lot-voir" data-lot="${esc(n)}">Voir</button>${readOnly ? "" : `<button class="btn sm" data-act="lot-edit" data-lot="${esc(n)}">Modifier</button>`}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="muted" style="margin:0">Aucun lot pour l'instant.</p>`}
    <p class="hint" style="margin:0">${sans ? `${sans} anima${sans > 1 ? "ux présents" : "l présent"} sans lot.` : "Tous les animaux présents sont dans un lot."}</p>
  </div>
  ${readOnly ? "" : `<div class="dlg-foot"><button class="btn primary" data-act="lot-new">+ Nouveau lot</button></div>`}`);
}
let LOT = null;
function lotForm(orig, init) {
  const list = presents().sort(byTravail), lots = lotsInfo().map(x => x[0]);
  const checked = new Set(orig ? list.filter(a => a.lot === orig).map(a => a.id) : (init || []));
  LOT = {orig: orig || ""};
  openDlg(`<form id="fLot">
  <div class="dlg-head"><h3>${orig ? "Modifier le lot" : "Nouveau lot"}</h3><button type="button" class="close" data-act="close" aria-label="Fermer">×</button></div>
  <div class="dlg-body">
    ${fld("lotNom", "Nom du lot *", inp("lotNom", orig || "", "text", 'required maxlength="60" list="dlLotNoms" autocomplete="off" placeholder="Vaches stabu 1, Broutards 2026, Génisses à saillir…"') + `<datalist id="dlLotNoms">${lots.map(n => `<option value="${esc(n)}">`).join("")}</datalist>`)}
    ${fld("lotDate", "Date du changement", inp("lotDate", todayISO(), "date", "required"))}
    <div class="row"><input class="search" id="lotQ" type="search" placeholder="Filtrer : numéro, nom, catégorie, lot…" aria-label="Filtrer les animaux"><button type="button" class="btn sm" data-act="lot-all">Cocher les animaux affichés</button><button type="button" class="btn sm" data-act="lot-none">Tout décocher</button></div>
    <p class="hint" id="lotCount" style="margin:0" role="status"></p>
    <div class="tablebox" style="max-height:45vh;overflow:auto"><table><thead><tr><th style="width:34px"></th><th>Animal</th><th>Nom</th><th>Catégorie</th><th>Lot actuel</th></tr></thead><tbody>
    ${list.map(a => `<tr data-act="lot-row" data-id="${esc(a.id)}" data-q="${esc([norm(a.numero), a.nom, a.categorie, a.lot, a.race, a.sexe].join(" ").toLowerCase())}"><td><input type="checkbox" class="lotcb" data-id="${esc(a.id)}" ${checked.has(a.id) ? "checked" : ""} aria-label="Mettre ${esc(animalLabel(a))} dans le lot"></td><td>${tagHTML(a.numero)}</td><td>${esc(a.nom || "")}</td><td>${esc(a.categorie || "")}</td><td class="muted">${esc(a.lot || "")}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="hint" style="margin:0">Astuce : avec le lecteur de boucles, scannez les animaux pour les cocher.</p>
  </div>
  <div class="dlg-foot">${orig ? `<button type="button" class="btn danger" data-act="lot-dissoudre" data-lot="${esc(orig)}">Dissoudre le lot</button><span style="flex:1"></span>` : ""}<button type="button" class="btn" data-act="close">Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div>
  </form>`);
  lotCount();
  if (!orig) setTimeout(() => $("#lotNom")?.focus(), 50);
}
function lotCount() {
  const el = $("#lotCount"); if (!el) return;
  const n = dlg.querySelectorAll(".lotcb:checked").length;
  el.textContent = `${n} anima${n > 1 ? "ux cochés" : "l coché"}.`;
}
function lotFilter(q) {
  q = q.trim().toLowerCase().replace(/\s/g, "");
  dlg.querySelectorAll("tr[data-act=lot-row]").forEach(tr => { tr.hidden = !!q && !tr.dataset.q.replace(/\s/g, "").includes(q); });
}
async function saveLot() {
  const name = ($("#lotNom")?.value || "").trim().replace(/\s+/g, " ");
  if (!name) return toast("Donnez un nom au lot.");
  const orig = LOT?.orig || "", checked = new Set([...dlg.querySelectorAll(".lotcb:checked")].map(c => c.dataset.id));
  if (!checked.size && !orig) return toast("Cochez au moins un animal.");
  const items = [], set = (a, lot) => { const d = {...a}; delete d.id; if (lot) d.lot = lot; else delete d.lot; items.push({col: "animaux", id: a.id, data: d}); };
  for (const a of S.animaux.values()) {
    if (checked.has(a.id)) { if (a.lot !== name) set(a, name); }
    else if (orig && a.lot === orig) {
      // ancien membre décoché : retiré du lot ; animal sorti (absent de la liste) : suit le nouveau nom
      if ((a.statut || "Présent") === "Présent") set(a, ""); else if (name !== orig) set(a, name);
    }
  }
  if (!items.length) { closeDlg(); return toast("Aucun changement."); }
  const date = $("#lotDate")?.value || todayISO(), rename = orig && name !== orig;
  items.splice(0, items.length, ...avecVeaux(items, (av, ap) => rename && av === orig && ap === name));
  const nSuit = suiveurs(items);
  // un simple renommage n'est pas un déplacement : on renomme le lot dans l'historique au lieu d'ajouter un évènement
  const evs = lotChangeItems(items, date, (av, ap) => rename && av === orig && ap === name).map(x => { if (rename && x.data.lotAvant === orig) x.data.lotAvant = name; return x; });
  if (rename) for (const e of S.evenements.values()) if (e.type === LOT_EV && (e.lotAvant === orig || e.lotApres === orig)) {
    const d = {...e}; delete d.id; if (d.lotAvant === orig) d.lotAvant = name; if (d.lotApres === orig) d.lotApres = name; evs.push({col: "evenements", id: e.id, data: d});
  }
  try { await Store.write([...items, ...evs]); toast(`Lot « ${name} » : ${checked.size} anima${checked.size > 1 ? "ux" : "l"}.${nSuit ? ` ${nSuit} veau${nSuit > 1 ? "x suivent leur" : " suit sa"} mère.` : ""}`); LOT = null; selected.clear(); closeDlg(); schedule(); }
  catch (e) { handleErr(e); }
}
async function dissoudreLot(lot) {
  const items = presents().filter(a => a.lot === lot).map(a => { const d = {...a}; delete d.id; delete d.lot; return {col: "animaux", id: a.id, data: d}; });
  try { await Store.write([...items, ...lotChangeItems(items)]); toast(`Lot « ${lot} » dissous : ${items.length} anima${items.length > 1 ? "ux" : "l"} sans lot.`); closeDlg(); }
  catch (e) { handleErr(e); }
}
function lotsSuccessifs(a) {
  const evs = (evByAnimal.get(a.id) || []).filter(e => e.type === LOT_EV).sort((x, y) => (x.date || "").localeCompare(y.date || "") || (x.saisi || "").localeCompare(y.saisi || ""));
  const titre = `<span class="flabel">Lots successifs</span>`;
  if (!evs.length) return a.lot ? `<div class="fgroup">${titre}<p class="hint" style="margin:0"><b>${esc(a.lot)}</b> — date d'entrée inconnue (avant le suivi des lots).</p></div>` : "";
  const per = [];
  if (evs[0].lotAvant) per.push({lot: evs[0].lotAvant, debut: null, fin: evs[0].date});
  evs.forEach((e, i) => { if (e.lotApres) per.push({lot: e.lotApres, debut: e.date, fin: evs[i + 1] ? evs[i + 1].date : null}); });
  if (!per.length) return "";
  const sortie = (a.statut || "Présent") !== "Présent" && a.dateSortie ? a.dateSortie : null, today = todayISO();
  return `<div class="fgroup">${titre}<div class="tablebox"><table><thead><tr><th>Lot</th><th>Période</th><th class="n">Durée</th></tr></thead><tbody>
  ${per.map(p => { const fin = p.fin || sortie, actuel = !p.fin && !sortie;
    const periode = !p.debut ? `jusqu'au ${fmtD(p.fin)}` : fin ? `du ${fmtD(p.debut)} au ${fmtD(fin)}` : `depuis le ${fmtD(p.debut)}`;
    const j = p.debut ? days(p.debut, fin || today) : null;
    return `<tr><td>${actuel ? `<b>${esc(p.lot)}</b> <span class="pill ok">actuel</span>` : esc(p.lot)}</td><td>${periode}</td><td class="n">${j == null ? "" : `${fmtN(j)} j`}</td></tr>`; }).join("")}
  </tbody></table></div></div>`;
}
function voirLot(lot) {
  UI.f = {q:"", statut:["Présent"], sexe:[], categorie:[], race:[], lot:[lot], repro:[], delai:[], ageMin:"", ageMax:""};
  saveUI(); closeDlg(); view = "animaux"; try { history.replaceState(null, "", "#animaux"); } catch {} selected.clear(); window.scrollTo(0, 0); schedule();
}

/* ---------- barre de sélection ---------- */
function renderBulk() {
  const el = $("#bulk");
  if (view !== "animaux" || !selected.size || readOnly) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="bulkbar"><b>${selected.size} sélectionné${selected.size>1?"s":""}</b><button class="btn primary" data-act="bulk-event">Ajouter un évènement</button><button class="btn" data-act="bulk-lot">Mettre dans un lot</button><button class="btn" data-act="clear-sel">Désélectionner</button></div>`;
}

/* ---------- toast ---------- */
let toastT;
function toast(msg) { let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role","status"); document.body.appendChild(t); } t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2800); }

/* ---------- événements DOM ---------- */
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]"); if (!t) return;
  const act = t.dataset.act, id = t.dataset.id;
  if (act === "noop") { if (e.target.matches("input")) return; e.stopPropagation(); const cb = t.querySelector("input"); if (cb) cb.click(); return; }
  if (act === "select") { e.stopPropagation(); t.checked ? selected.add(id) : selected.delete(id); schedule(); return; }
  if (act === "select-all") { const l = filtered(); if (t.checked) l.forEach(a => selected.add(a.id)); else l.forEach(a => selected.delete(a.id)); schedule(); return; }
  if (act === "col") { const k = t.dataset.k; UI.cols = t.checked ? [...new Set([...UI.cols, k])] : UI.cols.filter(x => x !== k); saveUI(); schedule(); return; }
  if (t.tagName === "A") e.preventDefault();
  switch (act) {
    case "open-animal": showAnimal(id); break;
    case "close": closeDlg(); break;
    case "back-animal": id ? showAnimal(id) : closeDlg(); break;
    case "new-animal": animalForm(); break;
    case "edit-animal": animalForm(id); break;
    case "new-event": eventForm({animalIds: t.dataset.animal ? [t.dataset.animal] : [], type: t.dataset.type || "Pesée"}); break;
    case "bulk-event": eventForm({animalIds: [...selected], type: "Traitement"}); break;
    case "clear-sel": selected.clear(); schedule(); break;
    case "weigh-session": weighSession(); break;
    case "del-event": { const ev = S.evenements.get(id); const aid = ev?.animal; del("evenements", id).then(() => { toast("Évènement supprimé"); if (aid) setTimeout(() => showAnimal(aid), 0); }).catch(() => {}); break; }
    case "ask-del-animal": { const a = S.animaux.get(id); const n = (evByAnimal.get(id) || []).length;
      confirmDlg("Supprimer cet animal ?", `${esc(animalLabel(a))} et ses ${n} évènement${n>1?"s":""} seront effacés définitivement. Pour un animal vendu ou mort, changez plutôt son statut afin de garder l'historique.`, "do-del-animal", id, "Supprimer définitivement"); break; }
    case "do-del-animal": deleteAnimal(id); break;
    case "clear-examples": confirmDlg("Effacer les données d'exemple ?", "Tous les animaux et évènements marqués comme exemples seront supprimés. Vos propres saisies sont conservées.", "do-clear-examples", "", "Effacer les exemples"); break;
    case "do-clear-examples": clearExamples(); break;
    case "sort": { const k = t.dataset.k; UI.sort = {k, dir: UI.sort.k === k ? -UI.sort.dir : 1}; saveUI(); schedule(); break; }
    case "chip": { const k = t.dataset.k, v = t.dataset.v; UI.f[k] = UI.f[k].includes(v) ? UI.f[k].filter(x => x !== v) : [...UI.f[k], v]; saveUI(); schedule(); break; }
    case "voir-vieilles": UI.f = {q:"", statut:["Présent"], sexe:["F"], categorie:[], race:[], lot:[], repro:[], delai:[], ageMin:String(AGE_VIEILLES * 12), ageMax:""};
      UI.sort = {k:"ageAns", dir:-1}; UI.openF = true; saveUI(); view = "animaux"; try { history.replaceState(null, "", "#animaux"); } catch {} selected.clear(); window.scrollTo(0, 0); schedule(); break;
    case "reset-filters": UI.f = {q:"", statut:["Présent"], sexe:[], categorie:[], race:[], lot:[], repro:[], delai:[], ageMin:"", ageMax:""}; saveUI(); schedule(); break;
    case "cols-all": UI.cols = COLS.map(c => c.k); saveUI(); schedule(); break;
    case "cols-default": UI.cols = DEFAULT_COLS.slice(); saveUI(); schedule(); break;
    case "export": exportCSV(); break;
    case "import": IMP = null; importDlg(); break;
    case "do-import": runImport(); break;
    case "account": accountDlg(); break;
    case "add-tags": addTagsForm(); break;
    case "dash-config": dashDlg(); break;
    case "dash-up": case "dash-down": { const k = t.dataset.k, up = act === "dash-up"; dashSet(c => { const i = c.findIndex(x => x.k === k), j = up ? i - 1 : i + 1; if (j >= 0 && j < c.length) [c[i], c[j]] = [c[j], c[i]]; }); break; }
    case "dash-reset": UI.dash = DASH_DEFAUT.map(x => ({...x})); saveUI(); schedule(); dashDlg(); break;
    case "lots": lotsDlg(); break;
    case "lot-new": lotForm(null); break;
    case "bulk-lot": lotForm(null, [...selected]); break;
    case "lot-edit": lotForm(t.dataset.lot); break;
    case "lot-voir": voirLot(t.dataset.lot); break;
    case "lot-row": { const cb = t.querySelector(".lotcb"); if (cb && e.target !== cb) cb.checked = !cb.checked; lotCount(); break; }
    case "lot-all": dlg.querySelectorAll("tr[data-act=lot-row]:not([hidden]) .lotcb").forEach(c => c.checked = true); lotCount(); break;
    case "lot-none": dlg.querySelectorAll(".lotcb").forEach(c => c.checked = false); lotCount(); break;
    case "lot-dissoudre": confirmDlg("Dissoudre le lot ?", `Les animaux du lot « ${esc(t.dataset.lot)} » n'auront plus de lot. Les animaux eux-mêmes ne sont pas supprimés.`, "do-lot-dissoudre", "", "Dissoudre"); dlg.querySelector("[data-act=do-lot-dissoudre]").dataset.lot = t.dataset.lot; break;
    case "do-lot-dissoudre": dissoudreLot(t.dataset.lot); break;
    case "ede-ok": edeMark([id], t.dataset.k, todayISO()).then(o => { if (o) { toast(t.dataset.k === "sortie" ? "Sortie marquée notifiée." : "Naissance marquée notifiée."); if (dlg.open && $("dialog[open] .info")) showAnimal(id); } }); break;
    case "ede-undo": edeMark([id], t.dataset.k, null).then(o => { if (o) { toast("Remis dans la liste à notifier."); showAnimal(id); } }); break;
    case "ede-all": { const st = notifState(), l = (t.dataset.k === "sortie" ? st.sorties : st.naiss).map(x => x.a.id);
      edeMark(l, t.dataset.k, todayISO()).then(o => o && toast(`${l.length} ${t.dataset.k === "sortie" ? "sorties marquées notifiées" : "naissances marquées notifiées"}.`)); break; }
    case "ede-copy": { const a = S.animaux.get(id); if (!a) break; const txt = edeTexte(a, t.dataset.k);
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast("Copié : " + txt), () => toast(txt)); break; }
    case "tag-menu": tagMenu(id); break;
    case "tag-lost": tagSet(id, {statut: "Perdue", perdueLe: todayISO()}, "Boucle marquée perdue."); break;
    case "tag-restock": tagSet(id, {statut: "Disponible", perdueLe: undefined}, "Boucle remise en stock."); break;
    case "tag-delete": del("boucles", id).then(() => { toast("Boucle supprimée du stock."); closeDlg(); }).catch(() => {}); break;
    case "goto-view": view = t.dataset.v; try { history.replaceState(null, "", "#" + view); } catch {} selected.clear(); schedule(); setTimeout(() => { const el = document.getElementById(t.dataset.anchor || "stock"); if (el) el.scrollIntoView({block: "start"}); }, 80); break;
    case "show-login": closeDlg(); Store.showLogin(); break;
    case "sign-up": onLogin($("#fLogin"), true); break;
    case "reset-pw": { const em = $("#loginEmail")?.value.trim(), msg = $("#loginMsg");
      if (!em) { msg.textContent = "Saisissez d'abord votre adresse e-mail."; break; }
      Store.resetPassword(em).then(() => msg.textContent = `Un e-mail de réinitialisation a été envoyé à ${em}. Suivez le lien puis choisissez un nouveau mot de passe dans le menu Compte.`, err => msg.textContent = err.message); break; }
    case "use-local": Store.useLocal(); break;
    case "cancel-login": Store.cancelLogin(); break;
    case "select-farm": Store.selectFarm(id); break;
    case "refresh-farms": Store.refreshFarms(false).then(() => toast("Liste des exploitations actualisée.")); break;
    case "sign-out": { const n = Store.state.pending;
      confirmDlg("Se déconnecter ?", n ? `<b>${n} modification${n > 1 ? "s n'ont" : " n'a"} pas encore été envoyée${n > 1 ? "s" : ""}</b> et ser${n > 1 ? "ont perdues" : "a perdue"}. Reconnectez-vous d'abord au réseau pour les envoyer.` : "Les données de l'exploitation seront retirées de cet appareil. Elles restent en ligne et vous les retrouverez en vous reconnectant.", "do-sign-out", "", "Se déconnecter"); break; }
    case "do-sign-out": closeDlg(); Store.signOut(); break;
    case "sync-now": if (!navigator.onLine) { toast("Hors ligne : la synchronisation reprendra au retour du réseau."); break; }
      Promise.all([Store.flush(), Store.pull()]).then(() => { toast(Store.state.pending ? `${Store.state.pending} modification(s) toujours en attente.` : "Registre synchronisé."); if (dlg.open && $("#membersZone")) accountDlg(); }); break;
    case "switch-farm": closeDlg(); Store.showFarms(); break;
    case "change-pw": { const f = $("#fPw"); if (f) { f.hidden = !f.hidden; if (!f.hidden) $("#newPw").focus(); } break; }
    case "backup-export": exportBackup(); break;
    case "do-restore": doRestore(); break;
    case "install": if (installEvt) { installEvt.prompt(); installEvt.userChoice.finally(() => { installEvt = null; if (dlg.open) accountDlg(); }); } break;
    case "sw-update": if (swWaiting) swWaiting.postMessage({type: "SKIP_WAITING"}); break;
    case "migrate-local": Store.migrateLocal().then(n => { localN = 0; toast(`${n} enregistrement${n > 1 ? "s ajoutés" : " ajouté"} à l'exploitation.`); schedule(); }, handleErr); break;
    case "discard-local": confirmDlg("Supprimer les données locales ?", `Les ${localN} enregistrements saisis en mode local seront effacés de cet appareil. Exportez d'abord une sauvegarde si vous voulez les garder.`, "do-discard-local", "", "Supprimer"); break;
    case "do-discard-local": Store.discardLocal().then(() => { localN = 0; closeDlg(); schedule(); }); break;
    case "remove-member": confirmDlg("Retirer ce membre ?", "Cette personne n'aura plus accès au registre de l'exploitation.", "do-remove-member", id, "Retirer"); break;
    case "do-remove-member": Store.removeMember(id).then(() => { toast("Membre retiré."); accountDlg(); }, err => toast(err.message)); break;
    case "cancel-invite": Store.cancelInvite(id).then(loadMembers, err => toast(err.message)); break;
    case "invite-mail": inviteMail(t.dataset.email, t.dataset.role); break;
  }
});
document.addEventListener("toggle", e => { const d = e.target; if (d.matches && d.matches("details.filters")) { UI[d.dataset.k] = d.open; } }, true);
let qT;
document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "q") { UI.f.q = t.value; clearTimeout(qT); qT = setTimeout(() => { saveUI(); const pos = t.selectionStart; render(); const n = $("#q"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } }, 220); }
  if (t.id === "tFirst" || t.id === "tCount") tagsPreview();
  if (t.id === "lotQ") lotFilter(t.value);
  if (t.id === "ef_veauLot") t.dataset.touched = "1";
  if (t.id === "ageMin" || t.id === "ageMax") { UI.f[t.id] = t.value; clearTimeout(qT); qT = setTimeout(() => { saveUI(); render(); const n = $("#" + t.id); if (n) n.focus(); }, 400); }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "evType") $("#evFields").innerHTML = evFields(t.value, evAnimalCourant());
  if ((t.id === "evAnimal" || t.id === "evDate") && $("#ef_veauLot") && !$("#ef_veauLot").dataset.touched) $("#ef_veauLot").value = lotVeau(evAnimalCourant());
  if (t.id === "impFile") onImportFile(t);
  if (t.id === "restoreFile") { onRestoreFile(t); }
  if (t.classList.contains("dashOn")) dashSet(c => { c.find(x => x.k === t.dataset.k).on = t.checked; });
  if (t.classList.contains("dashW")) dashSet(c => { c.find(x => x.k === t.dataset.k).w = t.value; });
  if (t.classList.contains("memberRole")) Store.setRole(t.dataset.user, t.value).then(() => toast("Rôle modifié."), err => { toast(err.message); loadMembers(); });
  if (IMP && t.classList.contains("impMap")) { IMP.map[t.dataset.f] = t.value === "" ? null : +t.value; impZone(); }
  if (IMP && t.id === "impUpd") { IMP.upd = t.checked; impZone(); }
  if (IMP && t.id === "impSkipOut") { IMP.skipOut = t.checked; impZone(); }
  if (IMP && t.id === "impLot") { IMP.lot = t.value.trim(); impZone(); }
  if (t.id === "santeYear") { UI.santeYear = t.value; saveUI(); schedule(); }
  if (t.id === "wLot") { UI.weighLot = t.value; weighSession(); }
});
document.addEventListener("submit", e => {
  e.preventDefault(); const f = e.target;
  if (f.id === "fLogin") return onLogin(f, false);
  if (f.id === "fTags") return saveTags();
  if (f.id === "fLot") return saveLot();
  if (f.id === "fFarm") { const n = $("#farmName").value.trim(); if (!n) return; if (!navigator.onLine) return toast("Connexion internet nécessaire pour créer l'exploitation."); f.querySelectorAll("button").forEach(b => b.disabled = true); Store.createFarm(n).catch(err => { toast(err.message); f.querySelectorAll("button").forEach(b => b.disabled = false); }); return; }
  if (f.id === "fInvite") { const em = $("#invEmail").value.trim(), r = $("#invRole").value; Store.invite(em, r).then(() => { toast(`Invitation enregistrée pour ${em}.`); loadMembers(); inviteMail(em, r); }, err => toast(err.message)); return; }
  if (f.id === "fPw") { Store.updatePassword($("#newPw").value).then(() => { toast("Mot de passe modifié."); f.hidden = true; }, err => toast(err.message)); return; }
  if (f.id === "fAnimal") saveAnimal(f); else if (f.id === "fEvent") saveEvent(f); else if (f.id === "fWeigh") saveWeigh(f);
});

function route() { const h = (location.hash || "").slice(1); view = ["tableau","animaux","repro","sante","pesees"].includes(h) ? h : "tableau"; selected.clear(); schedule(); }
window.addEventListener("hashchange", route);
document.getElementById("tabs").addEventListener("click", e => { const a = e.target.closest("a[data-v]"); if (!a) return; e.preventDefault(); view = a.dataset.v; try { history.replaceState(null, "", "#" + view); } catch {} selected.clear(); window.scrollTo(0, 0); schedule(); });
route();
boot();
})();
