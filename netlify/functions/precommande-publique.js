import { getDb, ok, err, CORS } from "./_lib/firebase.js";
import { sendConfirmationEmail } from "./_lib/mailer.js";

async function getCampagneActive(db) {
  const snap = await db.collection("campagnes")
    .where("statut", "==", "ouverte")
    .limit(1)
    .get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS };
  const db = getDb();

  // GET — articles + campagne
  if (event.httpMethod === "GET") {
    const snap = await db.collection("articles").where("actif", "==", true).get();
    const articles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const campagne = await getCampagneActive(db);
    return ok({ campagne: campagne || null, articles });
  }

  // POST — soumet une précommande (supporte plusieurs enfants)
  if (event.httpMethod === "POST") {
    const d = JSON.parse(event.body || "{}");

    // Validation parent
    const reqParent = ["parent_nom","parent_prenom","parent_email","parent_tel"];
    for (const f of reqParent) {
      if (!d[f]?.trim()) return err(`Champ manquant : ${f}`, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.parent_email)) return err("Adresse email invalide", 400);

    // Validation enfants
    const enfants = d.enfants || [];
    if (!enfants.length) return err("Au moins un enfant requis", 400);
    for (const e of enfants) {
      if (!e.nom?.trim() || !e.prenom?.trim() || !e.niveau?.trim()) return err("Informations enfant incomplètes", 400);
    }

    if (!d.lignes?.length) return err("Aucun article sélectionné", 400);

    const campagne = await getCampagneActive(db);

    // Valide les articles depuis Firestore
    const lignesValidees = [];
    for (const l of d.lignes) {
      if (!l.article_id || !l.taille || !l.quantite) continue;
      const aDoc = await db.collection("articles").doc(l.article_id).get();
      if (!aDoc.exists || !aDoc.data().actif) return err(`Article introuvable : ${l.article_id}`, 400);
      const article = aDoc.data();
      if (!article.tailles?.includes(l.taille)) return err(`Taille invalide pour ${article.nom}`, 400);
      lignesValidees.push({
        article_id: l.article_id,
        article_nom: article.nom,
        taille: l.taille,
        quantite: Math.max(1, parseInt(l.quantite) || 1),
        prix_unitaire: article.prix,
        enfant_idx: l.enfant_idx ?? 0,
      });
    }
    if (!lignesValidees.length) return err("Aucun article valide dans la commande", 400);

    // Crée une précommande par enfant
    const campagneId = campagne?.id || null;
    const refs = [];

    for (const enfant of enfants) {
      const lignesEnfant = lignesValidees.filter(l => l.enfant_idx === enfant.idx);
      if (!lignesEnfant.length) continue; // pas d'articles pour cet enfant, on skip

      const ref = await db.collection("precommandes").add({
        campagne_id: campagneId,
        parent_nom: d.parent_nom.trim(),
        parent_prenom: d.parent_prenom.trim(),
        parent_email: d.parent_email.trim().toLowerCase(),
        parent_tel: d.parent_tel.trim(),
        enfant_nom: enfant.nom.trim(),
        enfant_prenom: enfant.prenom.trim(),
        niveau: enfant.niveau.trim(),
        note: d.note?.trim() || "",
        created_at: new Date().toISOString(),
      });

      for (const l of lignesEnfant) {
        await db.collection("lignes_precommande").add({
          precommande_id: ref.id,
          article_id: l.article_id,
          taille: l.taille,
          quantite: l.quantite,
          prix_unitaire: l.prix_unitaire,
        });
      }
      refs.push(ref.id);
    }

    // Si aucune ligne associée à un enfant (formulaire 1 enfant), on crée pour le premier
    if (!refs.length) {
      const enfant = enfants[0];
      const ref = await db.collection("precommandes").add({
        campagne_id: campagneId,
        parent_nom: d.parent_nom.trim(),
        parent_prenom: d.parent_prenom.trim(),
        parent_email: d.parent_email.trim().toLowerCase(),
        parent_tel: d.parent_tel.trim(),
        enfant_nom: enfant.nom.trim(),
        enfant_prenom: enfant.prenom.trim(),
        niveau: enfant.niveau.trim(),
        note: d.note?.trim() || "",
        created_at: new Date().toISOString(),
      });
      for (const l of lignesValidees) {
        await db.collection("lignes_precommande").add({
          precommande_id: ref.id,
          article_id: l.article_id,
          taille: l.taille,
          quantite: l.quantite,
          prix_unitaire: l.prix_unitaire,
        });
      }
      refs.push(ref.id);
    }

    try {
      await sendConfirmationEmail({ ...d, enfants }, lignesValidees);
    } catch(e) {
      console.error("Email error:", e.message);
    }

    const total = lignesValidees.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
    return ok({ id: refs[0], ids: refs, total: total.toFixed(2) });
  }

  return err("Méthode non supportée", 405);
}