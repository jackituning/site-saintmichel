// netlify/functions/precommande-publique.js
// Route publique — pas d'authentification requise
import { getDb, ok, err, options } from "./_lib/firebase.js";
import { sendConfirmationEmail } from "./_lib/mailer.js";

async function getCampagneActive(db) {
  const snap = await db.collection("campagnes")
    .where("statut", "==", "ouverte")
    .orderBy("annee", "desc")
    .limit(1)
    .get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();

  const db = getDb();

  // GET /precommande-publique — récupère les articles actifs + campagne active
  if (event.httpMethod === "GET") {
    const campagne = await getCampagneActive(db);
    if (!campagne) return err("Aucune campagne ouverte actuellement", 404);

    const snap = await db.collection("articles")
      .where("actif", "==", true)
      .orderBy("ordre")
      .get();
    const articles = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    return ok({ campagne, articles });
  }

  // POST /precommande-publique — soumet une précommande
  if (event.httpMethod === "POST") {
    const campagne = await getCampagneActive(db);
    if (!campagne) return err("Aucune campagne ouverte actuellement", 400);

    const d = JSON.parse(event.body || "{}");

    // Validation des champs obligatoires
    const required = ["parent_nom", "parent_prenom", "parent_email", "enfant_nom", "enfant_prenom", "niveau"];
    for (const f of required) {
      if (!d[f]?.trim()) return err(`Champ manquant : ${f}`, 400);
    }
    if (!d.lignes?.length) return err("Aucun article sélectionné", 400);

    // Validation email basique
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.parent_email)) {
      return err("Adresse email invalide", 400);
    }

    // Récupération des prix réels depuis Firestore (sécurité)
    const lignesValidees = [];
    for (const l of d.lignes) {
      if (!l.article_id || !l.taille || !l.quantite) continue;
      const aDoc = await db.collection("articles").doc(l.article_id).get();
      if (!aDoc.exists || !aDoc.data().actif) return err(`Article introuvable : ${l.article_id}`, 400);
      const article = aDoc.data();
      if (!article.tailles.includes(l.taille)) return err(`Taille invalide pour ${article.nom}`, 400);
      lignesValidees.push({
        article_id: l.article_id,
        article_nom: article.nom,
        taille: l.taille,
        quantite: Math.max(1, parseInt(l.quantite) || 1),
        prix_unitaire: article.prix,
      });
    }
    if (!lignesValidees.length) return err("Aucun article valide dans la commande", 400);

    // Création de la précommande
    const ref = await db.collection("precommandes").add({
      campagne_id: campagne.id,
      parent_nom: d.parent_nom.trim(),
      parent_prenom: d.parent_prenom.trim(),
      parent_email: d.parent_email.trim().toLowerCase(),
      parent_tel: d.parent_tel?.trim() || "",
      enfant_nom: d.enfant_nom.trim(),
      enfant_prenom: d.enfant_prenom.trim(),
      niveau: d.niveau.trim(),
      note: d.note?.trim() || "",
      created_at: new Date().toISOString(),
    });

    // Création des lignes
    for (const l of lignesValidees) {
      await db.collection("lignes_precommande").add({
        precommande_id: ref.id,
        article_id: l.article_id,
        taille: l.taille,
        quantite: l.quantite,
        prix_unitaire: l.prix_unitaire,
      });
    }

    // Email de confirmation
    try {
      await sendConfirmationEmail(d, lignesValidees);
    } catch (e) {
      console.error("Email error:", e.message);
    }

    const total = lignesValidees.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);
    return ok({ id: ref.id, total: total.toFixed(2) });
  }

  return err("Méthode non supportée", 405);
}
