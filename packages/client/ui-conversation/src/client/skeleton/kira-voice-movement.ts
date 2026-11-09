/** Lightweight, deterministic facial cues; no synthetic claims of emotion. */
export type KiraAvatarExpression='warm'|'concerned'|'focused'|'neutral'
const normalize=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase()
/** The actual words Kira is authorized to say govern face posture. */
export function kiraExpressionFromSpeech(input:string):KiraAvatarExpression {
  const text=normalize(input.slice(-640))
  if(/\b(?:alerta|riesgo|peligro|precaucion|urgente|lesion|error|fallo|preocup|contraindicad|no es seguro|no puedo confirmar)\b/u.test(text))return 'concerned'
  if(/\b(?:encontre|excelente|logrado|listo|perfecto|felicidades|buena noticia|funciona|solucion|conseguimos|resuelto)\b/u.test(text))return 'warm'
  if(/\b(?:analiz|revis|verific|compar|investig|calcul|examin|evalu|comprob|procesando|buscando|estimacion)\w*/u.test(text))return 'focused'
  return 'neutral'
}
const vowel=/[aeiouáéíóúü]/iu
/**
 * Fallback for Host/local synthesis that exposes no waveform/visemes.
 * Cadence is speech-text-driven (not a claim of word-perfect lip sync).
 */
export function kiraSpeechMouthEnvelope(text:string,elapsedMs:number):number{
  if(!Number.isFinite(elapsedMs)||elapsedMs<0||text.trim()==='')return 0
  const sample=text[Math.floor(elapsedMs/98)%text.length]
  if(sample===undefined||/[\s.,;:!?¿¡\n]/u.test(sample))return .02
  const beat=Math.abs(Math.sin(elapsedMs/83))
  return vowel.test(sample)? .24+.67*beat : .10+.34*beat
}
/** Bounded RMS avoids amplification of noise-floor microphone readings. */
export function kiraAudioMouthLevel(rms:number):number{
  if(!Number.isFinite(rms)||rms<=.009)return 0
  return Math.min(1,Math.max(0,(rms-.009)*12))
}
