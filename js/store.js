/* Ma Bête — stockage local (IndexedDB), file d'attente hors ligne et synchronisation Supabase.
   Les données sont toujours lues et écrites d'abord sur l'appareil ; les modifications d'une exploitation
   partagée partent dans une file d'attente (« outbox ») envoyée dès que le réseau et la session le permettent. */
(() => {
"use strict";
const COLS = ["animaux", "evenements", "finances"];
const LOCAL = "local";
const CFG = window.REGISTRE_CONFIG || {};
const configured = !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase && window.supabase.createClient);
const PAGE = 1000, BATCH = 300;

const S = { animaux: new Map(), evenements: new Map(), finances: new Map() };
const st = { phase: "init", farm: null, farmName: "", role: null, user: null, farms: [], online: navigator.onLine,
             pending: 0, syncing: false, authProblem: false, realtime: false, lastSync: null };
const listeners = { change: [], status: [], message: [] };
const emit = (t, x) => listeners[t].forEach(f => { try { f(x); } catch (e) { console.error(e); } });
const emitStatus = () => emit("status", st);
const key = (farm, col, id) => `${farm}|${col}|${id}`;
let sb = null, channel = null, flushing = null, pulling = null, retryT = null;

/* ---------- IndexedDB ---------- */
let dbp = null;
function idb() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open("registre-troupeau", 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore("records", { keyPath: "k" }).createIndex("farm", "farm");
      d.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true }).createIndex("farm", "farm");
      d.createObjectStore("meta", { keyPath: "key" });
    };
    r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); res(r.result); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error("IndexedDB bloquée : fermez les autres onglets de l'application."));
  });
  return dbp;
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function tx(stores, mode, fn) {
  const d = await idb();
  return new Promise((res, rej) => {
    const t = d.transaction(stores, mode); let out;
    Promise.resolve(fn(t)).then(v => { out = v; }, e => { try { t.abort(); } catch {} rej(e); });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error("Transaction annulée"));
  });
}
const metaGet = async k => { const r = await tx(["meta"], "readonly", t => req(t.objectStore("meta").get(k))); return r ? r.v : undefined; };
const metaSet = (k, v) => tx(["meta"], "readwrite", t => { t.objectStore("meta").put({ key: k, v }); });
const metaDel = k => tx(["meta"], "readwrite", t => { t.objectStore("meta").delete(k); });
const farmRecords = farm => tx(["records"], "readonly", t => req(t.objectStore("records").index("farm").getAll(farm)));
const farmOutbox = (farm, n) => tx(["outbox"], "readonly", t => req(t.objectStore("outbox").index("farm").getAll(farm, n)));

async function loadFarm(farm) {
  const rows = await farmRecords(farm);
  if (farm !== st.farm) return;
  COLS.forEach(c => S[c].clear());
  for (const r of rows) if (!r.deleted && S[r.col]) S[r.col].set(r.id, { ...r.data, id: r.id });
  emit("change");
}
async function countPending() {
  st.pending = st.farm && st.farm !== LOCAL
    ? await tx(["outbox"], "readonly", t => req(t.objectStore("outbox").index("farm").count(st.farm))) : 0;
  emitStatus();
}
const saveCurrent = () => metaSet("current", st.farm ? { farm: st.farm, farmName: st.farmName, role: st.role,
  userId: st.user && st.user.id, email: st.user && st.user.email } : null);

/* ---------- écriture (toujours locale d'abord) ---------- */
async function write(items) {
  const farm = st.farm;
  if (!farm) throw Object.assign(new Error("Aucun registre ouvert"), { code: "no_farm" });
  if (st.role === "viewer") throw Object.assign(new Error("Lecture seule"), { code: "readonly" });
  const cloud = farm !== LOCAL, now = new Date().toISOString();
  for (const it of items) {
    if (it.deleted) S[it.col].delete(it.id); else S[it.col].set(it.id, { ...it.data, id: it.id });
  }
  emit("change");
  await tx(["records", "outbox"], "readwrite", t => {
    const rs = t.objectStore("records"), ob = t.objectStore("outbox");
    for (const it of items) {
      const k = key(farm, it.col, it.id), data = it.data || {};
      if (!cloud && it.deleted) { rs.delete(k); continue; }
      rs.put({ k, farm, col: it.col, id: it.id, data, deleted: !!it.deleted, updated_at: now, server: false });
      if (cloud) ob.add({ k, farm, col: it.col, id: it.id, data, deleted: !!it.deleted });
    }
  });
  if (cloud) { await countPending(); scheduleFlush(); }
}
const put = (col, id, data) => write([{ col, id, data }]);
function del(col, id) {
  const cur = S[col].get(id) || {}; const { id: _, ...data } = cur;
  return write([{ col, id, data, deleted: true }]);
}

/* ---------- application des données reçues du serveur ---------- */
async function applyRows(farm, rows) {
  if (!rows.length) return;
  const pendingKeys = new Set((await farmOutbox(farm)).map(e => e.k));
  const applied = [];
  await tx(["records"], "readwrite", async t => {
    const rs = t.objectStore("records");
    const olds = await Promise.all(rows.map(r => req(rs.get(key(farm, r.collection, r.id)))));
    rows.forEach((r, i) => {
      const k = key(farm, r.collection, r.id), old = olds[i];
      if (!COLS.includes(r.collection) || pendingKeys.has(k)) return;
      if (old && old.server && old.updated_at > r.updated_at) return;
      rs.put({ k, farm, col: r.collection, id: r.id, data: r.data || {}, deleted: !!r.deleted, updated_at: r.updated_at, server: true });
      applied.push(r);
    });
  });
  if (farm !== st.farm || !applied.length) return;
  for (const r of applied) { if (r.deleted) S[r.collection].delete(r.id); else S[r.collection].set(r.id, { ...(r.data || {}), id: r.id }); }
  emit("change");
}

/* ---------- synchronisation ---------- */
const canSync = () => !!(sb && st.user && !st.authProblem && st.farm && st.farm !== LOCAL && navigator.onLine);
let flushT = null;
function scheduleFlush(ms = 400) { clearTimeout(flushT); flushT = setTimeout(flush, ms); }
function scheduleRetry() { clearTimeout(retryT); retryT = setTimeout(() => { flush(); pull(); }, 30000); }
function flush() { if (!flushing) flushing = doFlush().catch(e => console.warn("flush", e)).finally(() => { flushing = null; st.syncing = false; countPending(); }); return flushing; }

async function doFlush() {
  if (!canSync()) return;
  const farm = st.farm;
  for (;;) {
    const entries = await farmOutbox(farm, BATCH);
    if (!entries.length || farm !== st.farm) return;
    st.syncing = true; emitStatus();
    const last = new Map(); entries.forEach(e => last.set(e.k, e));
    const rows = [...last.values()].map(e => ({ farm_id: farm, collection: e.col, id: e.id, data: e.data || {}, deleted: !!e.deleted }));
    const { error, status } = await sb.from("records").upsert(rows, { onConflict: "farm_id,collection,id" });
    if (error) {
      if (status === 401 || /jwt/i.test(error.message || "")) {
        const r = await sb.auth.refreshSession().catch(() => ({ error: true }));
        if (r.error) { st.authProblem = true; emitStatus(); return; }
        continue;
      }
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        // Refus définitif (droits insuffisants, données invalides) : on retire ces modifications et on recharge l'état du serveur.
        await tx(["outbox"], "readwrite", t => { const ob = t.objectStore("outbox"); entries.forEach(e => ob.delete(e.seq)); });
        const rls = error.code === "42501" || status === 403;
        emit("message", rls ? `${rows.length} modification${rows.length > 1 ? "s refusées" : " refusée"} : votre accès à cette exploitation est en lecture seule.`
                            : `${rows.length} modification${rows.length > 1 ? "s refusées" : " refusée"} par le serveur (${error.message}).`);
        if (rls) refreshFarms();
        await pull(true);
        continue;
      }
      scheduleRetry(); return; // réseau ou serveur indisponible : on réessaiera
    }
    await tx(["outbox", "records"], "readwrite", t => {
      const ob = t.objectStore("outbox");
      entries.forEach(e => ob.delete(e.seq));
    });
    st.lastSync = new Date().toISOString();
  }
}

function pull(full) { if (!pulling) pulling = doPull(full).catch(e => console.warn("pull", e)).finally(() => { pulling = null; }); return pulling; }
async function doPull(full) {
  if (!canSync()) return;
  const farm = st.farm, mk = "sync:" + farm;
  const since = full ? null : await metaGet(mk);
  const sinceQ = since ? new Date(Date.parse(since) - 15000).toISOString() : null;
  let from = 0, maxTs = since || null;
  for (;;) {
    let q = sb.from("records").select("collection,id,data,deleted,updated_at").eq("farm_id", farm);
    if (sinceQ) q = q.gte("updated_at", sinceQ);
    const { data, error } = await q.order("updated_at").order("collection").order("id").range(from, from + PAGE - 1);
    if (error) { if (error.code === "PGRST301" || /jwt/i.test(error.message || "")) { st.authProblem = true; emitStatus(); } return; }
    if (farm !== st.farm) return;
    await applyRows(farm, data);
    for (const r of data) if (!maxTs || r.updated_at > maxTs) maxTs = r.updated_at;
    if (data.length < PAGE) break;
    from += PAGE;
  }
  if (maxTs) await metaSet(mk, maxTs);
  st.lastSync = new Date().toISOString(); emitStatus();
}

function subscribe() {
  unsubscribe();
  if (!sb || !st.user || !st.farm || st.farm === LOCAL) return;
  const farm = st.farm;
  channel = sb.channel("records-" + farm)
    .on("postgres_changes", { event: "*", schema: "public", table: "records", filter: "farm_id=eq." + farm },
        p => { if (p.new && p.new.id && farm === st.farm) applyRows(farm, [p.new]); })
    .subscribe(status => {
      st.realtime = status === "SUBSCRIBED"; emitStatus();
      if (status === "SUBSCRIBED") { pull(); flush(); }
    });
}
function unsubscribe() { if (channel && sb) { try { sb.removeChannel(channel); } catch {} } channel = null; st.realtime = false; }

/* ---------- comptes et exploitations ---------- */
async function refreshFarms(auto = true) {
  if (!sb || !st.user || !navigator.onLine) return;
  await sb.rpc("accept_invitations").then(() => {}, () => {});
  const { data, error } = await sb.rpc("my_farms");
  if (error) return;
  st.farms = data || [];
  if (st.farm && st.farm !== LOCAL) {
    const f = st.farms.find(x => x.farm_id === st.farm);
    if (f) { st.farmName = f.name; st.role = f.role; await saveCurrent(); emit("change"); }
    else { emit("message", "Vous n'avez plus accès à cette exploitation."); await forgetFarm(st.farm); st.farm = null; st.phase = "choose"; await saveCurrent(); }
  } else if (st.phase === "login" || st.phase === "choose") {
    if (auto && st.farms.length === 1) return selectFarm(st.farms[0].farm_id);
    st.phase = "choose";
  }
  emitStatus(); emit("change");
}

let sessionP = null, sessionUser = null;
function afterSession(session) {
  if (sessionP && sessionUser === session.user.id) return sessionP;
  sessionUser = session.user.id;
  sessionP = (async () => {
    if (st.user && st.user.id !== session.user.id && st.farm && st.farm !== LOCAL) {
      // autre compte que celui du registre ouvert : on referme ce registre
      unsubscribe(); await forgetFarm(st.farm); st.farm = null; COLS.forEach(c => S[c].clear());
    }
    st.user = { id: session.user.id, email: session.user.email };
    st.authProblem = false;
    if (st.phase === "login") st.phase = st.farm && st.farm !== LOCAL ? "ready" : "choose";
    if (st.farm && st.farm !== LOCAL) await saveCurrent();
    emitStatus(); emit("change");
    await refreshFarms();
    if (st.phase === "ready" && st.farm && st.farm !== LOCAL) { subscribe(); pull(); flush(); }
  })().finally(() => { setTimeout(() => { sessionP = null; }, 2000); });
  return sessionP;
}

async function checkSession() {
  if (!sb) return;
  let session = null;
  try { const r = await sb.auth.getSession(); session = r.data && r.data.session; } catch {}
  if (session) return afterSession(session);
  if (st.farm && st.farm !== LOCAL) { st.authProblem = navigator.onLine; emitStatus(); }
}

async function selectFarm(farmId) {
  const f = st.farms.find(x => x.farm_id === farmId); if (!f) return;
  unsubscribe();
  st.farm = f.farm_id; st.farmName = f.name; st.role = f.role; st.phase = "ready";
  await saveCurrent(); await loadFarm(st.farm); await countPending();
  emitStatus(); emit("change");
  subscribe(); await pull(); flush();
}
async function useLocal() {
  unsubscribe();
  st.farm = LOCAL; st.farmName = ""; st.role = "owner"; st.phase = "ready";
  await saveCurrent(); await loadFarm(LOCAL); await countPending(); emitStatus(); emit("change");
}
async function forgetFarm(farm) {
  await tx(["records", "outbox", "meta"], "readwrite", async t => {
    const rk = await req(t.objectStore("records").index("farm").getAllKeys(farm));
    rk.forEach(k => t.objectStore("records").delete(k));
    const ok = await req(t.objectStore("outbox").index("farm").getAllKeys(farm));
    ok.forEach(k => t.objectStore("outbox").delete(k));
    t.objectStore("meta").delete("sync:" + farm);
  });
}

const authErr = e => {
  const m = (e && e.message || "").toLowerCase();
  if (m.includes("invalid login")) return "E-mail ou mot de passe incorrect.";
  if (m.includes("email not confirmed")) return "Adresse e-mail pas encore confirmée : cliquez sur le lien reçu par e-mail.";
  if (m.includes("already registered")) return "Un compte existe déjà avec cette adresse : connectez-vous.";
  if (m.includes("password")) return "Mot de passe trop court (6 caractères minimum).";
  if (m.includes("fetch") || m.includes("network")) return "Pas de connexion internet.";
  return e && e.message || "Erreur inconnue";
};
const redirectTo = () => location.origin + location.pathname;

const Store = {
  S, COLS, LOCAL, configured, state: st,
  on(t, f) { listeners[t].push(f); },
  put, del, write,
  flush, pull, countPending,
  async init() {
    if (configured) {
      sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey,
        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "registre-troupeau-auth" } });
      sb.auth.onAuthStateChange((ev, session) => {
        if (ev === "SIGNED_IN" && session && (!st.user || st.user.id !== session.user.id || st.authProblem)) setTimeout(() => afterSession(session), 0);
        if (ev === "PASSWORD_RECOVERY") emit("message", "Choisissez un nouveau mot de passe dans le menu Compte.");
      });
    }
    let cur = null;
    try { cur = await metaGet("current"); } catch (e) { emit("message", "Stockage de l'appareil indisponible : " + e.message); }
    if (cur && cur.farm === LOCAL) { await useLocal(); }
    else if (cur && cur.farm && configured) {
      st.farm = cur.farm; st.farmName = cur.farmName || ""; st.role = cur.role || "viewer";
      st.user = cur.userId ? { id: cur.userId, email: cur.email } : null; st.phase = "ready";
      await loadFarm(st.farm); await countPending(); emitStatus();
    }
    else if (!configured) { await useLocal(); }
    else { st.phase = "login"; emitStatus(); }
    if (configured) checkSession();
    window.addEventListener("online", () => { st.online = true; emitStatus(); if (st.authProblem || !st.realtime) checkSession(); flush(); pull(); });
    window.addEventListener("offline", () => { st.online = false; emitStatus(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && canSync()) { pull(); flush(); } });
    setInterval(() => { if (canSync()) { if (st.pending) flush(); if (!st.realtime) pull(); } }, 60000);
    emit("change");
  },
  async signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(authErr(error));
    await afterSession(data.session);
  },
  async signUp(email, password) {
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo() } });
    if (error) throw new Error(authErr(error));
    if (data.session) { await afterSession(data.session); return "ok"; }
    return "confirm";
  },
  async resetPassword(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo() });
    if (error) throw new Error(authErr(error));
  },
  async updatePassword(password) {
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw new Error(authErr(error));
  },
  async signOut() {
    unsubscribe();
    if (st.farm && st.farm !== LOCAL) await forgetFarm(st.farm);
    try { await sb.auth.signOut({ scope: "local" }); } catch {}
    st.user = null; sessionUser = null; st.farm = null; st.farms = []; st.role = null; st.farmName = ""; st.phase = "login"; st.authProblem = false;
    COLS.forEach(c => S[c].clear());
    await metaDel("current"); await countPending(); emitStatus(); emit("change");
  },
  showLogin() { unsubscribe(); st.phase = "login"; emitStatus(); emit("change"); },
  showFarms() { st.phase = "choose"; emitStatus(); emit("change"); refreshFarms(false); },
  async cancelLogin() { if (st.farm) { st.phase = "ready"; emitStatus(); emit("change"); if (st.farm !== LOCAL) subscribe(); } else await useLocal(); },
  selectFarm, useLocal, refreshFarms, checkSession,
  async createFarm(name) {
    const { data, error } = await sb.rpc("create_farm", { p_name: name.trim() });
    if (error) throw new Error(error.message);
    await refreshFarms(); await selectFarm(data);
  },
  async renameFarm(name) {
    const { error } = await sb.from("farms").update({ name: name.trim() }).eq("id", st.farm);
    if (error) throw new Error(error.message);
    await refreshFarms();
  },
  async members() {
    const m = await sb.from("farm_members").select("user_id,role,email,created_at").eq("farm_id", st.farm).order("created_at");
    if (m.error) throw new Error(m.error.message);
    let inv = { data: [] };
    if (st.role === "owner") { inv = await sb.from("farm_invitations").select("id,email,role,created_at").eq("farm_id", st.farm).order("created_at"); if (inv.error) throw new Error(inv.error.message); }
    return { members: m.data, invitations: inv.data };
  },
  async invite(email, role) {
    const { error } = await sb.from("farm_invitations").upsert({ farm_id: st.farm, email: email.trim().toLowerCase(), role }, { onConflict: "farm_id,email" });
    if (error) throw new Error(error.code === "23514" ? "Adresse e-mail invalide." : error.message);
  },
  async cancelInvite(id) { const { error } = await sb.from("farm_invitations").delete().eq("id", id); if (error) throw new Error(error.message); },
  async setRole(userId, role) { const { error } = await sb.rpc("set_member_role", { p_farm: st.farm, p_user: userId, p_role: role }); if (error) throw new Error(error.message); },
  async removeMember(userId) { const { error } = await sb.rpc("remove_member", { p_farm: st.farm, p_user: userId }); if (error) throw new Error(error.message); },
  /* données saisies en mode local avant la connexion */
  async localCount() { if (!st.farm || st.farm === LOCAL) return 0; return (await farmRecords(LOCAL)).filter(r => !r.deleted).length; },
  async migrateLocal() {
    const rows = (await farmRecords(LOCAL)).filter(r => !r.deleted);
    for (let i = 0; i < rows.length; i += 500) await write(rows.slice(i, i + 500).map(r => ({ col: r.col, id: r.id, data: r.data })));
    await forgetFarm(LOCAL);
    return rows.length;
  },
  async discardLocal() { await forgetFarm(LOCAL); },
};
window.Store = Store;
})();
