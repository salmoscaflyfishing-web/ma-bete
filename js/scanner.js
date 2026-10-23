/* Lecteur de boucles électroniques Bluetooth en « mode clavier » (Allflex, Agrident…).
   Le lecteur « tape » le numéro très vite puis envoie Entrée (ou Tab). On distingue cette frappe
   de celle d'une personne par la vitesse : plusieurs caractères à moins de ~50 ms d'intervalle. */
(() => {
"use strict";
const MIN_DIGITS = 10;   // au moins 10 chiffres (numéro national sans le préfixe FR)
const MAX_AVG = 50;      // intervalle moyen maximal entre deux touches (ms)
const MAX_GAP = 150;     // au-delà, on considère qu'une nouvelle saisie commence
const IDLE = 250;        // lecteur sans touche de fin : on valide après ce silence

let buf = "", times = [], target = null, startVal = null, idleT = null, cb = null;
const isField = el => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && !["checkbox", "radio", "file", "button", "submit"].includes(el.type);
const digits = () => buf.replace(/\D/g, "").length;
function fast() {
  if (times.length < 2) return false;
  return (times[times.length - 1] - times[0]) / (times.length - 1) <= MAX_AVG;
}
function reset() { buf = ""; times = []; target = null; startVal = null; clearTimeout(idleT); }
function finish() {
  const code = buf, t = target, v = startVal;
  reset();
  // le lecteur a écrit le numéro dans le champ qui avait le curseur : on remet ce champ comme avant
  if (t && v != null && document.contains(t) && t.value !== v) {
    t.value = v;
    t.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (cb) cb(code);
}

document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  const now = performance.now();
  if (e.key === "Enter" || e.key === "Tab") {
    const recent = times.length && now - times[times.length - 1] < MAX_GAP;
    if (recent && digits() >= MIN_DIGITS && fast()) { e.preventDefault(); e.stopPropagation(); finish(); }
    else reset();
    return;
  }
  if (!e.key || e.key.length !== 1) return;
  if (times.length && now - times[times.length - 1] > MAX_GAP) reset();
  if (!buf) { target = e.target; startVal = isField(target) ? target.value : null; }
  buf += e.key; times.push(now);
  clearTimeout(idleT);
  idleT = setTimeout(() => { if (digits() >= 12 && fast()) finish(); else reset(); }, IDLE);
}, true);

window.TagScanner = { start(f) { cb = f; } };
})();
