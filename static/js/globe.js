// fetchX 3D Globe — fixed background, fails gracefully
(function() {
  const container = document.getElementById('globe-container');
  if (!container || typeof THREE === 'undefined') return;

  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 2.8;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    function resize() {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    // Globe dots
    const dotGeo = new THREE.BufferGeometry();
    const dotCount = 2000;
    const positions = new Float32Array(dotCount * 3);
    const radius = 1;

    for (let i = 0; i < dotCount; i++) {
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = 2 * Math.PI * Math.random();
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
    }
    dotGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    scene.add(new THREE.Points(dotGeo, new THREE.PointsMaterial({
      color: 0xFFD700, size: 0.012, transparent: true, opacity: 0.5, sizeAttenuation: true,
    })));

    // Wireframe
    const wireGeo = new THREE.SphereGeometry(radius, 36, 18);
    scene.add(new THREE.Mesh(wireGeo, new THREE.MeshBasicMaterial({
      color: 0xFFD700, wireframe: true, transparent: true, opacity: 0.04,
    })));

    // Arcs
    const cities = [
      [40.7,-74],[51.5,-0.1],[35.7,139.7],[-33.9,151.2],[48.9,2.35],
      [37.6,126.9],[19.4,-99.1],[-23.5,-46.6],[28.6,77.2],[1.35,103.8],[55.75,37.6],[39.9,116.4],
    ];
    function ll2v(lat,lon,r){const p=(90-lat)*Math.PI/180,t=(lon+180)*Math.PI/180;return new THREE.Vector3(-r*Math.sin(p)*Math.cos(t),r*Math.cos(p),r*Math.sin(p)*Math.sin(t));}
    const arcGroup = new THREE.Group();
    [[0,1],[1,5],[5,11],[11,9],[9,3],[0,6],[6,7],[2,4],[4,10],[10,8],[8,9],[1,4],[3,2]].forEach(([a,b])=>{
      if(!cities[a]||!cities[b])return;
      const s=ll2v(cities[a][0],cities[a][1],radius),e=ll2v(cities[b][0],cities[b][1],radius);
      const m=new THREE.Vector3().addVectors(s,e).multiplyScalar(0.5);
      m.normalize().multiplyScalar(radius+s.distanceTo(e)*0.3);
      const pts=new THREE.QuadraticBezierCurve3(s,m,e).getPoints(40);
      arcGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0xFFD700,transparent:true,opacity:0.2})));
    });
    scene.add(arcGroup);

    // Glow
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(radius*1.15,32,32),new THREE.MeshBasicMaterial({color:0xFFD700,transparent:true,opacity:0.03,side:THREE.BackSide})));

    function animate(){requestAnimationFrame(animate);scene.rotation.y+=0.001;renderer.render(scene,camera);}
    animate();
  } catch(e) {
    // Globe failed silently — page still works
    console.warn('Globe failed:', e);
  }
})();
