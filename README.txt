POINTAGE CHARRIAUT – V14 · SAISIE DES HEURES AU CLAVIER / PDF & SAUVEGARDE
=================================================================

INSTALLER LA MISE À JOUR SUR GITHUB PAGES
1. AVANT de remplacer la V12, ouvre l'application actuelle, puis :
   Réglages > Sauvegardes > Exporter la sauvegarde.
   Vérifie que le fichier JSON est bien présent dans Fichiers / Téléchargements.
2. Sur Mac, décompresse Pointage_CHARRIAUT_Entreprise_V14_Clavier_GitHub.zip.
3. Ouvre https://github.com/okajb/pointage-charriaut
4. Choisis Add file > Upload files et ajoute les fichiers et le dossier assets
   du dossier décompressé À LA RACINE du dépôt GitHub (sans envoyer le ZIP).
5. Valide Commit changes. Patiente quelques minutes pour GitHub Pages.
6. Ouvre https://okajb.github.io/pointage-charriaut/ sur l'iPhone ou Samsung.
   Si l'ancienne version apparaît encore, ferme puis relance l'application.

LES NOUVEAUTÉS
- Bouton « Télécharger mon PDF » : crée un fichier PDF, et pas seulement
  une page d'impression, sur UNE SEULE page A4 en paysage.
- Le relevé comprend les heures, lieux début/fin, pauses, observations,
  panier repas, congés/RTT, écarts journaliers/hebdomadaires, bilan net,
  contrôle véhicule et identité du salarié.
- Pour garantir une page même avec 31 jours : les notes/adresses trop longues
  sont abrégées dans les cellules. Les données complètes restent accessibles
  dans l'application et le CSV.
- Après chaque saisie, confirmation de l'enregistrement local avec lecture
  de contrôle, copie sur une seconde clé et copie IndexedDB si disponible.
- Alerte rouge si une sauvegarde locale échoue.
- Bouton de sauvegarde externe JSON plus visible et restauration simplifiée.
- La clé « pointage39h.v1 » est CONSERVÉE pour reprendre les données V12.

CONSERVATION DES DONNÉES – À LIRE
- Après un pointage enregistré normalement, un arrêt/redémarrage du téléphone
  ne devrait pas effacer le relevé.
- Ces données restent sur l'appareil : GitHub Pages ne les héberge PAS.
- La perte de l'iPhone, l'effacement du navigateur ou de l'application,
  certains nettoyages système et une défaillance de stockage peuvent
  SUPPRIMER TOUTES LES COPIES LOCALES.
- Exporte une sauvegarde JSON dans Fichiers, iCloud Drive ou autre support
  distinct AU MOINS UNE FOIS PAR SEMAINE et avant chaque mise à jour.
- Une sauvegarde « lancée » n'est pas une preuve que le fichier a été
  enregistré : vérifie sa présence dans Fichiers / Téléchargements.
- Sur un nouveau téléphone, installe la même application, puis restaure le
  fichier JSON depuis les réglages.

TESTS CONSEILLÉS AVANT DÉPLOIEMENT À L'ÉQUIPE
A. Pointe une heure, choisis le lieu, une pause et un panier repas.
B. Vérifie l'indication verte « Enregistré sur ce téléphone ».
C. Force la fermeture de l'application, rouvre-la et vérifie le pointage.
D. Passe hors ligne et vérifie qu'un pointage reste accessible / sauvegardé.
E. Exporte un JSON et vérifie sa présence dans Fichiers.
F. Télécharge le PDF : il doit être en A4 paysage, 1 page, et s'ouvrir.
G. Joins toi-même ce PDF au courriel adressé à contact@charriaut.fr.

IMPORTANT POUR LA PAIE
Le solde mensuel est un indicateur interne. Les heures supplémentaires
restent soumises au décompte hebdomadaire et aux règles applicables, à
valider par le bureau. Les congés et RTT sont affichés séparément.


V14 — HEURES MANUELLES AU CLAVIER
--------------------------------
Dans la carte Embauche ou Débauche, touche « Modifier l’heure au clavier ».
Le téléphone ouvre son clavier numérique et non la roulette iOS.
Exemples de saisie : 0800 -> 08:00 ; 1620 -> 16:20 ; 8h30 -> 08:30.
Quand tu termines la saisie et fermes le clavier, l’heure est validée,
normalisée puis enregistrée comme auparavant. Les heures impossibles sont
refusées (ex. 25:90) et ne remplacent jamais la valeur enregistrée.
Pour les anciens pointages avec midi en deux horaires, les champs de
correction utilisent aussi le clavier.
Le bouton Embauche / Débauche continue de pointer automatiquement à
l’heure actuelle et tous les pointages précédents sont conservés.
