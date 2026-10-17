// HUD (heads-up display) — надписи поверх игры. Это обычные HTML-элементы над canvas:
// текст в HTML делать намного проще, чем рисовать его в 3D-сцене.
import { keepAboveSettingsPanel } from './layout';

type WaveInfo = {
  // Сквозной номер волны для игрока — с 1: после первой десятки волны идут дальше (11, 12, …),
  // хотя составы волн в списке повторяются с начала.
  number: number;
};

type GroupInfo = {
  // Номер последней начавшейся группы волны (с 1; 0 — ни одна ещё не началась) и сколько их всего.
  number: number;
  total: number;
};

type EndScreenText = {
  title: string;
  hint: string;
};

// Полигон (см. polygon.ts): номер сетки и сколько её врагов ещё живо из скольких.
type PolygonInfo = {
  number: number;
  alive: number;
  total: number;
};

// Прогресс прокачки куба: уровень и опыт на нём (xp из needed — заполнение полосы).
type ProgressInfo = {
  level: number;
  xp: number;
  needed: number;
};

export type Hud = {
  setWave: (wave: WaveInfo) => void;
  setGroup: (group: GroupInfo) => void;

  // На полигоне вместо волны и группы — номер сетки и счётчик живых врагов (те же две строки).
  setPolygon: (polygon: PolygonInfo) => void;

  setProgress: (progress: ProgressInfo) => void;
  showEndScreen: (text: EndScreenText) => void;
  hideEndScreen: () => void;

  // Показывать ли HUD вообще: в демо-режиме (см. demo-scene.ts) игровые надписи скрыты.
  // Скрытие не трогает состояние надписей — при возврате к игре они появляются снова сами.
  setVisible: (visible: boolean) => void;
};

export const createHud = (): Hud => {
  // Номер волны и под ним счётчик групп — в левом верхнем углу (на полигоне — номер сетки и живые враги).
  // position: fixed — элемент привязан к окну и лежит поверх canvas.
  // pointer-events: none — касания проходят сквозь надпись к тому, что под ней.
  const waveLabel = document.createElement('div');

  waveLabel.style.cssText = `
    position: fixed;
    top: 16px;
    left: 16px;
    color: white;
    font: bold 20px system-ui, sans-serif;
    pointer-events: none;
    user-select: none;
  `;

  // Две строки — отдельные элементы, чтобы номер группы обновлялся, не трогая остальное.
  const waveLine = document.createElement('div');
  const groupLine = document.createElement('div');
  groupLine.style.cssText = 'font-size: 16px;';
  waveLabel.append(waveLine, groupLine);

  // Полоса опыта — внизу по центру: уровень куба, сама полоса и цифры «сколько / сколько нужно».
  // z-index: 2 — как у переключателя скорости: полоса видна и поверх экрана поражения.
  // pointer-events: none — клики проходят сквозь неё (по экрану поражения, по канвасу).
  const progressLabel = document.createElement('div');

  progressLabel.style.cssText = `
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 300px;
    color: white;
    font: bold 14px system-ui, sans-serif;
    pointer-events: none;
    user-select: none;
  `;

  const levelLine = document.createElement('div');

  // Тонкая рамка полосы с тёмным фоном, внутри — заливка, шириной в долю опыта (в процентах).
  const barTrack = document.createElement('div');

  barTrack.style.cssText = `
    width: 100%;
    height: 10px;
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 5px;
    background: rgba(0, 0, 0, 0.5);
    overflow: hidden;
  `;

  const barFill = document.createElement('div');
  barFill.style.cssText = 'height: 100%; width: 0%; background: white; border-radius: 4px;';
  barTrack.append(barFill);

  const xpLine = document.createElement('div');
  xpLine.style.cssText = 'font-size: 12px; font-weight: normal; opacity: 0.8;';

  progressLabel.append(levelLine, barTrack, xpLine);

  // На узком экране внизу лежит свёрнутая шапка панели настроек — поднимаем полосу над ней.
  keepAboveSettingsPanel(progressLabel);

  // Экран конца игры: полупрозрачная заливка на всё окно и текст по центру.
  // Пока игра идёт, он скрыт (display: none).
  // z-index: 1 — поверх цифр урона, которые ещё досматривают свою анимацию после конца игры.
  const endScreen = document.createElement('div');

  endScreen.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 1;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 16px;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    font: 18px system-ui, sans-serif;
    text-align: center;
    user-select: none;
  `;

  document.body.append(waveLabel, progressLabel, endScreen);

  // HUD может быть целиком скрыт (демо-режим), при этом состояние надписей сохраняется:
  // скрытый экран поражения не пропадает из памяти и вернётся при показе HUD.
  let isVisible = true;
  let isEndScreenShown = false;

  const applyEndScreen = (): void => {
    endScreen.style.display = isVisible && isEndScreenShown ? 'flex' : 'none';
  };

  const setWave = ({ number }: WaveInfo): void => {
    waveLine.textContent = `Волна ${number}`;
  };

  const setGroup = ({ number, total }: GroupInfo): void => {
    groupLine.textContent = `Группа ${number} / ${total}`;
  };

  const setPolygon = ({ number, alive, total }: PolygonInfo): void => {
    waveLine.textContent = `Полигон · сетка ${number}`;
    groupLine.textContent = `Врагов ${alive} / ${total}`;
  };

  const setProgress = ({ level, xp, needed }: ProgressInfo): void => {
    levelLine.textContent = `Уровень ${level}`;
    xpLine.textContent = `${xp} / ${needed}`;
    barFill.style.width = `${Math.min(100, (xp / needed) * 100)}%`;
  };

  const showEndScreen = ({ title, hint }: EndScreenText): void => {
    endScreen.innerHTML = `
      <div style="font-size: 32px; font-weight: bold">${title}</div>
      <div>${hint}</div>
    `;

    isEndScreenShown = true;
    applyEndScreen();
  };

  const hideEndScreen = (): void => {
    isEndScreenShown = false;
    applyEndScreen();
  };

  const setVisible = (visible: boolean): void => {
    isVisible = visible;
    waveLabel.style.display = visible ? '' : 'none';
    progressLabel.style.display = visible ? '' : 'none';
    applyEndScreen();
  };

  return { setWave, setGroup, setPolygon, setProgress, showEndScreen, hideEndScreen, setVisible };
};
