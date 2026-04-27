// netlify/functions/campagnes.js
import { getDb, requireAuth, ok, err, options } from "./_lib/firebase.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();
  const user = requireAuth(event);
  if (!user) return err("Non autorisé", 401);

  const db = getDb();
  const path = event.path.replace(/.*\/campagnes/, "");
  const id = path.replace("/", "").split("?")[0];

  // GET /campagnes
  if (event.httpMethod === "GET" && !id) {
    const snap = await db.collection("campagnes").orderBy("annee", "desc").get();
    const campagnes = await Promise.all(snap.docs.map(async d => {
      const data = { id: d.id, ...d.data() };
      const pSnap = await db.collection("precommandes").where("campagne_id", "==", d.id).get();
      data.nb_precommandes = pSnap.size;
      let ca_total = 0;
      for (const p of pSnap.docs) {
        const lSnap = await db.collection("lignes_precommande").where("precommande_id", "==", p.id).get();
        lSnap.forEach(l => { ca_total += l.data().quantite * l.data().prix_unitaire; });
      }
      data.ca_total = Math.round(ca_total * 100) / 100;
      return data;
    }));
    return ok(campagnes);
  }

  // GET /campagnes/active
  if (event.httpMethod === "GET" && id === "active") {
    const snap = await db.collection("campagnes").where("statut", "==", "ouverte").orderBy("annee", "desc").limit(1).get();
    return ok(snap.empty ? {} : { id: snap.docs[0].id, ...snap.docs[0].data() });
  }

  // POST /campagnes
  if (event.httpMethod === "POST") {
    const d = JSON.parse(event.body || "{}");
    const ref = await db.collection("campagnes").add({
      annee: d.annee,
      surplus_pct: d.surplus_pct || 10,
      statut: "ouverte",
      date_ouverture: new Date().toISOString(),
      date_distribution: d.date_distribution || null,
      heure_distribution: d.heure_distribution || null,
      lieu_distribution: d.lieu_distribution || null,
    });
    return ok({ id: ref.id });
  }

  // PUT /campagnes/:id
  if (event.httpMethod === "PUT" && id) {
    const d = JSON.parse(event.body || "{}");
    const update = {};
    if (d.statut) {
      update.statut = d.statut;
      if (d.statut === "fermee") update.date_fermeture = new Date().toISOString();
    }
    if (d.surplus_pct !== undefined) update.surplus_pct = d.surplus_pct;
    await db.collection("campagnes").doc(id).update(update);
    return ok({ ok: true });
  }

  return err("Route inconnue", 404);
}
