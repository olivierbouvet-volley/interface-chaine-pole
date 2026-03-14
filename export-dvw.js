// ============================================================
// EXPORT DVW — Convertisseur Firebase → fichier .dvw
// Compatible DataVolley / VolleyVision
//
// Algorithme multi-niveaux :
//   Niveau 0 : score seul (animateur sans détail)
//   Niveau 1 : score + action finale popup 1bis (skill+quality, joueur 00)
//   Niveau 2 : score + actions joueuses saisies par les parents (numéro identifié)
//
// Fonctionnalités :
//   - Rattachement des actions orphelines au rally précédent
//   - Détection et résolution des conflits (2 parents, 2 numéros)
//   - Calcul des videoSeconds depuis les timestamps Firebase
//   - Lignes *p (points), **Nset (fin de set), lineups *P>LUp
//   - Format DVW complet avec set, timestamp horloge, videoSeconds
//   - Modificateur ;p; sur les actions décisives
//   - Joueur $$ pour les fautes sans numéro identifié
//   - [3VIDEO] avec l'URL YouTube
//   - [3SET] avec jalons 8, 16, 21 pts calculés depuis les rallies
// ============================================================

const exportDvw = {

    // Mapping skills UI → codes DVW
    SKILL_DVW: {
        'service': 'S', 'reception': 'R', 'defense': 'D',
        'attaque': 'A', 'passe': 'E', 'contre': 'B', 'relance': 'F',
        // Codes Level 1bis directs (déjà en DVW)
        'S': 'S', 'A': 'A', 'B': 'B', 'R': 'R', 'F': 'F', 'E': 'E', 'D': 'D',
    },

    SKILL_LABEL:   { S:'Service', A:'Attaque', B:'Bloc', R:'Réception', E:'Passe', D:'Défense', F:'Relance' },
    QUALITY_LABEL: { '#':'Kill/Ace', '+':'Positif', '!':'Neutre', '-':'Négatif', '/':'Bloqué', '=':'Faute' },

    // ID de l'élément de statut — mis à jour par l'appelant (admin-matches.html)
    _statutElId: 'exportDvwStatut',

    // État interne (réinitialisé à chaque export)
    _conflitsPending: [],
    _conflitsResolus: {},
    _modalData: null,

    // -------------------------------------------------------
    // POINT D'ENTRÉE PRINCIPAL
    // -------------------------------------------------------
    async exporterMatch(matchId) {
        this._conflitsPending = [];
        this._conflitsResolus = {};
        this._modalData = null;
        try {
            this._afficherStatut('⏳ Chargement des données…');

            const match = await dbService.getMatch(matchId);
            if (!match) throw new Error('Match introuvable : ' + matchId);

            const [ralliesSnap, actionsSnap, syncSnap, editsSnap, fdmeSnap] = await Promise.all([
                firebase.database().ref('matches/' + matchId + '/rallies').once('value'),
                firebase.database().ref('matches/' + matchId + '/playerActions').once('value'),
                firebase.database().ref('matches/' + matchId + '/videoSync').once('value'),
                firebase.database().ref('matches/' + matchId + '/dvwEdits').once('value'),
                firebase.database().ref('matches/' + matchId + '/fdmeData').once('value'),
            ]);

            const rallies = Object.values(ralliesSnap.val() || {})
                .sort((a, b) => (a.index || 0) - (b.index || 0));
            const playerActions = Object.values(actionsSnap.val() || {})
                .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
            const videoOffset = syncSnap.val()?.offsetSeconds || 0;
            const dvwEdits    = editsSnap.val() || {};
            const fdmeData    = fdmeSnap.val() || {};

            this._afficherStatut('🔍 Analyse et fusion des données…');

            // 1. Rattacher les actions orphelines au rally précédent
            const actionsAttachees = this._rattacherOrphelines(playerActions, rallies);

            // 2. Détecter les conflits (même rally, même action, numéros différents)
            this._conflitsPending = this._detecterConflits(rallies, actionsAttachees);

            if (this._conflitsPending.length > 0) {
                // Demander à l'animateur de trancher
                this._afficherModalConflits(match, rallies, actionsAttachees, videoOffset, matchId, dvwEdits, fdmeData);
            } else {
                await this._genererEtTelecharger(match, rallies, actionsAttachees, videoOffset, dvwEdits, fdmeData);
            }

        } catch (err) {
            console.error('❌ Erreur export DVW:', err);
            this._afficherStatut('❌ Erreur : ' + err.message, 'erreur');
        }
    },

    // -------------------------------------------------------
    // 1. RATTACHER LES ACTIONS ORPHELINES AU RALLY PRÉCÉDENT
    //    (action saisie entre deux rallies → rally précédent)
    // -------------------------------------------------------
    _rattacherOrphelines(playerActions, rallies) {
        return playerActions.map(action => {
            if (action.rallyId && action.rallyId !== '__sans_rally__') return action;
            const t = action.timestamp || 0;
            // Chercher le dernier rally terminé avant cette action
            let rallyPrecedent = null;
            for (let i = rallies.length - 1; i >= 0; i--) {
                const r = rallies[i];
                const tR = r.timestampPoint || r.timestampServe || 0;
                if (tR <= t) { rallyPrecedent = r; break; }
            }
            if (rallyPrecedent) {
                return { ...action, rallyId: rallyPrecedent.rallyId || rallyPrecedent.id, _orphelineRattachee: true };
            }
            return action;
        });
    },

    // -------------------------------------------------------
    // 2. DÉTECTER LES CONFLITS
    //    Même rally + même skill/quality/équipe + numéros différents
    // -------------------------------------------------------
    _detecterConflits(rallies, playerActions) {
        const conflits = [];
        const byRally = {};
        playerActions.forEach(a => {
            const rid = a.rallyId || '__none__';
            if (!byRally[rid]) byRally[rid] = [];
            byRally[rid].push(a);
        });

        rallies.forEach(rally => {
            const rid = rally.rallyId || rally.id;
            const actions = byRally[rid] || [];
            const bySkillQual = {};
            actions.forEach(a => {
                const skill = this.SKILL_DVW[a.skill] || (a.skill || '').charAt(0).toUpperCase() || 'S';
                const team  = a.joueuse?.equipe || 'team1';
                const key   = `${rid}__${skill}__${a.quality}__${team}`;
                if (!bySkillQual[key]) bySkillQual[key] = [];
                bySkillQual[key].push(a);
            });
            Object.entries(bySkillQual).forEach(([key, grp]) => {
                const numeros = [...new Set(grp.map(a => a.joueuse?.numero).filter(n => n && n > 0))];
                if (numeros.length > 1) {
                    conflits.push({ key, rallyId: rid, rally, actions: grp, numeros });
                }
            });
        });
        return conflits;
    },

    // -------------------------------------------------------
    // 3. MODAL DE RÉSOLUTION — L'animateur tranche
    // -------------------------------------------------------
    _afficherModalConflits(match, rallies, playerActions, videoOffset, matchId, dvwEdits, fdmeData) {
        let modal = document.getElementById('dvwConflitModal');
        if (modal) modal.remove();
        modal = document.createElement('div');
        modal.id = 'dvwConflitModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
        document.body.appendChild(modal);

        const conflitsHtml = this._conflitsPending.map((c) => {
            const skillDvw = this.SKILL_DVW[c.actions[0]?.skill] || '?';
            const skillLbl = this.SKILL_LABEL[skillDvw]   || skillDvw;
            const qualLbl  = this.QUALITY_LABEL[c.actions[0]?.quality] || c.actions[0]?.quality || '?';
            const setNum   = c.rally?.set || '?';
            const scoreAv  = c.rally?.scoreAvant
                ? `${c.rally.scoreAvant.pointsTeam1||0}-${c.rally.scoreAvant.pointsTeam2||0}` : '?';

            const btns = c.actions.map(a => {
                const n   = a.joueuse?.numero || '?';
                const nom = a.joueuse?.nom || '';
                return `<button id="btnc-${c.key}-${n}" onclick="exportDvw._resoudreConflit('${c.key}',${n})"
                    style="padding:9px 18px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.4);color:white;border-radius:6px;cursor:pointer;font-weight:700;font-size:0.9rem;transition:all .15s;">
                    #${n} <span style="font-weight:400;opacity:0.8;">${nom}</span>
                </button>`;
            }).join('');

            return `<div style="background:rgba(255,255,255,0.04);border-radius:8px;padding:14px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.08);">
                <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:8px;">Set ${setNum} — ${scoreAv} — ${skillLbl} <strong>${qualLbl}</strong></div>
                <div style="font-weight:600;margin-bottom:10px;">👆 Qui a effectué cette action ?</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">${btns}</div>
            </div>`;
        }).join('');

        modal.innerHTML = `
            <div style="background:#1e293b;border-radius:16px;padding:28px;max-width:560px;width:100%;max-height:82vh;overflow-y:auto;border:1px solid rgba(255,255,255,0.12);">
                <h3 style="margin:0 0 6px 0;color:#fbbf24;font-size:1.1rem;">⚠️ ${this._conflitsPending.length} conflit${this._conflitsPending.length>1?'s':''}  détecté${this._conflitsPending.length>1?'s':''}</h3>
                <p style="font-size:0.85rem;color:#94a3b8;margin:0 0 20px 0;">
                    Deux joueuses ont été saisies pour la même action sur le même rally.<br>
                    Sélectionnez la bonne joueuse pour chaque cas.
                </p>
                ${conflitsHtml}
                <div id="dvw-conflit-ok" style="display:none;padding:10px;border-radius:6px;background:rgba(16,185,129,0.1);color:#10b981;font-size:0.85rem;margin-bottom:14px;">
                    ✅ Tous les conflits sont résolus. Cliquez pour générer le DVW.
                </div>
                <div style="display:flex;gap:10px;margin-top:4px;">
                    <button id="btn-valider-conflits" onclick="exportDvw._validerConflits()"
                        style="flex:1;padding:13px;background:rgba(99,102,241,0.25);color:white;border:1px solid #6366f1;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.95rem;">
                        ✅ Valider et télécharger
                    </button>
                    <button onclick="exportDvw._fermerModalConflits()"
                        style="padding:13px 20px;background:rgba(255,255,255,0.07);color:white;border:1px solid rgba(255,255,255,0.15);border-radius:8px;cursor:pointer;">
                        Annuler
                    </button>
                </div>
            </div>`;

        this._modalData = { match, rallies, playerActions, videoOffset, dvwEdits: dvwEdits || {}, fdmeData: fdmeData || {} };
        this._conflitsResolus = {};
    },

    _resoudreConflit(key, numero) {
        this._conflitsResolus[key] = numero;
        const conflit = this._conflitsPending.find(c => c.key === key);
        if (conflit) {
            conflit.actions.forEach(a => {
                const n   = a.joueuse?.numero || 0;
                const btn = document.getElementById(`btnc-${key}-${n}`);
                if (!btn) return;
                const choisi = (n == numero);
                btn.style.background    = choisi ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.03)';
                btn.style.borderColor   = choisi ? '#10b981'  : 'rgba(255,255,255,0.1)';
                btn.style.opacity       = choisi ? '1' : '0.35';
            });
        }
        const tousResolus = this._conflitsPending.every(c => this._conflitsResolus[c.key] !== undefined);
        const btnValider  = document.getElementById('btn-valider-conflits');
        const okEl        = document.getElementById('dvw-conflit-ok');
        if (tousResolus && btnValider) {
            btnValider.style.background  = 'rgba(16,185,129,0.3)';
            btnValider.style.borderColor = '#10b981';
            btnValider.textContent = '✅ Tous résolus — Générer le DVW';
            if (okEl) okEl.style.display = 'block';
        }
    },

    async _validerConflits() {
        const nonResolus = this._conflitsPending.filter(c => this._conflitsResolus[c.key] === undefined);
        if (nonResolus.length > 0) {
            alert(`⚠️ ${nonResolus.length} conflit(s) non résolu(s). Sélectionnez une joueuse pour chaque action.`);
            return;
        }
        this._fermerModalConflits();
        if (!this._modalData) return;
        const { match, rallies, playerActions, videoOffset, dvwEdits, fdmeData } = this._modalData;
        await this._genererEtTelecharger(match, rallies, playerActions, videoOffset, dvwEdits, fdmeData);
    },

    _fermerModalConflits() {
        const modal = document.getElementById('dvwConflitModal');
        if (modal) modal.remove();
    },

    // -------------------------------------------------------
    // 4. GÉNÉRATION ET TÉLÉCHARGEMENT
    // -------------------------------------------------------
    async _genererEtTelecharger(match, rallies, playerActions, videoOffset, dvwEdits, fdmeData) {
        this._afficherStatut('⚙️ Génération du fichier DVW…');
        try {
            const contenu = this._genererDvw(match, rallies, playerActions, videoOffset, dvwEdits, fdmeData || {});
            this._telecharger(contenu, match);
            this._afficherStatut('✅ Export DVW réussi !', 'succes');
        } catch (err) {
            console.error('❌ Erreur génération:', err);
            this._afficherStatut('❌ Erreur : ' + err.message, 'erreur');
        }
    },

    _genererDvw(match, rallies, playerActions, videoOffset, dvwEdits, fdmeData) {
        // ── Reconstruire la liste complète des joueuses ──
        const joueusesMap = { team1: {}, team2: {} };
        (Array.isArray(match.joueuses) ? match.joueuses : Object.values(match.joueuses || {}))
            .forEach(j => {
                const eq = j.equipe || 'team1';
                const n  = j.numero || 0;
                if (!joueusesMap[eq][n]) joueusesMap[eq][n] = { numero: n, nom: (j.nom || '').toUpperCase(), libero: j.libero || false };
            });
        playerActions.forEach(a => {
            const eq = a.joueuse?.equipe || 'team1';
            const n  = a.joueuse?.numero || 0;
            if (n > 0 && !joueusesMap[eq][n]) {
                joueusesMap[eq][n] = { numero: n, nom: (a.joueuse?.nom || '').toUpperCase(), libero: false };
            }
        });
        const joueusesT1 = Object.values(joueusesMap.team1).sort((a, b) => a.numero - b.numero);
        const joueusesT2 = Object.values(joueusesMap.team2).sort((a, b) => a.numero - b.numero);

        // ── Index global joueurs (pour [3PLAYERS]) ──
        const playerIndex = {};
        let idx = 1;
        joueusesT1.forEach(j => { playerIndex[`team1_${j.numero}`] = idx++; });
        joueusesT2.forEach(j => { playerIndex[`team2_${j.numero}`] = idx++; });

        // ── Ancrage vidéo : premier rally avec un timestampServe ──
        // videoSeconds(action) = videoOffset + (timestampServe_rally - timestampServe_premier) / 1000
        const premiereServe = rallies.find(r => r.timestampServe && r.timestampServe > 0);
        const tAncrage = premiereServe?.timestampServe || 0;
        const calcVS = (tsMs) => {
            if (!tAncrage || !tsMs) return 0;
            return Math.max(0, Math.round(videoOffset + (tsMs - tAncrage) / 1000));
        };

        const team1Nom  = (match.team1?.name || 'DOMICILE').toUpperCase().substring(0, 20);
        const team2Nom  = (match.team2?.name || 'ADVERSE').toUpperCase().substring(0, 20);
        const team1Code = team1Nom.replace(/[^A-Z0-9]/g, '').substring(0, 3) || 'T1';
        const team2Code = team2Nom.replace(/[^A-Z0-9]/g, '').substring(0, 3) || 'T2';

        // ── Rotations de départ depuis FDME (positions des joueuses par set) ──
        // fdmeData.fdmeSwapped=true → team1/team2 FDME inversées par rapport à Firebase
        const rotDepart = fdmeData.rotationsDepart || {};
        const swapped   = !!fdmeData.fdmeSwapped;

        // ── Numéros de passeuses → rôles 5-1 dans [3PLAYERS] ──
        // fdmeData.passeuses = { team1: N, team2: N } (côté FDME, avant swap)
        const passeuses   = fdmeData.passeuses || {};
        const setterNumT1 = swapped ? (passeuses.team2 || 0) : (passeuses.team1 || 0);
        const setterNumT2 = swapped ? (passeuses.team1 || 0) : (passeuses.team2 || 0);

        const sections = [
            this._sectionDataVolleyscout(),
            this._sectionMatch(match, team1Nom, team2Nom),
            this._sectionTeams(team1Nom, team2Nom, team1Code, team2Code, match),
            '[3MORE]\r\n;',
            '[3COMMENTS]\r\n',
            this._sectionSet(match, rallies),
            this._sectionPlayers(joueusesT1, 'H', playerIndex, 'team1', rotDepart, swapped ? 'team2' : 'team1', setterNumT1),
            this._sectionPlayers(joueusesT2, 'V', playerIndex, 'team2', rotDepart, swapped ? 'team1' : 'team2', setterNumT2),
            '[3ATTACKCOMBINATION]\r\n',
            '[3SETTERCALL]\r\n',
            '[3WINNINGSYMBOLS]\r\n',
            '[3RESERVE]\r\n',
            this._sectionVideo(match),
            this._sectionRotation(rallies),
            this._sectionScout(match, rallies, playerActions, calcVS, dvwEdits || {}, rotDepart, swapped),
        ];
        return sections.join('\r\n') + '\r\n';
    },

    // -------------------------------------------------------
    // SECTIONS DVW
    // -------------------------------------------------------
    _sectionDataVolleyscout() {
        const now = new Date();
        const p   = n => String(n).padStart(2, '0');
        const d   = `${p(now.getDate())}/${p(now.getMonth()+1)}/${now.getFullYear()} ${p(now.getHours())}.${p(now.getMinutes())}.${p(now.getSeconds())}`;
        return [
            '[3DATAVOLLEYSCOUT]',
            'FILEFORMAT: 2.0',
            `GENERATOR-DAY: ${d}`,
            'GENERATOR-IDP: DVW',
            'GENERATOR-PRG: Interface Chaine Pole',
            'GENERATOR-REL: 1.0',
            'GENERATOR-VER: Live Stats',
            'GENERATOR-NAM: Pole Espoir Volley',
            `LASTCHANGE-DAY: ${d}`,
            'LASTCHANGE-IDP: DVW',
            'LASTCHANGE-PRG: Interface Chaine Pole',
            'LASTCHANGE-REL: 1.0',
            'LASTCHANGE-VER: Live Stats',
            'LASTCHANGE-NAM: Pole Espoir Volley',
            '[3ENDOFHEADER]',
        ].join('\r\n');
    },

    _sectionMatch(match, team1Nom, team2Nom) {
        const date = match.date ? match.date.split('-').reverse().join('/') : '01/01/2026';
        const cat  = (match.category || match.matchType || 'Championnat').replace(/;/g, '');
        const sh   = Array.isArray(match.setHistory) ? match.setHistory : Object.values(match.setHistory || {});
        const s1   = match.score?.setsTeam1 || sh.filter(s => s.winner === 'team1').length || 0;
        const s2   = match.score?.setsTeam2 || sh.filter(s => s.winner === 'team2').length || 0;
        return [
            '[3MATCH]',
            `${date};;2025/2026;${cat};;;;;${Math.max(s1,s2)};1;Z;${Math.min(s1,s2)};;0;;`,
            `;;;;;;R;R;;0;`,
        ].join('\r\n');
    },

    _sectionTeams(team1Nom, team2Nom, team1Code, team2Code, match) {
        const coach = (match.team1?.declaringPlayer || '').toUpperCase().replace(/;/g, '');
        return [
            '[3TEAMS]',
            `${team1Code};${team1Nom};2;${coach};;0;;;`,
            `${team2Code};${team2Nom};0;;;0;;;`,
        ].join('\r\n');
    },

    _sectionVideo(match) {
        return `[3VIDEO]\r\nCamera0=${match.youtubeUrl || ''}`;
    },

    // rotDepart = fdmeData.rotationsDepart, fdmeTeamKey = 'team1'/'team2' côté FDME de cette équipe
    // setterNum = numéro de la passeuse (0 = inconnu) → calcule les rôles 5-1
    _sectionPlayers(joueuses, side, playerIndex, teamKey, rotDepart, fdmeTeamKey, setterNum) {
        const teamNum   = side === 'H' ? 0 : 1;
        const lines     = [`[3PLAYERS-${side}]`];
        rotDepart       = rotDepart || {};
        fdmeTeamKey     = fdmeTeamKey || teamKey;
        setterNum       = parseInt(setterNum) || 0;

        // Rotation du set 1 pour calculer les rôles 5-1 (dist relative à la passeuse)
        const rot1 = rotDepart['set1']?.[fdmeTeamKey] || [];
        const setterZoneIdx = setterNum ? rot1.indexOf(setterNum) : -1; // -1 si inconnue

        // Rôle DVW : 1=Libero, 2=Ailière, 3=Opposée, 4=Centrale, 5=Passeuse
        const dvwRole = (playerNum, isLibero) => {
            if (isLibero) return 1;
            if (!setterNum || setterZoneIdx < 0) return 2; // pas d'info passeuse
            if (playerNum == setterNum) return 5;
            const playerZoneIdx = rot1.indexOf(playerNum);
            if (playerZoneIdx < 0) return 2; // joueuse non dans rot1
            const dist = (playerZoneIdx - setterZoneIdx + 6) % 6;
            // Système 5-1 : passeuse(0), ailière(1), centrale(2), opposée(3), centrale(4+1=5→4), ailière(4)
            if (dist === 3) return 3; // opposée (diagonale de la passeuse)
            if (dist === 2 || dist === 4) return 4; // centrales (zones intercalées)
            return 2; // ailières (dist 1 et 5, adjacentes à passeuse/opposée)
        };

        joueuses.forEach((j, i) => {
            const num    = String(j.numero || 0).padStart(2, '0');
            const gIdx   = playerIndex[`${teamKey}_${j.numero}`] || (i + 1);
            const parts  = (j.nom || 'JOUEUR').split(' ');
            const nom    = parts.slice(-1)[0] || 'JOUEUR';
            const prenom = parts.slice(0, -1).join(' ') || '';
            const abbr   = `${nom.substring(0,3)}-${prenom.substring(0,3)}`;
            const pos    = j.libero ? 'L' : '';
            const role   = dvwRole(j.numero, j.libero);

            // Zone de départ pour chaque set (1-5) depuis fdmeData.rotationsDepart
            // rotDepart['set1'][fdmeTeamKey] = [numZone1, numZone2, ..., numZone6]
            // Titulaire → zone (1-6) | Remplaçante → '*' | Set non joué → vide
            const setZones = [];
            for (let s = 1; s <= 5; s++) {
                const rotSet = rotDepart['set' + s]?.[fdmeTeamKey];
                if (Array.isArray(rotSet) && rotSet.length === 6) {
                    const zoneIdx = rotSet.indexOf(j.numero);
                    setZones.push(zoneIdx >= 0 ? String(zoneIdx + 1) : '*');
                } else {
                    setZones.push('');
                }
            }

            lines.push(`${teamNum};${num};${gIdx};${setZones.join(';')};${abbr};${nom};${prenom};;${pos};${role};False;;;00000000;00000000;;;;`);
        });
        return lines.join('\r\n');
    },

    _sectionSet(match, rallies) {
        // Construire les scores par set depuis les rallies (ordre chronologique)
        const scoresBySet = {};
        (rallies || []).forEach(r => {
            if (!r.scoreApres) return;
            const sn = r.set || 1;
            if (!scoresBySet[sn]) scoresBySet[sn] = [];
            scoresBySet[sn].push({ h: r.scoreApres.pointsTeam1 || 0, v: r.scoreApres.pointsTeam2 || 0 });
        });

        // findJalon : premier score où une équipe atteint le jalon (= "True; 8- 5;...")
        const findJalon = (setScores, jalon) => {
            if (!setScores) return '';
            for (const s of setScores) {
                if (Math.max(s.h, s.v) >= jalon) {
                    return `${String(s.h).padStart(2,' ')}-${String(s.v).padStart(2,' ')}`;
                }
            }
            return '';
        };

        const sh    = Array.isArray(match.setHistory) ? match.setHistory : Object.values(match.setHistory || {});
        const lines = ['[3SET]'];
        for (let i = 0; i < 5; i++) {
            if (i < sh.length) {
                const set   = sh[i];
                const sn    = i + 1;
                const sc    = scoresBySet[sn] || [];
                const j8    = findJalon(sc, 8);
                const j16   = findJalon(sc, 16);
                const j21   = findJalon(sc, sn === 5 ? 10 : 21);
                const fin   = `${String(set.team1Points||0).padStart(2,' ')}-${String(set.team2Points||0).padStart(2,' ')}`;
                const perdu = String(Math.min(set.team1Points||0, set.team2Points||0));
                lines.push(`True;${j8};${j16};${j21};${fin};${perdu};`);
            } else {
                lines.push('True;;;;;;');
            }
        }
        return lines.join('\r\n');
    },

    // -------------------------------------------------------
    // SECTION ROTATION — présente si fdmeData + rotations calculées
    // -------------------------------------------------------
    _sectionRotation(rallies) {
        // N'inclure que les rallies qui ont des rotations calculées
        const withRot = (rallies || []).filter(r => r.rotationTeam1 && r.rotationTeam1.length === 6);
        if (withRot.length === 0) return '[3ROTATION]';

        const lines = ['[3ROTATION]'];
        withRot.forEach(r => {
            const sn   = r.set || 1;
            const h    = r.scoreAvant?.pointsTeam1 ?? 0;
            const v    = r.scoreAvant?.pointsTeam2 ?? 0;
            const rot1 = r.rotationTeam1.join(';');
            const rot2 = (r.rotationTeam2 || []).join(';');
            lines.push(`>>${r.index || 0};${sn};${h}-${v};${rot1};${rot2}`);
        });
        return lines.join('\r\n');
    },

    // Retourne la zone (1-6) d'un joueur dans son équipe pour un rally donné
    _getPlayerZoneForAction(action, rally) {
        const team = action.joueuse?.equipe || 'team1';
        const num  = parseInt(action.joueuse?.numero || 0);
        if (!num) return null;
        const rotation = team === 'team1' ? rally.rotationTeam1 : rally.rotationTeam2;
        if (!rotation || rotation.length !== 6) return null;
        const idx = rotation.indexOf(num);
        return idx === -1 ? null : (idx + 1); // Zone 1-6
    },

    // -------------------------------------------------------
    // SECTION SCOUT — cœur de l'algorithme
    // -------------------------------------------------------
    _sectionScout(match, rallies, playerActions, calcVS, dvwEdits, rotDepart, swapped) {
        const lines = ['[3SCOUT]'];
        dvwEdits = dvwEdits || {};

        // Grouper playerActions par rallyId
        const byRally = {};
        playerActions.forEach(a => {
            const rid = a.rallyId || '__none__';
            if (!byRally[rid]) byRally[rid] = [];
            byRally[rid].push(a);
        });

        const sh         = Array.isArray(match.setHistory) ? match.setHistory : Object.values(match.setHistory || {});
        const joueusesRaw = Array.isArray(match.joueuses)  ? match.joueuses   : Object.values(match.joueuses || {});
        let setActuel    = 0;

        rallies.forEach(rally => {
            const rid      = rally.rallyId || rally.id;
            const setRally = rally.set || 1;

            // ── Transition de set ──
            if (setRally > setActuel) {
                if (setActuel > 0) {
                    // Fin du set précédent : ligne *p + marqueur **Nset
                    const prevSet = sh[setActuel - 1];
                    if (prevSet) {
                        const tw = prevSet.winner === 'team1' ? '*' : 'a';
                        lines.push(`${tw}p${prevSet.team1Points||0}:${prevSet.team2Points||0};;;;;;00.00.00;${setActuel};1;1;1;0;;`);
                    }
                    lines.push(`**${setActuel}set`);
                }
                setActuel = setRally;

                // Lineups début de set : 4 lignes (server+zone team1, server+zone team2)
                // Format DVW : *P{srv}>LUp;;;;;;;{ts};{set};1;3;1;{vs};;{rot1x6};{rot2x6};
                const tsL = rally.timestampServe || 0;
                const tsLup = this._msToTs(tsL);
                const vsLup = calcVS(tsL);
                const fdmeT1 = swapped ? 'team2' : 'team1';
                const fdmeT2 = swapped ? 'team1' : 'team2';
                const rot1Arr = (rotDepart || {})['set' + setRally]?.[fdmeT1] || [];
                const rot2Arr = (rotDepart || {})['set' + setRally]?.[fdmeT2] || [];
                const rot1Str = rot1Arr.length === 6 ? rot1Arr.join(';') : '';
                const rot2Str = rot2Arr.length === 6 ? rot2Arr.join(';') : '';
                const rotSuffix = `;;${rot1Str};${rot2Str};`;

                // Zone 1 de chaque équipe = le serveur (index 0 du tableau de rotation)
                const srv1 = rot1Arr[0] ? String(rot1Arr[0]).padStart(2, '0') : '00';
                const srv2 = rot2Arr[0] ? String(rot2Arr[0]).padStart(2, '0') : '00';

                lines.push(`*P${srv1}>LUp;;;;;;;${tsLup};${setRally};1;3;1;${vsLup}${rotSuffix}`);
                lines.push(`*z1>LUp;;;;;;;${tsLup};${setRally};1;3;1;${vsLup}${rotSuffix}`);
                lines.push(`aP${srv2}>LUp;;;;;;;${tsLup};${setRally};1;3;1;${vsLup}${rotSuffix}`);
                lines.push(`az1>LUp;;;;;;;${tsLup};${setRally};1;3;1;${vsLup}${rotSuffix}`);
            }

            // ── Actions du rally ──
            const actionsRally    = (byRally[rid] || []).sort((a, b) => (a.timestamp||0) - (b.timestamp||0));
            const actionsFusionnees = this._fusionnerActions(actionsRally, rally);

            // Ligne de service automatique depuis servingPlayerNumber_computed (flux replay FDME)
            // Injectée seulement si aucun playerAction de type 'S' n'est déjà présent
            const serverNumRaw = parseInt(rally.servingPlayerNumber || rally.servingPlayerNumber_computed || 0);
            const hasServiceAction = actionsFusionnees.some(a => {
                const sk = this.SKILL_DVW[a.skill] || (a.skill||'').charAt(0).toUpperCase();
                return sk === 'S';
            });
            if (serverNumRaw > 0 && !hasServiceAction) {
                const srvTeam = (rally.servingTeam || 'team1');
                const srvPfx  = srvTeam === 'team2' ? 'a' : '*';
                const srvNum  = String(serverNumRaw).padStart(2, '0');
                const srvTs   = this._msToTs(rally.timestampServe);
                const srvVs   = calcVS(rally.timestampServe);
                // Injecter marqueur de rotation DataProject (*z{n} ou az{n}) quand disponible
                const rotN = srvTeam === 'team2' ? (rally.rotationNum2 || null) : (rally.rotationNum1 || null);
                if (rotN) lines.push(`${srvPfx}z${rotN}`);
                lines.push(`${srvPfx}${srvNum}SM+~~~;;;;;;${srvTs};${setRally};1;1;1;${srvVs};;`);
            }

            if (actionsFusionnees.length > 0) {
                // Niveau 2 : actions joueuses individuelles (numéro identifié)
                actionsFusionnees.forEach((action, pi) => {
                    const skillCode = ({'service':'S','attaque':'A','reception':'R','defense':'D','passe':'E','contre':'B','relance':'F'}[action.skill] || (action.skill||'A').charAt(0).toUpperCase());
                    const paTeam    = action.joueuse?.equipe || 'team1';
                    const qual      = action.quality || '#';
                    const aKey      = (rid + '__' + skillCode + '__' + qual + '__' + paTeam + '__' + pi).replace(/[.#$[\]]/g,'_');
                    const edit      = dvwEdits[aKey];
                    if (edit) {
                        (edit.before || []).forEach(l => { if (l.trim()) lines.push(l.trim()); });
                        const ligne = edit.line || this._ligneDvwAction(action, rally, calcVS);
                        if (ligne) lines.push(ligne);
                        (edit.after || []).forEach(l => { if (l.trim()) lines.push(l.trim()); });
                    } else {
                        const ligne = this._ligneDvwAction(action, rally, calcVS);
                        if (ligne) lines.push(ligne);
                    }
                });
            } else if (rally.actionFinale) {
                // Niveau 1bis : action finale sans numéro (joueur 00 ou $$)
                const ligne = this._ligneDvwActionFinale(rally, calcVS);
                if (ligne) lines.push(ligne);
            } else if (rally.pointTeam) {
                // Niveau 0 : score seul — ligne générique
                const eq = rally.pointTeam === 'team1' ? '*' : 'a';
                const ts = this._msToTs(rally.timestampPoint || rally.timestampServe);
                const vs = calcVS(rally.timestampPoint || rally.timestampServe);
                lines.push(`${eq}00AH#~~~;p;;;;;;${ts};${setRally};1;1;1;${vs};;`);
            }

            // ── Ligne *p après chaque rally (score après le point) ──
            if (rally.scoreApres && rally.pointTeam) {
                const h  = rally.scoreApres.pointsTeam1 || 0;
                const v  = rally.scoreApres.pointsTeam2 || 0;
                const tw = rally.pointTeam === 'team1' ? '*' : 'a';
                const ts = this._msToTs(rally.timestampPoint || rally.timestampServe);
                const vs = calcVS(rally.timestampPoint || rally.timestampServe);
                lines.push(`${tw}p${h}:${v};;;;;;${ts};${setRally};1;1;1;${vs};;`);
            }
        });

        // Fin du dernier set
        if (setActuel > 0) {
            const lastSet = sh[setActuel - 1];
            if (lastSet) {
                const tw = lastSet.winner === 'team1' ? '*' : 'a';
                lines.push(`${tw}p${lastSet.team1Points||0}:${lastSet.team2Points||0};;;;;;;00.00.00;${setActuel};1;1;1;0;;`);
            }
            lines.push(`**${setActuel}set`);
        }

        return lines.join('\r\n');
    },

    // Fusionne les actions du rally en appliquant les résolutions de conflits
    _fusionnerActions(actionsRally, rally) {
        if (!actionsRally || actionsRally.length === 0) return [];
        const seen   = {};
        const result = [];
        actionsRally.forEach(a => {
            const skill = this.SKILL_DVW[a.skill] || (a.skill || '').charAt(0).toUpperCase() || 'S';
            const team  = a.joueuse?.equipe || 'team1';
            const key   = `${rally.rallyId || rally.id}__${skill}__${a.quality}__${team}`;

            if (this._conflitsResolus[key] !== undefined) {
                // Conflit résolu → joueuse choisie par l'animateur uniquement
                if ((a.joueuse?.numero || 0) == this._conflitsResolus[key] && !seen[key]) {
                    seen[key] = true;
                    result.push(a);
                }
            } else if (!seen[key]) {
                // Pas de conflit → première occurrence
                seen[key] = true;
                result.push(a);
            }
        });
        return result;
    },

    // Convertit une action joueuse (Niveau 2) en ligne DVW complète
    _ligneDvwAction(action, rally, calcVS) {
        const eq    = action.joueuse?.equipe === 'team1' ? '*' : 'a';
        const num   = String(action.joueuse?.numero || 0).padStart(2, '0');
        const skill = this.SKILL_DVW[action.skill] || (action.skill||'').charAt(0).toUpperCase() || 'S';
        const qual  = action.quality || '~';
        const bt    = action.ballType || 'H'; // ball type saisi dans le popup 1bis
        const sn    = rally.set || action.set || 1;

        // Joueur $$ si faute sans numéro identifié
        const joueur  = (action.joueuse?.numero || 0) > 0 ? num : (qual === '=' ? '$$' : '00');
        // Zone de départ depuis la rotation (disponible en flux replay avec FDME)
        const zone = rally.rotationTeam1 ? this._getPlayerZoneForAction(action, rally) : null;
        const startZone = zone ? String(zone) : '~';
        const actCode = joueur === '$$'
            ? `${eq}${joueur}&${bt}${qual}${startZone}~~`
            : `${eq}${joueur}${skill}${bt}${qual}${startZone}~~`;

        // Modificateur ;p; si l'action a marqué le point
        const mod1 = this._estDecisive(action, rally) ? 'p' : '';

        const ts = this._msToTs(action.timestamp || rally.timestampServe);
        const vs = calcVS(action.timestamp || rally.timestampServe);
        return `${actCode};${mod1};;;;;;${ts};${sn};1;1;1;${vs};;`;
    },

    // Convertit une actionFinale (Niveau 1bis) en ligne DVW complète
    _ligneDvwActionFinale(rally, calcVS) {
        const af = rally.actionFinale;
        if (!af) return null;

        const eq    = af.team === 'team1' ? '*' : 'a';
        const skill = this.SKILL_DVW[af.dvwSkill] || af.dvwSkill || 'A';
        const qual  = af.dvwQuality || '#';
        const bt    = af.ballType || 'H'; // stocké si l'animateur a sélectionné le type de service
        const sn    = rally.set || 1;

        // Faute → $$ (erreur adverse), sinon 00 (joueur inconnu)
        const joueur  = qual === '=' ? '$$' : '00';
        const actCode = qual === '='
            ? `${eq}${joueur}&${bt}${qual}~~~`
            : `${eq}${joueur}${skill}${bt}${qual}~~~`;

        const ts = this._msToTs(rally.timestampPoint || rally.timestampServe);
        const vs = calcVS(rally.timestampPoint || rally.timestampServe);
        return `${actCode};p;;;;;;${ts};${sn};1;1;1;${vs};;`;
    },

    // Détermine si une action a marqué un point dans ce rally
    _estDecisive(action, rally) {
        if (!rally.pointTeam) return false;
        const q    = action.quality || '';
        const team = action.joueuse?.equipe;
        // Kill/Ace/Bloc de l'équipe qui gagne → point
        if (q === '#' && team === rally.pointTeam) return true;
        // Faute de l'équipe adverse → point pour l'autre
        if (q === '=' && team !== rally.pointTeam) return true;
        return false;
    },

    // Convertit un timestamp ms en "HH.MM.SS" (heure locale du scouteur)
    _msToTs(ms) {
        if (!ms) return '00.00.00';
        const d   = new Date(ms);
        const p   = n => String(n).padStart(2, '0');
        return `${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
    },

    // -------------------------------------------------------
    // TÉLÉCHARGEMENT
    // -------------------------------------------------------
    _telecharger(contenu, match) {
        const date = (match.date || '').replace(/-/g, '');
        const t1   = (match.team1?.name || 'DOM').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 10);
        const t2   = (match.team2?.name || 'ADV').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase().substring(0, 10);
        const nom  = `&${date}_${t1}_vs_${t2}.dvw`;
        // BOM UTF-8 pour compatibilité DataVolley
        const blob = new Blob(['\ufeff' + contenu], { type: 'text/plain;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = nom;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log('✅ Export DVW téléchargé :', nom);
    },

    // -------------------------------------------------------
    // UTILITAIRES UI
    // -------------------------------------------------------
    _afficherStatut(message, type = 'info') {
        console.log(`[Export DVW] ${message}`);
        const el = document.getElementById(this._statutElId || 'exportDvwStatut');
        if (!el) return;
        const c = { info: '#6366F1', succes: '#10B981', erreur: '#EF4444' };
        el.style.cssText = `display:block;padding:8px 14px;border-radius:6px;background:${c[type]||c.info};color:white;font-size:0.85rem;font-weight:600;margin-top:8px;`;
        el.textContent = message;
        if (type === 'succes' || type === 'erreur') {
            setTimeout(() => { el.style.display = 'none'; }, 5000);
        }
    },
};

window.exportDvw = exportDvw;
console.log('✅ Module Export DVW chargé');
