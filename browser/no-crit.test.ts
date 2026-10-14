// E2E: при CRIT_CHANCE = 0 попадания есть, а крит-цифр нет. Каждый файл browser-mode идёт в своей
// странице, поэтому крит-цифры из crit.test.ts сюда не попадают.
import { expect, it } from 'vitest';
import { config } from '@/config';
import { getDamageNumbers, waitUntil } from './helpers';

// Шанс крита меняем до старта игры (см. crit.test.ts про динамический импорт).
config.CRIT_CHANCE = 0;
await import('@/main');

it('Не должен показывать крит-цифры при CRIT_CHANCE = 0', async () => {
  await waitUntil({ isDone: () => getDamageNumbers().length > 0, timeoutMs: 20000, what: 'цифра урона' });

  expect(getDamageNumbers(true)).toHaveLength(0);
});
