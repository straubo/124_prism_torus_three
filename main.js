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

  // ------------------------------
  // Ray reflection utilities/system
  // ------------------------------
  function isRayMesh(object) {
    return object && object.isMesh && (object.onRayOver || object.onRayOut || object.onRayMove);
  }

  function createEvent(api, hit, intersect, intersects) {
    return {
      api,
      object: intersect.object,
      position: intersect.point,
      direction: intersect.direction,
      reflect: intersect.reflect,
      normal: intersect.face && intersect.face.normal,
      intersect,
      intersects,
      stopPropagation: () => (hit.stopped = true)
    };
  }

  class ReflectSystem {
    constructor({ bounce = 10, far = 100 } = {}) {
      this.maxBounces = (bounce || 1) + 1;
      this.far = far;
      this.objects = [];
      this.hits = new Map();
      this.start = new THREE.Vector3();
      this.end = new THREE.Vector3();
      this.raycaster = new THREE.Raycaster();
      this.positions = new Float32Array(Array.from({ length: (this.maxBounces + 10) * 3 }, () => 0));
      this._vStart = new THREE.Vector3();
      this._vEnd = new THREE.Vector3();
      this._vDir = new THREE.Vector3();
      this._vPos = new THREE.Vector3();
      this._intersects = [];
    }

    collect(root) {
      this.objects = [];
      root.traverse((obj) => {
        if (isRayMesh(obj)) this.objects.push(obj);
      });
      root.updateWorldMatrix(true, true);
    }

    setRay(_start = [0, 0, 0], _end = [0, 0, 0]) {
      this.start.set(..._start);
      this.end.set(..._end);
    }

    update() {
      let number = 0;
      this._intersects = [];

      const vStart = this._vStart.copy(this.start);
      const vEnd = this._vEnd.copy(this.end);
      const vDir = this._vDir.subVectors(vEnd, vStart).normalize();

      vStart.toArray(this.positions, number++ * 3);

      let intersect = null;
      while (true) {
        this.raycaster.set(vStart, vDir);
        intersect = this.raycaster.intersectObjects(this.objects, false)[0];
        if (number < this.maxBounces && intersect && intersect.face) {
          this._intersects.push(intersect);
          intersect.direction = vDir.clone();
          intersect.point.toArray(this.positions, number++ * 3);
          // reflect direction by world-space face normal
          const worldNormal = intersect.object
            .localToWorld(intersect.face.normal.clone())
            .sub(intersect.object.getWorldPosition(this._vPos))
            .normalize();
          vDir.reflect(worldNormal);
          intersect.reflect = vDir.clone();
          vStart.copy(intersect.point);
        } else {
          // extend to far if nothing else was hit
          vEnd.addVectors(vStart, vDir.multiplyScalar(this.far)).toArray(this.positions, number++ * 3);
          break;
        }
      }

      // onRayOut for previous hits no longer present
      this.hits.forEach((hit) => {
        if (!this._intersects.find((i) => i.object.uuid === hit.key)) {
          this.hits.delete(hit.key);
          if (hit.intersect.object.onRayOut) hit.intersect.object.onRayOut(createEvent(this, hit, hit.intersect, this._intersects));
        }
      });

      // onRayOver/onRayMove for current intersects
      for (const intr of this._intersects) {
        if (!this.hits.has(intr.object.uuid)) {
          const hit = { key: intr.object.uuid, intersect: intr, stopped: false };
          this.hits.set(intr.object.uuid, hit);
          if (intr.object.onRayOver) intr.object.onRayOver(createEvent(this, hit, intr, this._intersects));
        }
        const hit = this.hits.get(intr.object.uuid);
        if (intr.object.onRayMove) intr.object.onRayMove(createEvent(this, hit, intr, this._intersects));
        if (hit.stopped) break;
      }

      // number is number of points in positions (>= 2)
      return Math.max(2, number);
    }
  }

  // Root for reflective objects (anything inside can be ray-hit if it has onRay* handlers)
  const reflectRoot = new THREE.Group();
  scene.add(reflectRoot);

  // Prism group to mimic the reference structure
  const prism = new THREE.Group();
  prism.position.z = -1.5; // back it up a bit
  reflectRoot.add(prism);

  // Invisible collider torus (participates in reflection raycasts)
  // Matches reference: scale=2, rotation X=PI/2, low-res geometry
  const colliderGeometry = new THREE.TorusGeometry(1, 0.35, 16, 32);
  const colliderMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.0, depthWrite: false });
  const torusCollider = new THREE.Mesh(colliderGeometry, colliderMaterial);
  torusCollider.visible = false;
  torusCollider.scale.set(2, 2, 2);
  torusCollider.rotation.x = Math.PI / 2;

  // Visible hi-res torus (approx MeshTransmissionMaterial)
  const glassGeometry = new THREE.TorusGeometry(1, 0.35, 64, 128);
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.0,
    metalness: 0.0,
    transmission: 1.0,
    thickness: 0.9,
    ior: 1.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    envMap: envMap,
    toneMapped: false,
    anisotropy: 0.1
  });
  const torus = new THREE.Mesh(glassGeometry, glassMaterial);
  torus.renderOrder = 10;
  torus.scale.set(2, 2, 2);

  // Attach onRay* handlers to collider
  const defaultThickness = glassMaterial.thickness;
  const defaultColor = glassMaterial.color.clone();
  torusCollider.onRayOver = () => {
    glassMaterial.thickness = defaultThickness * 1.2;
    glassMaterial.color.setHex(0xe8f1ff);
  };
  torusCollider.onRayOut = () => {
    glassMaterial.thickness = defaultThickness;
    glassMaterial.color.copy(defaultColor);
  };
  torusCollider.onRayMove = (e) => {
    const t = Math.min(1, (e.api.number - 1) / 10);
    glassMaterial.clearcoatRoughness = 0.02 + 0.08 * t;
  };

  prism.add(torusCollider);
  prism.add(torus);

  // Reflect system
  const reflect = new ReflectSystem({ bounce: 8, far: 200 });
  reflect.collect(reflectRoot);

  // Beam as a single streak and single glow + a source flare
  const texLoader = new THREE.TextureLoader();
  const streakTexture = texLoader.load('public/lensflare2.png', undefined, undefined, (e) => {
    console.warn('Failed to load lensflare2.png from public/.');
  });
  const glowTexture = texLoader.load('public/lensflare0_bw.jpg', undefined, undefined, (e) => {
    console.warn('Failed to load lensflare0_bw.jpg from public/.');
  });
  streakTexture.colorSpace = THREE.SRGBColorSpace;
  glowTexture.colorSpace = THREE.SRGBColorSpace;

  const planeGeom = new THREE.PlaneGeometry(1, 1);

  const commonMatParams = {
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  };

  // Single stretched streak (segment 0 only)
  const streakMaterial = new THREE.MeshBasicMaterial({ map: streakTexture, opacity: 1.25, ...commonMatParams, transparent: false });
  const streaks = new THREE.InstancedMesh(planeGeom, streakMaterial, 1);
  streaks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(streaks);

  // Single glow at first hit position
  const glowMaterial = new THREE.MeshBasicMaterial({ map: glowTexture, ...commonMatParams, opacity: 1 });
  const glows = new THREE.InstancedMesh(planeGeom, glowMaterial, 1);
  glows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(glows);

  // Visible source flare positioned ~100 units back, orbiting clockwise around Y
  const sourceMaterial = new THREE.MeshBasicMaterial({ map: glowTexture, ...commonMatParams, opacity: 1 });
  const sourceFlare = new THREE.Mesh(planeGeom.clone(), sourceMaterial);
  scene.add(sourceFlare);

  const obj = new THREE.Object3D();
  const f = new THREE.Vector3();
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  const stride = 4;
  const width = 8;
  const zOffset = -0.2;

  // Resize handling
  function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener('resize', onWindowResize);

  // Animate: source flare orbits clockwise at z ~ -100; beam aims at camera; show first segment only
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);

    const time = clock.getElapsedTime();

    // Rotate the prism (torus + collider) around Y
    prism.rotation.y += 0.01;

    // Clockwise orbit around Y with constant z ~ -100 (viewport back)
    const orbitRadiusX = 20;
    const orbitRadiusY = 10;
    const angle = -time * 0.6; // negative for clockwise
    const sx = Math.cos(angle) * orbitRadiusX;
    const sy = Math.sin(angle) * orbitRadiusY;
    const sz = -100;

    sourceFlare.position.set(sx, sy, sz);
    sourceFlare.lookAt(camera.position);
    sourceFlare.scale.set(6, 6, 1);

    // Ray from source flare toward camera
    reflect.setRay([sx, sy, sz], [camera.position.x, camera.position.y, camera.position.z]);
    const numPoints = reflect.update();
    const segments = Math.max(0, numPoints - 1);

    // Update streak (first segment only)
    if (segments >= 1) {
      f.fromArray(reflect.positions, 0);
      t.fromArray(reflect.positions, 3);
      n.subVectors(t, f).normalize();
      obj.position.addVectors(f, t).divideScalar(2);
      obj.position.z += zOffset;
      obj.scale.set(t.distanceTo(f) * stride, width, 1);
      obj.rotation.set(0, 0, Math.atan2(n.y, n.x));
      obj.updateMatrix();
      streaks.setMatrixAt(0, obj.matrix);
      streaks.count = 1;
    } else {
      streaks.count = 0;
    }
    streaks.instanceMatrix.needsUpdate = true;

    // Update glow (place at first hit point if available)
    if (segments >= 1) {
      obj.position.fromArray(reflect.positions, 3);
      obj.position.z += zOffset;
      obj.scale.setScalar(0.9);
      obj.rotation.set(0, 0, 0);
      obj.updateMatrix();
      glows.setMatrixAt(0, obj.matrix);
      glows.count = 1;
    } else {
      glows.count = 0;
    }
    glows.instanceMatrix.needsUpdate = true;

    renderer.render(scene, camera);
  }

  animate();
})();
