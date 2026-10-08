// Искры при попадании снарядов: мелкие светящиеся кубики, разлетающиеся во все стороны из точки
// удара и через SPARKS_LIFETIME секунд сжимающиеся и исчезающие. Все параметры — раздел «Искры»
// в src/config.ts, они читаются в момент рождения и обновления искры, поэтому применяются сразу.
//
// Все искры рисуются одним THREE.InstancedMesh: тысячи экземпляров одной геометрии за один вызов
// отрисовки — иначе каждая искра была бы отдельным мешем и сотни их дёргали бы кадр.
// Искры живут в пуле с круговым указателем: новая пишется в очередной слот, а когда слоты
// кончаются — перезаписывает самую старую искру. Жёсткий предел нужен, чтобы при любом конфиге
// (много искр при частых выстрелах) память и время обновления оставались ограничены.
//
// Искры живут в игровом времени (delta из updateGame): на паузе замирают, при ускорении игры
// летят быстрее — как и всё остальное в сцене.
import * as THREE from 'three';
import { config } from './config';
import type { Enemy } from './enemies';

// Сколько искр может жить одновременно — размер пула. Хватает с запасом: при настройках по умолчанию
// (6 искр × 0.45 с жизни × 10 попаданий/с) одновременно живёт ~27, и до предела дело не доходит.
const MAX_ALIVE_SPARKS = 1000;

// Единичная геометрия и общий материал. Размер искры задаётся масштабом (как у врагов), поэтому
// ползунок SPARKS_SIZE действует без пересоздания геометрии, а цвет меняется на ходу.
const SPARK_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);

// MeshBasicMaterial не зависит от света — искра светится сама по себе, как вспышка.
const SPARK_MATERIAL = new THREE.MeshBasicMaterial({ color: config.SPARKS_COLOR });

// Черновой объект для пересчёта матрицы искры: setMatrixAt принимает матрицу, а положение,
// поворот и масштаб по отдельности лежат в Object3D. Один на весь модуль — как и сам InstancedMesh.
const transform = new THREE.Object3D();

// Одна искра: где она, куда летит, сколько уже прожила и как повёрнута.
type Spark = {
  alive: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;

  // Возраст в секундах и время жизни. Время жизни запоминается при рождении — как и у цифр урона,
  // правка SPARKS_LIFETIME в панели касается только новых искр.
  age: number;
  lifetime: number;

  // Случайный поворот, заданный один раз при рождении: без него все кубики выглядели бы
  // выровненными по осям мира, как копии одной и той же искры.
  orientation: THREE.Euler;
};

// Куда рождаются искры — параметр sparks.spawn.
export type SpawnParams = {
  // Центр пули в момент столкновения — точка, из которой летят искры.
  projectilePosition: THREE.Vector3Like;

  // Враг, в который она врезалась: нужен, чтобы поднять искры на поверхность его куба (внутри
  // врага их не видно — пуля останавливается, врезавшись в грань). Если врага уже нет в списке —
  // пуля догнала призрака, тогда точка берётся сама по себе, она и так на поверхности.
  enemy?: Enemy;
};

export type Sparks = {
  spawn: (params: SpawnParams) => void;
  update: (delta: number) => void;
  clear: () => void;
  refreshColor: () => void;
};

// Точка, от которой летят искры: поверхность куба врага, куда пришла пуля.
// Пуля с её размером в момент столкновения может остаться и чуть внутри куба, и чуть снаружи,
// поэтому направление «центр врага → пуля» просто приводится к грани: луч выходит из куба там,
// где максимум из |x|, |y|, |z| смещения равен половине размера (грани куба — это плоскости
// x = ±half, y = ±half, z = ±half; какая доминирует по модулю, та и «первая на пути»).
// Если врага нет или пуля ровно в центре (практически невозможно) — сама точка пули.
const getBurstPosition = (projectilePosition: THREE.Vector3Like, enemy?: Enemy): THREE.Vector3 => {
  const fromProjectile = (): THREE.Vector3 =>
    new THREE.Vector3(projectilePosition.x, projectilePosition.y, projectilePosition.z);

  if (!enemy) {
    return fromProjectile();
  }

  const center = enemy.body.translation();
  const offsetX = projectilePosition.x - center.x;
  const offsetY = projectilePosition.y - center.y;
  const offsetZ = projectilePosition.z - center.z;
  const maxOffset = Math.max(Math.abs(offsetX), Math.abs(offsetY), Math.abs(offsetZ));

  if (maxOffset === 0) {
    return fromProjectile();
  }

  // Доля пути от центра до грани. Меньше 1 — пуля влезла в куб, больше 1 — вылезла: в обоих
  // случаях точка получается ровно на поверхности.
  const toSurface = enemy.kind.size / 2 / maxOffset;

  return new THREE.Vector3(
    center.x + offsetX * toSurface,
    center.y + offsetY * toSurface,
    center.z + offsetZ * toSurface,
  );
};

// Случайное единичное направление, равномерное по сфере. z (вертикаль) берём равномерно от -1 до 1,
// а угол вокруг — равномерно; расстояние до окружности — корень из (1 - z²). Без корня точки
// скучивались бы у полюсов (как точки в круге без корня в прицеле — см. getAimPoint).
const getBurstDirection = (): THREE.Vector3 => {
  const vertical = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const ringRadius = Math.sqrt(1 - vertical * vertical);

  return new THREE.Vector3(ringRadius * Math.cos(angle), vertical, ringRadius * Math.sin(angle));
};

export const createSparks = ({ scene }: { scene: THREE.Scene }): Sparks => {
  // Пул искр: массив фиксированной длины, слоты используются по кругу.
  const sparks: Spark[] = Array.from({ length: MAX_ALIVE_SPARKS }, () => ({
    alive: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    age: 0,
    lifetime: 0,
    orientation: new THREE.Euler(),
  }));

  const mesh = new THREE.InstancedMesh(SPARK_GEOMETRY, SPARK_MATERIAL, MAX_ALIVE_SPARKS);

  // Искры разбросаны по всей сцене, а граница отсечения InstancedMesh считается по геометрии
  // одного кубика у начала координат — так искры за краем этой границы пропадали бы досрочно.
  mesh.frustumCulled = false;

  // Матрицы обновляются каждый кадр — сообщаем это драйверу видеокарты.
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  // Сколько слотов уже записано с начала игры: обновляются только они, а не весь пул.
  let usedSlots = 0;

  // Очередной слот для новой искры.
  let cursor = 0;

  // Прячет искру: матрица с масштабом 0 вырождается в точку и не рисуется.
  const hide = (index: number): void => {
    transform.position.set(0, 0, 0);
    transform.rotation.set(0, 0, 0);
    transform.scale.setScalar(0);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  };

  // Пул пустой — прятать нечего, но матрицы нужно один раз обнулить иначе InstancedMesh
  // остался бы со своими начальными значениями (что в них — не гарантировано).
  for (let index = 0; index < MAX_ALIVE_SPARKS; index++) {
    hide(index);
  }

  mesh.instanceMatrix.needsUpdate = true;

  const spawn = ({ projectilePosition, enemy }: SpawnParams): void => {
    const count = config.SPARKS_COUNT;

    // 0 в панели — выключить искры совсем.
    if (count <= 0) {
      return;
    }

    // Все искры одного попадания рождаются в одной точке.
    const burstPosition = getBurstPosition(projectilePosition, enemy);
    const speedSpread = config.SPARKS_SPEED_SPREAD;
    const lifetime = config.SPARKS_LIFETIME;

    for (let n = 0; n < count; n++) {
      const index = cursor;

      // Круговой указатель: заполнив последний слот, начинаем заново с первого — самая старая
      // искра в этом слоте перезаписывается, её жизнь обрывается раньше срока.
      cursor = (cursor + 1) % MAX_ALIVE_SPARKS;
      usedSlots = Math.max(usedSlots, index + 1);

      const spark = sparks[index];

      // Скорость: SPARKS_SPEED минус случайная доля до SPARKS_SPEED_SPREAD — при 0 все летят
      // одинаково, при 1 — от нуля до полной, и сгусток искр растягивается во время полёта.
      const speed = config.SPARKS_SPEED * (1 - speedSpread * Math.random());

      spark.alive = true;
      spark.position.copy(burstPosition);
      spark.velocity.copy(getBurstDirection()).multiplyScalar(speed);
      spark.age = 0;
      spark.lifetime = lifetime;
      spark.orientation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
    }
  };

  const update = (delta: number): void => {
    if (usedSlots === 0) {
      return;
    }

    // Конфиг на этот кадр читаем один раз — внутри цикла он не меняется.
    const gravity = config.GRAVITY * config.SPARKS_GRAVITY_SCALE;
    const damping = 1 / (1 + config.SPARKS_DAMPING * delta);
    const size = config.SPARKS_SIZE;
    const shrink = config.SPARKS_SHRINK;

    for (let index = 0; index < usedSlots; index++) {
      const spark = sparks[index];

      if (!spark.alive) {
        continue;
      }

      spark.age += delta;

      // Время вышло — гасим и освобождаем слот для будущих искр.
      if (spark.age >= spark.lifetime) {
        spark.alive = false;
        hide(index);

        continue;
      }

      spark.velocity.y -= gravity * delta;

      // Затухание скорости: множитель 1 / (1 + damping × delta) всегда в интервале (0; 1] —
      // скорость гаснет и не зависит от длины шага, а в отличие от «v -= v × damping × delta»
      // не может стать отрицательной, даже если delta неожиданно большой.
      spark.velocity.multiplyScalar(damping);
      spark.position.addScaledVector(spark.velocity, delta);

      // Размер в момент жизни: 0 — полный, 1 — сжат до нуля на SPARKS_SHRINK долю жизни.
      // Ноль у shrink тоже возможен — тогда искра живёт в полный размер и исчезает разом.
      const lifeProgress = spark.age / spark.lifetime;
      const scale = size * (1 - shrink * lifeProgress);

      // Искра не проваливается под пол: центр держим на половине её текущего размера
      // и гасим вертикальную скорость — отскоков от пола не делаем, искры не мячи.
      const half = scale / 2;

      if (spark.position.y < half) {
        spark.position.y = half;
        spark.velocity.y = 0;
      }

      transform.position.copy(spark.position);
      transform.rotation.copy(spark.orientation);
      transform.scale.setScalar(scale);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  };

  const clear = (): void => {
    for (let index = 0; index < usedSlots; index++) {
      sparks[index].alive = false;
      hide(index);
    }

    usedSlots = 0;
    cursor = 0;
    mesh.instanceMatrix.needsUpdate = true;
  };

  // Перекрашивает искры по текущему конфигу — вызывается, когда цвет меняют в панели настроек.
  const refreshColor = (): void => {
    SPARK_MATERIAL.color.set(config.SPARKS_COLOR);
  };

  return { spawn, update, clear, refreshColor };
};
