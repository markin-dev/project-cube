// Полоска здоровья над врагом: тёмная подложка и зелёная полоска поверх неё.
// Это две плоскости в 3D-сцене, которые всегда повёрнуты к камере («билборд»).
import * as THREE from 'three';
import {
  HP_BAR_BACKGROUND_COLOR,
  HP_BAR_BORDER,
  HP_BAR_FILL_COLOR,
  HP_BAR_HEIGHT,
  HP_BAR_WIDTH,
} from './config';

export type HpBar = {
  // Группа двигается и поворачивается целиком; её же прячем, когда здоровье полное.
  group: THREE.Group;

  // Зелёная полоска — её длину меняем при уроне.
  fill: THREE.Mesh;
};

// depthTest: false — рисовать, не проверяя, что ближе к камере. Иначе полоску закрывали бы
// кубы врагов, стоящих впереди. renderOrder (ниже) задаёт порядок: сначала подложка, потом полоска.
const BACKGROUND_MATERIAL = new THREE.MeshBasicMaterial({ color: HP_BAR_BACKGROUND_COLOR, depthTest: false });
const FILL_MATERIAL = new THREE.MeshBasicMaterial({ color: HP_BAR_FILL_COLOR, depthTest: false });

// Подложка чуть больше полоски — её край виден как тёмная рамка.
const BACKGROUND_GEOMETRY = new THREE.PlaneGeometry(HP_BAR_WIDTH + HP_BAR_BORDER * 2, HP_BAR_HEIGHT + HP_BAR_BORDER * 2);

// Обычная плоскость растёт от центра в обе стороны. Сдвигаем её геометрию вправо на половину длины,
// чтобы левый край оказался в начале координат: тогда при scale.x < 1 полоска укорачивается
// к левому краю, как и положено полоске здоровья.
const FILL_GEOMETRY = new THREE.PlaneGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT).translate(HP_BAR_WIDTH / 2, 0, 0);

// Порядок отрисовки: чем больше число, тем позже рисуется объект — то есть поверх остальных.
const BACKGROUND_RENDER_ORDER = 1;
const FILL_RENDER_ORDER = 2;

// Создаёт скрытую полоску: у нового врага здоровье полное.
export const createHpBar = (): HpBar => {
  const background = new THREE.Mesh(BACKGROUND_GEOMETRY, BACKGROUND_MATERIAL);
  background.renderOrder = BACKGROUND_RENDER_ORDER;

  // Левый край полоски совпадает с левым краем подложки (без рамки).
  const fill = new THREE.Mesh(FILL_GEOMETRY, FILL_MATERIAL);
  fill.position.x = -HP_BAR_WIDTH / 2;
  fill.renderOrder = FILL_RENDER_ORDER;

  const group = new THREE.Group();
  group.add(background, fill);
  group.visible = false;

  return { group, fill };
};

// fraction — доля оставшегося здоровья, от 0 до 1. При полном здоровье полоска скрыта.
export const setHpBarValue = (hpBar: HpBar, fraction: number): void => {
  hpBar.group.visible = fraction < 1;
  hpBar.fill.scale.x = Math.max(fraction, 0);
};

// Поворачиваем полоску так же, как повёрнута камера, — тогда она всегда смотрит прямо на зрителя.
// Работает потому, что сам враг не вращается: поворот группы относительно врага равен её повороту в мире.
export const turnToCamera = (hpBar: HpBar, camera: THREE.Camera): void => {
  hpBar.group.quaternion.copy(camera.quaternion);
};
