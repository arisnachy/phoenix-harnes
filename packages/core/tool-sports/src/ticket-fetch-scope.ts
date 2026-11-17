/** Give all HTTP reads in one ticket operation a shared cancellation signal.
 * @param fetcher - Transport used by the ticket's providers.
 * @returns A fetch wrapper and an abort function for the outer ticket deadline.
 */
export function createTicketFetchScope(fetcher:typeof fetch=fetch):{
  fetcher:typeof fetch
  abort:()=>void
}{
  const controller=new AbortController()
  return {
    fetcher:(input,init)=>fetcher(input,{
      ...init,
      signal:init?.signal?AbortSignal.any([init.signal,controller.signal]):
        controller.signal,
    }),
    abort:()=>controller.abort(),
  }
}
