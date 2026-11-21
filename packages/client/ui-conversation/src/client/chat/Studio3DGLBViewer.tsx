import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

interface Studio3DGLBViewerProps {
  readonly modelUrl: string
  readonly title: string
  readonly onError?: () => void
}

const viewerStyle: CSSProperties = {
  overflow: 'hidden',
  border: '1px solid rgba(148, 163, 184, .35)',
  borderRadius: 12,
  background: '#0c141c',
  color: '#f1f5f9',
}

const buttonStyle: CSSProperties = {
  minHeight: 40,
  padding: '8px 14px',
  border: '1px solid rgba(148, 163, 184, .55)',
  borderRadius: 8,
  color: 'inherit',
  background: 'rgba(15, 23, 42, .9)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
}

function disposeObject(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>()
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (mesh.geometry !== undefined) mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material === undefined ? [] : [mesh.material]
    for (const material of materials) {
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) textures.add(value)
      }
      material.dispose()
    }
  })
  for (const texture of textures) texture.dispose()
}

/**
 * Displays a self-contained GLB on demand, keeping all WebGL work behind the
 * explicit open action. The viewer renders only after a camera or model change.
 */
export function Studio3DGLBViewer({ modelUrl, title, onError }: Studio3DGLBViewerProps) {
  const viewerId = `phoenix-studio3d-viewer-${useId().replaceAll(':', '')}`
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const onErrorRef = useRef(onError)
  const fitRef = useRef<() => void>(() => undefined)
  const resetRef = useRef<() => void>(() => undefined)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [problem, setProblem] = useState<string | undefined>(undefined)
  onErrorRef.current = onError

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (canvas === null || host === null) return

    let active = true
    let frame: number | undefined
    let loadedModel: THREE.Object3D | undefined
    let renderer: THREE.WebGLRenderer | undefined
    let controls: OrbitControls | undefined
    let resizeObserver: ResizeObserver | undefined
    let scene: THREE.Scene | undefined
    let camera: THREE.PerspectiveCamera | undefined

    const requestRender = () => {
      if (!active || renderer === undefined || scene === undefined || camera === undefined || frame !== undefined) return
      frame = window.requestAnimationFrame(() => {
        frame = undefined
        if (active && renderer !== undefined && scene !== undefined && camera !== undefined) renderer.render(scene, camera)
      })
    }

    const resize = () => {
      if (!active || renderer === undefined || camera === undefined) return
      const width = Math.max(host.clientWidth, 1)
      const height = Math.max(host.clientHeight, 1)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      requestRender()
    }

    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.05

      scene = new THREE.Scene()
      scene.background = new THREE.Color('#0c141c')
      camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000)
      // Blender exports commonly face -Z; this quarter view keeps the front visible.
      camera.position.set(2.8, 1.7, -3.6)

      scene.add(new THREE.HemisphereLight(0xdbeafe, 0x172033, 2.2))
      const keyLight = new THREE.DirectionalLight(0xffffff, 3)
      keyLight.position.set(4, 6, 5)
      scene.add(keyLight)
      const fillLight = new THREE.DirectionalLight(0x93c5fd, 1.4)
      fillLight.position.set(-4, 2, -3)
      scene.add(fillLight)
      scene.add(new THREE.GridHelper(12, 24, 0x334155, 0x1e293b))

      controls = new OrbitControls(camera, canvas)
      controls.enableDamping = false
      controls.screenSpacePanning = true
      controls.minDistance = 0.05
      controls.maxDistance = 1000
      controls.addEventListener('change', requestRender)
      controls.target.set(0, 0, 0)
      controls.update()

      const fitModel = () => {
        if (!active || loadedModel === undefined || camera === undefined || controls === undefined) return
        const bounds = new THREE.Box3().setFromObject(loadedModel)
        if (bounds.isEmpty()) return
        const center = bounds.getCenter(new THREE.Vector3())
        loadedModel.position.sub(center)
        const centeredBounds = new THREE.Box3().setFromObject(loadedModel)
        const sphere = centeredBounds.getBoundingSphere(new THREE.Sphere())
        const radius = Math.max(sphere.radius, 0.1)
        const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2)
        const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * camera.aspect)
        const distance = radius / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov)) * 1.15
        const direction = camera.position.clone().sub(controls.target)
        if (direction.lengthSq() === 0) direction.set(0.82, 0.48, -1)
        camera.position.copy(direction.normalize().multiplyScalar(distance))
        camera.near = Math.max(radius / 1000, 0.001)
        camera.far = Math.max(radius * 40, 100)
        camera.updateProjectionMatrix()
        controls.target.set(0, 0, 0)
        controls.minDistance = radius * 0.15
        controls.maxDistance = Math.max(radius * 20, distance)
        controls.update()
        requestRender()
      }
      const homePosition = new THREE.Vector3()
      const homeTarget = new THREE.Vector3()
      const resetView = () => {
        if (!active || camera === undefined || controls === undefined || loadedModel === undefined) return
        if (homePosition.lengthSq() === 0) {
          fitModel()
          homePosition.copy(camera.position)
          homeTarget.copy(controls.target)
          return
        }
        camera.position.copy(homePosition)
        controls.target.copy(homeTarget)
        camera.lookAt(controls.target)
        controls.update()
        requestRender()
      }
      fitRef.current = fitModel
      resetRef.current = resetView

      resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resize)
      if (resizeObserver !== undefined) resizeObserver.observe(host)
      else window.addEventListener('resize', resize)
      resize()

      // A published Blender GLB embeds its resources. The loader can also
      // resolve external URI fields, which this preview does not need.
      const manager = new THREE.LoadingManager()
      manager.setURLModifier((url) => {
        if (url === modelUrl || url.startsWith('blob:') || url.startsWith('data:')) return url
        throw new Error('El GLB incluye recursos externos')
      })
      const loader = new GLTFLoader(manager)
      loader.load(modelUrl, (gltf) => {
        if (!active || scene === undefined) {
          disposeObject(gltf.scene)
          return
        }
        loadedModel = gltf.scene
        scene.add(loadedModel)
        fitRef.current()
        if (camera !== undefined && controls !== undefined) {
          homePosition.copy(camera.position)
          homeTarget.copy(controls.target)
        }
        setStatus('ready')
        requestRender()
      }, undefined, (error: unknown) => {
        if (!active) return
        const detail = error instanceof Error && error.message.length > 0 ? ` (${error.message})` : ''
        setProblem(`No se pudo abrir el modelo GLB${detail}`)
        setStatus('error')
        onErrorRef.current?.()
        requestRender()
      })
    } catch (error: unknown) {
      const detail = error instanceof Error && error.message.length > 0 ? ` (${error.message})` : ''
      setProblem(`Este dispositivo no pudo iniciar el visor 3D${detail}`)
      setStatus('error')
      onErrorRef.current?.()
    }

    return () => {
      active = false
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      if (resizeObserver === undefined) window.removeEventListener('resize', resize)
      controls?.removeEventListener('change', requestRender)
      controls?.dispose()
      if (scene !== undefined) disposeObject(scene)
      else if (loadedModel !== undefined) disposeObject(loadedModel)
      renderer?.dispose()
      fitRef.current = () => undefined
      resetRef.current = () => undefined
    }
  }, [modelUrl])

  return <section aria-label={`Visor 3D: ${title}`} style={viewerStyle}>
    <div ref={hostRef} id={viewerId} style={{ position: 'relative', height: 'min(62vw, 520px)', minHeight: 320 }}>
      <canvas ref={canvasRef} aria-label={`Modelo 3D: ${title}`} role="img" style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }} />
      {status === 'loading' && <p role="status" style={{ position: 'absolute', inset: '50% auto auto 50%', transform: 'translate(-50%, -50%)', margin: 0 }}>Cargando modelo 3D…</p>}
      {status === 'error' && <p role="alert" style={{ position: 'absolute', inset: '50% 12px auto', transform: 'translateY(-50%)', margin: 0, textAlign: 'center' }}>{problem}</p>}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: 10 }}>
      <button type="button" style={buttonStyle} onClick={() => resetRef.current()} disabled={status !== 'ready'}>Restablecer vista</button>
      <button type="button" style={buttonStyle} onClick={() => fitRef.current()} disabled={status !== 'ready'}>Ajustar modelo</button>
      <span style={{ marginInlineStart: 'auto', opacity: .7, fontSize: 12 }}>Arrastra para girar · botón derecho o dos dedos para desplazar · rueda o pellizco para acercar</span>
    </div>
  </section>
}
