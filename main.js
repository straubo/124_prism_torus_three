import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

(function () {
  // Scene and camera
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 1, 4);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  renderer.setClearColor(0xFFFFFF, 1);

  // Orbit controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = true;
  controls.target.set(0, 1, 0);

  // Track total word width to frame the word responsively (especially on mobile)
  let wordTotalWidth = null;
  function frameWord() {
    if (wordTotalWidth == null) return;
    const margin = 1.15; // add a little breathing room
    const desiredWidth = wordTotalWidth * margin;
    const aspect = window.innerWidth / window.innerHeight;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const requiredDistance = (desiredWidth / aspect) / (2 * Math.tan(vFov / 2));
    // Only pull back further if needed; don't snap closer than initial
    camera.position.z = Math.max(camera.position.z, requiredDistance + 0.25);
  }

  // Gradient equirectangular skybox + environment
  function createGradientEquirectTexture(width, height, inner, outer) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    grad.addColorStop(0.0, inner);
    grad.addColorStop(0.12, inner);
    grad.addColorStop(0.3, outer);
    // grad.addColorStop(1.0, '#bfcad8');
    grad.addColorStop(1.0, '#040f1c');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.needsUpdate = true;
    return tex;
  }

  const gradientTex = createGradientEquirectTexture(1024, 512, '#ffffff', '#123456');

  // Use PMREM for proper glossy reflections
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envRT = pmrem.fromEquirectangular(gradientTex);
  scene.environment = envRT.texture;
  scene.background = gradientTex; // show the gradient skybox

  // Lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 0.2);
  scene.add(hemi);

  // Ground plane (receives shadows, metallic look)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 50),
    new THREE.MeshStandardMaterial({ color: 0x111315, metalness: 1.0, roughness: 0.25 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.1;
  ground.receiveShadow = true;
  scene.add(ground);

  // Glass torus (caster)
  const torusMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.02,
    metalness: 0.5,
    transmission: 1.0,
    thickness: 1.0,
    ior: 1.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    // 0x88ccff
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.0
  });
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(0.19, 0.07, 64, 128),
    torusMaterial
  );
  torus.position.set(0, 1, 0);
  torus.castShadow = true;
  scene.add(torus);

  // Extruded text "T" and "RUS" using Michroma font (torus acts as the "O")
  let textMaterial = null;
  const fontLoader = new FontLoader();
  fontLoader.load('./public/Michroma_Regular.json', (font) => {
    const textOptions = {
      font,
      size: 0.42,
      height: 0.12,
      curveSegments: 24,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.015,
      bevelOffset: 0,
      bevelSegments: 5
    };

    textMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.9,
      roughness: 0.2,
      envMapIntensity: 1.0,
      emissive: new THREE.Color(0x0a0a0a),
      emissiveIntensity: 0.08
      // emissive: torusMaterial.emissive.clone(),
      // emissiveIntensity: torusMaterial.emissiveIntensity
    });

    // Build geometries for left "T" and right "RUS"
    const geomT = new TextGeometry('T', textOptions);
    geomT.computeBoundingBox();
    let heightT = 0;
    if (geomT.boundingBox) {
      const xExtent = geomT.boundingBox.max.x - geomT.boundingBox.min.x;
      const yExtent = geomT.boundingBox.max.y - geomT.boundingBox.min.y;
      heightT = yExtent;
      geomT.translate(-xExtent * 0.5, -yExtent * 0.5, 0);
    }

    const geomRUS = new TextGeometry('RUS', textOptions);
    geomRUS.computeBoundingBox();
    let heightRUS = 0;
    if (geomRUS.boundingBox) {
      const xExtent = geomRUS.boundingBox.max.x - geomRUS.boundingBox.min.x;
      const yExtent = geomRUS.boundingBox.max.y - geomRUS.boundingBox.min.y;
      heightRUS = yExtent;
      geomRUS.translate(-xExtent * 0.5, -yExtent * 0.5, 0);
    }

    const meshT = new THREE.Mesh(geomT, textMaterial);
    const meshRUS = new THREE.Mesh(geomRUS, textMaterial);
    meshT.castShadow = true;
    meshRUS.castShadow = true;

    // Compute widths for placement around torus (as the "O")
    const widthT = geomT.boundingBox ? (geomT.boundingBox.max.x - geomT.boundingBox.min.x) : 0;
    const widthRUS = geomRUS.boundingBox ? (geomRUS.boundingBox.max.x - geomRUS.boundingBox.min.x) : 0;

    const torusRadius = (torus.geometry && torus.geometry.parameters && typeof torus.geometry.parameters.radius === 'number') ? torus.geometry.parameters.radius : 1.0;
    const torusTube = (torus.geometry && torus.geometry.parameters && typeof torus.geometry.parameters.tube === 'number') ? torus.geometry.parameters.tube : 0.35;
    const oWidth = 2 * (torusRadius + torusTube); // approx visual width of torus "O"
    const gap = 0.12; // spacing between letters and torus

    // Center the entire word (T + O + RUS) at x=0 by shifting torus.x and placing letters around it
    const totalWidth = widthT + oWidth + widthRUS + gap * 2;
    const torusX = -totalWidth * 0.5 + widthT + oWidth * 0.5;
    torus.position.x = torusX;

    const leftEdgeOfO = torusX - oWidth * 0.5;
    const rightEdgeOfO = torusX + oWidth * 0.5;

    // Lift the whole word and camera by approximately the text height to move horizon
    const textHeight = Math.max(heightT, heightRUS);
    torus.position.y += textHeight;
    const centerY = torus.position.y;

    meshT.position.set((leftEdgeOfO - gap) - widthT * 0.5, centerY, 0);
    meshRUS.position.set((rightEdgeOfO + gap) + widthRUS * 0.5, centerY, 0);

    scene.add(meshT);
    scene.add(meshRUS);

    // Save total width and frame the word so it fits current viewport
    wordTotalWidth = totalWidth;
    frameWord();
  });

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
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

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

  // Postprocessing: composer + bloom
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.0, 0.8, 0.85);
  bloomPass.threshold = 0.02;
  bloomPass.strength = 1.2; // overall bloom intensity
  bloomPass.radius = 0.7; // bloom radius
  composer.addPass(renderPass);
  composer.addPass(bloomPass);

  // Antialiasing for postprocessing: MSAA + SMAA on WebGL2, FXAA otherwise
  let fxaaPass = null;
  let smaaPass = null;
  const SMAA_SCALE = 0; // 0..1, lower reduces AA effect strength
  const isWebGL2 = renderer.capabilities.isWebGL2 === true
  console.log('isWebGL2', isWebGL2);
  if (isWebGL2) {
    composer.multisampling = Math.min(8, renderer.capabilities.maxSamples || 4);
    smaaPass = new SMAAPass(
      window.innerWidth * renderer.getPixelRatio() * SMAA_SCALE,
      window.innerHeight * renderer.getPixelRatio() * SMAA_SCALE
    );
    composer.addPass(smaaPass);
  } else {
    fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.material.uniforms.resolution.value.set(1 / window.innerWidth, 1 / window.innerHeight);
    composer.addPass(fxaaPass);
  }

  // Resize handling
  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    if (fxaaPass) {
      fxaaPass.material.uniforms.resolution.value.set(1 / window.innerWidth, 1 / window.innerHeight);
    }
    if (smaaPass) {
      smaaPass.setSize(
        window.innerWidth * renderer.getPixelRatio() * SMAA_SCALE,
        window.innerHeight * renderer.getPixelRatio() * SMAA_SCALE
      );
    }
    // Reframe word on viewport changes (especially for mobile)
    frameWord();
  }
  window.addEventListener('resize', onWindowResize);

  // Animate
  const clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);

    const t = clock.getElapsedTime();

    // Rotate torus around Y, add bounce effect
    // torus.rotation.y += 0.007;
    // torus.position.y = 1 + Math.sin(t * 2) * 0.2;

    // Subtle light wobble around its base position
    spot.position.x = 5 + Math.cos(t * 0.5) * 1.5;
    spot.position.z = 4 + Math.sin(t * 0.5) * 1.5;
    spot.target.position.x = Math.sin(t * 0.4) * 0.5;
    spot.target.position.z = Math.cos(t * 0.3) * 0.5;
    spot.target.updateMatrixWorld();

    // Animate cookie texture
    drawCaustics(caustics.ctx, t * 1.2);
    causticsTexture.needsUpdate = true;

    // Pulse emissive for glow (shared between torus and text)
    const glow = (Math.sin(t * 1.2) * 0.5 + 0.5) * 0.15;
    torusMaterial.emissiveIntensity = glow;
    // if (textMaterial) textMaterial.emissiveIntensity = glow;

    // Update controls damping
    controls.update();

    // Render with composer for bloom
    composer.render();
  }

  animate();
})();
