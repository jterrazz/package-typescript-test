# TODO — roadmap post-v9

Validé avec Jean-Baptiste le 2026-07-18, à la clôture de la campagne v9. Ce fichier est la
source de vérité du backlog produit ; chaque item livré en sort et entre dans les notes de
la release GitHub qui le porte.

---

## 1. Doctrine : l'axe `node` / `compose` est universel (les trois facettes)

**Le constat.** Le mode n'est pas une feature de la facette api — c'est un axe qui traverse
tout le framework : _quel processus exécute le sujet du test_, jamais _ce que le test
vérifie_.

- **`node`** — le processus sous test tourne **sur la machine hôte**, Docker sert
  uniquement aux services (postgres, redis, …). C'est la boucle de dev : démarrage en
  millisecondes, debug natif, watch mode, intercepts in-process (MSW).
- **`compose`** — **l'artefact livré** tourne (l'image Docker, son env, son réseau, sa
  compose config). C'est la CI de fidélité parfaite : ce qui est testé est ce qui est
  déployé.

**Les invariants (déjà en vigueur, à ne jamais casser) :**

- Règle A5 : mêmes fichiers de spec dans les deux modes ; le switch vit UNIQUEMENT dans
  `vitest.config.ts` (projects) via `TEST_MODE` / le param `mode`. Aucun `if (mode)` dans
  un test.
- Le mode ne change pas le vocabulaire : `.get()`, `.trigger()`, `.exec()`, les accesseurs
  et les matchers sont identiques ; seule l'exécution change de côté.
- I3/D7 : les intercepts sont in-process, donc indisponibles en compose — c'est la
  frontière actuelle, levée par l'item 3 (stub-server de contrats).

**État par facette :**

| Facette | `node` (dev loop)                             | `compose` (artefact)                            |
| ------- | --------------------------------------------- | ----------------------------------------------- |
| api     | ✅ serveur in-process (Hono) + testcontainers | ✅ stack compose complète                       |
| jobs    | ✅ handler appelé directement                 | ❌ à concevoir — trigger externalisé (item 2)   |
| cli     | ✅ binaire hôte + workdir tmp isolé           | ❌ à la demande — binaire dans l'image (item 4) |

À inscrire dans la constitution (`docs/12-conventions.md`, famille A) au moment où le premier item
ci-dessous se livre : « le mode ne change pas ce qu'on teste, il change quel processus le
fait ».

---

## 2. v9.1 — jobs en compose, par le type de job

La déclaration des jobs s'enrichit d'un **type** : `cron` (+ expression), `queue`
(+ nom de queue / service), `task` (one-shot). Ce type donne au framework de quoi générer
le trigger compose ET des assertions de déclaration. Découpage par valeur décroissante :

### 2a. Type `queue` — le premier à livrer (frontière propre, zéro hook applicatif)

- En `node` : `.trigger(name)` inchangé (appel direct du handler).
- En `compose` : `.trigger(name)` **publie un vrai message** dans le service queue déclaré
  (redis/rabbit du record `services`) et attend l'effet observable. Ce mode teste ce que
  `node` ne peut pas tester : sérialisation du message, wiring du consumer, ack/retry.
- Assertions : inchangées (`toMatchRows`, goldens) — l'effet reste la base de données /
  la sortie.

### 2b. Type `cron` — golden de déclaration, PAS de test d'horloge

- **Décision ferme (leçons des sagas TZ + retry-backoff de la campagne signews) : on ne
  teste JAMAIS le déclenchement wall-clock.** Tester le timing réel = tester la lib de
  scheduling : lent, flaky, zéro valeur.
- Ce qui se teste : (1) **la table des schedules en golden** — chaque job cron épinglé
  avec son expression (`{{cron}}` token candidat) ; un `0 0 * * *` qui devient
  `0 * * * *` casse le golden en review ; (2) la logique du handler via `.trigger()`
  en node ; (3) **un** smoke de wiring par type de trigger en compose (pas par job).

### 2c. Type `task` — trigger externalisé standardisé

- Convention framework (pas du cas-par-cas consumer) : endpoint ops documenté ou
  `docker exec` d'un entrypoint jobs dans le container. À spécifier au moment du design.

### 2d. `HttpResult` : corps non-JSON (découverte K1 du sweep d15w)

- L'adaptateur fetch ne parse que le JSON → une réponse `text/plain` est modélisée sans
  corps, donc un golden ne peut pas épingler `"OK"` (cas réel : health check signews).
- Fix : conserver le corps texte brut quand le content-type n'est pas JSON, le
  sérialiser dans les goldens `.http`. Meta-test sur les deux chemins (json/texte).

---

## 3. v9.2 — le stub-server de contrats (l'enabler compose)

**Le bloqueur actuel :** les specs jobs des consumers (signews) sont saturées d'intercepts
LLM (contrats OpenAI/Anthropic) ; les intercepts étant in-process, le mode compose leur est
inutilisable, et api-stack garde un test skippé (frontière I3/D7).

**L'idée :** servir les MÊMES `contracts/openai/*.ts` depuis un **vrai container stub
HTTP** que le framework démarre en mode compose ; la stack pointe sa gateway LLM vers le
stub (une env var, injectée par la convention B6).

**Ce que ça débloque :**

- Les specs jobs tournent en compose sans modification (mêmes contrats, les deux modes).
- D7 (strict intercepts) devient uniforme : le stub compte les requêtes non matchées /
  non consommées et fait échouer le spec, comme MSW en node.
- Le test skippé d'api-stack disparaît — plus AUCUNE asymétrie entre les modes.

**Design à trancher au moment venu :** transport des contrats vers le stub (bundle au
démarrage vs endpoint d'enregistrement), reset entre specs (isolation par header de
corrélation ?), et le rapport d'échec D7 remonté au reporter.

---

## 4. À la demande — cli en container

- `mode: 'container'` pour `specification.cli` : le même binaire exécuté dans l'image
  livrée (`docker exec`, workdir monté), mêmes specs (A5).
- Valeur : parité linux/macOS (paths, signaux, musl/glibc), validation de l'image.
- **Non prioritaire** : aucun consumer actuel ne livre son CLI en image ; spwn gère
  lui-même des containers (nécessiterait docker-in-docker ou montage de socket —
  complexité disproportionnée aujourd'hui). Le jour où un CLI est livré en image, le
  mode tombe naturellement dans le cadre A5.

---

## 5. Performance (mesurer d'abord — benchmark = signews-api, 433 specs, 3 services)

Accord existant : aucune optimisation à l'aveugle ; on instrumente, puis on implémente
avec des chiffres. Par ROI attendu décroissant :

1. **Pool de services + shards** — le port `IsolationStrategy` EST déjà l'abstraction de
   shard (postgres = schema/template-db par slot, redis = index de db ; futur : mysql =
   database, kafka = préfixe topic, minio = préfixe bucket). Évolution : une couche pool
   machine dans l'orchestrateur — les containers deviennent des ressources réutilisées
   (testcontainers `reuse`), « démarrer un service » devient « acquérir un slot ».
   Impact API consumer : ZÉRO (le record `services` ne change pas).
2. **Postgres sur tmpfs** — les données de test sont jetables ; datadir en RAM rend
   init/TRUNCATE/reset quasi instantanés. Candidat au défaut.
3. **Pre-build compose dans le globalSetup** — builder l'image app UNE fois avant le fork
   des workers (les stacks par worker réutilisent le tag) ; côté consumer : Dockerfiles
   en layers + cache-from BuildKit en CI.
4. **Batching des E2E lint (ce repo)** — le coût des 57+ specs lint est le SPAWN du
   process oxlint (pas Docker) ; batcher plusieurs twins violation/ok par run (N spawns
   → 1).
5. CI sharding par projet vitest ; pre-pull d'images ; template-database vs schema-clone
   (à mesurer).
6. **Observabilité d'abord** : étendre le reporter de démarrage avec un résumé
   « temps infra vs temps tests » pour localiser le goulot de chaque consumer.

---

## 6. Divers reportés

- **Mécanisation des guards spwn** : les règles interdites (`no-restricted-syntax`)
  attendent le support oxlint (absent en 1.60, vérifié) ; les guards vivent en
  `specs/lint/guards/` en attendant.
- **Codemod b4** : auto-insertion des squelettes `// Given -` / `// Then -` manquants
  (idée notée pendant la campagne, valeur à réévaluer).
- **Bug produit signews (hors framework)** : le promoter tournait dans un handler
  d'événement background non drainé — FIXÉ côté app (drain garanti avant reset de
  `isRunning`, `allSettled`, rejections trackées) avec 2 specs K1. Reste à surveiller en
  prod que les stats pipeline ne montrent plus de runs fantômes.
- **Prochain gros consumer** : brancher un nouveau repo (autre stack) pour éprouver la
  généralité des conventions C1'/D11 hors de l'écosystème actuel.
