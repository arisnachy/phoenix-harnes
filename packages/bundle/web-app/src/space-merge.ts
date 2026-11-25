/** Three-way merging of bounded library drafts. Never guesses a conflict resolution. */
export interface MergeDraft {title:string;content:string;space:string}
type Sheet={columns:string[];rows:string[][]}
function sheet(raw:string):Sheet|null{
  try{
    const x=JSON.parse(raw) as Sheet
    if(!x||!Array.isArray(x.columns)||x.columns.length<1||x.columns.length>40||!x.columns.every(v=>typeof v==='string')||
      !Array.isArray(x.rows)||x.rows.length>1000||!x.rows.every(row=>Array.isArray(row)&&row.length===x.columns.length&&row.every(v=>typeof v==='string')))return null
    if(Object.keys(x).some(k=>k!=='columns'&&k!=='rows'))return null
    return x
  }catch{return null}
}
export function mergeLibraryDraft(base:MergeDraft,current:MergeDraft,proposed:MergeDraft,kind:string):MergeDraft{
  const pick=(before:string,now:string,next:string):string=>{
    if(now===next||next===before)return now
    if(now===before)return next
    throw Error('CONFLICT')
  }
  let content:string
  try{content=pick(base.content,current.content,proposed.content)}
  catch(error){
    if(kind!=='sheet')throw error
    const a=sheet(base.content),b=sheet(current.content),c=sheet(proposed.content)
    if(!a||!b||!c||a.rows.length!==b.rows.length||a.rows.length!==c.rows.length||
      JSON.stringify(a.columns)!==JSON.stringify(b.columns)||JSON.stringify(a.columns)!==JSON.stringify(c.columns))throw Error('CONFLICT')
    content=JSON.stringify({columns:a.columns,rows:a.rows.map((row,i)=>row.map((value,j)=>pick(value,b.rows[i]![j]!,c.rows[i]![j]!)))})
  }
  return {title:pick(base.title,current.title,proposed.title),space:pick(base.space,current.space,proposed.space),content}
}
