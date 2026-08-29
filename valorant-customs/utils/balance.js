/**
 * ═══════════════════════════════════════════════════════════════════════
 *  ÉQUILIBRAGE DES ÉQUIPES PAR RANG
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Objectif : `force(Équipe 1) ≈ force(Équipe 2)`, jamais un simple
 * « joueur 1 → équipe 1, joueur 2 → équipe 2 ».
 *
 * Deux algorithmes, choisis selon la taille du lobby :
 *
 *   • **Exhaustif** (jusqu'à 16 joueurs) — on énumère toutes les répartitions
 *     possibles et on garde la meilleure. Pour un 5v5 c'est C(10,5) = 252
 *     combinaisons : le résultat est **optimal**, calculé en une fraction de
 *     milliseconde.
 *   • **Glouton + recherche locale** au-delà — tri par force décroissante,
 *     affectation à l'équipe la plus faible, puis échanges tant qu'ils
 *     réduisent l'écart. Sécurité pour un format exotique ; on ne l'atteint
 *     jamais avec les formats du bot.
 *
 * À égalité d'écart, on conserve la répartition qui déplace le MOINS de monde :
 * inutile de renvoyer tout le lobby dans l'autre équipe pour gagner 0 point.
 *
 * Les joueurs sans rang connu prennent la **médiane du lobby** : on ne leur
 * invente pas un rang, on les considère comme « un joueur moyen de cette
 * partie », ce qui est la seule hypothèse neutre.
 */

const EXHAUSTIVE_LIMIT = 16;

/** Médiane des forces connues (null si personne n'a de rang). */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * Table des forces, avec substitution des inconnus par la médiane du lobby.
 *
 * @param {string[]} playerIds
 * @param {(userId: string) => number|null} strengthOf
 * @returns {Map<string, number>}
 */
function strengthTable(playerIds, strengthOf) {
  const known = [];
  const raw = new Map();

  for (const userId of playerIds) {
    const value = strengthOf(userId);
    const usable = Number.isFinite(value) ? value : null;
    raw.set(userId, usable);
    if (usable !== null) known.push(usable);
  }

  // Aucun rang connu du tout : tout le monde à égalité, l'équilibrage devient
  // un simple partage en deux — c'est le comportement attendu.
  const fallback = median(known) ?? 1_000;
  return new Map([...raw].map(([userId, value]) => [userId, value ?? fallback]));
}

const sum = (ids, forces) => ids.reduce((total, id) => total + (forces.get(id) || 0), 0);

/** Nombre de joueurs qui restent dans leur équipe actuelle. */
function stability(team1, team2, previous) {
  let kept = 0;
  for (const id of team1) if (previous.get(id) === 1) kept += 1;
  for (const id of team2) if (previous.get(id) === 2) kept += 1;
  return kept;
}

// ─────────────────────────── ALGORITHMES ───────────────────────────

/** Énumération complète par masque de bits — optimal, ≤ 2^16 itérations. */
function exhaustive(players, forces, sizeA, previous) {
  const n = players.length;
  const total = 1 << n;
  let best = null;

  for (let mask = 0; mask < total; mask += 1) {
    // popcount : seules les combinaisons de la bonne taille nous intéressent.
    let bits = 0;
    for (let m = mask; m; m >>= 1) bits += m & 1;
    if (bits !== sizeA) continue;

    const team1 = [];
    const team2 = [];
    for (let i = 0; i < n; i += 1) (mask & (1 << i) ? team1 : team2).push(players[i]);

    const diff = Math.abs(sum(team1, forces) - sum(team2, forces));
    const kept = stability(team1, team2, previous);

    // Meilleur écart d'abord ; à écart égal, le moins de changements.
    if (!best || diff < best.diff || (diff === best.diff && kept > best.kept)) {
      best = { team1, team2, diff, kept };
    }
  }

  return best;
}

/** Glouton puis échanges améliorants — pour les lobbies hors normes. */
function greedy(players, forces, sizeA, sizeB) {
  const sorted = [...players].sort((a, b) => (forces.get(b) || 0) - (forces.get(a) || 0));
  const team1 = [];
  const team2 = [];

  for (const userId of sorted) {
    const canA = team1.length < sizeA;
    const canB = team2.length < sizeB;
    if (canA && (!canB || sum(team1, forces) <= sum(team2, forces))) team1.push(userId);
    else if (canB) team2.push(userId);
  }

  // Recherche locale : on échange deux joueurs tant que l'écart diminue.
  let improved = true;
  let guard = 0;
  while (improved && guard < 100) {
    improved = false;
    guard += 1;
    const diff = sum(team1, forces) - sum(team2, forces);

    for (let i = 0; i < team1.length; i += 1) {
      for (let j = 0; j < team2.length; j += 1) {
        const delta = forces.get(team2[j]) - forces.get(team1[i]);
        // Échanger déplace l'écart de 2×delta : on ne garde que ce qui rapproche de 0.
        if (Math.abs(diff + 2 * delta) < Math.abs(diff)) {
          [team1[i], team2[j]] = [team2[j], team1[i]];
          improved = true;
        }
      }
    }
  }

  return { team1, team2, diff: Math.abs(sum(team1, forces) - sum(team2, forces)) };
}

// ──────────────────────────── API PUBLIQUE ────────────────────────────

/**
 * Répartit les joueurs en deux équipes de forces comparables.
 *
 * @param {object} options
 * @param {string[]} options.team1     composition actuelle (pour la stabilité)
 * @param {string[]} options.team2
 * @param {number}   options.perTeam   capacité d'une équipe
 * @param {(userId: string) => number|null} options.strengthOf
 * @returns {{team1: string[], team2: string[], overflow: string[], diff: number,
 *            moved: number, forces: Map<string, number>}}
 */
function balanceTeams({ team1 = [], team2 = [], perTeam, strengthOf }) {
  const players = [...team1, ...team2];

  // Qui était où avant : sert à minimiser les déplacements à écart égal.
  const previous = new Map([
    ...team1.map((id) => [id, 1]),
    ...team2.map((id) => [id, 2]),
  ]);

  if (players.length < 2) {
    return { team1: [...team1], team2: [...team2], overflow: [], diff: 0, moved: 0, forces: new Map() };
  }

  const forces = strengthTable(players, strengthOf);

  // Lobby incomplet ou en surnombre : on borne à la capacité du format et le
  // surplus repart en liste d'attente — un équilibrage ne doit JAMAIS faire
  // disparaître un joueur.
  const capacity = perTeam * 2;
  const kept = players.slice(0, capacity);
  const overflow = players.slice(capacity);

  const sizeA = Math.min(Math.ceil(kept.length / 2), perTeam);
  const sizeB = kept.length - sizeA;

  const result = kept.length <= EXHAUSTIVE_LIMIT
    ? exhaustive(kept, forces, sizeA, previous)
    : greedy(kept, forces, sizeA, sizeB);

  const moved = kept.filter((id) => {
    const now = result.team1.includes(id) ? 1 : 2;
    return previous.has(id) && previous.get(id) !== now;
  }).length;

  return { team1: result.team1, team2: result.team2, overflow, diff: result.diff, moved, forces };
}

/**
 * Équipe dans laquelle inscrire le prochain arrivant : la moins remplie, et à
 * effectif égal la moins forte. Évite d'entasser tous les hauts rangs d'un côté
 * avant même l'équilibrage final.
 *
 * @returns {1|2|null} null si les deux équipes sont pleines.
 */
function suggestTeam({ team1, team2, perTeam, strengthOf, newcomer }) {
  const room1 = team1.length < perTeam;
  const room2 = team2.length < perTeam;
  if (!room1 && !room2) return null;
  if (room1 !== room2) return room1 ? 1 : 2;
  if (team1.length !== team2.length) return team1.length < team2.length ? 1 : 2;

  const forces = strengthTable([...team1, ...team2, newcomer].filter(Boolean), strengthOf);
  return sum(team1, forces) <= sum(team2, forces) ? 1 : 2;
}

module.exports = { balanceTeams, suggestTeam, strengthTable, median };
