// Интерфейс усилений (см. upgrades.ts): экран выбора и список статов куба. Обычный HTML поверх canvas,
// как HUD (hud.ts).
//   Экран выбора — затемнение, заголовок «Уровень N — выбери усиление» и карточки: редкость (цвет рамки
//     и свечение), название, прибавка и «было → станет». Выбор — клик/касание или клавиша 1…9.
//   Список статов — слева под номером волны: каждый стат куба с текущим значением и цветными точками
//     взятых усилений (цвет точки — редкость карточки).
// Сама логика (что выпало, что взято, пауза) — в game.ts; сюда приходят только данные для показа.
import {
  describeCard,
  getCombatStats,
  STAT_TEXTS,
  UPGRADE_STATS,
  type Rarity,
  type UpgradeBonuses,
  type UpgradeCard,
} from './upgrades';

// Цвета редкостей: серая, зелёная, синяя, фиолетовая, оранжевая.
export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#c4c9d4',
  uncommon: '#4ade80',
  rare: '#60a5fa',
  epic: '#c084fc',
  legendary: '#fb923c',
};

// Редкости, у которых карточка «дышит» свечением — чтобы редкую удачу было видно сразу.
const PULSING_RARITIES: Rarity[] = ['epic', 'legendary'];

// Стили — классами в одном <style>: у карточек есть наведение и анимация, а их в inline-стилях не задать.
// --rarity — цвет редкости, его ставит каждая карточка. z-index 3 — над переключателем скорости (2)
// и экраном поражения (1). safe center — если карточки выше экрана, не обрезать верх, а дать прокрутить.
// На узком экране (та же граница 700 px, что в layout.ts) карточки компактнее и без подсказки клавиши:
// на телефоне клавиатуры нет, а три карточки должны влезть по высоте.
const STYLES = `
  .upgrade-overlay {
    position: fixed;
    inset: 0;
    z-index: 3;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: safe center;
    gap: 20px;
    padding: 16px;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.55);
    color: white;
    font-family: system-ui, sans-serif;
    user-select: none;
  }

  .upgrade-overlay.is-shown {
    display: flex;
  }

  .upgrade-overlay__title {
    font-size: 24px;
    font-weight: bold;
    text-align: center;
  }

  .upgrade-overlay__cards {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 16px;
  }

  .upgrade-card {
    width: 200px;
    max-width: calc(100vw - 32px);
    padding: 18px 14px 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    border: 2px solid var(--rarity);
    border-radius: 12px;
    background: rgba(18, 18, 26, 0.92);
    color: white;
    font-family: inherit;
    cursor: pointer;
    box-shadow: 0 0 18px -4px var(--rarity);
    transition: transform 0.12s, box-shadow 0.12s;
  }

  .upgrade-card:hover,
  .upgrade-card:focus-visible {
    transform: translateY(-4px) scale(1.03);
    box-shadow: 0 0 30px 2px var(--rarity);
    outline: none;
  }

  .upgrade-card.is-pulsing {
    animation: upgrade-card-glow 1.1s ease-in-out infinite alternate;
  }

  @keyframes upgrade-card-glow {
    from { box-shadow: 0 0 14px -4px var(--rarity); }
    to { box-shadow: 0 0 34px 4px var(--rarity); }
  }

  .upgrade-card__rarity {
    color: var(--rarity);
    font-size: 12px;
    font-weight: bold;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .upgrade-card__title {
    font-size: 18px;
    font-weight: bold;
  }

  .upgrade-card__amount {
    color: var(--rarity);
    font-size: 30px;
    font-weight: 800;
  }

  .upgrade-card__change {
    font-size: 13px;
    opacity: 0.8;
  }

  .upgrade-card__key {
    margin-top: 4px;
    min-width: 22px;
    padding: 2px 0;
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 4px;
    font-size: 12px;
    opacity: 0.7;
  }

  @media (max-width: 699px) {
    .upgrade-overlay {
      gap: 12px;
    }

    .upgrade-overlay__title {
      font-size: 18px;
    }

    .upgrade-overlay__cards {
      gap: 10px;
    }

    .upgrade-card {
      width: 300px;
      padding: 10px 12px;
      gap: 4px;
    }

    .upgrade-card__title {
      font-size: 16px;
    }

    .upgrade-card__amount {
      font-size: 24px;
    }

    .upgrade-card__key {
      display: none;
    }
  }

  .upgrade-stats {
    position: fixed;
    top: 76px;
    left: 16px;
    display: grid;
    grid-template-columns: auto auto auto;
    column-gap: 8px;
    row-gap: 2px;
    align-items: center;
    color: white;
    font: 12px system-ui, sans-serif;
    pointer-events: none;
    user-select: none;
  }

  .upgrade-stats__name {
    opacity: 0.65;
  }

  .upgrade-stats__value {
    font-weight: bold;
  }

  .upgrade-stats__pips {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    max-width: 120px;
  }

  .upgrade-stats__pip {
    width: 6px;
    height: 6px;
    border-radius: 1px;
  }
`;

// Что показать на экране выбора: за какой уровень выбор, сколько выборов ждут вместе с ним,
// карточки и бонусы забега до выбора (для «было → станет»).
type OfferView = {
  level: number;
  left: number;
  cards: UpgradeCard[];
  bonuses: UpgradeBonuses;
};

// Что показать в списке статов: бонусы забега и взятые карточки.
type StatsView = {
  bonuses: UpgradeBonuses;
  taken: UpgradeCard[];
};

export type UpgradeUi = {
  showOffer: (offer: OfferView) => void;
  hideOffer: () => void;
  setStats: (stats: StatsView) => void;

  // Показывать ли интерфейс вообще: в демо-режиме он скрыт, как и HUD. Состояние (открыт ли выбор)
  // при этом сохраняется и вернётся при показе.
  setVisible: (visible: boolean) => void;
};

// Элемент с классом и текстом — из таких собраны карточки и строки статов.
const createElement = ({ className, text = '' }: { className: string; text?: string }): HTMLDivElement => {
  const element = document.createElement('div');

  element.className = className;
  element.textContent = text;

  return element;
};

// Проверка «нажатие пришло из поля ввода?» — цифры, набранные в панели настроек, — не выбор карточки.
const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;

// Создаёт интерфейс. onPick(index) — игрок выбрал карточку номер index (с 0).
export const createUpgradeUi = ({ onPick }: { onPick: (index: number) => void }): UpgradeUi => {
  const style = document.createElement('style');

  style.textContent = STYLES;
  document.head.append(style);

  const overlay = createElement({ className: 'upgrade-overlay' });
  const title = createElement({ className: 'upgrade-overlay__title' });
  const cardsRow = createElement({ className: 'upgrade-overlay__cards' });
  const statsList = createElement({ className: 'upgrade-stats' });

  overlay.append(title, cardsRow);
  document.body.append(overlay, statsList);

  const state = { isVisible: true, isOfferShown: false, cardsCount: 0 };

  const apply = (): void => {
    overlay.classList.toggle('is-shown', state.isVisible && state.isOfferShown);
    statsList.style.display = state.isVisible ? '' : 'none';
  };

  // Карточка — кнопка: её можно нажать мышью, пальцем и с клавиатуры (Tab + Enter).
  const createCard = ({
    card,
    index,
    bonuses,
  }: {
    card: UpgradeCard;
    index: number;
    bonuses: UpgradeBonuses;
  }): HTMLButtonElement => {
    const texts = describeCard(card, bonuses);
    const button = document.createElement('button');

    button.className = 'upgrade-card';
    button.classList.toggle('is-pulsing', PULSING_RARITIES.includes(card.rarity));
    button.style.setProperty('--rarity', RARITY_COLORS[card.rarity]);
    button.dataset.test = `upgrade-card-${index}`;

    button.append(
      createElement({ className: 'upgrade-card__rarity', text: texts.rarityTitle }),
      createElement({ className: 'upgrade-card__title', text: texts.title }),
      createElement({ className: 'upgrade-card__amount', text: texts.amount }),
      createElement({ className: 'upgrade-card__change', text: `${texts.before} → ${texts.after}` }),
      createElement({ className: 'upgrade-card__key', text: `${index + 1}` }),
    );

    // Фокус после клика снимаем: иначе пробел «нажимал» бы кнопку уже следующего выбора.
    button.addEventListener('click', (): void => {
      button.blur();
      onPick(index);
    });

    return button;
  };

  const showOffer = ({ level, left, cards, bonuses }: OfferView): void => {
    const queueText = left > 1 ? ` (ещё ${left - 1})` : '';

    title.textContent = `Уровень ${level} — выбери усиление${queueText}`;
    cardsRow.replaceChildren(...cards.map((card, index) => createCard({ card, index, bonuses })));
    state.isOfferShown = true;
    state.cardsCount = cards.length;
    apply();
  };

  const hideOffer = (): void => {
    state.isOfferShown = false;
    apply();
  };

  // Строка на каждый стат: название, текущее значение с усилениями и точки взятых карточек.
  const setStats = ({ bonuses, taken }: StatsView): void => {
    const stats = getCombatStats(bonuses);

    statsList.replaceChildren(
      ...UPGRADE_STATS.flatMap((stat) => {
        const pips = createElement({ className: 'upgrade-stats__pips' });

        pips.append(
          ...taken
            .filter((card) => card.stat === stat)
            .map(({ rarity }) => {
              const pip = createElement({ className: 'upgrade-stats__pip' });

              pip.style.background = RARITY_COLORS[rarity];

              return pip;
            }),
        );

        return [
          createElement({ className: 'upgrade-stats__name', text: STAT_TEXTS[stat].title }),
          createElement({ className: 'upgrade-stats__value', text: STAT_TEXTS[stat].formatValue(stats) }),
          pips,
        ];
      }),
    );
  };

  const setVisible = (visible: boolean): void => {
    state.isVisible = visible;
    apply();
  };

  // Клавиши 1…9 выбирают карточку, пока выбор открыт и виден. event.repeat — удержание клавиши, пропускаем.
  window.addEventListener('keydown', (event: KeyboardEvent): void => {
    const index = Number(event.key) - 1;
    const isCardKey = Number.isInteger(index) && index >= 0 && index < state.cardsCount;

    if (!state.isOfferShown || !state.isVisible || event.repeat || !isCardKey || isTypingTarget(event.target)) {
      return;
    }

    event.preventDefault();
    onPick(index);
  });

  return { showOffer, hideOffer, setStats, setVisible };
};
