/** Choose one fully quoted market per researched event, after comparing alternatives.
 * Descriptive alignment is not calibrated probability or expected value.
 */
import type {MarketResearchReview} from './daily-market-evidence.ts'

export type DailyResearchedSelection={
  selected:MarketResearchReview[]
  eventChoices:number
  marketsReviewed:number
  alternativesCompared:number
  supportedLegs:number
  conditionalLegs:number
  completed:boolean
}

const eventIdentity=(r:MarketResearchReview)=>[
  r.candidate.sport,r.candidate.league,r.candidate.espnEventId,
].join('|')

const researchRank:Readonly<Record<MarketResearchReview['status'],number>>={
  'descriptive-support':3,uncertain:2,contraindicated:1,unavailable:0,
}
const compare=(a:MarketResearchReview,b:MarketResearchReview)=>{
  const ra=researchRank[a.status],rb=researchRank[b.status]
  return rb-ra||b.rankingScore-a.rankingScore||
    b.verifiedSources-a.verifiedSources||
    b.candidate.quoteUpdatedAt.localeCompare(a.candidate.quoteUpdatedAt)||
    a.candidate.market.localeCompare(b.candidate.market)||
    a.candidate.fixture.localeCompare(b.candidate.fixture)
}

/** Select the strongest descriptive, authentic market for each game.
 * @param reviews - Alternate real market offers reviewed against one dossier/event.
 * @param goal - Desired number of games, 4–6.
 * @returns A bounded, independently reviewable shortlist; never a winning guarantee.
 */
export function selectDailyResearchedMarkets(
  reviews:readonly MarketResearchReview[],goal=5,
):DailyResearchedSelection{
  if(!Number.isInteger(goal)||goal<4||goal>6)throw Error('Ticket diario de 4 a 6 patas')
  const books=new Set(reviews.map(review=>review.candidate.bookmaker))
  if(books.size>1)throw Error('No combinar casas diferentes en un solo ticket')
  const unique=new Map<string,MarketResearchReview[]>()
  for(const review of reviews){
    const key=eventIdentity(review),candidates=unique.get(key)??[]
    candidates.push(review);unique.set(key,candidates)
  }
  const best=[...unique.values()].map(rows=>[...rows].sort(compare)[0]!)
    .sort(compare)
  // Priority is supported evidence; a fresh sport can break a tie, but an
  // unsupported event must never outrank a better documented market.
  const selected:MarketResearchReview[]=[],remaining=[...best]
  while(selected.length<goal&&remaining.length){
    const bestCandidate=remaining[0]!
    const diversify=remaining.find(review=>
      compare(review,bestCandidate)===0&&
      !selected.some(x=>x.candidate.sport===review.candidate.sport))
    const chosen=diversify??bestCandidate
    remaining.splice(remaining.indexOf(chosen),1)
    selected.push(chosen)
  }
  const supportedLegs=selected.filter(r=>r.status==='descriptive-support').length
  return {
    selected,eventChoices:unique.size,marketsReviewed:reviews.length,
    alternativesCompared:Math.max(0,reviews.length-unique.size),
    supportedLegs,conditionalLegs:selected.length-supportedLegs,
    completed:selected.length>=goal&&supportedLegs>=goal,
  }
}
