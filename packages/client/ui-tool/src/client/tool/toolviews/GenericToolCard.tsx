// GenericToolCard: the default tool row — classifies the tool into a visual
// variant and renders the summary row. Supplied by the Tool call tree as the
// keyed atomic-view slot's render-site fallback (an
// unregistered tool name lands here); registrants may also compose it as a
// base, feeding the same owner payload through.

import type { ReactNode } from 'react'
import {
  IconApiOutline14, IconBrowseOutline16, IconCodeOutline16, IconEditOutline16, IconSearchOutline16, IconSparkle16,
} from '@phoenix-ai/dsh-client-ui-primitives'
import type { ToolCallOwnerProps, ToolTreeProps } from '../../contract/slots.ts'
import { readCardModel } from '../models/read-card-model.ts'
import { diffCardModel } from '../models/diff-card-model.ts'
import { searchCardModel } from '../models/search-card-model.ts'
import { terminalCardModel, terminalFailed } from '../models/terminal-card-model.ts'
import { webCardModel } from '../models/web-card-model.ts'
import { toolRowModel, type ToolRowVariant } from '../models/tool-call-model.ts'
import { ToolRow } from '../components/ToolRow.tsx'

/** Variant leading icons (figma table); all glyphs render at 14 inside the 16px leading box. */
const VARIANT_ICONS: Record<ToolRowVariant, ReactNode> = {
  search: <IconSearchOutline16 size={14} />,
  read: <IconBrowseOutline16 size={14} />,
  bash: <IconApiOutline14 size={14} />,
  write: <IconEditOutline16 size={14} />,
  edit: <IconEditOutline16 size={14} />,
  code: <IconCodeOutline16 size={14} />,
  others: <IconSparkle16 size={14} />,
}

/** Card props: owner payload plus render-site services kept as plain props. */
export interface GenericToolCardProps extends ToolCallOwnerProps {
  t: ToolTreeProps['t']
  /** Project durable result-image blocks through the authorized attachment renderer. */
  renderMessageImages: ToolTreeProps['renderMessageImages']
}

export function GenericToolCard({
  toolName, block, cwd, home, openFile, inspect, t, renderMessageImages,
}: GenericToolCardProps) {
  const model = toolRowModel(toolName, block, cwd, home)
  const terminal = terminalCardModel(block, cwd)
  const read = readCardModel(block, cwd, home)
  const diff = diffCardModel(block)
  const search = searchCardModel(block)
  const web = webCardModel(block)
  // Tool result image blocks carry durable attachment refs, not browser URLs.
  // Reuse the conversation attachment renderer so authorization, loading,
  // gallery behavior, and URL lifecycle remain owned by ui-attachment.
  const images = 'kind' in block
    ? block.content.flatMap(content => content.type === 'image'
      ? [{ attachment: content.attachment }]
      : [])
    : []
  // A failing exit status is the terminal card's own error signal (the call
  // itself settles isError:false), surfaced as the row's red state dot.
  const state = model.state === 'ok' && terminal !== null && terminalFailed(terminal)
    ? 'error'
    : model.state
  const singleFile = model.filePath !== undefined
  return (
    <>
      <ToolRow
        t={t}
        variant={model.variant}
        toolName={toolName}
        icon={VARIANT_ICONS[model.variant]}
        title={model.title}
        // A terminal presenter's description is the contract's above-card text, so
        // it outranks the args-derived summary here exactly as it does in BashRow;
        // a search result view's replacement title outranks it the same way.
        summary={terminal?.description ?? search?.title ?? model.summary}
        // Single-file tools never expose an args body — the path link is the only
        // args interaction. A card is not an args body: a read/write/edit row is
        // single-file AND carries a card, so the card expands under the path link.
        body={singleFile ? null : model.body}
        output={model.output}
        errorSummary={model.errorSummary}
        terminal={terminal}
        diff={diff}
        read={read}
        search={search}
        web={web}
        state={state}
        filePath={model.filePath}
        onOpenFile={singleFile ? openFile : undefined}
        inspect={inspect}
      />
      {images.length > 0 ? renderMessageImages({ images, align: 'start' }) : null}
    </>
  )
}
