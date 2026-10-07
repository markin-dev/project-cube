// HUD (heads-up display) — надписи поверх игры. Это обычные HTML-элементы над canvas:
// текст в HTML делать намного проще, чем рисовать его в 3D-сцене.

type WaveInfo = {
  // Номер волны для игрока — с 1.
  number: number;
  total: number;
  name: string;
};

type EndScreenText = {
  title: string;
  hint: string;
};

export type Hud = {
  setWave: (wave: WaveInfo) => void;
  showEndScreen: (text: EndScreenText) => void;
  hideEndScreen: () => void;
};

export const createHud = (): Hud => {
  // Номер и название волны в левом верхнем углу.
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

  // Экран конца игры (поражение или победа): полупрозрачная заливка на всё окно и текст по центру.
  // Пока игра идёт, он скрыт (display: none).
  const endScreen = document.createElement('div');

  endScreen.style.cssText = `
    position: fixed;
    inset: 0;
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
    waveLabel.innerHTML = `
      <div>Волна ${number} / ${total}</div>
      <div style="font-size: 14px; font-weight: normal; opacity: 0.7">${name}</div>
    `;
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

  return { setWave, showEndScreen, hideEndScreen };
};
