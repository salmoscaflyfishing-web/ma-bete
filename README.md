# Ma Bête 🐄

*Le carnet d'étable de votre troupeau.*

Application de gestion de troupeau bovins viande : inventaire (colonnes au choix, filtres, tri par numéro de travail, « Dernier veau »), import de l'inventaire EDE, reproduction, santé et délais d'attente, pesées et GMQ.

**Adresse de l'application : https://salmoscaflyfishing-web.github.io/ma-bete/**

- Elle s'installe comme une vraie application sur Android, iPhone et ordinateur (icône de boucle jaune).
- Elle fonctionne **sans réseau** : tout est enregistré d'abord sur l'appareil. Les modifications faites hors ligne partent toutes seules au retour du réseau.
- Avec un compte gratuit Supabase, le registre est **partagé** entre vos appareils et vos associés (propriétaire, éditeur, lecture seule), avec mise à jour en temps réel.
- Sans Supabase, elle fonctionne quand même, en **mode local** sur un seul appareil.

L'indicateur en haut à droite vous dit toujours où vous en êtes :

| Indicateur | Signification |
|---|---|
| 🔵 **Mode local** | Les données restent sur cet appareil (pas de synchronisation). |
| 🟢 **En ligne** | Tout est envoyé et à jour. |
| 🟠 **3 modifications en attente** | Des saisies sont en cours d'envoi. |
| 🔴 **Hors ligne · 3 modifications en attente** | Pas de réseau : les saisies sont gardées sur l'appareil et partiront au retour du réseau. |
| 🟠 **Reconnexion nécessaire** | La session a expiré : touchez « Se reconnecter ». Rien n'est perdu. |

---

## Utiliser tout de suite (mode local)

Ouvrez l'adresse ci-dessus et touchez **« Continuer sans compte »**. Vous pouvez importer votre inventaire EDE, saisir, etc. Les données restent sur cet appareil.

👉 Pour récupérer votre registre actuel : menu **Compte** → **Restaurer une sauvegarde** → choisissez votre fichier `.json` (format `registre-troupeau` version 1).

Pour partager le registre entre plusieurs téléphones ou avec un associé, suivez les étapes 1 à 5 (environ 15 minutes, une seule fois).

---

## Étape 1 — Créer le projet Supabase gratuit (région Europe)

Supabase est le service en ligne qui garde la copie partagée du registre.

1. Allez sur **https://supabase.com** et cliquez sur **Start your project**.
2. Créez un compte (avec votre adresse e-mail, ou avec votre compte GitHub).
3. Cliquez sur **New project** et remplissez :
   - **Name** : `ma-bete`
   - **Database Password** : cliquez sur **Generate a password**, puis **notez-le** dans un endroit sûr (vous n'en aurez normalement plus besoin, mais gardez-le).
   - **Region** : choisissez **West EU (Paris)** (ou une autre région « EU » si Paris n'est pas proposée).
   - **Plan** : **Free** (gratuit).
4. Cliquez sur **Create new project** et patientez 1 à 2 minutes pendant la préparation.

> ℹ️ Un projet gratuit **se met en pause s'il n'est pas utilisé pendant une semaine**. Si cela arrive, rien n'est perdu : connectez-vous sur supabase.com et cliquez sur **Restore project**. Pendant ce temps, l'application continue de fonctionner sur vos appareils et enverra les modifications ensuite.

## Étape 2 — Coller le script SQL

Ce script crée les tables et toutes les règles de sécurité (qui peut voir et modifier quoi).

1. Ouvrez le fichier [`supabase/schema.sql`](supabase/schema.sql) de ce dépôt, cliquez sur l'icône **Copy raw file** (deux petits carrés) en haut à droite du fichier.
2. Dans Supabase, menu de gauche : **SQL Editor** → **New query**.
3. Collez le texte (Ctrl+V), puis cliquez sur **Run** (en bas à droite).
4. Le message **« Success. No rows returned »** doit s'afficher. C'est tout.

(Le script peut être relancé sans danger : il ne supprime aucune donnée.)

## Étape 3 — Régler l'adresse du site dans l'authentification

Ce réglage permet aux liens reçus par e-mail (confirmation de compte, mot de passe oublié) de revenir vers l'application.

1. Menu de gauche : **Authentication** → **URL Configuration**.
2. **Site URL** : remplacez `http://localhost:3000` par
   `https://salmoscaflyfishing-web.github.io/ma-bete/`
   puis cliquez sur **Save**.
3. **Redirect URLs** : cliquez sur **Add URL**, collez
   `https://salmoscaflyfishing-web.github.io/ma-bete/**`
   puis **Save URLs**.
4. Vérifiez dans **Authentication** → **Sign In / Providers** → **Email** que **Enable Email provider** et **Confirm email** sont bien activés (c'est le réglage par défaut). La confirmation d'e-mail est importante : c'est elle qui garantit qu'une invitation ne peut être utilisée que par la bonne personne.

> ℹ️ Le service d'e-mail intégré de Supabase n'envoie que quelques e-mails par heure. C'est suffisant pour quelques associés ; si un e-mail de confirmation n'arrive pas, attendez un peu et regardez dans les courriers indésirables.

## Étape 4 — Remplir `config.js`

1. Dans Supabase, menu de gauche : **Project Settings** (roue dentée) → **Data API** (ou **API**). Copiez la **Project URL** (elle ressemble à `https://abcdefghijkl.supabase.co`).
2. Toujours dans **Project Settings** → **API Keys** : copiez la clé **anon public** (onglet « Legacy API keys ») ou la clé **Publishable** (`sb_publishable_…`). Les deux fonctionnent.
   ⚠️ Ne copiez **jamais** la clé `service_role` ni la clé `secret` : elles ne doivent pas être mises dans l'application.
3. Sur GitHub, ouvrez le fichier [`config.js`](config.js) de ce dépôt et cliquez sur le **crayon** (Edit this file).
4. Collez les deux valeurs entre les guillemets :

   ```js
   window.REGISTRE_CONFIG = {
     supabaseUrl: "https://abcdefghijkl.supabase.co",
     supabaseAnonKey: "eyJhbGciOi...votre-clé-anon..."
   };
   ```

5. Cliquez sur **Commit changes…** puis encore sur **Commit changes**.
6. Attendez 1 à 2 minutes (GitHub republie le site tout seul ; vous pouvez suivre l'avancement dans l'onglet **Actions** du dépôt).

> La clé « anon / publishable » est publique par nature : la sécurité est assurée par les règles du script SQL (chaque personne ne voit que les exploitations dont elle est membre).

## Étape 5 — Premier lancement : votre compte et votre exploitation

1. Ouvrez **https://salmoscaflyfishing-web.github.io/ma-bete/** (rechargez la page si elle était déjà ouverte).
2. Saisissez votre e-mail et un mot de passe (6 caractères minimum), puis **Créer un compte**.
3. Ouvrez l'e-mail reçu et cliquez sur le lien de confirmation. Revenez sur l'application et touchez **Se connecter**.
4. Donnez un nom à votre exploitation (par ex. « GAEC du Puech ») → **Créer l'exploitation**. Vous en êtes le **propriétaire**.
5. Pour remettre vos données :
   - si vous aviez déjà saisi des choses en mode local sur cet appareil, un bandeau propose **« Les ajouter à l'exploitation »** ;
   - sinon : **Compte** → **Restaurer une sauvegarde** → votre fichier `.json`, ou **Animaux** → **Importer (EDE, Excel)**.

## Étape 6 — Installer l'application sur Android

1. Ouvrez **Chrome** sur le téléphone et allez sur l'adresse de l'application. Connectez-vous.
2. Touchez le menu **⋮** (en haut à droite) → **Installer l'application** (ou **Ajouter à l'écran d'accueil** → **Installer**).
   Vous pouvez aussi passer par le menu **Compte** de l'application → **Installer l'application**.
3. L'icône jaune **Ma Bête** apparaît sur l'écran d'accueil. Elle s'ouvre en plein écran, comme une application normale.
4. Ouvrez-la une première fois avec du réseau : tout est alors gardé sur le téléphone, et elle s'ouvrira ensuite **même sans réseau** (en stabulation, au pré…).

**Sur iPhone** : ouvrez l'adresse dans **Safari** → bouton **Partager** (carré avec une flèche) → **Sur l'écran d'accueil** → **Ajouter**.
**Sur ordinateur** : dans Chrome ou Edge, cliquez sur l'icône d'installation à droite de la barre d'adresse (petit écran avec une flèche).

## Étape 7 — Inviter un associé

1. Dans l'application : **Compte** → rubrique **Membres de l'exploitation**.
2. Saisissez l'adresse e-mail de votre associé, choisissez son rôle, puis **Inviter** :
   - **Éditeur** : peut tout saisir et modifier ;
   - **Lecture seule** : consulte sans rien pouvoir modifier (vétérinaire, technicien…) ;
   - **Propriétaire** : peut en plus inviter et gérer les membres.
3. Votre messagerie s'ouvre avec un message tout prêt contenant l'adresse de l'application : envoyez-le. (Le bouton **E-mail** à côté d'une invitation permet de le renvoyer.)
4. Votre associé ouvre l'adresse, touche **Créer un compte** **avec la même adresse e-mail**, confirme son e-mail puis se connecte : l'exploitation apparaît directement.

Vous pouvez à tout moment changer le rôle d'un membre ou le retirer (✕) depuis la même rubrique.

---

## Lecteur de boucles électroniques (Allflex, Agrident…)

1. Réglez le lecteur en **mode clavier Bluetooth** (appelé selon les modèles « HID », « Keyboard » ou « Clavier ») et vérifiez qu'il envoie **Entrée** après chaque numéro (c'est en général le réglage par défaut).
2. Appairez-le avec le téléphone ou l'ordinateur dans les réglages Bluetooth, comme un clavier.
3. Dans l'application, scannez une boucle :
   - la **fiche de l'animal s'ouvre** (l'application compare les 10 derniers chiffres lus au numéro national FR) ;
   - pendant une **séance de pesée** (onglet Pesées), le curseur se place sur **la ligne de l'animal scanné** : il ne reste qu'à taper le poids ;
   - dans le formulaire « Nouvel évènement », l'animal scanné est sélectionné.

Astuce Android : quand un clavier Bluetooth est connecté, le clavier de l'écran peut disparaître. Un appui long sur l'icône clavier dans la barre de notification permet de le réafficher.

## Lots

Onglet **Animaux** → bouton **Lots** : la liste des lots avec le nombre d'animaux et leur composition (ex. « 3 vaches · 1 taureau »).

- **+ Nouveau lot** : donnez un nom, puis cochez les animaux. Le champ « Filtrer » aide à trouver (numéro, nom, catégorie…) et **Cocher les animaux affichés** coche d'un coup, par exemple toutes les vaches. Avec le **lecteur de boucles**, scannez simplement les animaux pour les cocher.
- Depuis la liste Animaux, sélectionnez des animaux puis **Mettre dans un lot** (lot nouveau ou existant).
- **Modifier** : changer les animaux du lot ou le renommer. **Dissoudre le lot** retire le lot des animaux, sans les supprimer.
- **Voir** affiche le lot dans la liste Animaux ; les lots sont aussi proposés pour les séances de pesée.
- **Historique** : chaque changement de lot est daté (date choisie dans le formulaire de lot, aujourd'hui par défaut) et apparaît dans l'historique de la fiche. La fiche affiche aussi le récapitulatif **« Lots successifs »** avec les périodes et durées. Renommer un lot ne compte pas comme un déplacement. Le suivi commence avec la version 1.7.0 (avant, la date d'entrée est inconnue).

### Veaux sous la mère et sevrage

- Au **vêlage**, le champ **« Lot du veau »** est prérempli avec le lot de la mère (ou « Veaux AAAA » si elle n'en a pas) ; on peut le changer, ou le vider pour ne pas mettre de lot.
- Tant qu'aucun évènement **« Sevrage »** n'est saisi, le veau **suit sa mère** : quand elle change de lot (formulaire de lot, « Mettre dans un lot » ou sa fiche), ses veaux non sevrés changent avec elle, à la même date.
- **Sevrage** : nouvel évènement (avec le poids au sevrage, compté comme une pesée), saisissable en groupe : sélectionnez les veaux dans la liste → « Ajouter un évènement » → Sevrage. Après le sevrage, le veau ne suit plus sa mère.
- Garde-fou : un animal de plus de 12 mois ne suit plus sa mère, même sans sevrage saisi (animaux nés avant cette fonction). Renommer un lot ne déplace pas les veaux.

## Stock de boucles pour les veaux

Onglet **Reproduction** → **Boucles pour les veaux** → **+ Ajouter des boucles** : saisissez le premier numéro de la série reçue de l'EDE (par ex. `FR 12 0123 8001`) et le nombre de boucles ; les numéros suivants sont calculés tout seuls (les boucles déjà en stock sont ignorées).

- À chaque **vêlage**, le numéro du veau est **proposé automatiquement** : c'est la plus petite boucle libre du stock. Vous pouvez la changer, l'effacer si le veau n'est pas bouclé, ou **scanner** la boucle électronique du veau avec le lecteur.
- Une boucle est comptée comme **utilisée** dès qu'un animal ou un vêlage porte son numéro (y compris après un import EDE) : rien à cocher.
- Touchez une boucle pour la marquer **perdue / abîmée** (elle ne sera plus proposée) ou la supprimer du stock.
- Le tableau de bord prévient quand il reste **moins de 5 boucles**.

> Si l'exploitation a été créée avant l'arrivée du stock de boucles, la base Supabase doit être mise à jour une fois : **SQL Editor** → **New query** → collez de nouveau tout le fichier [`supabase/schema.sql`](supabase/schema.sql) → **Run**. Sans danger pour les données. En attendant, un bandeau l'indique et les boucles restent sur l'appareil.

## Naissances et sorties à notifier à l'EDE

Ma Bête ne peut pas se connecter au site de l'EDE (pas d'accès ouvert aux applications). Pour éviter la double saisie, tout se saisit une fois dans Ma Bête, puis le tableau de bord affiche la rubrique **« À notifier à l'EDE »** :

- **Naissances** : chaque veau né sur l'exploitation (vêlage saisi ou animal ajouté) avec ce que demande l'EDE : n° du veau, date, sexe, race et son code (ex. Aubrac (14)), mère, père.
- **Sorties** : ventes, morts, réformes, avec date et motif.
- **Copier** met la ligne dans le presse-papiers ; après l'avoir saisie sur le site de l'EDE, touchez **Notifié**. La fiche de l'animal permet aussi de marquer la notification ou de l'annuler.
- Une alerte apparaît dans « À surveiller » ; elle passe à l'orange puis au rouge quand la naissance (7 puis 20 jours) ou la sortie (3 puis 7 jours) attend depuis longtemps. Vérifiez les délais réglementaires auprès de votre EDE.
- Les animaux venus d'un import EDE sont considérés comme déjà connus de l'EDE. Les naissances et sorties antérieures au 1er octobre 2026 ne sont pas listées.

## Sauvegardes

**Compte** → **Exporter une sauvegarde** crée un fichier `ma-bete-AAAA-MM-JJ.json` avec tous les animaux, évènements et boucles en stock. Gardez-en une copie de temps en temps (e-mail, clé USB).

**Compte** → **Restaurer une sauvegarde** relit ce fichier (ou votre ancien fichier au format `{"format":"registre-troupeau","version":1,…}`), au choix :
- **Fusionner** : ajoute et met à jour, sans rien supprimer ;
- **Remplacer** : le registre redevient exactement celui de la sauvegarde.

## Mises à jour de l'application

Quand une nouvelle version est publiée, un bandeau **« Nouvelle version de l'application disponible »** apparaît : touchez **Mettre à jour**. (Pour un informaticien : changer `VERSION` dans `sw.js` à chaque modification des fichiers.)

## Dépannage

- **« Reconnexion nécessaire »** : la session a expiré (longue période sans réseau). Touchez **Se reconnecter** ; les modifications en attente sont conservées et partent ensuite.
- **Je ne reçois pas l'e-mail de confirmation** : regardez les courriers indésirables, attendez quelques minutes (limite d'envoi de Supabase), vérifiez l'étape 3.
- **Le lien de confirmation ouvre une page « localhost »** : la *Site URL* de l'étape 3 n'est pas réglée.
- **« Se déconnecter »** retire les données de l'exploitation de cet appareil (elles restent en ligne). S'il reste des modifications en attente, l'application vous prévient avant.
- **Effacer les données du navigateur** supprime aussi les données de l'application sur cet appareil : en mode local, faites une sauvegarde avant.

---

## Pour les informaticiens

| Fichier | Rôle |
|---|---|
| `index.html`, `css/app.css`, `js/app.js` | L'application (interface identique à l'artefact d'origine). |
| `js/store.js` | Stockage IndexedDB, file d'attente des modifications (`outbox`), synchronisation Supabase (upsert par lots, rattrapage par `updated_at`, temps réel `postgres_changes`). |
| `js/scanner.js` | Détection des lecteurs RFID en mode clavier (frappe rapide terminée par Entrée/Tab). |
| `sw.js`, `manifest.webmanifest`, `icons/` | Application installable et hors ligne (tout en cache ; `config.js` en « réseau d'abord »). |
| `vendor/` | `supabase-js` 2.117.3 (UMD) et SheetJS `xlsx` 0.18.5, embarqués (pas de CDN). |
| `fonts/` | Polices Barlow, Barlow Condensed, IBM Plex Mono (licence OFL), embarquées. |
| `supabase/schema.sql` | Tables `farms`, `farm_members`, `farm_invitations`, `records(farm_id, collection, id, data jsonb, deleted, updated_at)`, RLS, fonctions, publication temps réel. |
| `.github/workflows/pages.yml` | Publication automatique sur GitHub Pages à chaque modification. |

Modèle de synchronisation : chaque écriture est appliquée tout de suite en mémoire et dans IndexedDB, puis ajoutée à la file d'attente si le registre est partagé. La file est envoyée par lots (`upsert`) dès que le réseau et la session sont disponibles ; `updated_at` est fixé par le serveur. Les changements des autres appareils arrivent par le temps réel Supabase, avec un rattrapage par date au retour du réseau. En cas de modifications simultanées du même enregistrement, la dernière arrivée au serveur l'emporte. Les suppressions sont logiques (`deleted = true`).
