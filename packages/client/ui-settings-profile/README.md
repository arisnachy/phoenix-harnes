# @phoenix-ai/dsh-client-ui-settings-profile

English | [中文](README.zh.md)

Browser settings row for the local user profile. The row keeps drafts local until Save, exposes general profile fields and family entries, and requires independent consent before a field can be projected into model context by the Host profile service. Initial Host hydration is adopted before dirty-state comparison, so reopening Settings shows persisted values immediately; later Host refreshes preserve an actually edited local draft.

The row also edits KIRA's assistant name and masculine, feminine, or neutral presentation. The Models settings page owns the adjacent-arrow editor for provider order; it persists the order in the same local preference namespace so the conversation model selector receives it from the Host.

## Model Experience

### Profile settings row

#### What the model sees

Nothing from this browser-only plugin enters the model request; `UserProfileService` owns the consent-filtered model context.

#### Token effect

This package adds no model tokens because it only renders profile settings and keeps unsaved drafts in the browser.

#### KV Cache effect

This package does not assemble or send provider requests, so it does not affect provider prefix reuse.

## Known Limitations and Deferred Work

- The row requires the Host settings scope to be writable; read-only deployments can display status but cannot save profile changes.

## Real user avatar and optional image-to-image portrait

**Settings → Profile → My avatar** accepts genuine JPEG/PNG/WebP photographs up
to 8 MiB. The user can adjust zoom, horizontal and vertical crop and save a
normalized 512×512 JPEG without original metadata. The image lives as a Blob
in this browser's private IndexedDB, not in model-visible user profile
preferences or conversation messages. The selected image appears beside the
user's ordinary messages and Team messages and survives browser restart on
the same local profile. It is deliberately **not** synchronized across devices.

**Transform with AI** is an optional, real image-edit request, not a visual
filter. It requires an explicitly configured local OpenAI-compatible
`POST /images/edits` backend that accepts multipart image, prompt, model and
returns `data[0].b64_json`. Configure the base URL (for example,
`http://127.0.0.1:7860/v1`) and the actual editing model supported by your
local server. PHOENIX accepts only loopback HTTP targets. The user must
approve sending the photo in the editor checkbox before each action; without
an editor or a successful response, no styled image is claimed. If the local
service does not allow browser CORS requests, it must be configured to allow
the PHOENIX app origin. The original remains independently recoverable.

The human user's picture is never treated as an AI specialist, does not
inherit model badges, and can be restored or permanently removed from the
browser with the controls on the Profile page.
