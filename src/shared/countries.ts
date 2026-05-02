interface CountryRecord {
  flag: string
  iso: string
  names: readonly string[]
}

const COUNTRIES: readonly CountryRecord[] = [
  {
    flag: '🇰🇷',
    iso: 'kr',
    names: [
      'south korea',
      'korea',
      'republic of korea',
      '대한민국',
      '한국',
      '韓国',
      '南韓',
    ],
  },
  {
    flag: '🇺🇸',
    iso: 'us',
    names: [
      'united states',
      'usa',
      'u.s.',
      'u.s.a.',
      'america',
      '미국',
      'アメリカ',
      '美國',
      '美国',
    ],
  },
  { flag: '🇯🇵', iso: 'jp', names: ['japan', '日本', '일본'] },
  { flag: '🇨🇳', iso: 'cn', names: ['china', '中國', '中国', '중국'] },
  { flag: '🇹🇼', iso: 'tw', names: ['taiwan', '台灣', '台湾', '대만'] },
  { flag: '🇭🇰', iso: 'hk', names: ['hong kong', '香港', '홍콩'] },
  {
    flag: '🇬🇧',
    iso: 'gb',
    names: [
      'united kingdom',
      'uk',
      'u.k.',
      'britain',
      'great britain',
      '영국',
      'イギリス',
      '英國',
      '英国',
    ],
  },
  { flag: '🇨🇦', iso: 'ca', names: ['canada', '캐나다', 'カナダ', '加拿大'] },
  {
    flag: '🇦🇺',
    iso: 'au',
    names: ['australia', '호주', 'オーストラリア', '澳洲', '澳大利亞'],
  },
  {
    flag: '🇳🇿',
    iso: 'nz',
    names: ['new zealand', '뉴질랜드', 'ニュージーランド', '紐西蘭', '新西兰'],
  },
  {
    flag: '🇫🇷',
    iso: 'fr',
    names: ['france', '프랑스', 'フランス', '法國', '法国'],
  },
  {
    flag: '🇩🇪',
    iso: 'de',
    names: ['germany', 'deutschland', '독일', 'ドイツ', '德國', '德国'],
  },
  {
    flag: '🇮🇹',
    iso: 'it',
    names: ['italy', 'italia', '이탈리아', 'イタリア', '義大利', '意大利'],
  },
  {
    flag: '🇪🇸',
    iso: 'es',
    names: ['spain', 'españa', '스페인', 'スペイン', '西班牙'],
  },
  {
    flag: '🇵🇹',
    iso: 'pt',
    names: ['portugal', '포르투갈', 'ポルトガル', '葡萄牙'],
  },
  {
    flag: '🇳🇱',
    iso: 'nl',
    names: ['netherlands', 'holland', '네덜란드', 'オランダ', '荷蘭', '荷兰'],
  },
  {
    flag: '🇧🇪',
    iso: 'be',
    names: ['belgium', '벨기에', 'ベルギー', '比利時', '比利时'],
  },
  { flag: '🇨🇭', iso: 'ch', names: ['switzerland', '스위스', 'スイス', '瑞士'] },
  {
    flag: '🇦🇹',
    iso: 'at',
    names: ['austria', '오스트리아', 'オーストリア', '奧地利', '奥地利'],
  },
  {
    flag: '🇸🇪',
    iso: 'se',
    names: ['sweden', '스웨덴', 'スウェーデン', '瑞典'],
  },
  {
    flag: '🇳🇴',
    iso: 'no',
    names: ['norway', '노르웨이', 'ノルウェー', '挪威'],
  },
  {
    flag: '🇩🇰',
    iso: 'dk',
    names: ['denmark', '덴마크', 'デンマーク', '丹麥', '丹麦'],
  },
  {
    flag: '🇫🇮',
    iso: 'fi',
    names: ['finland', '핀란드', 'フィンランド', '芬蘭', '芬兰'],
  },
  {
    flag: '🇮🇪',
    iso: 'ie',
    names: ['ireland', '아일랜드', 'アイルランド', '愛爾蘭', '爱尔兰'],
  },
  {
    flag: '🇵🇱',
    iso: 'pl',
    names: ['poland', '폴란드', 'ポーランド', '波蘭', '波兰'],
  },
  {
    flag: '🇨🇿',
    iso: 'cz',
    names: ['czech republic', 'czechia', '체코', 'チェコ', '捷克'],
  },
  {
    flag: '🇺🇦',
    iso: 'ua',
    names: ['ukraine', '우크라이나', 'ウクライナ', '烏克蘭', '乌克兰'],
  },
  {
    flag: '🇷🇺',
    iso: 'ru',
    names: [
      'russia',
      'russian federation',
      '러시아',
      'ロシア',
      '俄羅斯',
      '俄罗斯',
    ],
  },
  { flag: '🇮🇳', iso: 'in', names: ['india', '인도', 'インド', '印度'] },
  {
    flag: '🇸🇬',
    iso: 'sg',
    names: ['singapore', '싱가포르', 'シンガポール', '新加坡'],
  },
  {
    flag: '🇲🇾',
    iso: 'my',
    names: ['malaysia', '말레이시아', 'マレーシア', '馬來西亞', '马来西亚'],
  },
  {
    flag: '🇹🇭',
    iso: 'th',
    names: ['thailand', '태국', 'タイ', '泰國', '泰国'],
  },
  {
    flag: '🇻🇳',
    iso: 'vn',
    names: ['vietnam', 'viet nam', '베트남', 'ベトナム', '越南'],
  },
  {
    flag: '🇵🇭',
    iso: 'ph',
    names: ['philippines', '필리핀', 'フィリピン', '菲律賓', '菲律宾'],
  },
  {
    flag: '🇮🇩',
    iso: 'id',
    names: ['indonesia', '인도네시아', 'インドネシア', '印尼', '印度尼西亞'],
  },
  {
    flag: '🇧🇷',
    iso: 'br',
    names: ['brazil', 'brasil', '브라질', 'ブラジル', '巴西'],
  },
  {
    flag: '🇲🇽',
    iso: 'mx',
    names: ['mexico', 'méxico', '멕시코', 'メキシコ', '墨西哥'],
  },
  {
    flag: '🇦🇷',
    iso: 'ar',
    names: ['argentina', '아르헨티나', 'アルゼンチン', '阿根廷'],
  },
  { flag: '🇨🇱', iso: 'cl', names: ['chile', '칠레', 'チリ', '智利'] },
  {
    flag: '🇿🇦',
    iso: 'za',
    names: ['south africa', '남아프리카', '南アフリカ', '南非'],
  },
  {
    flag: '🇹🇷',
    iso: 'tr',
    names: ['turkey', 'türkiye', '튀르키예', '터키', 'トルコ', '土耳其'],
  },
  {
    flag: '🇦🇪',
    iso: 'ae',
    names: [
      'united arab emirates',
      'uae',
      '아랍에미리트',
      'アラブ首長国連邦',
      '阿聯酋',
      '阿联酋',
    ],
  },
  {
    flag: '🇸🇦',
    iso: 'sa',
    names: [
      'saudi arabia',
      '사우디아라비아',
      'サウジアラビア',
      '沙烏地阿拉伯',
      '沙特阿拉伯',
    ],
  },
]

const lookup = new Map<string, CountryRecord>()

for (const country of COUNTRIES) {
  for (const name of country.names) {
    lookup.set(normalizeCountry(name), country)
  }
}

export function countryToFlag(country: string): string | undefined {
  return countryToFlagInfo(country)?.flag
}

export function countryToFlagInfo(
  country: string,
): { flag: string; iso: string } | undefined {
  const normalized = normalizeCountry(country)

  if (normalized.length === 0) {
    return undefined
  }

  const exact = lookup.get(normalized)

  if (exact !== undefined) {
    return { flag: exact.flag, iso: exact.iso }
  }

  for (const [name, record] of lookup.entries()) {
    if (normalized.includes(name) || name.includes(normalized)) {
      return { flag: record.flag, iso: record.iso }
    }
  }

  return undefined
}

function normalizeCountry(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
