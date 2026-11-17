import { validateVisualCanvas } from '@rabilink/assistant-runtime/canvas'

/** Reconstruct message canvases from actual successful native tool calls. */
export function projectCanvasHistory(snapshot) {
  const messages=new Map()
  for(const result of snapshot?.eventNodes??[]){
    if(result.kind!=='tool-result'||result.name!=='assistant_canvas'||result.isError||typeof result.call?.argsRaw!=='string')continue
    const location=snapshot.eventLocations?.get(result.seq)
    if(location?.kind!=='step')continue
    try {
      const args=JSON.parse(result.call.argsRaw)
      if(args.action!=='show')continue
      const document=validateVisualCanvas(args.document),id=`a:${location.turn.turn}:${location.step.step}`
      messages.set(id,{document,persistent:args.persistent===true,visible:true,responseId:id})
    } catch { /* Malformed historical calls cannot become canvas documents. */ }
  }
  return messages
}
