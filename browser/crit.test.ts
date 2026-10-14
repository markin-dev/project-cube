// E2E: при CRIT_CHANCE = 1 каждое попадание критическое — над врагами всплывают крит-цифры
// (.damage-number.is-crit). Проверяет весь конвейер: пуля долетает, столкновение, крит, разметка.
import { expect, it } from 'vitest';
import { config } from '@/config';
import { getDamageNumbers } from './helpers';

// Шанс крита меняем до старта игры, поэтому main.ts грузим динамически — после правки config.
config.CRIT_CHANCE = 1;
await import('@/main');

it('Должен показывать крит-цифры при CRIT_CHANCE = 1', async () => {
  await expect.poll(() => getDamageNumbers(true).length, { timeout: 20000 }).toBeGreaterThan(0);
});
