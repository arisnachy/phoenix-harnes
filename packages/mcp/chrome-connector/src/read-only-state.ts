/**
 * Runs independent browser, Vault and layout reads together for one selected
 * tab. Callers still resolve the tab and its current URL before using these
 * helpers; no browser or authentication state is cached here.
 */

/**
 * Read the DOM and Vault metadata concurrently.
 * @param readDom - Read-only CDP operation for the selected tab.
 * @param readVault - Read-only Phoenix Vault query for the selected tab URL.
 * @returns Both observations after the slower read completes.
 */
export async function readPageSources<T, V>(
  readDom: () => Promise<T>,
  readVault: () => Promise<V>,
): Promise<{ dom: T; vault: V }> {
  const [dom, vault] = await Promise.all([readDom(), readVault()])
  return { dom, vault }
}

/**
 * Read the DOM, Vault metadata and secret-free layout hint concurrently.
 * @param readDom - Read-only CDP inspection for the selected tab.
 * @param readVault - Read-only Phoenix Vault query for the selected tab URL.
 * @param readLayout - Read-only layout lookup for the current page route.
 * @returns All observations after the slower read completes.
 */
export async function readInspectPageSources<T, V, L>(
  readDom: () => Promise<T>,
  readVault: () => Promise<V>,
  readLayout: () => Promise<L>,
): Promise<{ dom: T; vault: V; layout: L }> {
  const [dom, vault, layout] = await Promise.all([readDom(), readVault(), readLayout()])
  return { dom, vault, layout }
}
