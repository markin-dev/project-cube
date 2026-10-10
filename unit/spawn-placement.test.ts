// Юнит-тесты подбора места появления врага (src/spawn-placement.ts).
//
// Алгоритм гарантирует: новый враг не появится внутри существующего (иначе физика в первом же
// шаге выталкивает его с огромной скоростью). Если исходная точка занята — ищем ближайшее
// свободное рядом на полу, а если на полу тесно — ярусом выше. Ключевая инвариант, который
// здесь проверяем: что бы placer ни вернул, коробка нового врага не пересекается ни с одной
// уже занятой (с зазором SPAWN_GAP), а занятое место подборщик запоминает — следующий враг
// не встанет на первое.
//
// Врага описываем заглушкой { body: { translation, rotation }, kind: { size } }: подборщику
// нужны только позиция центра и поворот (тут — единичный кватернион) плюс размер типа.
import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { config } from '../src/config';
import { createSpawnPlacer } from '../src/spawn-placement';
import type { Enemy, Enemies } from '../src/enemies';

const SIZE = 1;

// Заглушка врага в позиции (x, y, z) с кубической формой size и нулевым поворотом.
const enemyAt = (x: number, y: number, z: number, size = SIZE) =>
  ({
    body: {
      translation: () => ({ x, y, z }),
      rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    },
    kind: { size },
  }) as unknown as Enemy;

const toEnemies = (...list: Enemy[]): Enemies => new Map(list.map((enemy, index) => [index, enemy]));

// Коробки заняты ли пересекаются: две кубические коробки не пересекаются, если хотя бы по одной
// оси между центрами есть просвет ≥ суммы половин + зазор (как в isFreeInGrid).
const boxesOverlap = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  gap: number,
): boolean => {
  const half = SIZE / 2;
  return (
    Math.abs(a.x - b.x) < half + half + gap &&
    Math.abs(a.y - b.y) < half + half + gap &&
    Math.abs(a.z - b.z) < half + half + gap
  );
};

describe('подбор места появления', () => {
  beforeEach(() => {
    config.PLAYER_SIZE = 1;
    config.SPAWN_GAP = 0.15;
    config.ARENA_SIZE = 30;
    config.DEATH_CEILING_HEIGHT = 10;
  });

  it('пустая арена: враг появляется в исходной точке на полу (центр на половине роста)', () => {
    const placer = createSpawnPlacer(toEnemies());
    const position = placer({ point: { x: 5, z: 5 }, size: SIZE });

    expect(position.x).toBeCloseTo(5, 5);
    expect(position.z).toBeCloseTo(5, 5);
    expect(position.y).toBeCloseTo(SIZE / 2, 5);
  });

  it('занятая точка: сдвигается на свободное место рядом и не пересекается с занятым', () => {
    // Враг уже стоит ровно там, куда хотим появиться.
    const existing = enemyAt(5, SIZE / 2, 5);
    const placer = createSpawnPlacer(toEnemies(existing));

    const position = placer({ point: { x: 5, z: 5 }, size: SIZE });

    // Место либо сдвинуто, либо поднято — но коробки не пересекаются с зазором.
    expect(boxesOverlap({ x: position.x, y: position.y, z: position.z }, { x: 5, y: SIZE / 2, z: 5 }, config.SPAWN_GAP)).toBe(false);
  });

  it('подборщик занимает место: второй враг не встанет на первый', () => {
    const placer = createSpawnPlacer(toEnemies());

    const first = placer({ point: { x: 0, z: 0 }, size: SIZE });
    const second = placer({ point: { x: 0, z: 0 }, size: SIZE });

    expect(boxesOverlap(first, second, config.SPAWN_GAP)).toBe(false);
  });

  it('тесно на полу: враг поднимается ярусом выше, а не налезает на толпу', () => {
    // Маленькая арена (±2), так что кольца поиска за её краем отбрасываются. Пол вокруг центра
    // густо забит сеткой врагов (шаг 0.5 < размера, соседи перекрываются) — свободного места
    // на полу не остаётся, и подборщик обязан взять первый ярус (y = size/2 + size + gap).
    config.ARENA_SIZE = 4;

    const crowded: Enemy[] = [];
    for (let x = -2; x <= 2; x += 0.5) {
      for (let z = -2; z <= 2; z += 0.5) {
        crowded.push(enemyAt(x, SIZE / 2, z));
      }
    }
    const placer = createSpawnPlacer(toEnemies(...crowded));

    const position = placer({ point: { x: 0, z: 0 }, size: SIZE });

    const layerStep = SIZE + config.SPAWN_GAP;
    expect(position.y).toBeCloseTo(SIZE / 2 + layerStep, 5); // первый ярус
    // И на ярусе выше места коробка свободна от любой из толпы (разница по высоте ≥ суммы полуростов + зазор).
    for (const other of crowded) {
      const otherPos = other.body.translation();
      const isSeparated = Math.abs(position.y - otherPos.y) >= SIZE / 2 + SIZE / 2 + config.SPAWN_GAP;
      expect(isSeparated).toBe(true);
    }
  });
});
