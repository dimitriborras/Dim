# PLASTIC PANIC — feuille de route

Objectif : le meilleur party game jouable dans un navigateur, sur PC comme sur téléphone, entre amis.
On avance par étapes. Chaque étape doit laisser le jeu jouable et être testée avant la suivante.

## Ce que disent les recherches et les communautés

- **Entrer en jeu en quelques secondes.** Dans un jeu navigateur, les joueurs décident très vite s'ils restent.
  Un compte obligatoire ou un écran d'attente suffit à les perdre. Les parties doivent être courtes et donner
  envie de rejouer. Sources : [Game Developer / GameAnalytics : 16 raisons de quitter un jeu](https://www.gamedeveloper.com/design/16-reasons-why-players-are-leaving-your-game),
  [les joueurs ne veulent pas toujours des jeux de 100 h](https://thegww.com/players-dont-always-want-100-hour-games-and-browser-developers-understand-that/).
- **L'humour et le look avant tout.** Une enquête sur Fall Guys classe les personnages drôles, la direction
  artistique et l'humour comme les atouts préférés des joueurs.
  Source : [Appealing features of party game using Fall Guys](https://so03.tci-thaijo.org/index.php/JIRGS/article/view/264461).
- **Le chaos physique crée des moments à partager.** R.E.P.O. et Worms font rire parce que la physique
  rend chaque action un peu imprévisible : on rate, on se fait projeter, on déclenche une réaction en chaîne.
  Ces moments circulent ensuite en vidéo. Sources : [R.E.P.O. (Pure Xbox)](https://purexbox.com/news/2025/03/repo-explodes-in-popularity-on-pc-leading-to-calls-for-an-xbox-version),
  [5 raisons du succès de REPO](https://deltiasgaming.com/?p=170035), [série Worms](https://wikipedia.com/wiki/Worms_United).
- **Les sensations d'impact.** Un léger tremblement de l'écran, un micro-gel au moment de l'impact,
  un flash, des particules et des sons cohérents donnent du poids aux actions (Vlambeer, « Juice it or lose it »).
  Une étude IEEE de 2022 classe le gel d'impact, la cohérence sonore et la caméra parmi les facteurs principaux.
  Sources : [Making a juicy game](https://rpgplayground.com/research-making-a-juicy-game/),
  [Game feel : flash, shake, texte, son, particules](https://eastondev.com/blog/en/posts/dev/20260521-game-feedback-feel/).
- **Le tactile.** La formule éprouvée pour un jeu de tir vu de dessus : deux sticks virtuels, avec tir
  automatique quand on vise. Les sticks flottants évitent de chercher un emplacement précis. Une aide à la
  visée réglable compense l'imprécision du pouce. Les doigts cachent l'écran : il faut des commandes
  discrètes et un retour visuel près du personnage. Sources : [meilleures commandes mobiles](https://abratabia.com/game-controls/best-mobile-controls.php),
  [Carleton GI 2015](https://www.csit.carleton.ca/~rteather/pdfs/GI2015_poster1.pdf),
  [Carleton 2017](https://www.csit.carleton.ca/~rteather/pdfs/ec2017.pdf).
- **Le rattrapage.** Il doit rester discret et mérité, jamais un bonus brut pour le dernier : un rattrapage
  trop visible donne l'impression que le jeu triche. Sources : [elastic happiness](https://anildash.com/2009/04/06/elastic-happiness/),
  [rubber banding qui paraît injuste](https://bugnet.io/blog/how-to-fix-racing-ai-rubber-banding-feeling-unfair).
- **Accueillir les nouveaux.** Fall Guys faisait jouer les débutants avec des bots, et les répartissait
  par niveau, pour qu'ils apprennent sans se faire écraser. Source : [Fall Guys, matchmaking](https://fallguysultimateknockout.fandom.com/wiki/Matchmaking).
- **Varier les rôles et ce dont on parle.** Among Us tient sur des manches courtes, des rôles secrets qui
  laissent planer le doute, et deux façons de gagner. Le renouvellement des cartes entretient l'intérêt.
  Sources : [Among Us, analyse critique](https://mechanicsofmagic.com/2024/04/06/among-us-critical-play-of-social-deduction/),
  [Among Us (Wikipédia)](https://en.wikipedia.org/wiki/Among_Us).
- **Personnalisation et collection** (Stardew Valley, Minecraft, Terraria, Among Us) : on s'attache à son
  personnage et on revient pour débloquer des choses, à condition que ça ne donne aucun avantage en jeu.

## Étapes

1. **Contrôles, interface et sensations** *(fait)*
   - Mobile : tir automatique en visant, aide à la visée réglable, vibrations, boutons qui s'adaptent à l'inventaire.
   - Manette (Gamepad API), molette de la souris pour changer d'arme, écran de réglages.
   - Interface : indicateur de la direction des dégâts, marqueurs de touche, alerte de vie basse, munitions et
     esquive affichées autour du personnage, annonces animées.
   - Sensations : micro-gel à l'impact, flash, recul, éclair au canon, tremblement réglable, poussière, déformation du personnage.
2. **Physique « culbuto » et diorama** *(fait)* : pichenette élastique qui transmet l'élan, figurines
   lestées qui se renversent puis se relèvent, chocs de plastique, vue de trois quarts sur le bureau la nuit,
   effet miniature. Cadre retenu : « la nuit dans la chambre ».
3. **Un doigt, palet et performance** *(fait)* : la pichenette devient le seul geste (déplacement et attaque),
   petite tape pour se placer, tir automatique quand la figurine est posée, bouton d'objet unique, trajectoire
   exacte affichée avec ses rebonds, prédiction locale complète, vertical comme format principal, rendu
   mis en cache et résolution adaptative. Reste à faire : boutique en 3 cartes, arènes pensées pour le vertical.
3 bis. **Le billard** *(fait)* : l'arène principale devient une table de billard à six poches ; lobby en billard
   libre avec score d'empochés ; vue pivotée en vertical ; boules mobiles et carambolages ; points pour les gros chocs.
4. **Micro-jeux à la WarioWare** *(fait : 17 micro-jeux dans « La Rafale »)* : rafales de 10 micro-jeux à un
   seul geste, chacun lié à une capacité (réflexe, vitesse, lecture, observation, timing, mémoire, calcul,
   précision, langage, physique de palet). Séquence cohérente : échauffement, montée en niveau, capacités
   alternées, pauses « palet », boss final (mini-golf). Le match alterne Rafale et mini-jeux de palet.
   À venir : micro-jeux à deux (duel), à bluff, et au micro du téléphone (souffler).
5. **Personnage et humour** : chapeaux et accessoires de figurine, émotes et messages rapides, chutes
   comiques, voix « plastique », récompenses de fin de partie (« Plus grosse chute », « Roi de la banane »).
6. **Mini-jeux** (objectif 8 et plus, en variant compétition, coopération et bluff) : patate chaude,
   territoire de peinture, sumo sur plateau qui rétrécit, artillerie au tour par tour à la Worms, braquage
   coopératif à la R.E.P.O. (porter un objet fragile ensemble), manche à imposteur à la Among Us,
   « 1, 2, 3… Humain ! », voitures à friction (la pichenette réutilisée), dominos.
7. **Arènes vivantes** : décor destructible (Worms, Terraria), événements (la table penche, des jouets tombent),
   plusieurs arènes, météo d'arène.
8. **Méta-progression sans avantage en jeu** : expérience, déblocages cosmétiques, défis quotidiens,
   statistiques, collection façon Stardew.
9. **Social et partage** : revanche en un clic, spectateurs, salles publiques, meilleur moment rejoué
   à la fin de la partie (le « clip » à partager), installation comme application (PWA).
10. **Réseau et robustesse** : compensation de latence pour les tirs, tests de charge, observabilité.
