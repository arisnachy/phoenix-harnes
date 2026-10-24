/** Recovery map for publisher-verified embedded web applications.
 * @param rawUrl - Raw url supplied to this operation.
 * @returns The result produced by this operation.
 */
export function fullSiteForEmbeddedPage(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || url.hostname !== 'deportes.juancitosport.com.do'
      || !/^\/BOSSWagering\/Sportsbook(?:\/|$)/iu.test(url.pathname)) return undefined
    return 'https://www.juancitosport.com.do/deportes/'
  } catch { return undefined }
}
