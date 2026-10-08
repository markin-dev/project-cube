// Счётчик FPS в правом нижнем углу: сколько кадров в секунду реально рисует браузер.
// Это диагностика, поэтому замер честный: считается реальное время кадра, а не игровое, —
// лаг или возврат на вкладку видны как просадка счётчика, а не замаскированы ограничением
// MAX_FRAME_TIME или выбранной скоростью игры.
//
// Надпись — обычный HTML поверх canvas, как HUD: pointer-events: none — клики и касания
// проходят сквозь неё к игре, поэтому счётчик не мешает перезапуску и не нужен в isUiTarget.
import { NARROW_SCREEN_WIDTH } from './settings-panel';

// Как часто обновлять число. Раз в полсекунды: значение не дёргается от одиночного
// тормозящего кадра, но заметно реагирует на настоящую просадку.
const UPDATE_INTERVAL = 0.5;

// Отступ от краёв — как у переключателя скорости (см. speed-switch.ts). На узком экране
// внизу лежит свёрнутая шапка панели настроек — поднимаем счётчик над ней.
const BOTTOM_OFFSET = 16;
const NARROW_SCREEN_BOTTOM_OFFSET = 48;

export type FpsCounter = {
  // Вызывается каждый кадр игрового цикла с реальным временем кадра в секундах.
  tick: (delta: number) => void;
};

// Создаёт надпись и возвращает функцию подсчёта. Вызывается один раз при старте игры.
export const createFpsCounter = (): FpsCounter => {
  const isNarrowScreen = window.innerWidth < NARROW_SCREEN_WIDTH;
  const label = document.createElement('div');
  label.textContent = '— FPS';

  // Оформление — как кнопки переключателя скорости, чтобы углы экрана выглядели парой.
  // z-index: 2 — поверх экрана конца игры: FPS интересен и после поражения.
  label.style.cssText = `
    position: fixed;
    right: 16px;
    bottom: ${isNarrowScreen ? NARROW_SCREEN_BOTTOM_OFFSET : BOTTOM_OFFSET}px;
    z-index: 2;
    padding: 6px 8px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.5);
    color: white;
    font: bold 13px system-ui, sans-serif;
    pointer-events: none;
    user-select: none;
  `;

  document.body.append(label);

  // Кадры и реальное время с последнего обновления числа.
  let frames = 0;
  let elapsed = 0;

  const tick = (delta: number): void => {
    frames += 1;
    elapsed += delta;

    if (elapsed < UPDATE_INTERVAL) {
      return;
    }

    // frames / elapsed — сколько кадров в среднем укладывалось в секунду.
    label.textContent = `${Math.round(frames / elapsed)} FPS`;
    frames = 0;
    elapsed = 0;
  };

  return { tick };
};
