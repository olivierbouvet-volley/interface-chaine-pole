// ============================================================
// RAPPORT DE MATCH — Style LNV DataVolley
// Deux modes :
//   expert  → DVW scouting DataVolley professionnel (tous les skills)
//   basique → DVW généré par Interface Chaîne Pôle (S, A, R, B)
// Usage : window.rapportMatch.genererDepuisDvw(dvwText)
// ============================================================

(function () {

    const ROLE_LABEL = { 1: 'Libero', 2: 'Ailière', 3: 'Opposée', 4: 'Centrale', 5: 'Passeuse' };
    const ROT_ORDER  = [1, 6, 5, 4, 3, 2]; // ordre rotation à afficher

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
        return home + ' – ' + away;
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
            const pos = (f[12] || '').trim();
            const role = pos === 'L' ? 1 : (parseInt(f[13]) || 2);
            const setsPlayed = [f[3], f[4], f[5], f[6], f[7]]
                .map(s => (s || '').trim())
                .filter(s => s !== '' && s !== 'False');
            players.push({
                number: num,
                lastname: (f[9] || '').trim(),
                firstname: (f[10] || '').trim(),
                abbr: (f[8] || '').trim(),
                role,
                setsPlayedRaw: [f[3], f[4], f[5], f[6], f[7]].map(s => (s || '').trim()),
                team: side === 'H' ? 'home' : 'away'
            });
        }
        players.sort((a, b) => {
            if (a.role === 5 && b.role !== 5) return -1;
            if (b.role === 5 && a.role !== 5) return 1;
            if (a.role === 1 && b.role !== 1) return 1;
            if (b.role === 1 && a.role !== 1) return -1;
            return a.number - b.number;
        });
        return players;
    }

    // ─── Parsing sets avec scores partiels ───────────────────────────────────────

    function _parseSetDetails(text) {
        const section = _section(text, '3SET');
        const details = [];
        let n = 0;
        for (const raw of section.split('\n')) {
            const f = raw.trim().split(';').map(s => s.trim());
            if (f[0] !== 'True') continue;
            n++;
            const final = (f[4] || '').replace(/\s/g,'');
            if (!final.includes('-')) continue;
            const [hs, as_] = final.split('-').map(v => parseInt(v) || 0);
            if (hs === 0 && as_ === 0) continue;
            details.push({
                setNumber: n,
                homeScore: hs, awayScore: as_,
                winner: hs > as_ ? 'home' : 'away',
                t8:  (f[1] || '').replace(/\s/g, ''),
                t16: (f[2] || '').replace(/\s/g, ''),
                t21: (f[3] || '').replace(/\s/g, ''),
                duration: (f[5] || '').trim()
            });
        }
        return details;
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
            const parts = code.slice(2).split(':');
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

    // Stats équipe agrégées par set (pour les lignes de totaux)
    function _totauxParSet(actions, team, nbSets) {
        const sets = {};
        for (let i = 1; i <= nbSets; i++) {
            sets[i] = { srv:0, srvErr:0, srvAce:0, rec:0, recErr:0, recPos:0, recExc:0, att:0, attErr:0, attBlq:0, attKill:0, blcKill:0 };
        }
        for (const a of actions) {
            if (a.team !== team) continue;
            const s = sets[a.setNumber];
            if (!s) continue;
            if (a.skill === 'S') { s.srv++; if (a.quality==='=') s.srvErr++; if (a.quality==='#') s.srvAce++; }
            else if (a.skill === 'R') { s.rec++; if (a.quality==='=') s.recErr++; if (a.quality==='+'||a.quality==='#') s.recPos++; if (a.quality==='#') s.recExc++; }
            else if (a.skill === 'A') { s.att++; if (a.quality==='=') s.attErr++; if (a.quality==='/') s.attBlq++; if (a.quality==='#') s.attKill++; }
            else if (a.skill === 'B' && a.quality==='#') s.blcKill++;
        }
        return sets;
    }

    // ─── Vérifie rotation réelle ──────────────────────────────────────────────────

    function _hasRotationData(rotStats) {
        for (const side of ['home', 'away']) {
            for (const setNum of Object.keys(rotStats[side] || {})) {
                const rots = rotStats[side][setNum];
                for (let r = 2; r <= 6; r++) {
                    const d = rots[r];
                    if (d && (d.won > 0 || d.lost > 0)) return true;
                }
            }
        }
        return false;
    }

    // ─── Distribution par rotation ────────────────────────────────────────────────

    function _rotationStats(pointLines) {
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
            if (p.scorer === 'home') { res.home[s][rH].won++; res.away[s][rV].lost++; }
            else                     { res.home[s][rH].lost++; res.away[s][rV].won++; }
        }
        return res;
    }

    // ─── Sideout & Break ──────────────────────────────────────────────────────────

    function _sideout(actions) {
        const so = { home: { won: 0, total: 0 }, away: { won: 0, total: 0 } };
        let currentServer = null;
        let lastPtKey = null;
        for (const a of actions) {
            if (a.skill === 'S') currentServer = a.team;
            if (a.pointScored && currentServer !== null) {
                const ptKey = a.setNumber + '_' + a.videoSeconds;
                if (ptKey === lastPtKey) continue;
                lastPtKey = ptKey;
                const scorer = (a.quality === '=') ? (a.team === 'home' ? 'away' : 'home') : a.team;
                const receiving = currentServer === 'home' ? 'away' : 'home';
                so[receiving].total++;
                if (scorer === receiving) so[receiving].won++;
                currentServer = scorer;
            }
        }
        return so;
    }

    // ════════════════════════════════════════════════════════════════════════════
    // ─── GÉNÉRATION HTML — Style LNV ────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════════════

    function _css() { return `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 12px; color: #111; background: #fff; padding: 16px 20px 80px; }

/* ─── Header ─── */
.rapport-header { border: 2px solid #1a3668; margin-bottom: 10px; }
.rapport-titlebar { background: #1a3668; color: #fff; text-align: center; font-size: 1rem; font-weight: 900; letter-spacing: 3px; padding: 5px 0; }
.rapport-teams { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; gap: 8px; }
.rapport-team-name { font-size: 1.05rem; font-weight: 900; text-transform: uppercase; color: #1a3668; flex: 1; }
.rapport-team-name.home { text-align: right; }
.rapport-team-name.away { text-align: left; }
.rapport-score-box { background: #1a3668; color: #fff; font-size: 1.8rem; font-weight: 900; padding: 4px 20px; border-radius: 4px; letter-spacing: 4px; white-space: nowrap; }
.rapport-meta { background: #eef2fa; font-size: 0.72rem; text-align: center; padding: 3px 0; color: #555; border-top: 1px solid #c5d4f0; }

/* ─── Sets summary ─── */
.sets-summary { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 0.8rem; }
.sets-summary th { background: #1a3668; color: #fff; padding: 4px 8px; text-align: center; font-weight: 700; }
.sets-summary td { padding: 3px 8px; text-align: center; border-bottom: 1px solid #dde4f5; }
.sets-summary tr:nth-child(even) td { background: #f0f4fb; }
.sets-summary .score-final { font-weight: 900; font-size: 0.95rem; }
.sets-summary .winner-cell { background: #1a3668 !important; color: #fff; font-weight: 900; border-radius: 3px; }

/* ─── Mode badge ─── */
.mode-badge { display: inline-block; font-size: 0.7rem; padding: 2px 8px; border-radius: 3px; margin: 0 0 8px 0; }
.mode-expert  { background: #d1fae5; color: #065f46; }
.mode-basique { background: #fef3c7; color: #92400e; }
.mode-warn    { font-size: 0.68rem; color: #92400e; margin-left: 6px; }

/* ─── Team section ─── */
.team-section { margin-bottom: 12px; }
.team-section-header { background: #1a3668; color: #fff; font-weight: 900; font-size: 0.85rem; letter-spacing: 1px; padding: 4px 10px; text-transform: uppercase; }

/* ─── Stats table ─── */
.stats-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }
.stats-table th { background: #2a4d8f; color: #fff; padding: 4px 5px; text-align: center; font-weight: 700; white-space: nowrap; border: 1px solid #3a5da0; }
.stats-table th.th-name { text-align: left; }
.stats-table td { padding: 3px 5px; border: 1px solid #dde4f5; text-align: center; vertical-align: middle; }
.stats-table td.td-name { text-align: left; font-weight: 600; white-space: nowrap; }
.stats-table td.td-role { font-style: italic; color: #555; font-size: 0.7rem; }
.stats-table tr:nth-child(even) td { background: #f0f4fb; }
.stats-table tr:hover td { background: #dce8ff; }
.stats-table .row-inactive td { color: #bbb; }

/* Lignes totaux par set */
.stats-table .row-set-total td { background: #dce4f5 !important; font-weight: 700; border-top: 1px solid #a0b4d8; font-size: 0.72rem; color: #1a3668; }
.stats-table .row-grand-total td { background: #1a3668 !important; color: #fff !important; font-weight: 900; font-size: 0.78rem; border-top: 2px solid #0d2050; }

/* Badges sets joués */
.set-badges { display: flex; gap: 2px; justify-content: center; }
.set-badge { width: 14px; height: 14px; border-radius: 2px; font-size: 0.62rem; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.set-badge.played  { background: #1a3668; color: #fff; }
.set-badge.sub     { background: #7fa0d4; color: #fff; }
.set-badge.absent  { background: #e5e9f2; color: #aaa; }

/* G-P colonne */
.gp-pos { color: #15622f; font-weight: 700; }
.gp-neg { color: #8b1a1a; font-weight: 700; }
.gp-neu { color: #555; }

/* ─── Bloc bas (rotation + sideout côte à côte) ─── */
.bottom-row { display: flex; gap: 12px; margin-top: 10px; flex-wrap: wrap; }
.rotation-block { flex: 2; min-width: 280px; }
.sideout-block  { flex: 1; min-width: 180px; }

/* ─── Rotation table ─── */
.rot-title { background: #1a3668; color: #fff; font-weight: 900; font-size: 0.8rem; letter-spacing: 1px; padding: 4px 10px; text-transform: uppercase; }
.rot-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.rot-table th { background: #2a4d8f; color: #fff; padding: 4px 8px; text-align: center; font-weight: 700; border: 1px solid #3a5da0; }
.rot-table td { padding: 4px 8px; border: 1px solid #dde4f5; text-align: center; font-size: 0.8rem; }
.rot-table tr:nth-child(even) td { background: #f0f4fb; }
.rot-table .rot-label { font-weight: 900; background: #eef2fa; color: #1a3668; }
.rot-diff-pos { color: #15622f; font-weight: 900; }
.rot-diff-neg { color: #8b1a1a; font-weight: 900; }
.rot-diff-neu { color: #555; }
.rot-table .row-total td { background: #dce4f5 !important; font-weight: 700; border-top: 2px solid #a0b4d8; }

/* ─── Sideout table ─── */
.so-title { background: #1a3668; color: #fff; font-weight: 900; font-size: 0.8rem; letter-spacing: 1px; padding: 4px 10px; text-transform: uppercase; }
.so-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.so-table th { background: #2a4d8f; color: #fff; padding: 4px 8px; text-align: center; font-weight: 700; border: 1px solid #3a5da0; }
.so-table td { padding: 5px 8px; border: 1px solid #dde4f5; text-align: center; }
.so-table .so-pct { font-size: 1.2rem; font-weight: 900; color: #1a3668; }
.so-table .so-label { text-align: left; font-weight: 600; }

/* ─── Légende ─── */
.legend { position: fixed; bottom: 14px; right: 14px; background: #fff; border: 1px solid #c5d4f0; border-radius: 6px; padding: 8px 12px; font-size: 0.68rem; color: #333; box-shadow: 0 2px 8px rgba(26,54,104,0.15); max-width: 260px; z-index: 998; }
.legend h4 { font-size: 0.72rem; font-weight: 700; margin-bottom: 5px; color: #1a3668; }
.legend dl { display: grid; grid-template-columns: auto 1fr; gap: 1px 8px; }
.legend dt { font-weight: 700; white-space: nowrap; }
.legend dd { color: #555; margin: 0; }

/* ─── Bouton impression ─── */
.print-btn { position: fixed; top: 12px; right: 12px; background: #1a3668; color: #fff; border: none; padding: 7px 14px; border-radius: 4px; cursor: pointer; font-size: 0.82rem; font-weight: 700; z-index: 999; }
.print-btn:hover { background: #2a4d8f; }

@media print {
    .print-btn, .legend { display: none; }
    body { padding: 8px; font-size: 10px; }
    .bottom-row { flex-wrap: nowrap; }
    .team-section, .bottom-row { page-break-inside: avoid; }
}
`; }

    // ─── Badge sets joués ─────────────────────────────────────────────────────────

    function _badgeSets(setsPlayedRaw, nbSets) {
        let html = '<div class="set-badges">';
        for (let i = 0; i < nbSets; i++) {
            const v = (setsPlayedRaw[i] || '').trim();
            let cls = 'absent', label = i + 1;
            if (v === '*') cls = 'sub';
            else if (v !== '' && v !== 'False') cls = 'played';
            html += `<div class="set-badge ${cls}">${label}</div>`;
        }
        html += '</div>';
        return html;
    }

    // ─── Ligne de stats (réutilisée pour joueuse ET totaux) ──────────────────────

    function _cellStats(s, mode, hasActivity) {
        const d = (v) => hasActivity ? v : '-';
        const attEff = s.att ? Math.round((s.attKill - s.attErr - s.attBlq) / s.att * 100) + '%' : '-';
        const gp = (s.srvAce||0) + (s.attKill||0) + (s.blcKill||0) - (s.srvErr||0) - (s.attErr||0) - (s.attBlq||0);
        const gpStr = !hasActivity ? '-' : (gp > 0 ? `+${gp}` : String(gp));
        const gpCls = !hasActivity ? 'gp-neu' : (gp > 0 ? 'gp-pos' : gp < 0 ? 'gp-neg' : 'gp-neu');
        const tot   = (s.srvAce||0) + (s.attKill||0) + (s.blcKill||0);

        const srv = d(`${s.srv||0} / ${s.srvErr||0} / ${s.srvAce||0}`);
        let rec;
        if (!hasActivity) rec = '-';
        else if (mode === 'expert') rec = `${s.rec||0} / ${s.recErr||0} / ${_pct(s.recPos,s.rec)} / ${_pct(s.recExc,s.rec)}`;
        else rec = `${s.rec||0} / ${s.recErr||0} / ${_pct(s.recPos,s.rec)}`;
        const att   = d(`${s.att||0} / ${s.attErr||0} / ${s.attBlq||0} / ${s.attKill||0} (${attEff})`);
        const blc   = hasActivity ? (s.blcKill||0) : '-';

        return { gpStr, gpCls, tot: hasActivity ? tot : '-', srv, rec, att, blc };
    }

    // ─── Tableau par équipe ───────────────────────────────────────────────────────

    function _tableEquipe(players, statsMap, teamName, mode, actions, setScores) {
        const nbSets = setScores.length;
        const team   = players[0]?.team || 'home';
        const totaux = _totauxParSet(actions, team, nbSets);

        const recHeader = mode === 'expert'
            ? 'Réception<br><small>Tot/Err/Pos%/Exc%</small>'
            : 'Réception<br><small>Tot/Err/Pos%</small>';

        // ── Lignes joueuses ──
        const rowsJoueuses = players.map(p => {
            const s = statsMap[p.number] || {};
            const setsFromFdme    = p.setsPlayedRaw.filter(v => v && v !== 'False' && v !== '').length;
            const setsFromActions = s.setsIn ? s.setsIn.size : 0;
            const nbSetsJoues     = setsFromFdme > 0 ? setsFromFdme : setsFromActions;
            const hasActivity     = (s.srv||0)+(s.rec||0)+(s.att||0)+(s.blc||0) > 0;
            const absent          = !hasActivity && nbSetsJoues === 0;
            const c = _cellStats(s, mode, hasActivity);
            return `<tr class="${absent ? 'row-inactive' : ''}">
                <td style="width:28px">${p.number}</td>
                <td class="td-name">${p.lastname} ${p.firstname}</td>
                <td class="td-role">${ROLE_LABEL[p.role]||''}</td>
                <td>${_badgeSets(p.setsPlayedRaw, nbSets)}</td>
                <td>${hasActivity ? (s.srvAce||0)+(s.attKill||0)+(s.blcKill||0) : '-'}</td>
                <td class="${c.gpCls}">${c.gpStr}</td>
                <td>${c.srv}</td>
                <td>${c.rec}</td>
                <td>${c.att}</td>
                <td>${c.blc}</td>
            </tr>`;
        }).join('');

        // ── Lignes totaux par set ──
        const rowsTotaux = setScores.map(ss => {
            const t = totaux[ss.setNumber] || {};
            const hasAny = Object.values(t).some(v => v > 0);
            const c = _cellStats(t, mode, hasAny);
            const score = ss.winner === 'home'
                ? `<b>${ss.homeScore}</b>-${ss.awayScore}`
                : `${ss.homeScore}-<b>${ss.awayScore}</b>`;
            return `<tr class="row-set-total">
                <td colspan="2" style="text-align:left;padding-left:8px">Set ${ss.setNumber} — ${score}</td>
                <td></td><td></td>
                <td>${(t.srvAce||0)+(t.attKill||0)+(t.blcKill||0)||'-'}</td>
                <td>${c.gpStr !== '-' ? c.gpStr : ''}</td>
                <td>${c.srv}</td>
                <td>${c.rec}</td>
                <td>${c.att}</td>
                <td>${c.blc}</td>
            </tr>`;
        }).join('');

        // ── Grand total ──
        const grand = { srv:0, srvErr:0, srvAce:0, rec:0, recErr:0, recPos:0, recExc:0, att:0, attErr:0, attBlq:0, attKill:0, blcKill:0 };
        for (const t of Object.values(totaux)) {
            for (const k of Object.keys(grand)) grand[k] += (t[k]||0);
        }
        const hasGrand = Object.values(grand).some(v => v > 0);
        const cg = _cellStats(grand, mode, hasGrand);
        const rowGrand = `<tr class="row-grand-total">
            <td colspan="2" style="text-align:left;padding-left:8px">TOTAL</td>
            <td></td><td></td>
            <td>${(grand.srvAce+grand.attKill+grand.blcKill)||'-'}</td>
            <td class="${cg.gpCls}">${cg.gpStr}</td>
            <td>${cg.srv}</td>
            <td>${cg.rec}</td>
            <td>${cg.att}</td>
            <td>${cg.blc}</td>
        </tr>`;

        return `<div class="team-section">
            <div class="team-section-header">${teamName}</div>
            <table class="stats-table">
                <thead><tr>
                    <th>N°</th>
                    <th class="th-name">Nom Prénom</th>
                    <th>Rôle</th>
                    <th>Sets</th>
                    <th>Tot</th>
                    <th>G-P</th>
                    <th>Service<br><small>Tot/Err/Ace</small></th>
                    <th>${recHeader}</th>
                    <th>Attaque<br><small>Tot/Err/Blq/Kill(Eff%)</small></th>
                    <th>Blocs</th>
                </tr></thead>
                <tbody>
                    ${rowsJoueuses}
                    ${rowsTotaux}
                    ${rowGrand}
                </tbody>
            </table>
        </div>`;
    }

    // ─── Table sideout & break ────────────────────────────────────────────────────

    function _tableSideoutBreak(sideout, teams) {
        const rows = ['home', 'away'].map(side => {
            const t   = teams[side];
            const so  = sideout[side];
            const opp = side === 'home' ? 'away' : 'home';
            const brk = sideout[opp];
            const soPct  = _pct(so.won, so.total);
            const brkPct = brk.total ? _pct(brk.total - brk.won, brk.total) : '-';
            const soFreq = so.total ? (so.total / (so.won||1)).toFixed(2) : '-';
            return `<tr>
                <td class="so-label">${t}</td>
                <td class="so-pct">${soPct}</td>
                <td>${so.won} / ${so.total}</td>
                <td class="so-pct">${brkPct}</td>
            </tr>`;
        }).join('');
        return `<div>
            <div class="so-title">Efficacité Réception / Service</div>
            <table class="so-table">
                <thead><tr>
                    <th style="text-align:left">Équipe</th>
                    <th>Sideout%</th>
                    <th>Pts SO / Réc</th>
                    <th>Break%</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    }

    // ─── Table distribution rotations ────────────────────────────────────────────
    // Ordre : 1, 6, 5, 4, 3, 2

    function _tableRotations(rotStats, teams, setScores) {
        // Totaux toutes rotations par équipe
        const totH = {}, totV = {};
        ROT_ORDER.forEach(r => { totH[r] = {won:0,lost:0}; totV[r] = {won:0,lost:0}; });

        const setRows = setScores.map(ss => {
            const s  = ss.setNumber;
            const rdH = (rotStats.home[s] || {});
            const rdV = (rotStats.away[s] || {});
            const cols = ROT_ORDER.map(r => {
                const h = rdH[r]||{won:0,lost:0};
                const v = rdV[r]||{won:0,lost:0};
                const dH = h.won - h.lost;
                const dV = v.won - v.lost;
                totH[r].won += h.won; totH[r].lost += h.lost;
                totV[r].won += v.won; totV[r].lost += v.lost;
                const clsH = dH>0?'rot-diff-pos':dH<0?'rot-diff-neg':'rot-diff-neu';
                const clsV = dV>0?'rot-diff-pos':dV<0?'rot-diff-neg':'rot-diff-neu';
                return `<td class="${clsH}">${dH>0?'+':''}${dH}</td><td class="${clsV}">${dV>0?'+':''}${dV}</td>`;
            }).join('');
            const score = `${ss.homeScore}-${ss.awayScore}`;
            return `<tr><td class="rot-label">Set ${s} (${score})</td>${cols}</tr>`;
        }).join('');

        const totalCols = ROT_ORDER.map(r => {
            const dH = totH[r].won - totH[r].lost;
            const dV = totV[r].won - totV[r].lost;
            const cH = dH>0?'rot-diff-pos':dH<0?'rot-diff-neg':'rot-diff-neu';
            const cV = dV>0?'rot-diff-pos':dV<0?'rot-diff-neg':'rot-diff-neu';
            return `<td class="${cH}"><b>${dH>0?'+':''}${dH}</b></td><td class="${cV}"><b>${dV>0?'+':''}${dV}</b></td>`;
        }).join('');

        // En-tête colonnes : "Rot N" avec sous-colonnes H / V par équipe
        const headRotCols = ROT_ORDER.map(r =>
            `<th colspan="2">Rot ${r}</th>`
        ).join('');
        const headTeamCols = ROT_ORDER.map(() =>
            `<th style="background:#1a3668;font-size:0.65rem">${teams.home.substring(0,6)}</th>` +
            `<th style="background:#3a6faa;font-size:0.65rem">${teams.away.substring(0,6)}</th>`
        ).join('');

        return `<div class="rotation-block">
            <div class="rot-title">Distribution par rotation — G-P (Gagné – Perdu)</div>
            <table class="rot-table">
                <thead>
                    <tr><th rowspan="2">Set</th>${headRotCols}</tr>
                    <tr>${headTeamCols}</tr>
                </thead>
                <tbody>
                    ${setRows}
                    <tr class="row-total"><td class="rot-label">TOTAL</td>${totalCols}</tr>
                </tbody>
            </table>
            <p style="font-size:0.67rem;color:#666;margin-top:3px">Rot 1 = premier serveur · Rot 6→2 = rotations suivantes</p>
        </div>`;
    }

    // ─── Sets summary table ───────────────────────────────────────────────────────

    function _tableSets(setDetails, teams) {
        const rows = setDetails.map(ss => {
            const winH = ss.winner === 'home';
            return `<tr>
                <td style="font-weight:700">Set ${ss.setNumber}</td>
                <td>${ss.duration ? ss.duration + ' min' : '-'}</td>
                <td>${ss.t8  || '-'}</td>
                <td>${ss.t16 || '-'}</td>
                <td>${ss.t21 || '-'}</td>
                <td class="${winH?'winner-cell':''}">${ss.homeScore}</td>
                <td> – </td>
                <td class="${!winH?'winner-cell':''}">${ss.awayScore}</td>
            </tr>`;
        }).join('');
        const totH = setDetails.filter(s=>s.winner==='home').length;
        const totV = setDetails.filter(s=>s.winner==='away').length;
        return `<table class="sets-summary">
            <thead><tr>
                <th>Set</th><th>Durée</th><th>8 pts</th><th>16 pts</th><th>21 pts</th>
                <th colspan="3">${teams.home} &nbsp; Score &nbsp; ${teams.away}</th>
            </tr></thead>
            <tbody>
                ${rows}
                <tr style="background:#1a3668;color:#fff;font-weight:900">
                    <td colspan="5" style="text-align:right;padding-right:12px">RÉSULTAT FINAL</td>
                    <td style="font-size:1.2rem">${totH}</td><td>–</td><td style="font-size:1.2rem">${totV}</td>
                </tr>
            </tbody>
        </table>`;
    }

    // ─── Assemblage final ─────────────────────────────────────────────────────────

    function _genererHTML(data) {
        const { mode, teams, setScores, date, playersH, playersV, statsH, statsV, rotStats, sideout, actions } = data;
        const hasRotations = _hasRotationData(rotStats);
        const modeLabel = mode === 'expert' ? 'Rapport Expert — DataVolley' : 'Rapport Basique — Interface Chaîne Pôle';
        const modeClass = mode === 'expert' ? 'mode-expert' : 'mode-basique';
        const modeWarn  = mode === 'basique'
            ? `<span class="mode-warn">⚠ Réception/Défense/Passe non incluses${hasRotations ? '' : ' · Rotations : FDME requise'}</span>`
            : '';

        const headerScore = _scoreMatch(setScores);
        const competition = data.competition || '';

        const tableSets = _tableSets(setScores, teams);
        const tableH    = _tableEquipe(playersH, statsH, teams.home, mode, actions, setScores);
        const tableV    = _tableEquipe(playersV, statsV, teams.away, mode, actions, setScores);
        const tableSo   = _tableSideoutBreak(sideout, teams);
        const tableRot  = hasRotations ? _tableRotations(rotStats, teams, setScores) : '';

        return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Rapport — ${teams.home} vs ${teams.away}</title>
<style>${_css()}</style></head>
<body>
<button class="print-btn" onclick="window.print()">🖨 Imprimer</button>

<div class="rapport-header">
    <div class="rapport-titlebar">RAPPORT DE MATCH</div>
    <div class="rapport-teams">
        <div class="rapport-team-name home">${teams.home}</div>
        <div class="rapport-score-box">${headerScore}</div>
        <div class="rapport-team-name away">${teams.away}</div>
    </div>
    <div class="rapport-meta">${date}${competition ? ' · ' + competition : ''} &nbsp;|&nbsp; <span class="mode-badge ${modeClass}">${modeLabel}</span>${modeWarn}</div>
</div>

${tableSets}
${tableH}
${tableV}

<div class="bottom-row">
    ${tableRot}
    <div class="sideout-block">${tableSo}</div>
</div>

<div class="legend">
    <h4>📖 Légende</h4>
    <dl>
        <dt>Tot</dt><dd>Total actions</dd>
        <dt>G-P</dt><dd>Kills+Aces+Blocs − Erreurs</dd>
        <dt>Ace</dt><dd>Service gagnant direct</dd>
        <dt>Pos%</dt><dd>Réceptions ≥ positives ÷ total</dd>
        <dt>Exc%</dt><dd>Réceptions excellentes ÷ total</dd>
        <dt>Blq</dt><dd>Attaques bloquées adversaire</dd>
        <dt>Kill</dt><dd>Attaque gagnante directe</dd>
        <dt>Eff%</dt><dd>(Kill−Err−Blq) ÷ Total att</dd>
        <dt>SO%</dt><dd>Pts gagnés en réception ÷ total réc</dd>
        <dt>Brk%</dt><dd>Pts gagnés en service ÷ total srv</dd>
        <dt>Rot N</dt><dd>Position au moment du point</dd>
        <dt>G-P rot</dt><dd>Pts gagnés − Pts perdus dans cette rotation</dd>
    </dl>
</div>
</body></html>`;
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
        const { actions, teams } = window.dvwParserLite.parseDvwLite(text);
        const setScores = _parseSetDetails(text);  // parsing enrichi avec scores partiels

        const playersH = _parsePlayers(text, 'H');
        const playersV = _parsePlayers(text, 'V');

        const statsH = _statsJoueuses(actions, playersH, 'home');
        const statsV = _statsJoueuses(actions, playersV, 'away');

        const pointLines  = _parsePointLines(text);
        const rotStats    = _rotationStats(pointLines);
        const sideoutData = _sideout(actions);

        let date = '', competition = '';
        const matchLine = _section(text, '3MATCH').split('\n')[0] || '';
        const mf = matchLine.split(';');
        if (mf[0]) date = mf[0].trim();
        if (mf[3]) competition = mf[3].trim();

        const html = _genererHTML({
            mode, teams, setScores, date, competition,
            playersH, playersV, statsH, statsV,
            rotStats, sideout: sideoutData, actions
        });

        if (opts.returnHtml) return html;

        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); }
        else { alert('Popup bloquée — autorisez les popups pour ce site.'); }
        return html;
    }

    window.rapportMatch = { genererDepuisDvw };

})();
