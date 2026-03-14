// ============================================
// MOTEUR DE TRACKING ROTATION — VOLLEYBALL
// Calcule la rotation de chaque équipe pour chaque rally
// à partir des rotations de départ (fdmeData) et de la
// séquence des rallies Firebase.
//
// Règles FIVB implémentées :
//   - Rotation [P1,P2,P3,P4,P5,P6] : P1 = serveur (zone 1)
//   - Sideout (receveur marque) → l'équipe qui gagne le service tourne d'1
//   - Breakpoint (serveur marque) → aucune rotation
//   - Nouveau set → repart de rotationsDepart.set{N}
//
// API publique :
//   rotationEngine.computeAllRotations(fdmeData, rallies) → enrichedRallies[]
//   rotationEngine.getRotationAtRally(fdmeData, rallies, targetIndex) → {team1, team2}
//   rotationEngine.getServerAtRally(fdmeData, rallies, targetIndex) → {team, numero}
//   rotationEngine.getPlayerZone(rotation, playerNumber) → int (1-6) ou null
//   rotationEngine.computeAndSaveRotations(matchId) → Promise<void>
// ============================================

const rotationEngine = {

    // =============================================
    // FONCTIONS DE BASE
    // =============================================

    /**
     * Fait tourner une rotation d'une position.
     * [P1, P2, P3, P4, P5, P6] → [P2, P3, P4, P5, P6, P1]
     * P2 devient le nouveau serveur (P1).
     *
     * @param {number[]} rotation - Tableau de 6 numéros de joueurs
     * @returns {number[]} Nouvelle rotation après sideout
     */
    rotate(rotation) {
        if (!rotation || rotation.length !== 6) {
            console.warn('⚠️ rotate() : rotation invalide :', rotation);
            return rotation;
        }
        const first = rotation[0];
        return [...rotation.slice(1), first];
    },

    /**
     * Retourne la zone terrain (1-6) d'un joueur dans une rotation.
     * Index 0 → Zone 1 (serveur, arrière droit)
     * Index 1 → Zone 2 (avant droit)
     * Index 2 → Zone 3 (avant centre)
     * Index 3 → Zone 4 (avant gauche)
     * Index 4 → Zone 5 (arrière gauche)
     * Index 5 → Zone 6 (arrière centre)
     *
     * @param {number[]} rotation - Tableau de 6 numéros
     * @param {number} playerNumber - Numéro du joueur
     * @returns {number|null} Zone 1-6 ou null si joueur absent
     */
    getPlayerZone(rotation, playerNumber) {
        if (!rotation) return null;
        const idx = rotation.indexOf(playerNumber);
        if (idx === -1) return null;
        return idx + 1; // Zone 1 = index 0, Zone 6 = index 5
    },

    // =============================================
    // CALCUL PAR SET
    // =============================================

    /**
     * Calcule et enrichit les rotations pour tous les rallies d'un set.
     * Modifie les rallies en place (ajoute rotationTeam1, rotationTeam2, etc.)
     *
     * @param {number} setNumber - Numéro du set (1-5)
     * @param {Object} fdmeData - Données FDME Firebase (avec rotationsDepart)
     * @param {Array} ralliesForSet - Rallies du set, triés par index croissant
     */
    computeRotationsForSet(setNumber, fdmeData, ralliesForSet) {
        const setKey = 'set' + setNumber;
        const startRot = fdmeData.rotationsDepart?.[setKey];

        if (!startRot) { console.warn('⚠️ Pas de rotation de départ pour', setKey); return; }
        if (!startRot.team1 || startRot.team1.length !== 6 ||
            !startRot.team2 || startRot.team2.length !== 6) {
            console.warn('⚠️ Rotation incomplète pour', setKey, startRot); return;
        }

        // ── Ancres FDME ─────────────────────────────────────────────────────
        // Chaque valeur = score PROPRE de l'équipe au moment où elle ENTRE dans cette rotation
        // (= moment du sideout : l'équipe gagne le service et tourne).
        // On exclut scoreA=0 (colonne I = rotation initiale, pas un sideout).
        // Triées dans l'ordre croissant (le score ne peut qu'augmenter).
        const a1 = (startRot.scoresRotation1 || [])
            .map(a => typeof a === 'object' ? Number(a.scoreA) : Number(a))
            .filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);
        const a2 = (startRot.scoresRotation2 || [])
            .map(a => typeof a === 'object' ? Number(a.scoreA) : Number(a))
            .filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);

        if (a1.length) console.log(`  🎯 Set${setNumber} ancres team1=[${a1}]`);
        if (a2.length) console.log(`  🎯 Set${setNumber} ancres team2=[${a2}]`);

        /**
         * Calcule l'index de rotation (0-based = nombre de sideouts depuis le départ).
         * Les ancres représentent le score propre de l'équipe QUAND elle entre dans chaque rotation.
         * Sideout = l'équipe gagne le service et tourne → son score augmente de 1 à ce moment.
         *
         * Règle :
         *  - En SERVICE  : le sideout qui a amené cette rotation est DÉJÀ fait (score = ancre).
         *    → compter les ancres ≤ ownScore (inclus, car à score S servant = le sideout à S est fait)
         *  - En RÉCEPTION : le sideout au score S n'est peut-être pas encore effectué.
         *    → compter les ancres < ownScore (strict, approche conservative)
         * Retourne null si pas d'ancres.
         */
        const rotIdxFromAnchors = (anchors, ownScore, isServing) => {
            if (!anchors.length || ownScore === null) return null;
            if (isServing) {
                return anchors.filter(s => s <= ownScore).length;
            } else {
                return anchors.filter(s => s < ownScore).length;
            }
        };

        // Reconstruit le tableau de rotation depuis la position initiale en N rotations
        const makeRot = (initial, n) => {
            let r = [...initial];
            for (let i = 0, steps = n % 6; i < steps; i++) r = this.rotate(r);
            return r;
        };

        // ── Serving team : Firebase rally.servingTeam est fiable ─────────────
        let servingTeam = startRot.team1Serves ? 'team1' : 'team2';
        const firstRally = ralliesForSet[0];
        if (firstRally?.servingTeam && firstRally.servingTeam !== servingTeam) {
            console.log(`🔧 Set${setNumber}: FDME="${servingTeam}" → Firebase="${firstRally.servingTeam}"`);
            servingTeam = firstRally.servingTeam;
        }

        // État cumulatif (fallback quand score ou ancres sont absents)
        let rotTeam1 = [...startRot.team1];
        let rotTeam2 = [...startRot.team2];
        let rotNum1 = 1, rotNum2 = 1;
        let prevServingTeam = null;   // ← pour détecter les transitions sideout

        console.log(`🔍 Set${setNumber} DÉPART rot1=[${rotTeam1}] rot2=[${rotTeam2}] serving=${servingTeam}`);

        for (const rally of ralliesForSet) {
            // Serving team : Firebase rally.servingTeam prime sur le cumulatif
            const curServing = rally.servingTeam || servingTeam;

            // ── Rotation cumulative (sans ancres) ─────────────────────────────
            // Sideout détecté par TRANSITION de servingTeam (pas par pointTeam qui peut être faux)
            // Quand l'équipe qui prend le service change → cette équipe a fait un sideout → elle tourne
            // Convention DataVolley DVW : le rotNum DÉCRÉMENTE après chaque sideout (R2→R1→R6→R5...)
            if (prevServingTeam !== null && prevServingTeam !== curServing) {
                if (curServing === 'team1' && !a1.length) {
                    rotTeam1 = this.rotate(rotTeam1);
                    rotNum1 = rotNum1 === 1 ? 6 : rotNum1 - 1;
                }
                if (curServing === 'team2' && !a2.length) {
                    rotTeam2 = this.rotate(rotTeam2);
                    rotNum2 = rotNum2 === 1 ? 6 : rotNum2 - 1;
                }
            }
            servingTeam = curServing;
            prevServingTeam = curServing;

            const t1Serves = servingTeam === 'team1';
            const s1 = rally.scoreAvant?.pointsTeam1 ?? null;
            const s2 = rally.scoreAvant?.pointsTeam2 ?? null;

            // ── Calcul direct depuis ancres FDME (si score + ancres disponibles) ──
            // idx = nombre de sideouts depuis la rotation de départ
            // makeRot applique rotate() idx fois → rotation physique correcte
            // rotNum : décrémente selon convention DVW (R2→R1→R6→...).
            //   ⚠️ Sans rotNumDepart (non encore stocké en FDME), on utilise un numéro
            //   relatif basé sur l'index. Pour un rotNum absolu correct, ajouter rotNumDepart
            //   dans fdmeData (via import DVW).
            if (s1 !== null && s2 !== null) {
                const idx1 = rotIdxFromAnchors(a1, s1, t1Serves);
                if (idx1 !== null) {
                    rotTeam1 = makeRot(startRot.team1, idx1);
                    // rotNum décrémentant à partir du départ (relatif, pas absolu sans rotNumDepart)
                    const startNum1 = startRot.rotNumDepart1 || 1;
                    rotNum1 = ((startNum1 - 1 - idx1 % 6 + 12) % 6) + 1;
                }

                const idx2 = rotIdxFromAnchors(a2, s2, !t1Serves);
                if (idx2 !== null) {
                    rotTeam2 = makeRot(startRot.team2, idx2);
                    const startNum2 = startRot.rotNumDepart2 || 1;
                    rotNum2 = ((startNum2 - 1 - idx2 % 6 + 12) % 6) + 1;
                }
            }

            // ── Enregistrer ───────────────────────────────────────────────────
            rally.rotationTeam1 = [...rotTeam1];
            rally.rotationTeam2 = [...rotTeam2];
            rally.rotationNum1  = rotNum1;
            rally.rotationNum2  = rotNum2;
            rally.servingPlayerNumber_computed = t1Serves ? rotTeam1[0] : rotTeam2[0];
            rally.servingTeam_computed = servingTeam;
            rally.servingZone = 1;

            const rn = t1Serves ? rotNum1 : rotNum2;
            const anchor = (s1 !== null && (t1Serves ? a1.length : a2.length) > 0) ? '🎯' : '';
            console.log(`  #${rally.index} ${s1??'?'}-${s2??'?'} ${servingTeam} R${rn}${anchor} #${rally.servingPlayerNumber_computed}`);
        }   // fin for

        console.log(`✅ Set${setNumber}: ${ralliesForSet.length} rallies calculés`);
    },

    // =============================================
    // CALCUL COMPLET SUR TOUS LES RALLIES
    // =============================================

    /**
     * Calcule les rotations pour tous les rallies de tous les sets.
     * Retourne les rallies enrichis (modifiés en place aussi).
     *
     * @param {Object} fdmeData - fdmeData Firebase
     * @param {Array} rallies - Tous les rallies du match (toutes sets mélangés)
     * @returns {Array} Rallies enrichis avec rotationTeam1, rotationTeam2, etc.
     */
    computeAllRotations(fdmeData, rallies) {
        if (!fdmeData || !rallies || rallies.length === 0) return rallies;

        // Grouper par set
        const rallysBySet = {};
        for (const r of rallies) {
            const s = r.set || 1;
            if (!rallysBySet[s]) rallysBySet[s] = [];
            rallysBySet[s].push(r);
        }

        // Trier chaque set par index et calculer
        for (const [setNum, setRallies] of Object.entries(rallysBySet)) {
            setRallies.sort((a, b) => (a.index || 0) - (b.index || 0));
            this.computeRotationsForSet(parseInt(setNum), fdmeData, setRallies);
        }

        return rallies;
    },

    /**
     * Retourne la rotation au moment d'un rally spécifique (par index).
     *
     * @param {Object} fdmeData
     * @param {Array} rallies - Tous les rallies (pas encore enrichis)
     * @param {number} targetIndex - Index du rally cible
     * @returns {{team1: number[], team2: number[]}|null}
     */
    getRotationAtRally(fdmeData, rallies, targetIndex) {
        const enriched = this.computeAllRotations(fdmeData, [...rallies].map(r => ({ ...r })));
        const rally = enriched.find(r => r.index === targetIndex);
        if (!rally) return null;
        return {
            team1: rally.rotationTeam1,
            team2: rally.rotationTeam2
        };
    },

    /**
     * Retourne le serveur au moment d'un rally spécifique.
     *
     * @param {Object} fdmeData
     * @param {Array} rallies
     * @param {number} targetIndex
     * @returns {{team: string, numero: number}|null}
     */
    getServerAtRally(fdmeData, rallies, targetIndex) {
        const enriched = this.computeAllRotations(fdmeData, [...rallies].map(r => ({ ...r })));
        const rally = enriched.find(r => r.index === targetIndex);
        if (!rally) return null;
        return {
            team: rally.servingTeam_computed,
            numero: rally.servingPlayerNumber_computed
        };
    },

    // =============================================
    // INTÉGRATION FIREBASE
    // =============================================

    /**
     * Charge fdmeData + rallies depuis Firebase, calcule les rotations
     * pour chaque rally et sauvegarde le résultat dans Firebase.
     *
     * Écrit dans :
     *   matches/{matchId}/rallies/{rallyId}/rotationTeam1  → [n1..n6]
     *   matches/{matchId}/rallies/{rallyId}/rotationTeam2  → [n1..n6]
     *   matches/{matchId}/rallies/{rallyId}/servingPlayerNumber_computed → int
     *   matches/{matchId}/rallies/{rallyId}/servingTeam_computed → 'team1'|'team2'
     *   matches/{matchId}/rallies/{rallyId}/servingZone → 1
     *
     * @param {string} matchId - ID du match Firebase
     * @returns {Promise<{nbRallies: number, nbSets: number}>}
     */
    async computeAndSaveRotations(matchId) {
        console.log('🔄 Calcul des rotations pour', matchId);

        // 1. Charger fdmeData
        const fdmeSnap = await firebase.database()
            .ref('matches/' + matchId + '/fdmeData')
            .once('value');
        const fdmeData = fdmeSnap.val();

        if (!fdmeData) {
            throw new Error('Pas de fdmeData pour ce match. Analysez d\'abord la FDME.');
        }

        if (!fdmeData.rotationsDepart || Object.keys(fdmeData.rotationsDepart).length === 0) {
            throw new Error('fdmeData ne contient pas de rotations de départ.');
        }

        // 1.5 Vérifier fdmeSwapped — si true, inverser team1/team2 dans rotationsDepart
        const swappedSnap = await firebase.database()
            .ref('matches/' + matchId + '/fdmeSwapped')
            .once('value');
        const fdmeSwapped = swappedSnap.val() === true;

        if (fdmeSwapped) {
            console.log('🔀 fdmeSwapped=true : inversion team1/team2 dans rotationsDepart');
            for (const setKey of Object.keys(fdmeData.rotationsDepart)) {
                const rot = fdmeData.rotationsDepart[setKey];
                const tmpTeam = rot.team1;
                rot.team1 = rot.team2;
                rot.team2 = tmpTeam;
                rot.team1Serves = !rot.team1Serves;
            }
        }

        // 2. Charger tous les rallies
        const ralliesSnap = await firebase.database()
            .ref('matches/' + matchId + '/rallies')
            .once('value');

        const rallies = [];
        ralliesSnap.forEach(snap => {
            rallies.push({ key: snap.key, ...snap.val() });
        });

        if (rallies.length === 0) {
            throw new Error('Aucun rally trouvé pour ce match.');
        }

        console.log('📊 ' + rallies.length + ' rallies chargés,', Object.keys(fdmeData.rotationsDepart).length, 'sets en fdmeData');

        // 3. Calculer les rotations
        this.computeAllRotations(fdmeData, rallies);

        // 4. Compter les sets traités
        const setsTraites = new Set(rallies.filter(r => r.rotationTeam1).map(r => r.set || 1));

        // 5. Écrire dans Firebase (batch update)
        const updates = {};
        let nbEnriched = 0;

        for (const r of rallies) {
            if (!r.rotationTeam1 || !r.rotationTeam2) continue;

            const path = 'matches/' + matchId + '/rallies/' + r.key;
            updates[path + '/rotationTeam1'] = r.rotationTeam1;
            updates[path + '/rotationTeam2'] = r.rotationTeam2;
            updates[path + '/rotationNum1']   = r.rotationNum1 || 1;
            updates[path + '/rotationNum2']   = r.rotationNum2 || 1;
            updates[path + '/servingPlayerNumber_computed'] = r.servingPlayerNumber_computed || null;
            updates[path + '/servingTeam_computed'] = r.servingTeam_computed || null;
            updates[path + '/servingZone'] = 1;
            nbEnriched++;
        }

        await firebase.database().ref().update(updates);

        console.log('✅ Rotations sauvegardées :', nbEnriched, 'rallies enrichis sur', rallies.length);
        return { nbRallies: nbEnriched, nbSets: setsTraites.size };
    },

    // =============================================
    // UTILITAIRES
    // =============================================

    /**
     * Retourne le nom d'un joueur depuis fdmeData par son numéro et son équipe.
     *
     * @param {Object} fdmeData
     * @param {number} numero - Numéro de maillot
     * @param {string} team - 'team1' ou 'team2'
     * @returns {string} Nom du joueur ou '#N' si inconnu
     */
    getPlayerName(fdmeData, numero, team) {
        const joueurs = fdmeData?.[team]?.joueurs || [];
        const joueur = joueurs.find(j => j.numero === numero);
        return joueur ? joueur.nom : '#' + numero;
    },

    /**
     * Retourne la liste des joueurs liberos d'une équipe.
     *
     * @param {Object} fdmeData
     * @param {string} team - 'team1' ou 'team2'
     * @returns {number[]} Numéros des liberos
     */
    getLiberoNumbers(fdmeData, team) {
        return (fdmeData?.[team]?.joueurs || [])
            .filter(j => j.libero)
            .map(j => j.numero);
    },

    /**
     * Vérifie si un joueur est libero.
     *
     * @param {Object} fdmeData
     * @param {number} numero
     * @param {string} team - 'team1' ou 'team2'
     * @returns {boolean}
     */
    isLibero(fdmeData, numero, team) {
        return this.getLiberoNumbers(fdmeData, team).includes(numero);
    }
};

// Export global
window.rotationEngine = rotationEngine;
