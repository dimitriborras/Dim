# PLASTIC PANIC — prototype jouable

Party game multijoueur 2D (2 à 8 joueurs, 4 à 8 recommandés) : des figurines en plastique enchaînent
mini-jeux, achats de gadgets et combats dans une arène commune, puis s'affrontent en finale.

## Mettre le jeu en ligne (jouer depuis un téléphone)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/dimitriborras/Dim)

1. Toucher le bouton ci-dessus (ça marche depuis un téléphone) et se connecter à Render avec GitHub.
2. Valider le service `plastic-panic` (offre gratuite, configuré par `render.yaml`).
3. Après 2 à 3 minutes, Render donne une adresse `https://plastic-panic-xxxx.onrender.com` :
   l'ouvrir, créer une salle et partager le lien.

Le service est créé à Francfort (`region: frankfurt`) pour un ping faible depuis la France ; la région d'un
service Render ne peut pas être changée après coup (il faut supprimer le service puis le recréer).
Chaque push sur la branche par défaut redéploie le jeu. L'offre gratuite met le serveur en veille après
15 minutes sans joueur : la première visite suivante prend environ une minute, et les parties en cours
sont perdues lors de la mise en veille.

Vercel ou Netlify ne conviennent pas : leurs fonctions serverless ne gardent pas de connexion WebSocket
ouverte, alors que le serveur de jeu doit tourner en continu (30 calculs par seconde par salle).

## Jouer dans son navigateur

1. **Installer Node.js** (version 20 ou plus) depuis https://nodejs.org (bouton « LTS »).
   Vérifier dans un terminal : `node -v`.
2. **Récupérer le code** :
   ```bash
   git clone https://github.com/dimitriborras/Dim.git
   cd Dim
   git checkout ccr-f3d1aca3-23s4eb   # inutile une fois la PR fusionnée dans main
   ```
   Sans git : sur GitHub, choisir la branche puis « Code → Download ZIP », et décompresser.
3. **Installer puis lancer** (dans le dossier du jeu) :
   ```bash
   npm install
   npm start
   ```
   Le terminal affiche les adresses à ouvrir :
   ```
   Sur cet ordinateur :   http://localhost:8080
   Sur le même Wi-Fi :    http://192.168.1.23:8080
   ```
4. **Ouvrir** `http://localhost:8080` dans le navigateur, « Créer une salle », puis partager le lien affiché.

- **Téléphone ou amis sur le même Wi-Fi** : ouvrir l'adresse « Sur le même Wi-Fi ». Sous Windows ou macOS,
  accepter la demande du pare-feu au premier lancement.
- **Amis à distance** : exposer le serveur avec un tunnel, par exemple
  `cloudflared tunnel --url http://localhost:8080`, puis partager l'adresse `https://…` obtenue
  (les WebSocket passent automatiquement en `wss`).
- **Port déjà utilisé** : `PORT=3000 npm start` (Windows PowerShell : `$env:PORT=3000; npm start`).
- `npm test` lance les 33 tests (économie, anti-triche, phases, réseau).

- **Créer une salle** : un code à 4 lettres et un lien à partager s'affichent (aucun compte nécessaire).
- **Rejoindre** : code ou lien `?room=CODE`. En cas de coupure, le client se reconnecte seul
  et retrouve sa place grâce à un jeton de session.
- **Entraînement solo** : toute la simulation tourne dans le navigateur, avec 5 bots, sans serveur.
- L'hôte peut ajouter ou retirer des bots et choisir 3, 5 ou 8 manches.

**Un seul doigt, sur tous les appareils** (téléphone en vertical ou en paysage, souris, manette) :

- poser le doigt n'importe où, tirer en arrière, relâcher : **pichenette**, la figurine part comme une bille ;
  la trajectoire exacte s'affiche avant de lâcher (rebonds marqués, croix rouge si elle finirait dans le vide) ;
- petite tape : petit bond vers l'endroit touché ;
- posée, la figurine **tire toute seule** sur l'adversaire visible le plus proche ;
- bouton rond (ou E / Espace) : utiliser son objet ; B : boutique ; Tab : scores ;
- manette : stick gauche pour viser, A maintenu puis relâché pour la pichenette, B pour l'objet.

## Physique et présentation

- **Palet / bille de billard** : on ne marche pas, on se lance, on glisse et on s'arrête en douceur. Les briques
  renvoient comme des bandes de billard, les balles en caoutchouc relancent. Trois charges de pichenette se
  rechargent en continu (1,25 par seconde) ; la petite tape coûte un tiers de charge.
- **Chocs** : percuter une figurine lui transmet presque toute la vitesse (berceau de Newton) ; une chute qui
  suit est créditée à l'attaquant. Seul un très gros choc renverse une figurine (0,6 s sans contrôle).
- **Réactivité** : la physique de sa propre figurine (pichenette, rebonds) est calculée immédiatement sur
  l'appareil puis recalée sur le serveur, même avec du ping (`client/predict.js`, `shared/game/movement.js`).
- **Le billard** (lobby, combat, finale) : tapis vert, bandes qui renvoient, six poches, et un triangle de
  boules **mobiles** : on les percute, elles se percutent et percutent les figurines (carambolages). Tirer dans
  une boule la pousse aussi. Le crédit d'une chute remonte la chaîne jusqu'à l'auteur du coup, et une boule
  empochée revient sur sa mouche après 4 s. **Gros choc** (« Carton ! ») : +1 au lobby, +1 point en combat
  (au plus toutes les 2 s et 5 fois par combat). Plus de vide sur
  les bords : on ne tombe que dans les poches. Pousser un adversaire dans une poche compte comme une
  élimination ; au lobby (billard libre, sans tir), chaque adversaire empoché rapporte 🎱 +3 et chaque gros choc +1. Les bots visent
  comme au billard (bille fantôme derrière la cible, angle de coupe, puissance dosée).
- **Diorama** : vu de trois quarts, la nuit ; en vertical, la vue pivote d'un quart de tour pour que la table
  s'affiche dans sa longueur (seul l'affichage pivote, la simulation est la même pour tous).
- **Performance** : décor dessiné une seule fois, briques, balles, figurines et noms pré-dessinés, résolution
  qui baisse toute seule si l'appareil peine. Objectif : 60 images par seconde sur un téléphone moyen.

## Boucle de partie

`lobby (entraînement libre)` → pour chaque manche : `présentation (4 s)` → `mini-jeu (60–75 s)` →
`résultats + boutique sûre (8 s)` → `combat (35 s)` → `derniers achats (7 s)` → … → `finale (75 s)` →
`classement final (15 s)` → retour au lobby.

- **Ordre des manches** : La Rafale ouvre la partie (gestes simples pour découvrir), puis on alterne
  avec les mini-jeux à la physique de palet : Rafale, jetons ou course, Rafale, l'autre, … puis la finale.
- **La Rafale (micro-jeux à la WarioWare)** : 10 micro-jeux de quelques secondes joués par tous en même temps.
  Chacun sollicite une capacité, annoncée avec son niveau (★ à ★★★) :
  - ⚡ réflexe : *Dégaine !*, *Tape les taupes !* (jamais la bombe) ;
  - 💪 vitesse : *Gonfle !*, *Remonte !* ;
  - 👓 lecture : *Couleur !* ;
  - 👁️ observation : *Compte !*, *L'intrus !*, *Le plus gros tas !*, *Suis la bille !* (bonneteau) ;
  - ⏱️ timing : *Emboîte !* ;
  - 🧠 mémoire : *Répète !* (suite de couleurs) ;
  - 🔢 calcul : *Calcule !* ;
  - 🎯 précision : *Vise !* (cible qui bouge, trois essais) ;
  - 🗣️ langage : *Orthographe !* ;
  - 🎱 physique de palet : *Dans le cercle !*, *Reste sur la table !*, *Mini-golf !*.

  La séquence est construite pour rester lisible : échauffement en niveau 1, montée en difficulté,
  jamais deux fois de suite la même capacité, pauses « palet » aux manches 4 et 7, et un **boss** physique
  en dernier (plus long, 2 points). Le rythme accélère tous les trois micro-jeux. Les micro-jeux déjà
  joués dans le match sont évités à la Rafale suivante. Les gestes de réflexe sont horodatés à l'heure
  du serveur pour rester équitables malgré le ping. Ajouter un micro-jeu = ajouter une définition
  (avec `skill` et `level`) dans `shared/game/minigames/micros.js`.
- **Mini-jeux** : *Course sur le tapis* (circuit avec trous, ressorts, plateforme mobile ; le pistolet repousse
  sans blesser) et *Ruée sur les jetons* (un tir fait lâcher un jeton). **Finale** : *La couronne*
  (temps de possession, tout l'arsenal autorisé).
- **Combat** : 100 PV, pistolet 20 dégâts / 0,4 s, réapparition après 3 s avec 1 s d'invulnérabilité,
  chute dans le vide = élimination créditée au dernier attaquant.
- **Arène** : murs et blocs qui arrêtent les tirs, bumpers, bande glissante près des bords
  (recul ×1,35), fosse centrale, ressorts et plateforme mobile.
- **Champion** : le vainqueur du mini-jeu reçoit un bouclier qui absorbe une attaque, mais une prime
  (+2 pts, +30 crédits) est annoncée sur lui. Ces deux effets s'arrêtent à la fin du combat.
- **Boutique** : achat immédiat pendant les phases sûres. En combat, une transaction prend 1,5 s :
  le joueur est ralenti et ne peut pas tirer.

### Économie (valeurs de départ, toutes dans `shared/constants.js`)

| Action | Récompense |
| --- | --- |
| 1er / 2e / 3e du mini-jeu | 100 cr + 10 pts / 75 cr + 7 pts / 55 cr + 5 pts |
| Participation | 35 cr + 3 pts |
| Élimination | 3 pts (+10 cr), puis 1 et 0 pt pour la même victime dans le même combat |
| Élimination du champion | +2 pts, +30 cr |
| Survivre au combat | 1 pt |
| Contrat de rattrapage (moitié basse du classement) | 30–40 cr, jamais de points |

Les crédits ne se convertissent jamais en points de tournoi.

### Objets (`shared/items.js`)

| Objet | Type | Fonction |
| --- | --- | --- |
| Pistolet à impulsion | arme de départ | dégâts |
| Pistolet Mk II (90) | amélioration, 1 niveau max | dégâts |
| Lance-colle (80) | arme | ralentir |
| Gant à ressort (70) | arme de mêlée | déplacer / pousser |
| Bulle-bouclier (85) | gadget | protéger |
| Ressort de poche (75) | gadget | déplacement (saute le vide) |
| Peau de banane (30) | consommable | contrôle de zone (piège aussi son poseur) |
| Téléporteur jetable (40) | consommable | repositionnement, ne traverse pas les murs |
| Bombe à confettis / Leurre (offre tournante) | consommable | zone / tromper |

Inventaire : 3 emplacements permanents (le n°1 est toujours le pistolet) et 2 consommables.

## Architecture

```
server/index.js                  HTTP statique + WebSocket, boucle à 30 Hz, limitation de débit
shared/                          code commun serveur / navigateur (aucune dépendance)
  constants.js  maps.js  items.js  protocol.js (validation des messages)  geometry.js  rng.js
  game/GameRoom.js               salles, joueurs, hôte, connexions, diffusion des instantanés
  game/MatchManager.js           phases, chronomètres, manches, finale
  game/World.js                  PlayerController serveur : déplacement, projectiles, pièges, arène
  game/CombatSystem.js           santé, impacts, éliminations, réapparitions
  game/InventorySystem.js        équipement, consommables, munitions, recharges
  game/ShopSystem.js             catalogue, prix, achats, rotation
  game/ScoreSystem.js            crédits, points, primes, contrats, classement
  game/Bot.js                    IA qui envoie les mêmes entrées qu'un joueur
  game/minigames/                MinigameRegistry + Course, Jetons, Finale couronne
client/                          rendu Canvas 2D, HUD, boutique, commandes clavier/souris/tactile
test/                            tests node:test
```

- **Serveur faisant autorité** : le client n'envoie que des intentions (direction, angle, boutons,
  demande d'achat). Dégâts, éliminations, crédits et points sont calculés uniquement par la simulation.
  Les messages sont validés et bornés (`shared/protocol.js`).
- **Ajouter un mini-jeu** : une classe qui implémente `initialize / start / update / isOver / finish / hud / dispose`,
  enregistrée dans `defaultRegistry()` (`MatchManager.js`).
- **Ajouter un objet** : une entrée dans `ITEMS` avec son `use(ctx)` ; la boutique n'a pas à être modifiée.
- **Réseau** : 30 ticks/s, 15 instantanés/s, interpolation des autres joueurs (110 ms). Le joueur local est
  prédit (`client/predict.js`) : ses commandes sont appliquées tout de suite avec la même physique que le serveur
  (`shared/game/movement.js`), puis rejouées à partir de chaque état confirmé. La visée est locale.

## État par rapport au plan

- [x] Étape 1 — Prototype local : déplacement, visée libre, tirs, collisions, dégâts, arène.
- [x] Étape 2 — Multijoueur 2 à 8 joueurs, hôte, reconnexion, bots.
- [x] Étape 3 — Boutique et inventaire : crédits, armes alternatives, gadgets, consommables.
- [x] Étape 4 — Partie complète : mini-jeux, phases, récompenses, finale, classement, retour au lobby.
- [ ] Étape 5 — À faire avec de vrais testeurs : latence et pertes réseau réelles, petits écrans,
  équilibrage des valeurs (simulation avec bots : `node --test`).

Pistes suivantes : réglage de la sensibilité de visée
mobile, nouveaux mini-jeux et arènes, direction artistique et sons.
