// Кнопки звука — в том ряду, что и переключатель скорости (левый нижний угол): выключение звука
// и выбор одного из наборов (sound.ts). Состояние живёт в sound.ts: кнопки только показывают
// иконку/подсветку и передают переключение, поэтому выборы переживают перезагрузку страницы.
import { SOUND_SETS, type Sound } from './sound';

const ICON_ON = '🔊';
const ICON_MUTED = '🔇';

const TOOLTIP_ON = 'Выключить звук';
const TOOLTIP_MUTED = 'Включить звук';

// Стиль — такой же, как у кнопок скорости (см. speed-switch.ts): один ряд — один вид.
const BUTTON_STYLE = `
  min-width: 36px;
  padding: 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  font: bold 13px system-ui, sans-serif;
  white-space: nowrap;
  cursor: pointer;
`;

export type SoundSwitch = {
  // Проверка «событие произошло на кнопках звука?» — чтобы клик по ним не перезапускал игру.
  isSwitchTarget: (target: EventTarget | null) => boolean;
};

// Выбранная кнопка набора — светлая, остальные — тёмные: так же, как кнопки скорости.
const setSelectedLook = (button: HTMLButtonElement, isSelected: boolean): void => {
  button.style.background = isSelected ? 'white' : 'rgba(0, 0, 0, 0.5)';
  button.style.color = isSelected ? 'black' : 'white';
};

// Кнопки живут внутри ряда переключателя скорости (speed-switch.ts отдаёт этот ряд), поэтому
// автоматически поднимаются над шапкой панели на узком экране, а клик по ним не перезапускает игру
// (main.ts проверяет весь ряд через isSwitchTarget скорости).
export const createSoundSwitch = ({ container, sound }: { container: HTMLDivElement; sound: Sound }): SoundSwitch => {
  // Свой подрядок внутри ряда: сначала мут, отступ, потом наборы.
  const group = document.createElement('div');
  group.style.cssText = 'display: flex; gap: 4px; margin-left: 8px;';

  const muteButton = document.createElement('button');
  muteButton.style.cssText = BUTTON_STYLE;

  // Выключенный звук — тусклая иконка 🔇, включенный — яркая 🔊.
  const updateMuteLook = (): void => {
    const isMuted = sound.isMuted();

    muteButton.textContent = isMuted ? ICON_MUTED : ICON_ON;
    muteButton.style.opacity = isMuted ? '0.5' : '1';
    muteButton.title = isMuted ? TOOLTIP_MUTED : TOOLTIP_ON;
  };

  muteButton.addEventListener('click', (): void => {
    sound.setMuted(!sound.isMuted());
    updateMuteLook();

    // Снимаем фокус: иначе пробел (он же перезапускает игру после поражения) «нажал» бы кнопку
    // второй раз и снова включил бы звук.
    muteButton.blur();
  });

  group.append(muteButton);

  const setButtons = SOUND_SETS.map(({ id, title }) => {
    const button = document.createElement('button');

    button.textContent = title;
    button.title = `Звук попадания: ${title}`;
    button.style.cssText = BUTTON_STYLE;

    button.addEventListener('click', (): void => {
      sound.setSetId(id);
      updateSetLooks();
      button.blur();
    });

    group.append(button);

    return { id, button };
  });

  const updateSetLooks = (): void => {
    for (const { id, button } of setButtons) {
      setSelectedLook(button, sound.getSetId() === id);
    }
  };

  container.append(group);
  updateMuteLook();
  updateSetLooks();

  return {
    isSwitchTarget: (target: EventTarget | null): boolean => target instanceof Node && group.contains(target),
  };
};
