# Saint Michel Uniformes — Stack Netlify + Firebase + Brevo

## Architecture
- **Frontend** : HTML/JS statique hébergé sur Netlify (gratuit)
- **Backend** : Netlify Functions (Node.js serverless, gratuit)
- **Base de données** : Firebase Firestore (gratuit jusqu'à 50 000 lectures/jour)
- **Emails** : Brevo SMTP (gratuit jusqu'à 300 mails/jour)

---

## Déploiement — procédure complète

### Étape 1 — Créer le projet Firebase

1. Aller sur [console.firebase.google.com](https://console.firebase.google.com)
2. Cliquer **Ajouter un projet** → donner un nom (ex: `saint-michel-uniformes`)
3. Désactiver Google Analytics → **Créer le projet**
4. Dans le menu gauche → **Firestore Database** → **Créer une base de données**
   - Choisir **Mode production**
   - Région : `europe-west3` (Frankfurt)
5. Aller dans **Paramètres du projet** (engrenage) → onglet **Comptes de service**
6. Cliquer **Générer une nouvelle clé privée** → télécharger le fichier JSON
7. Noter les valeurs : `project_id`, `client_email`, `private_key`

### Étape 2 — Règles Firestore

Dans Firebase Console → Firestore → **Règles**, remplacer par :

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false; // Tout accès via les Functions uniquement
    }
  }
}
```

### Étape 3 — Créer le compte Brevo

1. Aller sur [brevo.com](https://www.brevo.com/fr/) → compte gratuit
2. Aller dans **Paramètres** → **SMTP & API** → onglet **SMTP**
3. Copier : serveur, port, login, et générer une clé SMTP

### Étape 4 — Déployer sur Netlify

1. Aller sur [netlify.com](https://netlify.com) → **Add new site** → **Import from Git**
2. Connecter votre dépôt GitHub contenant ce projet
3. Configuration build :
   - **Base directory** : (vide)
   - **Build command** : `npm install`
   - **Publish directory** : `public`
4. Aller dans **Site settings** → **Environment variables** → ajouter :

| Variable | Valeur |
|---|---|
| `FIREBASE_PROJECT_ID` | votre project_id |
| `FIREBASE_CLIENT_EMAIL` | votre client_email |
| `FIREBASE_PRIVATE_KEY` | votre private_key (avec les \n) |
| `JWT_SECRET` | chaîne aléatoire longue |
| `SMTP_HOST` | `smtp-relay.brevo.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | votre email Brevo |
| `SMTP_PASSWORD` | votre clé SMTP Brevo |
| `EMAIL_FROM_NAME` | `Saint Michel Uniformes` |

5. Cliquer **Deploy site**

### Étape 5 — Créer le premier admin

Une seule fois, en local :

```bash
# Copier le fichier d'environnement
cp .env.example .env
# Remplir .env avec vos vraies valeurs Firebase

npm install
node scripts/setup-admin.js
```

Cela crée l'utilisateur `admin` avec le mot de passe `SaintMichel2025!`.
**Changez ce mot de passe** en modifiant `scripts/setup-admin.js` avant de l'exécuter.

### Étape 6 — Connecter le domaine personnalisé

Dans Netlify → **Domain settings** → **Add custom domain** → suivre les instructions pour ajouter un enregistrement CNAME chez votre registrar.

---

## Structure du projet

```
saint-michel-netlify/
├── netlify.toml              ← config redirections /api/* → functions
├── package.json
├── public/
│   └── index.html            ← application complète (HTML + CSS + JS)
├── netlify/functions/
│   ├── _lib/
│   │   ├── firebase.js       ← connexion Firebase + auth JWT
│   │   └── mailer.js         ← envoi email Brevo
│   ├── login.js
│   ├── campagnes.js
│   ├── articles.js
│   ├── precommandes.js
│   ├── commande-fournisseur.js
│   ├── stock.js
│   ├── distributions.js
│   └── stats.js
└── scripts/
    └── setup-admin.js        ← création premier admin (une seule fois)
```
