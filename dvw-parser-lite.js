// ============================================
// DVW PARSER LITE — DataVolley minimal pour replay
// Extrait joueurs + actions du format .dvw
// Usage : window.dvwParserLite.parseDvwLite(text)
//
// Structure d'une ligne scout DVW (confirmée par VolleyVision) :
// [0]   = code action (ex: "*17AH#V5...")
// [1-6] = modificateurs (s, r, p ou vide)
// [7]   = timestamp HH.MM.SS (optionnel, absent = vide)
// [8]   = numéro de set
// [9]   = rotation équipe domicile (1-6)
// [10]  = rotation équipe extérieur (1-6)
// [11]  = toujours 1
// [12]  = secondes vidéo directes (temps exact dans la vidéo, enregistré par DataVolley)
// [13]  = vide
// [14-19] = positions joueurs domicile
// [20-25] = positions joueurs extérieur
// NOTE : les scores ne sont PAS dans les lignes scout, uniquement dans [3SET]
// ============================================

const SKILL_LABELS = {
    'S': 'Service',
    'R': 'Réception',
    'E': 'Passe',
    'A': 'Attaque',
    'B': 'Bloc',
    'D': 'Défense',
    'F': 'Balle libre'
};

const QUALITY_LABELS = {
    '#': 'Kill / Ace',
    '+': 'Positif',
    '!': 'Neutre',
    '-': 'Négatif',
    '/': 'Bloqué',
    '=': 'Faute'
};

const QUALITY_COLORS = {
    '#': '#10b981',  // vert
    '+': '#6366f1',  // violet
    '!': '#f59e0b',  // orange
    '-': '#ef4444',  // rouge clair
    '/': '#dc2626',  // rouge
    '=': '#991b1b'   // rouge foncé
};

// ──────────────────────────────────────────
// Utilitaires internes
// ──────────────────────────────────────────

// Extrait une section [3NOM] du texte DVW
function getSection(text, sectionName) {
    const marker = '[' + sectionName + ']';
    const start = text.indexOf(marker);
    if (start === -1) return '';
    const lineStart = text.indexOf('\n', start) + 1;
    const nextSection = text.indexOf('\n[3', lineStart);
    return nextSection === -1 ? text.slice(lineStart) : text.slice(lineStart, nextSection);
}

// Convertit "HH.MM.SS" → secondes depuis minuit
function parseTimestampToSeconds(ts) {
    if (!ts || typeof ts !== 'string') return null;
    const parts = ts.split('.');
    if (parts.length < 3) return null;
    const h = parseInt(parts[0]);
    const m = parseInt(parts[1]);
    const s = parseInt(parts[2]);
    if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
    return h * 3600 + m * 60 + s;
}

// ──────────────────────────────────────────
// Parsing scores de sets [3SET]
// ──────────────────────────────────────────

// Lit les scores de sets depuis [3SET]
// Format DataVolley réel : True; [T8]; [T16]; [T21]; [score_final]; ...
// Le score final est en fields[4] au format "homeScore-awayScore"
function parseSetScores(text) {
    const section = getSection(text, '3SET');
    const lines = section.split('\n').filter(l => l.trim());
    const sets = [];
    let setNum = 0;
    for (const line of lines) {
        setNum++;
        const fields = line.split(';').map(f => f.trim());
        if (fields[0] !== 'True') continue;

        // fields[4] = score final format "X-Y" ou " X- Y"
        const finalScoreStr = (fields[4] || '').replace(/\s/g, '');
        if (!finalScoreStr || !finalScoreStr.includes('-')) continue;

        const parts = finalScoreStr.split('-').map(s => parseInt(s, 10));
        if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) continue;
        const [homeScore, awayScore] = parts;
        if (homeScore === 0 && awayScore === 0) continue;

        sets.push({
            setNumber: setNum,
            homeScore,
            awayScore,
            winner: homeScore > awayScore ? 'home' : 'away'
        });
    }
    return sets;
}

// ──────────────────────────────────────────
// Parsing joueurs
// ──────────────────────────────────────────

// Lit une ligne de [3PLAYERS-H] ou [3PLAYERS-V]
// Format : team;numero;id;;;...;shortname;lastname;firstname;...
function parsePlayerLine(line, team) {
    const fields = line.split(';');
    if (fields.length < 11) return null;
    const number = parseInt(fields[1]);
    if (isNaN(number) || number <= 0) return null;
    const lastname = (fields[9] || '').trim();
    const firstname = (fields[10] || '').trim();
    const name = (firstname + ' ' + lastname).trim() || lastname || ('N°' + number);
    return { number, name, team };
}

// Lit les équipes depuis [3TEAMS] → { home: 'Nom Equipe 1', away: 'Nom Equipe 2' }
function parseTeams(text) {
    const section = getSection(text, '3TEAMS');
    const lines = section.split('\n').filter(l => l.trim());
    const teams = { home: 'Équipe A', away: 'Équipe B' };
    if (lines.length >= 1) {
        const f = lines[0].split(';');
        teams.home = f[1] || teams.home;
    }
    if (lines.length >= 2) {
        const f = lines[1].split(';');
        teams.away = f[1] || teams.away;
    }
    return teams;
}

// Lit tous les joueurs des sections [3PLAYERS-H] et [3PLAYERS-V]
function parsePlayers(text) {
    const players = [];
    const homeLines = getSection(text, '3PLAYERS-H').split('\n');
    const awayLines = getSection(text, '3PLAYERS-V').split('\n');

    for (const line of homeLines) {
        const p = parsePlayerLine(line.trim(), 'home');
        if (p) players.push(p);
    }
    for (const line of awayLines) {
        const p = parsePlayerLine(line.trim(), 'away');
        if (p) players.push(p);
    }
    return players;
}

// ──────────────────────────────────────────
// Parsing actions [3SCOUT]
// ──────────────────────────────────────────

// Décode une ligne scout DVW
// Structure confirmée par VolleyVision meta-parser.ts :
//   f[0]  = code action
//   f[1-6]= modificateurs
//   f[7]  = timestamp HH.MM.SS (horloge murale, optionnel)
//   f[8]  = numéro de set
//   f[12] = secondes vidéo directes (enregistrées par DataVolley — c'est CE champ qui sert pour le seek)
function parseScoutLine(line) {
    if (!line || line.length < 6) return null;

    // Indicateur d'équipe : * = domicile, a = extérieur
    const teamCode = line[0];
    let team;
    if (teamCode === '*') team = 'home';
    else if (teamCode === 'a') team = 'away';
    else return null; // ligne de marqueur ou vide

    // Numéro de joueur : chars 1-2 (toujours 2 chiffres, ex: "09", "13", "00")
    const playerStr = line.substring(1, 3);
    const playerNumber = parseInt(playerStr);
    // playerNumber = 0 est autorisé : service exporté sans serveur connu (*00SM/~~~)
    if (isNaN(playerNumber) || playerNumber < 0) return null;

    // Skill : char 3
    const skill = line[3];
    if (!SKILL_LABELS[skill]) return null; // pas une action de jeu

    // Quality : char 5 (char 4 = sous-type hauteur H/U/M/...)
    const quality = line[5] || '';

    // Code de combinaison pour les attaques : chars 6-7
    let comboCode = null;
    if (skill === 'A' && line.length > 7) {
        const candidate = line.substring(6, 8);
        if (/^[A-Z][A-Z0-9]$/.test(candidate)) {
            comboCode = candidate;
        }
    }

    // Métadonnées : split par ";" → champs indexés
    const fields = line.split(';');
    // Détection du format :
    // - Nouveau format (corrigé) : f[7]=timestamp HH.MM.SS, f[8]=set, f[12]=videoSeconds
    // - Ancien format (bug export) : f[8]=timestamp, f[9]=set, f[13]=videoSeconds
    // Heuristique : si f[8] contient un point, c'est un timestamp → ancien format
    const isOldFormat = (fields[8] || '').includes('.');
    const setNumber = isOldFormat ? (parseInt(fields[9]) || 1) : (parseInt(fields[8]) || 1);
    const videoSecondsStr = isOldFormat ? (fields[13] || '').trim() : (fields[12] || '').trim();
    const videoSeconds = videoSecondsStr ? parseInt(videoSecondsStr, 10) : null;

    // Modificateur "p" dans f[1-6] = point marqué sur cette action
    let pointScored = false;
    for (let i = 1; i <= 6; i++) {
        const mod = (fields[i] || '').trim().toLowerCase();
        if (mod === 'p') { pointScored = true; break; }
    }

    return {
        team,
        playerNumber,
        isGeneric: playerNumber === 0, // service sans numéro de serveur connu
        skill,
        quality,
        comboCode,
        videoSeconds,  // secondes depuis le début de la vidéo (f[12], direct DataVolley)
        setNumber,
        pointScored,   // true si un point a été marqué sur cette action (modificateur "p")
        // Scores calculés après parsing (dans parseDvwLite)
        homeScore: null,
        awayScore: null
    };
}

// ──────────────────────────────────────────
// Fonction principale
// ──────────────────────────────────────────

/**
 * Parse un fichier DVW (texte brut) et retourne joueurs + actions
 * @param {string} text - Contenu complet du fichier .dvw
 * @returns {{ players: Array, actions: Array, teams: Object, setScores: Array, hasVideoTimestamps: boolean }}
 */
function parseDvwLite(text) {
    // Normaliser les fins de ligne
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const teams = parseTeams(normalized);
    const players = parsePlayers(normalized);
    const setScores = parseSetScores(normalized);
    const actions = [];

    const scoutSection = getSection(normalized, '3SCOUT');
    const scoutLines = scoutSection.split('\n');

    for (const line of scoutLines) {
        const action = parseScoutLine(line.trim());
        if (!action) continue;
        actions.push(action);
    }

    // Calcul des scores courants par set (basé sur le modificateur "p")
    // IMPORTANT : DataVolley enregistre souvent "p" sur PLUSIEURS actions du même échange
    // (ex: ace S# + erreur R= ont tous deux "p" avec le même videoSeconds).
    // → Déduplication par (setNumber, videoSeconds) : on ne compte qu'UN point par échange.
    const runningScores = {}; // { setNumber: { home: 0, away: 0 } }
    const countedRallies = new Set(); // clés déjà comptées : "sn_videoSeconds"
    let noTimeIdx = 0; // compteur pour les actions sans timestamp vidéo valide

    for (const action of actions) {
        const sn = action.setNumber;
        if (!runningScores[sn]) runningScores[sn] = { home: 0, away: 0 };
        const sc = runningScores[sn];

        // Score AVANT cette action
        action.homeScore = sc.home;
        action.awayScore = sc.away;

        if (action.pointScored) {
            // Clé unique pour cet échange : préférer videoSeconds (fiable), sinon index auto
            const rallyKey = sn + '_' + (action.videoSeconds != null && action.videoSeconds > 0
                ? action.videoSeconds
                : 'notime_' + (noTimeIdx++));
            if (!countedRallies.has(rallyKey)) {
                countedRallies.add(rallyKey);
                if (action.quality === '=') {
                    // Faute → l'adversaire marque
                    if (action.team === 'home') sc.away++;
                    else sc.home++;
                } else {
                    // Kill / Ace / Bloc gagnant → l'équipe qui agit marque
                    if (action.team === 'home') sc.home++;
                    else sc.away++;
                }
            }
        }
    }

    // hasVideoTimestamps = au moins une action a un temps vidéo valide (f[12] > 0)
    const hasVideoTimestamps = actions.some(a => a.videoSeconds !== null && a.videoSeconds > 0);
    return { players, actions, teams, setScores, hasVideoTimestamps };
}

// ──────────────────────────────────────────
// Fonctions utilitaires exportées
// ──────────────────────────────────────────

/**
 * Filtre les actions selon des critères
 * @param {Array} actions
 * @param {{ playerNumbers?: number[], skills?: string[], qualities?: string[] }} criteria
 * @returns {Array}
 */
function filterActions(actions, criteria = {}) {
    const { playerNumbers, skills, qualities } = criteria;
    return actions.filter(action => {
        if (playerNumbers && playerNumbers.length > 0 && !playerNumbers.includes(action.playerNumber)) return false;
        if (skills && skills.length > 0 && !skills.includes(action.skill)) return false;
        if (qualities && qualities.length > 0 && !qualities.includes(action.quality)) return false;
        return true;
    });
}

/**
 * Retourne le temps vidéo pour une action (secondes depuis le début de la vidéo)
 * DataVolley enregistre le temps vidéo exact en f[12] lors du scouting → aucune calibration nécessaire.
 * @param {Object} action - Action avec videoSeconds
 * @param {number} offsetSeconds - Fine-tuning optionnel (défaut 0)
 * @returns {number|null}
 */
function actionToVideoTime(action, offsetSeconds = 0) {
    if (action.videoSeconds === null || action.videoSeconds === undefined) return null;
    if (action.videoSeconds <= 0) return null;
    return Math.max(0, action.videoSeconds + offsetSeconds);
}

/**
 * Trouve un joueur par son numéro
 * @param {Array} players
 * @param {number} number
 * @param {string|null} team - 'home', 'away', ou null pour chercher dans les deux
 * @returns {Object|null}
 */
function findPlayer(players, number, team = null) {
    return players.find(p => p.number === number && (team === null || p.team === team)) || null;
}

/**
 * Formate un label lisible pour une action
 * @param {Object} action
 * @param {Array} players
 * @returns {string}
 */
function formatActionLabel(action, players) {
    const player = findPlayer(players, action.playerNumber, action.team);
    const playerName = player ? player.name : ('N°' + action.playerNumber);
    const skillLabel = SKILL_LABELS[action.skill] || action.skill;
    const qualityLabel = QUALITY_LABELS[action.quality] || '';
    const combo = action.comboCode ? ' (' + action.comboCode + ')' : '';
    return `Set ${action.setNumber} — ${playerName} — ${skillLabel}${combo} ${qualityLabel}`;
}

// Export global pour les pages vanilla JS
window.dvwParserLite = {
    parseDvwLite,
    parseSetScores,
    filterActions,
    actionToVideoTime,
    findPlayer,
    formatActionLabel,
    SKILL_LABELS,
    QUALITY_LABELS,
    QUALITY_COLORS
};
