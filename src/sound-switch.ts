// Кнопка общего мута 🔊 / 🔇 — в том ряду, что и переключатель скорости (левый нижний угол):
// выключает и включает весь звук сразу. Настройки каждого типа (громкость, свой мут, набор) —
// в панели настроек, раздел «Звук» (settings-panel.ts), их туда и перенесли, когда звуков стало три.
//
// Состояние живёт в sound.ts: кнопка только показывает иконку и передаёт переключение,
// поэтому mute переживает перезагрузку страницы.
import type { Sound } from './sound';

const ICON_ON = '🔊';
const ICON_MUTED = '🔇';

const TOOLTIP_ON = 'Выключить звук';
const TOOLTIP_MUTED = 'Включить звук';

// Стиль — такой же, как у кнопок скорости (см. speed-switch.ts): один ряд — один вид.
const BUTTON_STYLE = `
  min-width: 36px;
  margin-left: 8px;
  padding: 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 6px;
  font: bold 13px system-ui, sans-serif;
  white-space: nowrap;
  cursor: pointer;
`;

export type SoundSwitch = {
  // Проверка «событие произошло на кнопке звука?» — чтобы клик по ней не перезапускал игру.
  isSwitchTarget: (target: EventTarget | null) => boolean;
};

// Кнопка живёт внутри ряда переключателя скорости (speed-switch.ts отдаёт этот ряд), поэтому
// автоматически поднимается над шапкой панели на узком экране, а клик по ней не перезапускает игру
// (main.ts проверяет весь ряд через isSwitchTarget скорости).
export const createSoundSwitch = ({ container, sound }: { container: HTMLDivElement; sound: Sound }): SoundSwitch => {
  const muteButton = document.createElement('button');
  muteButton.style.cssText = BUTTON_STYLE;

  // Выключенный звук — тусклая иконка 🔇, включенный — яркая 🔊.
  const updateLook = (): void => {
    const isMuted = sound.isMuted();

    muteButton.textContent = isMuted ? ICON_MUTED : ICON_ON;
    muteButton.style.opacity = isMuted ? '0.5' : '1';
    muteButton.title = isMuted ? TOOLTIP_MUTED : TOOLTIP_ON;
  };

  muteButton.addEventListener('click', (): void => {
    sound.setMuted(!sound.isMuted());
    updateLook();

    // Снимаем фокус: иначе пробел (он же перезапускает игру после поражения) «нажал» бы кнопку
    // второй раз и снова включил бы звук.
    muteButton.blur();
  });

  container.append(muteButton);
  updateLook();

  return {
    isSwitchTarget: (target: EventTarget | null): boolean => target instanceof Node && muteButton.contains(target),
  };
};
