// E2E прокачки: внизу по центру полоса опыта с уровнем куба, опыт растёт от убитых врагов
// и поднимает уровень. Убийств ждём самих: куб стреляет сам, крошке (10 HP) хватает одного
// попадания. Базу опыта опускаем, чтобы уровень поднялся уже с первых крошек волны 1.
import { expect, it } from 'vitest';
import '@/main';
import { config } from '@/config';
import { waitUntil } from './helpers';

it('Должен показать полосу опыта с уровнем при старте', () => {
  expect(document.body.innerText).toContain('Уровень 1');
  expect(document.body.innerText).toContain('0 / 20');
});

it('Должен начислять опыт за убитых врагов и поднимать уровень', async () => {
  config.LEVEL_XP_BASE = 5;

  await waitUntil({
    isDone: () => document.body.innerText.includes('Уровень 2'),
    timeoutMs: 30000,
    what: 'второй уровень',
  });

  expect(document.body.innerText).not.toContain('0 / 5');
});
