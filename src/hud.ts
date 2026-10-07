// HUD (heads-up display) — надписи поверх игры. Это обычные HTML-элементы над canvas:
// текст в HTML делать намного проще, чем рисовать его в 3D-сцене.

export type Hud = {
  setWave: (wave: number) => void;
  showGameOver: (wave: number) => void;
  hideGameOver: () => void;
};

export const createHud = (): Hud => {
  // Номер волны в левом верхнем углу.
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

  // Экран конца игры: полупрозрачная заливка на всё окно и текст по центру.
  // Пока игра идёт, он скрыт (display: none).
  const gameOverScreen = document.createElement('div');

  gameOverScreen.style.cssText = `
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

  document.body.append(waveLabel, gameOverScreen);

  const setWave = (wave: number): void => {
    waveLabel.textContent = `Волна ${wave}`;
  };

  const showGameOver = (wave: number): void => {
    gameOverScreen.innerHTML = `
      <div style="font-size: 32px; font-weight: bold">Игра окончена — волна ${wave}</div>
      <div>Нажми, чтобы начать заново</div>
    `;

    gameOverScreen.style.display = 'flex';
  };

  const hideGameOver = (): void => {
    gameOverScreen.style.display = 'none';
  };

  return { setWave, showGameOver, hideGameOver };
};
