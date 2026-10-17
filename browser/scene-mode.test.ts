// E2E переключения между сценами (SCENE_MODE, см. demo-scene.ts): в демо-режиме игра замирает —
// позиции врагов не меняются, а при возврате к игре движение продолжается.
import { expect, it } from 'vitest';
import '@/main';
import { getEnemiesCount, getGame, getSceneSelect, setSceneMode, sleep, waitUntil } from './helpers';

// Позиции живых врагов — снимок, чтобы сравнить «до» и «после».
const getEnemyPositions = (): number[][] =>
  [...(getGame()?.enemies.values() ?? [])].map(({ body }) => {
    const { x, y, z } = body.translation();

    return [x, y, z];
  });

it('Должен заморозить игру в демо-режиме и продолжить её при возврате', async () => {
  getSceneSelect();

  await waitUntil({ isDone: () => getEnemiesCount() > 0, timeoutMs: 15000, what: 'появление врагов' });
  await sleep(300);

  // Демо: позиции врагов зафиксированы — игра замирает, физика не шагает.
  setSceneMode(1);

  const frozen = getEnemyPositions();

  expect(frozen.length).toBeGreaterThan(0);

  await sleep(700);

  expect(getEnemyPositions()).toEqual(frozen);

  // Возврат к игре: движение возобновляется с того же места.
  setSceneMode(0);

  await waitUntil({
    isDone: () => JSON.stringify(getEnemyPositions()) !== JSON.stringify(frozen),
    timeoutMs: 5000,
    what: 'возобновление движения врагов',
  });

  expect(getEnemyPositions()).not.toEqual(frozen);
});
