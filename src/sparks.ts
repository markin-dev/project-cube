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
// Кроме самих искр модуль помнит точки, откуда они разлетелись, — вспышки попаданий. Их подсвечивает
// свет от снарядов (см. getBursts и src/lighting.ts): вспышка яркая сразу после удара и гаснет.
//
// Искры живут в игровом времени (delta из game.update): на паузе замирают, при ускорении игры
// летят быстрее — как и всё остальное в сцене. Движение считается на каждом шаге симуляции (update),
// а матрицы экземпляров пишутся раз в кадр перед отрисовкой (sync): на ускорении шагов за кадр
// до восьми, и пересчитывать матрицы на каждом из них незачем.
import * as THREE from 'three';
import { config } from './config';
import type { Enemy } from './enemies';
import type { GlowSource } from './lighting';

// Сколько искр может жить одновременно — размер пула. Хватает с запасом: при настройках по умолчанию
// (6 искр × 0.45 с жизни × 10 попаданий/с) одновременно живёт ~27, и до предела дело не доходит.
const MAX_ALIVE_SPARKS = 1000;

// Сколько вспышек попаданий помним для света. Пулу света (MAX_GLOW_LIGHTS в lighting.ts) нужны
// только самые свежие, поэтому предел маленький, а лишние вспышки просто вытесняются новыми.
const MAX_BURSTS = 32;

// Единичная геометрия и общий материал. Размер искры задаётся масштабом (как у врагов), поэтому
// ползунок SPARKS_SIZE действует без пересоздания геометрии, а цвет меняется на ходу.
const SPARK_GEOMETRY = new THREE.BoxGeometry(1, 1, 1);

// MeshBasicMaterial не зависит от света — искра светится сама по себе, как вспышка.
// Итоговый цвет искры = цвет материала × её instanceColor (setColorAt), поэтому обычные и критические
// искры разного цвета живут в одном InstancedMesh и одном пуле. Цвет материала — не белый, а серый
// по яркости SPARKS_GLOW: так свечение искр (раздел «Свечение») задаётся одной множителем для всех,
// и он меняется на ходу, без переписывания цветов живых искр (см. refreshColor).
const SPARK_MATERIAL = new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(config.SPARKS_GLOW) });

// Черновые объекты для матрицы искры (положение + поворот + масштаб) — одни на весь модуль,
// чтобы не создавать новые на каждую искру в каждом кадре.
const MATRIX = new THREE.Matrix4();
const SCALE = new THREE.Vector3();
const EULER = new THREE.Euler();

// Матрица с масштабом 0 вырождается в точку и не рисуется — так прячем погасшие искры.
const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

// Одна искра: где она, куда летит, сколько уже прожила и как повёрнута.
type Spark = {
  isAlive: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;

  // Возраст в секундах и время жизни. Время жизни запоминается при рождении — как и у цифр урона,
  // правка SPARKS_LIFETIME в панели касается только новых искр.
  age: number;
  lifetime: number;

  // Критическая ли эта искра: от неё зависят цвет и размер (SPARKS_CRIT_SIZE_MULTIPLIER).
  isCrit: boolean;

  // Случайный поворот, заданный один раз при рождении: без него все кубики выглядели бы
  // выровненными по осям мира, как копии одной и той же искры.
  orientation: THREE.Quaternion;
};

// Вспышка попадания — точка, откуда разлетелись искры. Искры гаснут и прячутся, а свету нужна
// сама точка удара, поэтому она помнится отдельно: яркая сразу после попадания и гаснет к концу
// жизни (столько же, сколько жили бы искры — lifetime на момент попадания).
type Burst = {
  position: THREE.Vector3;
  age: number;
  lifetime: number;

  // Критическое ли было попадание: от этого зависит цвет света (как и у самих искр).
  isCrit: boolean;
};

// Куда рождаются искры — параметр sparks.spawn.
export type SpawnParams = {
  // Центр пули в момент столкновения — точка, из которой летят искры.
  projectilePosition: THREE.Vector3Like;

  // Враг, в который она врезалась: нужен, чтобы поднять искры на поверхность его куба (внутри
  // врага их не видно — пуля останавливается, врезавшись в грань). Если врага уже нет в списке —
  // пуля догнала призрака, тогда точка берётся сама по себе, она и так на поверхности.
  enemy?: Enemy;

  // Критическое ли это попадание: другой цвет искр (SPARKS_CRIT_COLOR) и множители SPARKS_CRIT_*.
  isCrit?: boolean;
};

export type Sparks = {
  spawn: (params: SpawnParams) => void;

  // Движение и старение искр — на каждом шаге симуляции.
  update: (delta: number) => void;

  // Перенос искр в матрицы InstancedMesh — раз в кадр, перед отрисовкой.
  sync: () => void;

  // Свежие вспышки попаданий для света от снарядов (см. setGlowLights в lighting.ts): самые яркие
  // первыми, не больше count, погасшие не отдаются. Цвет вспышки — как у её искр.
  getBursts: (count: number) => GlowSource[];

  clear: () => void;
  refreshColor: () => void;
};

// Сторона искры сейчас: 0 — полный размер, 1 — сжата до нуля на SPARKS_SHRINK долю жизни.
// Ноль у shrink тоже возможен — тогда искра живёт в полный размер и исчезает разом.
// Крит-искры крупнее в SPARKS_CRIT_SIZE_MULTIPLIER раз. Множители читаются в момент вызова,
// поэтому правка в панели действует и на уже летящие искры.
const getSparkScale = (spark: Spark): number => {
  const lifeProgress = spark.age / spark.lifetime;
  const sparkSize = config.SPARKS_SIZE * (spark.isCrit ? config.SPARKS_CRIT_SIZE_MULTIPLIER : 1);

  return sparkSize * (1 - config.SPARKS_SHRINK * lifeProgress);
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

// Цвет искр одного попадания по текущему конфигу: обычные — SPARKS_COLOR, критические —
// SPARKS_CRIT_COLOR, увеличенный на SPARKS_CRIT_GLOW_MULTIPLIER. Множитель больше 1 — не ошибка:
// цвет искры живёт в float-буфере instanceColor и свыше 1 не обрезается, поэтому крит-искры
// заметно горят на фоне обычных (а при bloom получают ореол). Тот же множитель ярче делает свет
// вспышки крит-попадания (см. getBursts) — он берёт цвет отсюда.
// Читается в момент рождения и перекраски (refreshColor), поэтому смена цвета
// в панели действует сразу. THREE.Color из хекс-строки хранит цвет в рабочем (линейном) пространстве —
// ровно то, чего ждёт setColorAt у InstancedMesh.
const getSparkColor = (isCrit: boolean): THREE.Color => {
  const color = new THREE.Color(isCrit ? config.SPARKS_CRIT_COLOR : config.SPARKS_COLOR);

  return isCrit ? color.multiplyScalar(config.SPARKS_CRIT_GLOW_MULTIPLIER) : color;
};

export const createSparks = ({ scene }: { scene: THREE.Scene }): Sparks => {
  // Пул искр: массив фиксированной длины, слоты используются по кругу.
  const sparks: Spark[] = Array.from({ length: MAX_ALIVE_SPARKS }, () => ({
    isAlive: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    age: 0,
    lifetime: 0,
    isCrit: false,
    orientation: new THREE.Quaternion(),
  }));

  const mesh = new THREE.InstancedMesh(SPARK_GEOMETRY, SPARK_MATERIAL, MAX_ALIVE_SPARKS);

  // Искры разбросаны по всей сцене, а граница отсечения InstancedMesh считается по геометрии
  // одного кубика у начала координат — так искры за краем этой границы пропадали бы досрочно.
  mesh.frustumCulled = false;

  // Матрицы обновляются каждый кадр — сообщаем это драйверу видеокарты.
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  // Состояние пула: сколько слотов уже записано с начала игры (обновляются только они, а не весь пул),
  // очередной слот для новой искры и изменились ли искры с прошлого sync (на паузе матрицы не трогаем).
  const pool = { usedSlots: 0, cursor: 0, isDirty: false };

  // Записанные слоты пула — индекс в массиве совпадает с номером слота.
  const getUsedSparks = (): Spark[] => sparks.slice(0, pool.usedSlots);

  // Вспышки попаданий (см. тип Burst) — их подсвечивает свет от снарядов. Живут своим списком,
  // отдельно от пула искр: вспышка нужна даже при выключенных искрах и после того, как искры погасли.
  const bursts: Burst[] = [];

  const hide = (index: number): void => {
    mesh.setMatrixAt(index, HIDDEN_MATRIX);
  };

  // Пул пустой — прятать нечего, но матрицы нужно один раз обнулить иначе InstancedMesh
  // остался бы со своими начальными значениями (что в них — не гарантировано).
  sparks.forEach((_, index): void => hide(index));
  mesh.instanceMatrix.needsUpdate = true;

  const spawn = ({ projectilePosition, enemy, isCrit = false }: SpawnParams): void => {
    // Точка, откуда разлетятся искры: поверхность куба врага, куда пришла пуля.
    const burstPosition = getBurstPosition(projectilePosition, enemy);
    const lifetime = config.SPARKS_LIFETIME;

    // Вспышка попадания запоминается до проверки числа искр — свет от неё крутит свой
    // переключатель (GLOW_LIGHTS_ENABLED), а не SPARKS_COUNT: выключенные искры не мешают
    // вспышке осветить место удара.
    if (bursts.length >= MAX_BURSTS) {
      // Мест нет — вытесняем самую старую вспышку: свету всё равно нужны свежие.
      bursts.shift();
    }

    bursts.push({ position: burstPosition, age: 0, lifetime, isCrit });

    // Критическое попадание бьёт сильнее и ярче: больше искр (COUNT_MULTIPLIER) и каждая быстрее
    // (SPEED_MULTIPLIER). Множители читаются тут, при рождении — как и SPARKS_COUNT/SPARKS_SPEED,
    // правка панели действует на новые попадания.
    const count = Math.round(config.SPARKS_COUNT * (isCrit ? config.SPARKS_CRIT_COUNT_MULTIPLIER : 1));

    // 0 в панели — выключить искры совсем (вспышка при этом уже запомнена, см. выше).
    if (count <= 0) {
      return;
    }

    // Цвет всех искр одного попадания: обычные — SPARKS_COLOR, критические — SPARKS_CRIT_COLOR.
    const baseColor = getSparkColor(isCrit);

    const speedSpread = config.SPARKS_SPEED_SPREAD;
    const baseSpeed = config.SPARKS_SPEED * (isCrit ? config.SPARKS_CRIT_SPEED_MULTIPLIER : 1);

    Array.from({ length: count }).forEach((): void => {
      const index = pool.cursor;
      const spark = sparks[index];

      // Круговой указатель: заполнив последний слот, начинаем заново с первого — самая старая
      // искра в этом слоте перезаписывается, её жизнь обрывается раньше срока.
      pool.cursor = (pool.cursor + 1) % MAX_ALIVE_SPARKS;
      pool.usedSlots = Math.max(pool.usedSlots, index + 1);

      // Скорость: базовая скорость минус случайная доля до SPARKS_SPEED_SPREAD — при 0 все летят
      // одинаково, при 1 — от нуля до полной, и сгусток искр растягивается во время полёта.
      const speed = baseSpeed * (1 - speedSpread * Math.random());

      spark.isAlive = true;
      spark.position.copy(burstPosition);
      spark.velocity.copy(getBurstDirection()).multiplyScalar(speed);
      spark.age = 0;
      spark.lifetime = lifetime;
      spark.isCrit = isCrit;

      spark.orientation.setFromEuler(
        EULER.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2),
      );

      // Цвет этой искры: базовый цвет попадания уже в baseColor, копируем в её instanceColor.
      mesh.setColorAt(index, baseColor);
    });

    // instanceColor — буфер, заполненный setColorAt, сообщаем драйверу видеокарты, что он изменился.
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }

    pool.isDirty = true;
  };

  const update = (delta: number): void => {
    // Вспышки стареют своим ходом, до проверки пула искр: при выключенных искрах (SPARKS_COUNT 0)
    // пул пуст и сюда бы не доехали, а вспышке света всё равно нужно угасать. Отмирающие не выкидываем —
    // они отфильтруются в getBursts, а новые вспышки вытесняют их при нехватке места (см. spawn).
    bursts.forEach((burst): void => {
      burst.age += delta;
    });

    if (pool.usedSlots === 0) {
      return;
    }

    // Конфиг на этот шаг читаем один раз — внутри цикла он не меняется.
    const gravity = config.GRAVITY * config.SPARKS_GRAVITY_SCALE;
    const damping = 1 / (1 + config.SPARKS_DAMPING * delta);

    getUsedSparks().forEach((spark, index): void => {
      if (!spark.isAlive) {
        return;
      }

      spark.age += delta;

      // Время вышло — гасим и освобождаем слот для будущих искр.
      if (spark.age >= spark.lifetime) {
        spark.isAlive = false;
        hide(index);

        return;
      }

      spark.velocity.y -= gravity * delta;

      // Затухание скорости: множитель 1 / (1 + damping × delta) всегда в интервале (0; 1] —
      // скорость гаснет и не зависит от длины шага, а в отличие от «v -= v × damping × delta»
      // не может стать отрицательной, даже если delta неожиданно большой.
      spark.velocity.multiplyScalar(damping);
      spark.position.addScaledVector(spark.velocity, delta);

      // Искра не проваливается под пол: центр держим на половине её текущего размера
      // и гасим вертикальную скорость — отскоков от пола не делаем, искры не мячи.
      const half = getSparkScale(spark) / 2;

      if (spark.position.y < half) {
        spark.position.y = half;
        spark.velocity.y = 0;
      }
    });

    pool.isDirty = true;
  };

  const sync = (): void => {
    if (!pool.isDirty) {
      return;
    }

    getUsedSparks().forEach((spark, index): void => {
      if (spark.isAlive) {
        SCALE.setScalar(getSparkScale(spark));
        mesh.setMatrixAt(index, MATRIX.compose(spark.position, spark.orientation, SCALE));
      }
    });

    mesh.instanceMatrix.needsUpdate = true;
    pool.isDirty = false;
  };

  // Источники света из вспышек: живые (не угасшие) отдаются самыми яркими первыми, не больше count.
  // Яркость падает от 1 к 0 за время жизни вспышки — свет делает вспышку в момент удара и гаснет
  // вместе с ней, а не горит до конца кадра. Цвет — как у искр этого попадания (getSparkColor).
  const getBursts = (count: number): GlowSource[] =>
    bursts
      .map((burst): GlowSource => ({
        position: burst.position,
        color: getSparkColor(burst.isCrit),
        brightness: 1 - burst.age / burst.lifetime,
      }))
      .filter(({ brightness }): boolean => brightness > 0)
      .sort((first, second): number => second.brightness - first.brightness)
      .slice(0, count);

  const clear = (): void => {
    getUsedSparks().forEach((spark, index): void => {
      spark.isAlive = false;
      hide(index);
    });

    // Вспышки тоже кончаются — рестарт игры не должен подсвечивать старые места удара.
    bursts.length = 0;

    pool.usedSlots = 0;
    pool.cursor = 0;
    pool.isDirty = false;
    mesh.instanceMatrix.needsUpdate = true;
  };

  // Перекрашивает живые искры и обновляет их свечение по текущему конфигу — вызывается, когда
  // цвета меняют в панели настроек. Цвет живёт в instanceColor каждой искры, поэтому переписываем
  // его по живым слотам; яркость свечения (SPARKS_GLOW) — общий множитель в цвете материала.
  const refreshColor = (): void => {
    SPARK_MATERIAL.color.setScalar(config.SPARKS_GLOW);

    const aliveSlots = getUsedSparks()
      .map((spark, index) => ({ spark, index }))
      .filter(({ spark }) => spark.isAlive);

    aliveSlots.forEach(({ spark, index }): void => {
      mesh.setColorAt(index, getSparkColor(spark.isCrit));
    });

    if (aliveSlots.length > 0 && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  };

  return { spawn, update, sync, getBursts, clear, refreshColor };
};
