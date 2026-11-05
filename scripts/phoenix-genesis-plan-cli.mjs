#!/usr/bin/env node
/**
 * Read a Genesis OrganizationSpec JSON from a local file or stdin (-) and
 * print a proposal. Does not call models, inspect networks or deploy agents.
 */
import { readFileSync } from 'node:fs'
import { planGenesisFabric } from './phoenix-genesis-fabric.mjs'

try {
  const args=process.argv.slice(2)
  if(args.length!==1||args[0]==='--help'){
    process.stdout.write('Uso: node scripts/phoenix-genesis-plan-cli.mjs <organization.json | ->\n')
    process.exitCode=args[0]==='--help'?0:2
  }else{
    const file=args[0]==='-'?0:args[0]
    const source=readFileSync(file,{encoding:'utf8'})
    if(source.length>1024*1024)throw new Error('Archivo demasiado grande')
    const input=JSON.parse(source)
    const proposal=planGenesisFabric(input)
    process.stdout.write(JSON.stringify(proposal,null,2)+'\n')
  }
}catch(error){
  process.stderr.write('Genesis: '+(error instanceof Error?error.message:'Entrada inválida')+'\n')
  process.exitCode=1
}
