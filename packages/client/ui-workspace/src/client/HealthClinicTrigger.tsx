/** Real, opt-in Health Engine navigation inside PHOENIX, never a mock clinic. */
import type { SidebarFooterActionOwnerProps } from '@phoenix-ai/dsh-client-ui-sidebar/client'
export function HealthClinicTrigger({ wide }:SidebarFooterActionOwnerProps) {
  return <button type="button" onClick={() => { window.open('/health','_blank','noopener,noreferrer') }}
    aria-label="Abrir PHOENIX Health" title="Abrir clínica PHOENIX Health"
    style={{ border:'1px solid #d6e3ec',background:'#f4f9fd',color:'#275779',borderRadius:10,
      padding:'8px 10px',cursor:'pointer',display:'inline-flex',alignItems:'center',gap:8,fontSize:12,fontWeight:650,marginInline:4 } }>
    <span aria-hidden="true" style={{ color:'#2377ad',fontSize:17 }}>♡</span>{wide?'Health':' ' }
  </button>
}
