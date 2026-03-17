// ============================================================
// RAPPORT DE MATCH — Style DataVolley
// Deux modes :
//   expert  → DVW scouting DataVolley professionnel (tous les skills)
//   basique → DVW généré par Interface Chaîne Pôle (S, A, R, B)
// Usage : window.rapportMatch.genererDepuisDvw(dvwText)
//         window.rapportMatch.genererDepuisDvw(dvwText, { titre: '...' })
// ============================================================

(function () {

    const ROLE_LABEL = { 1: 'Libero', 2: 'Ailière', 3: 'Opposée', 4: 'Centrale', 5: 'Passeuse' };

    // ─── Utilitaires ────────────────────────────────────────────────────────────

    function _section(text, name) {
        const marker = '[' + name + ']';
        const start = text.indexOf(marker);
        if (start === -1) return '';
        const ls = text.indexOf('\n', start) + 1;
        const next = text.indexOf('\n[3', ls);
        return next === -1 ? text.slice(ls) : text.slice(ls, next);
    }

    function _detectMode(text) {
        const m = text.match(/GENERATOR-PRG:\s*(.+)/);
        if (!m) return 'basique';
        return m[1].trim().toLowerCase().includes('data volley') ? 'expert' : 'basique';
    }

    function _pct(num, den) {
        if (!den) return '-';
        return Math.round(num / den * 100) + '%';
    }

    function _scoreMatch(setScores) {
        const home = setScores.filter(s => s.winner === 'home').length;
        const away = setScores.filter(s => s.winner === 'away').length;
        return home + ' - ' + away;
    }

    // ─── Parsing joueurs avec rôle ───────────────────────────────────────────────

    function _parsePlayers(text, side) {
        const players = [];
        const lines = _section(text, '3PLAYERS-' + side).split('\n');
        for (const raw of lines) {
            const f = raw.trim().split(';');
            if (f.length < 14) continue;
            const num = parseInt(f[1]);
            if (isNaN(num) || num <= 0) continue;
            const pos = (f[12] || '').trim();   // 'L' = libero
            const role = pos === 'L' ? 1 : (parseInt(f[13]) || 2);
            // sets joués : f[3..7] → '*' = titulaire, chiffre = entrant, '' = absent
            const setsPlayed = [f[3], f[4], f[5], f[6], f[7]]
                .map(s => (s || '').trim())
                .filter(s => s !== '' && s !== 'False');
            players.push({
                number: num,
                lastname: (f[9] || '').trim(),
                firstname: (f[10] || '').trim(),
                abbr: (f[8] || '').trim(),
                role,
                setsPlayedRaw: setsPlayed,
                team: side === 'H' ? 'home' : 'away'
            });
        }
        // Tri : passeuse en premier, puis libero, puis le reste par numéro
        players.sort((a, b) => {
            if (a.role === 5 && b.role !== 5) return -1;
            if (b.role === 5 && a.role !== 5) return 1;
            if (a.role === 1 && b.role !== 1) return 1;
            if (b.role === 1 && a.role !== 1) return -1;
            return a.number - b.number;
        });
        return players;
    }

    // ─── Parsing lignes *p / ap ──────────────────────────────────────────────────

    function _parsePointLines(text) {
        const points = [];
        const lines = _section(text, '3SCOUT').split('\n');
        for (const raw of lines) {
            const t = raw.trim();
            if (!t.startsWith('*p') && !t.startsWith('ap')) continue;
            const scorer = t.startsWith('*p') ? 'home' : 'away';
            const semiIdx = t.indexOf(';');
            const code = semiIdx === -1 ? t : t.slice(0, semiIdx);
            const scorePart = code.slice(2);
            const parts = scorePart.split(':');
            const homeScore = parseInt(parts[0]) || 0;
            const awayScore = parseInt(parts[1]) || 0;
            const f = t.split(';');
            const set = parseInt(f[8]) || 1;
            const rotHome = parseInt(f[9]) || 1;
            const rotAway = parseInt(f[10]) || 1;
            points.push({ scorer, homeScore, awayScore, set, rotHome, rotAway });
        }
        return points;
    }

    // ─── Stats par joueuse ────────────────────────────────────────────────────────

    function _statsJoueuses(actions, players, team) {
        const map = {};
        for (const p of players) {
            map[p.number] = {
                srv: 0, srvErr: 0, srvAce: 0,
                rec: 0, recErr: 0, recPos: 0, recExc: 0,
                att: 0, attErr: 0, attBlq: 0, attKill: 0,
                blc: 0, blcKill: 0,
                setsIn: new Set()
            };
        }
        for (const a of actions) {
            if (a.team !== team) continue;
            const s = map[a.playerNumber];
            if (!s) continue;
            s.setsIn.add(a.setNumber);
            if (a.skill === 'S') {
                s.srv++;
                if (a.quality === '=') s.srvErr++;
                if (a.quality === '#') s.srvAce++;
            } else if (a.skill === 'R') {
                s.rec++;
                if (a.quality === '=') s.recErr++;
                if (a.quality === '+' || a.quality === '#') s.recPos++;
                if (a.quality === '#') s.recExc++;
            } else if (a.skill === 'A') {
                s.att++;
                if (a.quality === '=') s.attErr++;
                if (a.quality === '/') s.attBlq++;
                if (a.quality === '#') s.attKill++;
            } else if (a.skill === 'B') {
                s.blc++;
                if (a.quality === '#') s.blcKill++;
            }
        }
        return map;
    }

    // ─── Distribution par rotation ────────────────────────────────────────────────

    function _rotationStats(pointLines) {
        // résultat : { home: { set: { rot: { won, lost } } }, away: { ... } }
        const res = { home: {}, away: {} };
        for (const p of pointLines) {
            const s = p.set;
            ['home', 'away'].forEach(side => {
                if (!res[side][s]) {
                    res[side][s] = {};
                    for (let r = 1; r <= 6; r++) res[side][s][r] = { won: 0, lost: 0 };
                }
            });
            const rH = Math.min(6, Math.max(1, p.rotHome));
            const rV = Math.min(6, Math.max(1, p.rotAway));
            if (p.scorer === 'home') {
                res.home[s][rH].won++;
                res.away[s][rV].lost++;
            } else {
                res.home[s][rH].lost++;
                res.away[s][rV].won++;
            }
        }
        return res;
    }

    // ─── Sideout & Break ──────────────────────────────────────────────────────────

    function _sideout(actions) {
        // sideout[team].won = rallies gagnés en réception
        // sideout[team].total = rallies joués en réception
        const so = { home: { won: 0, total: 0 }, away: { won: 0, total: 0 } };
        let currentServer = null;
        let lastPtKey = null;

        for (const a of actions) {
            if (a.skill === 'S') currentServer = a.team;
            if (a.pointScored && currentServer !== null) {
                const ptKey = a.setNumber + '_' + a.videoSeconds;
                if (ptKey === lastPtKey) continue; // dédoublonnage
                lastPtKey = ptKey;

                const scorer = (a.quality === '=')
                    ? (a.team === 'home' ? 'away' : 'home')
                    : a.team;
                const receiving = currentServer === 'home' ? 'away' : 'home';
                so[receiving].total++;
                if (scorer === receiving) so[receiving].won++;
                currentServer = scorer;
            }
        }
        return so;
    }

    // ─── Génération HTML ──────────────────────────────────────────────────────────

    function _tableJoueuses(players, statsMap, teamName, mode) {
        const rows = players.map(p => {
            const s = statsMap[p.number] || {};
            const sets = s.setsIn ? s.setsIn.size : 0;
            const attEff = s.att
                ? Math.round((s.attKill - s.attErr - s.attBlq) / s.att * 100) + '%'
                : '-';
            const recPctPos = _pct(s.recPos, s.rec);

            let srvCell = `${s.srv || 0} / ${s.srvErr || 0} / ${s.srvAce || 0}`;
            let recCell = mode === 'expert'
                ? `${s.rec || 0} / ${s.recErr || 0} / ${recPctPos} / ${_pct(s.recExc, s.rec)}`
                : `${s.rec || 0} / ${s.recErr || 0} / ${recPctPos}`;
            let attCell = `${s.att || 0} / ${s.attErr || 0} / ${s.attBlq || 0} / ${s.attKill || 0} (${attEff})`;
            let blcCell = s.blcKill || 0;

            const hasActivity = (s.srv || 0) + (s.rec || 0) + (s.att || 0) + (s.blc || 0) > 0;
            const rowClass = hasActivity ? '' : 'row-inactive';

            return `<tr class="${rowClass}">
                <td class="num">${p.number}</td>
                <td class="nom">${p.lastname} ${p.firstname}</td>
                <td class="role">${ROLE_LABEL[p.role] || ''}</td>
                <td class="center">${sets}</td>
                <td class="center">${srvCell}</td>
                <td class="center">${recCell}</td>
                <td class="center">${attCell}</td>
                <td class="center">${blcCell}</td>
            </tr>`;
        }).join('');

        const recHeader = mode === 'expert'
            ? 'Réception<br><small>Tot/Err/Pos%/Exc%</small>'
            : 'Réception<br><small>Tot/Err/Pos%</small>';

        return `<div class="section">
            <h2>${teamName}</h2>
            <table class="stats-table">
                <thead>
                    <tr>
                        <th class="num">N°</th>
                        <th>Nom Prénom</th>
                        <th>Rôle</th>
                        <th class="center">Sets</th>
                        <th class="center">Service<br><small>Tot/Err/Ace</small></th>
                        <th class="center">${recHeader}</th>
                        <th class="center">Attaque<br><small>Tot/Err/Blq/Kill (Eff%)</small></th>
                        <th class="center">Blocs</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    }

    function _tableSideout(sideout, teams) {
        const hSo = _pct(sideout.home.won, sideout.home.total);
        const vSo = _pct(sideout.away.won, sideout.away.total);
        const hBrk = _pct(sideout.away.total - sideout.away.won, sideout.away.total);
        const vBrk = _pct(sideout.home.total - sideout.home.won, sideout.home.total);

        return `<div class="section">
            <h2>Efficacité Service / Réception</h2>
            <table class="stats-table compact">
                <thead>
                    <tr>
                        <th>Équipe</th>
                        <th class="center">Sideout<br><small>(pts en réception)</small></th>
                        <th class="center">Break<br><small>(pts en service)</small></th>
                        <th class="center">Rallies en réception</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${teams.home}</td>
                        <td class="center big">${hSo}</td>
                        <td class="center big">${hBrk}</td>
                        <td class="center">${sideout.home.total}</td>
                    </tr>
                    <tr>
                        <td>${teams.away}</td>
                        <td class="center big">${vSo}</td>
                        <td class="center big">${vBrk}</td>
                        <td class="center">${sideout.away.total}</td>
                    </tr>
                </tbody>
            </table>
        </div>`;
    }

    function _tableRotation(rotStats, team, teamName, setScores) {
        const data = rotStats[team];
        if (!data || Object.keys(data).length === 0) return '';

        // Totaux toutes rotations
        const totWon = {};
        const totLost = {};
        for (let r = 1; r <= 6; r++) { totWon[r] = 0; totLost[r] = 0; }

        const setRows = setScores.map(ss => {
            const s = ss.setNumber;
            const rd = data[s];
            if (!rd) return '';
            const cells = Array.from({ length: 6 }, (_, i) => {
                const r = i + 1;
                const w = rd[r]?.won || 0;
                const l = rd[r]?.lost || 0;
                const diff = w - l;
                totWon[r] += w; totLost[r] += l;
                const cls = diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'neu';
                return `<td class="center ${cls}">${w}-${l}<br><small>${diff > 0 ? '+' : ''}${diff}</small></td>`;
            }).join('');
            return `<tr><td>Set ${s}</td>${cells}</tr>`;
        }).join('');

        const totalCells = Array.from({ length: 6 }, (_, i) => {
            const r = i + 1;
            const w = totWon[r]; const l = totLost[r];
            const diff = w - l;
            const cls = diff > 0 ? 'pos' : diff < 0 ? 'neg' : 'neu';
            return `<td class="center ${cls} bold">${w}-${l}<br><small>${diff > 0 ? '+' : ''}${diff}</small></td>`;
        }).join('');

        return `<div class="section">
            <h2>Distribution par rotation — ${teamName}</h2>
            <p class="hint">Lecture : points gagnés – points perdus dans chaque rotation (1 = position de service initiale)</p>
            <table class="stats-table compact">
                <thead>
                    <tr>
                        <th>Set</th>
                        <th class="center">Rot 1</th><th class="center">Rot 2</th>
                        <th class="center">Rot 3</th><th class="center">Rot 4</th>
                        <th class="center">Rot 5</th><th class="center">Rot 6</th>
                    </tr>
                </thead>
                <tbody>
                    ${setRows}
                    <tr class="total-row"><td>TOTAL</td>${totalCells}</tr>
                </tbody>
            </table>
        </div>`;
    }

    function _css() {
        return `
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111; background: #fff; padding: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #1a1a2e; padding-bottom: 12px; margin-bottom: 16px; }
        .header-center { text-align: center; }
        .match-score { font-size: 2.4rem; font-weight: 900; color: #1a1a2e; letter-spacing: 4px; }
        .team-name { font-size: 1rem; font-weight: 700; text-transform: uppercase; }
        .match-info { font-size: 0.78rem; color: #555; margin-top: 4px; }
        .sets-bar { display: flex; gap: 12px; justify-content: center; margin-bottom: 16px; }
        .set-chip { border: 1px solid #ccc; border-radius: 6px; padding: 4px 10px; font-size: 0.8rem; text-align: center; }
        .set-chip.winner-home { border-color: #1a1a2e; background: #eef; }
        .set-chip.winner-away { border-color: #1a1a2e; background: #fee; }
        .mode-badge { display: inline-block; font-size: 0.72rem; padding: 2px 8px; border-radius: 4px; margin-bottom: 12px; }
        .mode-expert { background: #d1fae5; color: #065f46; }
        .mode-basique { background: #fef3c7; color: #92400e; }
        .section { margin-bottom: 24px; }
        .section h2 { font-size: 0.9rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1a1a2e; border-left: 4px solid #1a1a2e; padding-left: 8px; margin-bottom: 8px; }
        .stats-table { width: 100%; border-collapse: collapse; }
        .stats-table th { background: #1a1a2e; color: #fff; padding: 6px 8px; font-size: 0.75rem; }
        .stats-table td { padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 0.8rem; }
        .stats-table tr:nth-child(even) td { background: #f9f9f9; }
        .stats-table tr:hover td { background: #eef4ff; }
        .num { width: 36px; }
        .nom { font-weight: 600; }
        .role { color: #555; font-style: italic; font-size: 0.75rem; }
        .center { text-align: center; }
        .big { font-size: 1.1rem; font-weight: 700; }
        .bold { font-weight: 700; }
        .compact td, .compact th { padding: 4px 8px; }
        .pos { color: #065f46; }
        .neg { color: #991b1b; }
        .neu { color: #555; }
        .total-row td { background: #f0f0f0 !important; font-weight: 700; border-top: 2px solid #ccc; }
        .row-inactive td { color: #bbb; }
        .hint { font-size: 0.72rem; color: #777; margin-bottom: 6px; }
        small { font-size: 0.7rem; opacity: 0.8; }
        .print-btn { position: fixed; top: 14px; right: 14px; background: #1a1a2e; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; z-index: 999; }
        .print-btn:hover { background: #2d2d6e; }
        .legend {
            position: fixed; bottom: 16px; right: 16px;
            background: #fff; border: 1px solid #ccc; border-radius: 8px;
            padding: 10px 14px; font-size: 0.72rem; color: #333;
            box-shadow: 0 2px 8px rgba(0,0,0,0.12); max-width: 280px; z-index: 998;
        }
        .legend h4 { font-size: 0.75rem; font-weight: 700; margin-bottom: 6px; color: #1a1a2e; }
        .legend dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
        .legend dt { font-weight: 700; white-space: nowrap; }
        .legend dd { color: #555; margin: 0; }
        @media print {
            .print-btn { display: none; }
            .legend { position: static; box-shadow: none; border: 1px solid #ccc; margin-top: 24px; }
            body { padding: 10px; font-size: 11px; }
            .section { page-break-inside: avoid; }
        }`;
    }

    function _genererHTML(data) {
        const { mode, teams, setScores, sideout, rotStats,
            playersH, playersV, statsH, statsV } = data;

        const scoreMatch = _scoreMatch(setScores);
        const modeLabel = mode === 'expert' ? 'Rapport Expert (DataVolley)' : 'Rapport Basique (Interface Chaîne Pôle)';
        const modeClass = mode === 'expert' ? 'mode-expert' : 'mode-basique';

        const setsChips = setScores.map(ss => {
            const cls = 'winner-' + ss.winner;
            return `<div class="set-chip ${cls}">
                <div style="font-size:0.7rem;color:#777">Set ${ss.setNumber}</div>
                <div style="font-weight:700">${ss.homeScore} – ${ss.awayScore}</div>
            </div>`;
        }).join('');

        const tableH = _tableJoueuses(playersH, statsH, teams.home, mode);
        const tableV = _tableJoueuses(playersV, statsV, teams.away, mode);
        const tableSo = _tableSideout(sideout, teams);

        // Rotation : masquée en mode basique (rotations toutes à 1)
        let tableRotH = '', tableRotV = '';
        if (mode === 'expert') {
            tableRotH = _tableRotation(rotStats, 'home', teams.home, setScores);
            tableRotV = _tableRotation(rotStats, 'away', teams.away, setScores);
        }

        return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Rapport de match — ${teams.home} vs ${teams.away}</title>
    <style>${_css()}</style>
</head>
<body>
    <button class="print-btn" onclick="window.print()">🖨 Imprimer</button>

    <div class="header">
        <div class="team-name" style="text-align:right;width:200px">${teams.home}</div>
        <div class="header-center">
            <div class="match-score">${scoreMatch}</div>
            <div class="match-info">${data.date || ''}</div>
        </div>
        <div class="team-name" style="width:200px">${teams.away}</div>
    </div>

    <div class="sets-bar">${setsChips}</div>
    <div style="text-align:center;margin-bottom:16px">
        <span class="mode-badge ${modeClass}">${modeLabel}</span>
        ${mode === 'basique' ? '<div style="font-size:0.72rem;color:#92400e">⚠ Réception/Défense/Passe non incluses — rotations non disponibles</div>' : ''}
    </div>

    ${tableH}
    ${tableV}
    ${tableSo}
    ${tableRotH}
    ${tableRotV}

    <div class="legend">
        <h4>📖 Légende des calculs</h4>
        <dl>
            <dt>Tot</dt><dd>Total d'actions</dd>
            <dt>Err</dt><dd>Erreurs directes (faute)</dd>
            <dt>Ace</dt><dd>Services gagnants directs</dd>
            <dt>Pos%</dt><dd>Réceptions positives ou excellentes ÷ total</dd>
            <dt>Exc%</dt><dd>Réceptions excellentes (parfaites) ÷ total</dd>
            <dt>Blq</dt><dd>Attaques bloquées par l'adversaire</dd>
            <dt>Kill</dt><dd>Attaques gagnantes directes</dd>
            <dt>Eff%</dt><dd>(Kills − Erreurs − Bloquées) ÷ Total attaques</dd>
            <dt>Sideout%</dt><dd>Points gagnés en réception ÷ rallies joués en réception</dd>
            <dt>Break%</dt><dd>Points gagnés en service ÷ rallies joués en service</dd>
            <dt>Rot 1–6</dt><dd>Rotation en cours au moment du point (DVW expert uniquement)</dd>
            <dt>W–L</dt><dd>Points gagnés – Points perdus dans cette rotation</dd>
        </dl>
    </div>
</body>
</html>`;
    }

    // ─── Point d'entrée public ────────────────────────────────────────────────────

    function genererDepuisDvw(dvwText, opts) {
        if (!window.dvwParserLite) {
            alert('dvwParserLite.js requis — incluez-le avant rapport-match.js');
            return null;
        }
        opts = opts || {};
        const text = dvwText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        const mode = _detectMode(text);
        const { players, actions, teams, setScores } = window.dvwParserLite.parseDvwLite(text);

        const playersH = _parsePlayers(text, 'H');
        const playersV = _parsePlayers(text, 'V');

        const statsH = _statsJoueuses(actions, playersH, 'home');
        const statsV = _statsJoueuses(actions, playersV, 'away');

        const pointLines = _parsePointLines(text);
        const rotStats = _rotationStats(pointLines);
        const sideoutData = _sideout(actions);

        // Date depuis [3MATCH]
        let date = '';
        const matchLine = _section(text, '3MATCH').split('\n')[0] || '';
        const datePart = (matchLine.split(';')[0] || '').trim();
        if (datePart) date = datePart;

        const html = _genererHTML({
            mode, teams, setScores, date,
            playersH, playersV, statsH, statsV,
            rotStats, sideout: sideoutData
        });

        if (opts.returnHtml) return html;

        const win = window.open('', '_blank');
        if (win) {
            win.document.write(html);
            win.document.close();
        } else {
            alert('Popup bloquée — autorisez les popups pour ce site.');
        }
        return html;
    }

    window.rapportMatch = { genererDepuisDvw };

})();
