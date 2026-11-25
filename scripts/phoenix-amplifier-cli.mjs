#!/usr/bin/env node
// Offline source-checkout entry point. No model, service or network required.
import {runAmplifier,AMPLIFIER_OPERATIONS} from '../packages/core/tool-living/src/amplifier.ts'
const operation=process.argv[2]
if(!AMPLIFIER_OPERATIONS.includes(operation)){
  console.error('Usage: node --experimental-strip-types scripts/phoenix-amplifier-cli.mjs <operation> < input.json')
  console.error('Operations: '+AMPLIFIER_OPERATIONS.join(', '))
  process.exitCode=2
}else{
  try{
    const chunks=[];let size=0
    for await(const chunk of process.stdin){
      const bytes=Buffer.from(chunk);size+=bytes.length
      if(size>32768)throw Error('AMPLIFIER_LIMIT')
      chunks.push(bytes)
    }
    console.log(JSON.stringify(runAmplifier(operation,Buffer.concat(chunks).toString('utf8')),null,2))
  }catch(error){console.error(error instanceof Error?error.message:'AMPLIFIER_FAILURE');process.exitCode=1}
}
