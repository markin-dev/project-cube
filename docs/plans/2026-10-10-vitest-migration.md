# Переход на тесты: vitest (unit) + vitest browser mode (E2E)

Дата: 2026-10-10. Статус: **Реализовано (Сессии 16–17): юниты + эталонный browser E2E зелёные; сырые CDP-скрипты удалены, часть выкидана как избыточная.**

## Зачем

Прежние E2E — самописные `.cjs`-скрипты поверх CDP (`page.goto` на dev-сервер + бот драйвит игру):
- требуют вручную запущенных dev-сервера и headless-Chrome (проброшенного из Windows через SSH-туннель на `localhost:9333`);
- делят один браузер → только последовательно;
- флакят: ловят мгновенные скорости в живой физике на лету (см. флаки `enemy-support`);
- много обвязки (CDP-хуки, `__game`, ловля audio-гейнов).

Пользователь: «чё-то с твоими тестами всё сложно. Может лучше vitest?» — решено идти на vitest.

## Решение — слои, а не «или/или»

- **Юниты** — vitest в node/happy-dom: детерминированная игровая логика без браузера/физики/времени. Быстро, параллельно, стабильно.
- **E2E** — vitest **browser mode** + Playwright (`@vitest/browser-playwright`): тесты идут в НАСТОЯЩЕМ chromium (WebGL + Web Audio + DOM), но **игру заводим импортом** `main.ts`, а не «goto + бот». main.ts — модуль с top-level `await`: он сам поднимает физику/сцену/цикл и ставит `window.__game` в текущей тестовой странице.

## Что сделано

### Фаза 1 — юниты (`npm run test:unit`, `vitest.config.ts`, окружение happy-dom)
Пакеты: `vitest`, `happy-dom` (нужен localStorage для `config.ts`/`config-storage.ts`). Тесты в `unit/` (вне `src`, чтобы сборочный `tsc` их не трогал; vitest транспилирует TS сам через esbuild).
- `unit/config-storage.test.ts` — сохранение/восстановление настроек, `applyChanges`/`getChanges`/`countChanges`/`formatChangesForCode`, roundtrip через localStorage.
- `unit/crit-damage.test.ts` — `rollDamage` (границы, перепутанные/равные), `rollCrit` (шансы 0/1/0.5 на большой выборке), `applyCritToDamage` (множитель + округление), `findTargets` (ближайшие, исключение добиваемых).
- `unit/patterns.test.ts` — геометрия форм спавна (кольцо/дуга/шеренга/кучка/случайная).
- `unit/schedule.test.ts` — `buildWaveSchedule`: delay, время врагов, `ENEMY_COUNT_MULTIPLIER`, случайный тип.
- `unit/movement.test.ts` (Сессия 17, заменил три legacy-браузерных физ-теста) — модель движения на **headless-Rapier**: `createPhysics()` даёт чистый мир+пол без рендера, враг — фикстура `{ body, kind }` (движению нужны только тело Rapier и `kind.size`). Тесты: радиальный разгон до `ENEMY_SPEED` несмотря на трение (компенсация), изолированное гашение касательной скорости по `ENEMY_TANGENTIAL_DAMPING` (прогон без `step`, чтобы не мешали трение/гравитация), управляемость врага на вершине стопки против врага в воздухе (опора через `castRay`).
- `unit/enemy-bounds.test.ts`, `unit/spawn-placement.test.ts`, `unit/projectile-motion.test.ts` (Сессия 17, добор покрытия) — границы состояния врага (арена/пол/потолок смерти), подбор места появления (сдвиг с занятой точки, запоминание занятого, ярус выше в тесноте) и полёт снаряда (упреждение прицела `predictPosition`, подбор промахов `removeFarProjectiles`).

Итог: **8 файлов / 54 теста, ~0.7 с.** Для тестов экспортированы чистые функции `rollDamage`/`rollCrit`/`applyCritToDamage`/`predictPosition` из `src/projectiles.ts`.

### Фаза 2 — эталонный E2E (`npm run test:e2e`, `vitest.browser.config.ts`)
Пакеты: `@vitest/browser@5.0.3`, `@vitest/browser-playwright@5.0.3` + `playwright` (полный, уже был), chromium скачан через `npx playwright install chromium`.
- `browser/helpers.ts` — `game()` (DEV-хук `window.__game`), `waitUntil` (опрос условия, т.к. цикл идёт в реальном времени), `damageNumbers(onlyCrit)`.
- `browser/smoke.test.ts` — игра заводится импортом: есть canvas/`__game`, первая волна выпускает врагов.
- `browser/crit.test.ts` — `config.CRIT_CHANCE = 1` **до** динамического `await import('../src/main')` → ждём `.damage-number.is-crit`.
- `browser/no-crit.test.ts` — `CRIT_CHANCE = 0` → цифры урона есть, `.is-crit` = 0. Каждый файл — отдельная страница, изоляция чистая.

Итог: **3 файла / 4 теста, ~4.5 с.** Чтобы отличать крит-цифры по разметке (а не по хрупкому inline-цвету), в `src/damage-numbers.ts` добавлены классы `damage-number`/`is-crit`.

## Грабли (важно)

- **`libasound.so.2`** — Playwright-chromiumу нужна эта системная библиотека; в лёгком headless-окружении её нет, а `sudo apt-get` требует пароль. Обход — `scripts/run-browser-tests.sh` (вызывает `npm run test:e2e`): если библиотеки нет, разово качает пакет `libasound2t64` через `apt-get download` (sudo не нужен), распаковывает в `.local-libs/` (в `.gitignore`) и подставляет через `LD_LIBRARY_PATH`. Если поставить `sudo apt-get install -y libasound2t64` — скрипт просто запускает тесты. WebGL в headless держится на `--enable-unsafe-swiftshader --use-angle=swiftshader` (в конфиге).
- **Headless-Rapier и `castRay` (Сессия 17):** QueryPipeline (индекс, по которому работают лучи) обновляется **только на `world.step()`** — до первого шага `castRay` не видит ни одного коллайдера. В `unit/movement.test.ts` поэтому после создания тел делается один `world.step()`, иначе «опора» через луч не работает.
- **`connectOptions.wsEndpoint` провайдера ≠ CDP.** Playwright-провайдер умеет `connect()` (playwright-протокол) или `launch()` (свой chromium), но НЕ `connectOverCDP`. Поэтому удалённая Windows-chrome на `localhost:9333` (проброс через SSH) для vitest browser mode непригодна — отсюда необходимость локального chromium и его библиотек.

## Судьба сырых CDP-скриптов (Сессия 17)

Каталог `tests/` удалён целиком (`npm run test:e2e-legacy` убран). Курация по принципу пользователя «не переносить всё подряд, выкидывать избыточное»:

- **Покрыто юнитами/browser → удалено:** `crit-test` (крит-математика + DOM), `damage-range-test` (границы урона), `projectile-count-test` (счёт таргетинга `findTargets`).
- **Физика → заменена `unit/movement.test.ts` (headless-Rapier):** `enemy-acceleration`, `enemy-tangential`, `enemy-support` — вместо флакивших браузерных снимков скоростей.
- **Выкидано как чрезмерное/хрупкое:** `hit-sound` (146 строк) + `shot-death` (359 строк) — Web Audio-интроспекция и управление ~15 контролами lil-gui; `wave-picker` — отладочный UI. Это осознанная **потеря покрытия звука/отладочного UI** (при надобности добавить лёгкий звуковой smoke в browser-mode).

## Дальше

Ничего портировать не осталось. `npm test` гоняет оба слоя (юниты → E2E). Если появится желание вернуть звуковое покрытие — минимальный browser-mode smoke (считаем `AudioBufferSourceNode.start`-вызовы во время игры), без панельной обвязки.
