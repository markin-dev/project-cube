// HUD (heads-up display) — надписи поверх игры. Это обычные HTML-элементы над canvas:
// текст в HTML делать намного проще, чем рисовать его в 3D-сцене.

type WaveInfo = {
  // Номер волны для игрока — с 1.
  number: number;
  total: number;
  name: string;
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

export type Hud = {
  setWave: (wave: WaveInfo) => void;
  setGroup: (group: GroupInfo) => void;
  showEndScreen: (text: EndScreenText) => void;
  hideEndScreen: () => void;
};

export const createHud = (): Hud => {
  // Номер волны, под ним счётчик групп и название волны — в левом верхнем углу.
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

  // Три строки — отдельные элементы, чтобы номер группы обновлялся, не трогая остальное.
  const waveLine = document.createElement('div');
  const groupLine = document.createElement('div');
  const nameLine = document.createElement('div');
  groupLine.style.cssText = 'font-size: 16px;';
  nameLine.style.cssText = 'font-size: 14px; font-weight: normal; opacity: 0.7;';
  waveLabel.append(waveLine, groupLine, nameLine);

  // Экран конца игры (поражение или победа): полупрозрачная заливка на всё окно и текст по центру.
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

  document.body.append(waveLabel, endScreen);

  const setWave = ({ number, total, name }: WaveInfo): void => {
    waveLine.textContent = `Волна ${number} / ${total}`;
    nameLine.textContent = name;
  };

  const setGroup = ({ number, total }: GroupInfo): void => {
    groupLine.textContent = `Группа ${number} / ${total}`;
  };

  const showEndScreen = ({ title, hint }: EndScreenText): void => {
    endScreen.innerHTML = `
      <div style="font-size: 32px; font-weight: bold">${title}</div>
      <div>${hint}</div>
    `;

    endScreen.style.display = 'flex';
  };

  const hideEndScreen = (): void => {
    endScreen.style.display = 'none';
  };

  return { setWave, setGroup, showEndScreen, hideEndScreen };
};
