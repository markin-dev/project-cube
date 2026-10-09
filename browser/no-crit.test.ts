// Парный browser-mode E2E: без крита. CRIT_CHANCE = 0 — попадания есть, но крит-цифр нет.
// Каждый файл browser-mode гоняется в отдельной странице, поэтому игра здесь заводится заново с нуля
// шансом крита: старые крит-цифры из crit.test.ts сюда не попадают.
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { damageNumbers, waitUntil } from './helpers';

// Шанс крита 0 до старта игры (см. комментарий в crit.test.ts про динамический импорт).
config.CRIT_CHANCE = 0;
await import('../src/main');

describe('обычные цифры урона', () => {
  it('при CRIT_CHANCE = 0 попадания есть, но крит-цифр не появляется', async () => {
    // Ждём, пока случится хоть одно попадание (обычная цифра урона).
    await waitUntil(() => damageNumbers().length > 0, 20000, 'цифра урона');

    expect(damageNumbers().length).toBeGreaterThan(0);
    // Среди появившихся цифр нет ни одной критической.
    expect(damageNumbers(true).length).toBe(0);
  });
});
