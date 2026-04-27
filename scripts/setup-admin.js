// scripts/setup-admin.js
// Exécuter une seule fois pour créer le premier admin :
// node scripts/setup-admin.js
//
// Prérequis : définir les variables d'environnement Firebase dans .env

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import crypto from "crypto";
import * as dotenv from "dotenv";
dotenv.config();

initializeApp({
  credential: cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});

const db = getFirestore();
const username = "admin";
const password = "SaintMichel2025!";  // ← changez ce mot de passe !

const hash = crypto.createHash("sha256").update(password).digest("hex");
await db.collection("admins").add({ username, password_hash: hash, nom: "Administrateur" });
console.log(`✅ Admin créé : ${username} / ${password}`);
console.log("⚠️  Changez le mot de passe après la première connexion !");
process.exit(0);
