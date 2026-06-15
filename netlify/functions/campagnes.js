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

  // GET /campagnes/:id
  if (event.httpMethod === "GET" && id) {
    const doc = await db.collection("campagnes").doc(id).get();
    return doc.exists ? ok({ id: doc.id, ...doc.data() }) : err("Introuvable", 404);
  }

  // POST /campagnes
  if (event.httpMethod === "POST") {
    const d = JSON.parse(event.body || "{}");
    const nom = (d.nom || "").trim();
    if (!nom) return err("Nom de campagne requis", 400);

    const doc = {
      nom,
      annee: d.annee || new Date().getFullYear(),  // pour rester compatible avec l'orderBy("annee")
      surplus_pct: Number.isFinite(+d.surplus_pct) ? +d.surplus_pct : 10,
      statut: "ouverte",
      date_ouverture: new Date().toISOString(),
      creneaux: Array.isArray(d.creneaux) ? d.creneaux.map(c => ({
        date_debut: c.date_debut || "",
        date_fin:   c.date_fin   || c.date_debut || "",
        heure:      c.heure      || "",
        lieu:       c.lieu       || "",
      })) : [],
    };
    const ref = await db.collection("campagnes").add(doc);
    return ok({ id: ref.id });
  }

  // PUT /campagnes/:id
  if (event.httpMethod === "PUT" && id) {
    const d = JSON.parse(event.body || "{}");
    const update = {};
    if (typeof d.nom === "string" && d.nom.trim()) update.nom = d.nom.trim();
    if (d.statut) {
      update.statut = d.statut;
      if (d.statut === "fermee") update.date_fermeture = new Date().toISOString();
    }
    if (d.surplus_pct !== undefined && Number.isFinite(+d.surplus_pct)) {
      update.surplus_pct = +d.surplus_pct;
    }
    if (Array.isArray(d.creneaux)) {
      update.creneaux = d.creneaux.map(c => ({
        date_debut: c.date_debut || "",
        date_fin:   c.date_fin   || c.date_debut || "",
        heure:      c.heure      || "",
        lieu:       c.lieu       || "",
      }));
    }
    if (Object.keys(update).length === 0) return err("Aucun champ à mettre à jour", 400);
    await db.collection("campagnes").doc(id).update(update);
    return ok({ ok: true });
  }

  return err("Route inconnue", 404);
}