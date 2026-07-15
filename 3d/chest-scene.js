/*
 * Einbettbare 3D-Truhen-Szene fuer das Truhen-Oeffnen-Fenster (Zaubertisch).
 * Basiert auf dem Truhen-Repo des Users (ellseybcb/truhen): handgebautes
 * Three.js-Modell (chest-model.js) + dessen Effekt-Ideen (Lichtsaeule,
 * Funken-Burst, Muenzen mit Bounce-Physik, Kamera-Punch).
 *
 * Gesteuert wird die Szene von aussen (app.js openChestModal):
 *   var api = WizChest3D.create(containerEl, 'holz');
 *   api.tapWobble()        – Squash&Stretch-Wackler (jeder Tipp)
 *   api.spin()             – volle 720-Grad-Drehung (Tipp-Drehen)
 *   api.setRarity('gold')  – Truhe umfaerben (Upgrade mitten in der Drehung)
 *   api.shake(ms)          – heftiges Wackeln (Spannung vor der Oeffnung)
 *   api.open()             – Deckel + Lichtsaeule + Burst; Promise nach ~1,6s
 *   api.dispose()          – Renderer/Loop aufraeumen (Fenster geschlossen)
 * Kein HUD, keine Sounds, keine Eingabe – das macht alles das Modal.
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Unsere Seltenheiten -> Stufen aus dem Truhen-Repo (Farben je Material).
  var TIERS = {
    holz: {
      color: 0xffc94d,
      mats: { Wood: { color: 0x54290b }, Wood2: { color: 0x653610 },
        Gold: { color: 0xe6b13c }, Gold_Dark: { color: 0xb07f2a },
        Metal: { color: 0xd8b25e }, DarkMetal: { color: 0xb98a3a } }
    },
    silber: {
      color: 0x54b6ff,
      mats: { Wood: { color: 0x27305a, emissive: 0x3a66ff, intensity: 0.3 },
        Wood2: { color: 0x32406e, emissive: 0x3a66ff, intensity: 0.22 },
        Gold: { color: 0xe6b13c }, Gold_Dark: { color: 0xb07f2a },
        Metal: { color: 0xc4d0de }, DarkMetal: { color: 0x9fb0c4 } }
    },
    gold: {
      color: 0xc37bff,
      mats: { Wood: { color: 0x552a72, emissive: 0x8a35e8, intensity: 0.18 },
        Wood2: { color: 0x653382, emissive: 0x8a35e8, intensity: 0.14 },
        Gold: { color: 0xffc94d }, Gold_Dark: { color: 0xb07f2a },
        Metal: { color: 0xf2c95c }, DarkMetal: { color: 0xe6b13c } }
    },
    diamant: {
      color: 0x7cd4ff,
      mats: { Wood: { color: 0x3f9fe8, emissive: 0x2e8fe0, intensity: 0.7, roughness: 0.2 },
        Wood2: { color: 0x6fc0f5, emissive: 0x4da8ea, intensity: 0.6, roughness: 0.2 },
        Gold: { color: 0xe6b13c }, Gold_Dark: { color: 0xb07f2a },
        Metal: { color: 0xdde8f2 }, DarkMetal: { color: 0xc3d2e2 } }
    }
  };

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
  function easeOutBack(x) {
    var c1 = 1.55, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }
  function easeInOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

  function create(container, rarityKey) {
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) { return null; }                 // kein WebGL -> Fallback (Bilder)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    var pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;

    var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    var CAM_BASE = new THREE.Vector3(0, 2.7, 6.9);
    var LOOK_AT = new THREE.Vector3(0, 1.05, 0);

    function fit() {
      var w = container.clientWidth || 300, h = container.clientHeight || 300;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      var halfWidthNeeded = 2.25;
      var tanHalfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
      CAM_BASE.z = Math.max(6.9, halfWidthNeeded / tanHalfH);
      CAM_BASE.y = 2.7 + (CAM_BASE.z - 6.9) * 0.12;
      camera.updateProjectionMatrix();
    }
    fit();
    camera.position.copy(CAM_BASE);
    var ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(fit); ro.observe(container); }

    // Licht
    scene.add(new THREE.HemisphereLight(0xbdd4ff, 0x2a1c10, 0.45));
    var key = new THREE.DirectionalLight(0xfff2dd, 1.1);
    key.position.set(4, 6, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4; key.shadow.camera.right = 4;
    key.shadow.camera.top = 5; key.shadow.camera.bottom = -2;
    key.shadow.camera.near = 1; key.shadow.camera.far = 20;
    key.shadow.bias = -0.002;
    scene.add(key);
    var rim = new THREE.DirectionalLight(0x6fa0ff, 0.55);
    rim.position.set(-5, 4, -6);
    scene.add(rim);
    var innerLight = new THREE.PointLight(0xffc24d, 0, 7, 2);
    scene.add(innerLight);

    // Schattenfaenger (transparent – der epische CSS-Hintergrund bleibt sichtbar)
    var shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.ShadowMaterial({ opacity: 0.38 })
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = 0.005;
    shadowCatcher.receiveShadow = true;
    scene.add(shadowCatcher);

    // Hilfs-Texturen
    function makeCanvas(size, draw) {
      var c = document.createElement('canvas');
      c.width = c.height = size;
      draw(c.getContext('2d'), size);
      var tx = new THREE.CanvasTexture(c);
      tx.encoding = THREE.sRGBEncoding;
      return tx;
    }
    var glowTex = makeCanvas(64, function (g, s) {
      var grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,240,200,0.8)');
      grad.addColorStop(1, 'rgba(255,230,160,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    });
    var shaftAlpha = makeCanvas(64, function (g, s) {
      var grad = g.createLinearGradient(0, 0, 0, s);
      grad.addColorStop(0, '#000');
      grad.addColorStop(0.45, '#fff');
      grad.addColorStop(1, '#fff');
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    });

    // Truhe (handgebautes Modell aus dem Truhen-Repo)
    var chest = new THREE.Group();
    scene.add(chest);
    var built = buildChest(THREE);
    var lidGroup = built.lid;
    var matByName = built.materials;
    var model = built.root;
    var W = 2.3;
    var box = new THREE.Box3().setFromObject(model);
    var size = box.getSize(new THREE.Vector3());
    model.scale.setScalar(W / size.x);
    box = new THREE.Box3().setFromObject(model);
    model.position.y = -box.min.y;
    model.position.x = -(box.min.x + box.max.x) / 2;
    model.position.z = -(box.min.z + box.max.z) / 2;
    var H = box.max.y - box.min.y;
    model.traverse(function (o) {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) { m.envMapIntensity = 0.45; });
      }
    });
    chest.add(model);
    innerLight.position.set(0, H * 0.9, 0);
    LOOK_AT.y = H * 0.52;

    // Lichtsaeule
    var shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(1.7, 0.45, 7.0, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd97a, transparent: true, opacity: 0, alphaMap: shaftAlpha,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    shaft.position.y = H + 3.1;
    scene.add(shaft);

    // Funken
    var SPARKS = reducedMotion ? 50 : 150;
    var sparkPos = new Float32Array(SPARKS * 3);
    var sparkVel = new Float32Array(SPARKS * 3);
    var sparkCol = new Float32Array(SPARKS * 3);
    var sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
    var sparkMat = new THREE.PointsMaterial({
      size: 0.16, map: glowTex, transparent: true, opacity: 0,
      vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    var sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.visible = false;
    scene.add(sparks);

    // Muenzen
    var COINS = reducedMotion ? 6 : 15;
    var coinGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.035, 18);
    var coinMat = new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.85 });
    coinMat.color.setHex(0xe0a83f).convertSRGBToLinear();
    var coins = [];
    for (var ci = 0; ci < COINS; ci++) {
      var coin = new THREE.Mesh(coinGeo, coinMat);
      coin.visible = false;
      coin.castShadow = true;
      scene.add(coin);
      coins.push({ mesh: coin, vel: new THREE.Vector3(), spin: new THREE.Vector3() });
    }

    function srgb(target, hex) { target.setHex(hex).convertSRGBToLinear(); return target; }

    var tier = TIERS.holz;
    function setRarity(keyName) {
      tier = TIERS[keyName] || TIERS.holz;
      Object.keys(tier.mats).forEach(function (name) {
        var m = matByName[name];
        if (!m) return;
        var def = tier.mats[name];
        srgb(m.color, def.color);
        srgb(m.emissive, def.emissive || 0x000000);
        m.emissiveIntensity = def.intensity || 0;
        if (def.roughness != null) m.roughness = def.roughness;
      });
      srgb(shaft.material.color, tier.color);
      innerLight.color.setHex(tier.color);
    }
    setRarity(rarityKey);

    // ---------- Ablauf-Zustand ----------
    var tapAnim = 0;
    var spinT = -1;            // 0..1 waehrend der 720-Grad-Drehung
    var shakeT = 0;            // Restzeit heftiges Wackeln (Sekunden)
    var openT = -1;            // Sekunden seit Oeffnungsbeginn (-1 = zu)
    var opened = false;
    var burstDone = false;
    var camShake = 0;
    var sparkAge = 0;
    var openResolve = null;
    var disposed = false;

    function spawnBurst() {
      var col = new THREE.Color(tier.color);
      for (var i = 0; i < SPARKS; i++) {
        sparkPos[i * 3] = (Math.random() - 0.5) * 0.5;
        sparkPos[i * 3 + 1] = H + 0.15;
        sparkPos[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
        var ang = Math.random() * Math.PI * 2;
        var spread = Math.random() * 2.4;
        sparkVel[i * 3] = Math.cos(ang) * spread;
        sparkVel[i * 3 + 1] = 3.2 + Math.random() * 4.2;
        sparkVel[i * 3 + 2] = Math.sin(ang) * spread;
        var mix = Math.random();
        sparkCol[i * 3] = 1 * mix + col.r * (1 - mix);
        sparkCol[i * 3 + 1] = 0.92 * mix + col.g * (1 - mix);
        sparkCol[i * 3 + 2] = 0.7 * mix + col.b * (1 - mix);
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.color.needsUpdate = true;
      sparkMat.opacity = 1;
      sparks.visible = true;
      sparkAge = 0;
      coins.forEach(function (c) {
        c.mesh.visible = true;
        c.mesh.position.set((Math.random() - 0.5) * 0.6, H + 0.2, (Math.random() - 0.5) * 0.4);
        var ang = Math.random() * Math.PI * 2;
        var sp = 0.8 + Math.random() * 1.8;
        c.vel.set(Math.cos(ang) * sp, 2.6 + Math.random() * 2.6, Math.sin(ang) * sp * 0.8 + 0.6);
        c.spin.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
      });
      camShake = reducedMotion ? 0 : 1;
    }

    var LID_OPEN = -1.92;
    function setLid(eased) { if (lidGroup) lidGroup.rotation.x = LID_OPEN * eased; }

    var clock = new THREE.Clock();
    function animate() {
      if (disposed) return;
      requestAnimationFrame(animate);
      var dt = Math.min(clock.getDelta(), 0.05);
      var t = clock.elapsedTime;

      // Idle-Wippen + glimmender Rahmen
      var bob = (openT < 0) ? Math.sin(t * 1.8) * 0.015 : 0;
      chest.position.y = bob;
      if (matByName.DarkMetal) {
        var pulse = (openT < 0) ? 0.1 + Math.sin(t * 2.4) * 0.07 : 0.04;
        matByName.DarkMetal.emissive.copy(matByName.DarkMetal.color);
        matByName.DarkMetal.emissiveIntensity = pulse;
      }

      // Tipp-Wackler (Squash & Stretch)
      if (tapAnim > 0) {
        tapAnim = Math.max(0, tapAnim - dt * 2.4);
        var w = reducedMotion ? tapAnim * 0.3 : tapAnim;
        chest.rotation.z = Math.sin(tapAnim * 22) * 0.07 * w;
        var sq = Math.sin(tapAnim * 16) * 0.07 * w;
        chest.scale.set(1 + sq, 1 - sq, 1 + sq);
      } else if (openT < 0) {
        chest.rotation.z = 0;
        chest.scale.set(1, 1, 1);
      }

      // 720-Grad-Drehung (Tipp-Drehen)
      if (spinT >= 0) {
        spinT += dt / 0.82;
        if (spinT >= 1) { spinT = -1; chest.rotation.y = 0; }
        else chest.rotation.y = easeInOutCubic(spinT) * Math.PI * 4;
      }

      // Heftiges Wackeln (Spannung vor der Oeffnung)
      if (shakeT > 0) {
        shakeT = Math.max(0, shakeT - dt);
        chest.rotation.z = Math.sin(t * 46) * 0.1;
        chest.position.y = bob + Math.abs(Math.sin(t * 30)) * 0.05;
        if (shakeT === 0) chest.rotation.z = 0;
      }

      // Oeffnung
      if (openT >= 0 && !opened) {
        openT += dt;
        if (openT < 0.22) {           // Anticipation: kurz zusammenstauchen
          var p = Math.sin((openT / 0.22) * Math.PI);
          chest.scale.set(1 + 0.12 * p, 1 - 0.2 * p, 1 + 0.12 * p);
        } else {
          chest.scale.set(1, 1, 1);
        }
        var q = clamp01((openT - 0.18) / 0.55);
        setLid(easeOutBack(q));
        innerLight.intensity = q * 3.8;
        shaft.material.opacity = q * 0.24;
        shaft.scale.set(1, 0.2 + q * 0.8, 1);
        if (!burstDone && openT >= 0.3) { burstDone = true; spawnBurst(); }
        if (openT > 1.6) {
          opened = true;
          if (openResolve) { openResolve(); openResolve = null; }
        }
      }
      if (opened) {                    // Truhe bleibt offen und leuchtet
        shaft.material.opacity = 0.32 + Math.sin(t * 2.2) * 0.05;
        innerLight.intensity = 4.6 + Math.sin(t * 5) * 0.6;
      }

      // Funken
      if (sparks.visible) {
        sparkAge += dt;
        for (var i = 0; i < SPARKS; i++) {
          sparkVel[i * 3 + 1] -= 6.5 * dt;
          sparkPos[i * 3] += sparkVel[i * 3] * dt;
          sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
          sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
        }
        sparkGeo.attributes.position.needsUpdate = true;
        sparkMat.opacity = Math.max(0, 1 - sparkAge / 1.3);
        if (sparkAge > 1.3) sparks.visible = false;
      }

      // Muenz-Physik
      coins.forEach(function (c) {
        if (!c.mesh.visible) return;
        c.vel.y -= 8.5 * dt;
        c.mesh.position.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += c.spin.x * dt;
        c.mesh.rotation.y += c.spin.y * dt;
        c.mesh.rotation.z += c.spin.z * dt;
        if (c.mesh.position.y < 0.05 && c.vel.y < 0) {
          c.mesh.position.y = 0.05;
          c.vel.y *= -0.35;
          c.vel.x *= 0.7;
          c.vel.z *= 0.7;
          c.spin.multiplyScalar(0.6);
        }
      });

      // Kamera: sanfte Drift + Punch beim Oeffnen
      var drift = reducedMotion ? 0 : 1;
      camera.position.x = CAM_BASE.x + Math.sin(t * 0.3) * 0.22 * drift;
      camera.position.y = CAM_BASE.y + Math.sin(t * 0.4) * 0.08 * drift;
      camera.position.z = CAM_BASE.z + (opened ? -0.45 : 0);
      if (camShake > 0) {
        camShake = Math.max(0, camShake - dt / 0.6);
        camera.position.x += (Math.random() - 0.5) * 0.14 * camShake;
        camera.position.y += (Math.random() - 0.5) * 0.14 * camShake;
      }
      camera.lookAt(LOOK_AT);

      renderer.render(scene, camera);
    }
    animate();

    return {
      tapWobble: function () { tapAnim = 1; },
      spin: function () { spinT = 0; tapAnim = 1; },
      setRarity: setRarity,
      shake: function (ms) { shakeT = (ms || 500) / 1000; },
      open: function () {
        return new Promise(function (resolve) {
          if (openT >= 0) { resolve(); return; }
          openResolve = resolve;
          openT = 0;
          if (reducedMotion) {         // sofort offen, ohne Drama
            setLid(1);
            openT = 1.7;
          }
        });
      },
      isOpen: function () { return opened; },
      dispose: function () {
        disposed = true;
        if (ro) ro.disconnect();
        try { renderer.dispose(); pmrem.dispose(); } catch (e) {}
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }

  window.WizChest3D = { create: create };
})();
