#!/bin/bash
# Déploiement automatique SANS clé ni secret, pour le VPS.
#
# Pourquoi ce script existe alors que .github/workflows/deploy.yml fait déjà le
# travail : ce workflow-là pousse depuis GitHub vers le VPS, ce qui exige une
# clé SSH privée déposée dans les secrets du dépôt. Copier cette clé demande un
# copier-coller — impossible depuis la console web d'un téléphone. Ici, c'est
# le VPS qui va CHERCHER les nouvelles versions : rien à copier, rien à
# confier à GitHub.
#
# Deux usages :
#   bash scripts/autodeploy.sh --install   installe la tâche planifiée
#   bash scripts/autodeploy.sh             fait une vérification (appelé par cron)
set -uo pipefail

DOSSIER=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
APP=${AUTODEPLOY_APP:-discord-bot}
BRANCHE=${AUTODEPLOY_BRANCHE:-main}
JOURNAL=${AUTODEPLOY_LOG:-/var/log/autodeploy-bot.log}

dire() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Toutes les MINUTES : c'est le plus court que cron accepte. Le script sort
# immédiatement quand rien n'a bougé (un `git fetch` sur ce dépôt ne coûte que
# quelques kilo-octets), donc la fréquence ne pèse ni sur le droplet ni sur le
# réseau. Pour du vraiment instantané il faudrait un webhook, donc un port
# ouvert sur la machine — un compromis qui ne vaut pas la minute gagnée.
LIGNE="* * * * * bash $DOSSIER/scripts/autodeploy.sh >> $JOURNAL 2>&1"

poser_tache() {
  # Le crontab actuel est lu ENTIÈREMENT avant d'écrire quoi que ce soit.
  # `(crontab -l; echo ...) | crontab -` semble équivalent mais les deux côtés
  # du tuyau démarrent en même temps : l'écriture peut vider le fichier avant
  # que la lecture ne l'ait parcouru, et les AUTRES tâches planifiées de la
  # machine disparaissent. C'est arrivé au banc d'essai.
  ACTUEL=$(crontab -l 2>/dev/null | grep -v "autodeploy.sh" || true)
  # La ligne existante est retirée puis réécrite : relancer l'installation ne
  # doit pas empiler dix fois la même tâche.
  if [ -n "$ACTUEL" ]; then
    printf '%s\n%s\n' "$ACTUEL" "$LIGNE" | crontab -
  else
    printf '%s\n' "$LIGNE" | crontab -
  fi
}

# --- Installation de la tâche planifiée ---
if [ "${1:-}" = "--install" ]; then
  poser_tache
  dire "Tâche installée : vérification toutes les minutes."
  dire "Journal : $JOURNAL"
  crontab -l | grep autodeploy
  exit 0
fi

# --- Vérification périodique ---
cd "$DOSSIER" || { dire "Dossier introuvable : $DOSSIER"; exit 1; }

# La tâche planifiée se corrige elle-même si sa ligne a changé (fréquence,
# chemin…). Sans ça, modifier l'intervalle obligerait à retourner taper une
# commande sur le serveur — or le seul accès est une console de téléphone sans
# copier-coller. Le nouveau réglage arrive donc avec le code, tout seul.
if crontab -l 2>/dev/null | grep -q "autodeploy.sh"; then
  if ! crontab -l 2>/dev/null | grep -qxF "$LIGNE"; then
    poser_tache
    dire "Tâche planifiée mise à jour : $LIGNE"
  fi
fi

git fetch --quiet origin "$BRANCHE" || { dire "git fetch a échoué (réseau ?)"; exit 0; }
AVANT=$(git rev-parse HEAD)
CIBLE=$(git rev-parse "origin/$BRANCHE")
# Rien de neuf : on sort en silence. Sans ce test, le bot redémarrerait toutes
# les 5 minutes pour rien, coupant la musique en cours à chaque fois.
[ "$AVANT" = "$CIBLE" ] && exit 0

dire "Nouvelle version : ${AVANT:0:7} -> ${CIBLE:0:7}"
git reset --hard --quiet "$CIBLE" || { dire "reset impossible"; exit 1; }

# Dépendances réinstallées seulement si elles ont bougé (droplet à 512 Mo).
# `npm install` et pas `npm ci` : `ci` efface node_modules d'abord, un échec à
# mi-chemin laisserait le bot sans ses modules.
if ! git diff --quiet "$AVANT" "$CIBLE" -- package.json package-lock.json; then
  dire "Dépendances modifiées, installation…"
  npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || dire "npm install a signalé une erreur"
fi

pm2 restart "$APP" --update-env >/dev/null 2>&1 || { dire "pm2 restart a échoué"; exit 1; }
# Laisse un plantage au démarrage se manifester : un process qui meurt à la
# première ligne d'index.js apparaîtrait "online" une fraction de seconde.
sleep 12

etat() {
  pm2 jlist 2>/dev/null | APP="$APP" node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d).find(x=>x.name===process.env.APP);console.log(a?a.pm2_env.status:"absent")}catch{console.log("illisible")}})'
}
STATUT=$(etat)

if [ "$STATUT" = "online" ]; then
  dire "Déployé : ${CIBLE:0:7} en ligne."
  exit 0
fi

# RETOUR ARRIÈRE. C'est la raison d'être de ce script : personne ne surveille
# ces déploiements. Laisser le bot mort jusqu'à ce que quelqu'un s'en aperçoive
# serait pire que de ne pas déployer du tout.
dire "Le bot ne redémarre pas ($STATUT) — retour à ${AVANT:0:7}."
pm2 logs "$APP" --lines 20 --nostream 2>&1 | tail -20
git reset --hard --quiet "$AVANT"
npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1
pm2 restart "$APP" --update-env >/dev/null 2>&1
sleep 10
dire "Après retour arrière : $(etat)"
exit 1
