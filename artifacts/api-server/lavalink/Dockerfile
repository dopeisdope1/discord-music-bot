# Nœud Lavalink privé du bot, pour ne plus dépendre des nœuds publics
# gratuits (qui limitent le nombre de connexions par bot et coupent la
# musique après quelques redéploiements).
# Nom d'image tout en minuscules : Docker refuse les majuscules dans un nom
# de dépôt, même si le projet s'écrit "Lavalink".
FROM ghcr.io/lavalink-devs/lavalink:4

# La configuration est copiée dans l'image plutôt que passée en variables :
# les extensions (YouTube, Spotify) se déclarent en listes imbriquées, très
# pénibles à exprimer en variables d'environnement.
COPY application.yml /opt/Lavalink/application.yml

# Mémoire bornée. Sans limite, la JVM se sert librement et le conteneur finit
# tué par l'hébergeur pour dépassement : c'est ce qui coupait la musique après
# une seconde, avec deux démarrages de Lavalink à 21s d'intervalle et aucune
# trace côté Java (la JVM n'a pas le temps d'écrire quoi que ce soit quand le
# système la tue).
#
# Le tas ne fait pas tout : Lavalink alloue aussi beaucoup HORS tas (tampons
# audio), invisible pour -Xmx. D'où le plafond sur la mémoire directe, sans
# lequel la somme peut dépasser la limite du conteneur alors que le tas, lui,
# reste sage.
#
# GC série plutôt que G1 : sur un tas de cette taille, il consomme moins pour
# un résultat équivalent. ExitOnOutOfMemoryError fait sortir la JVM net si
# elle sature malgré tout, plutôt que de la laisser ramer indéfiniment — le
# bot, lui, reconnecte et relance la lecture tout seul (voir index.js).
#
# _JAVA_OPTIONS et non JAVA_OPTS : cette variable est lue par la JVM elle-même,
# quelle que soit la façon dont l'image lance Lavalink. Elle reste surchargeable
# depuis les variables du service si le conteneur gagne un jour en mémoire.
ENV _JAVA_OPTIONS="-Xmx256m -XX:MaxMetaspaceSize=128m -XX:MaxDirectMemorySize=96m -XX:+UseSerialGC -XX:+ExitOnOutOfMemoryError"
