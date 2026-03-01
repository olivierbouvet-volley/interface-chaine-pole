// ============================================
// SERVICE BASE DE DONNÉES
// Fonctions d'accès à Firebase Realtime Database
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
     * Incrémente le score d'une équipe
     * @param {string} matchId - ID du match
     * @param {string} team - 'home' ou 'away'
     */
    async incrementScore(matchId, team) {
        const match = await this.getMatch(matchId);
        if (!match) return;

        const field = team === 'home' ? 'pointsHome' : 'pointsAway';
        const newValue = (match.score[field] || 0) + 1;

        await firebase.database().ref('matches/' + matchId + '/score/' + field).set(newValue);
    },

    /**
     * Décrémente le score d'une équipe
     * @param {string} matchId - ID du match
     * @param {string} team - 'home' ou 'away'
     */
    async decrementScore(matchId, team) {
        const match = await this.getMatch(matchId);
        if (!match) return;

        const field = team === 'home' ? 'pointsHome' : 'pointsAway';
        const newValue = Math.max(0, (match.score[field] || 0) - 1);

        await firebase.database().ref('matches/' + matchId + '/score/' + field).set(newValue);
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
     * Ajoute un point à une équipe avec validation des règles
     * @param {string} matchId - ID du match
     * @param {string} team - 'team1' ou 'team2'
     * @returns {Promise<Object>} Résultat de l'action avec validation
     */
    async addPoint(matchId, team) {
        const match = await this.getMatch(matchId);
        if (!match) throw new Error('Match non trouvé');

        const currentScore = match.score || { pointsTeam1: 0, pointsTeam2: 0, setsTeam1: 0, setsTeam2: 0 };
        const pointField = team === 'team1' ? 'pointsTeam1' : 'pointsTeam2';
        const newPoints = (currentScore[pointField] || 0) + 1;

        // Validation des règles
        const validation = this.validateScore(match, team, newPoints);
        if (!validation.allowed) {
            return { success: false, message: validation.message };
        }

        // Mettre à jour le score
        await firebase.database().ref('matches/' + matchId + '/score/' + pointField).set(newPoints);

        // Ajouter à l'historique des actions
        await this.addActionToHistory(matchId, {
            type: 'point',
            team: team,
            scoreBefore: currentScore,
            scoreAfter: { ...currentScore, [pointField]: newPoints }
        });

        // Vérifier si c'est une balle de set/match
        const status = this.checkSetStatus(match, newPoints, team);

        return { 
            success: true, 
            status: status,
            needsConfirmation: status.isSetPoint && status.hasMinimumLead
        };
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
     * Valide la fin d'un set et passe au suivant
     * @param {string} matchId - ID du match
     * @param {string} winningTeam - 'team1' ou 'team2'
     * @returns {Promise<Object>} Résultat
     */
    async validateSet(matchId, winningTeam) {
        const match = await this.getMatch(matchId);
        if (!match) throw new Error('Match non trouvé');

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

        // Mettre à jour
        const updates = {
            ['score/' + setsField]: newSets,
            'score/pointsTeam1': 0,
            'score/pointsTeam2': 0,
            setHistory: setHistory,
            currentSet: currentSet + 1
        };

        if (isMatchFinished) {
            updates.status = 'finished';
            updates.finishedAt = firebase.database.ServerValue.TIMESTAMP;
        }

        await firebase.database().ref('matches/' + matchId).update(updates);

        // Ajouter à l'historique
        await this.addActionToHistory(matchId, {
            type: 'set_validated',
            setNumber: currentSet,
            winner: winningTeam,
            score: {
                team1: currentScore.pointsTeam1 || 0,
                team2: currentScore.pointsTeam2 || 0
            }
        });

        return { 
            success: true, 
            isMatchFinished,
            finalScore: { setsTeam1: currentScore.setsTeam1, setsTeam2: currentScore.setsTeam2 }
        };
    },

    /**
     * Annule le dernier point marqué
     * @param {string} matchId - ID du match
     * @returns {Promise<Object>} Résultat
     */
    async undoLastPoint(matchId) {
        const match = await this.getMatch(matchId);
        if (!match) throw new Error('Match non trouvé');

        const actionHistory = match.actionHistory || [];
        if (actionHistory.length === 0) {
            return { success: false, message: 'Aucune action à annuler' };
        }

        // Trouver la dernière action de type 'point'
        const lastPointIndex = actionHistory.length - 1;
        const lastAction = actionHistory[lastPointIndex];

        if (lastAction.type !== 'point') {
            return { success: false, message: 'La dernière action n\'est pas un point' };
        }

        // Restaurer le score précédent
        const scoreBefore = lastAction.scoreBefore;
        await firebase.database().ref('matches/' + matchId + '/score').update(scoreBefore);

        // Retirer l'action de l'historique
        actionHistory.splice(lastPointIndex, 1);
        await firebase.database().ref('matches/' + matchId + '/actionHistory').set(actionHistory);

        return { success: true, message: 'Point annulé' };
    },

    /**
     * Annule la validation du dernier set
     * @param {string} matchId - ID du match
     * @returns {Promise<Object>} Résultat
     */
    async undoLastSet(matchId) {
        const match = await this.getMatch(matchId);
        if (!match) throw new Error('Match non trouvé');

        const setHistory = match.setHistory || [];
        if (setHistory.length === 0) {
            return { success: false, message: 'Aucun set à annuler' };
        }

        // Récupérer le dernier set
        const lastSet = setHistory[setHistory.length - 1];
        const winningTeam = lastSet.winner;

        // Restaurer le score
        const setsField = winningTeam === 'team1' ? 'setsTeam1' : 'setsTeam2';
        const currentScore = match.score || {};
        const newSets = Math.max(0, (currentScore[setsField] || 0) - 1);

        // Retirer le set de l'historique
        setHistory.pop();

        const updates = {
            ['score/' + setsField]: newSets,
            'score/pointsTeam1': lastSet.team1Points,
            'score/pointsTeam2': lastSet.team2Points,
            setHistory: setHistory,
            currentSet: lastSet.setNumber,
            status: 'live' // Si le match était terminé, on le remet en live
        };

        await firebase.database().ref('matches/' + matchId).update(updates);
        
        // CRUCIAL: Nettoyer TOUTES les actions du set annulé (points + validation)
        // On doit trouver le timestamp de début du set annulé
        const actionHistory = match.actionHistory || [];
        
        // Trouver le timestamp de validation du set précédent (ou 0 si c'est le premier set)
        let setStartTimestamp = 0;
        if (setHistory.length > 0) {
            // Chercher la dernière validation de set avant celui annulé
            for (let i = actionHistory.length - 1; i >= 0; i--) {
                if (actionHistory[i].type === 'setValidation' && 
                    actionHistory[i].setNumber === lastSet.setNumber - 1) {
                    setStartTimestamp = actionHistory[i].timestamp;
                    break;
                }
            }
        }
        
        // Supprimer toutes les actions ajoutées APRÈS le début du set annulé
        const cleanedHistory = actionHistory.filter(action => 
            action.timestamp <= setStartTimestamp
        );
        
        console.log(`🧹 Nettoyage actionHistory: ${actionHistory.length} → ${cleanedHistory.length} actions`);
        await firebase.database().ref('matches/' + matchId + '/actionHistory').set(cleanedHistory);

        return { success: true, message: 'Set annulé - Vous pouvez maintenant modifier le score', restoredScore: lastSet };
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
    },

    // ==========================================
    // RALLIES & SAISIE STATS PARENTS
    // ==========================================

    /**
     * Démarre un rally — enregistre qui sert et le timestamp de service
     * @param {string} matchId - ID du match
     * @param {string} servingTeam - 'team1' ou 'team2'
     * @returns {Promise<string>} ID du rally créé
     */
    async startRally(matchId, servingTeam) {
        const match = await this.getMatch(matchId);
        if (!match) throw new Error('Match non trouvé');

        const rallyId = 'rally_' + Date.now();
        const currentRally = {
            rallyId: rallyId,
            status: 'en_cours',
            servingTeam: servingTeam,
            timestampServe: Date.now(),
            set: match.currentSet || 1,
            score: {
                pointsTeam1: match.score?.pointsTeam1 || 0,
                pointsTeam2: match.score?.pointsTeam2 || 0
            }
        };

        await firebase.database().ref('matches/' + matchId + '/currentRally').set(currentRally);
        console.log('🏐 Rally démarré:', rallyId, '— Serveur:', servingTeam);
        return rallyId;
    },

    /**
     * Termine un rally — calcule phase et durée, sauvegarde dans rallies/
     * @param {string} matchId - ID du match
     * @param {string} pointTeam - 'team1' ou 'team2' (qui a marqué le point)
     * @returns {Promise<string>} ID du rally sauvegardé
     */
    async endRally(matchId, pointTeam) {
        const match = await this.getMatch(matchId);
        if (!match) throw new Error('Match non trouvé');

        const currentRally = match.currentRally;
        const timestampPoint = Date.now();

        // Si pas de rally en cours, on crée un rally minimal (le service n'a pas été cliqué)
        if (!currentRally || currentRally.status !== 'en_cours') {
            const rallyId = 'rally_' + Date.now();
            const rallySansTiming = {
                rallyId: rallyId,
                index: await this._getRallyCount(matchId),
                set: match.currentSet || 1,
                servingTeam: null,
                pointTeam: pointTeam,
                phase: null,
                scoreApres: {
                    pointsTeam1: match.score?.pointsTeam1 || 0,
                    pointsTeam2: match.score?.pointsTeam2 || 0
                },
                timestampPoint: timestampPoint,
                timestampServe: null,
                duration: null
            };
            await firebase.database().ref('matches/' + matchId + '/rallies/' + rallyId).set(rallySansTiming);
            await firebase.database().ref('matches/' + matchId + '/currentRally').update({ status: 'point_marque', rallyId });
            return rallyId;
        }

        const rallyId = currentRally.rallyId;

        // Calcul de la phase (sideout = le receveur marque, breakpoint = le serveur marque)
        const phase = currentRally.servingTeam === pointTeam ? 'breakpoint' : 'sideout';

        // Durée en secondes
        const duration = (timestampPoint - currentRally.timestampServe) / 1000;

        const rallyData = {
            rallyId: rallyId,
            index: await this._getRallyCount(matchId),
            set: currentRally.set,
            servingTeam: currentRally.servingTeam,
            pointTeam: pointTeam,
            phase: phase,
            scoreAvant: currentRally.score,
            scoreApres: {
                pointsTeam1: match.score?.pointsTeam1 || 0,
                pointsTeam2: match.score?.pointsTeam2 || 0
            },
            timestampServe: currentRally.timestampServe,
            timestampPoint: timestampPoint,
            duration: Math.round(duration * 10) / 10
        };

        await firebase.database().ref('matches/' + matchId + '/rallies/' + rallyId).set(rallyData);
        await firebase.database().ref('matches/' + matchId + '/currentRally').update({
            status: 'point_marque',
            rallyId: rallyId
        });

        console.log('✅ Rally terminé:', rallyId, '— Phase:', phase, '— Durée:', rallyData.duration + 's');
        return rallyId;
    },

    /**
     * Compte le nombre de rallies existants pour indexation
     * @private
     */
    async _getRallyCount(matchId) {
        const snapshot = await firebase.database().ref('matches/' + matchId + '/rallies').once('value');
        return snapshot.numChildren();
    },

    /**
     * Enrichit un rally avec l'action finale (Niveau 1bis)
     * @param {string} matchId - ID du match
     * @param {string} rallyId - ID du rally
     * @param {Object} actionFinale - { type, team, dvwSkill, dvwQuality }
     *   type: 'ace'|'kill'|'bloc'|'faute_service'|'faute_reception'|'faute_attaque'|'faute_bloc'|'faute_filet'
     *   team: 'team1'|'team2' (équipe qui a FAIT l'action)
     *   dvwSkill: 'S'|'A'|'B'|'R'|'F'
     *   dvwQuality: '#'|'='
     */
    async enrichRallyActionFinale(matchId, rallyId, actionFinale) {
        await firebase.database()
            .ref('matches/' + matchId + '/rallies/' + rallyId + '/actionFinale')
            .set(actionFinale);
        console.log('📝 Action finale enregistrée:', rallyId, actionFinale.type);
    },

    /**
     * Enregistre une action individuelle d'une joueuse (Niveau 2)
     * @param {string} matchId - ID du match
     * @param {string|null} rallyId - ID du rally en cours (peut être null)
     * @param {Object} joueuse - { numero, nom, equipe }
     * @param {string} skill - 'service'|'reception'|'attaque'|'passe'|'contre'|'defense'
     * @param {string} quality - Code DVW: '#'|'+'|'!'|'-'|'/'|'='
     * @param {string} label - Label lisible: 'ACE!', 'Parfaite', 'Point!', etc.
     * @param {string} [parentRole='stats'] - Rôle du parent qui saisit
     * @returns {Promise<string>} ID de l'action créée
     */
    async savePlayerAction(matchId, rallyId, joueuse, skill, quality, label, parentRole = 'stats') {
        const match = await this.getMatch(matchId);
        if (!match) throw new Error('Match non trouvé');

        const actionId = 'action_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const action = {
            actionId: actionId,
            rallyId: rallyId || null,
            timestamp: Date.now(),
            joueuse: {
                numero: joueuse.numero,
                nom: joueuse.nom,
                equipe: joueuse.equipe
            },
            skill: skill,
            quality: quality,
            label: label,
            set: match.currentSet || 1,
            score: {
                pointsTeam1: match.score?.pointsTeam1 || 0,
                pointsTeam2: match.score?.pointsTeam2 || 0
            },
            parentRole: parentRole
        };

        await firebase.database().ref('matches/' + matchId + '/playerActions/' + actionId).set(action);
        console.log('✅ Action joueuse enregistrée:', joueuse.nom, skill, quality);
        return actionId;
    },

    /**
     * Écoute le currentRally en temps réel (pour Parent B — lecture seule)
     * @param {string} matchId - ID du match
     * @param {Function} callback - Appelée avec les données du currentRally
     * @returns {Function} Fonction pour stopper l'écoute
     */
    listenToCurrentRally(matchId, callback) {
        const ref = firebase.database().ref('matches/' + matchId + '/currentRally');
        ref.on('value', (snapshot) => {
            callback(snapshot.val());
        });
        // Retourne une fonction de nettoyage
        return () => ref.off('value');
    },

    /**
     * Sauvegarde les joueuses à suivre pour ce match
     * @param {string} matchId - ID du match
     * @param {Array} joueuses - [{ numero, nom, equipe }]
     */
    async saveJoueuses(matchId, joueuses) {
        await firebase.database().ref('matches/' + matchId + '/joueuses').set(joueuses);
        console.log('✅ Joueuses enregistrées:', joueuses.length, 'joueuse(s)');
    },

    // ==========================================
    // DVW REPLAY
    // ==========================================

    /**
     * Sauvegarde l'URL Firebase Storage du fichier DVW associé au match
     * @param {string} matchId - ID du match
     * @param {string} dvwStorageUrl - URL de téléchargement Firebase Storage
     */
    async saveDvwData(matchId, dvwStorageUrl) {
        await firebase.database().ref('matches/' + matchId + '/dvwStorageUrl').set(dvwStorageUrl);
        console.log('✅ Fichier DVW associé au match:', matchId);
    },

    /**
     * Sauvegarde l'offset de synchronisation vidéo/DVW
     * @param {string} matchId - ID du match
     * @param {number} offsetSeconds - Décalage en secondes (DVW t=0 → YouTube t=offsetSeconds)
     */
    async saveReplayOffset(matchId, offsetSeconds) {
        await firebase.database().ref('matches/' + matchId + '/replaySync').set({
            offsetSeconds: offsetSeconds,
            calibratedAt: firebase.database.ServerValue.TIMESTAMP
        });
        console.log('✅ Offset synchro sauvegardé:', offsetSeconds + 's', 'pour', matchId);
    }
};

// Export global
window.dbService = dbService;
