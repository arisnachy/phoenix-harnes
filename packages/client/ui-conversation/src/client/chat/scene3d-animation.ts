import type { Scene3D, Scene3DAnimation, Scene3DNode } from './Scene3DView.tsx'

/** Sample declarative animation without user-provided scripts or remote resources. */
export function poseScene3D(scene: Scene3D, clip: Scene3DAnimation, elapsed: number): Scene3D {
  const time = clip.loop ? ((elapsed % clip.duration) + clip.duration) % clip.duration
    : Math.max(0, Math.min(clip.duration, elapsed))
  const changes = new Map<string, Partial<Scene3DNode>>()
  for (const track of clip.tracks) {
    const keys = track.keys
    const first = keys[0], last = keys[keys.length - 1]
    if (first === undefined || last === undefined) continue
    let before = first, after = last
    if (time <= first.time) after = first
    else if (time >= last.time) before = last
    else for (let i = 1; i < keys.length; i++) {
      const next = keys[i]!
      if (time <= next.time) {
        before = keys[i - 1]!
        after = next
        break
      }
    }
    const span = after.time - before.time
    const blend = span <= 0 ? 0 : (time - before.time) / span
    const value: [number,number,number] = [
      before.value[0] + (after.value[0] - before.value[0]) * blend,
      before.value[1] + (after.value[1] - before.value[1]) * blend,
      before.value[2] + (after.value[2] - before.value[2]) * blend,
    ]
    changes.set(track.node, { ...changes.get(track.node), [track.property]: value })
  }
  if (changes.size === 0) return scene
  return { ...scene, nodes: scene.nodes.map(node =>
    node.name !== undefined && changes.has(node.name)
      ? { ...node, ...changes.get(node.name) } : node) }
}
