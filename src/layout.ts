// Раскладка интерфейса под ширину экрана. На узком экране (телефон вертикально) панель настроек
// прижата к нижнему краю, а переключатель скорости и счётчик FPS подняты над её шапкой.
// Ширина меняется на ходу (поворот телефона, ресайз окна) — раскладка перестраивается сразу.

// Экран уже 700 px считаем узким.
const NARROW_SCREEN_QUERY = '(max-width: 699px)';

// Отступ от нижнего края для кнопок и надписей в нижних углах. На узком экране внизу лежит
// свёрнутая шапка панели настроек — поднимаемся над ней.
const BOTTOM_OFFSET = 16;
const NARROW_SCREEN_BOTTOM_OFFSET = 48;

// Вызывает onChange сразу с текущим состоянием и потом при каждом переходе через границу ширины.
export const watchNarrowScreen = (onChange: (isNarrow: boolean) => void): void => {
  const query = window.matchMedia(NARROW_SCREEN_QUERY);

  onChange(query.matches);
  query.addEventListener('change', (event: MediaQueryListEvent): void => onChange(event.matches));
};

// Держит элемент у нижнего края экрана, а на узком экране — над шапкой панели настроек.
export const keepAboveSettingsPanel = (element: HTMLElement): void => {
  watchNarrowScreen((isNarrow: boolean): void => {
    element.style.bottom = `${isNarrow ? NARROW_SCREEN_BOTTOM_OFFSET : BOTTOM_OFFSET}px`;
  });
};
