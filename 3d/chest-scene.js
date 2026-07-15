/*
 * Einbettbare 3D-Truhen-Szene fuer das Truhen-Oeffnen-Fenster (Zaubertisch).
 * Basiert auf dem Truhen-Repo des Users (ellseybcb/truhen).
 *
 * ZWEI Modell-Wege:
 *   1. KI-Modelle des Users (Meshy, als Base64-GLB in window.__CHESTS aus
 *      3d/chest-<id>.js): echte Texturen, Deckel wird automatisch an der
 *      Fugenhoehe abgeschnitten (Plane-Clipping) + dunkler Innenraum mit
 *      Silber-Randlippe. Zuordnung: diamant -> 'blau' (Kristalltruhe),
 *      silber -> 'silber' (Runentruhe).
 *   2. Handgebautes Modell (chest-model.js) fuer Stufen ohne KI-Modell
 *      (holz, gold) - wird je Seltenheit umgefaerbt.
 *
 * API (gesteuert vom Modal in app.js):
 *   tapWobble / spin / setRarity / shake / open / isOpen / dispose
 * Kein HUD, keine Sounds, keine Eingabe - das macht alles das Modal.
 */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Welche Seltenheit nutzt welches KI-Modell aus window.__CHESTS?
  // (gold hat noch kein KI-Modell -> handgebaute Truhe mit Gold-Faerbung)
  var MODEL_BY_RARITY = { diamant: 'blau', silber: 'silber', holz: 'holz' };

  // Farbstufen fuer das handgebaute Modell + Effektfarben fuer alle.
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
  function easeOutBack(x) {
    var c1 = 1.55, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }
  function easeInOutCubic(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function decodeB64(b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function create(container, rarityKey) {
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) { return null; }                 // kein WebGL -> Bild-Fallback
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
    var LOOK_AT = new THREE.Vector3(0, 2.3, 0);
    var visH = 8, topY = 8;   // sichtbare Welt-Hoehe / Welt-Y der Bild-Oberkante

    function fit() {
      var w = container.clientWidth || 300, h = container.clientHeight || 300;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      var halfWidthNeeded = 2.25;
      var tanHalfV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      var tanHalfH = tanHalfV * camera.aspect;
      CAM_BASE.z = Math.max(6.9, halfWidthNeeded / tanHalfH);
      CAM_BASE.y = 2.7 + (CAM_BASE.z - 6.9) * 0.12;
      camera.updateProjectionMatrix();
      // Truhe unten im Bild verankern: der Boden (y=0) liegt ~10% ueber der
      // Unterkante. Bei einer bildschirmhohen Buehne wandert der Blickpunkt
      // dadurch weit nach oben - die Strahlen haben freie Bahn bis ganz oben.
      visH = 2 * tanHalfV * CAM_BASE.z;
      LOOK_AT.y = Math.max((H || 1.5) * 0.52 + 1.25, visH * 0.40);
      topY = LOOK_AT.y + visH / 2;
      if (raysGroup) updateRayLengths();
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

    var shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 12),
      new THREE.ShadowMaterial({ opacity: 0.38 })
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = 0.005;
    shadowCatcher.receiveShadow = true;
    scene.add(shadowCatcher);

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
    var rayTex = makeCanvas(128, function (g, s) {
      var v = g.createLinearGradient(0, s, 0, 0);   // unten hell -> oben transparent
      v.addColorStop(0, 'rgba(255,255,255,0.95)');
      v.addColorStop(0.5, 'rgba(255,255,255,0.62)');
      v.addColorStop(0.9, 'rgba(255,255,255,0.3)');
      v.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = v;
      g.fillRect(0, 0, s, s);
      g.globalCompositeOperation = 'destination-in';
      var h = g.createLinearGradient(0, 0, s, 0);   // weiche Seitenkanten
      h.addColorStop(0, 'rgba(255,255,255,0)');
      h.addColorStop(0.5, 'rgba(255,255,255,1)');
      h.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = h;
      g.fillRect(0, 0, s, s);
    });

    // ---------- Truhen-Modelle ----------
    var chest = new THREE.Group();
    scene.add(chest);
    var W = 2.3;
    var H = 1.5;
    var currentModel = null, lidGroup = null, lidRestX = 0;
    var tintModel = true, matByName = {};
    var LID_OPEN = -1.92;
    var modelReady = false;
    var currentRarity = rarityKey;

    function finishModel(model, lidOpen, texB64) {
      var box = new THREE.Box3().setFromObject(model);
      var size = box.getSize(new THREE.Vector3());
      model.scale.setScalar(W / size.x);
      box = new THREE.Box3().setFromObject(model);
      model.position.y = -box.min.y;
      model.position.x = -(box.min.x + box.max.x) / 2;
      model.position.z = -(box.min.z + box.max.z) / 2;
      H = box.max.y - box.min.y;

      // Farbtextur der KI-Modelle als Daten-URI (blob:-URLs sind in der
      // iOS-App per CSP blockiert -> Modell bliebe sonst weiss).
      var colorMap = null;
      if (!tintModel && texB64) {
        colorMap = new THREE.TextureLoader().load('data:image/jpeg;base64,' + texB64);
        colorMap.flipY = false;
        colorMap.encoding = THREE.sRGBEncoding;
        colorMap.wrapS = colorMap.wrapT = THREE.RepeatWrapping;
      }

      model.traverse(function (obj) {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.frustumCulled = false;
          var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(function (m) {
            if (m.userData && m.userData.frame) return;
            if (tintModel) {
              m.envMapIntensity = 0.45;
            } else {
              m.envMapIntensity = 0.18;
              if (m.metalness == null || m.metalness > 0.5) m.metalness = 0.5;
              if (m.roughness == null || m.roughness < 0.5) m.roughness = 0.55;
              if (colorMap) {
                m.map = colorMap;
                m.color.setHex(0xffffff);
                m.needsUpdate = true;
              }
            }
          });
        }
      });

      chest.add(model);
      currentModel = model;
      LID_OPEN = lidOpen;
      innerLight.position.set(0, H * 0.9, 0);
      raysGroup.position.y = H + 0.25;
      mouthGlow.position.set(0, H + 0.3, 0);
      fit();   // Blickpunkt + Strahlenlaengen an die neue Truhenhoehe anpassen
      modelReady = true;
      if (tintModel) applyTint(currentRarity);
    }

    function useBuiltModel() {
      var built = buildChest(THREE);
      lidGroup = built.lid;
      lidRestX = 0;
      tintModel = true;
      matByName = built.materials;
      finishModel(built.root, -1.92, null);
    }

    // Zerlegt ein Mesh an der Ebene y=seamY in Unter-/Oberteil (echtes
    // Plane-Clipping mit Attribut-Interpolation -> glatte Schnittkante).
    function splitMeshAtY(mesh, seamY) {
      var geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      var attrs = Object.keys(geo.attributes);
      var lower = {}, upper = {};
      attrs.forEach(function (a) { lower[a] = []; upper[a] = []; });

      function vert(i) {
        var v = {};
        attrs.forEach(function (a) {
          var attr = geo.attributes[a], sz = attr.itemSize, arr = [];
          for (var k = 0; k < sz; k++) arr.push(attr.array[i * sz + k]);
          v[a] = arr;
        });
        return v;
      }
      function y(v) { return v.position[1]; }
      function lerpV(a, b, t) {
        var v = {};
        attrs.forEach(function (name) {
          var out = [], A = a[name], B = b[name];
          for (var k = 0; k < A.length; k++) out.push(A[k] + (B[k] - A[k]) * t);
          v[name] = out;
        });
        return v;
      }
      function clip(a, b) { return lerpV(a, b, (seamY - y(a)) / (y(b) - y(a))); }
      function push(dst, v) { attrs.forEach(function (n) { for (var k = 0; k < v[n].length; k++) dst[n].push(v[n][k]); }); }
      function tri(dst, a, b, c) { push(dst, a); push(dst, b); push(dst, c); }

      var pos = geo.attributes.position;
      for (var i = 0; i < pos.count; i += 3) {
        var v0 = vert(i), v1 = vert(i + 1), v2 = vert(i + 2);
        var above = [], below = [];
        [v0, v1, v2].forEach(function (v) { (y(v) >= seamY ? above : below).push(v); });
        if (below.length === 3) { tri(lower, v0, v1, v2); continue; }
        if (above.length === 3) { tri(upper, v0, v1, v2); continue; }
        if (above.length === 1) {
          var A = above[0], B = below[0], C = below[1];
          var P = clip(A, B), Q = clip(A, C);
          tri(upper, A, P, Q);
          tri(lower, P, B, C); tri(lower, P, C, Q);
        } else {
          var A2 = above[0], B2 = above[1], C2 = below[0];
          var P2 = clip(A2, C2), Q2 = clip(B2, C2);
          tri(lower, C2, P2, Q2);
          tri(upper, A2, B2, Q2); tri(upper, A2, Q2, P2);
        }
      }

      function build(data) {
        if (!data.position.length) return null;
        var g = new THREE.BufferGeometry();
        attrs.forEach(function (a) {
          g.setAttribute(a, new THREE.Float32BufferAttribute(data[a], geo.attributes[a].itemSize));
        });
        return g;
      }
      return { lower: build(lower), upper: build(upper) };
    }

    // Dunkler Innenraum + Silber-Randlippe, damit die aufgeschnittene Truhe
    // wie ein echter Behaelter wirkt (aus dem Truhen-Repo uebernommen).
    function buildChestInterior(meshes, box, seamY, backZ, body, lid) {
      var modelH = box.max.y - box.min.y;
      var d = modelH * 0.04;
      var oxMin = Infinity, oxMax = -Infinity, ozMin = Infinity, ozMax = -Infinity, n = 0;
      meshes.forEach(function (m) {
        var g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        g.applyMatrix4(m.matrixWorld);
        var pos = g.attributes.position;
        for (var i = 0; i < pos.count; i++) {
          var yy = pos.getY(i);
          if (yy < seamY - d || yy > seamY + d) continue;
          var xx = pos.getX(i), zz = pos.getZ(i);
          if (xx < oxMin) oxMin = xx; if (xx > oxMax) oxMax = xx;
          if (zz < ozMin) ozMin = zz; if (zz > ozMax) ozMax = zz;
          n++;
        }
      });
      if (n < 20) { oxMin = box.min.x; oxMax = box.max.x; ozMin = box.min.z; ozMax = box.max.z; }
      var oin = Math.min(oxMax - oxMin, ozMax - ozMin) * 0.10;
      oxMin += oin; oxMax -= oin; ozMin += oin; ozMax -= oin;

      var spanX = oxMax - oxMin, spanZ = ozMax - ozMin;
      var cx = (oxMin + oxMax) / 2, cz = (ozMin + ozMax) / 2;

      var silver = new THREE.MeshStandardMaterial({ color: 0xc4d3e6, metalness: 0.6, roughness: 0.4 });
      silver.envMapIntensity = 0.2;
      silver.userData.frame = true;
      var dark = new THREE.MeshStandardMaterial({ color: 0x0a1524, metalness: 0.1, roughness: 1 });
      dark.userData.frame = true;

      var rimW = Math.min(spanX, spanZ) * 0.11;
      var rimH = modelH * 0.022;
      var inX0 = oxMin + rimW, inX1 = oxMax - rimW;
      var inZ0 = ozMin + rimW, inZ1 = ozMax - rimW;
      var inSpanX = inX1 - inX0, inSpanZ = inZ1 - inZ0;

      function bar(w, h, dd, x, y, z, mat, group) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), mat);
        m.position.set(x, y, z);
        m.castShadow = true; m.receiveShadow = true;
        group.add(m);
      }
      function rimFrame(group, yC, zOff) {
        bar(spanX, rimH, rimW, cx, yC, ozMin + rimW / 2 + zOff, silver, group);
        bar(spanX, rimH, rimW, cx, yC, ozMax - rimW / 2 + zOff, silver, group);
        bar(rimW, rimH, spanZ - 2 * rimW, oxMin + rimW / 2, yC, cz + zOff, silver, group);
        bar(rimW, rimH, spanZ - 2 * rimW, oxMax - rimW / 2, yC, cz + zOff, silver, group);
      }
      rimFrame(body, seamY - rimH / 2, 0);

      var wallT = rimW * 0.5;
      var cavDepth = modelH * 0.32;
      var floorY = seamY - cavDepth;
      var wallCY = seamY - cavDepth / 2;
      bar(inSpanX, cavDepth, wallT, cx, wallCY, inZ0 + wallT / 2, dark, body);
      bar(inSpanX, cavDepth, wallT, cx, wallCY, inZ1 - wallT / 2, dark, body);
      bar(wallT, cavDepth, inSpanZ, inX0 + wallT / 2, wallCY, cz, dark, body);
      bar(wallT, cavDepth, inSpanZ, inX1 - wallT / 2, wallCY, cz, dark, body);
      bar(inSpanX, modelH * 0.03, inSpanZ, cx, floorY, cz, dark, body);

      bar(inSpanX, modelH * 0.03, inSpanZ, cx, modelH * 0.02, cz - backZ, dark, lid);
      rimFrame(lid, rimH / 2, -backZ);
    }

    // KI-Modell (GLB) laden: benannter Deckel ODER Auto-Schnitt an der Fuge.
    function useGlbModel(cfg) {
      new THREE.GLTFLoader().parse(decodeB64(cfg.glb), '', function (gltf) {
        var src = gltf.scene;
        tintModel = false;
        matByName = {};
        var lidOpen = cfg.lidOpen != null ? cfg.lidOpen : -0.75;

        var named = null;
        src.traverse(function (o) {
          if (!named && /(^|[_ -])(lid|top|deckel)([_ -]|$)/i.test(o.name || '')) named = o;
        });
        if (named) {
          lidGroup = named;
          lidRestX = named.rotation.x;
          finishModel(src, lidOpen, cfg.tex);
          return;
        }

        src.rotation.y = cfg.yaw != null ? cfg.yaw : Math.PI / 2;
        src.updateMatrixWorld(true);
        var box = new THREE.Box3().setFromObject(src);
        var seam = cfg.seam != null ? cfg.seam : 0.62;
        var seamY = box.min.y + (box.max.y - box.min.y) * seam;
        var backZ = box.min.z + (box.max.z - box.min.z) * 0.02;

        var meshes = [];
        src.traverse(function (o) { if (o.isMesh) meshes.push(o); });

        var model = new THREE.Group();
        var body = new THREE.Group();
        var lid = new THREE.Group();
        lid.position.set(0, seamY, backZ);
        model.add(body);
        model.add(lid);

        meshes.forEach(function (m) {
          var mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach(function (mm) { mm.side = THREE.DoubleSide; });
          var parts = splitMeshAtY(m, seamY);
          if (parts.lower) body.add(new THREE.Mesh(parts.lower, m.material));
          if (parts.upper) {
            parts.upper.translate(0, -seamY, -backZ);
            lid.add(new THREE.Mesh(parts.upper, m.material));
          }
        });

        buildChestInterior(meshes, box, seamY, backZ, body, lid);
        lidGroup = lid;
        lidRestX = 0;
        finishModel(model, lidOpen, cfg.tex);
      }, function () {
        useBuiltModel();   // GLB kaputt -> handgebaute Truhe
      });
    }

    // Modell fuer eine Seltenheit laden (KI-Modell falls registriert).
    function loadModelFor(r) {
      if (currentModel) { chest.remove(currentModel); currentModel = null; }
      modelReady = false;
      lidGroup = null;
      var id = MODEL_BY_RARITY[r];
      var cfg = id && window.__CHESTS && window.__CHESTS[id];
      if (cfg && window.THREE && THREE.GLTFLoader) useGlbModel(cfg);
      else useBuiltModel();
    }

    // ---------- Lichtsaeule / Funken / Muenzen ----------
    // ECHTE Lichtstrahlen: einzelne Ebenen faechern aus der Oeffnung in alle
    // Richtungen, jede mit eigener Laenge/Breite/Helligkeit, oben auslaufend.
    // Die Laenge wird in updateRayLengths() so berechnet, dass jeder Strahl
    // bis UEBER die Bild-Oberkante reicht (Einheits-Geometrie + scale.y).
    var raysGroup = new THREE.Group();
    var rayDefs = [];
    [-55, -42, -30, -19, -9, 0, 8, 18, 29, 41, 54].forEach(function (deg) {
      var wdt = 0.28 + Math.random() * 0.55;
      var geo = new THREE.PlaneGeometry(wdt, 1);
      geo.translate(0, 0.5, 0);                    // Fusspunkt am Ursprung
      var mat = new THREE.MeshBasicMaterial({
        map: rayTex, color: 0xffd97a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      });
      var m = new THREE.Mesh(geo, mat);
      m.rotation.z = THREE.MathUtils.degToRad(deg);
      raysGroup.add(m);
      rayDefs.push({
        mesh: m, base: 0.2 + Math.random() * 0.18,
        phase: Math.random() * Math.PI * 2, speed: 0.7 + Math.random() * 0.9,
        baseZ: m.rotation.z,
        lenR: 1.3 + Math.random() * 0.45,          // Spitze deutlich UEBER der Oberkante
        len: 6
      });
    });
    raysGroup.position.y = H + 0.25;
    scene.add(raysGroup);
    // Strahlenlaengen an die aktuelle Bildhoehe anpassen: vom Fusspunkt an der
    // Truhenoeffnung bis ueber die Oberkante (schraege Strahlen entsprechend
    // laenger); breite Strahlen wachsen mit, damit nichts nadelduenn wird.
    function updateRayLengths() {
      var dist = Math.max(3, topY - raysGroup.position.y);
      rayDefs.forEach(function (d) {
        d.len = dist / Math.max(0.4, Math.cos(d.baseZ)) * d.lenR;
        d.mesh.scale.x = 0.75 + d.len * 0.1;
        if (opened) d.mesh.scale.y = d.len;
      });
    }
    updateRayLengths();
    // Runder Lichtschein direkt an der Oeffnung (leuchtet in alle Richtungen)
    var mouthGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffd97a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    mouthGlow.scale.set(5.2, 3.6, 1);
    mouthGlow.position.set(0, H + 0.3, 0);
    scene.add(mouthGlow);

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

    var tier = TIERS[rarityKey] || TIERS.holz;
    function applyTint(r) {
      var t = TIERS[r] || TIERS.holz;
      Object.keys(t.mats).forEach(function (name) {
        var m = matByName[name];
        if (!m) return;
        var def = t.mats[name];
        srgb(m.color, def.color);
        srgb(m.emissive, def.emissive || 0x000000);
        m.emissiveIntensity = def.intensity || 0;
        if (def.roughness != null) m.roughness = def.roughness;
      });
    }
    function setRarity(r) {
      var oldId = MODEL_BY_RARITY[currentRarity] || null;
      var newId = MODEL_BY_RARITY[r] || null;
      currentRarity = r;
      tier = TIERS[r] || TIERS.holz;
      rayDefs.forEach(function (d) { srgb(d.mesh.material.color, tier.color); });
      srgb(mouthGlow.material.color, tier.color);
      innerLight.color.setHex(tier.color);
      if (newId !== oldId || !currentModel) loadModelFor(r);
      else if (tintModel) applyTint(r);
    }

    // ---------- Ablauf-Zustand ----------
    var tapAnim = 0;
    var spinT = -1;
    var shakeT = 0;
    var openT = -1;
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

    function setLid(eased) { if (lidGroup) lidGroup.rotation.x = lidRestX + LID_OPEN * eased; }

    var clock = new THREE.Clock();
    function animate() {
      if (disposed) return;
      requestAnimationFrame(animate);
      var dt = Math.min(clock.getDelta(), 0.05);
      var t = clock.elapsedTime;

      var bob = (openT < 0) ? Math.sin(t * 1.8) * 0.015 : 0;
      chest.position.y = bob;
      if (tintModel && matByName.DarkMetal) {
        var pulse = (openT < 0) ? 0.1 + Math.sin(t * 2.4) * 0.07 : 0.04;
        matByName.DarkMetal.emissive.copy(matByName.DarkMetal.color);
        matByName.DarkMetal.emissiveIntensity = pulse;
      }

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

      if (spinT >= 0) {
        spinT += dt / 0.82;
        if (spinT >= 1) { spinT = -1; chest.rotation.y = 0; }
        else chest.rotation.y = easeInOutCubic(spinT) * Math.PI * 4;
      }

      if (shakeT > 0) {
        shakeT = Math.max(0, shakeT - dt);
        chest.rotation.z = Math.sin(t * 46) * 0.1;
        chest.position.y = bob + Math.abs(Math.sin(t * 30)) * 0.05;
        if (shakeT === 0) chest.rotation.z = 0;
      }

      if (openT >= 0 && !opened) {
        openT += dt;
        if (openT < 0.22) {
          var p = Math.sin((openT / 0.22) * Math.PI);
          chest.scale.set(1 + 0.12 * p, 1 - 0.2 * p, 1 + 0.12 * p);
        } else {
          chest.scale.set(1, 1, 1);
        }
        var q = clamp01((openT - 0.18) / 0.55);
        setLid(easeOutBack(q));
        innerLight.intensity = q * 3.8;
        rayDefs.forEach(function (d) {
          d.mesh.material.opacity = q * d.base;
          d.mesh.scale.y = d.len * (0.25 + q * 0.75);
        });
        mouthGlow.material.opacity = q * 0.7;
        if (!burstDone && openT >= 0.3) { burstDone = true; spawnBurst(); }
        if (openT > 1.6) {
          opened = true;
          if (openResolve) { openResolve(); openResolve = null; }
        }
      }
      if (opened) {
        rayDefs.forEach(function (d) {
          d.mesh.material.opacity = d.base * (0.72 + 0.28 * Math.sin(t * d.speed + d.phase));
          d.mesh.rotation.z = d.baseZ + Math.sin(t * 0.5 + d.phase) * 0.018;
        });
        mouthGlow.material.opacity = 0.62 + Math.sin(t * 3.1) * 0.12;
        innerLight.intensity = 4.6 + Math.sin(t * 5) * 0.6;
      }

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

    loadModelFor(rarityKey);
    animate();

    function whenReady() {
      return new Promise(function (res) {
        (function poll() {
          if (modelReady || disposed) res();
          else setTimeout(poll, 60);
        })();
      });
    }

    return {
      tapWobble: function () { tapAnim = 1; },
      spin: function () { spinT = 0; tapAnim = 1; },
      setRarity: setRarity,
      shake: function (ms) { shakeT = (ms || 500) / 1000; },
      open: function () {
        return whenReady().then(function () {
          return new Promise(function (resolve) {
            if (openT >= 0) { resolve(); return; }
            openResolve = resolve;
            openT = 0;
            if (reducedMotion) {
              setLid(1);
              openT = 1.7;
            }
          });
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
