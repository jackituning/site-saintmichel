// netlify/functions/precommandes.js
import { getDb, requireAuth, ok, err, options, FieldValue } from "./_lib/firebase.js";
import { sendConfirmationEmail } from "./_lib/mailer.js";

async function getCampagneActive(db) {
  const snap = await db.collection("campagnes").where("statut", "==", "ouverte").orderBy("annee", "desc").limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();
  const user = requireAuth(event);
  if (!user) return err("Non autorisé", 401);

  const db = getDb();
  const rawPath = event.path.replace(/.*\/precommandes/, "");
  const parts = rawPath.split("/").filter(Boolean);
  const id = parts[0];
  const sub = parts[1]; // ex: "export"

  // GET /precommandes/export
  if (event.httpMethod === "GET" && id === "export") {
    try {
      const campagne = await getCampagneActive(db);
      const all = event.queryStringParameters?.all;

      // 4 requêtes en parallèle au lieu de N+1 séquentielles
      const [pSnap, lignesAllSnap, distAllSnap, articlesSnap] = await Promise.all([
        (campagne && !all)
          ? db.collection("precommandes").where("campagne_id", "==", campagne.id).get()
          : db.collection("precommandes").get(),
        db.collection("lignes_precommande").get(),
        db.collection("distributions").get(),
        db.collection("articles").get(),
      ]);

      // Tri en mémoire (created_at parfois absent)
      const precommandes = pSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

      // Index pour lookups O(1)
      const lignesByPid = {};
      lignesAllSnap.docs.forEach(d => {
        const l = d.data();
        if (!l.precommande_id) return;
        (lignesByPid[l.precommande_id] = lignesByPid[l.precommande_id] || []).push(l);
      });
      const distByPid = {};
      distAllSnap.docs.forEach(d => {
        const dist = d.data();
        if (!dist.precommande_id) return;
        if (!distByPid[dist.precommande_id]) distByPid[dist.precommande_id] = dist;
      });
      const articlesById = {};
      articlesSnap.docs.forEach(d => { articlesById[d.id] = d.data(); });

      const rows = [["Nom parent","Prénom parent","Email","Téléphone","Nom enfant","Prénom enfant","Niveau","Article","Taille","Qté","Prix unitaire","Sous-total","Date","Distribué","Mode paiement"]];
      for (const p of precommandes) {
        const lignes = lignesByPid[p.id] || [];
        const dist = distByPid[p.id] || null;
        if (!lignes.length) {
          rows.push([p.parent_nom||"", p.parent_prenom||"", p.parent_email||"", p.parent_tel||"", p.enfant_nom||"", p.enfant_prenom||"", p.niveau||"", "", "", 0, 0, "0.00", p.created_at||"", dist ? "Oui" : "Non", dist?.mode_paiement || ""]);
          continue;
        }
        for (const l of lignes) {
          const art = articlesById[l.article_id];
          const q = +l.quantite || 0;
          const pu = +l.prix_unitaire || 0;
          rows.push([
            p.parent_nom||"", p.parent_prenom||"", p.parent_email||"", p.parent_tel||"",
            p.enfant_nom||"", p.enfant_prenom||"", p.niveau||"",
            art ? art.nom : (l.article_id||""), l.taille||"", q, pu,
            (q * pu).toFixed(2), p.created_at||"", dist ? "Oui" : "Non", dist?.mode_paiement || ""
          ]);
        }
      }
      const csv = "\uFEFF" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      return { statusCode: 200, headers: { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": "attachment;filename=precommandes_export.csv" }, body: csv };
    } catch (e) {
      console.error("export error:", e);
      return { statusCode: 200, headers: { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": "attachment;filename=precommandes_export.csv" }, body: "\uFEFF" + "Erreur lors de la génération du CSV : " + (e.message||"inconnue") };
    }
  }

  // GET /precommandes
  if (event.httpMethod === "GET" && !id) {
    const campagne = await getCampagneActive(db);
    if (!campagne) return ok([]);
    const q = (event.queryStringParameters?.q || "").toLowerCase();
    const nd = event.queryStringParameters?.non_distribues;
    const pSnap = await db.collection("precommandes").where("campagne_id", "==", campagne.id).orderBy("created_at", "desc").get();
    const result = await Promise.all(pSnap.docs.map(async pd => {
      const p = { id: pd.id, ...pd.data() };
      const lSnap = await db.collection("lignes_precommande").where("precommande_id", "==", pd.id).get();
      p.nb_lignes = lSnap.size;
      p.total = lSnap.docs.reduce((s, l) => s + l.data().quantite * l.data().prix_unitaire, 0);
      const dSnap = await db.collection("distributions").where("precommande_id", "==", pd.id).limit(1).get();
      p.distribue = !dSnap.empty;
      return p;
    }));
    let filtered = result;
    if (nd) filtered = filtered.filter(p => !p.distribue);
    if (q) filtered = filtered.filter(p => (p.enfant_nom+p.enfant_prenom+p.parent_nom+p.parent_email).toLowerCase().includes(q));
    return ok(filtered);
  }

  // POST /precommandes
  if (event.httpMethod === "POST") {
    const campagne = await getCampagneActive(db);
    if (!campagne) return err("Aucune campagne ouverte", 400);
    const d = JSON.parse(event.body || "{}");
    const ref = await db.collection("precommandes").add({
      campagne_id: campagne.id,
      parent_nom: d.parent_nom, parent_prenom: d.parent_prenom,
      parent_email: d.parent_email, parent_tel: d.parent_tel || "",
      enfant_nom: d.enfant_nom, enfant_prenom: d.enfant_prenom,
      niveau: d.niveau, note: d.note || "",
      created_at: new Date().toISOString(),
    });
    const lignesEmail = [];
    for (const l of (d.lignes || [])) {
      await db.collection("lignes_precommande").add({
        precommande_id: ref.id,
        article_id: l.article_id, taille: l.taille,
        quantite: l.quantite, prix_unitaire: l.prix_unitaire,
      });
      const aDoc = await db.collection("articles").doc(l.article_id).get();
      lignesEmail.push({ ...l, article_nom: aDoc.exists ? aDoc.data().nom : l.article_id });
    }
    try { await sendConfirmationEmail(d, lignesEmail); } catch(e) { console.error("Email error:", e.message); }
    return ok({ id: ref.id });
  }

  // GET /precommandes/:id
  if (event.httpMethod === "GET" && id) {
    const pd = await db.collection("precommandes").doc(id).get();
    if (!pd.exists) return err("Introuvable", 404);
    const lSnap = await db.collection("lignes_precommande").where("precommande_id", "==", id).get();
    const lignes = await Promise.all(lSnap.docs.map(async ld => {
      const l = { id: ld.id, ...ld.data() };
      const aDoc = await db.collection("articles").doc(l.article_id).get();
      l.article_nom = aDoc.exists ? aDoc.data().nom : l.article_id;
      return l;
    }));
    const dSnap = await db.collection("distributions").where("precommande_id", "==", id).limit(1).get();
    return ok({ id: pd.id, ...pd.data(), lignes, distribution: dSnap.empty ? null : { id: dSnap.docs[0].id, ...dSnap.docs[0].data() } });
  }

  // PUT /precommandes/:id  — modifie uniquement les lignes (articles/tailles/quantités)
  if (event.httpMethod === "PUT" && id) {
    const pd = await db.collection("precommandes").doc(id).get();
    if (!pd.exists) return err("Introuvable", 404);

    // Bloquer si déjà distribuée
    const dSnap = await db.collection("distributions").where("precommande_id", "==", id).limit(1).get();
    if (!dSnap.empty) return err("Précommande déjà distribuée, modification interdite", 400);

    const d = JSON.parse(event.body || "{}");
    const lignesIn = Array.isArray(d.lignes) ? d.lignes : [];

    // Valider chaque ligne contre la collection articles
    const validees = [];
    for (const l of lignesIn) {
      if (!l.article_id || !l.taille || !l.quantite) continue;
      const aDoc = await db.collection("articles").doc(l.article_id).get();
      if (!aDoc.exists) return err(`Article introuvable : ${l.article_id}`, 400);
      const article = aDoc.data();
      if (!article.tailles?.includes(l.taille)) return err(`Taille invalide pour ${article.nom}`, 400);
      validees.push({
        article_id: l.article_id,
        taille: l.taille,
        quantite: Math.max(1, parseInt(l.quantite) || 1),
        prix_unitaire: parseFloat(l.prix_unitaire) || article.prix,
      });
    }

  // Remplace toutes les lignes en une transaction batch
  const oldSnap = await db.collection("lignes_precommande").where("precommande_id", "==", id).get();
  const batch = db.batch();
  oldSnap.docs.forEach(doc => batch.delete(doc.ref));
  for (const l of validees) {
    const ref = db.collection("lignes_precommande").doc();
    batch.set(ref, { precommande_id: id, ...l });
  }
  await batch.commit();
  return ok({ ok: true, nb_lignes: validees.length });
}

  // DELETE /precommandes/:id
  if (event.httpMethod === "DELETE" && id) {
    const lSnap = await db.collection("lignes_precommande").where("precommande_id", "==", id).get();
    const batch = db.batch();
    lSnap.docs.forEach(d => batch.delete(d.ref));
    batch.delete(db.collection("precommandes").doc(id));
    await batch.commit();
    return ok({ ok: true });
  }

  return err("Route inconnue", 404);
}
