// Пост-обработка кадра: ореол (bloom) вокруг ярких мест. Картинка рисуется не сразу на экран,
// а во внутреннюю текстуру, по ней считается ореол, и всё вместе выводится на экран.
//
// Зачем это нужно: светящиеся предметы (пули и искры, см. PROJECTILE_GLOW и SPARKS_GLOW в config.ts)
// становятся ярче белого, а bloom размывает эти места и подмешивает их поверх кадра — так свет
// «разливается» вокруг предмета, а не просто заливает его белым.
//
// Считается по всему кадру, целиком: что именно светится, решает BLOOM_THRESHOLD — на нём
// нарезается яркая часть картинки. Выключается переключателем BLOOM_ENABLED (тогда кадр рисуется
// напрямую, мимо всей этой цепочки).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { config } from './config';

export type Post = {
  // Один кадр: сцена с ореолом или, если BLOOM_ENABLED выключен, просто сцена.
  render: () => void;

  // Пересобрать цепочку под новый размер окна — её текстуры имеют размер экрана.
  setSize: () => void;
};

export const createPost = ({
  renderer,
  scene,
  camera,
}: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
}): Post => {
  // Сцепка проходов (EffectComposer): каждый берёт картинку предыдущего и кладёт свою.
  //   RenderPass   — сама сцена во внутреннюю текстуру (не на экран);
  //   UnrealBloom  — ореол вокруг ярких мест: несколько проходов размытия и сложение;
  //   OutputPass   — последний проход выводит на экран: переводит цвета в цветовую схему экрана
  //                  и применяет тонмаппинг (см. TONE_MAPPING в config.ts).
  // Без OutputPass картинка осталась бы «сырой»: остальные проходы пишут линейные цвета.
  const composer = new EffectComposer(renderer);

  composer.addPass(new RenderPass(scene, camera));

  // Начальные параметры ореола — временные: перед каждым кадром их перепишет render по конфигу.
  // Размер — размер окна: он нужен, чтобы считать размытие в тех же пропорциях, что и кадр.
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1, 0.5, 0);

  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const render = (): void => {
    if (!config.BLOOM_ENABLED) {
      renderer.render(scene, camera);

      return;
    }

    // Параметры ореола читаются каждый кадр — правки в панели действуют без пересборки цепочки.
    bloom.strength = config.BLOOM_STRENGTH;
    bloom.radius = config.BLOOM_RADIUS;
    bloom.threshold = config.BLOOM_THRESHOLD;

    composer.render();
  };

  const setSize = (): void => {
    // Внутренние текстуры и все проходы пересчитываются под новые размеры; множитель на плотность
    // пикселей (pixel ratio) composer берёт у рендерера сам.
    composer.setSize(window.innerWidth, window.innerHeight);
  };

  return { render, setSize };
};
