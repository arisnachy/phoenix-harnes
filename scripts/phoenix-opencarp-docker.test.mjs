import test from 'node:test'
import assert from 'node:assert/strict'
import {OPENCARP_DOCKER_IMAGE,installOpenCarpDocker,probeOpenCarpDocker}
 from './phoenix-opencarp-docker.mjs'
const digest='sha256:'+'a'.repeat(64)
test('uses only the official registry and verifies real local solver execution',async()=>{
 const args=[]
 const run=async (argv)=>{
  args.push(argv)
  if(argv[0]==='image')return {stdout:digest+'\\n'}
  return {stdout:'ok'}
 }
 const result=await installOpenCarpDocker(run)
 assert.equal(result.status,'installed')
 assert.equal(result.imageId,digest)
 assert.deepEqual(args[0],['info','--format','{{.ServerVersion}}'])
 assert.deepEqual(args[1],['pull',OPENCARP_DOCKER_IMAGE])
 assert.deepEqual(args.at(-1),['run','--rm','--network','none','--entrypoint','openCARP',digest,'-buildinfo'])
})
test('does not install Docker Desktop silently or mark missing daemon installed',async()=>{
 const steps=[]
 const result=await installOpenCarpDocker(async argv=>{
  steps.push(argv)
  throw Error('daemon not running')
 })
 assert.equal(result.status,'deferred')
 assert.match(result.reason,/Docker Desktop/)
 assert.equal(steps.length,1)
})
test('rejects spoofed image identifiers and unverified solver',async()=>{
 const run=async args=>args[0]==='image'?{stdout:'../../fake'}:{stdout:'ok'}
 assert.equal(await probeOpenCarpDocker(run),null)
 const noSolver=async args=>{
  if(args[0]==='run')throw Error('missing binary')
  return args[0]==='image'?{stdout:digest}:{stdout:'ok'}
 }
 assert.equal(await probeOpenCarpDocker(noSolver),null)
})
