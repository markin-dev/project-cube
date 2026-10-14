// Цифры урона: при попадании над врагом всплывает число, поднимается и тает.
// Это HTML-элементы поверх canvas, как и HUD: текст в HTML чёткий на любом экране
// и легко оформляется через CSS, а в 3D-сцене для него пришлось бы рисовать текстуры.
import * as THREE from 'three';
import { config } from './config';

// Сколько цифр может висеть на экране одновременно. Обычно их меньше десяти, но залп из 20 снарядов
// на ускорении даёт сотни попаданий в секунду — каждая цифра это DOM-элемент с анимацией, и без
// предела они тормозили бы страницу. Сверх предела новая цифра вытесняет самую старую.
const MAX_ALIVE_DAMAGE_NUMBERS = 100;

type DamageNumberParams = {
  // Точка в 3D-мире, над которой появится число.
  position: THREE.Vector3;
  damage: number;

  // Критическое ли это попадание: крит-число другого цвета (DAMAGE_NUMBER_CRIT_COLOR)
  // и крупнее (DAMAGE_NUMBER_CRIT_FONT_SCALE).
  isCrit?: boolean;
};

export type ShowDamageNumber = (params: DamageNumberParams) => void;

// Создаёт слой для чисел и возвращает функцию, которая показывает одно число. camera — по ней точка
// мира переводится в пиксели экрана.
export const createDamageNumbers = ({ camera }: { camera: THREE.Camera }): ShowDamageNumber => {
  // Общий слой на весь экран. pointer-events: none — касания проходят сквозь него к игре.
  // overflow: hidden — числа у края экрана не создают полосы прокрутки.
  const layer = document.createElement('div');

  layer.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  `;

  document.body.append(layer);

  return ({ position, damage, isCrit = false }: DamageNumberParams): void => {
    // project переводит точку мира в координаты экрана камеры: от -1 до 1 по X (слева направо)
    // и по Y (снизу вверх). Пересчитываем их в пиксели окна, где Y растёт сверху вниз.
    // Canvas занимает всё окно, поэтому пиксели окна совпадают с пикселями картинки.
    const projected = position.clone().project(camera);
    const jitter = (Math.random() * 2 - 1) * config.DAMAGE_NUMBER_JITTER;
    const x = ((projected.x + 1) / 2) * window.innerWidth + jitter;
    const y = ((1 - projected.y) / 2) * window.innerHeight;

    // translate(-50%, -50%) ставит центр числа ровно в точку (x, y), а не его левый верхний угол.
    // Тёмная тень вокруг букв работает как обводка: число читается и на полу, и на красном враге.
    const element = document.createElement('div');
    element.textContent = String(damage);

    // Семантические классы — чтобы E2E-тесты (vitest browser mode) могли найти цифры урона и отличить
    // крит от обычного по разметке, а не по хрупкому совпадению inline-цвета. В стилях игры не мешают.
    element.classList.add('damage-number');
    if (isCrit) {
      element.classList.add('is-crit');
    }

    // Крит отличается цветом (алый вместо белого) и кеглем (в DAMAGE_NUMBER_CRIT_FONT_SCALE раз
    // крупнее) — так он выделяется на фоне потока обычных цифр. Тень и анимация — как у обычных.
    const color = isCrit ? config.DAMAGE_NUMBER_CRIT_COLOR : config.DAMAGE_NUMBER_COLOR;

    const fontSize = isCrit
      ? config.DAMAGE_NUMBER_FONT_SIZE * config.DAMAGE_NUMBER_CRIT_FONT_SCALE
      : config.DAMAGE_NUMBER_FONT_SIZE;

    element.style.cssText = `
      position: absolute;
      left: ${x}px;
      top: ${y}px;
      transform: translate(-50%, -50%);
      color: ${color};
      font: bold ${fontSize}px system-ui, sans-serif;
      text-shadow: 0 0 3px black, 0 0 3px black;
      user-select: none;
    `;

    if (layer.childElementCount >= MAX_ALIVE_DAMAGE_NUMBERS) {
      layer.firstElementChild?.remove();
    }

    layer.append(element);

    // element.animate (Web Animations API) плавно переводит элемент из первого состояния во второе:
    // число поднимается на config.DAMAGE_NUMBER_RISE пикселей и становится прозрачным.
    // ease-out — быстро в начале и медленно в конце, как подброшенный предмет.
    const animation = element.animate(
      [
        { transform: 'translate(-50%, -50%)', opacity: 1 },
        { transform: `translate(-50%, calc(-50% - ${config.DAMAGE_NUMBER_RISE}px))`, opacity: 0 },
      ],
      { duration: config.DAMAGE_NUMBER_DURATION * 1000, easing: 'ease-out' },
    );

    // Анимация закончилась — элемент больше не нужен, иначе они копились бы бесконечно.
    animation.onfinish = (): void => {
      element.remove();
    };
  };
};
