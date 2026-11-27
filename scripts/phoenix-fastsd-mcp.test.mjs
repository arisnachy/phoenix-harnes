import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeImage, FASTSD_MODEL, FASTSD_SIZE, generationRequest, imageRoot, fastsdRoot, legacyFastsdRoot, legacyCacheCandidates, diagnosticText, run, hasMigrationCandidate } from './phoenix-fastsd-mcp.mjs'

test('FLUX.2 Klein OpenVINO is a dedicated, fixed local image route', () => {
  const body = generationRequest('A detailed medical textbook diagram')
  assert.equal(FASTSD_MODEL, 'rupeshs/flux2-klein-4b-int4-ov')
  assert.equal(FASTSD_SIZE, 512)
  assert.equal(body.openvino_lcm_model_id, FASTSD_MODEL)
  assert.equal(body.use_openvino, true)
  assert.equal(body.diffusion_task, 'text_to_image')
  assert.equal(body.use_lcm_lora, false)
  assert.equal(body.number_of_images, 1)
  assert.equal(body.guidance_scale, 1)
  assert.equal(body.inference_steps, 4)
  assert.equal(body.image_width, 512)
  assert.equal(body.image_height, 512)
  assert.equal(body.use_seed, false)
  assert.ok(!JSON.stringify(body).includes('ollama'))
  assert.ok(imageRoot().length > 2)
  assert.ok(fastsdRoot().length > 2)
})

test('generation parameters reject empty, oversized and noninteger arguments', () => {
  assert.throws(() => generationRequest('   '), /Describe/)
  assert.throws(() => generationRequest('a'.repeat(3001)), /Describe/)
  assert.throws(() => generationRequest('valid', { seed: -1 }), /semilla/)
  assert.throws(() => generationRequest('valid', { seed: 1.5 }), /semilla/)
  assert.throws(() => generationRequest('valid', { negative_prompt: 'x'.repeat(1001) }), /negativo/)
  assert.deepEqual(generationRequest(' Hello ', { seed: 42 }).seed, 42)
  assert.equal(generationRequest(' Hello ', { seed: 42 }).use_seed, true)
  assert.equal(generationRequest(' Hello ').prompt, 'Hello')
})

test('only bounded base64 JPEG is accepted, never arbitrary tool-output bytes', () => {
  const bytes = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(50), Buffer.from([0xff, 0xd9])])
  assert.deepEqual(decodeImage(bytes.toString('base64')), bytes)
  assert.throws(() => decodeImage('not base64!!!'), /codificada/)
  assert.throws(() => decodeImage(Buffer.alloc(50).toString('base64')), /JPEG/)
  assert.throws(() => decodeImage(Buffer.from([0xff,0xd8,0xff,0xd9]).toString('base64')), /JPEG/)
})

test('migration isolates the new runtime and scopes cleanup to exact legacy weights', () => {
  assert.equal(fastsdRoot(), legacyFastsdRoot() + '-flux2')
  const paths = legacyCacheCandidates('/user', '/phoenix/fastsdcpu', {})
  assert.equal(paths.length, 3)
  assert.ok(paths.every(path => path.endsWith('models--rupeshs--sd-turbo-openvino')))
  assert.equal(legacyCacheCandidates('/user', '/phoenix/fastsdcpu', { HF_HUB_CACHE: '/shared' }).length, 2)
})

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('setup failure preserves useful stderr and redacts credential URLs', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'console.error("Missing dependency https://user:secret@example.invalid/wheel"); process.exit(1)'], process.cwd(), 5000), error => {
    assert.match(error.message, /código 1/)
    assert.match(error.message, /Missing dependency/)
    assert.doesNotMatch(error.message, /secret/)
    return true
  })
  assert.equal(diagnosticText('token=secret'), '[credencial oculta]')
})

test('partial legacy or FLUX directories are candidates without a ready marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-flux-repair-'))
  try {
    const legacy = join(root, 'legacy'), current = join(root, 'current')
    assert.equal(hasMigrationCandidate(legacy, current), false)
    mkdirSync(current)
    assert.equal(hasMigrationCandidate(legacy, current), true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
