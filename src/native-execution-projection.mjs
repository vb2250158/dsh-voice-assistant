const sensitive=/authorization|token|secret|password|api.?key|credential|cookie|headers?/i
/** Bound and redact details before exposing them in the local interface. */
export function safeExecutionValue(value) {
  let nodes=512,chars=16000
  const visit=(item,depth)=>{
    if(--nodes<0||chars<=0||depth>8)return '[已截断]'
    if(item===null||typeof item==='boolean')return item
    if(typeof item==='number')return Number.isFinite(item)?item:null
    if(typeof item==='string'){
      const text=item.slice(0,Math.min(4096,chars));chars-=text.length
      return text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi,'Bearer [已隐藏]').replace(/\bsk-[A-Za-z0-9_-]{16,}/g,'[已隐藏]').replace(/([?&](?:[^=&#\s]*(?:token|secret|password|api[_-]?key)[^=&#\s]*)=)[^&#\s"']*/gi,'$1[已隐藏]').replace(/\b((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;&"']+/gi,'$1[已隐藏]')+(text.length<item.length?'…[已截断]':'')
    }
    if(Array.isArray(item))return item.slice(0,64).map(entry=>visit(entry,depth+1))
    if(item&&typeof item==='object')return Object.fromEntries(Object.entries(item).slice(0,64).map(([key,entry])=>[key,sensitive.test(key)?'[已隐藏]':visit(entry,depth+1)]))
    return null
  }
  return visit(value,0)
}
const parseArgs=value=>{if(typeof value!=='string')return safeExecutionValue(value);try{return safeExecutionValue(JSON.parse(value))}catch{return safeExecutionValue(value)}}
const time=value=>Number.isFinite(value)&&Math.abs(value)<=8640000000000000?new Date(value).toISOString():undefined
const status=value=>value==='running'?'running':value==='error'?'failed':'completed'
/** Convert only loaded native trajectory facts to displayable execution steps. */
export function projectNativeExecution(snapshot,messageId) {
  const match=/^a:(\d+):(\d+)$/.exec(messageId)
  if(!match||!snapshot)return undefined
  const turn=Number(match[1]),throughStep=Number(match[2]),steps=[]
  if(!Number.isSafeInteger(turn)||!Number.isSafeInteger(throughStep))return undefined
  for(const request of snapshot.requests??[]){
    if(request.purpose!=='assistant'||request.turn!==turn||request.step>throughStep)continue
    steps.push({id:`model:${request.startSeq}`,kind:'model',name:'模型请求',status:status(request.status),
      ...(time(request.startedAt)?{startedAt:time(request.startedAt)}:{}),...(time(request.completedAt)?{endedAt:time(request.completedAt)}:{}),
      ...(request.requestConfig?{request:safeExecutionValue(request.requestConfig)}:{}),...(request.error?{error:safeExecutionValue(request.error)}:{}),_order:request.startSeq})
  }
  for(const result of snapshot.eventNodes??[]){
    if(result.kind!=='tool-result')continue
    const location=snapshot.eventLocations?.get(result.seq)
    if(location?.kind!=='step'||location.turn.turn!==turn||location.step.step>throughStep)continue
    steps.push({id:`tool:${result.callId}`,kind:'tool',name:result.name||'工具',status:result.isError?'failed':'completed',
      ...(time(result.callTime??result.time)?{startedAt:time(result.callTime??result.time)}:{}),...(time(result.time)?{endedAt:time(result.time)}:{}),
      ...(result.call?.argsRaw!==undefined?{arguments:parseArgs(result.call.argsRaw)}:{}),outcome:safeExecutionValue({content:result.content,isError:result.isError===true,...(result.error?{error:result.error}:{})}),
      ...(result.error?{error:safeExecutionValue(result.error)}:{}),_order:result.seq})
  }
  for(const call of snapshot.runningCalls??[]){
    if(call.turn!==turn||call.step>throughStep)continue
    steps.push({id:`tool:${call.callId}`,kind:'tool',name:call.name||'工具',status:'running',
      ...(time(call.time)?{startedAt:time(call.time)}:{}),...(call.argsRaw!==undefined?{arguments:parseArgs(call.argsRaw)}:{}),_order:Number.MAX_SAFE_INTEGER})
  }
  steps.sort((a,b)=>(a.startedAt||'').localeCompare(b.startedAt||'')||a._order-b._order)
  return {status:!steps.length?'uncertain':steps.some(step=>step.status==='running')?'running':steps.some(step=>step.status==='failed')?'failed':'completed',steps:steps.map(({_order,...step})=>step),...(!steps.length?{error:'当前加载范围未包含执行记录。'}:{})}
}
/** Current call only; its arguments and outcome stay in the details view. */
export function projectNativeActivity(snapshot) {
  const call=snapshot?.runningCalls?.filter(item=>item.phase==='start').at(-1)
  if(!call){
    const request=snapshot?.requests?.findLast(item=>item.purpose==='assistant'&&item.status==='running'&&Number.isSafeInteger(item.turn)&&Number.isSafeInteger(item.step))
    return request?{status:'thinking',responseId:`a:${request.turn}:${request.step}`}:undefined
  }
  if(!Number.isSafeInteger(call.turn)||!Number.isSafeInteger(call.step))return undefined
  const args=call.argsRaw===undefined?undefined:parseArgs(call.argsRaw)
  const operation=args&&typeof args==='object'&&!Array.isArray(args)&&typeof args.operation==='string'?args.operation.slice(0,120):undefined
  return {status:'executing-tool',responseId:`a:${call.turn}:${call.step}`,tool:{callId:String(call.callId),name:call.name||'工具',...(operation?{operation}:{})}}
}
