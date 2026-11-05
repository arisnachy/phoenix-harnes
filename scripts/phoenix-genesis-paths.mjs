/**
 * Durable PHOENIX Genesis/Fabric data location independent of updater
 * runtime folders. Override with PHOENIX_GENESIS_DB / PHOENIX_FABRIC_DB.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export function phoenixInstitutionDataDir(){
  if(process.env.PHOENIX_INSTITUTION_DATA_HOME)
    return process.env.PHOENIX_INSTITUTION_DATA_HOME
  if(process.platform==='win32'&&process.env.LOCALAPPDATA)
    return join(process.env.LOCALAPPDATA,'PHOENIX','institution')
  return join(homedir(),'.phoenix','institution')
}
export function genesisDatabasePath(){
  return process.env.PHOENIX_GENESIS_DB||
    join(phoenixInstitutionDataDir(),'genesis.sqlite')
}
export function fabricDatabasePath(){
  return process.env.PHOENIX_FABRIC_DB||
    join(phoenixInstitutionDataDir(),'fabric.sqlite')
}
