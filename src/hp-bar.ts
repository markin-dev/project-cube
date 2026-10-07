// Полоска здоровья над врагом: тёмная подложка и зелёная полоска поверх неё.
// Это две плоскости в 3D-сцене, которые всегда повёрнуты к камере («билборд»).
import * as THREE from 'three';
import { config } from './config';

export type HpBar = {
  // Группа двигается и поворачивается целиком; её же прячем, когда здоровье полное.
  group: THREE.Group;

  // Зелёная полоска — её длину меняем при уроне.
  fill: THREE.Mesh;

  // Длина полоски при полном здоровье. Запоминаем при создании: если HP_BAR_WIDTH поменяют
  // в панели настроек, у уже созданных полосок подложка и полоска останутся согласованными.
  width: number;
};

// depthTest: false — рисовать, не проверяя, что ближе к камере. Иначе полоску закрывали бы
// кубы врагов, стоящих впереди. renderOrder (ниже) задаёт порядок: сначала подложка, потом полоска.
// Материалы общие на все полоски — цвета можно поменять на ходу (refreshHpBarColors).
const BACKGROUND_MATERIAL = new THREE.MeshBasicMaterial({ color: config.HP_BAR_BACKGROUND_COLOR, depthTest: false });
const FILL_MATERIAL = new THREE.MeshBasicMaterial({ color: config.HP_BAR_FILL_COLOR, depthTest: false });

// Геометрии — плоскости 1×1, общие на все полоски. Нужный размер задаётся масштабом меша (scale),
// поэтому размеры из панели настроек применяются к новым полоскам без пересоздания геометрий.
const BACKGROUND_GEOMETRY = new THREE.PlaneGeometry(1, 1);

// Обычная плоскость растёт от центра в обе стороны. Сдвигаем её геометрию вправо на половину длины,
// чтобы левый край оказался в начале координат: тогда при уменьшении scale.x полоска укорачивается
// к левому краю, как и положено полоске здоровья.
const FILL_GEOMETRY = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);

// Порядок отрисовки: чем больше число, тем позже рисуется объект — то есть поверх остальных.
const BACKGROUND_RENDER_ORDER = 1;
const FILL_RENDER_ORDER = 2;

// Создаёт скрытую полоску: у нового врага здоровье полное. Размеры — из конфига на момент создания.
export const createHpBar = (): HpBar => {
  const width = config.HP_BAR_WIDTH;
  const height = config.HP_BAR_HEIGHT;
  const border = config.HP_BAR_BORDER;

  // Подложка чуть больше полоски — её край виден как тёмная рамка.
  const background = new THREE.Mesh(BACKGROUND_GEOMETRY, BACKGROUND_MATERIAL);
  background.scale.set(width + border * 2, height + border * 2, 1);
  background.renderOrder = BACKGROUND_RENDER_ORDER;

  // Левый край полоски совпадает с левым краем подложки (без рамки).
  const fill = new THREE.Mesh(FILL_GEOMETRY, FILL_MATERIAL);
  fill.position.x = -width / 2;
  fill.scale.set(width, height, 1);
  fill.renderOrder = FILL_RENDER_ORDER;

  const group = new THREE.Group();
  group.add(background, fill);
  group.visible = false;

  return { group, fill, width };
};

// fraction — доля оставшегося здоровья, от 0 до 1. При полном здоровье полоска скрыта.
export const setHpBarValue = (hpBar: HpBar, fraction: number): void => {
  hpBar.group.visible = fraction < 1;
  hpBar.fill.scale.x = hpBar.width * Math.max(fraction, 0);
};

// Поворачиваем полоску так же, как повёрнута камера, — тогда она всегда смотрит прямо на зрителя.
// Работает потому, что сам враг не вращается: поворот группы относительно врага равен её повороту в мире.
export const turnToCamera = (hpBar: HpBar, camera: THREE.Camera): void => {
  hpBar.group.quaternion.copy(camera.quaternion);
};

// Перекрашивает все полоски по текущему конфигу — вызывается, когда цвета меняют в панели настроек.
export const refreshHpBarColors = (): void => {
  BACKGROUND_MATERIAL.color.set(config.HP_BAR_BACKGROUND_COLOR);
  FILL_MATERIAL.color.set(config.HP_BAR_FILL_COLOR);
};
