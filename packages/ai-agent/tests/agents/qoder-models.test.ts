import { describe, it, expect } from 'vitest'
import { mapQoderModels, type QoderSdkModel } from '../../src/agents/qoder/models.js'

// Trimmed from a real getAvailableModels() response (assistant scene).
const SAMPLE: QoderSdkModel[] = [
  { value: 'auto', displayName: 'Auto', isDefault: true, isVl: true, priceFactor: 1, source: 'system', description: 'Vision · 1.00x Credit' },
  { value: 'performance', displayName: 'Performance', isVl: true, priceFactor: 1.1, source: 'system', description: 'Vision · 1.10x Credit' },
  { value: 'lite', displayName: 'Lite', priceFactor: 0, source: 'system', description: '0.00x Credit' },
  { value: 'qmodel_latest', displayName: 'Qwen3.7-Max', isNew: true, isFree: true, isVl: true, priceFactor: 0.2, source: 'system', description: 'Vision · New · 0.20x Credit' },
  { value: 'gm51model', displayName: 'GLM-5.1', isNew: true, isReasoning: true, isVl: true, priceFactor: 0.6, source: 'system', description: 'Reasoning · Vision · New · 0.60x Credit' },
]

describe('mapQoderModels', () => {
  it('maps slug → id and keeps the display name + description', () => {
    const out = mapQoderModels(SAMPLE)
    const glm = out.find((m) => m.id === 'gm51model')
    expect(glm).toEqual({
      id: 'gm51model',
      category: 'alternative',
      displayName: 'GLM-5.1',
      description: 'Reasoning · Vision · New · 0.60x Credit',
    })
  })

  it('orders default → standard → new, preserving server order within a group', () => {
    expect(mapQoderModels(SAMPLE).map((m) => m.id)).toEqual([
      'auto', // isDefault
      'performance', // standard tier
      'lite', // standard tier
      'qmodel_latest', // new
      'gm51model', // new
    ])
  })

  it('classifies new models as alternative and stable tiers as recommended', () => {
    const out = mapQoderModels(SAMPLE)
    expect(out.find((m) => m.id === 'auto')?.category).toBe('recommended')
    expect(out.find((m) => m.id === 'qmodel_latest')?.category).toBe('alternative')
  })

  it('drops disabled and value-less entries', () => {
    const out = mapQoderModels([
      ...SAMPLE,
      { value: 'disabled', displayName: 'Nope', isEnabled: false },
      { value: '', displayName: 'Blank' },
    ])
    expect(out.map((m) => m.id)).not.toContain('disabled')
    expect(out.map((m) => m.id)).not.toContain('')
  })

  it('synthesises a description when the server omits one', () => {
    const [m] = mapQoderModels([
      { value: 'x', displayName: 'X', isReasoning: true, isVl: true, priceFactor: 0.5 },
    ])
    expect(m.description).toBe('Reasoning · Vision · 0.50x Credit')
  })
})
