// ─── 스타일 매핑 + 투톤 컬러 설정 ───

export interface KitchenStyle {
  name: string;
  doorColor: string;
  doorFinish: string;
  countertopColor: string;
  countertopMaterial: string;
  alternativeStyle: string;
}

export const STYLE_MAP: Record<string, KitchenStyle> = {
  'modern-minimal': {
    name: 'Modern Minimal',
    doorColor: 'Warm White',
    doorFinish: 'matte',
    countertopColor: 'White',
    countertopMaterial: 'engineered stone',
    alternativeStyle: 'scandinavian',
  },
  'scandinavian': {
    name: 'Scandinavian Nordic',
    doorColor: 'Milk White',
    doorFinish: 'matte',
    countertopColor: 'Light Oak',
    countertopMaterial: 'butcher block',
    alternativeStyle: 'modern-minimal',
  },
  'industrial': {
    name: 'Industrial Vintage',
    doorColor: 'Sand Gray',
    doorFinish: 'matte',
    countertopColor: 'Charcoal',
    countertopMaterial: 'concrete-look stone',
    alternativeStyle: 'classic',
  },
  'classic': {
    name: 'Classic Traditional',
    doorColor: 'Ivory',
    doorFinish: 'matte',
    countertopColor: 'Beige',
    countertopMaterial: 'marble-look stone',
    alternativeStyle: 'luxury',
  },
  'luxury': {
    name: 'Luxury Premium',
    doorColor: 'Cashmere',
    doorFinish: 'matte',
    countertopColor: 'Calacatta',
    countertopMaterial: 'marble',
    alternativeStyle: 'modern-minimal',
  },
};

// 대체 스타일 하부장 컬러 (투톤: 상부=무채색, 하부=컬러)
export const TWO_TONE_LOWER_COLORS: Record<string, string> = {
  'modern-minimal': 'Deep Navy',
  'scandinavian': 'Nature Oak',
  'industrial': 'Concrete Gray',
  'classic': 'Walnut',
  'luxury': 'Deep Green',
};

export const ALT_DOOR_COLORS: Record<string, { color: string; finish: string; countertop: string }> = {
  'modern-minimal': { color: 'white', finish: 'matte', countertop: 'white engineered stone' },
  'scandinavian': { color: 'light oak wood', finish: 'natural', countertop: 'white marble' },
  'industrial': { color: 'dark charcoal', finish: 'matte', countertop: 'concrete gray countertop' },
  'classic': { color: 'cream ivory', finish: 'semi-gloss', countertop: 'beige granite' },
  'luxury': { color: 'deep navy', finish: 'high-gloss', countertop: 'calacatta marble' },
};
