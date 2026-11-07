import { ResidentSettingsSchema, validateResidentSettings } from './resident-settings.mjs'
/** Native persistence owns values. Reads remain repairable; writes validate the merged configuration first. */
export function createSettingsStore(service, namespace, readConfig) {
  if (typeof readConfig !== 'function') throw Error('ASSISTANT_LIVE_CONFIG_REQUIRED')
  let closed=false,chain=Promise.resolve()
  const descriptor=()=>{
    const row=service.describe({redactSecrets:true}).find(row=>row.ns===namespace)
    if(!row)throw Error('ASSISTANT_SETTINGS_UNAVAILABLE')
    return row
  }
  // Loader Config is available during apply; Settings descriptors require an ACTIVE fiber.
  const read=()=>ResidentSettingsSchema(readConfig())
  return {read,save(patch){
    const result=chain.then(async()=>{
      if(closed)throw Error('ASSISTANT_CLOSED')
      const current=descriptor(),before=ResidentSettingsSchema(current.value)
      if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!(key in before)))throw Error('ASSISTANT_SETTINGS_INVALID')
      validateResidentSettings({...before,...patch})
      await service.update(namespace,patch,current.revision)
    })
    chain=result.catch(()=>{})
    return result
  },async close(){closed=true;await chain}}
}
