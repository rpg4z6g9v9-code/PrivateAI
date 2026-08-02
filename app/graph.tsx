/**
 * graph.tsx — Knowledge Graph (WebView, 3D)
 *
 * Renders picked documents as nodes in a 3D Three.js scene, hosted in a
 * WebView (three.js + OrbitControls bundled locally under assets/threejs/,
 * same offline-first pattern as the pdf.js extraction WebView — no CDN).
 * Nodes come from services/graphNodes.ts (persisted by the chat screen's
 * upload icon before navigating here). If this screen is opened directly
 * (e.g. the "view last upload" icon) there's nothing passed via navigation,
 * so it falls back to whatever's already stored. Edges are purely
 * embedding-similarity-derived (services/embeddings.ts computeGraphEdges) —
 * no LLM-based link-detection yet.
 */

import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import { getGraphNodes, getLastContextNodes, type GraphNode } from '@/services/graphNodes';
import { computeGraphEdges, type GraphEdge } from '@/services/embeddings';

import threeAssetModule from '@/assets/threejs/three.min.jslib';
import orbitControlsAssetModule from '@/assets/threejs/OrbitControls.jslib';

const FONT = 'Courier New';

/** Downloads a bundled .jslib asset and reads its text content — same pattern as PdfExtractorWebView. */
async function loadJsLibSource(assetModule: number): Promise<string> {
  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('jslib asset localUri missing');
  return FileSystemLegacy.readAsStringAsync(asset.localUri);
}

/** Escapes `</script` so bundled sources / preview text can't break out of their inline <script> tag. */
function escapeScriptClose(text: string): string {
  return text.replace(/<\//g, '<\\/');
}

function buildGraphHtml(
  nodes: GraphNode[],
  matchedIds: string[],
  edges: GraphEdge[],
  threeSrc: string,
  orbitControlsSrc: string
): string {
  // Strip embeddings — the WebView only ever draws label/preview, no need to
  // ship ~768-float vectors per node into the HTML payload. The edge list
  // (already derived from those embeddings on the RN side) is small and
  // just references node ids, so it ships as-is.
  const nodesForHtml = nodes.map(({ id, label, p }) => ({ id, label, p }));
  const nodesJson = escapeScriptClose(JSON.stringify(nodesForHtml));
  const matchedJson = escapeScriptClose(JSON.stringify(matchedIds));
  const edgesJson = escapeScriptClose(JSON.stringify(edges));
  const safeThreeSrc = escapeScriptClose(threeSrc);
  const safeOrbitControlsSrc = escapeScriptClose(orbitControlsSrc);

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; padding: 0; background: #080d14; overflow: hidden; height: 100%; }
  #canvas { display: block; }
  #empty {
    position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    color: #556677; font-family: 'Courier New', monospace; font-size: 13px; letter-spacing: 0.5px;
  }
  #preview {
    position: fixed; left: 0; right: 0; bottom: 0;
    background: rgba(14, 20, 32, 0.96); border-top: 1px solid #252540;
    padding: 14px 18px 28px; display: none; font-family: 'Courier New', monospace;
  }
  #preview.visible { display: block; }
  #preview .label { color: #4a9eff; font-size: 13px; letter-spacing: 0.5px; margin-bottom: 6px; }
  #preview .text { color: #c0c0d0; font-size: 12px; line-height: 18px; }
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<div id="empty">no documents added yet</div>
<div id="preview"><div class="label" id="pv-label"></div><div class="text" id="pv-text"></div></div>
<script>
${safeThreeSrc}
</script>
<script>
${safeOrbitControlsSrc}
</script>
<script>
(function () {
  var NODES = ${nodesJson};
  var MATCHED_IDS = ${matchedJson};
  var EDGES = ${edgesJson};
  var canvas = document.getElementById('canvas');
  var W = window.innerWidth, H = window.innerHeight;

  if (NODES.length === 0) {
    document.getElementById('empty').style.display = 'flex';
    return;
  }

  // ─── Scene setup ────────────────────────────────────────────
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 3000);
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(W, H);

  scene.add(new THREE.AmbientLight(0x40506a, 1.3));
  var keyLight = new THREE.PointLight(0xffffff, 1.3);
  keyLight.position.set(120, 160, 220);
  scene.add(keyLight);

  var LAYOUT_R = 300;
  var NODE_R = 14;

  function makeLabelSprite(text) {
    var short = text.length > 18 ? text.slice(0, 17) + '…' : text;
    var cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    var c2d = cv.getContext('2d');
    c2d.font = '28px Courier New, monospace';
    c2d.fillStyle = 'rgba(192, 192, 208, 1)';
    c2d.textAlign = 'center';
    c2d.textBaseline = 'middle';
    c2d.fillText(short, 128, 32);
    var texture = new THREE.CanvasTexture(cv);
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(48, 12, 1);
    return sprite;
  }

  // Fibonacci-sphere layout — simple, even 3D spread with a little jitter.
  // No real physics/relaxation needed for this many nodes.
  var meshes = [];
  var byId = {};
  var count = NODES.length;
  NODES.forEach(function (n, i) {
    var offset = 2 / count;
    var yPos = (i * offset - 1) + offset / 2;
    var ringR = Math.sqrt(Math.max(0, 1 - yPos * yPos));
    var phi = i * Math.PI * (3 - Math.sqrt(5)); // golden angle
    var radius = LAYOUT_R * (0.7 + Math.random() * 0.3);
    n.x = Math.cos(phi) * ringR * radius;
    n.y = yPos * radius;
    n.z = Math.sin(phi) * ringR * radius;

    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(NODE_R, 20, 20),
      new THREE.MeshStandardMaterial({
        color: 0x4a9eff, emissive: 0x000000, emissiveIntensity: 0,
        roughness: 0.55, metalness: 0.15,
      })
    );
    mesh.position.set(n.x, n.y, n.z);
    mesh.userData.nodeId = n.id;
    scene.add(mesh);
    meshes.push(mesh);
    byId[n.id] = mesh;

    var label = makeLabelSprite(n.label);
    label.position.set(n.x, n.y + NODE_R + 8, n.z);
    scene.add(label);
  });

  // ─── Ambient particle-flow edges ──────────────────────────────
  // Purely visual — derived once (RN side, from embedding similarity) and
  // built once here. Independent of fire(): always animating, never paused
  // or altered by the camera/glow sequence below.
  function makeGlowTexture() {
    var cv = document.createElement('canvas');
    cv.width = 32; cv.height = 32;
    var c2d = cv.getContext('2d');
    var grad = c2d.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(0, 255, 136, 1)');
    grad.addColorStop(0.4, 'rgba(0, 255, 136, 0.6)');
    grad.addColorStop(1, 'rgba(0, 255, 136, 0)');
    c2d.fillStyle = grad;
    c2d.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(cv);
  }

  var glowTexture = makeGlowTexture();
  var edgeParticles = [];

  EDGES.forEach(function (e) {
    var fromMesh = byId[e.a], toMesh = byId[e.b];
    if (!fromMesh || !toMesh) return; // defensive — shouldn't happen, edges only reference embedded nodes

    var lineGeometry = new THREE.BufferGeometry().setFromPoints([fromMesh.position, toMesh.position]);
    var line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({
      color: 0x4a9eff, transparent: true, opacity: 0.18,
    }));
    scene.add(line);

    var particle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    particle.scale.set(7, 7, 1);
    scene.add(particle);

    edgeParticles.push({
      sprite: particle,
      from: fromMesh.position,
      to: toMesh.position,
      t: Math.random(),               // stagger starting phase so particles don't all move in lockstep
      speed: 0.12 + Math.random() * 0.08, // loops/sec — modest, ambient
    });
  });

  camera.position.set(0, 0, LAYOUT_R * 2.2);

  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 60;
  controls.maxDistance = LAYOUT_R * 5;

  // ─── Tap-to-preview (raycast against node spheres) ───────────
  var raycaster = new THREE.Raycaster();
  var pointerVec = new THREE.Vector2();

  function nodeMeshAt(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    pointerVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerVec.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerVec, camera);
    var hits = raycaster.intersectObjects(meshes);
    return hits.length > 0 ? hits[0].object : null;
  }

  function showPreview(mesh) {
    var n = NODES.filter(function (x) { return x.id === mesh.userData.nodeId; })[0];
    if (!n) return;
    document.getElementById('pv-label').textContent = n.label;
    document.getElementById('pv-text').textContent = n.p || '(empty)';
    document.getElementById('preview').classList.add('visible');
  }

  function hidePreview() {
    document.getElementById('preview').classList.remove('visible');
  }

  // OrbitControls owns drag-to-rotate on this canvas — only treat a pointer
  // up as a "tap" (show preview) if it wasn't a drag.
  var pointerDownAt = null;
  canvas.addEventListener('pointerdown', function (e) {
    pointerDownAt = { x: e.clientX, y: e.clientY, t: Date.now() };
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!pointerDownAt) return;
    var moved = Math.hypot(e.clientX - pointerDownAt.x, e.clientY - pointerDownAt.y);
    var elapsed = Date.now() - pointerDownAt.t;
    pointerDownAt = null;
    if (moved > 6 || elapsed > 500) return;
    var hit = nodeMeshAt(e.clientX, e.clientY);
    if (hit) showPreview(hit); else hidePreview();
  });

  // ─── fire(): camera fly-to + node glow, queued so concurrent calls ────
  // sequence rather than fighting over the camera. Same external contract
  // as the old 2D pulse-ring version — just a rendering-layer swap.
  var TWEEN_MS = 1300;
  var fireQueue = [];
  var firing = false;

  function fire(nodeId) {
    var mesh = byId[nodeId];
    if (!mesh) return;
    fireQueue.push(nodeId);
    if (!firing) runNextFire();
  }

  function runNextFire() {
    var nodeId = fireQueue.shift();
    if (nodeId === undefined) { firing = false; return; }
    var mesh = byId[nodeId];
    if (!mesh) { runNextFire(); return; }
    firing = true;

    // Camera fly-to — ease toward centering on the node, keeping the
    // current viewing direction rather than snapping to a fixed angle.
    var startPos = camera.position.clone();
    var startTarget = controls.target.clone();
    var endTarget = mesh.position.clone();
    var dir = startPos.clone().sub(startTarget);
    if (dir.lengthSq() === 0) dir.set(0, 0, 1);
    dir.normalize();
    var endPos = endTarget.clone().add(dir.multiplyScalar(90));

    var camT0 = Date.now();
    function tweenCamera() {
      var t = Math.min(1, (Date.now() - camT0) / TWEEN_MS);
      var eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      camera.position.lerpVectors(startPos, endPos, eased);
      controls.target.lerpVectors(startTarget, endTarget, eased);
      controls.update();
      if (t < 1) requestAnimationFrame(tweenCamera);
    }
    tweenCamera();

    // Node glow — scale + emissive intensity pulse up then back down,
    // finishing alongside the camera tween before the next queued fire().
    var glowT0 = Date.now();
    function tweenGlow() {
      var t = Math.min(1, (Date.now() - glowT0) / TWEEN_MS);
      var pulse = Math.sin(t * Math.PI); // 0 → 1 → 0
      mesh.scale.setScalar(1 + pulse * 0.6);
      mesh.material.emissive.setHex(0x00ff88);
      mesh.material.emissiveIntensity = pulse * 1.4;
      if (t < 1) {
        requestAnimationFrame(tweenGlow);
      } else {
        mesh.scale.setScalar(1);
        mesh.material.emissiveIntensity = 0;
        runNextFire();
      }
    }
    tweenGlow();
  }

  var clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    var dt = clock.getDelta();

    // Ambient particle flow — independent of fire()'s camera/glow sequence.
    edgeParticles.forEach(function (p) {
      p.t += p.speed * dt;
      if (p.t > 1) p.t -= 1;
      p.sprite.position.lerpVectors(p.from, p.to, p.t);
    });

    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // Auto-pulse whatever the most recent chat answer drew on, staggered so
  // each fire() is distinguishable rather than all queuing at once.
  MATCHED_IDS.forEach(function (id, i) {
    setTimeout(function () { fire(id); }, 400 + i * 250);
  });
})();
</script>
</body>
</html>`;
}

export default function GraphScreen() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [threeSrc, setThreeSrc] = useState<string | null>(null);
  const [orbitControlsSrc, setOrbitControlsSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      getGraphNodes(),
      getLastContextNodes(),
      loadJsLibSource(threeAssetModule),
      loadJsLibSource(orbitControlsAssetModule),
    ])
      .then(([loadedNodes, lastMatched, threeLib, orbitLib]) => {
        // Computed once here, not per frame — the WebView just draws whatever list it's handed.
        const computedEdges = computeGraphEdges(loadedNodes);
        setNodes(loadedNodes);
        setMatchedIds(lastMatched);
        setEdges(computedEdges);
        setThreeSrc(threeLib);
        setOrbitControlsSrc(orbitLib);
      })
      .catch(e => {
        console.warn('[Graph] mount — load failed:', e instanceof Error ? e.message : e);
        setNodes([]);
        setMatchedIds([]);
        setEdges([]);
      })
      .finally(() => setLoaded(true));
  }, []);

  const ready = loaded && threeSrc !== null && orbitControlsSrc !== null;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color="#4a9eff" />
        </TouchableOpacity>
        <Text style={styles.title}>knowledge graph</Text>
        <Text style={styles.count}>{nodes.length}</Text>
      </View>
      {ready ? (
        <WebView
          style={styles.webview}
          originWhitelist={['*']}
          source={{ html: buildGraphHtml(nodes, matchedIds, edges, threeSrc!, orbitControlsSrc!) }}
          scrollEnabled={false}
          bounces={false}
          androidLayerType="hardware"
        />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color="#4a9eff" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#080d14' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2a',
  },
  backBtn: { padding: 4 },
  title: { fontFamily: FONT, fontSize: 14, fontWeight: '600', color: '#c0c0d0', letterSpacing: 1 },
  count: { fontFamily: FONT, fontSize: 11, color: '#556677', minWidth: 20, textAlign: 'right' },
  webview: { flex: 1, backgroundColor: '#080d14' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
