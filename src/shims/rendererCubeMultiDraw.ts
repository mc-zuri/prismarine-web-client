import { drawCubeSpans as drawCubeSpansUpstream } from 'minecraft-renderer/src/three/cubeMultiDraw'

export * from 'minecraft-renderer/src/three/cubeMultiDraw'

// minecraft-renderer 0.1.99 leaves these arrays at 64 entries even though
// culling can produce more disjoint spans. WebGL rejects the entire multi-draw
// when drawCount exceeds an argument array's length, hiding all shader cubes.
export function drawCubeSpans (...args: Parameters<typeof drawCubeSpansUpstream>) {
  const [, caps, spans, scratch] = args
  if (caps.tier === 'A' && spans.length > scratch.counts.length) {
    const capacity = Math.max(spans.length, scratch.counts.length * 2)
    scratch.firsts = new Int32Array(capacity)
    scratch.counts = new Int32Array(capacity)
    scratch.instanceCounts = new Int32Array(capacity)
    scratch.baseInstances = new Int32Array(capacity)
  }
  return drawCubeSpansUpstream(...args)
}
