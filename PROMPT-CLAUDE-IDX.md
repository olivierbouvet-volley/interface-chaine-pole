# 🏐 PROMPT PROJET - Pôle Espoir Sablé - Live Streaming Volleyball

## 📋 CONTEXTE DU PROJET

Je développe une application web de **live streaming pour le Pôle Espoir Volleyball de Sablé-sur-Sarthe**. L'objectif est de permettre aux parents de filmer les matchs de leurs filles le week-end et de diffuser en direct avec un score synchronisé en temps réel.

### Architecture du système

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   JOUEUSE       │     │   PARENT        │     │   SPECTATEUR    │
│                 │     │                 │     │                 │
│ Déclare son     │     │ 1. Filme match  │     │ Regarde le live │
│ match du WE     │     │ 2. Gère score   │     │ + score temps   │
│                 │     │                 │     │ réel            │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │       FIREBASE          │
                    │   Realtime Database     │
                    │                         │
                    │ - Matchs                │
                    │ - Scores                │
                    │ - Sponsors              │
                    │ - Joueuses              │
                    └─────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   CHARGÉ DE COMM        │
                    │                         │
                    │ Gère les sponsors       │
                    │ (images/vidéos)         │
                    └─────────────────────────┘
```

### Fichiers existants (à importer)

J'ai 4 fichiers HTML déjà créés :

1. **`lives-weekend.html`** - Page publique des lives
   - Liste tous les matchs du week-end
   - Filtrage par joueuse ou tous les matchs
   - Affichage score temps réel
   - Overlay sponsors pendant les pauses (2 min)
   - Bandeau sponsors fixe en bas

2. **`interface-parent.html`** - Interface pour le parent filmeur
   - Guide de cadrage caméra
   - Checklist avant de filmer
   - Saisie lien YouTube Live
   - Contrôle du score (points + sets)
   - Bouton "Fin du set" qui déclenche l'écran sponsors

3. **`admin-sponsors.html`** - Interface chargé de communication
   - Ajouter/modifier/supprimer des sponsors
   - Upload image fixe ou vidéo
   - Définir sponsor principal vs secondaires
   - Attribuer à tous les matchs ou joueuses spécifiques

4. **`formulaire-match.html`** - Formulaire déclaration match
   - La joueuse déclare son match du week-end
   - Sélection équipe, adversaire, date, heure
   - Photo de la joueuse

---

## 🎯 OBJECTIF DE CETTE SESSION

Intégrer Firebase pour connecter tous les fichiers et rendre l'application fonctionnelle.

---

## 📝 ÉTAPES À SUIVRE

### ÉTAPE 1 : Configuration Firebase

1. Créer la configuration Firebase dans un fichier `firebase-config.js`
2. Initialiser Firebase avec :
   - Realtime Database
   - Storage (pour les logos sponsors et photos)
   - Authentication (optionnel, pour admin)

**Structure de la base de données :**

```javascript
{
  "matches": {
    "match_001": {
      "id": "match_001",
      "playerName": "Emma Durand",
      "playerPhoto": "url_photo",
      "clubName": "SCO Volley",
      "clubLogo": "url_logo",
      "opponent": "Saint-Étienne VB",
      "opponentLogo": "url_logo",
      "date": "2025-01-18",
      "time": "14:30",
      "youtubeUrl": "",
      "status": "upcoming", // upcoming | live | finished
      "score": {
        "setsHome": 0,
        "setsAway": 0,
        "pointsHome": 0,
        "pointsAway": 0
      },
      "showSponsor": false, // true quand pause entre sets
      "createdAt": timestamp
    }
  },
  "sponsors": {
    "sponsor_001": {
      "id": "sponsor_001",
      "name": "Décathlon Sablé",
      "type": "image", // image | video
      "mediaUrl": "url_fichier",
      "isPrincipal": true,
      "attribution": "all", // all | specific
      "players": [], // si specific: ["emma", "lea"]
      "active": true,
      "createdAt": timestamp
    }
  },
  "players": {
    "player_001": {
      "id": "player_001",
      "firstName": "Emma",
      "lastName": "Durand",
      "photo": "url_photo",
      "club": "SCO Volley",
      "clubLogo": "url_logo"
    }
  }
}
```

---

### ÉTAPE 2 : Connecter `formulaire-match.html`

**Fonctionnalités à implémenter :**

- Au submit du formulaire, créer un nouveau match dans Firebase
- Uploader la photo de la joueuse dans Firebase Storage
- Générer un ID unique pour le match
- Rediriger vers une page de confirmation avec le lien de partage

**Code à ajouter :**
```javascript
// Soumettre le formulaire
async function submitMatch(formData) {
  const matchId = generateMatchId();
  const photoUrl = await uploadPhoto(formData.photo);
  
  await firebase.database().ref('matches/' + matchId).set({
    id: matchId,
    playerName: formData.playerName,
    playerPhoto: photoUrl,
    clubName: formData.club,
    opponent: formData.opponent,
    date: formData.date,
    time: formData.time,
    status: 'upcoming',
    score: { setsHome: 0, setsAway: 0, pointsHome: 0, pointsAway: 0 },
    showSponsor: false,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });
  
  return matchId;
}
```

---

### ÉTAPE 3 : Connecter `interface-parent.html`

**Fonctionnalités à implémenter :**

- Récupérer le matchId depuis l'URL (ex: `?match=match_001`)
- Charger les infos du match depuis Firebase
- Sauvegarder le lien YouTube quand saisi
- Mettre à jour le score en temps réel
- Quand "Fin du set" : 
  - Mettre à jour le score des sets
  - Passer `showSponsor: true` pour déclencher l'overlay sur la page Lives

**Code à ajouter :**
```javascript
// Écouter et mettre à jour le score
function updateScore(matchId, scoreData) {
  firebase.database().ref('matches/' + matchId + '/score').update(scoreData);
}

// Fin du set - déclencher sponsors
function endSet(matchId) {
  firebase.database().ref('matches/' + matchId).update({
    showSponsor: true,
    'score/pointsHome': 0,
    'score/pointsAway': 0
  });
  
  // Remettre showSponsor à false après 2 minutes
  setTimeout(() => {
    firebase.database().ref('matches/' + matchId + '/showSponsor').set(false);
  }, 120000);
}
```

---

### ÉTAPE 4 : Connecter `lives-weekend.html`

**Fonctionnalités à implémenter :**

- Charger tous les matchs depuis Firebase (temps réel)
- Filtrer par statut (live, upcoming, finished)
- Filtrer par joueuse
- Écouter les changements de score en temps réel
- Quand `showSponsor: true` pour un match regardé → afficher overlay sponsors 2 min
- Charger les sponsors depuis Firebase pour l'overlay

**Code à ajouter :**
```javascript
// Écouter tous les matchs
firebase.database().ref('matches').on('value', (snapshot) => {
  const matches = snapshot.val();
  renderMatches(matches);
});

// Écouter un match spécifique pour le score
firebase.database().ref('matches/' + matchId).on('value', (snapshot) => {
  const match = snapshot.val();
  updateScoreDisplay(match.score);
  
  if (match.showSponsor) {
    showSponsorOverlay(match);
  }
});

// Charger les sponsors pour l'overlay
async function loadSponsors(matchId, playerName) {
  const snapshot = await firebase.database().ref('sponsors').once('value');
  const sponsors = snapshot.val();
  
  // Filtrer: tous les matchs OU cette joueuse spécifique
  return Object.values(sponsors).filter(s => 
    s.active && (s.attribution === 'all' || s.players.includes(playerName))
  );
}
```

---

### ÉTAPE 5 : Connecter `admin-sponsors.html`

**Fonctionnalités à implémenter :**

- Charger la liste des sponsors depuis Firebase
- Ajouter un nouveau sponsor (upload fichier vers Storage)
- Modifier un sponsor existant
- Supprimer un sponsor
- Charger la liste des joueuses pour l'attribution

**Code à ajouter :**
```javascript
// Ajouter un sponsor
async function addSponsor(sponsorData, file) {
  const sponsorId = 'sponsor_' + Date.now();
  const mediaUrl = await uploadToStorage(file, 'sponsors/' + sponsorId);
  
  await firebase.database().ref('sponsors/' + sponsorId).set({
    id: sponsorId,
    name: sponsorData.name,
    type: sponsorData.type,
    mediaUrl: mediaUrl,
    isPrincipal: sponsorData.isPrincipal,
    attribution: sponsorData.attribution,
    players: sponsorData.players || [],
    active: true,
    createdAt: firebase.database.ServerValue.TIMESTAMP
  });
}

// Upload fichier
async function uploadToStorage(file, path) {
  const ref = firebase.storage().ref(path);
  await ref.put(file);
  return await ref.getDownloadURL();
}
```

---

### ÉTAPE 6 : Gestion des liens et navigation

**Créer le système de routing :**

- `/` → Page d'accueil (lives-weekend.html)
- `/match?id=xxx` → Vue plein écran d'un match
- `/declarer` → Formulaire déclaration (formulaire-match.html)
- `/gerer?match=xxx` → Interface parent (interface-parent.html)
- `/admin/sponsors` → Gestion sponsors (admin-sponsors.html)

**Générer les QR codes :**
```javascript
// Utiliser une lib comme qrcode.js
function generateQRCode(url, containerId) {
  new QRCode(document.getElementById(containerId), {
    text: url,
    width: 150,
    height: 150
  });
}
```

---

### ÉTAPE 7 : Déploiement Firebase Hosting

1. Configurer `firebase.json` :
```json
{
  "hosting": {
    "public": "public",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "**", "destination": "/index.html" }
    ]
  }
}
```

2. Déployer avec `firebase deploy`

---

## 🔧 SPÉCIFICATIONS TECHNIQUES

### Écran Sponsors

- **Durée** : 2 minutes (120 secondes)
- **Déclenchement** : Quand le parent clique "Fin du set"
- **Affichage** : 
  - Sponsor principal en grand (fond blanc, effet glow)
  - Sponsors secondaires en dessous
  - Countdown visible `1:45` format minutes:secondes
  - Bouton "Fermer" pour fermeture manuelle

### Score temps réel

- **Latence max** : < 1 seconde
- **Format** : Sets (0-3) + Points du set en cours
- **Affichage** : Score visible sur la vignette match + vue plein écran

### Caméra (info pour le guide parent)

- Position idéale : derrière le but de handball (~5m derrière le terrain de volley)
- Caméra centrée par rapport au terrain
- Plan fixe, pas de suivi du ballon
- En hauteur (trépied ou pied haut)

---

## ⚠️ POINTS D'ATTENTION

1. **Sécurité Firebase** : Configurer les règles de sécurité pour que seuls les parents autorisés puissent modifier le score de leur match

2. **Optimisation** : Les images sponsors doivent être compressées avant upload

3. **Responsive** : Toutes les interfaces doivent fonctionner sur mobile (les parents filment avec leur téléphone)

4. **Hors-ligne** : Prévoir un mode dégradé si la connexion est instable

---

## 📁 FICHIERS À CRÉER

1. `firebase-config.js` - Configuration Firebase
2. `db-service.js` - Fonctions d'accès à la base de données
3. `storage-service.js` - Fonctions d'upload de fichiers
4. `index.html` - Point d'entrée avec routing

---

## 🚀 COMMENÇONS !

Commence par l'**ÉTAPE 1** : Crée le fichier `firebase-config.js` avec la structure de la base de données, puis on connectera les fichiers un par un.

Je te fournis les 4 fichiers HTML existants dans ce projet.
