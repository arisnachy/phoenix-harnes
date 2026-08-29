# @phoenix-ai/dsh-client-ui-settings-profile

English | [中文](README.zh.md)

Browser settings row for the local user profile. The row keeps drafts local until Save, exposes general profile fields and family entries, and requires independent consent before a field can be projected into model context by the Host profile service.

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
