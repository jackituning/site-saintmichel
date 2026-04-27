// netlify/functions/login.js
import { getDb, signToken, ok, err, options, CORS } from "./_lib/firebase.js";
import crypto from "crypto";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return options();
  if (event.httpMethod !== "POST") return err("Method not allowed", 405);

  const { username, password } = JSON.parse(event.body || "{}");
  if (!username || !password) return err("Identifiants manquants", 400);

  const db = getDb();
  const snap = await db.collection("admins").where("username", "==", username).limit(1).get();
  if (snap.empty) return err("Identifiants incorrects", 401);

  const admin = snap.docs[0].data();
  const hash = crypto.createHash("sha256").update(password).digest("hex");
  if (admin.password_hash !== hash) return err("Identifiants incorrects", 401);

  const token = signToken({ username, nom: admin.nom || username });
  return ok({ token, username, nom: admin.nom || username });
}
