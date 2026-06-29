// netlify/functions/stats.js
import { getDb, requireAuth, ok, err, options } from "./_lib/firebase.js";

const EMPTY = { nb_precommandes: 0, nb_familles: 0, nb_items: 0, ca_total: 0, nb_distributions: 0, ca_encaisse: 0, recent: [], stock_low: [], by_niveau: [], by_article: [] };

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();
  const user = requireAuth(event);
  if (!user) return err("Non autorisé", 401);

  try {
    const db = getDb();
    const campSnap = await db.collection("campagnes").where("statut", "==", "ouverte").get();
    if (campSnap.empty) return ok(EMPTY);

    // Si plusieurs campagnes ouvertes, prendre la plus récente par annee (en mémoire, safe)
    const camps = campSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    camps.sort((a, b) => (b.annee || 0) - (a.annee || 0));
    const cid = camps[0].id;

    const pSnap = await db.collection("precommandes").where("campagne_id", "==", cid).get();

    // Cache des articles pour éviter N+1
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

    let nb_items = 0, ca_total = 0;
    const by_niveau = {}, by_article = {};
    const recent = [];
    const emails = new Set();

    for (const pd of pSnap.docs) {
      const p = { id: pd.id, ...pd.data() };
      if (p.parent_email) emails.add(p.parent_email);
      if (p.niveau) by_niveau[p.niveau] = (by_niveau[p.niveau] || 0) + 1;
      const lSnap = await db.collection("lignes_precommande").where("precommande_id", "==", pd.id).get();
      let ptotal = 0;
      for (const ld of lSnap.docs) {
        const l = ld.data();
        const q = +l.quantite || 0;
        const pu = +l.prix_unitaire || 0;
        ptotal += q * pu;
        nb_items += q;
        ca_total += q * pu;
        const art = await getArticle(l.article_id);
        const nom = art ? art.nom : (l.article_id || "—");
        by_article[nom] = (by_article[nom] || 0) + q;
      }
      recent.push({ ...p, total: ptotal, nb_lignes: lSnap.size });
    }

    // Sort sûr : created_at peut être absent
    recent.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));

    // Distributions de la campagne active
    let ca_encaisse = 0, nb_distributions = 0;
    try {
      const dSnap = await db.collection("distributions").get();
      for (const dd of dSnap.docs) {
        const dist = dd.data();
        if (!dist.precommande_id) continue;
        try {
          const pDoc = await db.collection("precommandes").doc(dist.precommande_id).get();
          if (pDoc.exists && pDoc.data().campagne_id === cid) {
            ca_encaisse += +dist.montant_total || 0;
            nb_distributions++;
          }
        } catch {}
      }
    } catch {}

    // Stock bas
    let stock_low = [];
    try {
      const stockSnap = await db.collection("stock").where("quantite", "<", 5).get();
      stock_low = await Promise.all(stockSnap.docs.map(async d => {
        const s = { id: d.id, ...d.data() };
        const art = await getArticle(s.article_id);
        s.nom = art ? art.nom : (s.article_id || "—");
        return s;
      }));
    } catch {}

    return ok({
      nb_precommandes: pSnap.size,
      nb_familles: emails.size,
      nb_items,
      ca_total: Math.round(ca_total * 100) / 100,
      nb_distributions,
      ca_encaisse: Math.round(ca_encaisse * 100) / 100,
      recent: recent.slice(0, 6),
      stock_low,
      by_niveau: Object.entries(by_niveau).sort((a, b) => b[1] - a[1]).map(([niveau, cnt]) => ({ niveau, cnt })),
      by_article: Object.entries(by_article).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([nom, qte]) => ({ nom, qte })),
    });
  } catch (e) {
    console.error("stats error:", e);
    return ok(EMPTY);
  }
}