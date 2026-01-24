// ============================================
// CONFIGURATION FIREBASE
// Pôle Espoir Volleyball - Sablé-sur-Sarthe
// ============================================

// ⚠️ IMPORTANT : Remplacez ces valeurs par vos propres clés Firebase
// Vous trouverez ces informations dans :
// Console Firebase > Project Settings > Your apps > Firebase SDK snippet > Config

const firebaseConfig = {
  apiKey: "AIzaSyDtfmdXgUFn3lTw1esJwRh1EIW4gcPedwE",
  authDomain: "interface-match-en-live.firebaseapp.com",
  databaseURL: "https://interface-match-en-live-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "interface-match-en-live",
  storageBucket: "interface-match-en-live.firebasestorage.app",
  messagingSenderId: "793477536814",
  appId: "1:793477536814:web:2d6922f1b07e06535d13bf"
};

// Initialisation de Firebase
firebase.initializeApp(firebaseConfig);

// Références aux services Firebase
const database = firebase.database();
const auth = typeof firebase.auth === 'function' ? firebase.auth() : null;

// Export pour utilisation dans d'autres fichiers
window.firebaseServices = {
  database,
  auth,
  serverTimestamp: firebase.database.ServerValue.TIMESTAMP
};

// Authentification anonyme automatique (pour Storage)
if (auth) {
  auth.signInAnonymously().catch(err => {
    if (err.code === 'auth/configuration-not-found') {
      console.warn("⚠️ Firebase Auth : L'authentification anonyme n'est pas activée dans votre console Firebase (Build > Authentication).");
    } else {
      console.error("Erreur auth anonyme:", err);
    }
  });
}

console.log('✅ Firebase initialisé avec succès');
