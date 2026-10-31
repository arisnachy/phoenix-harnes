/** Cultural-neutral visual classification; works for any provider-supplied occasion label. */
export type MomentKind = 'personal' | 'patriotic' | 'public' | 'cultural' | 'solemn'
export interface VisualMoment { readonly label: string; readonly kind: MomentKind }
export type MomentTheme =
  | 'halloween' | 'winter' | 'birthday' | 'patriotic' | 'solemn' | 'love' | 'nature'
  | 'lunar' | 'lights' | 'spring' | 'harvest' | 'water' | 'spiritual' | 'heritage'
  | 'music' | 'health' | 'education' | 'science' | 'family' | 'peace' | 'sports'
  | 'community' | 'newyear' | 'festival' | 'general'

interface VisualRule { readonly theme: MomentTheme; readonly icon: string; readonly pattern: RegExp }
/** Recognize meaning across common scripts; unmatched occasions still get varied generic motifs. */
const RULES: readonly VisualRule[] = [
  { theme: 'halloween', icon: '🎃', pattern: /halloween|día de muertos|day of the dead|samha[ií]n|萬聖|万圣|할로윈/iu },
  { theme: 'winter', icon: '🎄', pattern: /navidad|nochebuena|christmas|no[eë]l|weihnacht|natale|рождеств|聖誕|圣诞|크리스마스/iu },
  { theme: 'lunar', icon: '🧧', pattern: /lunar new year|chinese new year|tet\b|tết|seollal|spring festival|春节|春節|설날|元旦祭/iu },
  { theme: 'lights', icon: '🪔', pattern: /diwali|deepavali|dipavali|hanukkah|chanukah|חנוכה|दिवाली|दीपावली|灯节|燈節|lantern|farol|luces/iu },
  { theme: 'spring', icon: '🌸', pattern: /hanami|sakura|holi\b|nowruz|norouz|navruz|equinox|primavera|spring|花見|花祭|عید نوروز/iu },
  { theme: 'harvest', icon: '🌾', pattern: /harvest|cosecha|thanksgiving|acción de gracias|pongal|onam|chuseok|추석|mid.autumn|中秋|trung thu/iu },
  { theme: 'water', icon: '💦', pattern: /songkran|loy krathong|water festival|festival de agua|เทศกาลสงกรานต์|สงกรานต์/iu },
  { theme: 'spiritual', icon: '🪷', pattern: /ramadan|ramadán|eid|fitr|adha|vesak|vesakh|buddha|pascua|easter|passover|pesaj|pesach|yom kippur|sukkot|purim|navratri|mawlid|vesaka|رمضان|عيد|ईद|佛誕|卫塞|復活祭/iu },
  { theme: 'heritage', icon: '🎎', pattern: /carnaval|carnival|karneval|mardi gras|heritage|patrimonio|cultura|cultural|tradici[oó]n|tradition|intangible|heritage day|文化|festival folkl[oó]rico/iu },
  { theme: 'music', icon: '🎶', pattern: /música|music|jazz|dance|baile|tanz|concert|música|音楽|音樂|음악/iu },
  { theme: 'health', icon: '🩺', pattern: /salud|health|medicin|enfermer|nurs|cáncer|cancer|mental health|wellness|sanidad|gesundheit|健康|保健/iu },
  { theme: 'education', icon: '📚', pattern: /educaci[oó]n|education|maestro|teacher|universit|literacy|alfabetizaci[oó]n|escuela|school|biblioteca|book day|libro|教育|教师|教師/iu },
  { theme: 'science', icon: '🔬', pattern: /ciencia|science|technolog|tecnolog|innovaci[oó]n|engineering|ingenier|astronom|exploraci[oó]n|科学|科技/iu },
  { theme: 'family', icon: '💐', pattern: /madres|mothers|mère|materna|padres|fathers|familia|family|abuelo|grandparent|niñez|infancia|children|childrens|día del niño|こどもの日|儿童|兒童/iu },
  { theme: 'peace', icon: '🕊️', pattern: /paz|peace|solidaridad|solidarity|derechos humanos|human rights|remembrance of peace|平和|和平|평화/iu },
  { theme: 'sports', icon: '🏆', pattern: /deport|sport|olympic|ol[ií]mpic|marathon|fútbol|football|cricket|tennis|体育|กีฬา/iu },
  { theme: 'nature', icon: '🌱', pattern: /medio ambiente|environment|earth day|tierra|naturaleza|nature|ecolog|ecology|bosque|forest|planet|clima|climate|地球|環境|환경/iu },
  { theme: 'love', icon: '💝', pattern: /aniversario|anniversary|valent[ií]n|valentine|amistad|friendship|love|amor|wedding|boda|casamiento|anniversaire|любовь|愛情/iu },
  { theme: 'birthday', icon: '🎂', pattern: /cumpleaños|cumpleanos|birthday|birth anniversary|natalicio|anniversaire de naissance|生誕|생일/iu },
  { theme: 'newyear', icon: '🎆', pattern: /año nuevo|fin de año|new year|réveillon|silvester|new years day|正月|새해/iu },
  { theme: 'community', icon: '🤝', pattern: /trabajador|workers|labor day|labour day|cooperaci[oó]n|cooperation|comunidad|community|volunteer|voluntari|unity|unidad|团结|團結/iu },
  { theme: 'festival', icon: '🎊', pattern: /festival|fiesta|fest|celebra|fête|feast|fair|feria|parade|desfile|庆典|慶典|축제|เทศกาล/iu },
]
const GENERIC_ICONS = ['✨', '🎊', '🌟', '✦', '🎈', '💫', '🎐', '🌼'] as const

/** Stable hash lets previously unseen events receive different motifs without hardcoding their names. */
export function occasionHash(value: string): number {
  let seed = 2166136261
  for (const char of value) seed = Math.imul(seed ^ char.codePointAt(0)!, 16777619) >>> 0
  return seed
}

/** Choose a respectful contextual motif without claiming the user observes the event.
 * @param moment - dated calendar event.
 * @param country - optional ISO 3166-1 code for a national celebration.
 * @returns icon and category usable by the compact badge.
 */
export function appearanceFor(moment: VisualMoment, country?: string): { icon: string; theme: MomentTheme } {
  if (moment.kind === 'solemn') return { icon: '🕯️', theme: 'solemn' }
  if (moment.kind === 'patriotic') {
    const flag = country && /^[A-Z]{2}$/.test(country)
      ? [...country].map(letter => String.fromCodePoint(letter.charCodeAt(0) + 127397)).join('') : '🏳️'
    return { icon: flag, theme: 'patriotic' }
  }
  const rule = RULES.find(value => value.pattern.test(moment.label))
  if (rule !== undefined) return { icon: rule.icon, theme: rule.theme }
  if (moment.kind === 'personal') return { icon: '🎁', theme: 'birthday' }
  return { icon: GENERIC_ICONS[occasionHash(moment.label) % GENERIC_ICONS.length] ?? '✨', theme: 'general' }
}
