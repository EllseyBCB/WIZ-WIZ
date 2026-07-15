/*
 * Handgebautes 3D-Modell der Holztruhe nach dem Referenzbild des Users:
 * dunkles Plankenholz, Bronze-Rahmen mit Kugel-Nieten, Eckpfosten,
 * seitliche Ringgriffe, geschichtetes Schlossschild mit Spitzbogen-Krone,
 * Tonnenbogen-Deckel mit drei Bändern, Goldschatz mit Sternmünzen innen.
 *
 * buildChest(THREE) → { root, lid, materials }
 *   root      … komplette Truhe (steht auf y=0, Breite ~2,3)
 *   lid       … Deckel-Gruppe, Drehpunkt an der hinteren Oberkante
 *               (öffnen = negative rotation.x)
 *   materials … benannte Materialien fürs Tier-Umfärben
 *               (Wood, Wood2, DarkMetal, Metal, Gold, Gold_Dark)
 */
function buildChest(THREE) {
  'use strict';

  // Grundmaße (Referenz: fast quadratische Silhouette)
  var BW = 1.7;    // Planken-Breite des Korpus (Referenz: fast quadratische Front)
  var BH = 1.0;    // Korpus-Höhe
  var BD = 1.5;    // Korpus-Tiefe
  var LR = BD / 2; // Deckel-Radius (Tonnenbogen über die Tiefe)

  // Platzhalter-Farben — applyTier() färbt direkt nach dem Bau um
  function std(opts) { return new THREE.MeshStandardMaterial(opts); }
  var materials = {
    Wood: std({ color: 0x6b3a14, roughness: 0.72, metalness: 0.0 }),
    Wood2: std({ color: 0x7a4519, roughness: 0.78, metalness: 0.0 }),
    DarkMetal: std({ color: 0xb98a3a, roughness: 0.38, metalness: 0.85 }),
    Metal: std({ color: 0xcfa54e, roughness: 0.3, metalness: 0.9 }),
    Gold: std({ color: 0xe6b13c, roughness: 0.32, metalness: 0.85 }),
    Gold_Dark: std({ color: 0x9a6a18, roughness: 0.4, metalness: 0.85 })
  };
  // Fixe Materialien (werden nicht pro Stufe umgefärbt)
  var darkMat = std({ color: 0x1a120a, roughness: 0.9, metalness: 0.1 });
  var innerMat = std({ color: 0x241708, roughness: 1, side: THREE.BackSide });

  materials.Wood.name = 'Wood';
  materials.Wood2.name = 'Wood2';
  materials.DarkMetal.name = 'DarkMetal';
  materials.Metal.name = 'Metal';
  materials.Gold.name = 'Gold';
  materials.Gold_Dark.name = 'Gold_Dark';

  var root = new THREE.Group();

  function add(parent, geo, mat, x, y, z) {
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x || 0, y || 0, z || 0);
    parent.add(mesh);
    return mesh;
  }
  function rbox(w, h, d, r) {
    return new THREE.RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
  }

  // ---------- Korpus: 4 horizontale Planken-Reihen ----------
  var ROWS = 4, GAP = 0.016;
  var rowH = (BH - (ROWS - 1) * GAP) / ROWS;
  for (var r = 0; r < ROWS; r++) {
    var y = rowH / 2 + r * (rowH + GAP);
    add(root, rbox(BW, rowH, BD, 0.025), r % 2 ? materials.Wood2 : materials.Wood, 0, y, 0);
  }
  // Dunkler Innenraum (sichtbar, wenn der Deckel offen ist)
  add(root, new THREE.BoxGeometry(BW - 0.05, BH + 0.04, BD - 0.05), innerMat, 0, BH / 2 + 0.02, 0);

  // ---------- Bronze-Rahmen ----------
  var postW = 0.2;
  [-1, 1].forEach(function (sx) {
    [-1, 1].forEach(function (sz) {
      var px = sx * (BW / 2 + 0.015), pz = sz * (BD / 2 + 0.015);
      add(root, rbox(postW, BH + 0.14, postW, 0.05), materials.DarkMetal, px, (BH + 0.14) / 2 - 0.02, pz);
      // Fuß + Nieten am Pfosten (oben/unten, nach vorne zeigend)
      add(root, rbox(postW + 0.08, 0.13, postW + 0.08, 0.04), materials.DarkMetal, px, 0.045, pz);
      add(root, new THREE.SphereGeometry(0.038, 12, 10), materials.Metal, px, BH - 0.06, pz + sz * (postW / 2 + 0.012));
      add(root, new THREE.SphereGeometry(0.038, 12, 10), materials.Metal, px, 0.28, pz + sz * (postW / 2 + 0.012));
    });
  });

  // Boden- und Oberkanten-Rails (vorn/hinten + seitlich)
  function railFrame(y, railH, railT) {
    [-1, 1].forEach(function (sz) {
      add(root, rbox(BW + 0.1, railH, railT, 0.03), materials.DarkMetal, 0, y, sz * (BD / 2 + railT / 2 - 0.02));
    });
    [-1, 1].forEach(function (sx) {
      add(root, rbox(railT, railH, BD + 0.1, 0.03), materials.DarkMetal, sx * (BW / 2 + railT / 2 - 0.02), y, 0);
    });
  }
  railFrame(0.1, 0.17, 0.1);
  railFrame(BH - 0.055, 0.12, 0.09);

  // Nieten auf dem vorderen Ober-Rail
  [-0.62, -0.31, 0.31, 0.62].forEach(function (fx) {
    add(root, new THREE.SphereGeometry(0.028, 12, 10), materials.Metal, fx * BW / 2 / 0.95 * 0.95, BH - 0.055, BD / 2 + 0.075);
  });

  // ---------- Ringgriffe an den Seiten ----------
  [-1, 1].forEach(function (sx) {
    var mx = sx * (BW / 2 + 0.06);
    add(root, rbox(0.07, 0.17, 0.17, 0.03), materials.DarkMetal, mx, BH * 0.62, 0);
    var ring = add(root, new THREE.TorusGeometry(0.14, 0.026, 10, 24), materials.Metal, sx * (BW / 2 + 0.1), BH * 0.62 - 0.16, 0);
    ring.rotation.y = Math.PI / 2;
    ring.rotation.x = sx * 0.12;
  });

  // ---------- Deckel (Tonnenbogen, Drehpunkt hintere Oberkante) ----------
  var lid = new THREE.Group();
  lid.position.set(0, BH, -BD / 2);
  root.add(lid);

  // Basisplatte schließt den Deckel nach unten ab
  add(lid, rbox(BW + 0.04, 0.09, BD + 0.02, 0.02), materials.Wood, 0, 0.045, BD / 2);

  // Gebogene Planken: Halbzylinder in 4 Bogen-Segmente mit Fugen zerlegt
  var SEG = 4, thetaGap = 0.035;
  var segLen = (Math.PI - (SEG - 1) * thetaGap) / SEG;
  for (var s = 0; s < SEG; s++) {
    var start = s * (segLen + thetaGap);
    var geo = new THREE.CylinderGeometry(LR, LR, BW, 24, 1, false, start, segLen);
    geo.rotateZ(Math.PI / 2);
    add(lid, geo, s % 2 ? materials.Wood2 : materials.Wood, 0, 0.09, BD / 2);
  }
  // Stirnseiten (halbe Scheiben)
  [-1, 1].forEach(function (sx) {
    var cap = new THREE.CircleGeometry(LR - 0.01, 24, 0, Math.PI);
    var mesh = add(lid, cap, materials.Wood2, sx * (BW / 2 - 0.005), 0.09, BD / 2);
    mesh.rotation.y = sx * Math.PI / 2;
  });

  // Drei Bronze-Bänder über den Bogen + Nieten
  [-0.72, 0, 0.72].forEach(function (fx) {
    var band = new THREE.CylinderGeometry(LR + 0.035, LR + 0.035, 0.2, 24, 1, true, 0, Math.PI);
    band.rotateZ(Math.PI / 2);
    add(lid, band, materials.DarkMetal, fx * BW / 2, 0.09, BD / 2);
    [0.45, 1.05, Math.PI / 2].forEach(function (th) {
      [th, Math.PI - th].forEach(function (theta) {
        if (theta > Math.PI) return;
        var ny = 0.09 + Math.sin(theta) * (LR + 0.045);
        var nz = BD / 2 + Math.cos(theta) * (LR + 0.045);
        add(lid, new THREE.SphereGeometry(0.026, 10, 8), materials.Metal, fx * BW / 2, ny, nz);
      });
    });
  });

  // Frontkanten-Band des Deckels
  add(lid, rbox(BW + 0.06, 0.1, 0.09, 0.03), materials.DarkMetal, 0, 0.05, BD + 0.02);

  // ---------- Schloss ----------
  // Geschichtetes Schild (am Korpus) per Extrusion einer Schild-Kontur
  function shieldShape(w, h) {
    var s = new THREE.Shape();
    s.moveTo(-w / 2, h * 0.35);
    s.quadraticCurveTo(-w / 2 - 0.02, 0, -w * 0.32, -h * 0.28);
    s.quadraticCurveTo(0, -h / 2 - 0.03, w * 0.32, -h * 0.28);
    s.quadraticCurveTo(w / 2 + 0.02, 0, w / 2, h * 0.35);
    s.quadraticCurveTo(w * 0.3, h / 2, 0, h / 2);
    s.quadraticCurveTo(-w * 0.3, h / 2, -w / 2, h * 0.35);
    return s;
  }
  function extrude(shape, depth, bevel) {
    return new THREE.ExtrudeGeometry(shape, {
      depth: depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10
    });
  }
  var shield = add(root, extrude(shieldShape(0.42, 0.52), 0.035, 0.015), materials.DarkMetal, 0, BH - 0.2, BD / 2 + 0.045);
  // Schlüsselloch (dunkel, leicht vor dem Schild)
  add(root, new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16), darkMat, 0, BH - 0.13, BD / 2 + 0.1).rotation.x = Math.PI / 2;
  var wedge = new THREE.Shape();
  wedge.moveTo(-0.022, 0); wedge.lineTo(0.022, 0); wedge.lineTo(0.042, -0.14); wedge.lineTo(-0.042, -0.14); wedge.closePath();
  add(root, extrude(wedge, 0.02, 0.005), darkMat, 0, BH - 0.13, BD / 2 + 0.09);
  // Nieten auf dem Schild
  [[-0.15, 0.09], [0.15, 0.09]].forEach(function (p) {
    add(root, new THREE.SphereGeometry(0.024, 10, 8), materials.Metal, p[0], BH - 0.2 + p[1], BD / 2 + 0.095);
  });

  // Spitzbogen-Krone auf der Deckel-Front (hebt sich mit dem Deckel)
  var crown = new THREE.Shape();
  crown.moveTo(-0.2, 0);
  crown.quadraticCurveTo(-0.2, 0.16, 0, 0.26);
  crown.quadraticCurveTo(0.2, 0.16, 0.2, 0);
  crown.lineTo(0.13, 0);
  crown.quadraticCurveTo(0.13, 0.1, 0, 0.16);
  crown.quadraticCurveTo(-0.13, 0.1, -0.13, 0);
  crown.closePath();
  add(lid, extrude(crown, 0.04, 0.012), materials.DarkMetal, 0, 0.02, BD + 0.03);
  // Herabhängende Schließe
  add(lid, rbox(0.14, 0.22, 0.05, 0.02), materials.DarkMetal, 0, -0.06, BD + 0.055);

  // ---------- Goldschatz innen ----------
  var treasure = new THREE.Group();
  treasure.position.y = BH - 0.28;
  root.add(treasure);
  var pile = [
    [0, 0.05, 0, 0.42], [-0.5, 0, 0.1, 0.3], [0.48, 0, -0.05, 0.32],
    [-0.2, 0.02, -0.3, 0.26], [0.15, 0.03, 0.3, 0.24]
  ];
  pile.forEach(function (p) {
    var m = add(treasure, new THREE.SphereGeometry(p[3], 12, 10), materials.Gold_Dark, p[0], p[1], p[2]);
    m.scale.y = 0.55;
  });
  // Münzen
  for (var c = 0; c < 9; c++) {
    var ang = (c / 9) * Math.PI * 2;
    var coin = add(treasure, new THREE.CylinderGeometry(0.085, 0.085, 0.028, 14), materials.Gold,
      Math.cos(ang) * (0.25 + (c % 3) * 0.14), 0.16 + (c % 2) * 0.05, Math.sin(ang) * 0.24);
    coin.rotation.set((Math.random() - 0.5) * 0.7, ang, (Math.random() - 0.5) * 0.7);
  }
  // Zwei Sternmünzen (Hommage ans Referenzbild)
  function starShape(rOut, rIn) {
    var s = new THREE.Shape();
    for (var i = 0; i < 10; i++) {
      var rad = i % 2 ? rIn : rOut;
      var a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      var x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    s.closePath();
    return s;
  }
  [[-0.12, 0.3, 0.05, -0.5], [0.3, 0.26, -0.12, 0.4]].forEach(function (p) {
    var star = add(treasure, extrude(starShape(0.15, 0.075), 0.03, 0.008), materials.Gold, p[0], p[1], p[2]);
    star.rotation.set(-Math.PI / 2 + 0.4, 0, p[3]);
  });

  return { root: root, lid: lid, materials: materials };
}
