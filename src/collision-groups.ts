// Группы столкновений: кто с кем вообще может сталкиваться.
//
// В Rapier у коллайдера два набора битов по 16 штук:
//   «кто я» (membership) — к каким группам относится коллайдер;
//   «с кем сталкиваюсь» (filter) — с какими группами он готов взаимодействовать.
// Два коллайдера взаимодействуют, только если КАЖДЫЙ из них есть в фильтре другого.
// Оба набора упакованы в одно 32-битное число: «кто я» в старших 16 битах, «с кем» — в младших.
import type { InteractionGroups } from '@dimforge/rapier3d-compat';

// Каждая группа — отдельный бит: 1, 2, 4, 8, 16. Так их можно объединять через |.
const FLOOR = 1 << 0;
const PLAYER = 1 << 1;
const ENEMY = 1 << 2;
const PROJECTILE = 1 << 3;
const CORPSE = 1 << 4;

const getGroups = (membership: number, filter: number): InteractionGroups => (membership << 16) | filter;

// Пол держит врагов и призраков.
export const FLOOR_GROUPS = getGroups(FLOOR, ENEMY | CORPSE);

// Игрока касаются только живые враги — это поражение.
export const PLAYER_GROUPS = getGroups(PLAYER, ENEMY);

// Живой враг стоит на полу, толкает других врагов, касается игрока и ловит снаряды.
export const ENEMY_GROUPS = getGroups(ENEMY, FLOOR | PLAYER | ENEMY | PROJECTILE);

// Снаряд замечает только врагов: сквозь пол, игрока и призраков он пролетает.
export const PROJECTILE_GROUPS = getGroups(PROJECTILE, ENEMY);

// Призрак погибшего врага падает на пол, но ни с кем больше не взаимодействует.
export const CORPSE_GROUPS = getGroups(CORPSE, FLOOR);
