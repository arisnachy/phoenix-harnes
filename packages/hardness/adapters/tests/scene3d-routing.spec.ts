import { describe, expect, it } from 'vitest'
import { choosePhoenixDesignMedium, isAnatomicalVisualRequest, PHOENIX_3D_ROUTING_PROTOCOL } from '../src/scene3d-routing.ts'
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
  it('renders anatomical twins as images even when the prompt mentions 3D',()=>{
    for(const prompt of [
      'Crea un gemelo digital anatómico del corazón en 3D',
      'Representa los riñones en modelo 3D',
      'Diseña un render médico del cerebro y sus arterias',
      'Create a 3D medical anatomical model of the heart',
      'Ilustra la anatomía del páncreas',
    ]){
      expect(isAnatomicalVisualRequest(prompt)).toBe(true)
      expect(choosePhoenixDesignMedium(prompt)).toBe('image')
    }
    expect(choosePhoenixDesignMedium('Haz un gemelo digital 3D de una turbina industrial')).toBe('scene3d')
    expect(choosePhoenixDesignMedium('Crea una aplicación para gestionar atlas anatómicos')).toBe('app')
  })
  it('teaches Kira to use 3D only when useful, not a static PNG nor fake CAD',()=>{
    expect(PHOENIX_3D_ROUTING_PROTOCOL).toContain('Never add 3D to ordinary apps')
    expect(createPhoenix3DTool().description).toContain('GLB/glTF')
    expect(PHOENIX_3D_ROUTING_PROTOCOL).toContain('preset:pelican')
  })
})
