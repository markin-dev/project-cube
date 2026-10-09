# Переход на тесты: vitest (unit) + vitest browser mode (E2E)

Дата: 2026-10-10. Статус: **Фазы 1–2 реализованы и зелёные. Сырые CDP-скрипты оставлены как legacy на время миграции.**

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

### Фаза 1 — юниты (`npm test`, `vitest.config.ts`, окружение happy-dom)
Пакеты: `vitest`, `happy-dom` (нужен localStorage для `config.ts`/`config-storage.ts`). Тесты в `unit/` (вне `src`, чтобы сборочный `tsc` их не трогал; vitest транспилирует TS сам через esbuild).
- `unit/config-storage.test.ts` — сохранение/восстановление настроек, `applyChanges`/`getChanges`/`countChanges`/`formatChangesForCode`, roundtrip через localStorage.
- `unit/crit-damage.test.ts` — `rollDamage` (границы, перепутанные/равные), `rollCrit` (шансы 0/1/0.5 на большой выборке), `applyCritToDamage` (множитель + округление), `findTargets` (ближайшие, исключение добиваемых).
- `unit/patterns.test.ts` — геометрия форм спавна (кольцо/дуга/шеренга/кучка/случайная).
- `unit/schedule.test.ts` — `buildWaveSchedule`: delay, время врагов, `ENEMY_COUNT_MULTIPLIER`, случайный тип.

Итог: **4 файла / 39 тестов, ~0.7 с.** Для тестов экспортированы чистые функции `rollDamage`/`rollCrit`/`applyCritToDamage` из `src/projectiles.ts`.

### Фаза 2 — эталонный E2E (`npm run test:browser`, `vitest.browser.config.ts`)
Пакеты: `@vitest/browser@5.0.3`, `@vitest/browser-playwright@5.0.3` + `playwright` (полный, уже был), chromium скачан через `npx playwright install chromium`.
- `browser/helpers.ts` — `game()` (DEV-хук `window.__game`), `waitUntil` (опрос условия, т.к. цикл идёт в реальном времени), `damageNumbers(onlyCrit)`.
- `browser/smoke.test.ts` — игра заводится импортом: есть canvas/`__game`, первая волна выпускает врагов.
- `browser/crit.test.ts` — `config.CRIT_CHANCE = 1` **до** динамического `await import('../src/main')` → ждём `.damage-number.is-crit`.
- `browser/no-crit.test.ts` — `CRIT_CHANCE = 0` → цифры урона есть, `.is-crit` = 0. Каждый файл — отдельная страница, изоляция чистая.

Итог: **3 файла / 4 теста, ~4.5 с.** Чтобы отличать крит-цифры по разметке (а не по хрупкому inline-цвету), в `src/damage-numbers.ts` добавлены классы `damage-number`/`is-crit`.

## Грабли (важно)

- **`libasound.so.2`** — Playwright-chromiumу нужна эта системная библиотека; в лёгком headless-окружении её нет, а `sudo apt-get` требует пароль. Обход — `scripts/run-browser-tests.sh` (вызывает `npm run test:browser`): если библиотеки нет, разово качает пакет `libasound2t64` через `apt-get download` (sudo не нужен), распаковывает в `.local-libs/` (в `.gitignore`) и подставляет через `LD_LIBRARY_PATH`. Если поставить `sudo apt-get install -y libasound2t64` — скрипт просто запускает тесты. WebGL в headless держится на `--enable-unsafe-swiftshader --use-angle=swiftshader` (в конфиге).
- **`connectOptions.wsEndpoint` провайдера ≠ CDP.** Playwright-провайдер умеет `connect()` (playwright-протокол) или `launch()` (свой chromium), но НЕ `connectOverCDP`. Поэтому удалённая Windows-chrome на `localhost:9333` (проброс через SSH) для vitest browser mode непригодна — отсюда необходимость локального chromium и его библиотек.

## Судьба сырых CDP-скриптов

Оставлены в `tests/` как **`npm run test:e2e-legacy`** на время миграции: они по-прежнему проверяют звук/волны/физическую опору/разгон, ещё не перенесённые в vitest browser. Как только нужное портируется — удалить. (Ранняя курация: `sound-sets-test` удалён как устаревший, `wave-picker-test` починен изоляцией localStorage.)

## Дальше (отложено, портировать по мере надобности)

Перенести в vitest browser полезное из legacy: звук (hit-sound, shot-death — реальная автоматизация Web Audio), счётчик волны/залпы во времени, физику опоры (`enemy-support`) и разгона (`enemy-acceleration`) — с «максимумом за окно»/ретраями вместо мгновенных снимков, ручной выбор волны (`wave-picker`).
