export const GOVERNORATES = [
  'Baghdad',
  'Basra',
  'Erbil',
  'Sulaymaniyah',
  'Duhok',
  'Kirkuk',
  'Najaf',
  'Karbala',
  'Mosul',
  'Anbar',
  'Babil',
  'Diyala',
  'Diwaniyah',
  'Dhi Qar',
  'Maysan',
  'Muthanna',
  'Salahuddin',
  'Wasit',
];

export const BRANDS = [
  'Apple',
  'Samsung',
  'Xiaomi',
  'Realme',
  'Tecno',
  'Huawei',
  'OPPO',
  'Vivo',
  'OnePlus',
  'Google',
  'Nokia',
  'Other',
];

export function isGovernorate(g) {
  return GOVERNORATES.includes(g);
}

export function isBrand(b) {
  return BRANDS.includes(b);
}
