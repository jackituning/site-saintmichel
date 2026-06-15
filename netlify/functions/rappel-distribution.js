// netlify/functions/rappel-distribution.js
// Fonction planifiée — s'exécute chaque matin à 8h (Europe/Paris)
// Cron : "0 6 * * *"  (6h UTC = 8h Paris été, 7h Paris hiver)
//
// Elle lit la date_distribution de la campagne active,
// calcule le nombre de jours restants, et envoie un email
// aux parents dont la précommande n'est pas encore distribuée
// si on est à exactement JOURS_RAPPELS[i] jours de la date.

import { schedule } from "@netlify/functions";
import { getDb } from "./_lib/firebase.js";
import nodemailer from "nodemailer";

// ── Jours avant distribution où un rappel est envoyé ──────────────────────
const JOURS_RAPPELS = [7];

// ── Mailer ────────────────────────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp-relay.brevo.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });
}

async function sendRappel(transport, precommande, lignes, campagne, joursRestants) {
  const total = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);

  const dateDistrib = new Date(campagne.date_distribution);
  const dateStr = dateDistrib.toLocaleDateString("fr-FR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  const lieuStr = campagne.lieu_distribution || "l'établissement";
  const heureStr = campagne.heure_distribution || "";

  const urgenceLabel = joursRestants === 1
    ? "⚠️ Demain !"
    : joursRestants === 3
    ? "Dans 3 jours"
    : `Dans ${joursRestants} jours`;

  const rowsHtml = lignes.map(l => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${l.article_nom}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${l.taille}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${l.quantite}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">${(l.quantite * l.prix_unitaire).toFixed(2)} €</td>
    </tr>`).join("");

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#333">
    <div style="background:#1a3a5c;padding:24px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px">Saint Michel Uniformes</h1>
      <p style="color:#b0c8e8;margin:6px 0 0">Rappel de distribution · ${urgenceLabel}</p>
    </div>
    <div style="padding:28px 32px">
      <p>Bonjour <strong>${precommande.parent_prenom}</strong>,</p>
      <p>Ceci est un rappel : la distribution des uniformes pour <strong>${precommande.enfant_prenom} ${precommande.enfant_nom}</strong> aura lieu :</p>

      <div style="background:#f0f7ff;border-left:4px solid #1a3a5c;padding:16px 20px;margin:20px 0;border-radius:4px">
        <div style="font-size:18px;font-weight:bold;color:#1a3a5c;margin-bottom:6px">📅 ${dateStr}</div>
        ${heureStr ? `<div style="font-size:15px;color:#444">🕐 ${heureStr}</div>` : ""}
        <div style="font-size:15px;color:#444;margin-top:4px">📍 ${lieuStr}</div>
      </div>

      <p><strong>Votre commande :</strong></p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
        <thead>
          <tr style="background:#f0f4f8">
            <th style="padding:8px 12px;text-align:left">Article</th>
            <th style="padding:8px 12px;text-align:center">Taille</th>
            <th style="padding:8px 12px;text-align:center">Qté</th>
            <th style="padding:8px 12px;text-align:right">Montant</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding:10px 12px;text-align:right;font-weight:bold">Total à régler</td>
            <td style="padding:10px 12px;text-align:right;font-weight:bold;color:#1a3a5c;font-size:16px">${total.toFixed(2)} €</td>
          </tr>
        </tfoot>
      </table>

      <div style="background:#fffbeb;border:1px solid #fde68a;padding:14px 18px;border-radius:6px;font-size:13px;color:#92400e">
        💳 Le règlement s'effectue en espèces ou par chèque lors du retrait des uniformes.
      </div>

      <p style="margin-top:20px">Merci,<br><strong>L'équipe Saint Michel Uniformes</strong></p>
    </div>
    <div style="background:#f0f4f8;padding:14px 32px;font-size:12px;color:#888;text-align:center">
      Cet email est envoyé automatiquement, merci de ne pas y répondre.
    </div>
  </div>`;

  const text = `Bonjour ${precommande.parent_prenom},\n\nRappel : la distribution des uniformes pour ${precommande.enfant_prenom} ${precommande.enfant_nom} aura lieu le ${dateStr}${heureStr ? " à " + heureStr : ""} à ${lieuStr}.\n\nTotal à régler sur place : ${total.toFixed(2)} €\n\nMerci,\nL'équipe Saint Michel Uniformes`;

  const subjectPrefix = joursRestants === 1 ? "⚠️ Demain" : `Dans ${joursRestants} jours`;

  await transport.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || "Saint Michel Uniformes"}" <${process.env.SMTP_USER}>`,
    to: precommande.parent_email,
    subject: `[${subjectPrefix}] Distribution des uniformes – ${precommande.enfant_prenom} ${precommande.enfant_nom}`,
    text,
    html,
  });
}

// ── Handler principal ─────────────────────────────────────────────────────
const rappelHandler = async () => {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    console.warn("SMTP non configuré, rappels non envoyés.");
    return { statusCode: 200, body: "SMTP non configuré" };
  }

  const db = getDb();

  // Récupère la campagne active avec une date de distribution
  const campSnap = await db.collection("campagnes")
    .where("statut", "==", "ouverte")
    .orderBy("annee", "desc")
    .limit(1)
    .get();

  if (campSnap.empty) {
    console.log("Aucune campagne ouverte.");
    return { statusCode: 200, body: "Aucune campagne ouverte" };
  }

  const campDoc = campSnap.docs[0];
  const campagne = { id: campDoc.id, ...campDoc.data() };

  if (!campagne.date_distribution) {
    console.log("Aucune date de distribution définie sur la campagne.");
    return { statusCode: 200, body: "Pas de date_distribution" };
  }

  // Calcule le nombre de jours restants (comparaison par date calendaire)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const distrib = new Date(campagne.date_distribution);
  distrib.setHours(0, 0, 0, 0);
  const diffMs = distrib - today;
  const joursRestants = Math.round(diffMs / (1000 * 60 * 60 * 24));

  console.log(`Jours avant distribution : ${joursRestants}`);

  if (!JOURS_RAPPELS.includes(joursRestants)) {
    console.log(`Pas de rappel prévu à J-${joursRestants}.`);
    return { statusCode: 200, body: `Pas de rappel à J-${joursRestants}` };
  }

  // Récupère toutes les précommandes non distribuées
  const pSnap = await db.collection("precommandes")
    .where("campagne_id", "==", campagne.id)
    .get();

  const transport = createTransport();
  let sent = 0;
  let errors = 0;

  for (const pd of pSnap.docs) {
    const precommande = { id: pd.id, ...pd.data() };

    // Vérifie que cette précommande n'est pas déjà distribuée
    const dSnap = await db.collection("distributions")
      .where("precommande_id", "==", pd.id)
      .limit(1)
      .get();

    if (!dSnap.empty) continue; // déjà distribué → pas de rappel

    // Récupère les lignes
    const lSnap = await db.collection("lignes_precommande")
      .where("precommande_id", "==", pd.id)
      .get();

    const lignes = await Promise.all(lSnap.docs.map(async ld => {
      const l = { id: ld.id, ...ld.data() };
      const aDoc = await db.collection("articles").doc(l.article_id).get();
      l.article_nom = aDoc.exists ? aDoc.data().nom : l.article_id;
      return l;
    }));

    try {
      await sendRappel(transport, precommande, lignes, campagne, joursRestants);
      console.log(`✅ Rappel J-${joursRestants} envoyé à ${precommande.parent_email}`);
      sent++;
    } catch (e) {
      console.error(`❌ Erreur envoi à ${precommande.parent_email}:`, e.message);
      errors++;
    }
  }

  const summary = `Rappels J-${joursRestants} envoyés : ${sent} OK, ${errors} erreurs`;
  console.log(summary);
  return { statusCode: 200, body: summary };
};

// Cron : tous les matins à 6h UTC (8h Paris été)
import { schedule } from "@netlify/functions";
export const handler = schedule("0 6 * * *", async (event) => {
  return await rappelHandler(event);
});
