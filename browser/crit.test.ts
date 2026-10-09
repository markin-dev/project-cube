// Эталонный browser-mode E2E (Фаза 2): крит-цифры урона в реальном браузере.
//
// Заводим игру импортом точки входа с CRIT_CHANCE = 1 — каждое попадание критическое — и ждём, пока
// над врагами появится крит-цифра урона (класс .damage-number.is-crit, см. damage-numbers.ts).
// Это проверяет весь конвейер в реальном Chromium: физику (пуля долетает), столкновения, урон, крит
// (rollCrit/applyCritToDamage) и DOM-разметку крит-цифры. Парный тест без крита — no-crit.test.ts.
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { damageNumbers, waitUntil } from './helpers';

// Ставим шанс крита до старта игры: main.ts — модуль с top-level await, поэтому загружаем его ДИНАМИЧЕСКИ,
// после правки config. Игра читает тот же объект config, так что каждый выстрел будет критическим.
config.CRIT_CHANCE = 1;
await import('../src/main');

describe('крит-цифры урона', () => {
  it('при CRIT_CHANCE = 1 попадания дают крит-цифры', async () => {
    await waitUntil(() => damageNumbers(true).length > 0, 20000, 'крит-цифра урона');

    expect(damageNumbers(true).length).toBeGreaterThan(0);
  });
});
