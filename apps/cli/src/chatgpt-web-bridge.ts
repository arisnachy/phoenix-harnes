/** CLI facade over the shared Host-owned ChatGPT Web lifecycle. */
export {
  ChatGptWebBridge,
  DEFAULT_CHATGPT_WEB_URL,
  chatGptWebBridgeStatePath,
  discoverChatGptWebRuntime,
  inspectChatGptWebHealth,
  parseChatGptWebCommand,
  resolveChatGptWebConfig,
  runChatGptWebBridge,
} from '@phoenix-ai/dsh-host-plugin-inventory/chatgpt-web'
export type {
  ChatGptWebBridgeConfig,
  ChatGptWebBridgeState,
  ChatGptWebBridgeStatus,
} from '@phoenix-ai/dsh-host-plugin-inventory/chatgpt-web'
