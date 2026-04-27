// netlify/functions/distributions.js
import { getDb, requireAuth, ok, err, options } from "./_lib/firebase.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();
  const user = requireAuth(event);
  if (!user) return err("Non autorisé", 401);

  const db = getDb();
  const path = event.path.replace(/.*\/distributions/, "");
  const id = path.replace("/", "").split("?")[0];

  // GET /distributions
  if (event.httpMethod === "GET") {
    const snap = await db.collection("distributions").orderBy("validated_at", "desc").get();
    const result = await Promise.all(snap.docs.map(async d => {
      const dist = { id: d.id, ...d.data() };
      const pDoc = await db.collection("precommandes").doc(dist.precommande_id).get();
      if (pDoc.exists) Object.assign(dist, pDoc.data());
      return dist;
    }));
    return ok(result);
  }

  // POST /distributions
  if (event.httpMethod === "POST") {
    const d = JSON.parse(event.body || "{}");
    const ids = d.precommande_ids || [];
    for (const pid of ids) {
      // Calc total
      const lSnap = await db.collection("lignes_precommande").where("precommande_id", "==", pid).get();
      const total = lSnap.docs.reduce((s, l) => s + l.data().quantite * l.data().prix_unitaire, 0);
      // Check not already distributed
      const existing = await db.collection("distributions").where("precommande_id", "==", pid).limit(1).get();
      if (!existing.empty) continue;
      await db.collection("distributions").add({
        precommande_id: pid,
        mode_paiement: d.mode_paiement,
        montant_total: Math.round(total * 100) / 100,
        validated_at: new Date().toISOString(),
        validated_by: user.username,
        note: d.note || "",
      });
      // Décrementer stock
      for (const ld of lSnap.docs) {
        const l = ld.data();
        const key = `${l.article_id}__${l.taille}`;
        const stockRef = db.collection("stock").doc(key);
        const stockDoc = await stockRef.get();
        if (stockDoc.exists) {
          await stockRef.update({ quantite: stockDoc.data().quantite - l.quantite });
        }
        await db.collection("mouvements_stock").add({
          article_id: l.article_id, taille: l.taille, type: "sortie",
          quantite: l.quantite, note: `Distribution précommande #${pid}`,
          operateur: user.username, date: new Date().toISOString(),
        });
      }
    }
    return ok({ ok: true });
  }

  // DELETE /distributions/:id
  if (event.httpMethod === "DELETE" && id) {
    const distDoc = await db.collection("distributions").doc(id).get();
    if (!distDoc.exists) return err("Introuvable", 404);
    const dist = distDoc.data();
    const lSnap = await db.collection("lignes_precommande").where("precommande_id", "==", dist.precommande_id).get();
    for (const ld of lSnap.docs) {
      const l = ld.data();
      const key = `${l.article_id}__${l.taille}`;
      const stockRef = db.collection("stock").doc(key);
      const stockDoc = await stockRef.get();
      if (stockDoc.exists) {
        await stockRef.update({ quantite: stockDoc.data().quantite + l.quantite });
      }
      await db.collection("mouvements_stock").add({
        article_id: l.article_id, taille: l.taille, type: "entree",
        quantite: l.quantite, note: `Annulation distribution #${id}`,
        operateur: user.username, date: new Date().toISOString(),
      });
    }
    await db.collection("distributions").doc(id).delete();
    return ok({ ok: true });
  }

  return err("Route inconnue", 404);
}
