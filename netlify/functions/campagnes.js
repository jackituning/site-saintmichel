// netlify/functions/campagnes.js
import { getDb, requireAuth, ok, err, options } from "./_lib/firebase.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();
  const user = requireAuth(event);
  if (!user) return err("Non autorisé", 401);

  try {
    const db = getDb();
    const path = event.path.replace(/.*\/campagnes/, "");
    const id = path.replace("/", "").split("?")[0];

    // GET /campagnes  — LISTE
    if (event.httpMethod === "GET" && !id) {
      // Pas d'orderBy Firestore : sinon les campagnes sans champ "annee" sont exclues
      const [snap, precomsSnap, lignesSnap] = await Promise.all([
        db.collection("campagnes").get(),
        db.collection("precommandes").get(),
        db.collection("lignes_precommande").get(),
      ]);

      // Index lignes par précommande_id
      const lignesByPid = {};
      lignesSnap.docs.forEach(d => {
        const l = d.data();
        if (!l.precommande_id) return;
        (lignesByPid[l.precommande_id] = lignesByPid[l.precommande_id] || []).push(l);
      });

      // Index précommandes par campagne_id
      const precomsByCid = {};
      precomsSnap.docs.forEach(d => {
        const p = { id: d.id, ...d.data() };
        if (!p.campagne_id) return;
        (precomsByCid[p.campagne_id] = precomsByCid[p.campagne_id] || []).push(p);
      });

      const campagnes = snap.docs.map(d => {
        const data = { id: d.id, ...d.data() };
        const precoms = precomsByCid[d.id] || [];
        data.nb_precommandes = precoms.length;
        let ca_total = 0;
        for (const p of precoms) {
          const lignes = lignesByPid[p.id] || [];
          for (const l of lignes) {
            ca_total += (+l.quantite || 0) * (+l.prix_unitaire || 0);
          }
        }
        data.ca_total = Math.round(ca_total * 100) / 100;
        return data;
      });

      // Tri en mémoire : ouvertes d'abord, puis par annee desc (0 si absent), puis par nom
      campagnes.sort((a, b) => {
        if ((a.statut === "ouverte") !== (b.statut === "ouverte")) {
          return a.statut === "ouverte" ? -1 : 1;
        }
        const ay = +a.annee || 0, by = +b.annee || 0;
        if (ay !== by) return by - ay;
        return String(a.nom || "").localeCompare(String(b.nom || ""));
      });

      return ok(campagnes);
    }

    // GET /campagnes/active
    if (event.httpMethod === "GET" && id === "active") {
      const snap = await db.collection("campagnes").where("statut", "==", "ouverte").get();
      if (snap.empty) return ok({});
      const camps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      camps.sort((a, b) => (+b.annee || 0) - (+a.annee || 0));
      return ok(camps[0]);
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
        annee: d.annee || new Date().getFullYear(),
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
      // Compléter le champ annee si absent (backfill silencieux)
      const existing = await db.collection("campagnes").doc(id).get();
      if (existing.exists && !existing.data().annee) {
        update.annee = new Date().getFullYear();
      }
      if (Object.keys(update).length === 0) return err("Aucun champ à mettre à jour", 400);
      await db.collection("campagnes").doc(id).update(update);
      return ok({ ok: true });
    }

    return err("Route inconnue", 404);
  } catch (e) {
    console.error("campagnes error:", e);
    return err(e.message || "Erreur serveur", 500);
  }
}