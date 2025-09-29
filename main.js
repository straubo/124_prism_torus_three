import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

(function () {
  // Scene and camera
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 1.5, 4);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);

  // Orbit controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = true;
  controls.target.set(0, 1, 0);

  // Environment map (for reflections)
  const envLoader = new THREE.CubeTextureLoader().setPath(
    'https://threejs.org/examples/textures/cube/Bridge2/'
  );
  const envMap = envLoader.load([
    'posx.jpg',
    'negx.jpg',
    'posy.jpg',
    'negy.jpg',
    'posz.jpg',
    'negz.jpg',
  ]);
  if (envMap && 'colorSpace' in envMap) envMap.colorSpace = THREE.SRGBColorSpace;
  scene.environment = envMap;
  scene.background = new THREE.Color(0x2b3a55); // muted blue

  // Lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.2);
  scene.add(hemi);

  // Ground plane (receives shadows and caustic projection)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 50),
    new THREE.MeshStandardMaterial({ color: 0x0e1624, roughness: 0.95, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.1;
  ground.receiveShadow = true;
  scene.add(ground);

  // Glass torus (caster)
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(1.0, 0.35, 64, 128),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.02,
      metalness: 0.0,
      transmission: 1.0,
      thickness: 1.0,
      ior: 1.5,
      clearcoat: 1.0,
      clearcoatRoughness: 0.02,
      envMap: envMap
    })
  );
  torus.position.set(0, 1, 0);
  torus.castShadow = true;
  scene.add(torus);

  // Caustics-style spotlight (cookie projection)
  function createCausticsCanvas(size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  }

  function drawCaustics(ctx, t) {
    const { width: w, height: h } = ctx.canvas;
    ctx.clearRect(0, 0, w, h);
    // Dark base
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    // Wavy interference lines
    const layers = 6;
    for (let l = 0; l < layers; l++) {
      const amp = 6 + l * 3;
      const freq = 0.006 + l * 0.0015;
      const speed = 0.6 + l * 0.2;
      const phase = t * speed + l * 0.8;
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = -20; x <= w + 20; x += 4) {
        const y = h * 0.5 + Math.sin(x * freq + phase) * amp + Math.cos(x * freq * 0.7 + phase * 1.3) * (amp * 0.35);
        if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Soft bloom spots
    ctx.globalAlpha = 0.06;
    for (let i = 0; i < 10; i++) {
      const r = 20 + Math.sin(t * 0.9 + i) * 10;
      const x = (Math.sin(t * 0.7 + i * 1.3) * 0.5 + 0.5) * w;
      const y = (Math.cos(t * 0.5 + i * 0.9) * 0.5 + 0.5) * h;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.8)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  const caustics = createCausticsCanvas(512);
  drawCaustics(caustics.ctx, 0);
  const causticsTexture = new THREE.CanvasTexture(caustics.canvas);
  causticsTexture.colorSpace = THREE.SRGBColorSpace;
  causticsTexture.wrapS = causticsTexture.wrapT = THREE.ClampToEdgeWrapping;
  causticsTexture.needsUpdate = true;

  const spot = new THREE.SpotLight(0xffffff, 3.0, 40, Math.PI / 6, 0.35, 1.2);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.00015;
  spot.position.set(5, 6, 4);
  spot.target.position.set(0, -0.5, 0);
  spot.map = causticsTexture; // project cookie
  scene.add(spot);
  scene.add(spot.target);

  // Resize handling
  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onWindowResize);

  // Animate
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);

    const t = clock.getElapsedTime();

    // Rotate torus around Y
    torus.rotation.y += 0.01;

    // Subtle light wobble around its base position
    spot.position.x = 5 + Math.cos(t * 0.5) * 1.5;
    spot.position.z = 4 + Math.sin(t * 0.5) * 1.5;
    spot.target.position.x = Math.sin(t * 0.4) * 0.5;
    spot.target.position.z = Math.cos(t * 0.3) * 0.5;
    spot.target.updateMatrixWorld();

    // Animate cookie texture
    drawCaustics(caustics.ctx, t * 1.2);
    causticsTexture.needsUpdate = true;

    // Update controls damping
    controls.update();

    renderer.render(scene, camera);
  }

  animate();
})();
