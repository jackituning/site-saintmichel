// netlify/functions/stock.js
import { getDb, requireAuth, ok, err, options } from "./_lib/firebase.js";

// Cherche un doc stock par article+taille (via query, pas de doc-ID fragile)
async function findStockDoc(db, article_id, taille) {
  const q = await db.collection("stock")
    .where("article_id", "==", article_id)
    .where("taille", "==", taille)
    .limit(1).get();
  return q.empty ? null : q.docs[0];
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();
  const user = requireAuth(event);
  if (!user) return err("Non autorisé", 401);

  try {
    const db = getDb();
    const path = event.path.replace(/.*\/stock/, "");
    const sub = path.replace("/", "").split("?")[0]; // "mouvement", "mouvements", "init", ""

    // GET /stock
    if (event.httpMethod === "GET" && !sub) {
      const [snap, artsSnap] = await Promise.all([
        db.collection("stock").get(),
        db.collection("articles").get(),
      ]);
      const artsById = {};
      artsSnap.docs.forEach(d => { artsById[d.id] = d.data(); });
      const items = snap.docs.map(d => {
        const s = { id: d.id, ...d.data() };
        const art = artsById[s.article_id];
        s.nom = art ? art.nom : s.article_id;
        s.tailles = art ? (art.tailles || []) : [];
        return s;
      });
      return ok(items.sort((a, b) => String(a.nom || "").localeCompare(String(b.nom || ""))));
    }

    // GET /stock/mouvements
    if (event.httpMethod === "GET" && sub === "mouvements") {
      const [snap, artsSnap] = await Promise.all([
        db.collection("mouvements_stock").orderBy("date", "desc").limit(200).get(),
        db.collection("articles").get(),
      ]);
      const artsById = {};
      artsSnap.docs.forEach(d => { artsById[d.id] = d.data(); });
      const mvts = snap.docs.map(d => {
        const m = { id: d.id, ...d.data() };
        const art = artsById[m.article_id];
        m.article_nom = art ? art.nom : m.article_id;
        return m;
      });
      return ok(mvts);
    }

    // POST /stock/mouvement
    if (event.httpMethod === "POST" && sub === "mouvement") {
      const d = JSON.parse(event.body || "{}");
      if (!d.article_id || !d.taille) return err("Article ou taille manquant", 400);
      const qte = parseInt(d.quantite) || 0;
      if (qte <= 0) return err("Quantité invalide", 400);

      const existing = await findStockDoc(db, d.article_id, d.taille);
      const delta = d.type === "entree" ? qte : -qte;
      if (existing) {
        const cur = +existing.data().quantite || 0;
        await existing.ref.update({ quantite: Math.max(0, cur + delta) });
      } else {
        // Nouveau doc avec ID auto (pas d'ID fabriqué → aucun caractère interdit)
        await db.collection("stock").add({
          article_id: d.article_id,
          taille: d.taille,
          quantite: Math.max(0, delta),
        });
      }
      await db.collection("mouvements_stock").add({
        article_id: d.article_id, taille: d.taille, type: d.type,
        quantite: qte, note: d.note || "", operateur: user.username || "",
        date: new Date().toISOString(),
      });
      return ok({ ok: true });
    }

    // POST /stock/init
    if (event.httpMethod === "POST" && sub === "init") {
      const d = JSON.parse(event.body || "{}");
      for (const item of (d.items || [])) {
        if (!item.article_id || !item.taille) continue;
        const qte = parseInt(item.quantite) || 0;
        if (qte <= 0) continue;
        const existing = await findStockDoc(db, item.article_id, item.taille);
        if (existing) {
          const cur = +existing.data().quantite || 0;
          await existing.ref.update({ quantite: cur + qte });
        } else {
          await db.collection("stock").add({
            article_id: item.article_id,
            taille: item.taille,
            quantite: qte,
          });
        }
        await db.collection("mouvements_stock").add({
          article_id: item.article_id, taille: item.taille, type: "entree",
          quantite: qte, note: "Réception commande fournisseur",
          operateur: user.username || "", date: new Date().toISOString(),
        });
      }
      return ok({ ok: true });
    }

    return err("Route inconnue", 404);
  } catch (e) {
    console.error("stock error:", e);
    return err(e.message || "Erreur serveur", 500);
  }
}