// Юнит-тесты усилений (src/upgrades.ts): боевые характеристики с бонусами (сложение от базы, потолок крита),
// применение карточки, бросок карточек (разные усиления, редкость по весам, недоступные редкости, снаряды
// и отскоки только с синей) и тексты карточек.
import { describe, expect, it } from 'vitest';
import { config } from '@/config';
import {
  applyUpgrade,
  createBonuses,
  describeCard,
  getCombatStats,
  RARITIES,
  rollOffer,
  UPGRADE_STATS,
  type CombatStats,
  type UpgradeBonuses,
  type UpgradeCard,
  type UpgradeStat,
} from '@/upgrades';

// Сколько выборов бросать в проверках «никогда не бывает»: при шансах по умолчанию за столько бросков
// выпадают все редкости.
const OFFERS_COUNT = 300;

// Бонусы с одной прибавкой — остальные нули.
const createBonusesWith = (stat: UpgradeStat, amount: number): UpgradeBonuses => ({
  ...createBonuses(),
  [stat]: amount,
});

// Много выборов подряд с одними и теми же бонусами.
const rollManyOffers = (bonuses: UpgradeBonuses = createBonuses()): UpgradeCard[][] =>
  Array.from({ length: OFFERS_COUNT }, () => rollOffer({ bonuses }));

// Оставляет в UPGRADE_VALUES только усиление stat с прибавкой amount на всех редкостях, остальные — 0.
const allowOnly = (stat: UpgradeStat, amount: number): void => {
  for (const name of UPGRADE_STATS) {
    for (const rarity of RARITIES) {
      config.UPGRADE_VALUES[name][rarity] = name === stat ? amount : 0;
    }
  }
};

describe('getCombatStats', () => {
  it('Должен без усилений вернуть базу из конфига', () => {
    expect(getCombatStats(createBonuses())).toEqual({
      damageMultiplier: 1,
      fireInterval: config.FIRE_INTERVAL,
      critChance: config.CRIT_CHANCE,
      critMultiplier: config.CRIT_MULTIPLIER,
      projectileMass: config.PROJECTILE_MASS,
      projectileSpeed: config.PROJECTILE_SPEED,
      bounces: config.PROJECTILE_BOUNCES,
      projectileCount: config.PROJECTILE_COUNT,
    });
  });

  it.each<[UpgradeStat, number, keyof CombatStats, number]>([
    ['damage', 20, 'damageMultiplier', 1.2],
    ['fireRate', 25, 'fireInterval', 0.4],
    ['critChance', 10, 'critChance', 0.25],
    ['critDamage', 0.5, 'critMultiplier', 2.5],
    ['projectileMass', 100, 'projectileMass', 0.3],
    ['projectileSpeed', 20, 'projectileSpeed', 18],
    ['bounces', 2, 'bounces', 2],
    ['projectileCount', 1, 'projectileCount', 2],
  ])('Должен с бонусом %s = %s дать %s = %s', (stat, amount, field, expected) => {
    expect(getCombatStats(createBonusesWith(stat, amount))[field]).toBeCloseTo(expected, 6);
  });

  it('Должен держать шанс крита не выше 100%', () => {
    expect(getCombatStats(createBonusesWith('critChance', 200)).critChance).toBe(1);
  });
});

describe('applyUpgrade', () => {
  it('Должен складывать прибавки от базы, а не умножать', () => {
    const card: UpgradeCard = { stat: 'damage', rarity: 'common', amount: 10 };
    const bonuses = applyUpgrade(applyUpgrade(createBonuses(), card), card);

    expect(getCombatStats(bonuses).damageMultiplier).toBeCloseTo(1.2, 6);
  });

  it('Должен оставить прежние бонусы без изменений', () => {
    const bonuses = createBonuses();

    applyUpgrade(bonuses, { stat: 'bounces', rarity: 'rare', amount: 1 });

    expect(bonuses.bounces).toBe(0);
  });
});

describe('rollOffer', () => {
  it('Должен предложить UPGRADE_CHOICES карточек', () => {
    config.UPGRADE_CHOICES = 4;

    expect(rollOffer({ bonuses: createBonuses() })).toHaveLength(4);
  });

  it('Должен предлагать в одном выборе только разные усиления', () => {
    const repeated = rollManyOffers().filter((cards) => new Set(cards.map(({ stat }) => stat)).size !== cards.length);

    expect(repeated).toEqual([]);
  });

  it('Должен брать прибавку карточки из UPGRADE_VALUES', () => {
    const wrong = rollManyOffers()
      .flat()
      .filter(({ stat, rarity, amount }) => amount !== config.UPGRADE_VALUES[stat][rarity]);

    expect(wrong).toEqual([]);
  });

  it('Должен давать снаряды и отскоки только с синей редкости', () => {
    const rarities = new Set(
      rollManyOffers()
        .flat()
        .filter(({ stat }) => stat === 'bounces' || stat === 'projectileCount')
        .map(({ rarity }) => rarity),
    );

    expect([...rarities].filter((rarity) => rarity === 'common' || rarity === 'uncommon')).toEqual([]);
  });

  it.each([
    [0, 'common'],
    [0.6, 'uncommon'],
    [0.85, 'rare'],
    [0.95, 'epic'],
    [0.99, 'legendary'],
  ])('Должен при броске %s по весам 50/28/14/6/2 дать редкость %s', (random, expected) => {
    const [card] = rollOffer({ bonuses: createBonuses(), random: () => random });

    expect(card.rarity).toBe(expected);
  });

  it('Должен пропустить редкость, на которой нечего дать', () => {
    // Оранжевая выпадала бы всегда, но на ней все прибавки — 0: остаётся только обычная.
    Object.assign(config.UPGRADE_RARITY_WEIGHTS, { common: 1, uncommon: 0, rare: 0, epic: 0, legendary: 1000 });

    for (const stat of UPGRADE_STATS) {
      config.UPGRADE_VALUES[stat].legendary = 0;
    }

    const rarities = new Set(rollManyOffers().flat().map(({ rarity }) => rarity));

    expect([...rarities]).toEqual(['common']);
  });

  it('Должен не предлагать шанс крита, когда он уже 100%', () => {
    const stats = rollManyOffers(createBonusesWith('critChance', 100))
      .flat()
      .map(({ stat }) => stat);

    expect(stats).not.toContain('critChance');
  });

  it('Должен предложить меньше карточек, если доступных усилений меньше', () => {
    allowOnly('damage', 10);
    config.UPGRADE_VALUES.fireRate.common = 10;

    expect(rollOffer({ bonuses: createBonuses() })).toHaveLength(2);
  });

  it('Должен не предложить ничего, если все прибавки нулевые', () => {
    allowOnly('damage', 0);

    expect(rollOffer({ bonuses: createBonuses() })).toEqual([]);
  });
});

describe('describeCard', () => {
  it.each<[UpgradeCard, { amount: string; before: string; after: string }]>([
    [{ stat: 'damage', rarity: 'rare', amount: 18 }, { amount: '+18%', before: '10–20', after: '12–24' }],
    [{ stat: 'fireRate', rarity: 'common', amount: 8 }, { amount: '+8%', before: '2/с', after: '2.16/с' }],
    [{ stat: 'critDamage', rarity: 'common', amount: 0.25 }, { amount: '+×0.25', before: '×2', after: '×2.25' }],
    [{ stat: 'projectileCount', rarity: 'epic', amount: 1 }, { amount: '+1', before: '1', after: '2' }],
  ])('Должен описать карточку %j как %j', (card, expected) => {
    const { amount, before, after } = describeCard(card, createBonuses());

    expect({ amount, before, after }).toEqual(expected);
  });

  it('Должен назвать редкость и усиление', () => {
    const card: UpgradeCard = { stat: 'critChance', rarity: 'legendary', amount: 20 };
    const { rarityTitle, title } = describeCard(card, createBonuses());

    expect([rarityTitle, title]).toEqual(['Легендарное', 'Шанс крита']);
  });
});
