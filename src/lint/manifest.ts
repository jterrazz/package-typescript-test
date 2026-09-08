import type { RuleDoc } from './types.js';

/**
 * The rule manifest — the single source of truth for the mechanized conventions
 * catalogue (docs-as-code inversion, phase 2).
 *
 * The constitution (`docs/12-conventions.md`) holds only principles, the
 * enforcement channels, process rules and design rationales. Every per-rule
 * normative sentence lives HERE, next to (or on) the code that enforces it. Four
 * channels are assembled into one {@link catalog}:
 *
 * - **statique** — the `jterrazz/*` oxlint rules (`RULE_DOCS`, attached to each
 *   rule's `meta.docs`);
 * - **checker** — the non-oxlint static passes bundled as `dist/checker.js`
 *   (`CHECKER_PASSES`);
 * - **runtime** — refusals/behaviours the framework enforces at execution time
 *   (`RUNTIME_RULES`);
 * - **process** — review-borne rules no channel can fully mechanize
 *   (`PROCESS_RULES`).
 *
 * The catalogue generator (`catalog.ts` / `dist/catalog.js`) reads this manifest
 * to (re)write the full four-channel catalogue in `docs/13-linting.md` and the
 * agent-facing `skills/jterrazz-test/references/rules.md`. `plugin.test.ts`
 * guards freshness and completeness.
 *
 * This module is pure data — it imports NOTHING but a type, so the lint layer
 * stays free of the framework runtime (CONVENTIONS I1) and the oxlint bundle
 * stays light.
 */

/** A catalogue row: a {@link RuleDoc} plus the implementation name it maps to. */
export type CatalogEntry = {
    /** The rule id, checker-pass id, or process id — unique across the catalogue. */
    name: string;
} & RuleDoc;

/** Family letter → its French section title. */
export const FAMILIES: Record<string, string> = {
    A: 'Création des runners',
    B: 'Chaînes de spec',
    C: 'Fichiers & dossiers',
    D: 'Assertions',
    F: 'Imports & protection de la prod',
    W: 'Specs website & mobile',
    I: 'Architecture du code source',
    J: 'Hygiène',
    K: 'Rétro-propagation',
};

/**
 * The **statique** channel — one entry per shipped `jterrazz/*` rule. Each rule
 * file attaches its entry as `meta.docs`, so a rule and its normative text can
 * never drift (the completeness meta-test asserts every rule carries one).
 */
export const RULE_DOCS: Record<string, RuleDoc> = {
    'a1-specification-file': {
        channel: 'statique',
        convention:
            'Un runner ne se crée que dans un fichier `*.specification.ts` sous `specs/` : appeler `specification.*` ailleurs est une erreur.',
        family: 'A',
        id: 'A1',
        rationale:
            'Ancrer les runners à un nom de fichier reconnaissable rend le point d’entrée détectable et garde les tests déclaratifs.',
    },
    'a10-duplicate-binding': {
        channel: 'statique',
        convention:
            'Dans un même record `services`, deux clés ne peuvent pas se lier au même service compose (même dérivation kebab-case, ou même `composeService`).',
        family: 'A',
        id: 'A10',
        rationale:
            'Une seconde liaison masquerait silencieusement la première dans ce qui est une map.',
    },
    'a2-known-constructors': {
        channel: 'statique',
        convention:
            'Cinq constructeurs et seulement cinq : `specification.api()`, `specification.jobs()`, `specification.cli(bin)`, `specification.website()`, `specification.mobile()` ; tout autre membre (`.app`, `.http`, `.stack`…) est une erreur.',
        family: 'A',
        id: 'A2',
        rationale:
            'Une surface fermée empêche l’invention de constructeurs parallèles et garde l’API mémorisable.',
    },
    'a3-no-destructure-alias': {
        channel: 'statique',
        convention:
            'Le retour se destructure avec le nom canonique du constructeur, sans alias (`{ api, cleanup, docker }`) ; renommer (`{ api: monApi }`) est une erreur.',
        family: 'A',
        id: 'A3',
        rationale:
            'Un nom d’instance unique par facette rend chaque spec lisible sans contexte local.',
    },
    'a4-cleanup-afterall': {
        channel: 'statique',
        convention:
            'Le fichier de specification passe `cleanup` à `afterAll` ; un `cleanup` destructuré mais jamais transmis est une erreur.',
        family: 'A',
        id: 'A4',
        rationale:
            'Garantir le teardown évite les conteneurs et connexions qui fuient entre fichiers.',
    },
    'a5-mode-with-server': {
        channel: 'statique',
        convention:
            '`mode` n’existe que sur `specification.api()` et n’est jamais hardcodé quand `server` est défini — le switch vit dans `vitest.config.ts`.',
        family: 'A',
        id: 'A5',
        rationale:
            'Sortir le mode du fichier de spec permet d’exécuter le même test en node et en compose sans le modifier.',
    },
    'a6w-redundant-compose-service': {
        channel: 'statique',
        convention:
            '`composeService:` dérivable de la clé (égal à la clé exacte ou à sa conversion kebab-case) est redondant → warning.',
        family: 'A',
        id: 'A6',
        rationale:
            'Signaler la redondance garde les records `services` minimaux et évite le bruit qui masque les vrais overrides.',
    },
    'a9w-redundant-root': {
        channel: 'statique',
        convention:
            '`root` pointant vers le dossier que la remontée automatique aurait trouvé est redondant → warning.',
        family: 'A',
        id: 'A9',
        rationale:
            'La détection par convention doit rester le défaut ; un `root` explicite ne se justifie que là où elle échoue.',
    },
    'b2-known-fixture-marker': {
        channel: 'statique',
        convention:
            'Un marqueur `$…` inconnu dans un littéral passé à `.fixture()` est une erreur (seul `$FIXTURES` est connu).',
        family: 'B',
        id: 'B2',
        rationale:
            'Attraper un marqueur fautif statiquement évite un chemin de fixture résolu au hasard à l’exécution.',
    },
    'b4-given-then': {
        channel: 'statique',
        convention:
            'Chaque test contient `// Given -` puis `// Then -` (les deux, dans cet ordre) ; Given déclaré après Then est une erreur. Un document `<cas>.spec.yaml` n’a pas de commentaires : sa narration est sa `description:`.',
        family: 'B',
        id: 'B4',
        rationale:
            'La narration Given/Then rend l’intention du test lisible sans lire les assertions.',
    },
    'b5-await-using': {
        channel: 'statique',
        convention:
            'Le résultat d’un runner docker-aware se lie avec `await using` ; une assignation nue est une erreur. Canal principal : l’inférence checker (b5-await-using-inference).',
        family: 'B',
        id: 'B5',
        rationale:
            '`await using` garantit le nettoyage des conteneurs créés par le binaire testé, même en cas d’échec.',
    },
    'b6w-redundant-env-url': {
        channel: 'statique',
        convention:
            '`.env({ <SERVICE>_URL: ….connectionString })` répète l’injection automatique du framework → warning.',
        family: 'B',
        id: 'B6',
        rationale:
            'L’injection couvre déjà les URLs de services ; les réécrire à la main invite au décalage.',
    },
    'b8-kebab-trigger': {
        channel: 'statique',
        convention:
            '`.trigger(name)` prend un identifiant kebab-case stable ; un `name` non kebab-case est une erreur.',
        family: 'B',
        id: 'B8',
        rationale:
            'Le nom de job est un contrat entre l’app et les tests — un identifiant stable interdit les traductions divergentes.',
    },
    'b9w-product-command': {
        channel: 'statique',
        convention:
            'Un `specification.cli(bin)` dont le binaire résout dans le `node_modules/.bin` d’une dépendance teste l’outil tiers, pas la commande produit → warning (suppression avec raison admise).',
        family: 'B',
        id: 'B9',
        rationale:
            'Une spec doit exercer la vraie commande du produit ; les assertions par outil passent par `result.grep`.',
    },
    'c1-domain-structure': {
        channel: 'statique',
        convention:
            'La forme de l’arbre `specs/` se déclare via l’option `depth` : `facet-domain` (défaut — `*.test.ts` à la profondeur facet/domain, `*.specification.ts` au root de la facette), `facet` (test au root de la facette OU un dossier domaine plus bas, jamais plus profond), `mirror` (test à toute profondeur ≥ 1, nommé d’après son dossier), `off`. Dans tous les modes, `off` compris : un dossier à underscore initial est du SOL, jamais un domaine — aucune spec ne vit dedans. Une exception, et une seule : le sol peut être du CODE, et un `<module>.test.ts` posé À CÔTÉ du `<module>.ts` qu’il teste y est légal (c’est la loi I2) ; un test sans module voisin, ou un `*.specification.ts`, reste une violation.',
        family: 'C',
        id: 'C1',
        rationale:
            'Une profondeur fixe rend la place de chaque fichier prévisible et détectable statiquement.',
    },
    'c10-contracts-boundary': {
        channel: 'statique',
        convention:
            'Hors de `specs/**/contracts/`, un import qui résout dans un dossier de provider (`contracts/{http,openai,anthropic}/…`) est une erreur : un test n’importe que les façades `*.contracts.ts`.',
        family: 'C',
        id: 'C10',
        rationale:
            'Les contrats unitaires sont des détails de composition ; passer par la façade garde chaque scénario nommé au même endroit que le monde dont il dérive.',
    },
    'c11-contract-data-pairing': {
        channel: 'statique',
        convention:
            'Dans un dossier de provider, tout `*.response.json` et tout `*.request.ts` a un frère `<souche>.ts` — la souche est le nom jusqu’au PREMIER point (`events.fr.response.json` → `events.ts`) ; une donnée orpheline est une erreur.',
        family: 'C',
        id: 'C11',
        rationale:
            'Une donnée n’existe que servie par un contrat — un fichier sans propriétaire est du poids mort qu’aucun test ne charge.',
    },
    'c13-underscored-ground': {
        channel: 'statique',
        convention:
            'Sous `specs/`, le sol d’une spec porte un underscore initial : `_fixtures/`, `_expected/`, `_requests/`, `_seeds/`. Un dossier `fixtures/`, `expected/`, `requests/` ou `seeds/` est un nom d’avant la 14 — erreur nommant le renommage.',
        family: 'C',
        id: 'C13',
        rationale:
            'Aucun résolveur ne lit plus le nom sans underscore : gardé tel quel, l’arbre devient invisible plutôt que faux, et l’échec arrive une étape plus loin que sa cause.',
    },
    'c2-http-only-requests': {
        channel: 'statique',
        convention:
            '`_requests/` ne contient que des fichiers `.http` ; toute autre extension est une erreur.',
        family: 'C',
        id: 'C2',
        rationale:
            'Une entrée de requête est un `.http` complet — homogénéiser le dossier interdit les formats ad hoc.',
    },
    'c4-contract-shape': {
        channel: 'statique',
        convention:
            'Sous `specs/**/contracts/` : la RACINE ne porte que des façades `*.contracts.ts` (export default construit par `defineContracts(...)` ou une re-export de composition ; exports nommés = scénarios) et les dossiers de provider `http` | `openai` | `anthropic`. Un contrat unitaire est `<provider>/<nom-kebab>.ts` avec un `export default defineContract(...)` (ou une factory qui en retourne un), et son builder de `request` doit désigner le provider de son dossier. Un dossier de provider est plat et ne contient que des `*.ts` et des `*.response.json`.',
        family: 'C',
        id: 'C4',
        rationale:
            'Une arborescence figée sépare la façade publique des unités internes et fait porter le provider par le DOSSIER — les noms de fichiers redeviennent du métier, et la donnée volumineuse se range à côté du contrat qui la sert.',
    },
    'c6-tomatch-extension': {
        channel: 'statique',
        convention:
            "L’argument de `toMatch` porte son extension (`'help.txt'`), sauf pour les snapshots d’arborescence (dossiers) ; un sujet fichier sans extension est une erreur.",
        family: 'C',
        id: 'C6',
        rationale:
            'L’extension fait partie du nom du fichier attendu — l’omettre casse la résolution `_expected/`.',
    },
    'c7-seeds-sql-only': {
        channel: 'statique',
        convention: '`_seeds/` ne contient que des `*.sql` ; tout autre fichier est une erreur.',
        family: 'C',
        id: 'C7',
        rationale:
            '`.seed()` porte l’état des bases uniquement — pas de seed-handler ni de dispatch par préfixe.',
    },
    'c8-referenced-fixture-exists': {
        channel: 'statique',
        convention:
            'Un littéral de `.request`/`.seed`/`.fixture`/`toMatch` doit exister sur disque sous sa racine conventionnelle ; un chemin absent est une erreur.',
        family: 'C',
        id: 'C8',
        rationale:
            'Attraper un typo statiquement évite un échec qui ne surviendrait qu’à l’exécution.',
    },
    'd2-await-io-matcher': {
        channel: 'statique',
        convention:
            'Un matcher IO (`toMatchRows`/`toBeEmpty`/`toBeRunning`) doit être awaité ou retourné ; sinon l’assertion ne s’exécute jamais → erreur.',
        family: 'D',
        id: 'D2',
        rationale:
            'Une assertion IO non attendue passe silencieusement — le pire mode d’échec d’un test.',
    },
    'd2w-await-sync-matcher': {
        channel: 'statique',
        convention:
            '`await` sur un matcher toujours synchrone (`toBe`/`toEqual`/`toContain`/`toHaveLength`) est redondant → warning.',
        family: 'D',
        id: 'D2',
        rationale: 'Un await inutile masque le signal qui distingue les vrais matchers IO.',
    },
    'd6w-transform-token-equivalent': {
        channel: 'statique',
        convention:
            'Un `transform` qui ne fait que réécrire vers des équivalents de tokens standard duplique la grammaire → warning.',
        family: 'D',
        id: 'D6',
        rationale:
            '`transform` est une échappatoire pour le bruit non couvert par les tokens — pas un doublon des tokens.',
    },
    'd8w-text-bypass': {
        channel: 'statique',
        convention:
            '`expect(x.text).toContain/toMatch` court-circuite le sujet accesseur typé → warning.',
        family: 'D',
        id: 'D8',
        rationale:
            "Asserter sur `.text` jette la grammaire de tokens et la résolution `toMatch('fichier')` du sujet.",
    },
    'd9w-single-use-ref': {
        channel: 'statique',
        convention:
            'Une ref de capture (`match.ref`, `{{kind#ref}}`) qui n’apparaît qu’une seule fois dans tout le fichier (code + fixtures `_expected/` référencées) porte un nom inutilement → warning.',
        family: 'D',
        id: 'D9',
        rationale:
            'Une ref ne se justifie que si elle asserte l’égalité sur au moins deux occurrences.',
    },
    'd12w-response-body-probe': {
        channel: 'statique',
        convention:
            "Un test qui accumule un AMAS de sondes brutes sur `.response.body` (≥ `threshold`, défaut 3 ; une variable castée depuis `.response.body` compte ses lectures) → warning : ce cas veut un golden complet (`expect(result.response).toMatch('cas.http')`). Une ou deux sondes restent silencieuses (scalpel légitime).",
        family: 'D',
        id: 'D12',
        rationale:
            'Le golden complet capture toute la forme et sa grammaire de tokens ; un amas de sondes brutes le remplace par des checks ad hoc qui dérivent (mécanise la frontière D11 pour les réponses API).',
    },
    'd13w-unfrozen-negative-fixture': {
        channel: 'statique',
        convention:
            'Un `toMatch` dont l’échec EST le sujet du test (enveloppé dans `expect(() => …).toThrow()` ou `expect(…).rejects.toThrow()`) doit porter `{ frozen: true }` → sinon `TEST_UPDATE=1` réécrit silencieusement la fixture délibérément-fausse au lieu de lever → warning. Le résidu passé par un helper (`catchMessage(() => …toMatch(…))`) échappe à l’analyse statique (voir la note process D13).',
        family: 'D',
        id: 'D13',
        rationale:
            'En mode update, un matcher non gelé écrit au lieu de lever : la fixture négative est corrompue par sa propre sortie réelle et l’assertion ne teste plus rien. `frozen` fige la fixture négative.',
    },
    'd15w-status-only-probe': {
        channel: 'statique',
        convention:
            "Un test de spec dont les SEULES assertions sont des sondes de statut HTTP (`expect(X.status).toBe(N)` / `.toEqual(N)`, N littéral numérique 100–599) → warning : ce cas veut un golden complet (`expect(result.response).toMatch('cas.http')`). Une sonde de statut À CÔTÉ d’une vraie assertion (golden, `toMatchRows`, `toContain`…) reste silencieuse (scalpel légitime).",
        family: 'D',
        id: 'D15',
        rationale:
            'Un statut isolé ne fige que le code de réponse et jette tout le reste du payload ; le golden complet capture la forme entière et sa grammaire de tokens (complète d12w, qui exige un amas de sondes de corps et manque le cas de la sonde de statut solitaire).',
    },
    'f1-no-subpath-import': {
        channel: 'statique',
        convention:
            'Tout s’importe depuis `@jterrazz/test` ; un import de `@jterrazz/test/<subpath>` est une erreur, sauf les subpaths que la map `exports` du paquet publie — `@jterrazz/test/oxlint` (plugin de lint) et `@jterrazz/test/vitest` (surface de configuration du runner) — exemptés partout. La liste est LUE du manifeste, jamais recopiée dans la règle.',
        family: 'F',
        id: 'F1',
        rationale:
            'Un point d’entrée unique garde l’API publique explicite et les subpaths internes invisibles.',
    },
    'f2-no-test-imports-in-prod': {
        channel: 'statique',
        convention:
            'Un fichier de prod n’importe jamais `vitest`, `@jterrazz/test`, un `*.test.*`, un `*.fixtures.*` ni `mockOf`/`mockOfDate` (exception : `@jterrazz/test/oxlint`).',
        family: 'F',
        id: 'F2',
        rationale:
            'Empêcher les artefacts de test de fuir en prod protège le bundle applicatif du consommateur.',
    },
    'f3-specs-public-entry': {
        channel: 'statique',
        convention:
            'Depuis `specs/`, seul l’import en profondeur des INTERNES du framework est interdit : un chemin relatif résolvant dans `src/{core,integrations,vitest,lint}/` du dépôt du framework, ou tout `@jterrazz/test/<subpath>` autre que `@jterrazz/test/oxlint`. Les imports de la source de SA PROPRE app par un consommateur sont toujours permis (c’est le motif documenté) ; seul `specs/integrations/` peut importer en profondeur `src/integrations/**`.',
        family: 'F',
        id: 'F3',
        rationale:
            'Tester par la surface publique garde les specs découplées des chemins internes du framework, sans gêner le consommateur qui importe sa propre app.',
    },
    'f4-no-test-to-test-import': {
        channel: 'statique',
        convention: 'Un `*.test.ts` n’importe jamais un autre `*.test.ts`.',
        family: 'F',
        id: 'F4',
        rationale:
            'Le partage entre tests passe par des `*.fixtures.ts`, pas par des imports test-à-test qui couplent les fichiers.',
    },
    'f5-fixtures-only-from-tests': {
        channel: 'statique',
        convention: 'Un `*.fixtures.ts` n’est importable que depuis des `*.test.ts`.',
        family: 'F',
        id: 'F5',
        rationale:
            'Cantonner les fixtures aux tests empêche la donnée de test de fuir dans le code de prod.',
    },
    'i1-layer-boundaries': {
        channel: 'statique',
        convention:
            'Le projet DÉCLARE ses couches sous `src/` via l’option `layers` (paquets autorisés, imports internes, un dossier = une dépendance, seams) ; tout import hors des arêtes déclarées est une erreur. Sans carte de couches, la règle est inerte.',
        family: 'I',
        id: 'I1',
        rationale:
            'Une architecture appartient au projet : des frontières déclarées se vérifient, une architecture supposée se contourne.',
    },
    'i2-sibling-test-naming': {
        channel: 'statique',
        convention:
            'Le test de `<fichier>.ts` est `<fichier>.test.ts` à côté de lui ; un `.test.ts` mal nommé, ou un dossier `__tests__/`, est une erreur.',
        family: 'I',
        id: 'I2',
        rationale:
            'Des tests voisins (parité avec le `foo_test.go` de Go) gardent test et code ensemble et découvrables.',
    },
    'i4-no-vi-mock-in-src': {
        channel: 'statique',
        convention:
            'Sous `src/`, `vi.mock`, `__mocks__/`, `__fixtures__/` et l’import d’un asset de données (`.json`, `.sql`, `.yaml`, …) depuis un `.test.ts` sont interdits ; un spécifieur pointé (`./dashboard.post`) reste du code.',
        family: 'I',
        id: 'I4',
        rationale:
            'Dans les tests de module, mocks et données sont du CODE (`mockOf`, `*.fixtures.ts`) ; un vrai fichier appelle une spec.',
    },
    'j1-no-only-skip': {
        channel: 'statique',
        convention: 'Aucun `.only` / `.skip` committé (`describe.only`, `test.only`, `test.skip`).',
        family: 'J',
        id: 'J1',
        rationale: 'Un `.only`/`.skip` oublié désactive silencieusement une partie de la suite.',
    },
    'j2-no-sleep-in-specs': {
        channel: 'statique',
        convention:
            'Aucun sleep arbitraire (`setTimeout`/`setInterval`/`Atomics.wait`) sous `specs/**` — la synchronisation passe par `waitFor`.',
        family: 'J',
        id: 'J2',
        rationale:
            'Un sleep fixe rend les tests lents et instables ; attendre une condition est déterministe.',
    },
    'j3-no-expectless-test': {
        channel: 'statique',
        convention:
            'Un `test(...)` avec callback contient au moins un `expect(…)` ; `test.todo` (sans callback) est ignoré.',
        family: 'J',
        id: 'J3',
        rationale:
            'Un test sans assertion est mort ou muet — il passe toujours sans rien vérifier.',
    },
    'j4-unique-test-names': {
        channel: 'statique',
        convention:
            'Deux tests d’un même fichier ne partagent pas un nom littéral (`.each` ignoré).',
        family: 'J',
        id: 'J4',
        rationale:
            'Le nom du test est son unique description — deux noms identiques rendent un échec ambigu.',
    },
    'j5-lowercase-title': {
        channel: 'statique',
        convention:
            'La première lettre d’un titre `test()`/`describe()`/`it()` littéral est en minuscule. Exemptés : les titres dont le premier MOT est un identifiant tout en majuscules/underscores (`VALID_CATEGORIES`, `HTTP`, `DI`) et ceux démarrant sur un non-lettre — seuls les premiers mots de prose minusculisables sont contraints.',
        family: 'J',
        id: 'J5',
        rationale:
            'Un titre est un fragment de prose, pas une phrase — la casse minuscule le garde fragmentaire ; minusculiser un symbole nommé le mal-orthographierait.',
    },
    'w1-scenario-pure': {
        channel: 'statique',
        convention:
            'Un scénario (`.visit()` website, `.open()` mobile) est le When : le visiteur agit, la capture reflète l’état final ; aucun `expect()` dans le callback — les assertions vivent dans le Then, sur le résultat retourné.',
        facet: 'shared',
        family: 'W',
        id: 'W1',
        rationale:
            'Séparer l’interaction de l’assertion garde la grammaire setup → action → résultat intacte et les scénarios rejouables.',
    },
    'w2w-user-facing-elements': {
        channel: 'statique',
        convention:
            'Les éléments d’un scénario sont user-facing (`button`, `link`, `field`, `heading`, `content` ; côté mobile `button`, `field`, `content`) ; `testId()` est l’unique échappatoire et déclenche un avertissement.',
        facet: 'shared',
        family: 'W',
        id: 'W2',
        rationale:
            'Tester ce que l’utilisateur voit (rôles, labels) rend les specs robustes aux refontes DOM ; un test-id contourne cette garantie.',
    },
};

/**
 * The **checker** channel — the non-oxlint static passes bundled as
 * `dist/checker.js` (token/HTTP grammar + cross-file analyses). Oxlint never
 * visits data fixtures nor reads two files at once, so these ship separately.
 */
export const CHECKER_PASSES: CatalogEntry[] = [
    {
        channel: 'checker',
        convention:
            'Tout `{{token}}` dans une fixture `_expected/` — ou dans un flux attendu d’un document `<cas>.spec.yaml` — appartient au vocabulaire figé ; un token inconnu est une erreur.',
        family: 'D',
        id: 'D4',
        name: 'd4-unknown-token',
        rationale:
            'Une grammaire fermée partagée avec le matcher runtime empêche la dérive entre canaux.',
    },
    {
        channel: 'checker',
        convention:
            'Une ref malformée d’un kind connu (`{{iso8601#}}`, `{{uuid #id}}`) dans un fichier texte sous `_expected/` est une erreur.',
        family: 'D',
        id: 'D4',
        name: 'd4-malformed-ref',
        rationale:
            'Une capture malformée échouerait silencieusement — la signaler la rend visible tôt.',
    },
    {
        channel: 'checker',
        convention:
            'La première ligne d’un `.http` de profondeur 1 suit sa grammaire : requête (`MÉTHODE /path`) sous `_requests/`, statut (`HTTP/1.1 <status>`) sous `_expected/`.',
        family: 'D',
        id: 'D4b',
        name: 'd4b-http-first-line',
        rationale:
            'La ligne d’ouverture distingue une requête d’une réponse — la contraindre attrape les fichiers mal placés.',
    },
    {
        channel: 'checker',
        convention:
            'Un document `<cas>.spec.yaml` respecte sa grammaire : clés fermées au niveau du document (`kind`, `description`, `fixture`, `env`, `serve`, `runs`) comme dans un run (`command`, `stdin`, `timeout`, `waitFor`, `exit`, `stdout`, `stderr`, `files`), `description:` et `runs:` obligatoires, `command:` et `exit:` obligatoires dans chaque run, `exit:` entier littéral, `waitFor:` seulement sur le dernier run et jamais avec `stdin:`, chemin `files:` relatif et sous le workdir.',
        family: 'D',
        id: 'D4b',
        name: 'd4b-spec-shape',
        rationale:
            'La grammaire est lue par le parseur du runner lui-même : le document que le lint accepte est exactement celui que le runner exécute.',
    },
    {
        channel: 'checker',
        convention:
            'Les clés d’un `<cas>.spec.yaml` suivent l’ordre canonique — `kind, description, fixture, env, serve, runs` au niveau du document, `command, stdin, timeout, waitFor, exit, stdout, stderr, files` dans un run. Corrigeable (`--fix`).',
        family: 'D',
        id: 'D4b',
        name: 'd4b-spec-key-order',
        rationale:
            'Le décor avant la session, l’entrée avant la sortie : un ordre unique rend les documents comparables et supprime les diffs qui ne changent rien.',
    },
    {
        channel: 'checker',
        convention:
            '`stdout`, `stderr`, `stdin` et `files.*.equals` d’un `<cas>.spec.yaml` s’écrivent en scalaire bloc (`|` garde le saut de ligne final, `|-` le supprime), jamais en chaîne entre guillemets avec des `\\n`. Corrigeable (`--fix`).',
        family: 'D',
        id: 'D4b',
        name: 'd4b-spec-block-scalar',
        rationale:
            'Une sortie attendue doit ressembler à une sortie — une golden sur une ligne est illisible et aucun diff ne peut la montrer.',
    },
    {
        channel: 'checker',
        convention:
            'Un document se nomme `<cas>.spec.yaml` : `<cas>` en kebab-case, sans les mots `test`/`spec`/`cli` que le suffixe porte déjà, et jamais le nom nu de son dossier.',
        family: 'C',
        id: 'C12',
        name: 'c12-spec-file-name',
        rationale:
            'Le nom du fichier est la première phrase que le lecteur lit ; `rm/rm.spec.yaml` ne dit rien deux fois.',
    },
    {
        channel: 'checker',
        convention:
            'La `description:` d’un document est un titre : une seule ligne, initiale minuscule (identifiant tout en majuscules exempté), sans point final, moins de 100 caractères.',
        family: 'J',
        id: 'J5',
        name: 'j5-spec-description',
        rationale:
            'La description EST le titre vitest — les règles du titre s’y appliquent, pas celles d’un paragraphe.',
    },
    {
        channel: 'checker',
        convention:
            'Deux `<cas>.spec.yaml` d’un même dossier ne partagent pas leur `description:`.',
        family: 'J',
        id: 'J4',
        name: 'j4-spec-description-unique',
        rationale:
            'Le rapporteur nomme le titre : deux titres identiques laissent deux fichiers à ouvrir.',
    },
    {
        channel: 'checker',
        convention:
            'Un flux attendu ne contient pas de valeur volatile littérale : origine loopback avec port (`127.0.0.1:8080`, `localhost:3000`), chemin temporaire absolu (`/tmp/`, `/private/tmp/`, `/var/folders/`) ou chemin home (`/Users/…`, `/home/…`). Le message nomme le token à écrire.',
        family: 'D',
        id: 'D5',
        name: 'd5-spec-volatile-literal',
        rationale:
            'C’est exactement la forme qu’un `TEST_UPDATE` aurait tokenisée : en trouver une signifie qu’un token a été écrasé à la main.',
    },
    {
        channel: 'checker',
        convention:
            'Un horodatage ISO-8601 ou un uuid littéral dans un flux attendu → warning, sauf si la même valeur apparaît dans un `fixture:` ou un `stdin:` du même document (elle est alors fixée, pas volatile).',
        family: 'D',
        id: 'D5',
        name: 'd5w-spec-pinned-value',
        rationale: 'Le défaut n’est pas le littéral : c’est le littéral que rien n’a fixé.',
    },
    {
        channel: 'checker',
        convention:
            'Un flux attendu dont tout le contenu est `{{any}}` → warning : le run s’exécute et ne prouve rien.',
        family: 'J',
        id: 'J3',
        name: 'j3w-spec-empty-assertion',
        rationale:
            'Le miroir de J3 pour les documents — une assertion qui accepte tout est une assertion absente.',
    },
    {
        channel: 'checker',
        convention:
            'Un run dont `exit:` est non nul sans `stdout:` ni `stderr:` → warning : le document ne dit pas pourquoi la commande a refusé.',
        family: 'D',
        id: 'D11',
        name: 'd11w-spec-silent-refusal',
        rationale:
            'Un refus muet est soit un défaut du produit, soit une golden qui a oublié que les mots partaient sur stderr.',
    },
    {
        channel: 'checker',
        convention:
            'Les mots nus d’`env:` et les noms de `serve:` d’un document sont des clés des objets `env`/`serve` d’un `specification.cli(…)` du plus proche dossier portant des `*.specification.ts` (lecture statique des littéraux ; ignoré sinon).',
        family: 'C',
        id: 'C8',
        name: 'c8-spec-registered-name',
        rationale:
            'Une faute de frappe (`serve: dashbord`) échoue aujourd’hui à l’exécution, un fichier de test plus tard ; ici c’est une ligne de lint.',
    },
    {
        channel: 'checker',
        convention:
            'Un token connu dans un fichier sous `_requests/` → warning : les requêtes sont des entrées, jamais matchées.',
        family: 'D',
        id: 'D10',
        name: 'd10w-tokens-in-requests',
        rationale:
            'Un token dans une entrée ne sera ni validé ni substitué — c’est presque toujours une erreur.',
    },
    {
        channel: 'checker',
        convention:
            'Aucune fixture morte : tout fichier sous `_seeds/`/`_requests/`/`_fixtures/` et toute entrée de premier niveau de `_expected/` doit être référencée ; un dossier de feature sans `*.test.ts` ni `*.spec.yaml` est orphelin (warning si argument non littéral). Un `<cas>.spec.yaml` référence les fixtures nommées par ses entrées `fixture:`.',
        family: 'C',
        id: 'C9',
        name: 'c9-dead-fixtures',
        rationale:
            'Le miroir de C8 — une fixture que rien ne référence est du poids mort qui trompe le lecteur.',
    },
    {
        channel: 'checker',
        convention:
            'Une fixture du pool est PARTAGÉE, ou elle est locale : un dossier de `<specs>/_fixtures/` référencé (`$FIXTURES/<nom>`) depuis un seul dossier de spec — deux documents d’une même feuille comptent pour un — doit vivre à côté de cette feuille, en `<feuille>/_fixtures/<nom>/`, référencé par la forme relative. Zéro référence reste l’erreur de fixture morte (C9). Corrigé par `--fix` : le dossier est déplacé et les littéraux réécrits.',
        family: 'C',
        id: 'C14',
        name: 'c14-pool-fixture-shared',
        rationale:
            'Une fixture d’un seul scénario garée dans le pool se lit comme du sol partagé : chacun suppose qu’un autre en dépend et personne n’ose y toucher.',
    },
    {
        channel: 'checker',
        convention:
            'Une fixture locale ne se lit que depuis son propre dossier : un chemin `fixture:`/`.fixture()` contenant `..`, ou dont la cible sort du `_fixtures/` de la spec qui le nomme, est une erreur — le sol partagé par plusieurs feuilles va dans le pool `$FIXTURES`.',
        family: 'C',
        id: 'C15',
        name: 'c15-local-fixture-reach',
        rationale:
            'Une feuille qui pioche dans les fixtures d’une voisine, c’est le pool par une autre porte, sans la visibilité du pool : la voisine casse une spec à deux dossiers de là sans le savoir.',
    },
    {
        channel: 'checker',
        convention:
            'Canal principal de B5 : les runners docker-aware sont inférés de l’option `docker:` du fichier de specification importé, puis chaque résultat `.exec()` lié sans `await using` est signalé.',
        family: 'B',
        id: 'B5',
        name: 'b5-await-using-inference',
        rationale:
            'Inférer les runners supprime la liste à maintenir à la main de la règle oxlint.',
    },
    {
        channel: 'checker',
        convention:
            'Avec ≥ 2 bases, `database:` est obligatoire sur chaque `.seed()`/`.table()` ; avec une seule, il est interdit — vérifié en croisant le record `services:` avec les appels des tests.',
        family: 'A',
        id: 'A7',
        name: 'a7-database-property',
        rationale:
            'Le nombre de bases fixe l’API d’appel ; l’analyse cross-fichier attrape l’omission avant le runtime.',
    },
];

/**
 * The **runtime** channel — refusals and behaviours the framework enforces at
 * execution time, where static analysis abstains (non-literal arguments) or
 * cannot reach (network, container lifecycle). Several double a static pass.
 */
export const RUNTIME_RULES: CatalogEntry[] = [
    {
        channel: 'runtime',
        convention:
            'Un binding ambigu (le compose déclare à la fois la clé exacte ET sa forme kebab-case) est refusé à l’exécution.',
        family: 'A',
        id: 'A6',
        name: 'a6-ambiguous-binding',
        rationale:
            'Le framework ne devine pas — il exige un renommage ou un `composeService` explicite.',
    },
    {
        channel: 'runtime',
        convention:
            'Le framework lève à l’exécution si `database:` est absent avec ≥ 2 bases, ou présent avec une seule (double le canal checker).',
        family: 'A',
        id: 'A7',
        name: 'a7-database-runtime',
        rationale: 'Le runtime garde la garantie même là où l’analyse statique s’abstient.',
    },
    {
        channel: 'runtime',
        convention:
            'Le framework refuse à l’exécution un marqueur `$…` inconnu, ou un `$FIXTURES` sans dossier `specs` ancêtre (message guidant).',
        family: 'B',
        id: 'B2',
        name: 'b2-unknown-marker-runtime',
        rationale:
            'Un message runtime guide l’auteur quand la faute échappe au canal statique (argument non littéral).',
    },
    {
        channel: 'runtime',
        convention:
            'En mode `cli` avec `services`, le framework injecte `<CLÉ>_URL` (CONSTANT_CASE camel-aware) plus les alias non ambigus `DATABASE_URL`/`REDIS_URL` ; `.env()` override (`null` retire).',
        family: 'B',
        id: 'B6',
        name: 'b6-url-injection',
        rationale: 'Injecter les URLs évite le câblage manuel répété et son décalage (voir b6w).',
    },
    {
        channel: 'runtime',
        convention:
            'Dès qu’une chaîne `api`/`jobs` déclare un intercept, toute requête sortante non matchée (y compris une file épuisée) fait échouer le spec avec une erreur explicite.',
        family: 'D',
        id: 'D7',
        name: 'd7-strict-intercepts',
        rationale: 'Un réseau gardé rend les interactions externes exhaustives et intentionnelles.',
    },
    {
        channel: 'runtime',
        convention:
            '`toMatch` sur un sujet accesseur (`stream`/`json`/`response`/arborescence) attend un NOM de fixture (extension comprise) : passer une `RegExp` (ou tout non-string) lève immédiatement, en nommant le sujet et l’échappatoire `expect(x.text).toMatch(/re/)`.',
        family: 'D',
        id: 'D14',
        name: 'd14-tomatch-fixture-name',
        rationale:
            'L’instinct hérité de vitest (`toMatch(/re/)`) tomberait sinon sur l’erreur d’extension ou coercerait la regex en `"/re/"`. L’argument accesseur n’est jamais littéral côté valeur, et une heuristique statique confondrait le `expect(chaîne).toMatch(/re/)` légitime (D3/D8) — seul le canal runtime refuse proprement, sans faux positifs.',
    },
    {
        channel: 'runtime',
        convention:
            'Un descripteur d’élément doit désigner exactement UN élément quand un verbe AGIT dessus (`click`/`tap`/`fill`) : si plusieurs correspondent, l’action est refusée avec une erreur qui énumère les candidats et propose les réécritures (`within(...)`, `{ exact: true }`). Le framework n’agit jamais sur « le premier ». Vaut pour les deux facettes à scénario : website et mobile ; sur mobile, `see()` — qui n’agit sur rien — est satisfait par n’importe quel match visible (l’arbre XCUITest duplique légitimement un label entre conteneur et enfant).',
        facet: 'shared',
        family: 'W',
        id: 'W3',
        name: 'w3-unambiguous-element',
        rationale:
            'Agir sur le premier match rend le spec vert alors que le visiteur clique autre chose, et rien ne le signale jamais — une ambiguïté est une faute d’écriture, pas un cas à arbitrer par l’ordre du DOM. Le comptage n’existe qu’à l’exécution : aucune analyse statique ne peut le faire, d’où le canal runtime.',
    },
    {
        channel: 'runtime',
        convention:
            'Le vocabulaire d’éléments est UNIQUE entre les facettes website et mobile ; un landmark ARIA (`main()`, `navigation()`…) passé à un verbe mobile est refusé à l’exécution — un écran iOS n’a pas de régions ARIA ; scoper avec `within(testId(…), …)`.',
        facet: 'mobile',
        family: 'W',
        id: 'W4',
        name: 'w4-no-landmarks-on-mobile',
        rationale:
            'Un seul vocabulaire garde l’API mémorisable ; refuser explicitement la partie sans équivalent iOS évite une approximation silencieuse.',
    },
    {
        channel: 'runtime',
        convention:
            '`.intercept()` n’existe que sur `api`/`jobs` et lève immédiatement en mode compose (MSW est in-process).',
        family: 'I',
        id: 'I3',
        name: 'i3-intercept-compose',
        rationale:
            'Un child process ou un conteneur n’est pas interceptable par MSW — l’erreur oriente vers un projet node-only.',
    },
];

/**
 * The **process** channel — rules no channel can fully mechanize: they are a
 * matter of review judgement. Listed here so the catalogue is complete across
 * all four faces; the constitution keeps their full rationale.
 */
export const PROCESS_RULES: CatalogEntry[] = [
    {
        channel: 'process',
        convention:
            'Le dossier suit les assets : un test avec ses propres dossiers d’assets a son propre domaine ; des tests sans assets locaux se regroupent en `<aspect>.test.ts` frères. La règle statique ne vérifie que la profondeur.',
        family: 'C',
        id: 'C1',
        name: 'c1-asset-grouping',
        rationale:
            'Ce sont les assets qui tranchent le regroupement — un critère qu’aucun canal ne peut décider seul.',
    },
    {
        channel: 'process',
        convention:
            'La sortie d’un outil s’asserte en snapshot complet par use case scopé, pas en grappe de `grep` ; `.grep()` reste le scalpel pour les sondes ciblées.',
        family: 'D',
        id: 'D11',
        name: 'd11-golden-file',
        rationale:
            'Jugement de revue — le canal statique ne distingue pas un grep légitime d’un grep paresseux.',
    },
    {
        channel: 'process',
        convention:
            'Une fixture délibérément-fausse ou manquante, asservie à un test négatif, porte `{ frozen: true }` sur son `toMatch`. La règle statique d13w couvre les formes enveloppées (`expect(() => …).toThrow()` / `.rejects`) ; le résidu — un `toMatch` routé via un helper qui possède le try/catch (`catchMessage(() => …)`) — relève de la revue, faute d’analyse inter-procédurale.',
        family: 'D',
        id: 'D13',
        name: 'd13-frozen-negative-fixture',
        rationale:
            'Le helper masque le point de capture au canal statique ; la revue garde la même invariante que d13w là où l’AST ne suffit pas.',
    },
    {
        channel: 'process',
        convention:
            'Toute classe de défaut découverte produit, dans le même change, la garde qui l’empêche de revenir (règle statique, meta-test ou erreur runtime) — ou documente pourquoi aucun canal n’est possible.',
        family: 'K',
        id: 'K1',
        name: 'k1-retro-propagation',
        rationale:
            'C’est la règle qui fait croître les trois autres canaux au lieu de les laisser pourrir.',
    },
];

/** Split an id into (family letter, numeric, variant) for natural ordering. */
function sortKey(entry: CatalogEntry): [string, number, string] {
    const match = /^(?<letter>[A-Z]+)(?<number>\d+)(?<variant>.*)$/u.exec(entry.id);
    return [
        match?.groups?.letter ?? entry.id,
        Number(match?.groups?.number ?? 0),
        `${match?.groups?.variant ?? ''}:${entry.name}`,
    ];
}

/**
 * The full catalogue, deterministically ordered — the statique rules (from
 * {@link RULE_DOCS}) plus every other channel, sorted by family, then convention
 * number, then variant/name. The generator and the freshness meta-test both
 * consume this, so a stable order keeps generated output byte-identical.
 */
const statiqueEntries: CatalogEntry[] = Object.entries(RULE_DOCS).map(([name, doc]) => ({
    channel: doc.channel,
    convention: doc.convention,
    family: doc.family,
    id: doc.id,
    name,
    rationale: doc.rationale,
}));

export const catalog: CatalogEntry[] = [
    ...statiqueEntries,
    ...CHECKER_PASSES,
    ...RUNTIME_RULES,
    ...PROCESS_RULES,
].sort((a, b) => {
    const [al, an, av] = sortKey(a);
    const [bl, bn, bv] = sortKey(b);
    if (al !== bl) {
        return al.localeCompare(bl);
    }
    if (an !== bn) {
        return an - bn;
    }
    return av.localeCompare(bv);
});
