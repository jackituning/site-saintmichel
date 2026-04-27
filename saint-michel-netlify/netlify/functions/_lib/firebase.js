// netlify/functions/_lib/firebase.js
// Partagé par toutes les fonctions Netlify

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import jwt from "jsonwebtoken";

// ── Init Firebase (singleton) ──────────────────────────────────────────────
function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:     process.env.FIREBASE_PROJECT_ID,
        clientEmail:   process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:    process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
  return getFirestore();
}

// ── JWT auth ───────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-prod";

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

export function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

export function requireAuth(event) {
  const token = event.headers["x-token"] || event.headers["authorization"]?.replace("Bearer ", "");
  if (!token) return null;
  return verifyToken(token);
}

// ── CORS headers ───────────────────────────────────────────────────────────
export const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Token, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};

export function ok(body, status = 200) {
  return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function err(msg, status = 400) {
  return { statusCode: status, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: msg }) };
}

export function options() {
  return { statusCode: 204, headers: CORS, body: "" };
}

export { getDb, FieldValue };
