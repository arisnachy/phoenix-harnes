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
  /** All selected legs belong to exactly one source bookmaker. */
  selectedBookmaker:string|null
}

const eventIdentity=(r:MarketResearchReview)=>[
  r.candidate.sport,r.candidate.league,r.candidate.espnEventId,
].join('|')

const researchRank:Readonly<Record<MarketResearchReview['status'],number>>={
  'descriptive-support':3,uncertain:2,contraindicated:1,unavailable:0,
}
const valueRank=(r:MarketResearchReview):number=>
  r.priceAudit?.classification==='potential-value'?4:
    r.priceAudit?.classification==='uncertain-value'?2:
      r.priceAudit?.classification==='negative-value'?0:1
const effectiveResearchRank=(r:MarketResearchReview):number=>
  r.priceAudit?.classification==='negative-value'?0:researchRank[r.status]
const compare=(a:MarketResearchReview,b:MarketResearchReview)=>{
  const ra=effectiveResearchRank(a),rb=effectiveResearchRank(b)
  // For equally evidenced moneyline picks, prefer the less fragile priced side.
  // This is relative bookmaker confidence, not a validated predictive edge.
  const aShare=a.selectedOutcome?.noVigShare,bShare=b.selectedOutcome?.noVigShare
  const winnerStrength=a.candidate.market==='h2h'&&b.candidate.market==='h2h'
    &&typeof aShare==='number'&&Number.isFinite(aShare)
    &&typeof bShare==='number'&&Number.isFinite(bShare)
      ?bShare-aShare:0
  return rb-ra||valueRank(b)-valueRank(a)||winnerStrength||
    b.rankingScore-a.rankingScore||
    b.verifiedSources-a.verifiedSources||
    (b.candidate.observedAt??b.candidate.quoteUpdatedAt).localeCompare(
      a.candidate.observedAt??a.candidate.quoteUpdatedAt)||
    a.candidate.market.localeCompare(b.candidate.market)||
    a.candidate.fixture.localeCompare(b.candidate.fixture)
}

/** Select the strongest descriptive, authentic market for each game.
 * @param reviews - Alternate real market offers reviewed against one dossier/event.
 * @param goal - Desired number of games, 5–6.
 * @returns A bounded, independently reviewable shortlist; never a winning guarantee.
 */
export function selectDailyResearchedMarkets(
  reviews:readonly MarketResearchReview[],goal=5,
):DailyResearchedSelection{
  if(!Number.isInteger(goal)||goal<5||goal>6)throw Error('Ticket diario de 5 a 6 patas')
  // Block outright contraindications, absent research and negative-value
  // prices BEFORE ranking. Only "uncertain" can enter a conditional draft.
  const eligible=reviews.filter(review=>
    (review.status==='descriptive-support'||review.status==='uncertain')&&
    review.priceAudit?.classification!=='negative-value')
  // Auxiliary providers may quote different houses; that is NOT a reason to
  // discard the independent successful ESPN slate. Never mix bookstores:
  // choose the single house with the most independently supported events,
  // then replenish from the next researched event in THAT house.
  const byBook=new Map<string,MarketResearchReview[]>()
  for(const review of eligible){
    const book=review.candidate.bookmaker.trim()
    if(!book)continue
    byBook.set(book,[...(byBook.get(book)??[]),review])
  }
  const perBook=[...byBook.entries()].map(([book,rows])=>{
    const unique=new Map<string,MarketResearchReview[]>()
    for(const review of rows){
      const key=eventIdentity(review),options=unique.get(key)??[]
      options.push(review);unique.set(key,options)
    }
    const best=[...unique.values()].map(options=>[...options].sort(compare)[0]!)
      .sort(compare)
    const supported=best.filter(row=>row.status==='descriptive-support').length
    return{book,unique,best,supported}
  }).sort((a,b)=>
    Math.min(goal,b.supported)-Math.min(goal,a.supported)||
    Math.min(goal,b.best.length)-Math.min(goal,a.best.length)||
    (a.best[0]&&b.best[0]?compare(a.best[0],b.best[0]):0)||
    a.book.localeCompare(b.book))
  const chosenBook=perBook[0]??null
  const unique=chosenBook?.unique??new Map<string,MarketResearchReview[]>()
  const best=chosenBook?.best??[]
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
  const supportedLegs=selected.filter(r=>r.status==='descriptive-support'&&
    r.priceAudit?.classification!=='negative-value').length
  return {
    selected,eventChoices:unique.size,marketsReviewed:reviews.length,
    alternativesCompared:Math.max(0,reviews.length-unique.size),
    supportedLegs,conditionalLegs:selected.length-supportedLegs,
    completed:selected.length>=goal&&supportedLegs>=goal,
    selectedBookmaker:chosenBook?.book??null,
  }
}
