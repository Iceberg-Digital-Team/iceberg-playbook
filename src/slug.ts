// Turkish letters have no ASCII equivalent, so plain toLowerCase()+strip
// silently drops them (e.g. an all-Turkish name collapses to an empty
// slug). Transliterate the specific Turkish letters to Latin equivalents
// first, then run the normal slugify pipeline.
const TURKISH_TO_ASCII: Record<string, string> = {
  'ç': 'c', 'Ç': 'c',
  'ğ': 'g', 'Ğ': 'g',
  'ı': 'i', 'İ': 'i',
  'ö': 'o', 'Ö': 'o',
  'ş': 's', 'Ş': 's',
  'ü': 'u', 'Ü': 'u',
};

export function toSlug(name: string): string {
  const transliterated = name.replace(/[çÇğĞıİöÖşŞüÜ]/g, ch => TURKISH_TO_ASCII[ch]);
  return transliterated
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
