// ============================================
// SERVICE FDME — Feuille de Match Électronique
// Parse les FDME (PDF/photo) via Gemini Vision
// et sauvegarde les données dans Firebase.
//
// API publique :
//   fdmeService.parseFdme(file, matchId) → Promise<fdmeData>
//   fdmeService.getFdmeData(matchId) → Promise<fdmeData|null>
//   fdmeService.saveFdmeData(matchId, fdmeData) → Promise<void>
// ============================================

const fdmeService = {

    // =============================================
    // CONFIGURATION
    // =============================================

    // Clé API Gemini — à renseigner avant utilisation
    // (stockée ici pour le prototype — en prod, utiliser un proxy Firebase)
    _geminiApiKey: '',

    // Modèle Gemini à utiliser
    _geminiModel: 'gemini-2.5-flash',

    /**
     * Configure la clé API Gemini
     * @param {string} apiKey - Clé API Google AI Studio
     */
    setApiKey(apiKey) {
        this._geminiApiKey = apiKey;
        console.log('🔑 Clé API Gemini configurée');
    },

    // =============================================
    // PARSING PRINCIPAL
    // =============================================

    /**
     * Parse une FDME (PDF ou image) et sauvegarde dans Firebase
     * @param {File} file - Fichier PDF ou image
     * @param {string} matchId - ID du match Firebase
     * @returns {Promise<Object|null>} fdmeData parsé ou null si échec
     */
    async parseFdme(file, matchId) {
        try {
            console.log('📋 Parsing FDME pour', matchId, '— fichier:', file.name);

            let fdmeData = null;

            if (file.type === 'application/pdf') {
                // Stratégie PDF : extraire le texte avec pdf.js puis envoyer à Gemini
                const textContent = await this.extractTextFromPdf(file);
                if (textContent && textContent.length > 100) {
                    console.log('📄 Texte PDF extrait (' + textContent.length + ' caractères) — envoi à Gemini');
                    fdmeData = await this.callGeminiWithText(textContent);
                } else {
                    // PDF sans texte exploitable → fallback image
                    console.log('⚠️ PDF sans texte exploitable — fallback Gemini Vision');
                    const base64 = await this.fileToBase64(file);
                    fdmeData = await this.callGeminiVision(base64, file.type);
                }
            } else {
                // Image → Gemini Vision directement
                console.log('🖼️ Image détectée — envoi à Gemini Vision');
                const base64 = await this.fileToBase64(file);
                fdmeData = await this.callGeminiVision(base64, file.type);
            }

            if (!fdmeData) {
                console.error('❌ Gemini n\'a pas retourné de données exploitables');
                return null;
            }

            // Validation et nettoyage
            fdmeData = this.validateAndCleanFdmeData(fdmeData, matchId);

            console.log('✅ FDME parsée —', fdmeData.team1.joueurs.length, '+', fdmeData.team2.joueurs.length, 'joueurs détectés');
            return fdmeData;

        } catch (err) {
            console.error('❌ Erreur parsing FDME:', err);
            return null;
        }
    },

    // =============================================
    // EXTRACTION TEXTE PDF (pdf.js)
    // =============================================

    /**
     * Extrait le texte brut d'un PDF via pdf.js (CDN)
     * @param {File} file - Fichier PDF
     * @returns {Promise<string>} Texte extrait
     */
    async extractTextFromPdf(file) {
        // Charger pdf.js depuis CDN si pas déjà chargé
        if (typeof pdfjsLib === 'undefined') {
            await this._loadPdfJs();
        }

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }

        return fullText.trim();
    },

    /**
     * Charge la librairie pdf.js depuis CDN
     * @private
     */
    _loadPdfJs() {
        return new Promise((resolve, reject) => {
            if (typeof pdfjsLib !== 'undefined') {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            script.onload = () => {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                console.log('📚 pdf.js chargé');
                resolve();
            };
            script.onerror = () => reject(new Error('Impossible de charger pdf.js'));
            document.head.appendChild(script);
        });
    },

    // =============================================
    // APPELS GEMINI
    // =============================================

    /**
     * Appelle Gemini avec du texte brut (PDF eScore textuel)
     * @param {string} textContent - Texte extrait du PDF
     * @returns {Promise<Object|null>} fdmeData parsé
     */
    async callGeminiWithText(textContent) {
        const prompt = this._buildFdmePrompt() +
            '\n\nVoici le texte extrait de la feuille de match :\n\n' + textContent;

        return await this._callGeminiApi([
            { text: prompt }
        ]);
    },

    /**
     * Appelle Gemini Vision avec une image (photo de FDME ou PDF image)
     * @param {string} base64Data - Image en base64 (sans le préfixe data:...)
     * @param {string} mimeType - Type MIME (image/jpeg, image/png, application/pdf)
     * @returns {Promise<Object|null>} fdmeData parsé
     */
    async callGeminiVision(base64Data, mimeType) {
        const prompt = this._buildFdmePrompt();

        return await this._callGeminiApi([
            { text: prompt },
            {
                inlineData: {
                    mimeType: mimeType,
                    data: base64Data
                }
            }
        ]);
    },

    /**
     * Appel générique à l'API Gemini
     * @private
     * @param {Array} parts - Parties du message (text + inlineData)
     * @returns {Promise<Object|null>} JSON parsé
     */
    async _callGeminiApi(parts) {
        if (!this._geminiApiKey) {
            throw new Error('Clé API Gemini non configurée. Appeler fdmeService.setApiKey("...")');
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this._geminiModel}:generateContent?key=${this._geminiApiKey}`;

        const body = {
            contents: [{
                parts: parts
            }],
            generationConfig: {
                temperature: 0.1,
                topP: 0.8,
                maxOutputTokens: 65536
            }
        };

        console.log('🤖 Appel Gemini API...');
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error('Erreur Gemini API (' + response.status + '): ' + errText);
        }

        const result = await response.json();

        // Extraire le texte de la réponse
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            console.error('❌ Réponse Gemini vide ou invalide:', result);
            return null;
        }

        // Parser le JSON retourné
        try {
            // Nettoyer le texte (Gemini peut enrober le JSON dans des backticks)
            let jsonStr = text.trim();
            if (jsonStr.startsWith('```json')) {
                jsonStr = jsonStr.slice(7);
            }
            if (jsonStr.startsWith('```')) {
                jsonStr = jsonStr.slice(3);
            }
            if (jsonStr.endsWith('```')) {
                jsonStr = jsonStr.slice(0, -3);
            }
            jsonStr = jsonStr.trim();

            return JSON.parse(jsonStr);
        } catch (parseErr) {
            console.error('❌ JSON invalide retourné par Gemini:', text);
            return null;
        }
    },

    // =============================================
    // PROMPT GEMINI
    // =============================================

    /**
     * Construit le prompt structuré pour Gemini
     * @private
     * @returns {string} Prompt complet
     */
    _buildFdmePrompt() {
        return `Tu es un expert en lecture de feuilles de match de volleyball (FDME eScore FFVB / DataProject).
Analyse cette feuille de match et retourne UNIQUEMENT un objet JSON valide (pas de markdown, pas de commentaire).

Schéma JSON attendu :
{
  "teamA": {
    "nom": "string — nom complet équipe A (celle à gauche sur la FDME)",
    "joueurs": [
      { "numero": int, "nom": "NOM Prénom", "licence": "string 5-8 chiffres", "libero": false, "poste": "" }
    ],
    "liberos": [
      { "numero": int, "nom": "NOM Prénom", "licence": "string" }
    ]
  },
  "teamB": {
    "nom": "string — nom complet équipe B (celle à droite sur la FDME)",
    "joueurs": [ idem ],
    "liberos": [ idem ]
  },
  "rotationsDepart": {
    "set1": {
      "teamA": [int, int, int, int, int, int],
      "teamB": [int, int, int, int, int, int],
      "teamA_serves": true ou false,
      "grilleServiceA": [[int|null, int|null, int|null, int|null, int|null, int|null], ...],
      "grilleServiceB": [[int|null, int|null, int|null, int|null, int|null, int|null], ...]
    },
    "set2": { ... },
    "set3": { ... }
  },
  "resultats": {
    "sets": [ { "teamA": int, "teamB": int } ],
    "vainqueur": "string — nom de l'équipe gagnante",
    "score": "X/Y — sets gagnés"
  }
}

Règles IMPORTANTES :
- Les positions I→VI dans la rotation correspondent aux zones 1→6 du terrain de volleyball
- Position I = serveur. L'ordre est I, II, III, IV, V, VI
- Sur la FDME eScore, l'équipe marquée "S" sert au début du set, celle marquée "R" reçoit
- teamA_serves = true si l'équipe A (gauche) est marquée "S", false si marquée "R"
- Les rotations contiennent EXACTEMENT 6 numéros de maillot, dans l'ordre des positions I à VI
- Les liberos sont listés dans une section séparée "LIBEROS" — ils ne sont PAS dans les rotations de départ
- Marque libero=true dans joueurs[] pour les joueurs identifiés comme libero
- Pour les licences, extrait exactement le numéro (5 à 8 chiffres)
- Retourne UNIQUEMENT le JSON valide, rien d'autre

GRILLE DE SERVICE (grilleServiceA / grilleServiceB) — RÈGLE CRITIQUE :
La FDME eScore contient une grille de service pour chaque set.
Elle indique à quel score de l'équipe A (gauche) chaque joueur a PERDU le service.

Structure de la grille :
- 6 COLONNES (I à VI) = les 6 positions de la rotation de départ (même ordre que teamA/teamB)
- PLUSIEURS LIGNES = plusieurs cycles (1 cycle = les 6 positions ont toutes servi une fois)
- VALEUR DE CHAQUE CELLULE = score de l'ÉQUIPE PROPRIÉTAIRE DE LA GRILLE quand ce joueur a perdu le service :
  → grilleServiceA : valeur = score de teamA (gauche) quand le joueur A perd le service
  → grilleServiceB : valeur = score de teamB (droite) quand le joueur B perd le service
- "X" ou cellule vide = ce joueur n'a pas servi dans ce cycle (normal pour position I de l'équipe réceptionneuse en cycle 1)

Format JSON : tableau de tableaux (une ligne par cycle), null pour les cellules X/vides.
"grilleServiceA" concerne TOUJOURS l'équipe de gauche (teamA), "grilleServiceB" l'équipe de droite (teamB).
Que l'équipe soit "S" (serveur) ou "R" (réceptionneur), retranscris ses lignes dans sa grille respective.

EXEMPLE concret (Set 2 — Institut sert à droite, Mulhouse reçoit à gauche) :
  Institut (droite = teamB → grilleServiceB) — chaque valeur = score INSTITUT :
    Cycle 1 : col I=0 (#19 perd service quand Institut a 0 pt), col II=3, col III=4, col IV=5, col V=6, col VI=7
    Cycle 2 : 8, 9, 10, 12, 13, 14
    Cycle 3 : 15, 20
    → "grilleServiceB": [[0,3,4,5,6,7],[8,9,10,12,13,14],[15,20]]
  Mulhouse (gauche = teamA → grilleServiceA) — chaque valeur = score MULHOUSE :
    Cycle 1 : col I=X (réceptionneur, pos I ne sert pas en cycle 1), col II=1 (#11 perd quand Mulhouse a 1 pt), col III=3, col IV=6, col V=8, col VI=9
    Cycle 2 : 10, 11, 14, 16, 17, 20
    Cycle 3 : 23, 24, 25
    → "grilleServiceA": [[null,1,3,6,8,9],[10,11,14,16,17,20],[23,24,25]]

RÈGLES :
- Utilise null pour les cellules "X" ou vides (joueur n'a pas servi ce cycle)
- L'équipe réceptionneuse : la position I ne sert pas en cycle 1 → null dans la 1ère ligne col I
- Retranscris EXACTEMENT les valeurs visibles — ne déduis pas les scores manquants
- Si une valeur est entourée d'un cercle (score final du set), retranscris-la normalement comme entier
- Si la grille entière est illisible pour un set, retourne un tableau vide []

SETS ET TIE-BREAK — RÈGLE CRITIQUE :
La FDME eScore a TOUJOURS 5 colonnes physiques (Set 1, Set 2, Set 3, Set 4, Set 5).
Le TIE-BREAK est TOUJOURS imprimé dans la colonne "Set 5" en bas de la feuille, peu importe le format de compétition.

Règles de numérotation dans le JSON de sortie :
- Compte uniquement les sets réellement joués (score non nul des deux côtés)
- Numérote-les en séquence : le 1er joué = set1, le 2ème = set2, le 3ème = set3
- EXEMPLE best-of-3 avec tie-break (Coupe de France, Championnat) :
    → La FDME montre des scores dans les colonnes "Set 1", "Set 2" et "Set 5"
    → "Set 5" physique = 3ème set joué → à stocker comme "set3" dans le JSON
    → Le JSON doit avoir : set1, set2, set3 (PAS set5)
- EXEMPLE best-of-3 sans tie-break (victoire 2/0) :
    → La FDME montre des scores dans les colonnes "Set 1" et "Set 2" seulement
    → Le JSON doit avoir : set1, set2 seulement
- EXEMPLE best-of-5 avec tie-break :
    → Sets joués dans colonnes "Set 1" à "Set 5"
    → Stocker comme set1, set2, set3, set4, set5

Le tie-break (qu'il soit dans la colonne Set 3 ou Set 5) se joue en premier à 15 points
mais les rotations ont le même format : exactement 6 numéros de maillot.`;
    },

    // =============================================
    // VALIDATION & NETTOYAGE
    // =============================================

    /**
     * Valide et nettoie les données fdmeData retournées par Gemini
     * @param {Object} rawData - Données brutes retournées par Gemini
     * @param {string} matchId - ID du match
     * @returns {Object} fdmeData nettoyé et enrichi
     */
    validateAndCleanFdmeData(rawData, matchId) {
        const issues = [];

        // Structure de base
        const fdmeData = {
            team1: {
                nom: rawData.teamA?.nom || '',
                joueurs: [],
                coach: ''
            },
            team2: {
                nom: rawData.teamB?.nom || '',
                joueurs: [],
                coach: ''
            },
            rotationsDepart: {},
            resultats: {
                sets: [],
                vainqueur: rawData.resultats?.vainqueur || '',
                score: rawData.resultats?.score || ''
            },
            ocrConfidence: 0,
            extractedAt: new Date().toISOString(),
            parseMethod: 'gemini-vision',
            matchId: matchId
        };

        // Nettoyer les joueurs teamA
        if (rawData.teamA?.joueurs && Array.isArray(rawData.teamA.joueurs)) {
            fdmeData.team1.joueurs = rawData.teamA.joueurs.map(j => ({
                numero: parseInt(j.numero) || 0,
                nom: String(j.nom || '').trim(),
                licence: String(j.licence || '').trim(),
                libero: !!j.libero,
                poste: j.libero ? 'L' : String(j.poste || '').trim()
            })).filter(j => j.numero > 0 && j.nom);
        }

        // Nettoyer les joueurs teamB
        if (rawData.teamB?.joueurs && Array.isArray(rawData.teamB.joueurs)) {
            fdmeData.team2.joueurs = rawData.teamB.joueurs.map(j => ({
                numero: parseInt(j.numero) || 0,
                nom: String(j.nom || '').trim(),
                licence: String(j.licence || '').trim(),
                libero: !!j.libero,
                poste: j.libero ? 'L' : String(j.poste || '').trim()
            })).filter(j => j.numero > 0 && j.nom);
        }

        // Marquer les liberos dans joueurs[] (double vérification avec la section liberos)
        const marquerLiberos = (joueurs, liberos) => {
            if (!liberos || !Array.isArray(liberos)) return;
            const libNums = new Set(liberos.map(l => parseInt(l.numero)));
            joueurs.forEach(j => {
                if (libNums.has(j.numero)) {
                    j.libero = true;
                    j.poste = 'L';
                }
            });
        };
        marquerLiberos(fdmeData.team1.joueurs, rawData.teamA?.liberos);
        marquerLiberos(fdmeData.team2.joueurs, rawData.teamB?.liberos);

        // Nettoyer les rotations de départ
        const team1Nums = new Set(fdmeData.team1.joueurs.map(j => j.numero));
        const team2Nums = new Set(fdmeData.team2.joueurs.map(j => j.numero));

        for (const [setKey, rot] of Object.entries(rawData.rotationsDepart || {})) {
            const cleanKey = setKey.startsWith('set') ? setKey : 'set' + setKey;
            const team1Rot = (rot.teamA || rot.team1 || []).map(n => parseInt(n)).filter(n => n > 0);
            const team2Rot = (rot.teamB || rot.team2 || []).map(n => parseInt(n)).filter(n => n > 0);

            if (team1Rot.length === 6 && team2Rot.length === 6) {
                // Convertit une grille 2D [[s1,s2,...],[...]] en tableau plat de {scoreA}
                // Accepte aussi l'ancien format [{rotNum,scoreA}] pour rétrocompatibilité
                const grilleToScores = (raw) => {
                    if (!Array.isArray(raw) || raw.length === 0) return [];
                    // Ancien format : [{rotNum, scoreA, scoreB}]
                    if (raw[0] !== null && typeof raw[0] === 'object' && !Array.isArray(raw[0]) && 'scoreA' in raw[0]) {
                        return raw.map(e => ({ scoreA: parseInt(e.scoreA) }))
                                  .filter(e => !isNaN(e.scoreA));
                    }
                    // Nouveau format 2D : [[null,1,3,...],[10,11,...],...]
                    if (Array.isArray(raw[0]) || raw[0] === null || typeof raw[0] === 'number') {
                        const rows = Array.isArray(raw[0]) ? raw : [raw]; // supporte tableau 1D aussi
                        const scores = [];
                        for (const row of rows) {
                            if (!Array.isArray(row)) continue;
                            for (const val of row) {
                                if (val !== null && val !== undefined) {
                                    const n = parseInt(val);
                                    if (!isNaN(n)) scores.push({ scoreA: n });
                                }
                            }
                        }
                        return scores;
                    }
                    return [];
                };
                const sr1 = grilleToScores(rot.grilleServiceA || rot.scoresRotationA || rot.scoresRotation1);
                const sr2 = grilleToScores(rot.grilleServiceB || rot.scoresRotationB || rot.scoresRotation2);
                console.log(`📐 ${cleanKey} ancres — team1: ${sr1.length} points [${sr1.map(s=>s.scoreA).join(',')}] | team2: ${sr2.length} points [${sr2.map(s=>s.scoreA).join(',')}]`);
                fdmeData.rotationsDepart[cleanKey] = {
                    team1: team1Rot,
                    team2: team2Rot,
                    team1Serves: rot.teamA_serves !== undefined ? !!rot.teamA_serves : !!rot.team1Serves,
                    scoresRotation1: sr1,
                    scoresRotation2: sr2
                };
            } else {
                issues.push('⚠️ ' + cleanKey + ' : rotation incomplète (team1=' + team1Rot.length + ', team2=' + team2Rot.length + ')');
            }

            // Vérifier que les numéros existent dans le roster
            team1Rot.forEach(n => {
                if (!team1Nums.has(n)) {
                    issues.push('⚠️ ' + cleanKey + ' team1: #' + n + ' absent du roster');
                }
            });
            team2Rot.forEach(n => {
                if (!team2Nums.has(n)) {
                    issues.push('⚠️ ' + cleanKey + ' team2: #' + n + ' absent du roster');
                }
            });
        }

        // Nettoyer les résultats
        if (rawData.resultats?.sets && Array.isArray(rawData.resultats.sets)) {
            fdmeData.resultats.sets = rawData.resultats.sets.map(s => ({
                team1: parseInt(s.teamA ?? s.team1) || 0,
                team2: parseInt(s.teamB ?? s.team2) || 0
            })).filter(s => s.team1 > 0 || s.team2 > 0);
        }

        // Calcul du score de confiance
        let confidence = 1.0;
        if (fdmeData.team1.joueurs.length === 0) { confidence -= 0.3; issues.push('❌ Roster team1 vide'); }
        if (fdmeData.team2.joueurs.length === 0) { confidence -= 0.3; issues.push('❌ Roster team2 vide'); }
        if (Object.keys(fdmeData.rotationsDepart).length === 0) { confidence -= 0.2; issues.push('⚠️ Aucune rotation de départ'); }
        if (fdmeData.resultats.sets.length === 0) { confidence -= 0.1; issues.push('⚠️ Aucun résultat de set'); }
        confidence -= issues.filter(i => i.startsWith('⚠️')).length * 0.05;
        fdmeData.ocrConfidence = Math.max(0, Math.round(confidence * 100) / 100);

        // Log des issues
        if (issues.length > 0) {
            console.warn('📋 Validation FDME — ' + issues.length + ' remarque(s) :');
            issues.forEach(i => console.warn('  ' + i));
        }
        fdmeData._validationIssues = issues;

        return fdmeData;
    },

    // =============================================
    // FIREBASE — LECTURE / ÉCRITURE
    // =============================================

    /**
     * Sauvegarde les données FDME dans Firebase
     * @param {string} matchId - ID du match
     * @param {Object} fdmeData - Données validées
     */
    async saveFdmeData(matchId, fdmeData) {
        // Retirer les champs internes avant sauvegarde
        const dataToSave = { ...fdmeData };
        delete dataToSave._validationIssues;

        await firebase.database().ref('matches/' + matchId + '/fdmeData').set(dataToSave);
        console.log('✅ fdmeData sauvegardé pour', matchId);
    },

    /**
     * Récupère les données FDME depuis Firebase
     * @param {string} matchId - ID du match
     * @returns {Promise<Object|null>} fdmeData ou null
     */
    async getFdmeData(matchId) {
        const snapshot = await firebase.database().ref('matches/' + matchId + '/fdmeData').once('value');
        return snapshot.val();
    },

    /**
     * Supprime les données FDME d'un match
     * @param {string} matchId - ID du match
     */
    async removeFdmeData(matchId) {
        await firebase.database().ref('matches/' + matchId + '/fdmeData').remove();
        console.log('🗑️ fdmeData supprimé pour', matchId);
    },

    // =============================================
    // UTILITAIRES
    // =============================================

    /**
     * Convertit un fichier en base64 (sans le préfixe data:...)
     * @param {File} file - Fichier à convertir
     * @returns {Promise<string>} Base64 pur
     */
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                // Retirer le préfixe "data:image/jpeg;base64,"
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = () => reject(new Error('Erreur lecture fichier'));
            reader.readAsDataURL(file);
        });
    }
};

// Export global
window.fdmeService = fdmeService;
