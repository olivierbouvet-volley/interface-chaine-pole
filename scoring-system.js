// ============================================
// SYSTÈME DE SCORING PROFESSIONNEL VOLLEYBALL
// ============================================

const scoringSystem = {
    currentMatchId: null,
    currentMatch: null,

    /**
     * Initialise le système de scoring
     * @param {string} matchId - ID du match
     */
    init(matchId) {
        this.currentMatchId = matchId;
        this.loadMatch();
    },

    /**
     * Charge les données du match en temps réel
     */
    loadMatch() {
        dbService.listenToMatch(this.currentMatchId, (match) => {
            this.currentMatch = match;
            this.updateUI(match);
            this.checkSetStatus(match);
        });
    },

    /**
     * Ajoute un point à une équipe
     * @param {string} team - 'team1' ou 'team2'
     */
    async addPoint(team) {
        try {
            const result = await dbService.addPoint(this.currentMatchId, team);
            
            if (!result.success) {
                this.showAlert(result.message, 'error');
                return;
            }

            // Si confirmation nécessaire pour fin de set
            if (result.needsConfirmation) {
                this.showSetConfirmation(team, result.status);
            }

            // Afficher balle de set/match AVANT d'atteindre le score final
            // On affiche à 24 points (ou 14 en tie-break) avec au moins 1 point d'avance
            const currentScore = this.currentMatch?.score || {};
            const teamPoints = team === 'team1' ? (currentScore.pointsTeam1 || 0) : (currentScore.pointsTeam2 || 0);
            const otherPoints = team === 'team1' ? (currentScore.pointsTeam2 || 0) : (currentScore.pointsTeam1 || 0);
            const targetScore = result.status.targetScore || 25;
            
            if (result.status.isMatchPoint) {
                this.showBalleDe('match');
            } else if (teamPoints >= (targetScore - 1) && teamPoints > otherPoints) {
                // Afficher "balle de set" à partir de 24 points (ou 14) avec avance
                this.showBalleDe('set');
            } else {
                this.hideBalleDe();
            }

        } catch (error) {
            console.error('Erreur ajout point:', error);
            this.showAlert('Erreur lors de l\'ajout du point', 'error');
        }
    },

    /**
     * Affiche la modal de confirmation de fin de set
     * @param {string} winningTeam - Équipe gagnante
     * @param {Object} status - Statut du set
     */
    showSetConfirmation(winningTeam, status) {
        const modal = document.getElementById('setConfirmationModal');
        const team1Name = this.currentMatch.team1?.name || 'Équipe 1';
        const team2Name = this.currentMatch.team2?.name || 'Équipe 2';
        const winningTeamName = winningTeam === 'team1' ? team1Name : team2Name;

        // Mettre à jour le contenu de la modal
        document.getElementById('winningTeamName').textContent = winningTeamName;
        document.getElementById('finalScoreTeam1').textContent = status.currentPoints;
        document.getElementById('finalScoreTeam2').textContent = status.otherPoints;

        const currentSet = this.currentMatch.currentSet || 1;
        document.getElementById('setNumber').textContent = `Set ${currentSet}`;

        // Calculer le score des sets après validation
        const setsTeam1 = (this.currentMatch.score?.setsTeam1 || 0) + (winningTeam === 'team1' ? 1 : 0);
        const setsTeam2 = (this.currentMatch.score?.setsTeam2 || 0) + (winningTeam === 'team2' ? 1 : 0);
        document.getElementById('setsScore').textContent = `Score des sets: ${setsTeam1} - ${setsTeam2}`;

        // Afficher la modal
        modal.style.display = 'flex';

        // Gérer les boutons
        document.getElementById('confirmSetBtn').onclick = () => {
            this.validateSet(winningTeam);
            modal.style.display = 'none';
        };

        document.getElementById('cancelSetBtn').onclick = () => {
            modal.style.display = 'none';
        };
    },

    /**
     * Valide la fin d'un set
     * @param {string} winningTeam - Équipe gagnante
     */
    async validateSet(winningTeam) {
        try {
            const result = await dbService.validateSet(this.currentMatchId, winningTeam);
            
            if (result.isMatchFinished) {
                this.showMatchFinished(winningTeam);
            } else {
                this.showAlert('Set validé ! Début du set suivant', 'success');
                // Trigger sponsor overlay si configuré
                await dbService.triggerSponsorOverlay(this.currentMatchId);
            }
        } catch (error) {
            console.error('Erreur validation set:', error);
            this.showAlert('Erreur lors de la validation du set', 'error');
        }
    },

    /**
     * Annule le dernier point
     */
    async undoLastPoint() {
        try {
            const result = await dbService.undoLastPoint(this.currentMatchId);
            
            if (result.success) {
                this.showAlert(result.message, 'success');
            } else {
                this.showAlert(result.message, 'warning');
            }
        } catch (error) {
            console.error('Erreur undo point:', error);
            this.showAlert('Erreur lors de l\'annulation', 'error');
        }
    },

    /**
     * Annule le dernier set validé
     */
    async undoLastSet() {
        if (!confirm('Êtes-vous sûr de vouloir annuler la validation du dernier set ?')) {
            return;
        }

        try {
            const result = await dbService.undoLastSet(this.currentMatchId);
            
            if (result.success) {
                this.showAlert(`Set annulé. Score restauré : ${result.restoredScore.team1Points}-${result.restoredScore.team2Points}`, 'success');
            } else {
                this.showAlert(result.message, 'warning');
            }
        } catch (error) {
            console.error('Erreur undo set:', error);
            this.showAlert('Erreur lors de l\'annulation du set', 'error');
        }
    },

    /**
     * Met à jour l'interface utilisateur
     * @param {Object} match - Données du match
     */
    updateUI(match) {
        if (!match) return;

        const score = match.score || {};
        
        // Mettre à jour les scores
        document.getElementById('scoreTeam1').textContent = score.pointsTeam1 || 0;
        document.getElementById('scoreTeam2').textContent = score.pointsTeam2 || 0;
        document.getElementById('setsTeam1').textContent = score.setsTeam1 || 0;
        document.getElementById('setsTeam2').textContent = score.setsTeam2 || 0;

        // Mettre à jour les noms d'équipes
        document.getElementById('team1NameDisplay').textContent = match.team1?.name || 'Équipe 1';
        document.getElementById('team2NameDisplay').textContent = match.team2?.name || 'Équipe 2';

        // Mettre à jour l'historique des sets
        this.updateSetHistory(match);

        // Mettre à jour le numéro de set actuel
        const currentSet = match.currentSet || 1;
        document.getElementById('currentSetNumber').textContent = `Set ${currentSet}`;
    },

    /**
     * Met à jour l'affichage de l'historique des sets
     * @param {Object} match - Données du match
     */
    updateSetHistory(match) {
        const setHistory = match.setHistory || [];
        const container = document.getElementById('setHistoryList');
        
        if (setHistory.length === 0) {
            container.innerHTML = '<p style="color: var(--gray); font-style: italic;">Aucun set terminé</p>';
            return;
        }

        const html = setHistory.map(set => {
            const winnerName = set.winner === 'team1' ? match.team1?.name : match.team2?.name;
            return `
                <div class="set-history-item">
                    <span class="set-label">Set ${set.setNumber}</span>
                    <span class="set-score">${set.team1Points} - ${set.team2Points}</span>
                    <span class="set-winner">🏆 ${winnerName}</span>
                </div>
            `;
        }).join('');

        container.innerHTML = html;

        // Afficher le bouton d'annulation du dernier set
        const undoSetBtn = document.getElementById('undoSetBtn');
        if (setHistory.length > 0) {
            undoSetBtn.style.display = 'block';
        } else {
            undoSetBtn.style.display = 'none';
        }

        // Mettre à jour le tableau score par set (si la fonction est disponible)
        if (typeof renderScoreParSet === 'function') {
            renderScoreParSet(match);
        }
    },

    /**
     * Vérifie le statut du set et affiche les alertes
     * @param {Object} match - Données du match
     */
    checkSetStatus(match) {
        const score = match.score || {};
        const pointsTeam1 = score.pointsTeam1 || 0;
        const pointsTeam2 = score.pointsTeam2 || 0;

        const currentSet = match.currentSet || 1;
        const totalSets = (score.setsTeam1 || 0) + (score.setsTeam2 || 0);

        // Déterminer le seuil (25 pour sets normaux, 15 pour tie-break)
        const isTieBreak = (match.matchType === 'championnat' && currentSet === 5) || 
                          (match.matchType === 'coupe' && currentSet === 3);
        const targetScore = isTieBreak ? 15 : 25;

        // Vérifier balle de set pour équipe 1
        if (pointsTeam1 >= targetScore - 1 && pointsTeam1 >= pointsTeam2) {
            this.showBalleDe(pointsTeam1 >= targetScore && (pointsTeam1 - pointsTeam2) >= 1 ? 'set' : null);
        }
        // Vérifier balle de set pour équipe 2
        else if (pointsTeam2 >= targetScore - 1 && pointsTeam2 >= pointsTeam1) {
            this.showBalleDe(pointsTeam2 >= targetScore && (pointsTeam2 - pointsTeam1) >= 1 ? 'set' : null);
        } else {
            this.hideBalleDe();
        }
    },

    /**
     * Affiche l'indicateur "Balle de Set" ou "Balle de Match"
     * @param {string} type - 'set' ou 'match'
     */
    showBalleDe(type) {
        const indicator = document.getElementById('balleDeIndicator');
        if (!type) {
            indicator.style.display = 'none';
            return;
        }

        indicator.style.display = 'block';
        indicator.textContent = type === 'match' ? '⚠️ BALLE DE MATCH ⚠️' : '⚠️ BALLE DE SET ⚠️';
        indicator.className = type === 'match' ? 'balle-de-match' : 'balle-de-set';
    },

    /**
     * Cache l'indicateur "Balle de"
     */
    hideBalleDe() {
        const indicator = document.getElementById('balleDeIndicator');
        indicator.style.display = 'none';
    },

    /**
     * Affiche une alerte
     * @param {string} message - Message à afficher
     * @param {string} type - Type d'alerte ('success', 'error', 'warning')
     */
    showAlert(message, type = 'info') {
        // Créer ou utiliser un système d'alerte toast
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.textContent = message;
        alert.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 16px 24px;
            background: ${type === 'success' ? '#10B981' : type === 'error' ? '#EF4444' : '#F59E0B'};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(alert);

        setTimeout(() => {
            alert.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => alert.remove(), 300);
        }, 3000);
    },

    /**
     * Affiche le modal de fin de match
     * @param {string} winningTeam - Équipe gagnante
     */
    showMatchFinished(winningTeam) {
        const team1Name = this.currentMatch.team1?.name || 'Équipe 1';
        const team2Name = this.currentMatch.team2?.name || 'Équipe 2';
        const winningTeamName = winningTeam === 'team1' ? team1Name : team2Name;

        alert(`🏆 MATCH TERMINÉ ! 🏆\n\nVictoire de ${winningTeamName}\n\nScore final: ${this.currentMatch.score.setsTeam1} - ${this.currentMatch.score.setsTeam2}`);
    }
};

// Export global
window.scoringSystem = scoringSystem;

console.log('✅ Système de scoring chargé');
