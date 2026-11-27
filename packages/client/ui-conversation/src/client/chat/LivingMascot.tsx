import type { TurnProgress } from './turn-progress.ts'
import css from './ChatView.module.css'

export type MascotPose = 'ready' | 'thinking' | 'search' | 'browse' | 'read' | 'code' | 'tools' | 'verify' | 'paint' | 'calculate' | 'plan' | 'listen' | 'talk' | 'settled'

/** Use only the observed activity and tool identity, never prompt or reasoning text. */
export function mascotPose(progress: TurnProgress): MascotPose {
  const name = (progress.detail ?? '').toLowerCase().replace(/[_.:/-]+/g, ' ')
  if (progress.activity === 'generating-image') return 'paint'
  if (progress.phase === 'running-tools') {
    if (/\b(calculator|calculate|calculation)\b/.test(name)) return 'calculate'
    if (/\b(transcribe|listen|speech recognition)\b/.test(name)) return 'listen'
    if (/\b(tts|speak|text to speech)\b/.test(name)) return 'talk'
    if (/\b(plan|planning|todo)\b/.test(name)) return 'plan'
    if (/\b(repair|fix|diagnose)\b/.test(name)) return 'tools'
  }
  switch (progress.activity) {
    case 'preparing': return 'ready'
    case 'thinking': return 'thinking'
    case 'searching': return 'search'
    case 'browsing': return 'browse'
    case 'reading': return 'read'
    case 'writing':
    case 'executing': return 'code'
    case 'verifying': return 'verify'
    default: return 'tools'
  }
}

/** Local SVG rig: fixed canvas and independent eyes, head, wings, tail and props. */
export function LivingMascot({ pose, large = false }: { readonly pose: MascotPose; readonly large?: boolean }) {
  return (
    <svg viewBox="0 0 120 108" className={css.livingMascot} data-mascot-pose={pose}
      data-large={large ? 'true' : undefined} aria-hidden="true" focusable="false">
      <ellipse cx="60" cy="101" rx="32" ry="3" fill="#9d582d" opacity=".12" />
      <g className={css.mascotBody}>
        <g className={css.mascotTail}>
          <path d="M43 73C17 75 9 57 12 50 0 79 19 95 43 88 29 99 49 102 63 86" fill="#f47728"/>
          <path d="M39 83C20 83 15 74 12 67 13 89 31 96 48 85" fill="#ffc044"/>
          <path d="M44 86Q29 103 51 99L62 83" fill="#ffab35"/>
        </g>
        <ellipse cx="60" cy="73" rx="25" ry="26" fill="#ed7027"/>
        <ellipse cx="63" cy="75" rx="17" ry="20" fill="#ffe2ac"/>
        <g className={css.mascotWingLeft}>
          <path d="M40 62Q20 58 25 74 29 89 45 85 52 73 40 62" fill="#ff912d"/>
          <path d="M28 70Q31 80 42 81" stroke="#ffc252" strokeWidth="3" strokeLinecap="round" fill="none"/>
        </g>
        <g className={css.mascotWingRight}>
          <path d="M80 62Q100 58 95 74 91 89 75 85 68 73 80 62" fill="#ff912d"/>
          <path d="M92 70Q89 80 78 81" stroke="#ffc252" strokeWidth="3" strokeLinecap="round" fill="none"/>
        </g>
        <g className={css.mascotHead}>
          <path d="M39 28Q13 7 28 6 30 20 48 18 32 4 55 1 48 13 63 17 69 3 82 7 74 20 87 27" fill="#f77a24"/>
          <path d="M48 18Q32 4 55 1 48 13 63 17" fill="#ffc34a"/>
          <ellipse cx="60" cy="43" rx="36" ry="31" fill="#ff902d"/>
          <ellipse cx="60" cy="49" rx="30" ry="23" fill="#fff0cd"/>
          <path d="M33 32Q42 24 50 29M70 29Q78 24 87 32" fill="none" stroke="#b75a2a" strokeWidth="2" strokeLinecap="round"/>
          <g className={css.mascotEyes}>
            <ellipse cx="43" cy="42" rx="12" ry="14" fill="#fffaf1"/>
            <ellipse cx="77" cy="42" rx="12" ry="14" fill="#fffaf1"/>
            <g className={css.mascotPupils}>
              <ellipse cx="45" cy="43" rx="8" ry="11" fill="#60301d"/>
              <ellipse cx="75" cy="43" rx="8" ry="11" fill="#60301d"/>
              <ellipse cx="45" cy="48" rx="6" ry="4" fill="#ba7136"/>
              <ellipse cx="75" cy="48" rx="6" ry="4" fill="#ba7136"/>
              <circle cx="47" cy="38" r="3.2" fill="white"/>
              <circle cx="77" cy="38" r="3.2" fill="white"/>
            </g>
          </g>
          <ellipse cx="35" cy="55" rx="7" ry="3.5" fill="#ed9778" opacity=".8"/>
          <ellipse cx="85" cy="55" rx="7" ry="3.5" fill="#ed9778" opacity=".8"/>
          <path className={css.mascotBeak} d="M53 55Q60 68 67 55Z" fill="#86351c"/>
          <path d="M51 55Q60 45 69 55 60 60 51 55" fill="#ffb931"/>
        </g>
        {(pose === 'ready' || pose === 'thinking') && <g className={css.mascotProp}>
          <path d="M77 71Q85 52 71 61L65 68" fill="#ffad36"/>
          <g fill="#df8b39"><circle cx="95" cy="19" r="2"/><circle cx="103" cy="13" r="3"/><circle cx="113" cy="8" r="3.5"/></g>
        </g>}
        {(pose === 'code' || pose === 'browse') && <g>
          <rect x="29" y="65" width="63" height="34" rx="4" fill="#8e9baa"/>
          <rect x="33" y="69" width="55" height="26" rx="2" fill="#253344"/>
          {pose === 'code' ? <g strokeWidth="2" strokeLinecap="round" fill="none">
            <path d="M38 75h10m4 0h19M42 81h13" stroke="#f8bf62"/>
            <path d="M59 81h23M42 87h20" stroke="#9fdfcb"/>
            <path className={css.mascotProp} d="M65 85v5" stroke="#fff"/>
          </g> : <g stroke="#a9d8f0" fill="none" strokeWidth="1.5">
            <circle cx="60" cy="82" r="10"/><ellipse cx="60" cy="82" rx="4" ry="10"/><path d="M50 82h20M52 77h16M52 87h16"/>
          </g>}
          <path d="M25 98h71l-4 4H29Z" fill="#b6c2ce"/>
          <g className={css.mascotTyping} fill="#ffae36"><ellipse cx="32" cy="98" rx="7" ry="3.5"/><ellipse cx="88" cy="98" rx="7" ry="3.5"/></g>
        </g>}
        {pose === 'search' && <g className={css.mascotProp}>
          <path d="M87 72l17 21" stroke="#95694d" strokeWidth="7" strokeLinecap="round"/>
          <circle cx="82" cy="63" r="15" fill="#c2e8fb" fillOpacity=".45" stroke="#687e91" strokeWidth="4"/>
          <path d="M73 59q3-8 10-7" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        </g>}
        {pose === 'read' && <g className={css.mascotProp}>
          <path d="M25 69Q43 64 60 74 77 64 95 69V98Q77 93 60 101 43 93 25 98Z" fill="#a96b48"/>
          <path d="M28 67Q44 63 60 73 76 63 92 67V94Q76 89 60 97 44 89 28 94Z" fill="#fff5df"/>
          <path d="M60 73v24M34 74l19 5m-19 3 19 5m14-8 19-5m-19 13 19-5" stroke="#c6a88a" strokeWidth="1.5" fill="none"/>
        </g>}
        {(pose === 'verify' || pose === 'plan') && <g>
          <rect x="42" y="65" width="38" height="37" rx="3" fill="#ad8054"/>
          <rect x="46" y="69" width="30" height="29" rx="1" fill="#fff5dd"/>
          <rect x="54" y="62" width="14" height="8" rx="2" fill="#8193a2"/>
          <path className={css.mascotProp} d="M49 77l3 3 5-6m-8 13 3 3 5-6" stroke="#519b76" strokeWidth="2" fill="none"/>
          <path d="M60 77h12m-12 10h12" stroke="#b9a58c" strokeWidth="2"/>
        </g>}
        {pose === 'calculate' && <g>
          <rect x="43" y="64" width="35" height="38" rx="4" fill="#738497"/>
          <rect x="47" y="68" width="27" height="9" rx="2" fill="#cee4b7"/>
          <path d="M50 73h6m3 0h10" stroke="#4e6845" strokeWidth="1.5"/>
          <g fill="#e5edf2"><rect x="47" y="81" width="7" height="5" rx="1"/><rect x="57" y="81" width="7" height="5" rx="1"/><rect x="67" y="81" width="7" height="5" rx="1"/><rect x="47" y="90" width="7" height="5" rx="1"/><rect x="57" y="90" width="7" height="5" rx="1"/></g>
          <rect className={css.mascotProp} x="67" y="89" width="7" height="7" rx="1" fill="#ffbb48"/>
        </g>}
        {pose === 'paint' && <g>
          <ellipse cx="40" cy="85" rx="16" ry="11" fill="#e0b881"/>
          <circle cx="31" cy="81" r="3" fill="#dd6869"/><circle cx="40" cy="77" r="3" fill="#75b1db"/><circle cx="49" cy="83" r="3" fill="#73ad80"/>
          <g className={css.mascotProp}><path d="M83 92l20-34" stroke="#9c6847" strokeWidth="4" strokeLinecap="round"/><path d="M101 62q-5-10 7-15 2 9-7 15" fill="#669ed5"/></g>
        </g>}
        {pose === 'tools' && <g>
          <rect x="26" y="82" width="31" height="17" rx="3" fill="#b86447"/><path d="M35 82v-6h13v6" fill="none" stroke="#90523d" strokeWidth="3"/>
          <g className={css.mascotProp}><path d="M80 91l20-31" stroke="#8494a3" strokeWidth="7" strokeLinecap="round"/><path d="M94 63q-9-9 0-17l3 9 7 3 7-8q4 15-11 17Z" fill="#a6b1be"/></g>
        </g>}
        {pose === 'listen' && <g fill="#8495a5" stroke="#8495a5" strokeWidth="4"><path d="M26 47a34 34 0 0 1 68 0" fill="none"/><rect x="22" y="42" width="9" height="18" rx="4"/><rect x="89" y="42" width="9" height="18" rx="4"/></g>}
        {pose === 'talk' && <g className={css.mascotProp} fill="none" stroke="#d68d40" strokeWidth="2.5" strokeLinecap="round"><path d="M99 43q10 8 0 16M106 38q15 13 0 26"/></g>}
        {pose === 'settled' && <g className={css.mascotProp} fill="#fbc34c"><path d="M99 10l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z"/><path d="M13 25l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z"/></g>}
      </g>
    </svg>
  )
}
