// netlify/functions/commande-fournisseur.js
import { getDb, requireAuth, ok, err, options } from "./_lib/firebase.js";

async function getCampagneActive(db) {
  const snap = await db.collection("campagnes").where("statut", "==", "ouverte").orderBy("annee", "desc").limit(1).get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();
  const user = requireAuth(event);
  if (!user) return err("Non autorisé", 401);

  const db = getDb();
  const isExport = event.path.includes("/export");
  const campagne = await getCampagneActive(db);
  if (!campagne) return isExport ? err("Aucune campagne active") : ok([]);

  const qsSurp = parseInt(event.queryStringParameters?.surplus);
  const surplus_pct = Number.isFinite(qsSurp) && qsSurp >= 0 ? qsSurp : (campagne.surplus_pct || 10);
  const pSnap = await db.collection("precommandes").where("campagne_id", "==", campagne.id).get();

  // Aggregate by article+taille
  const agg = {};
  for (const pd of pSnap.docs) {
    const lSnap = await db.collection("lignes_precommande").where("precommande_id", "==", pd.id).get();
    for (const ld of lSnap.docs) {
      const l = ld.data();
      const key = `${l.article_id}__${l.taille}`;
      if (!agg[key]) {
        const aDoc = await db.collection("articles").doc(l.article_id).get();
        agg[key] = { article_id: l.article_id, nom: aDoc.exists ? aDoc.data().nom : l.article_id, prix: aDoc.exists ? aDoc.data().prix : 0, taille: l.taille, qte_precommandee: 0 };
      }
      agg[key].qte_precommandee += l.quantite;
    }
  }
  const rows = Object.values(agg).sort((a, b) => a.nom.localeCompare(b.nom));

  if (isExport) {
    const csvRows = [["Article","Taille","Précommandé","Surplus","À commander","Prix unitaire","Montant total estimé"]];
    for (const r of rows) {
      const surp = Math.ceil(r.qte_precommandee * surplus_pct / 100);
      const total_cmd = r.qte_precommandee + surp;
      csvRows.push([r.nom, r.taille, r.qte_precommandee, surp, total_cmd, r.prix, (total_cmd * r.prix).toFixed(2)]);
    }
    const csv = "\uFEFF" + csvRows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    return { statusCode: 200, headers: { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": "attachment;filename=commande_fournisseur.csv" }, body: csv };
  }

  return ok(rows.map(r => ({ ...r, surplus_pct })));
}
