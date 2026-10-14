# Ревью проекта, пункт 6: соответствие глобальному CLAUDE.md пользователя

Дата: 2026-10-14
Статус: реализован, закоммичено, на прод не выложено

## Контекст

Шестой раздел ревью (Сессия 34). Пользователь: «Коммить и переходи к пункту 6». Проверка — скриптами
на TypeScript AST (во временной папке, в репозиторий не попали): `let`/`var`, классы, `as`, импорты `../`,
типы параметров и результатов именованных функций, больше двух позиционных параметров, boolean-функции
без `is`, пустые строки вокруг многострочных операторов; в тестах — названия, один `expect`, `async`
без `await`, `beforeEach`. Было 85 нарушений, стало 0.

## Исправлено

- **Импорты `../src/…` в тестах (47) → алиас `@/…`.** `paths` в tsconfig.json, `resolve.tsconfigPaths`
  в vite.config.ts и обоих vitest-конфигах. В `src/` все импорты и так `./`.
- **`let` → `const` (17):** состояние замыканий — в объектах (`pool` в sparks.ts, `sample` в fps-counter.ts,
  `mute` в sound.ts), циклы — `forEach`/`Array.from`, шум — `Float32Array.from`, бюджет появлений
  в game.ts — `reduce` по группам, вариант звука — тернарник.
- **Boolean без `is`:** `rollCrit` → `isCritRolled`; `fireVolley` теперь возвращает число выпущенных
  снарядов (0 — стрелять не в кого), а не boolean; поле искры `alive` → `isAlive`.
- **Больше двух параметров → объект:** `moveEnemies({ world, enemies, delta })`,
  `waitUntil({ isDone, timeoutMs, what })` в browser/helpers.ts. Колбэк Rapier `drainCollisionEvents`
  (три параметра) задан библиотекой — оставлен.
- **Пустые строки вокруг многострочных операторов** — 11 мест (sound.ts, settings-panel.ts,
  damage-numbers.ts).
- **Типы:** результат `createTestGame`, параметры `getDamageNumbers`, `waitUntil`.
- **`beforeEach` только для моков:** очистка localStorage перенесена в `unit/setup.ts` и новый
  `browser/setup.ts` (`setupFiles`).

## Не применялось

- Разделы Vue и Composables (withDefaults, отступы компонента, хуки жизненного цикла) — в проекте нет Vue.
- Правила про `vi.mock`/`mockReturnValue` — модулей-моков в тестах нет: зависимости передаются параметрами
  (`createGame`), заглушки — `vi.fn`.

## Проверка

tsc, юниты 218, E2E 18, build; обе проверки стиля — 0 нарушений.
