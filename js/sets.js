// Set / product names.
//
// English names and release dates: https://en.hololive-official-cardgame.com/cardlist/
// Japanese names: https://hololive-official-cardgame.com/cardlist/
// Talent romanisations for JP-only decks come from the card dataset itself, so they
// match the names shown on the cards rather than being transliterated by hand.
// Checked 28 Sep 2026 — add a row when a new set ships; unknown codes fall back to
// the bare code, so nothing breaks if this list is behind.

export const SETS = {
  // --- boosters -----------------------------------------------------------
  hBP01: { kind: 'Booster Pack', en: 'Blooming Radiance',  jp: 'ブルーミングレディアンス',   enDate: '2025-07-11' },
  hBP02: { kind: 'Booster Pack', en: 'Quintet Spectrum',   jp: 'クインテットスペクトラム',   enDate: '2025-10-17' },
  hBP03: { kind: 'Booster Pack', en: 'Elite Spark',        jp: 'エリートスパーク',           enDate: '2025-12-19' },
  hBP04: { kind: 'Booster Pack', en: 'Curious Universe',   jp: 'キュリアスユニバース',       enDate: '2026-02-20' },
  hBP05: { kind: 'Booster Pack', en: 'Enchant Regalia',    jp: 'エンチャントレガリア',       enDate: '2026-04-17' },
  hBP06: { kind: 'Booster Pack', en: 'Ayakashi Vermilion', jp: 'アヤカシヴァーミリオン',     enDate: '2026-06-19' },
  hBP07: { kind: 'Booster Pack', en: 'Diva Fever',         jp: 'ディーヴァフィーバー' },
  hBP08: { kind: 'Booster Pack', en: 'Bouncer Bound',      jp: 'バウンサーバウンド' },
  hBP09: { kind: 'Booster Pack', en: 'Volume Vortex',      jp: 'ボリュームヴォルテックス' },
  hEB01: { kind: 'Extra Booster', en: 'Summer hologram',   jp: 'サマー・ホログラム',         enDate: '2026-09-25' },

  // --- start decks --------------------------------------------------------
  hSD01: { kind: 'Start Deck', en: 'Tokino Sora & AZKi',       jp: 'ときのそら＆AZKi',              enDate: '2025-07-11' },
  hSD02: { kind: 'Start Deck', en: 'Red Nakiri Ayame',         jp: '赤 百鬼あやめ',                 enDate: '2025-10-17' },
  hSD03: { kind: 'Start Deck', en: 'Blue Nekomata Okayu',      jp: '青 猫又おかゆ',                 enDate: '2025-10-17' },
  hSD04: { kind: 'Start Deck', en: 'Purple Yuzuki Choco',      jp: '紫 癒月ちょこ',                 enDate: '2025-10-17' },
  hSD05: { kind: 'Start Deck', en: 'White Todoroki Hajime',    jp: '白 轟はじめ',                   enDate: '2025-12-19' },
  hSD06: { kind: 'Start Deck', en: 'Green Kazama Iroha',       jp: '緑 風真いろは',                 enDate: '2025-12-19' },
  hSD07: { kind: 'Start Deck', en: 'Yellow Shiranui Flare',    jp: '黄 不知火フレア',               enDate: '2025-12-19' },
  hSD08: { kind: 'Start Deck', en: 'White Amane Kanata',       jp: '白 天音かなた' },
  hSD09: { kind: 'Start Deck', en: 'Red Houshou Marine',       jp: '赤 宝鐘マリン' },
  hSD10: { kind: 'Start Deck', en: 'FLOW GLOW Rindo Chihaya',  jp: 'FLOW GLOW 推し 輪堂千速' },
  hSD11: { kind: 'Start Deck', en: 'FLOW GLOW Koganei Niko',   jp: 'FLOW GLOW 推し 虎金妃笑虎' },
  hSD12: { kind: 'Start Deck', en: 'Oshi Advent',              jp: '推し Advent',                   enDate: '2026-07-24' },
  hSD13: { kind: 'Start Deck', en: 'Oshi Justice',             jp: '推し Justice',                  enDate: '2026-07-24' },
  hSD14: { kind: 'Live Start Deck', en: 'Shirakami Fubuki',    jp: '白上フブキ' },
  hSD15: { kind: 'Live Start Deck', en: 'Juufuutei Raden',     jp: '儒烏風亭らでん' },
  hSD16: { kind: 'Live Start Deck', en: 'Sakura Miko',         jp: 'さくらみこ' },
  hSD17: { kind: 'Live Start Deck', en: 'Hoshimachi Suisei',   jp: '星街すいせい' },
  hSD18: { kind: 'Live Start Deck', en: 'Mori Calliope',       jp: '森カリオペ' },
  hSD19: { kind: 'Live Start Deck', en: 'Oozora Subaru',       jp: '大空スバル' },
  hSD20: { kind: 'Start Deck', en: 'Hyakuto Kyoko',            jp: '百灯キョーコ', unreleased: true },
  hSD21: { kind: 'Start Deck', en: 'Achichi Mela',             jp: '熱千めら',     unreleased: true },

  // --- accessories, promos, cheer ----------------------------------------
  hYS01: { kind: 'Accessory', en: 'Start Cheer Set', jp: 'スタートエールセット', enDate: '2025-07-11' },
  hPR:   { kind: 'Promo',     en: 'Promo cards',     jp: 'PRカード' },
  hBD24: { kind: 'Promo',     en: 'Birthday promos', jp: 'バースデー プロモ' },

  // Cheer cards are numbered by colour rather than by product.
  hY01: { kind: 'Cheer', en: 'White Cheer',  jp: '白エール' },
  hY02: { kind: 'Cheer', en: 'Green Cheer',  jp: '緑エール' },
  hY03: { kind: 'Cheer', en: 'Red Cheer',    jp: '赤エール' },
  hY04: { kind: 'Cheer', en: 'Blue Cheer',   jp: '青エール' },
  hY05: { kind: 'Cheer', en: 'Purple Cheer', jp: '紫エール' },
  hY06: { kind: 'Cheer', en: 'Yellow Cheer', jp: '黄エール' },
};

// Browse order: boosters, then decks, then the odds and ends.
const PREFIX_ORDER = ['hBP', 'hEB', 'hSD', 'hYS', 'hY', 'hBD', 'hPR', 'hCO', 'hCS', 'hWF', 'hPC'];

export function setPrefix(code) {
  const m = code.match(/^h[A-Za-z]+/);
  return m ? m[0] : code;
}
export function setRank(code) {
  const i = PREFIX_ORDER.indexOf(setPrefix(code));
  return i < 0 ? PREFIX_ORDER.length : i;
}
export function compareSets(a, b) {
  return setRank(a) - setRank(b) || a.localeCompare(b, 'en', { numeric: true });
}

/** Short label: "Blooming Radiance". Falls back to the raw code. */
export function setName(code, lang = 'en') {
  const s = SETS[code];
  if (!s) return code;
  return (lang === 'jp' ? s.jp : s.en) || s.en || code;
}

/** Long label: "Booster Pack – Blooming Radiance". */
export function setFullName(code, lang = 'en') {
  const s = SETS[code];
  if (!s) return code;
  const name = setName(code, lang);
  return s.kind === 'Promo' || s.kind === 'Cheer' ? name : s.kind + ' – ' + name;
}

export const setKind = code => (SETS[code] || {}).kind || '';
/** True for sets with no English printing — their cards show Japanese art. */
export const isJpOnly = code => !!SETS[code] && !SETS[code].enDate && SETS[code].kind !== 'Cheer';
export const isUnreleased = code => !!(SETS[code] || {}).unreleased;
