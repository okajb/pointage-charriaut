# Suivi des pompes à vide – préparation Firebase

Branche de préparation : ajout-entretien-pompes-vide. **Ne pas fusionner avant validation**. L'application de pointage V14 (app.js, données enregistrées, exports) est inchangée.

Firebase : projet `charriaut-entretien`, région `europe-west9`, formule Spark. Les pompes sont dans `pumps/testo` et `pumps/value`.

Le module `pompes.js` se connecte par e-mail vérifié et contrôle le document `authorizedEmployees/<adresse>` : `active: true`. Un seul chronomètre actif par pompe : le départ reste en ligne même si le téléphone est éteint. Arrêt et vidange sont inscrits dans `pumps/<id>/events` via transactions Firestore. L'export mensuel A4 paysage passe par l'impression du navigateur.

Les alertes à 8 et 10 heures sont visibles dans l'application : aucune notification en arrière-plan n'est encore intégrée. Le temps de vidange n'est pas présumé connu tant que la dernière vidange n'est pas renseignée.

Dans Firebase, les règles actuellement publiées restent en **lecture seule** : les boutons Départ/Fin/Vidange ne fonctionneront pas avant déploiement des règles adaptées. Le fichier `firestore.rules` est un **brouillon à tester avec Firebase Emulator Suite** avant de remplacer les règles en production. Ne pas ouvrir l'accès général en écriture.

Quotas : Firebase Spark limite les envois de liens de connexion à 5 par jour. Les connexions existantes sont persistantes, mais le déploiement initial à 12 salariés doit être échelonné.

Tests à faire avant validation : contrôle de la clé Firebase depuis la console ; connexion autorisée/non autorisée ; deux téléphones ; 2 starts concurrents ; stop puis PDF ; vidange ; coupure de connexion ; suppression d'un accès et chargement des données ; export sauvegarde.

Le code client n'inclut aucune clé privée de compte de service ; la configuration web Firebase est publique par conception, la sécurité repose sur les règles d'accès.