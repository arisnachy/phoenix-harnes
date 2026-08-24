/** Localized copy for the private user-profile settings row. */

export const zh = {
  title: '用户资料', description: '资料保存在 PHOENIX 本地，并逐项决定哪些内容可以进入模型上下文。',
  expand: '展开用户资料', collapse: '收起用户资料', personalization: '启用个性化', personalizationHint: '关闭后保留资料和权限，但不会向任何模型注入资料。',
  fullName: '全名', fullNameHint: '你的完整姓名。', preferredName: '首选称呼', preferredNameHint: '希望 PHOENIX 日常如何称呼你。',
  dateOfBirth: '出生日期', dateOfBirthHint: '只保存日期；模型只接收计算后的年龄。', sex: '生理 / 行政性别', sexHint: '独立字段，不从姓名、代词或性别认同推断。',
  gender: '性别认同', genderHint: '可选，独立于生理性别。', pronouns: '代词', pronounsHint: '可选。', formOfAddress: '称谓 / 称呼方式', formOfAddressHint: '例如 Dr.、Professor 或其他偏好称谓。',
  profession: '职业', professionHint: '你的职业或主要专业角色。', locale: '语言 / Locale', localeHint: '例如 es-DO、en-US。', timezone: '时区', timezoneHint: '例如 America/Santo_Domingo。',
  responsePreferences: '回复偏好', responsePreferencesHint: '希望 PHOENIX 如何组织、详细化或格式化回答。', tone: '偏好语气', toneHint: '例如温暖、直接或正式。',
  family: '家庭资料', familyHint: '每行一项，格式为“关系 | 称呼”。不会自动推断家庭成员。', consent: '允许进入模型上下文',
  consentFullName: '全名', consentName: '首选称呼', consentAge: '年龄（由出生日期计算）', consentSex: '生理 / 行政性别', consentGender: '性别认同', consentPronouns: '代词', consentFormOfAddress: '称谓 / 称呼方式', consentProfession: '职业', consentLocale: '语言 / Locale', consentTimezone: '时区', consentResponsePreferences: '回复偏好', consentTone: '偏好语气', consentFamily: '家庭资料',
  save: '保存资料', saving: '保存中…', discard: '放弃修改', clear: '删除全部资料', unsaved: '有未保存的修改', readOnly: '此部署以只读方式保存设置。', saveFailed: '设置未接受这些值，请检查后重试。', invalid: '请修正此字段后再保存。',
  privacy: '资料不会附加到网页搜索、工具调用或外部连接器；只有启用个性化且逐项授权的字段才进入模型系统上下文。',
} satisfies Record<string, string>

export type UserProfileLocaleKey = keyof typeof zh

export const en = {
  title: 'User profile', description: 'Keep identity and preferences local to PHOENIX and decide field by field what may enter model context.',
  expand: 'Show user profile', collapse: 'Hide user profile', personalization: 'Enable personalization', personalizationHint: 'When off, stored data and permissions remain but no profile context is injected into any model.',
  fullName: 'Full name', fullNameHint: 'Your complete name.', preferredName: 'Preferred name', preferredNameHint: 'How PHOENIX should normally address you.',
  dateOfBirth: 'Date of birth', dateOfBirthHint: 'Only the date is stored; models receive only the derived age when allowed.', sex: 'Sex', sexHint: 'Explicit field; never inferred from name, pronouns, or gender identity.',
  gender: 'Gender identity', genderHint: 'Optional and independent from sex.', pronouns: 'Pronouns', pronounsHint: 'Optional.', formOfAddress: 'Form of address / title', formOfAddressHint: 'For example Dr., Professor, or another preferred title.',
  profession: 'Profession', professionHint: 'Your profession or primary professional role.', locale: 'Language / locale', localeHint: 'For example es-DO or en-US.', timezone: 'Timezone', timezoneHint: 'For example America/Santo_Domingo.',
  responsePreferences: 'Response preferences', responsePreferencesHint: 'How PHOENIX should organize, detail, or format responses.', tone: 'Preferred tone', toneHint: 'For example warm, direct, or formal.',
  family: 'Family details', familyHint: 'One entry per line as “relationship | name”. Family members are never inferred.', consent: 'Allow in model context',
  consentFullName: 'Full name', consentName: 'Preferred name', consentAge: 'Age (derived from date of birth)', consentSex: 'Sex', consentGender: 'Gender identity', consentPronouns: 'Pronouns', consentFormOfAddress: 'Form of address / title', consentProfession: 'Profession', consentLocale: 'Language / locale', consentTimezone: 'Timezone', consentResponsePreferences: 'Response preferences', consentTone: 'Preferred tone', consentFamily: 'Family details',
  save: 'Save profile', saving: 'Saving…', discard: 'Discard changes', clear: 'Delete all profile data', unsaved: 'Unsaved changes', readOnly: 'This deployment stores settings read-only.', saveFailed: 'The settings did not accept these values. Check them and retry.', invalid: 'Correct this field before saving.',
  privacy: 'Profile data is never appended to web searches, tool calls, or external connectors; only explicitly allowed fields enter model system context while personalization is enabled.',
} satisfies Record<UserProfileLocaleKey, string>

export const es = {
  title: 'Perfil del usuario', description: 'Guarda tu identidad y preferencias dentro de PHOENIX y decide campo por campo qué puede entrar al contexto del modelo.',
  expand: 'Mostrar perfil del usuario', collapse: 'Ocultar perfil del usuario', personalization: 'Activar personalización', personalizationHint: 'Al desactivarla, los datos y permisos se conservan, pero ningún modelo recibe contexto del perfil.',
  fullName: 'Nombre completo', fullNameHint: 'Tu nombre completo.', preferredName: 'Nombre preferido', preferredNameHint: 'Cómo quieres que PHOENIX te llame normalmente.',
  dateOfBirth: 'Fecha de nacimiento', dateOfBirthHint: 'Solo se guarda la fecha; al modelo se entrega únicamente la edad calculada cuando la autorizas.', sex: 'Sexo', sexHint: 'Campo explícito e independiente; nunca se deduce del nombre, los pronombres ni la identidad de género.',
  gender: 'Identidad de género', genderHint: 'Opcional e independiente del sexo.', pronouns: 'Pronombres', pronounsHint: 'Opcional.', formOfAddress: 'Tratamiento / título', formOfAddressHint: 'Por ejemplo Dr., Profesor u otro tratamiento que prefieras.',
  profession: 'Profesión', professionHint: 'Tu profesión o rol profesional principal.', locale: 'Idioma / locale', localeHint: 'Por ejemplo es-DO o en-US.', timezone: 'Zona horaria', timezoneHint: 'Por ejemplo America/Santo_Domingo.',
  responsePreferences: 'Preferencias de respuesta', responsePreferencesHint: 'Cómo quieres que PHOENIX organice, detalle o formatee las respuestas.', tone: 'Tono preferido', toneHint: 'Por ejemplo cálido, directo o formal.',
  family: 'Datos familiares', familyHint: 'Una persona por línea: “relación | nombre”. Nunca se infieren familiares.', consent: 'Permitir en el contexto del modelo',
  consentFullName: 'Nombre completo', consentName: 'Nombre preferido', consentAge: 'Edad (calculada desde la fecha de nacimiento)', consentSex: 'Sexo', consentGender: 'Identidad de género', consentPronouns: 'Pronombres', consentFormOfAddress: 'Tratamiento / título', consentProfession: 'Profesión', consentLocale: 'Idioma / locale', consentTimezone: 'Zona horaria', consentResponsePreferences: 'Preferencias de respuesta', consentTone: 'Tono preferido', consentFamily: 'Datos familiares',
  save: 'Guardar perfil', saving: 'Guardando…', discard: 'Descartar cambios', clear: 'Borrar todos los datos del perfil', unsaved: 'Cambios sin guardar', readOnly: 'Esta implementación guarda los ajustes en modo solo lectura.', saveFailed: 'Los ajustes no aceptaron estos valores. Revísalos y vuelve a intentarlo.', invalid: 'Corrige este campo antes de guardar.',
  privacy: 'Los datos del perfil no se adjuntan a búsquedas web, llamadas de herramientas ni conectores externos; solo los campos autorizados entran al contexto del modelo cuando la personalización está activa.',
} satisfies Record<UserProfileLocaleKey, string>
