// Усиления куба: при повышении уровня игрок выбирает одно из нескольких (UPGRADE_CHOICES) — урон,
// скорость атаки, шанс и урон крита, вес и скорость снаряда, отскоки, снаряды. У каждой карточки своя
// редкость: чем реже, тем больше прибавка (UPGRADE_VALUES в config.ts).
//
// Бонусы забега — отдельный слой поверх конфига: в config лежит база (её меняют панель и пресеты),
// а взятые усиления копятся в UpgradeBonuses и складываются с базой в getCombatStats. Сложение — от базы:
// два раза «+10% урона» дают +20% к базовому урону, а не ×1.21. Новая игра обнуляет бонусы.
//
// Здесь только данные и расчёты, без DOM: экран выбора — upgrade-ui.ts, логика забега — game.ts.
import { config, MIN_FIRE_INTERVAL, type Config } from './config';

// Редкость карточки — от обычной к оранжевой (легендарной).
export type Rarity = keyof Config['UPGRADE_RARITY_WEIGHTS'];

// Что усиливает карточка.
export type UpgradeStat = keyof Config['UPGRADE_VALUES'];

// Редкости по возрастанию силы — в этом порядке их показывают панель и список статов.
export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// Усиления в порядке строк списка статов и папок панели.
export const UPGRADE_STATS: UpgradeStat[] = [
  'damage',
  'fireRate',
  'critChance',
  'critDamage',
  'projectileMass',
  'projectileSpeed',
  'bounces',
  'projectileCount',
];

// Названия редкостей. Record проверяет, что названы все редкости из конфига.
export const RARITY_TITLES: Record<Rarity, string> = {
  common: 'Обычное',
  uncommon: 'Необычное',
  rare: 'Редкое',
  epic: 'Эпическое',
  legendary: 'Легендарное',
};

// Сумма взятых прибавок по каждому усилению — в единицах UPGRADE_VALUES (проценты, пункты, штуки).
export type UpgradeBonuses = Record<UpgradeStat, number>;

// Карточка выбора: какое усиление, какой редкости и на сколько.
export type UpgradeCard = {
  stat: UpgradeStat;
  rarity: Rarity;
  amount: number;
};

// Боевые характеристики куба с усилениями забега. Их, а не config, читают выстрел и снаряды
// (см. projectiles.ts и fireVolley в game.ts).
export type CombatStats = {
  // Во сколько раз урон больше брошенного из [PROJECTILE_DAMAGE_MIN, PROJECTILE_DAMAGE_MAX].
  damageMultiplier: number;

  // Пауза между залпами, с.
  fireInterval: number;

  critChance: number;
  critMultiplier: number;
  projectileMass: number;
  projectileSpeed: number;
  bounces: number;
  projectileCount: number;
};

// Бонусы нового забега — ни одного усиления.
export const createBonuses = (): UpgradeBonuses => ({
  damage: 0,
  fireRate: 0,
  critChance: 0,
  critDamage: 0,
  projectileMass: 0,
  projectileSpeed: 0,
  bounces: 0,
  projectileCount: 0,
});

// Процентная прибавка как множитель: 18 → 1.18.
const toMultiplier = (percent: number): number => 1 + percent / 100;

// База из конфига плюс бонусы забега. Скорость атаки растёт числом выстрелов в секунду, поэтому
// пауза между залпами делится на множитель. Шанс крита — не выше 100%.
export const getCombatStats = (bonuses: UpgradeBonuses): CombatStats => ({
  damageMultiplier: toMultiplier(bonuses.damage),
  fireInterval: Math.max(config.FIRE_INTERVAL, MIN_FIRE_INTERVAL) / toMultiplier(bonuses.fireRate),
  critChance: Math.min(1, config.CRIT_CHANCE + bonuses.critChance / 100),
  critMultiplier: config.CRIT_MULTIPLIER + bonuses.critDamage,
  projectileMass: config.PROJECTILE_MASS * toMultiplier(bonuses.projectileMass),
  projectileSpeed: config.PROJECTILE_SPEED * toMultiplier(bonuses.projectileSpeed),
  bounces: Math.max(0, Math.floor(config.PROJECTILE_BOUNCES)) + bonuses.bounces,
  projectileCount: Math.max(1, Math.floor(config.PROJECTILE_COUNT)) + bonuses.projectileCount,
});

// Бонусы после взятой карточки — новый объект, старый не меняется.
export const applyUpgrade = (bonuses: UpgradeBonuses, { stat, amount }: UpgradeCard): UpgradeBonuses => ({
  ...bonuses,
  [stat]: bonuses[stat] + amount,
});

// ─── БРОСОК КАРТОЧЕК ─────────────────────────────────────────────────────────

// Прибавка усиления stat на редкости rarity из конфига; 0 — на этой редкости не выпадает.
const getAmount = (stat: UpgradeStat, rarity: Rarity): number => config.UPGRADE_VALUES[stat][rarity];

// Можно ли ещё предлагать усиление: шанс крита на 100% расти некуда.
const isUseful = (stat: UpgradeStat, bonuses: UpgradeBonuses): boolean =>
  stat !== 'critChance' || getCombatStats(bonuses).critChance < 1;

// Усиления, которые может дать карточка редкости rarity: прибавка больше нуля, ещё полезно и не взято
// другой карточкой этого же выбора.
const getAvailableStats = ({
  rarity,
  bonuses,
  excluded,
}: {
  rarity: Rarity;
  bonuses: UpgradeBonuses;
  excluded: UpgradeStat[];
}): UpgradeStat[] =>
  UPGRADE_STATS.filter((stat) => !excluded.includes(stat) && getAmount(stat, rarity) > 0 && isUseful(stat, bonuses));

// Выбор по весам: каждый вариант выпадает с вероятностью «его вес / сумма весов». Сумма нулевая — ничего.
// random — число из [0, 1), как Math.random (тесты подставляют своё).
// Варианты — отрезки длиной в свой вес, уложенные подряд; бросок — точка на общей длине. Выпадает вариант,
// на чей отрезок попала точка.
const pickWeighted = <T>(options: Array<{ value: T; weight: number }>, random: number): T | undefined => {
  const sumUpTo = (count: number): number => options.slice(0, count).reduce((sum, { weight }) => sum + weight, 0);
  const point = random * sumUpTo(options.length);

  return options.find(({ weight }, index) => weight > 0 && point < sumUpTo(index + 1))?.value;
};

// Вес редкости в броске: из конфига, но 0, если на этой редкости давать уже нечего.
const getRarityWeight = (params: { rarity: Rarity; bonuses: UpgradeBonuses; excluded: UpgradeStat[] }): number =>
  getAvailableStats(params).length > 0 ? Math.max(0, config.UPGRADE_RARITY_WEIGHTS[params.rarity]) : 0;

// Карточки одного выбора: UPGRADE_CHOICES штук (не меньше одной), все — разные усиления. Для каждой
// сначала бросается редкость по UPGRADE_RARITY_WEIGHTS — только среди редкостей, где ещё есть что дать, —
// потом усиление, поровну среди доступных на ней. Если давать нечего, карточек меньше (или ни одной).
export const rollOffer = ({
  bonuses,
  random = Math.random,
}: {
  bonuses: UpgradeBonuses;
  random?: () => number;
}): UpgradeCard[] => {
  const count = Math.max(1, Math.floor(config.UPGRADE_CHOICES));

  return Array.from({ length: count }).reduce<UpgradeCard[]>((cards) => {
    const excluded = cards.map(({ stat }) => stat);

    const rarity = pickWeighted(
      RARITIES.map((value) => ({ value, weight: getRarityWeight({ rarity: value, bonuses, excluded }) })),
      random(),
    );

    if (!rarity) {
      return cards;
    }

    const stats = getAvailableStats({ rarity, bonuses, excluded });
    const stat = stats[Math.min(Math.floor(random() * stats.length), stats.length - 1)];

    return [...cards, { stat, rarity, amount: getAmount(stat, rarity) }];
  }, []);
};

// ─── ТЕКСТЫ ──────────────────────────────────────────────────────────────────

// Число без хвостов: 0.30000000000000004 → «0.3», 2 → «2».
const formatNumber = (value: number, digits: number): string => String(Number(value.toFixed(digits)));

// Как показывать усиление: название, прибавку карточки и текущее значение стата.
type StatTexts = {
  title: string;
  formatAmount: (amount: number) => string;
  formatValue: (stats: CombatStats) => string;
};

// Урон снаряда: диапазон с множителем, без крита. Границы — по возрастанию, как и при броске урона.
const formatDamage = ({ damageMultiplier }: CombatStats): string => {
  const low = Math.min(config.PROJECTILE_DAMAGE_MIN, config.PROJECTILE_DAMAGE_MAX) * damageMultiplier;
  const high = Math.max(config.PROJECTILE_DAMAGE_MIN, config.PROJECTILE_DAMAGE_MAX) * damageMultiplier;

  return `${Math.round(low)}–${Math.round(high)}`;
};

export const STAT_TEXTS: Record<UpgradeStat, StatTexts> = {
  damage: {
    title: 'Урон',
    formatAmount: (amount) => `+${formatNumber(amount, 1)}%`,
    formatValue: formatDamage,
  },
  fireRate: {
    title: 'Скорость атаки',
    formatAmount: (amount) => `+${formatNumber(amount, 1)}%`,
    formatValue: ({ fireInterval }) => `${formatNumber(1 / fireInterval, 2)}/с`,
  },
  critChance: {
    title: 'Шанс крита',
    formatAmount: (amount) => `+${formatNumber(amount, 1)}%`,
    formatValue: ({ critChance }) => `${formatNumber(critChance * 100, 1)}%`,
  },
  critDamage: {
    title: 'Урон крита',
    formatAmount: (amount) => `+×${formatNumber(amount, 2)}`,
    formatValue: ({ critMultiplier }) => `×${formatNumber(critMultiplier, 2)}`,
  },
  projectileMass: {
    title: 'Вес снаряда',
    formatAmount: (amount) => `+${formatNumber(amount, 1)}%`,
    formatValue: ({ projectileMass }) => `${formatNumber(projectileMass, 3)} кг`,
  },
  projectileSpeed: {
    title: 'Скорость снаряда',
    formatAmount: (amount) => `+${formatNumber(amount, 1)}%`,
    formatValue: ({ projectileSpeed }) => `${formatNumber(projectileSpeed, 1)} м/с`,
  },
  bounces: {
    title: 'Отскоки',
    formatAmount: (amount) => `+${formatNumber(amount, 0)}`,
    formatValue: ({ bounces }) => `${bounces}`,
  },
  projectileCount: {
    title: 'Снаряды',
    formatAmount: (amount) => `+${formatNumber(amount, 0)}`,
    formatValue: ({ projectileCount }) => `${projectileCount}`,
  },
};

// Что показать на карточке: редкость, название, прибавку и «было → станет» при текущих бонусах.
export type CardTexts = {
  rarityTitle: string;
  title: string;
  amount: string;
  before: string;
  after: string;
};

export const describeCard = (card: UpgradeCard, bonuses: UpgradeBonuses): CardTexts => {
  const texts = STAT_TEXTS[card.stat];

  return {
    rarityTitle: RARITY_TITLES[card.rarity],
    title: texts.title,
    amount: texts.formatAmount(card.amount),
    before: texts.formatValue(getCombatStats(bonuses)),
    after: texts.formatValue(getCombatStats(applyUpgrade(bonuses, card))),
  };
};
