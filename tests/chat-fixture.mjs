export function chatFixture() {
  let snapshot={order:[],nodes:new Map()}
  const listeners=new Set()
  const source={getSnapshot:()=>snapshot,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn)}}
  return {
    conversation:{binding(){return {target(name){if(name!=='chat')throw Error(name);return source}}}},
    replace(nodes){snapshot={order:nodes.map(n=>n.key),nodes:new Map(nodes.map(n=>[n.key,n]))};for(const fn of listeners)fn()},
  }
}
export const reply=(key,text)=>({key,kind:'assistant-step',visibility:'visible',data:{status:'running',blocks:[{kind:'text',text}]}})
