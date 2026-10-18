// Отладочный режим: панель настроек (с пресетами, выбором волны, демо-сценой и полигоном), сохранённые
// в браузере правки конфига и наборы звуков, счётчик FPS, скорости ×8 и ×16, строка «Группа N / M».
// Всё это нужно для разработки, а игроку на проде — нет.
//
// Включается параметром ?debug в адресе (http://localhost:5173/cube/?debug) и только на dev-сервере
// (npm run dev). В прод-сборке (npm run build) Vite подставляет вместо import.meta.env.DEV значение false,
// поэтому там отладки нет даже с параметром. Больше того: там, где отладочный код должен исчезнуть
// из бандла целиком, условие пишется как `import.meta.env.DEV && IS_DEBUG` — сборщик видит false прямо
// в этом модуле и вырезает ветку вместе с её динамическими import() (см. main.ts, config.ts).
//
// В тестах vitest (режим 'test') отладка включена всегда: юниты и E2E проверяют и панель, и всё остальное.

// Откуда решаем: dev-сервер или сборка, режим Vite ('development', 'production', 'test') и строка
// параметров адреса (location.search, например '?debug').
type DebugSource = {
  isDev: boolean;
  mode: string;
  search: string;
};

// Нужна ли отладка. Сборка — никогда. Dev-сервер — только с параметром debug в адресе (значение не важно:
// ?debug, ?debug=1). Тесты — всегда.
export const isDebugRequested = ({ isDev, mode, search }: DebugSource): boolean =>
  isDev && (mode === 'test' || new URLSearchParams(search).has('debug'));

// Решение для текущей страницы — один раз при загрузке: параметр в адресе за время игры не меняется.
// import.meta.env.DEV снаружи вызова — чтобы в сборке IS_DEBUG стал просто false, без вызова функции:
// тогда сборщик выкидывает и мелкие отладочные ветки в других модулях (скорости ×8/×16, строку группы).
export const IS_DEBUG =
  import.meta.env.DEV &&
  isDebugRequested({
    isDev: import.meta.env.DEV,
    mode: import.meta.env.MODE,
    search: window.location.search,
  });
