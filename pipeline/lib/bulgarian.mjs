// ALL-CAPS Bulgarian stop names → sentence-style mixed case.
//
// The CGM feed shouts every stop name (Ж.К. ЗАПАДЕН ПАРК) while Bulgarian —
// and the OSM base map right next to the labels — writes sentence style:
// "ж.к. Западен парк", "пл. Сточна гара", "ул. Иван Вазов". Word-by-word
// Title Case would anglicize that ("Западен Парк"), so like the Athens map
// (lib/greek.mjs) we harvest a dictionary from the OSM extracts and let it
// decide the case of every known word. Unlike Greek nothing is lost in
// capitals here — the dictionary only supplies WHICH words Bulgarian keeps
// lowercase mid-name (парк, гара, мост, шосе) and which are proper names
// (Иван, Искър). Unknown words fall back to Title Case, at worst
// capitalizing a generic noun.
//
// Harvest skips the FIRST word of every OSM name: name-initial position is
// always capitalized regardless of what the word is, so it teaches nothing —
// "Гара Искър" must not outvote the lowercase "гара" of "Централна гара".

const WORD = /[А-Яа-яA-Za-z]+/g;
const HAS_LOWER = /[а-яa-z]/;
const VOWEL = /[АЕИОУЪЮЯAEIOUY]/;

// Written in capitals in normal Bulgarian text too. Vowel-less tokens (ДКЦ,
// НДК, ЖП, ПГХМБТ, roman numerals) need no listing — a Bulgarian word always
// carries a vowel — so this set holds only the vowel-carrying ones.
const ACRONYMS = new Set([
  'ОУ', 'АД', 'УМБАЛ', 'УМБАЛСМ', 'НСБАЛ', 'МБАЛ', 'СБАЛ', 'СОУ', 'СУ',
  'ЦДГ', 'ОДЗ', 'ТЕЦ', 'НПЗ', 'ВМА', 'ИСУЛ', 'БАН', 'МВР', 'ХЕИ', 'АП',
  'ЦУМ', 'НИМ', 'СТИНД', 'КАТ', 'ДАИ', 'ЗОО',
]);

// Connectives, request-stop markers and ordinal endings ("3-ТИ", "2-РА") that
// Bulgarian never capitalizes mid-name.
const LOWER_WORDS = new Set([
  'ПО', 'ЖЕЛАНИЕ', 'НА', 'ЗА', 'И', 'ОТ', 'ДО', 'ПРИ', 'ПРЕЗ', 'КЪМ',
  'ВРЕМЕННА', 'ТИ', 'ТО', 'ТА', 'РА', 'ВА', 'МА',
]);

// Dotted abbreviations, tried longest-first while peeling a token from the
// front ("Ж.К.ИВАН" → "ж.к." + "ИВАН"). Sentence-style keeps them lowercase
// even name-initial — that is how the OSM base map writes them ("ж.к.
// Надежда 1"). "Св." stays capital (church and street dedications). A single
// capital letter with a dot that matches nothing here is a person's initial
// and stays as it is ("Т. Каблешков").
const ABBR = [
  ['СВ.СВ.', 'Св.Св.'], ['СВ.', 'Св.'], ['Ж.К.', 'ж.к.'], ['В.З.', 'в.з.'],
  ['АКАД.', 'акад.'], ['ПРОФ.', 'проф.'], ['ПОЛК.', 'полк.'], ['КАП.', 'кап.'],
  ['ИНЖ.', 'инж.'], ['ГЕН.', 'ген.'], ['БУЛ.', 'бул.'], ['УЛ.', 'ул.'],
  ['КВ.', 'кв.'], ['ПЛ.', 'пл.'], ['БЛ.', 'бл.'], ['МЛ.', 'мл.'],
  ['С.', 'с.'], ['М.', 'м.'],
];

const title = (w) => w[0].toUpperCase() + w.slice(1).toLowerCase();

export function buildNameDict(osmDocs) {
  const seen = new Map(); // UPPER word → Map(spelling → count)
  for (const doc of osmDocs) {
    for (const e of doc.elements || []) {
      const name = e.tags && e.tags.name;
      if (!name || !HAS_LOWER.test(name)) continue; // caps names teach us nothing
      const words = name.match(WORD) || [];
      for (const w of words.slice(1)) { // skip the name-initial word
        if (w.length < 3) continue;
        const k = w.toUpperCase();
        let m = seen.get(k);
        if (!m) seen.set(k, (m = new Map()));
        m.set(w, (m.get(w) || 0) + 1);
      }
    }
  }
  const dict = new Map();
  for (const [k, m] of seen) {
    let best = null, bestN = -1;
    for (const [w, n] of m) if (n > bestN) { best = w; bestN = n; }
    dict.set(k, best);
  }
  return dict;
}

function word(w, dict) {
  if (!/[А-Яа-яA-Za-z]/.test(w) || /\d/.test(w)) return w; // digits, "4А"
  if (ACRONYMS.has(w)) return w;
  if (LOWER_WORDS.has(w)) return w.toLowerCase();
  if (!VOWEL.test(w)) return w; // vowel-less = acronym or initials
  if (w.length >= 3) {
    const d = dict.get(w);
    if (d) return d;
  }
  return title(w);
}

export function bulgarianTitleCase(name, dict) {
  if (!name || HAS_LOWER.test(name)) return name; // already mixed-case — leave
  let firstDone = false;
  return name.split(/(\s+|[()\-–—,«»„“”"']+)/).map((tok) => {
    if (!/[А-Яа-яA-Za-z]/.test(tok)) {
      // a leading number IS the first word ("115-ТИ ..." must keep its
      // ordinal ending lowercase: "115-ти ...")
      if (/\d/.test(tok)) firstDone = true;
      return tok; // separators, bare numbers
    }
    let out = '';
    let rest = tok;
    let abbrStart = false;
    // peel dotted abbreviations and initials off the front
    for (;;) {
      const hit = ABBR.find(([k]) => rest.startsWith(k));
      if (hit) {
        if (!out) abbrStart = hit[1][0] !== hit[1][0].toUpperCase();
        out += hit[1];
        rest = rest.slice(hit[0].length);
        continue;
      }
      const m = rest.match(/^([А-ЯA-Z])\./); // single-letter initial
      if (m) { out += m[0]; rest = rest.slice(m[0].length); continue; }
      const m2 = rest.match(/^([А-ЯA-Z]{2,})\./); // unknown dotted (ИВ., АЛ.)
      if (m2) { out += title(m2[1]) + '.'; rest = rest.slice(m2[0].length); continue; }
      break;
    }
    if (rest) out += word(rest, dict);
    if (!firstDone) {
      firstDone = true;
      // sentence style: capitalize the first regular word, but a leading
      // lowercase abbreviation (ул., ж.к., с.) stays lowercase like on the
      // base map
      if (!abbrStart) out = out.replace(/[А-Яа-яA-Za-z]/, (c) => c.toUpperCase());
    }
    return out;
  }).join('');
}

// ---------- Cyrillic → Latin, the Streamlined System ----------
//
// The street-name labels carry the Latin reading under the Cyrillic one, in the
// system Bulgaria itself uses: the 2009 Transliteration Act put it on the street
// plates, the road signs and every Bulgarian passport, so "Граф Игнатиев" reads
// "Graf Ignatiev" here exactly as it does on the corner of the street. OSM's own
// Latin tags were measured against this and dropped: name:en covers 79% of the
// distinct names in the Sofia extract but keeps sliding into translation
// ("Околовръстен път" → "Ring Road", "бул. Христофор Колумб" → "Christopher
// Columbus Blvd."), and int_name (75%) cannot decide between "bul. Tsarigradsko
// shose" and "Bryuksel Blvd.". One standard applied by us covers every name with
// one convention.
const BG_LETTER = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's',
  т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sht',
  ъ: 'a', ь: 'y', ю: 'yu', я: 'ya',
};
// The Act's own two exceptions: a word-final -ия is written -ia (София → Sofia,
// Мария → Maria, not Sofiya/Mariya), and the country keeps its traditional
// spelling — which is why бул. България is Bulgaria, not Balgariya.
const BG_EXCEPT = new Map([['българия', 'Bulgaria']]);
const BG_WORD = /[А-Яа-яЁё]+/g;

const bgWord = (word) => {
  const low = word.toLowerCase();
  const caps = word.length > 1 && word === word.toUpperCase();
  const exc = BG_EXCEPT.get(low);
  if (exc) return caps ? exc.toUpperCase() : word[0] === low[0] ? exc.toLowerCase() : exc;
  let src = low, tail = '';
  if (src.length > 2 && src.endsWith('ия')) { src = src.slice(0, -2); tail = 'ia'; }
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const chunk = BG_LETTER[src[i]] ?? src[i];
    const up = word[i] !== src[i];  // this letter was written in capitals
    out += caps ? chunk.toUpperCase() : up ? chunk.charAt(0).toUpperCase() + chunk.slice(1) : chunk;
  }
  return out + (caps ? tail.toUpperCase() : tail);
};

// Latin fragments, digits and punctuation pass through untouched, so
// "бул. Александър С. Пушкин" comes out "bul. Aleksandar S. Pushkin".
export function latinize(name) {
  if (!name) return name;
  BG_WORD.lastIndex = 0;
  if (!BG_WORD.test(name)) return name;
  BG_WORD.lastIndex = 0;
  return name.replace(BG_WORD, bgWord);
}
