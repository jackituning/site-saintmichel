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
    const campagne = await getCampagneActive(db);
    const pSnap = campagne
      ? await db.collection("precommandes").where("campagne_id", "==", campagne.id).orderBy("created_at", "desc").get()
      : await db.collection("precommandes").orderBy("created_at", "desc").get();
    const rows = [["Nom parent","Prénom parent","Email","Téléphone","Nom enfant","Prénom enfant","Niveau","Article","Taille","Qté","Prix unitaire","Sous-total","Date","Distribué","Mode paiement"]];
    for (const pd of pSnap.docs) {
      const p = pd.data();
      const lSnap = await db.collection("lignes_precommande").where("precommande_id", "==", pd.id).get();
      const dSnap = await db.collection("distributions").where("precommande_id", "==", pd.id).limit(1).get();
      const dist = dSnap.empty ? null : dSnap.docs[0].data();
      for (const ld of lSnap.docs) {
        const l = ld.data();
        const aDoc = await db.collection("articles").doc(l.article_id).get();
        rows.push([p.parent_nom,p.parent_prenom,p.parent_email,p.parent_tel||"",p.enfant_nom,p.enfant_prenom,p.niveau,
          aDoc.exists ? aDoc.data().nom : l.article_id, l.taille, l.quantite, l.prix_unitaire,
          (l.quantite*l.prix_unitaire).toFixed(2), p.created_at, dist ? "Oui" : "Non", dist?.mode_paiement || ""]);
      }
    }
    const csv = "\uFEFF" + rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    return { statusCode: 200, headers: { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": "attachment;filename=precommandes_export.csv" }, body: csv };
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
