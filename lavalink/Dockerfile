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
