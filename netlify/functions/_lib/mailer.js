// netlify/functions/_lib/mailer.js
import nodemailer from "nodemailer";

export async function sendConfirmationEmail(precommande, lignes) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    console.warn("Email non configuré (SMTP_USER / SMTP_PASSWORD manquants)");
    return;
  }

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp-relay.brevo.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  });

  const total = lignes.reduce((s, l) => s + l.quantite * l.prix_unitaire, 0);

  const rowsHtml = lignes.map(l => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${l.article_nom}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${l.taille}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${l.quantite}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">${l.prix_unitaire.toFixed(2)} €</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">${(l.quantite * l.prix_unitaire).toFixed(2)} €</td>
    </tr>`).join("");

  const rowsTxt = lignes.map(l =>
    `  - ${l.article_nom} | Taille ${l.taille} | Qté ${l.quantite} | ${(l.quantite * l.prix_unitaire).toFixed(2)} €`
  ).join("\n");

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#333">
    <div style="background:#1a3a5c;padding:24px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:22px">Saint Michel Uniformes</h1>
      <p style="color:#b0c8e8;margin:6px 0 0">Confirmation de précommande</p>
    </div>
    <div style="padding:28px 32px">
      <p>Bonjour <strong>${precommande.parent_prenom}</strong>,</p>
      <p>Nous avons bien reçu la précommande pour <strong>${precommande.enfant_prenom} ${precommande.enfant_nom}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px">
        <thead>
          <tr style="background:#f0f4f8">
            <th style="padding:8px 12px;text-align:left">Article</th>
            <th style="padding:8px 12px;text-align:center">Taille</th>
            <th style="padding:8px 12px;text-align:center">Qté</th>
            <th style="padding:8px 12px;text-align:right">Prix unit.</th>
            <th style="padding:8px 12px;text-align:right">Sous-total</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot>
          <tr>
            <td colspan="4" style="padding:10px 12px;text-align:right;font-weight:bold">Total</td>
            <td style="padding:10px 12px;text-align:right;font-weight:bold">${total.toFixed(2)} €</td>
          </tr>
        </tfoot>
      </table>
      <p>Le paiement sera à effectuer lors de la distribution. Vous serez recontacté(e) prochainement.</p>
      <p>Merci,<br><strong>L'équipe Saint Michel Uniformes</strong></p>
    </div>
    <div style="background:#f0f4f8;padding:14px 32px;font-size:12px;color:#888;text-align:center">
      Cet email est envoyé automatiquement, merci de ne pas y répondre.
    </div>
  </div>`;

  const text = `Bonjour ${precommande.parent_prenom},\n\nVotre précommande pour ${precommande.enfant_prenom} ${precommande.enfant_nom} a bien été enregistrée.\n\nRécapitulatif :\n${rowsTxt}\n\nTotal : ${total.toFixed(2)} €\n\nMerci,\nL'équipe Saint Michel Uniformes`;

  await transport.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || "Saint Michel Uniformes"}" <${process.env.SMTP_USER}>`,
    to: precommande.parent_email,
    subject: `Confirmation de précommande – ${precommande.enfant_prenom} ${precommande.enfant_nom}`,
    text,
    html,
  });
}
