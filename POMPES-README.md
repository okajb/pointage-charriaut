# Suivi des pompes à vide – préparation Firebase

Branche de préparation : ajout-entretien-pompes-vide. **Ne pas fusionner avant validation**. L'application de pointage V14 (app.js, données enregistrées, exports) est inchangée.

Firebase : projet `charriaut-entretien`, région `europe-west9`, formule Spark. Les pompes sont dans `pumps/testo` et `pumps/value`.

Le module `pompes.js` se connecte par e-mail vérifié et contrôle le document `authorizedEmployees/<adresse>` : `active: true`. Un seul chronomètre actif par pompe : le départ reste en ligne même si le téléphone est éteint. Arrêt et vidange sont inscrits dans `pumps/<id>/events` via transactions Firestore. L'export mensuel A4 paysage passe par l'impression du navigateur.

Pour chacun des deux compteurs, un administrateur peut initialiser **une seule fois** le nouveau suivi à 0 h (champ `trackingStartedAt`, `trackingInitializedBy`, `oilCondition: 'unverified'`). **Cette initialisation n'est pas une vidange** et ne renseigne jamais `lastOilAt`. Le chronomètre peut ensuite cumuler les heures, mais l'interface continue de signaler « HUILE À CONTRÔLER » jusqu'à une vidange réellement déclarée. Celle-ci remet `usedSeconds` à zéro, inscrit l'opération dans `pumps/{id}/events` et enregistre `lastOilAt`. Les 23 archives importées dans `pumps/{id}/history` ne sont jamais modifiées. Les alertes à 8 et 10 heures sont visibles dans l'application : aucune notification en arrière-plan n'est encore intégrée.

Dans Firebase, les règles actuellement publiées permettent les **archives uniquement**, mais pas les nouveaux départs/arrêts/vidanges ni l'initialisation administrative : ces boutons ne fonctionneront pas avant déploiement de règles adaptées et testées. Le fichier `firestore.rules` est un **brouillon à tester avec Firebase Emulator Suite** avant de remplacer les règles en production. Ne pas ouvrir l'accès général en écriture.

Quotas : Firebase Spark limite les envois de liens de connexion à 5 par jour. Les connexions existantes sont persistantes, mais le déploiement initial à 12 salariés doit être échelonné.

Tests à faire avant validation : contrôle de la clé Firebase depuis la console ; connexion autorisée/non autorisée ; deux téléphones ; 2 starts concurrents ; stop puis PDF ; vidange ; coupure de connexion ; suppression d'un accès et chargement des données ; export sauvegarde.

Le code client n'inclut aucune clé privée de compte de service ; la configuration web Firebase est publique par conception, la sécurité repose sur les règles d'accès.