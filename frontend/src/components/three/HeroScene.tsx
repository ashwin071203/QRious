"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

/** Deterministic PRNG so rendering stays pure (same constellation every render). */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A slowly rotating constellation of people (nodes) and connections (lines) in the QRious violet palette. */
function Network() {
  const group = useRef<THREE.Group>(null);
  const { positions, lines, colors } = useMemo(() => {
    const rand = mulberry32(2026);
    const n = 90;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const r = 2.2 + rand() * 1.4;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      pts.push(new THREE.Vector3(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi)));
    }
    const pos = new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z]));
    const col = new Float32Array(pts.flatMap(() => {
      const c = new THREE.Color(rand() > 0.7 ? "#E879F9" : rand() > 0.4 ? "#A78BFA" : "#C4B5FD");
      return [c.r, c.g, c.b];
    }));
    const seg: number[] = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (pts[i]!.distanceTo(pts[j]!) < 1.15) seg.push(pts[i]!.x, pts[i]!.y, pts[i]!.z, pts[j]!.x, pts[j]!.y, pts[j]!.z);
    return { positions: pos, colors: col, lines: new Float32Array(seg) };
  }, []);

  useFrame((state, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * 0.08;
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, state.pointer.y * 0.25, 0.05);
    group.current.rotation.z = THREE.MathUtils.lerp(group.current.rotation.z, -state.pointer.x * 0.15, 0.05);
  });

  return (
    <group ref={group}>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.09} vertexColors sizeAttenuation transparent opacity={0.95} />
      </points>
      <lineSegments>
        <bufferGeometry><bufferAttribute attach="attributes-position" args={[lines, 3]} /></bufferGeometry>
        <lineBasicMaterial color="#8B5CF6" transparent opacity={0.28} />
      </lineSegments>
      <mesh>
        <sphereGeometry args={[1.05, 48, 48]} />
        <meshBasicMaterial color="#8B5CF6" transparent opacity={0.08} />
      </mesh>
    </group>
  );
}

export default function HeroScene() {
  return (
    <Canvas camera={{ position: [0, 0, 7], fov: 50 }} dpr={[1, 1.75]} gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}>
      <Network />
    </Canvas>
  );
}
