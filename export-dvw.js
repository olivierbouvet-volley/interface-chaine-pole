// ============================================================
// EXPORT DVW — Convertisseur Firebase → fichier .dvw
// Compatible DataVolley / VolleyVision
// ============================================================

const exportDvw = {

    // Mapping skills UI → codes DVW
    SKILL_DVW: {
        'service':   'S',
        'reception': 'R',
        'defense':   'D',
        'attaque':   'A',
        'passe':     'E',  // E = setting (passeur)
        'contre':    'B',  // B = block
        // Codes Level 1bis (depuis actionFinale.dvwSkill)
        'S': 'S',
        'A': 'A',
        'B': 'B',
        'R': 'R',
        'F': 'F',  // Faute filet (freeball)
    },

    /**
     * Exporte un match Firebase en fichier .dvw
     * @param {string} matchId - ID du match dans Firebase
     */
    async exporterMatch(matchId) {
        try {
            this._afficherStatut('Chargement des données…');

            const match = await dbService.getMatch(matchId);
            if (!match) throw new Error('Match introuvable : ' + matchId);

            // Charger les rallies et les actions joueuses
            const ralliesSnap = await firebase.database()
                .ref('matches/' + matchId + '/rallies')
                .once('value');
            const ralliesObj = ralliesSnap.val() || {};

            const actionsSnap = await firebase.database()
                .ref('matches/' + matchId + '/playerActions')
                .once('value');
            const actionsObj = actionsSnap.val() || {};

            // Convertir en tableaux triés
            const rallies = Object.values(ralliesObj)
                .sort((a, b) => (a.index || 0) - (b.index || 0));

            const playerActions = Object.values(actionsObj)
                .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

            this._afficherStatut('Génération du fichier DVW…');

            const contenu = this._genererDvw(match, rallies, playerActions);
            this._telecharger(contenu, match);

            this._afficherStatut('Export réussi !', 'succes');

        } catch (err) {
            console.error('❌ Erreur export DVW:', err);
            this._afficherStatut('Erreur : ' + err.message, 'erreur');
        }
    },

    /**
     * Génère le contenu complet du fichier DVW
     */
    _genererDvw(match, rallies, playerActions) {
        const team1Nom = (match.team1?.name || 'DOMICILE').toUpperCase();
        const team2Nom = (match.team2?.name || 'ADVERSE').toUpperCase();

        // Séparer les joueuses connues par équipe
        const joueusesRaw = Array.isArray(match.joueuses)
            ? match.joueuses
            : Object.values(match.joueuses || {});

        const joueusesTeam1 = joueusesRaw.filter(j => j.equipe === 'team1');
        const joueusesTeam2 = joueusesRaw.filter(j => j.equipe === 'team2');

        // Construire les sections
        const sections = [
            this._sectionHeader(),
            this._sectionMatch(match, team1Nom, team2Nom),
            this._sectionTeams(team1Nom, team2Nom),
            this._sectionPlayers(joueusesTeam1, 'H'),
            this._sectionPlayers(joueusesTeam2, 'V'),
            this._sectionSet(match),
            this._sectionScout(rallies, playerActions),
        ];

        return sections.join('\r\n') + '\r\n';
    },

    // ----------------------------------------------------------
    // SECTIONS DVW
    // ----------------------------------------------------------

    _sectionHeader() {
        return '[3DATAVOLLEYSCOUT]\r\n[3ENDOFHEADER]';
    },

    _sectionMatch(match, team1Nom, team2Nom) {
        const date = match.date
            ? match.date.split('-').reverse().join('/')
            : new Date().toLocaleDateString('fr-FR');
        const heure  = match.time  || '00:00';
        const categorie = match.category || match.matchType || 'Championnat';
        const lieu = 'Sablé-sur-Sarthe';

        return [
            '[3MATCH]',
            `;${date};${heure};${categorie};${lieu};${team1Nom};${team2Nom};;`,
        ].join('\r\n');
    },

    _sectionTeams(team1Nom, team2Nom) {
        return [
            '[3TEAMS]',
            `;${team1Nom}`,
            `;${team2Nom}`,
        ].join('\r\n');
    },

    _sectionPlayers(joueuses, side) {
        const header = `[3PLAYERS-${side}]`;
        const lines = [header, `;${joueuses.length}`];

        joueuses.forEach(j => {
            const numero = String(j.numero || '0').padStart(2, '0');
            const nom    = (j.nom || 'Joueuse').toUpperCase();
            lines.push(`;${numero};${nom};0;0`);
        });

        return lines.join('\r\n');
    },

    _sectionSet(match) {
        const setHistory = Array.isArray(match.setHistory)
            ? match.setHistory
            : Object.values(match.setHistory || {});

        const nbSets = setHistory.length;
        if (nbSets === 0) {
            return '[3SET]\r\n;0';
        }

        // Format : ;nbSets;s1H;s1V;s2H;s2V;...
        let scores = `;${nbSets}`;
        setHistory.forEach(set => {
            scores += `;${set.team1Points || 0};${set.team2Points || 0}`;
        });

        // Rembourrer jusqu'à 5 sets (10 scores)
        const scoresPaires = nbSets;
        for (let i = scoresPaires; i < 5; i++) {
            scores += ';0;0';
        }

        return `[3SET]\r\n${scores}`;
    },

    _sectionScout(rallies, playerActions) {
        const lines = ['[3SCOUT]'];

        // Grouper les actions par rallyId
        const actionsByRally = {};
        playerActions.forEach(action => {
            const rid = action.rallyId || '__sans_rally__';
            if (!actionsByRally[rid]) actionsByRally[rid] = [];
            actionsByRally[rid].push(action);
        });

        rallies.forEach(rally => {
            const actionsRally = (actionsByRally[rally.rallyId || rally.id] || [])
                .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

            if (actionsRally.length > 0) {
                // Niveau 2 : actions individuelles saisies par les parents
                actionsRally.forEach(action => {
                    const ligne = this._actionVersDvw(action);
                    if (ligne) lines.push(ligne);
                });

            } else if (rally.actionFinale) {
                // Niveau 1bis : action finale uniquement
                const ligne = this._actionFinalVersDvw(rally.actionFinale);
                if (ligne) lines.push(ligne);
            }
        });

        // Actions orphelines (sans rally associé)
        const actionsOrphelines = actionsByRally['__sans_rally__'] || [];
        actionsOrphelines.forEach(action => {
            const ligne = this._actionVersDvw(action);
            if (ligne) lines.push(ligne);
        });

        return lines.join('\r\n');
    },

    // ----------------------------------------------------------
    // CONVERSION D'ACTIONS EN LIGNES DVW
    // ----------------------------------------------------------

    /**
     * Convertit une action joueuse (Niveau 2) en ligne DVW
     */
    _actionVersDvw(action) {
        const equipe  = action.joueuse?.equipe === 'team1' ? '*' : 'a';
        const numero  = String(action.joueuse?.numero || '0').padStart(2, '0');
        const skillUi = action.skill || '';
        const skill   = this.SKILL_DVW[skillUi] || skillUi.toUpperCase().charAt(0) || 'S';
        const quality = action.quality || '~';

        return `${equipe}${numero}${skill}${quality}`;
    },

    /**
     * Convertit une actionFinale (Niveau 1bis) en ligne DVW
     */
    _actionFinalVersDvw(actionFinale) {
        if (!actionFinale) return null;

        const equipe   = actionFinale.team === 'team1' ? '*' : 'a';
        const skill    = this.SKILL_DVW[actionFinale.dvwSkill] || actionFinale.dvwSkill || 'A';
        const quality  = actionFinale.dvwQuality || '#';

        // Numéro 00 = joueuse inconnue (Level 1bis, pas de numéro)
        return `${equipe}00${skill}${quality}`;
    },

    // ----------------------------------------------------------
    // TÉLÉCHARGEMENT
    // ----------------------------------------------------------

    _telecharger(contenu, match) {
        const date = match.date
            ? match.date.replace(/-/g, '')
            : new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const team1 = (match.team1?.name || 'DOM').replace(/\s+/g, '_').toUpperCase();
        const team2 = (match.team2?.name || 'ADV').replace(/\s+/g, '_').toUpperCase();
        const nomFichier = `match_${date}_${team1}_vs_${team2}.dvw`;

        const blob = new Blob([contenu], { type: 'text/plain;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = nomFichier;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('✅ Export DVW téléchargé :', nomFichier);
    },

    // ----------------------------------------------------------
    // UTILITAIRES UI
    // ----------------------------------------------------------

    /**
     * Affiche un statut dans l'élément #exportDvwStatut (si présent)
     */
    _afficherStatut(message, type = 'info') {
        console.log(`[Export DVW] ${message}`);
        const el = document.getElementById('exportDvwStatut');
        if (!el) return;

        const couleurs = {
            info:    '#6366F1',
            succes:  '#10B981',
            erreur:  '#EF4444',
        };
        el.style.cssText = `
            display: block;
            padding: 8px 14px;
            border-radius: 6px;
            background: ${couleurs[type] || couleurs.info};
            color: white;
            font-size: 0.85rem;
            font-weight: 600;
            margin-top: 8px;
        `;
        el.textContent = message;

        if (type === 'succes' || type === 'erreur') {
            setTimeout(() => { el.style.display = 'none'; }, 4000);
        }
    },
};

// Export global
window.exportDvw = exportDvw;

console.log('✅ Module Export DVW chargé');
