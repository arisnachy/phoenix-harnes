import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeImage, FASTSD_MODEL, FASTSD_SIZE, generationRequest, imageRoot, fastsdRoot } from './phoenix-fastsd-mcp.mjs'

test('SD Turbo OpenVINO is a dedicated, fixed local image route', () => {
  const body = generationRequest('A detailed medical textbook diagram')
  assert.equal(FASTSD_MODEL, 'rupeshs/sd-turbo-openvino')
  assert.equal(FASTSD_SIZE, 512)
  assert.equal(body.openvino_lcm_model_id, FASTSD_MODEL)
  assert.equal(body.use_openvino, true)
  assert.equal(body.diffusion_task, 'text_to_image')
  assert.equal(body.use_lcm_lora, false)
  assert.equal(body.number_of_images, 1)
  assert.equal(body.guidance_scale, 1)
  assert.equal(body.inference_steps, 1)
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
