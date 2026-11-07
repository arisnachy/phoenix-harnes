// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PhoenixVisualizer } from '../src/client/chat/PhoenixVisualizer.tsx'

afterEach(cleanup)

describe('licensed image references in Phoenix visual cards', () => {
  const reference = {
    title: 'Anatomía del corazón',
    src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Heart.png/640px-Heart.png',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Human_heart_diagram.png',
    alt: 'Anatomía humana del corazón',
    credit: 'Autor de la imagen',
    license: 'CC BY-SA 4.0',
    description: 'Ejemplo de referencia documental.',
  }

  it('renders an attributable web image inside a cards artifact', () => {
    const { container } = render(<PhoenixVisualizer spec={{ visualType: 'cards', cards: [reference] }} />)
    const img = screen.getByRole('img', { name: reference.alt })
    expect(img.getAttribute('src')).toBe(reference.src)
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(screen.getByRole('link', { name: 'Fuente original' }).getAttribute('href')).toBe(reference.sourceUrl)
    expect(screen.getByText(/Autor de la imagen/)).not.toBeNull()
    expect(container.querySelector('[data-phoenix-reference-image="commons"]')).not.toBeNull()
    fireEvent.error(img)
    expect(screen.getByText('Imagen no disponible')).not.toBeNull()
  })

  it('refuses an image without trustworthy provenance while retaining the card text', () => {
    const unsafe = { ...reference, src: 'https://localhost/private', license: 'CC BY-SA' }
    const { container } = render(<PhoenixVisualizer spec={{ visualType: 'cards', cards: [unsafe] }} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Anatomía del corazón')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'Fuente original' })).toBeNull()
  })
})
