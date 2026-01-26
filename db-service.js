// ============================================
// SERVICE BASE DE DONNÉES
// Fonctions d'accès à Firebase Realtime Database
// ============================================
//
// 🔒 TRANSACTIONS FIREBASE (v2.0)
// ================================
// Les opérations critiques utilisent des transactions Firebase
// pour garantir l'atomicité et éviter les race conditions.
//
// Fonctions avec transaction() :
// - addPoint()        → Incrémente score de façon atomique
// - removePoint()     → Décrémente score de façon atomique
// - incrementScore()  → Alias pour compatibilité
// - decrementScore()  → Alias pour compatibilité
// - validateSet()     → Valide un set de façon atomique
// - undoLastPoint()   → Annule un point de façon atomique
// - undoLastSet()     → Annule un set de façon atomique
//
// Avantages des transactions :
// 1. Atomicité : lecture + modification + écriture en une seule opération
// 2. Pas de race condition : si 2 clients modifient en même temps,
//    Firebase rejette une des transactions et la réessaye automatiquement
// 3. Cohérence garantie : impossible d'avoir un score incohérent
//
// ============================================

const dbService = {

    // ==========================================
    // MATCHS
    // ==========================================

    /**
     * Génère un ID unique pour un match
     * @returns {string} ID du match (format: match_timestamp)
     */
    generateMatchId() {
        return 'match_' + Date.now();
    },

    /**
     * Crée un nouveau match dans la base de données
     * @param {Object} matchData - Données du match
     * @returns {Promise<string>} ID du match créé
     */
    async createMatch(matchData) {
        const matchId = this.generateMatchId();

        const match = {
            id: matchId,
            matchType: matchData.matchType || 'championnat',
            category: matchData.category || '',
            team1: {
                name: matchData.team1?.name || '',
                color: matchData.team1?.color || '#1E3A8A',
                declaringPlayer: matchData.team1?.declaringPlayer || '',
                playerPhoto: matchData.team1?.playerPhoto || ''
            },
            team2: {
                name: matchData.team2?.name || '',
                color: matchData.team2?.color || '#DC2626'
            },
            matchPoster: matchData.matchPoster || '',
            date: matchData.date,
            time: matchData.time,
            youtubeUrl: matchData.youtubeUrl || '',
            status: 'upcoming', // upcoming | live | finished
            score: {
                setsTeam1: 0,
                setsTeam2: 0,
                pointsTeam1: 0,
                pointsTeam2: 0,
                sets: [] // Historique des sets
            },
            showSponsor: false,
            createdAt: firebase.database.ServerValue.TIMESTAMP
        };

        await firebase.database().ref('matches/' + matchId).set(match);
        console.log('✅ Match créé:', matchId);
        return matchId;
    },

    /**
     * Récupère un match par son ID
     * @param {string} matchId - ID du match
     * @returns {Promise<Object>} Données du match
     */
    async getMatch(matchId) {
        const snapshot = await firebase.database().ref('matches/' + matchId).once('value');
        return snapshot.val();
    },

    /**
     * Récupère tous les matchs
     * @returns {Promise<Object>} Tous les matchs
     */
    async getAllMatches() {
        const snapshot = await firebase.database().ref('matches').once('value');
        return snapshot.val() || {};
    },

    /**
     * Écoute les changements sur un match spécifique
     * @param {string} matchId - ID du match
     * @param {Function} callback - Fonction appelée à chaque changement
     */
    listenToMatch(matchId, callback) {
        firebase.database().ref('matches/' + matchId).on('value', (snapshot) => {
            callback(snapshot.val());
        });
    },

    /**
     * Écoute les changements sur tous les matchs
     * @param {Function} callback - Fonction appelée à chaque changement
     */
    listenToAllMatches(callback) {
        firebase.database().ref('matches').on('value', (snapshot) => {
            callback(snapshot.val() || {});
        });
    },

    /**
     * Met à jour le lien YouTube d'un match
     * @param {string} matchId - ID du match
     * @param {string} youtubeUrl - URL YouTube
     */
    /**
     * Met à jour le lien YouTube d'un match et l'ajoute aux segments
     * @param {string} matchId - ID du match
     * @param {string} youtubeUrl - URL YouTube
     */
    async updateYoutubeUrl(matchId, youtubeUrl) {
        if (!youtubeUrl) return;

        const timestamp = firebase.database.ServerValue.TIMESTAMP;
        const segmentId = 'segment_' + Date.now();

        // 1. Mettre à jour l'URL actuelle
        const updates = {
            youtubeUrl: youtubeUrl
        };

        // 2. Ajouter à la liste des segments pour le replay
        await firebase.database().ref('matches/' + matchId + '/videoSegments/' + segmentId).set({
            url: youtubeUrl,
            timestamp: timestamp
        });

        await firebase.database().ref('matches/' + matchId).update(updates);
        console.log('✅ Lien YouTube mis à jour et segment archivé');
    },

    /**
     * Met à jour le statut d'un match
     * @param {string} matchId - ID du match
     * @param {string} status - Nouveau statut (upcoming | live | finished)
     */
    async updateMatchStatus(matchId, status) {
        const updates = { status };

        // Si le match commence, on enregistre le moment exact pour la synchro replay
        if (status === 'live') {
            updates.startTimestamp = firebase.database.ServerValue.TIMESTAMP;
        }

        await firebase.database().ref('matches/' + matchId).update(updates);
        console.log('✅ Statut du match mis à jour:', status);
    },

    /**
     * Enregistre un événement de score avec horodatage
     * @param {string} matchId - ID du match
     * @param {Object} score - État du score après le point
     */
    async addScoreEvent(matchId, score) {
        const eventId = 'event_' + Date.now();
        const event = {
            timestamp: firebase.database.ServerValue.TIMESTAMP,
            score: { ...score }
        };

        await firebase.database().ref('matches/' + matchId + '/history/' + eventId).set(event);
    },

    /**
     * Met à jour le score d'un match et enregistre l'événement
     * @param {string} matchId - ID du match
     * @param {Object} scoreData - Nouvelles données de score
     */
    async updateScore(matchId, scoreData) {
        await firebase.database().ref('matches/' + matchId + '/score').update(scoreData);

        // On récupère le score complet pour l'historique
        const match = await this.getMatch(matchId);
        if (match && match.score) {
            await this.addScoreEvent(matchId, match.score);
        }
    },

    /**
     * Déclenche l'affichage des sponsors (fin de set)
     * @param {string} matchId - ID du match
     * @param {number} duration - Durée en millisecondes (défaut: 120000 = 2 min)
     */
    async triggerSponsorOverlay(matchId, duration = 120000) {
        // Active l'overlay sponsors
        const scoreUpdate = {
            pointsHome: 0,
            pointsAway: 0
        };

        await firebase.database().ref('matches/' + matchId).update({
            showSponsor: true,
            'score/pointsHome': 0,
            'score/pointsAway': 0
        });

        // Enregistre aussi le reset des points dans l'historique
        const match = await this.getMatch(matchId);
        if (match && match.score) {
            await this.addScoreEvent(matchId, match.score);
        }

        console.log('✅ Overlay sponsors activé pour 2 minutes');

        // Désactive automatiquement après la durée spécifiée
        setTimeout(async () => {
            await firebase.database().ref('matches/' + matchId + '/showSponsor').set(false);
            console.log('✅ Overlay sponsors désactivé');
        }, duration);
    },

    /**
     * Incrémente le score d'une équipe (ATOMIQUE avec transaction)
     * @param {string} matchId - ID du match
     * @param {string} team - 'home' ou 'away'
     * @returns {Promise<Object>} Résultat avec nouveau score
     */
    async incrementScore(matchId, team) {
        const field = team === 'home' ? 'pointsHome' : 'pointsAway';
        const ref = firebase.database().ref('matches/' + matchId + '/score/' + field);
        
        try {
            const result = await ref.transaction((currentValue) => {
                return (currentValue || 0) + 1;
            });
            
            console.log(`✅ [TRANSACTION] Score incrémenté: ${field} = ${result.snapshot.val()}`);
            return { success: true, newValue: result.snapshot.val() };
        } catch (error) {
            console.error('❌ [TRANSACTION] Erreur increment:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Décrémente le score d'une équipe (ATOMIQUE avec transaction)
     * @param {string} matchId - ID du match
     * @param {string} team - 'home' ou 'away'
     * @returns {Promise<Object>} Résultat avec nouveau score
     */
    async decrementScore(matchId, team) {
        const field = team === 'home' ? 'pointsHome' : 'pointsAway';
        const ref = firebase.database().ref('matches/' + matchId + '/score/' + field);
        
        try {
            const result = await ref.transaction((currentValue) => {
                return Math.max(0, (currentValue || 0) - 1);
            });
            
            console.log(`✅ [TRANSACTION] Score décrémenté: ${field} = ${result.snapshot.val()}`);
            return { success: true, newValue: result.snapshot.val() };
        } catch (error) {
            console.error('❌ [TRANSACTION] Erreur decrement:', error);
            return { success: false, error: error.message };
        }
    },

    // ==========================================
    // SPONSORS
    // ==========================================

    /**
     * Génère un ID unique pour un sponsor
     * @returns {string} ID du sponsor
     */
    generateSponsorId() {
        return 'sponsor_' + Date.now();
    },

    /**
     * Crée un nouveau sponsor
     * @param {Object} sponsorData - Données du sponsor
     * @returns {Promise<string>} ID du sponsor créé
     */
    async createSponsor(sponsorData) {
        const sponsorId = this.generateSponsorId();

        const sponsor = {
            id: sponsorId,
            name: sponsorData.name,
            type: sponsorData.type, // 'image' | 'video'
            mediaUrl: sponsorData.mediaUrl,
            isPrincipal: sponsorData.isPrincipal || false,
            attribution: sponsorData.attribution || 'all', // 'all' | 'specific'
            players: sponsorData.players || [],
            active: true,
            createdAt: firebase.database.ServerValue.TIMESTAMP
        };

        await firebase.database().ref('sponsors/' + sponsorId).set(sponsor);
        console.log('✅ Sponsor créé:', sponsorId);
        return sponsorId;
    },

    /**
     * Récupère tous les sponsors
     * @returns {Promise<Object>} Tous les sponsors
     */
    async getAllSponsors() {
        const snapshot = await firebase.database().ref('sponsors').once('value');
        return snapshot.val() || {};
    },

    /**
     * Récupère les sponsors actifs pour un match/joueuse
     * @param {string} playerName - Nom de la joueuse (optionnel)
     * @returns {Promise<Array>} Liste des sponsors filtrés
     */
    async getActiveSponsors(playerName = null) {
        const snapshot = await firebase.database().ref('sponsors').once('value');
        const sponsors = snapshot.val() || {};

        return Object.values(sponsors).filter(sponsor => {
            if (!sponsor.active) return false;
            if (sponsor.attribution === 'all') return true;
            if (playerName && sponsor.players.includes(playerName)) return true;
            return false;
        });
    },

    /**
     * Met à jour un sponsor
     * @param {string} sponsorId - ID du sponsor
     * @param {Object} updates - Données à mettre à jour
     */
    async updateSponsor(sponsorId, updates) {
        await firebase.database().ref('sponsors/' + sponsorId).update(updates);
        console.log('✅ Sponsor mis à jour:', sponsorId);
    },

    /**
     * Supprime un sponsor
     * @param {string} sponsorId - ID du sponsor
     */
    async deleteSponsor(sponsorId) {
        await firebase.database().ref('sponsors/' + sponsorId).remove();
        console.log('✅ Sponsor supprimé:', sponsorId);
    },

    /**
     * Active/désactive un sponsor
     * @param {string} sponsorId - ID du sponsor
     * @param {boolean} active - Actif ou non
     */
    async toggleSponsorActive(sponsorId, active) {
        await firebase.database().ref('sponsors/' + sponsorId + '/active').set(active);
        console.log(`✅ Sponsor ${active ? 'activé' : 'désactivé'}:`, sponsorId);
    },

    // ==========================================
    // JOUEUSES
    // ==========================================

    /**
     * Génère un ID unique pour une joueuse
     * @returns {string} ID de la joueuse
     */
    generatePlayerId() {
        return 'player_' + Date.now();
    },

    /**
     * Crée une nouvelle joueuse
     * @param {Object} playerData - Données de la joueuse
     * @returns {Promise<string>} ID de la joueuse créée
     */
    async createPlayer(playerData) {
        const playerId = this.generatePlayerId();

        const player = {
            id: playerId,
            firstName: playerData.firstName,
            lastName: playerData.lastName,
            photo: playerData.photo || '',
            club: playerData.club,
            clubLogo: playerData.clubLogo || '',
            createdAt: firebase.database.ServerValue.TIMESTAMP
        };

        await firebase.database().ref('players/' + playerId).set(player);
        console.log('✅ Joueuse créée:', playerId);
        return playerId;
    },

    /**
     * Récupère toutes les joueuses
     * @returns {Promise<Object>} Toutes les joueuses
     */
    async getAllPlayers() {
        const snapshot = await firebase.database().ref('players').once('value');
        return snapshot.val() || {};
    },

    // ==========================================
    // SYSTÈME DE SCORING PROFESSIONNEL
    // ==========================================

    /**
     * Ajoute un point à une équipe avec validation des règles (ATOMIQUE avec transaction)
     * @param {string} matchId - ID du match
     * @param {string} team - 'team1' ou 'team2'
     * @returns {Promise<Object>} Résultat de l'action avec validation
     */
    async addPoint(matchId, team) {
        const pointField = team === 'team1' ? 'pointsTeam1' : 'pointsTeam2';
        const scoreRef = firebase.database().ref('matches/' + matchId + '/score');
        
        try {
            // Utiliser une transaction pour garantir l'atomicité
            const result = await scoreRef.transaction((currentScore) => {
                if (currentScore === null) {
                    // Initialiser si le score n'existe pas
                    return {
                        pointsTeam1: team === 'team1' ? 1 : 0,
                        pointsTeam2: team === 'team2' ? 1 : 0,
                        setsTeam1: 0,
                        setsTeam2: 0
                    };
                }
                
                // Incrémenter le score de l'équipe
                const newPoints = (currentScore[pointField] || 0) + 1;
                
                // Validation: bloquer si score > 50 (aberrant)
                if (newPoints > 50) {
                    return; // Abort transaction
                }
                
                return {
                    ...currentScore,
                    [pointField]: newPoints
                };
            });
            
            if (!result.committed) {
                return { success: false, message: '❌ Score aberrant détecté (>50)' };
            }
            
            const newScore = result.snapshot.val();
            const newPoints = newScore[pointField];
            
            console.log(`✅ [TRANSACTION] Point ajouté: ${team} = ${newPoints}`);
            
            // Récupérer le match complet pour les validations
            const match = await this.getMatch(matchId);
            
            // Ajouter à l'historique des actions (non-bloquant)
            this.addActionToHistory(matchId, {
                type: 'point',
                team: team,
                scoreAfter: newScore
            }).catch(err => console.warn('Historique non enregistré:', err));

            // Vérifier si c'est une balle de set/match
            const status = this.checkSetStatus(match, newPoints, team);

            return { 
                success: true, 
                newScore: newScore,
                status: status,
                needsConfirmation: status.isSetPoint && status.hasMinimumLead
            };
            
        } catch (error) {
            console.error('❌ [TRANSACTION] Erreur addPoint:', error);
            return { success: false, message: 'Erreur lors de l\'ajout du point: ' + error.message };
        }
    },

    /**
     * Retire un point à une équipe (ATOMIQUE avec transaction)
     * @param {string} matchId - ID du match
     * @param {string} team - 'team1' ou 'team2'
     * @returns {Promise<Object>} Résultat de l'action
     */
    async removePoint(matchId, team) {
        const pointField = team === 'team1' ? 'pointsTeam1' : 'pointsTeam2';
        const ref = firebase.database().ref('matches/' + matchId + '/score/' + pointField);
        
        try {
            const result = await ref.transaction((currentValue) => {
                return Math.max(0, (currentValue || 0) - 1);
            });
            
            console.log(`✅ [TRANSACTION] Point retiré: ${team} = ${result.snapshot.val()}`);
            return { success: true, newValue: result.snapshot.val() };
        } catch (error) {
            console.error('❌ [TRANSACTION] Erreur removePoint:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Valide si un point peut être ajouté selon les règles
     * @param {Object} match - Données du match
     * @param {string} team - Équipe qui marque
     * @param {number} newPoints - Nouveau score de points
     * @returns {Object} Résultat de validation
     */
    validateScore(match, team, newPoints) {
        const currentScore = match.score || {};
        const otherTeam = team === 'team1' ? 'team2' : 'team1';
        const otherPoints = currentScore[otherTeam === 'team1' ? 'pointsTeam1' : 'pointsTeam2'] || 0;

        // Vérifier si le match est terminé
        const setsTeam1 = currentScore.setsTeam1 || 0;
        const setsTeam2 = currentScore.setsTeam2 || 0;
        const setsNeededToWin = match.matchType === 'coupe' ? 2 : 3;

        if (setsTeam1 >= setsNeededToWin || setsTeam2 >= setsNeededToWin) {
            return { allowed: false, message: '❌ Le match est terminé' };
        }

        // Limite de sécurité : écart de plus de 15 points
        const pointDiff = Math.abs(newPoints - otherPoints);
        if (pointDiff > 15) {
            return { 
                allowed: true, 
                warning: true,
                message: '⚠️ Écart de score important. Êtes-vous sûr ?' 
            };
        }

        // Blocage si score dépasse 50
        if (newPoints > 50) {
            return { allowed: false, message: '❌ Score aberrant détecté (>50)' };
        }

        return { allowed: true };
    },

    /**
     * Vérifie le statut du set (balle de set, balle de match, etc.)
     * @param {Object} match - Données du match
     * @param {number} points - Points de l'équipe
     * @param {string} team - Équipe concernée
     * @returns {Object} Statut du set
     */
    checkSetStatus(match, points, team) {
        const currentScore = match.score || {};
        const otherTeam = team === 'team1' ? 'team2' : 'team1';
        const otherPoints = currentScore[otherTeam === 'team1' ? 'pointsTeam1' : 'pointsTeam2'] || 0;
        
        const currentSet = match.currentSet || 1;
        const setsTeam1 = currentScore.setsTeam1 || 0;
        const setsTeam2 = currentScore.setsTeam2 || 0;
        const totalSets = setsTeam1 + setsTeam2;

        // Déterminer le seuil (25 pour sets normaux, 15 pour tie-break)
        const isTieBreak = (match.matchType === 'championnat' && currentSet === 5) || 
                          (match.matchType === 'coupe' && currentSet === 3);
        const targetScore = isTieBreak ? 15 : 25;

        // Pour VALIDER un set: au moins 25 points ET au moins 2 points d'avance
        const isSetPoint = points >= targetScore;
        const lead = points - otherPoints;
        const hasMinimumLead = lead >= 2;

        // Vérifier si c'est aussi une balle de match
        const setsNeededToWin = match.matchType === 'coupe' ? 2 : 3;
        const teamSets = team === 'team1' ? setsTeam1 : setsTeam2;
        const isMatchPoint = isSetPoint && hasMinimumLead && (teamSets + 1 >= setsNeededToWin);

        return {
            isSetPoint,
            isMatchPoint,
            hasMinimumLead,
            lead,
            targetScore,
            currentPoints: points,
            otherPoints: otherPoints
        };
    },

    /**
     * Valide la fin d'un set et passe au suivant (ATOMIQUE avec transaction)
     * @param {string} matchId - ID du match
     * @param {string} winningTeam - 'team1' ou 'team2'
     * @returns {Promise<Object>} Résultat
     */
    async validateSet(matchId, winningTeam) {
        const matchRef = firebase.database().ref('matches/' + matchId);
        
        try {
            const result = await matchRef.transaction((match) => {
                if (match === null) return null;
                
                const currentScore = match.score || {};
                const setsField = winningTeam === 'team1' ? 'setsTeam1' : 'setsTeam2';
                const newSets = (currentScore[setsField] || 0) + 1;
                
                // Sauvegarder l'historique du set
                const setHistory = match.setHistory || [];
                const currentSet = match.currentSet || 1;
                setHistory.push({
                    setNumber: currentSet,
                    team1Points: currentScore.pointsTeam1 || 0,
                    team2Points: currentScore.pointsTeam2 || 0,
                    winner: winningTeam,
                    timestamp: Date.now()
                });
                
                // Vérifier si le match est terminé
                const setsNeededToWin = match.matchType === 'coupe' ? 2 : 3;
                const isMatchFinished = newSets >= setsNeededToWin;
                
                // Mettre à jour le match
                match.score = {
                    ...currentScore,
                    [setsField]: newSets,
                    pointsTeam1: 0,
                    pointsTeam2: 0
                };
                match.setHistory = setHistory;
                match.currentSet = currentSet + 1;
                
                if (isMatchFinished) {
                    match.status = 'finished';
                    match.finishedAt = Date.now(); // Note: ServerValue.TIMESTAMP ne fonctionne pas dans transaction
                }
                
                return match;
            });
            
            if (!result.committed) {
                throw new Error('Transaction non validée');
            }
            
            const updatedMatch = result.snapshot.val();
            const setsField = winningTeam === 'team1' ? 'setsTeam1' : 'setsTeam2';
            const setsNeededToWin = updatedMatch.matchType === 'coupe' ? 2 : 3;
            const isMatchFinished = updatedMatch.score[setsField] >= setsNeededToWin;
            
            console.log(`✅ [TRANSACTION] Set validé: ${winningTeam} gagne le set ${updatedMatch.currentSet - 1}`);
            
            // Ajouter à l'historique (non-bloquant)
            this.addActionToHistory(matchId, {
                type: 'set_validated',
                setNumber: updatedMatch.currentSet - 1,
                winner: winningTeam,
                score: {
                    team1: updatedMatch.setHistory[updatedMatch.setHistory.length - 1].team1Points,
                    team2: updatedMatch.setHistory[updatedMatch.setHistory.length - 1].team2Points
                }
            }).catch(err => console.warn('Historique non enregistré:', err));

            return { 
                success: true, 
                isMatchFinished,
                finalScore: { 
                    setsTeam1: updatedMatch.score.setsTeam1, 
                    setsTeam2: updatedMatch.score.setsTeam2 
                }
            };
            
        } catch (error) {
            console.error('❌ [TRANSACTION] Erreur validateSet:', error);
            throw new Error('Erreur lors de la validation du set: ' + error.message);
        }
    },

    /**
     * Annule le dernier point marqué (ATOMIQUE avec transaction)
     * @param {string} matchId - ID du match
     * @returns {Promise<Object>} Résultat
     */
    async undoLastPoint(matchId) {
        const matchRef = firebase.database().ref('matches/' + matchId);
        
        try {
            let undoResult = { success: false, message: '' };
            
            await matchRef.transaction((match) => {
                if (match === null) {
                    undoResult = { success: false, message: 'Match non trouvé' };
                    return match;
                }
                
                const actionHistory = match.actionHistory || [];
                if (actionHistory.length === 0) {
                    undoResult = { success: false, message: 'Aucune action à annuler' };
                    return match;
                }
                
                // Trouver la dernière action de type 'point'
                let lastPointIndex = -1;
                for (let i = actionHistory.length - 1; i >= 0; i--) {
                    if (actionHistory[i].type === 'point') {
                        lastPointIndex = i;
                        break;
                    }
                }
                
                if (lastPointIndex === -1) {
                    undoResult = { success: false, message: 'Aucun point à annuler' };
                    return match;
                }
                
                const lastAction = actionHistory[lastPointIndex];
                const team = lastAction.team;
                const pointField = team === 'team1' ? 'pointsTeam1' : 'pointsTeam2';
                
                // Décrémenter le score
                match.score = match.score || {};
                match.score[pointField] = Math.max(0, (match.score[pointField] || 0) - 1);
                
                // Retirer l'action de l'historique
                actionHistory.splice(lastPointIndex, 1);
                match.actionHistory = actionHistory;
                
                undoResult = { 
                    success: true, 
                    message: 'Point annulé',
                    team: team,
                    newScore: match.score[pointField]
                };
                
                return match;
            });
            
            if (undoResult.success) {
                console.log(`✅ [TRANSACTION] Point annulé: ${undoResult.team} = ${undoResult.newScore}`);
            }
            
            return undoResult;
            
        } catch (error) {
            console.error('❌ [TRANSACTION] Erreur undoLastPoint:', error);
            return { success: false, message: 'Erreur: ' + error.message };
        }
    },

    /**
     * Annule la validation du dernier set (ATOMIQUE avec transaction)
     * @param {string} matchId - ID du match
     * @returns {Promise<Object>} Résultat
     */
    async undoLastSet(matchId) {
        const matchRef = firebase.database().ref('matches/' + matchId);
        
        try {
            let undoResult = { success: false, message: '' };
            
            await matchRef.transaction((match) => {
                if (match === null) {
                    undoResult = { success: false, message: 'Match non trouvé' };
                    return match;
                }
                
                const setHistory = match.setHistory || [];
                if (setHistory.length === 0) {
                    undoResult = { success: false, message: 'Aucun set à annuler' };
                    return match;
                }
                
                // Récupérer le dernier set
                const lastSet = setHistory[setHistory.length - 1];
                const winningTeam = lastSet.winner;
                const setsField = winningTeam === 'team1' ? 'setsTeam1' : 'setsTeam2';
                
                // Restaurer le score des sets
                match.score = match.score || {};
                match.score[setsField] = Math.max(0, (match.score[setsField] || 0) - 1);
                
                // Restaurer les points du set
                match.score.pointsTeam1 = lastSet.team1Points;
                match.score.pointsTeam2 = lastSet.team2Points;
                
                // Retirer le set de l'historique
                setHistory.pop();
                match.setHistory = setHistory;
                
                // Revenir au numéro de set précédent
                match.currentSet = lastSet.setNumber;
                
                // Si le match était terminé, le remettre en live
                match.status = 'live';
                
                // Nettoyer l'historique des actions du set annulé
                const actionHistory = match.actionHistory || [];
                let setStartTimestamp = 0;
                
                // Chercher le timestamp de début du set annulé
                for (let i = actionHistory.length - 1; i >= 0; i--) {
                    if (actionHistory[i].type === 'set_validated' && 
                        actionHistory[i].setNumber === lastSet.setNumber - 1) {
                        setStartTimestamp = actionHistory[i].timestamp;
                        break;
                    }
                }
                
                // Filtrer les actions après le début du set annulé
                match.actionHistory = actionHistory.filter(action => 
                    action.timestamp <= setStartTimestamp
                );
                
                undoResult = { 
                    success: true, 
                    message: 'Set annulé - Score restauré',
                    restoredScore: lastSet
                };
                
                return match;
            });
            
            if (undoResult.success) {
                console.log(`✅ [TRANSACTION] Set annulé, score restauré: ${undoResult.restoredScore.team1Points}-${undoResult.restoredScore.team2Points}`);
            }
            
            return undoResult;
            
        } catch (error) {
            console.error('❌ [TRANSACTION] Erreur undoLastSet:', error);
            return { success: false, message: 'Erreur: ' + error.message };
        }
    },

    /**
     * Ajoute une action à l'historique
     * @param {string} matchId - ID du match
     * @param {Object} action - Action à enregistrer
     */
    async addActionToHistory(matchId, action) {
        const match = await this.getMatch(matchId);
        const actionHistory = match.actionHistory || [];
        
        actionHistory.push({
            ...action,
            timestamp: Date.now()
        });

        // Limiter à 100 actions
        if (actionHistory.length > 100) {
            actionHistory.shift();
        }

        await firebase.database().ref('matches/' + matchId + '/actionHistory').set(actionHistory);
    },

    // ==========================================
    // INTERVIEWS
    // ==========================================

    /**
     * Crée une nouvelle interview
     * @param {Object} interviewData - Données de l'interview
     * @returns {Promise<string>} ID de l'interview créée
     */
    async createInterview(interviewData) {
        const interviewId = 'interview_' + Date.now();
        const interview = {
            id: interviewId,
            title: interviewData.title,
            youtubeUrl: interviewData.youtubeUrl,
            category: interviewData.category || 'Interpole',
            createdAt: firebase.database.ServerValue.TIMESTAMP
        };

        await firebase.database().ref('interviews/' + interviewId).set(interview);
        return interviewId;
    },

    /**
     * Récupère toutes les interviews
     * @returns {Promise<Object>} Toutes les interviews
     */
    async getAllInterviews() {
        const snapshot = await firebase.database().ref('interviews').once('value');
        return snapshot.val() || {};
    },

    /**
     * Supprime une interview
     * @param {string} interviewId - ID de l'interview
     */
    async deleteInterview(interviewId) {
        await firebase.database().ref('interviews/' + interviewId).remove();
    }
};

// Export global
window.dbService = dbService;
