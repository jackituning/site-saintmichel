// netlify/functions/articles.js
import { getDb, requireAuth, ok, err, options } from "./_lib/firebase.js";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();
  const user = requireAuth(event);
  if (!user) return err("Non autorisé", 401);

  const db = getDb();
  const path = event.path.replace(/.*\/articles/, "");
  const id = path.replace("/", "").split("?")[0];

  // GET /articles
  if (event.httpMethod === "GET" && !id) {
    const snap = await db.collection("articles").get();
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => {
      const ao = +a.ordre, bo = +b.ordre;
      const aok = Number.isFinite(ao), bok = Number.isFinite(bo);
      if (aok && bok && ao !== bo) return ao - bo;
      if (aok !== bok) return aok ? -1 : 1;
      return String(a.nom || "").localeCompare(String(b.nom || ""));
    });
    return ok(items);
  }

  // POST /articles
  if (event.httpMethod === "POST") {
    const d = JSON.parse(event.body || "{}");
    const tailles = (d.tailles_str || "").split(",").map(t => t.trim()).filter(Boolean);
    const ref = await db.collection("articles").add({
      nom: d.nom, description: d.description || "",
      tailles, prix: parseFloat(d.prix), actif: true, ordre: 0,
      image: d.image || "",
    });
    return ok({ id: ref.id });
  }

  // GET /articles/:id
  if (event.httpMethod === "GET" && id) {
    const doc = await db.collection("articles").doc(id).get();
    return doc.exists ? ok({ id: doc.id, ...doc.data() }) : err("Introuvable", 404);
  }

  // PUT /articles/:id
  if (event.httpMethod === "PUT" && id) {
    const d = JSON.parse(event.body || "{}");
    const tailles = (d.tailles_str || "").split(",").map(t => t.trim()).filter(Boolean);
    const update = {
      nom: d.nom, description: d.description || "",
      tailles, prix: parseFloat(d.prix), actif: d.actif !== false,
    };
    if (typeof d.image === "string") update.image = d.image;
    await db.collection("articles").doc(id).update(update);
    return ok({ ok: true });
  }

  // DELETE /articles/:id
  if (event.httpMethod === "DELETE" && id) {
    await db.collection("articles").doc(id).delete();
    return ok({ ok: true });
  }

  return err("Route inconnue", 404);
}