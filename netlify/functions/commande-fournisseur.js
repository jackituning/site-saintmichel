// netlify/functions/commande-fournisseur.js
import { getDb, requireAuth, ok, err, options } from "./_lib/firebase.js";

async function getCampagneActive(db) {
  const snap = await db.collection("campagnes").where("statut", "==", "ouverte").get();
  if (snap.empty) return null;
  const camps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  camps.sort((a, b) => (b.annee || 0) - (a.annee || 0));
  return camps[0];
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();
  const user = requireAuth(event);
  if (!user) return err("Non autorisé", 401);

  const isExport = event.path.includes("/export");

  try {
    const db = getDb();
    const campagne = await getCampagneActive(db);
    if (!campagne) {
      if (isExport) {
        const csv = "\uFEFF" + ["Aucune campagne ouverte"].join("\n");
        return { statusCode: 200, headers: { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": "attachment;filename=commande_fournisseur.csv" }, body: csv };
      }
      return ok([]);
    }

    const qsSurp = parseInt(event.queryStringParameters?.surplus);
    const surplus_pct = Number.isFinite(qsSurp) && qsSurp >= 0 ? qsSurp : (campagne.surplus_pct || 10);
    const pSnap = await db.collection("precommandes").where("campagne_id", "==", campagne.id).get();

    // Cache articles
    const articleCache = {};
    const getArticle = async (aid) => {
      if (!aid) return null;
      if (articleCache[aid] !== undefined) return articleCache[aid];
      try {
        const doc = await db.collection("articles").doc(aid).get();
        articleCache[aid] = doc.exists ? doc.data() : null;
      } catch { articleCache[aid] = null; }
      return articleCache[aid];
    };

    const agg = {};
    for (const pd of pSnap.docs) {
      const lSnap = await db.collection("lignes_precommande").where("precommande_id", "==", pd.id).get();
      for (const ld of lSnap.docs) {
        const l = ld.data();
        if (!l.article_id || !l.taille) continue;
        const key = `${l.article_id}__${l.taille}`;
        if (!agg[key]) {
          const art = await getArticle(l.article_id);
          agg[key] = {
            article_id: l.article_id,
            nom: art ? art.nom : l.article_id,
            prix: art ? (+art.prix || 0) : 0,
            taille: l.taille,
            qte_precommandee: 0,
          };
        }
        agg[key].qte_precommandee += (+l.quantite || 0);
      }
    }
    const rows = Object.values(agg).sort((a, b) => String(a.nom || "").localeCompare(String(b.nom || "")));

    if (isExport) {
      const csvRows = [["Article", "Taille", "Précommandé", "Surplus", "À commander", "Prix unitaire", "Montant total estimé"]];
      for (const r of rows) {
        const surp = Math.ceil(r.qte_precommandee * surplus_pct / 100);
        const total_cmd = r.qte_precommandee + surp;
        csvRows.push([r.nom, r.taille, r.qte_precommandee, surp, total_cmd, r.prix, (total_cmd * r.prix).toFixed(2)]);
      }
      const csv = "\uFEFF" + csvRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
      return { statusCode: 200, headers: { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": "attachment;filename=commande_fournisseur.csv" }, body: csv };
    }

    return ok(rows.map(r => ({ ...r, surplus_pct })));
  } catch (e) {
    console.error("commande-fournisseur error:", e);
    if (isExport) {
      return { statusCode: 200, headers: { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": "attachment;filename=commande_fournisseur.csv" }, body: "\uFEFF" + "Erreur lors de la génération du CSV" };
    }
    return ok([]);
  }
}