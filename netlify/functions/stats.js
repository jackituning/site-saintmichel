// netlify/functions/stats.js
import { getDb, requireAuth, ok, err, options } from "./_lib/firebase.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();
  const user = requireAuth(event);
  if (!user) return err("Non autorisé", 401);

  const db = getDb();
  const campSnap = await db.collection("campagnes").where("statut", "==", "ouverte").orderBy("annee", "desc").limit(1).get();
  if (campSnap.empty) return ok({ nb_precommandes: 0, nb_familles: 0, nb_items: 0, ca_total: 0, nb_distributions: 0, ca_encaisse: 0, recent: [], stock_low: [], by_niveau: {}, by_article: {} });

  const cid = campSnap.docs[0].id;
  const pSnap = await db.collection("precommandes").where("campagne_id", "==", cid).get();

  let nb_items = 0, ca_total = 0, by_niveau = {}, by_article = {};
  const recent = [];
  const emails = new Set();

  for (const pd of pSnap.docs) {
    const p = { id: pd.id, ...pd.data() };
    emails.add(p.parent_email);
    by_niveau[p.niveau] = (by_niveau[p.niveau] || 0) + 1;
    const lSnap = await db.collection("lignes_precommande").where("precommande_id", "==", pd.id).get();
    let ptotal = 0;
    for (const ld of lSnap.docs) {
      const l = ld.data();
      ptotal += l.quantite * l.prix_unitaire;
      nb_items += l.quantite;
      ca_total += l.quantite * l.prix_unitaire;
      const aDoc = await db.collection("articles").doc(l.article_id).get();
      const nom = aDoc.exists ? aDoc.data().nom : l.article_id;
      by_article[nom] = (by_article[nom] || 0) + l.quantite;
    }
    if (recent.length < 6) recent.push({ ...p, total: ptotal, nb_lignes: lSnap.size });
  }

  const dSnap = await db.collection("distributions").get();
  let ca_encaisse = 0;
  let nb_distributions = 0;
  for (const dd of dSnap.docs) {
    const dist = dd.data();
    const pDoc = await db.collection("precommandes").doc(dist.precommande_id).get();
    if (pDoc.exists && pDoc.data().campagne_id === cid) {
      ca_encaisse += dist.montant_total || 0;
      nb_distributions++;
    }
  }

  const stockSnap = await db.collection("stock").where("quantite", "<", 5).get();
  const stock_low = await Promise.all(stockSnap.docs.map(async d => {
    const s = { id: d.id, ...d.data() };
    const aDoc = await db.collection("articles").doc(s.article_id).get();
    s.nom = aDoc.exists ? aDoc.data().nom : s.article_id;
    return s;
  }));

  return ok({
    nb_precommandes: pSnap.size,
    nb_familles: emails.size,
    nb_items,
    ca_total: Math.round(ca_total * 100) / 100,
    nb_distributions,
    ca_encaisse: Math.round(ca_encaisse * 100) / 100,
    recent: recent.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    stock_low,
    by_niveau: Object.entries(by_niveau).sort((a, b) => b[1] - a[1]).map(([niveau, cnt]) => ({ niveau, cnt })),
    by_article: Object.entries(by_article).sort((a, b) => b[1] - a[1]).map(([nom, qte]) => ({ nom, qte })),
  });
}
