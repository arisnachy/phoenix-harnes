import { describe, expect, it } from 'vitest'
import { choosePhoenixDesignMedium, PHOENIX_3D_ROUTING_PROTOCOL } from '../src/scene3d-routing.ts'
import { createPhoenix3DTool } from '../src/scene3d-tool.ts'
describe('Phoenix intelligent 3D design router',()=>{
  it('chooses actual spatial 3D for a viewer, showroom and reusable app asset',()=>{
    expect(choosePhoenixDesignMedium('Diseña un showroom para mi app de muebles')).toBe('scene3d')
    expect(choosePhoenixDesignMedium('Quiero una casa 3D que pueda rotar y usar en mi app')).toBe('scene3d')
    expect(choosePhoenixDesignMedium('Crea un configurador 3D de producto')).toBe('scene3d')
    expect(choosePhoenixDesignMedium('Exporta mi escena en GLB')).toBe('scene3d')
  })
  it('does not waste time and cost making 3D for ordinary UI, charts and still imagery',()=>{
    expect(choosePhoenixDesignMedium('Haz un dashboard de ventas')).toBe('chart')
    expect(choosePhoenixDesignMedium('Crea un formulario para una app médica')).toBe('app')
    expect(choosePhoenixDesignMedium('Haz una imagen render de una casa futurista')).toBe('image')
    expect(choosePhoenixDesignMedium('Crea una foto de un mueble')).toBe('image')
  })
  it('routes HealthIA anatomical atlases to real images even if 3D is explicitly rejected',()=>{
    expect(choosePhoenixDesignMedium('Aire pleural derecho: imagen hiperrealista, no modelo 3D')).toBe('image')
    expect(choosePhoenixDesignMedium('Lámina docente de neumotórax derecho con vasos y nervios')).toBe('image')
    expect(choosePhoenixDesignMedium('Render hiperrealista de la anatomía del tórax')).toBe('image')
    expect(choosePhoenixDesignMedium('Imagen de un pulmón con vascularidad e inervación')).toBe('image')
    expect(choosePhoenixDesignMedium('Quiero un modelo 3D interactivo de anatomía para rotarlo')).toBe('scene3d')
    expect(choosePhoenixDesignMedium('Crea un formulario para una app médica')).toBe('app')
    expect(PHOENIX_3D_ROUTING_PROTOCOL).toContain('Never interpret "no 3D"')
    expect(createPhoenix3DTool().description).toContain('MEDICAL EXCEPTION')
  })
  it('teaches Kira to use 3D only when useful, not a static PNG nor fake CAD',()=>{
    expect(PHOENIX_3D_ROUTING_PROTOCOL).toContain('Never add 3D to ordinary apps')
    expect(createPhoenix3DTool().description).toContain('GLB/glTF')
    expect(PHOENIX_3D_ROUTING_PROTOCOL).toContain('preset:pelican')
  })
})
