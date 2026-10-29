import { defineTool, type ToolDefinition } from '@phoenix-ai/dsh-tools'

/** Dedicated MIME used to route Phoenix canvases into the chat conversation. */
export const PHOENIX_CANVAS_MIME = 'application/vnd.phoenix.canvas+html'

/**
 * Create Phoenix's model-facing interactive canvas artifact.
 *
 * A Phoenix canvas is an HTML mini-app or visual composition that must be
 * presented inside Phoenix itself. It is deliberately distinct from editor-
 * specific ".canvas.tsx" files or Cursor/Codex canvas folders.
 * @returns Tool definition for self-contained, in-chat HTML experiences.
 */
export function createPhoenixCanvasTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_canvas',
    description: 'For a user request to CREATE a web page, landing page, website, HTML site, portfolio, or frontend UI, use phoenix_canvas and render the WEBSITE in the web preview, NEVER phoenix_geo_map or phoenix_scene_map (those are for geographic/narrative MAPS only). Create an inline HTML mini-app only when the user explicitly requests an HTML experience, an interactive app, web page, canvas application or mockup. NEVER use phoenix_canvas for an ordinary chart (line, bar, pie, time series) or data dashboard, nor to fake an interactive 3D model with a static image; use phoenix_3d for orbitable geometry or spatially useful 3D product/showroom/interior scenes in apps; ordinary UI stays in phoenix_canvas: prefer phoenix_visualize for structured charts, because external JS/CSS CDNs are blocked by the iframe security policy and may show an empty screen. A simple fictional chart is one phoenix_visualize call with chartType:line and demo:true. For assistant-generated clinical scales, choose native declarative generative-ui instead of this HTML tool when possible: a fenced JSON object with component=scale_form, version=1, props={title,items:[{id,question,options:[{label,score}]}],bands:[{max,label,tone}]}; score choices must be distinct and real clinical instruments need validated scoring sources. For editable spreadsheet replies, prefer native component=spreadsheet, version=1, props={id,title,columns:[string],rows:[[string]]}; formula cells may use =B2*C2 or =SUM(D2:D5). CSV import/export exists, but do not claim full XLSX support. Native interactions never trigger an LLM round trip. If the HTML refers to generated images (including exec-*.png) then supply their actual base64 bytes OR an authorized attachment reference in files keyed by relative filenames, e.g. files:{hero.png:{attachment:{attachmentId,mediaType,bytes,width,height}}}; a filename or separate image output alone does NOT make an image visible in the page. Use accessible HTTPS image URLs only when appropriate. NEVER claim a local preview URL is a publicly deployed website. The canvas renders directly inside Phoenix, inside the chat conversation with automatic height; do not open a side workspace or editor file and do not create a Cursor/Codex .canvas.tsx file. For a preview, demo, form, scale or local calculator, delivery completes the request: all subsequent interactions and calculations run inside the HTML with local JavaScript, without model calls. Do not spawn teammates, reopen QA, browse or audit the canvas after delivery. Set continueAfterDisplay=true ONLY if the user explicitly requested additional work after presenting it.',
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'Short user-facing canvas title.',
      },
      html: {
        type: 'string',
        required: true,
        description: 'Complete HTML or an HTML fragment for the canvas. Inline CSS and JavaScript are supported inside the sandbox.',
      },
      files: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional self-contained bundle: relative image paths (PNG/JPEG/GIF/WebP) mapped to base64 bytes, {base64,mime}, or {attachment:{attachmentId,mediaType,bytes,width,height}} for an existing generated image; optional relative CSS paths mapped to CSS text. HTML entry always comes from html as index.html. Without bytes, local image filenames cannot render.',
      },
      interactive: {
        type: 'boolean',
        description: 'Whether inline JavaScript controls should run. Defaults to true.',
      },
      continueAfterDisplay: {
        type: 'boolean',
        description: 'Default false: finish the turn after showing a self-contained canvas. Set true only if the user explicitly requested separate work after presentation (for example, saving or deploying it).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          artifactId: { type: 'string', required: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Canvas ready in Phoenix: ${value.title}`,
      }],
      presentationMeta: (args, value) => ({
        artifact: {
          id: value.artifactId,
          mime: PHOENIX_CANVAS_MIME,
          title: value.title,
          data: args.files === undefined ? args.html : {
            entry: 'index.html',
            files: { ...(args.files as Record<string, unknown>), 'index.html': args.html },
          },
          executable: args.interactive !== false,
        },
      }),
    },
    execute(args, exec) {
      const title = args.title.trim()
      if (title.length === 0) throw new Error('title must be a non-empty string')
      if (args.html.trim().length === 0) throw new Error('html must be a non-empty string')
      if (args.files !== undefined) {
        const values = args.files as Record<string, unknown>
        const entries = Object.entries(values)
        if (entries.length > 64 || JSON.stringify(values).length > 24 * 1024 * 1024
          || entries.some(([name]) => name.startsWith('/') || name.includes('..') || name.includes('\\\\')))
          throw new Error('files must be a bounded bundle of relative asset paths')
      }
      // Do not claim publication when a generated image exists only as a
      // filename. srcDoc cannot resolve arbitrary workspace paths.
      const bundled = args.files === undefined ? {} : args.files as Record<string, unknown>
      const imageRefs = [...args.html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/giu)]
        .map(match => match[2] ?? '')
      const missing = imageRefs.filter(reference => {
        if (/^(?:data:image\/|blob:|https?:\/\/|\/\/)/iu.test(reference)) return false
        const path = reference.split(/[?#]/u, 1)[0]!.replace(/^\/+/u, '').replace(/^\.\//u, '')
        return path !== '' && bundled[path] === undefined && bundled['./' + path] === undefined
      })
      if (missing.length > 0) {
        throw new Error('HTML tiene imágenes locales sin datos: ' + missing.slice(0, 5).join(', ')
          + '. Adjunta el archivo mediante files[path]={attachment:{attachmentId,mediaType,bytes,width,height}} '
          + 'o base64. No se publicó una página incompleta.')
      }
      // Stop the model loop after a self-contained preview: the renderer owns later interactions.
      // Explicitly requested follow-up work may opt out without affecting ordinary delivery.
      if (args.continueAfterDisplay !== true) exec.concludeTurn()
      return Promise.resolve({
        artifactId: `phoenix-canvas:${String(exec.callId)}`,
        title,
      })
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Canvas · ${args.title}`,
        kind: 'read',
        rawInput: 'Phoenix inline chat canvas',
      }
    },
  })
}
