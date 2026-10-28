/**
 * Deterministic presentation of Kira's structured sports tool results.
 * The model may still write prose, but cannot accidentally discard a proven
 * match/MLB comparison/ticket card by omitting a generative-ui fence.
 *
 * This is a DISPLAY adapter. It never calls providers or places a wager.
 * It does not derive facts from unstructured prose, screenshots, or search.
 */
import {parseGenerativeUiBlock, splitGenerativeUiText, type GenerativeUiBlock} from './GenerativeUi.tsx'

type ResultBlock = {
  kind?: unknown
  call?: {name?: string} | null
  content?: readonly {type?: string; text?: string}[]
  isError?: boolean
  subCalls?: readonly ResultBlock[]
}
const ALLOWED_NAMES = new Set([
  'sports_chat_games','sports_chat_odds','sports_chat_ticket','sports_chat_ticket_research',
  'sports_chat_mlb_pitchers',
  'sports_chat_ticket_evidence_auto','sports_chat_ticket_evidence_priced_auto',
  'sports_chat_odds_keyless',
])
const ALLOWED_COMPONENTS = new Set([
  'sports_game_card','sports_schedule_card','sports_ticket_card','sports_odds_card','comparison','smart_card',
])
const MAX_TEXT_BYTES = 125_000
const MAX_SPORTS_CARDS = 6
const MAX_NODES = 64

/** Distinguish a validated first-party sports card from arbitrary model JSON. */
function verifiedCard(value: unknown): GenerativeUiBlock | null {
  const card=parseGenerativeUiBlock(value)
  return card!==null && ALLOWED_COMPONENTS.has(card.component) ? card : null
}
/**
 * Read only first-party sports tools, including settled Code Mode nested calls.
 * @param root - A tool-result tree from a durable transcript.
 * @returns Cards with schema validation, no executable content.
 */
export function sportsCardsFromToolResult(root: unknown): GenerativeUiBlock[] {
  if(root===null||typeof root!=='object')return []
  const stack:[ResultBlock,number][]=[[root as ResultBlock,0]]
  const cards:GenerativeUiBlock[]=[]
  let visited=0
  while(stack.length&&visited<MAX_NODES&&cards.length<MAX_SPORTS_CARDS){
    const next=stack.pop()
    if(!next)break
    const [tool,depth]=next
    visited++
    if(depth<6&&Array.isArray(tool.subCalls)){
      for(const child of [...tool.subCalls].slice(0,24).reverse()){
        if(child&&typeof child==='object')stack.push([child,depth+1])
      }
    }
    if(tool.kind!=='tool-result'||!ALLOWED_NAMES.has(tool.call?.name??''))continue
    if(tool.isError)continue
    const data=Array.isArray(tool.content)?tool.content:[]
    const text=data.filter(b=>b.type==='text'&&typeof b.text==='string').map(b=>b.text).join('')
    if(text.length>MAX_TEXT_BYTES||text.length<2)continue
    let parsed:unknown
    try{parsed=JSON.parse(text)}catch{continue}
    if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))continue
    const result=parsed as Record<string,unknown>
    // Expected native output: uiBlock or uiBlocks, not model-invented prose.
    const values=Array.isArray(result.uiBlocks)?result.uiBlocks.slice(0,MAX_SPORTS_CARDS)
      :result.uiBlock===undefined?[]:[result.uiBlock]
    for(const value of values){
      const card=verifiedCard(value)
      if(card!==null&&cards.length<MAX_SPORTS_CARDS)cards.push(card)
    }
  }
  return cards
}
/**
 * Remove exact duplicates authored by the assistant and duplicates across
 * repeated tool calls. Existing valid cards remain visible in their own prose.
 * @param cards - Only first-party cards validated on the client.
 * @param assistantTexts - Public text blocks in the final assistant step.
 * @returns Stable, bounded cards not already rendered from assistant prose.
 */
export function unrenderedSportsCards(
  cards:readonly GenerativeUiBlock[],assistantTexts:readonly string[],
): GenerativeUiBlock[]{
  const present=new Set<string>()
  for(const text of assistantTexts){
    for(const part of splitGenerativeUiText(text)){
      if(part.kind==='ui')present.add(JSON.stringify(part.block))
    }
  }
  const added=new Set<string>(),output:GenerativeUiBlock[]=[]
  for(const card of cards){
    if(output.length>=MAX_SPORTS_CARDS)break
    const signature=JSON.stringify(card)
    if(present.has(signature)||added.has(signature))continue
    added.add(signature);output.push(card)
  }
  return output
}
