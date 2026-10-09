# PLASTIC PANIC — prototype jouable

Party game multijoueur 2D (2 à 8 joueurs, 4 à 8 recommandés) : des figurines en plastique enchaînent
mini-jeux, achats de gadgets et combats dans une arène commune, puis s'affrontent en finale.

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
- `npm test` lance les 17 tests (économie, anti-triche, phases, réseau).

- **Créer une salle** : un code à 4 lettres et un lien à partager s'affichent (aucun compte nécessaire).
- **Rejoindre** : code ou lien `?room=CODE`. En cas de coupure, le client se reconnecte seul
  et retrouve sa place grâce à un jeton de session.
- **Entraînement solo** : toute la simulation tourne dans le navigateur, avec 5 bots, sans serveur.
- L'hôte peut ajouter ou retirer des bots et choisir 3, 5 ou 8 manches.

| PC | Mobile (paysage) |
| --- | --- |
| ZQSD / WASD : déplacement (touches physiques, AZERTY et QWERTY) | Pouce gauche : joystick de déplacement |
| Souris : visée, clic gauche : tir | Pouce droit : visée (pousser à fond = tir) + bouton TIR |
| Clic droit / E : gadget | Boutons esquive, gadget, consommables |
| Espace : esquive (recharge 4 s) | Toucher un emplacement : changer d'arme |
| 1 2 3 : arme ou gadget, R / F : consommables | |
| B : boutique, Tab : classement, M : son | |

## Boucle de partie

`lobby (entraînement libre)` → pour chaque manche : `présentation (4 s)` → `mini-jeu (60–75 s)` →
`résultats + boutique sûre (8 s)` → `combat (35 s)` → `derniers achats (7 s)` → … → `finale (75 s)` →
`classement final (15 s)` → retour au lobby.

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
- **Réseau** : 30 ticks/s, 15 instantanés/s, interpolation côté client (110 ms).
  Il n'y a pas encore de prédiction locale.

## État par rapport au plan

- [x] Étape 1 — Prototype local : déplacement, visée libre, tirs, collisions, dégâts, arène.
- [x] Étape 2 — Multijoueur 2 à 8 joueurs, hôte, reconnexion, bots.
- [x] Étape 3 — Boutique et inventaire : crédits, armes alternatives, gadgets, consommables.
- [x] Étape 4 — Partie complète : mini-jeux, phases, récompenses, finale, classement, retour au lobby.
- [ ] Étape 5 — À faire avec de vrais testeurs : latence et pertes réseau réelles, petits écrans,
  équilibrage des valeurs (simulation avec bots : `node --test`).

Pistes suivantes : prédiction côté client pour le joueur local, réglage de la sensibilité de visée
mobile, nouveaux mini-jeux et arènes, direction artistique et sons.
