import { z } from 'zod'
import { createVisualCanvas, createVisualCanvasTools, validateVisualCanvas } from '@rabilink/assistant-runtime/canvas'

const eventType = 'dsh-voice-assistant/canvas'
const canvasSchema = z.object({ revision:z.number().int().nonnegative(), visible:z.boolean(), persistent:z.boolean(), document:z.unknown().nullable(), responseId:z.string().nullable() }).strict().superRefine((value, context) => {
  if (value.visible && value.document === null) context.addIssue({code:'custom',message:'Visible canvas requires a document'})
  if (value.document !== null) { try { validateVisualCanvas(value.document) } catch { context.addIssue({code:'custom',message:'Invalid canvas document'}) } }
})

/** Current canvas is recovered solely from the native Session log. */
export const canvasProjection = {
  key:'voiceAssistantCanvas', stateVersion:1,
  stateSchema:z.object({ value:canvasSchema.nullable() }),
  init:()=>({value:null}),
  apply(state,event) { return event.type===eventType ? {value:canvasSchema.parse(event.data)} : state },
}

const convertSchema = node => {
  if (Array.isArray(node.type)) return {oneOf:node.type.map(type=>convertSchema({...node,type}))}
  const type=node.type ?? (node.enum?.every(value=>typeof value==='string')?'string':undefined)
  if (type==='object') return {type,additionalProperties:node.additionalProperties===true,properties:Object.fromEntries(Object.entries(node.properties??{}).map(([key,value])=>[key,{...convertSchema(value),...(node.required?.includes(key)?{required:true}:{})}]))}
  if (type==='array') return {type,...(node.items?{items:convertSchema(node.items)}:{})}
  if (!['string','number','integer','boolean','null'].includes(type)) return {type:'json'}
  return {type,...(node.enum?{enum:node.enum}:{}),...(node.description?{description:node.description}:{})}
}

/** Attach one shared canvas and native tool to the owning agent. */
export function installNativeCanvas({agent, projection, defineTool, currentPosition, onChange}) {
  const session=agent.session
  const initial=projection.readerFor(session)().value
  const canvas=createVisualCanvas({initial,onSave:value=>session.append(eventType,value,{ignorable:true}),onChange})
  const protocol=createVisualCanvasTools(canvas,{owner:currentPosition})
  const tool=protocol.tools[0].function,converted=convertSchema(tool.parameters)
  const offPrompt=agent.ctx.systemPrompt.section({name:'tool:assistant-canvas',order:210,interpolate:false,text:protocol.instructions})
  let offTool
  try {
    offTool=agent.ctx.tools.register(defineTool({name:tool.name,description:tool.description,parameters:converted.properties,
      output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
      execute:async(args,exec)=>{if(exec.agent?.id!==agent.id)throw Error('ASSISTANT_CANVAS_OWNER_MISMATCH');exec.signal.throwIfAborted();return protocol.executeTool({arguments:args})},
    }))
  } catch(error) { offPrompt(); throw error }
  return {canvas,dispose(){offTool();offPrompt()}}
}
