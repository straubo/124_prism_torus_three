(function () {
  // Scene and camera
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.z = 3;

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

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
  if (envMap && 'colorSpace' in envMap) {
    envMap.colorSpace = THREE.SRGBColorSpace;
  }
  scene.environment = envMap;
  scene.background = new THREE.Color(0x2b3a55); // calming, muted blue

  // Basic lighting (helps with highlights on glass)
  const light = new THREE.DirectionalLight(0xffffff, 1.0);
  light.position.set(5, 5, 5);
  scene.add(light);
  const fill = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(fill);

  // Glass torus
  const geometry = new THREE.TorusGeometry(0.6, 0.25, 64, 128);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.05,
    metalness: 0.0,
    transmission: 1.0, // enable real transparency (glass)
    thickness: 1.0,
    ior: 1.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
  });
  const torus = new THREE.Mesh(geometry, material);
  scene.add(torus);

  // Resize handling
  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onWindowResize);

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    torus.rotation.y += 0.015;
    renderer.render(scene, camera);
  }
  animate();
})();
