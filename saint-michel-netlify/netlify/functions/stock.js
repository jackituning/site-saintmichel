// netlify/functions/stock.js
import { getDb, requireAuth, ok, err, options } from "./_lib/firebase.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();
  const user = requireAuth(event);
  if (!user) return err("Non autorisé", 401);

  const db = getDb();
  const path = event.path.replace(/.*\/stock/, "");
  const sub = path.replace("/", "").split("?")[0]; // "mouvement", "mouvements", "init", ""

  // GET /stock
  if (event.httpMethod === "GET" && !sub) {
    const snap = await db.collection("stock").get();
    const items = await Promise.all(snap.docs.map(async d => {
      const s = { id: d.id, ...d.data() };
      const aDoc = await db.collection("articles").doc(s.article_id).get();
      s.nom = aDoc.exists ? aDoc.data().nom : s.article_id;
      s.tailles = aDoc.exists ? aDoc.data().tailles : [];
      return s;
    }));
    return ok(items.sort((a, b) => a.nom.localeCompare(b.nom)));
  }

  // GET /stock/mouvements
  if (event.httpMethod === "GET" && sub === "mouvements") {
    const snap = await db.collection("mouvements_stock").orderBy("date", "desc").limit(200).get();
    const mvts = await Promise.all(snap.docs.map(async d => {
      const m = { id: d.id, ...d.data() };
      const aDoc = await db.collection("articles").doc(m.article_id).get();
      m.article_nom = aDoc.exists ? aDoc.data().nom : m.article_id;
      return m;
    }));
    return ok(mvts);
  }

  // POST /stock/mouvement
  if (event.httpMethod === "POST" && sub === "mouvement") {
    const d = JSON.parse(event.body || "{}");
    const key = `${d.article_id}__${d.taille}`;
    const stockRef = db.collection("stock").doc(key);
    const stockDoc = await stockRef.get();
    const delta = d.type === "entree" ? d.quantite : -d.quantite;
    if (stockDoc.exists) {
      await stockRef.update({ quantite: stockDoc.data().quantite + delta });
    } else {
      await stockRef.set({ article_id: d.article_id, taille: d.taille, quantite: Math.max(0, delta) });
    }
    await db.collection("mouvements_stock").add({
      article_id: d.article_id, taille: d.taille, type: d.type,
      quantite: d.quantite, note: d.note || "", operateur: user.username,
      date: new Date().toISOString(),
    });
    return ok({ ok: true });
  }

  // POST /stock/init
  if (event.httpMethod === "POST" && sub === "init") {
    const d = JSON.parse(event.body || "{}");
    for (const item of (d.items || [])) {
      const key = `${item.article_id}__${item.taille}`;
      const stockRef = db.collection("stock").doc(key);
      const stockDoc = await stockRef.get();
      if (stockDoc.exists) {
        await stockRef.update({ quantite: stockDoc.data().quantite + item.quantite });
      } else {
        await stockRef.set({ article_id: item.article_id, taille: item.taille, quantite: item.quantite });
      }
      await db.collection("mouvements_stock").add({
        article_id: item.article_id, taille: item.taille, type: "entree",
        quantite: item.quantite, note: "Réception commande fournisseur",
        operateur: user.username, date: new Date().toISOString(),
      });
    }
    return ok({ ok: true });
  }

  return err("Route inconnue", 404);
}
