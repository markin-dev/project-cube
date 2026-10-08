// Переключатель скорости игры — кнопки в левом нижнем углу, отдельно от панели настроек.
// Сама скорость применяется в игровом цикле (main.ts): игровое время кадра умножается на выбранную скорость.
import { NARROW_SCREEN_WIDTH } from './settings-panel';

// Скорости на выбор: 0 — пауза, 1 — обычная, больше — ускорение, меньше — замедление.
const SPEEDS = [0, 0.5, 1, 2, 4, 8];
const DEFAULT_SPEED = 1;

// Отступ от нижнего края. На узком экране внизу лежит свёрнутая шапка панели настроек —
// поднимаем переключатель над ней.
const BOTTOM_OFFSET = 16;
const NARROW_SCREEN_BOTTOM_OFFSET = 48;

const getSpeedLabel = (speed: number): string => (speed === 0 ? '⏸' : `×${speed}`);

export type SpeedSwitch = {
  // Проверка «событие произошло на переключателе?» — чтобы клик по нему не перезапускал игру.
  isSwitchTarget: (target: EventTarget | null) => boolean;

  // Ряд кнопок в левом нижнем углу. В этот же ряд main.ts ставит кнопку звука (sound-switch.ts):
  // так оба контрола стоят рядом и вместе поднимаются над шапкой панели на узком экране.
  container: HTMLDivElement;
};

// Выбранная кнопка — светлая, остальные — тёмные полупрозрачные.
const setButtonLook = (button: HTMLButtonElement, isSelected: boolean): void => {
  button.style.background = isSelected ? 'white' : 'rgba(0, 0, 0, 0.5)';
  button.style.color = isSelected ? 'black' : 'white';
};

// Создаёт переключатель и сразу выбирает обычную скорость. onChange вызывается при каждом выборе.
export const createSpeedSwitch = ({ onChange }: { onChange: (speed: number) => void }): SpeedSwitch => {
  const isNarrowScreen = window.innerWidth < NARROW_SCREEN_WIDTH;
  const container = document.createElement('div');

  // z-index: 2 — поверх экрана конца игры (у него 1): скорость можно переключить и после поражения.
  // flex-wrap + max-width: в ряду ещё кнопки звука (sound-switch.ts) — на узком экране они
  // переносятся на вторую строку, а не вылезают за правый край.
  container.style.cssText = `
    position: fixed;
    left: 16px;
    bottom: ${isNarrowScreen ? NARROW_SCREEN_BOTTOM_OFFSET : BOTTOM_OFFSET}px;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    max-width: calc(100vw - 32px);
    gap: 4px;
    user-select: none;
  `;

  const buttons = SPEEDS.map((speed) => {
    const button = document.createElement('button');
    button.textContent = getSpeedLabel(speed);

    button.style.cssText = `
      min-width: 36px;
      padding: 6px 8px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 6px;
      font: bold 13px system-ui, sans-serif;
      cursor: pointer;
    `;

    // После клика снимаем с кнопки фокус: иначе пробел (он же перезапускает игру после поражения)
    // ещё и «нажимал» бы последнюю выбранную кнопку.
    button.addEventListener('click', (): void => {
      selectSpeed(speed);
      button.blur();
    });

    return button;
  });

  const selectSpeed = (speed: number): void => {
    for (const [index, button] of buttons.entries()) {
      setButtonLook(button, SPEEDS[index] === speed);
    }

    onChange(speed);
  };

  container.append(...buttons);
  document.body.append(container);
  selectSpeed(DEFAULT_SPEED);

  return {
    isSwitchTarget: (target: EventTarget | null): boolean => target instanceof Node && container.contains(target),
    container,
  };
};
