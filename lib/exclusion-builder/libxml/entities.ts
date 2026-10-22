/**
 * The named character references libxml's HTML parser (2.9.x, the one PHP's
 * DOMDocument loads pages with) decodes inside attribute values: the 252
 * HTML 4.01 entities plus `apos` — exactly 253, measured by feeding every
 * HTML5 name through it. Any other `&name;` stays literal text there, so a
 * name absent from this table must stay literal here too.
 */

/** The names of U+00A0–U+00FF, in code point order (one per code point). */
const LATIN1_NAMES =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';

/** Every other name, as `name:hex code point` pairs. */
const OTHER_NAMES =
  'quot:22 amp:26 apos:27 lt:3c gt:3e OElig:152 oelig:153 Scaron:160 scaron:161 Yuml:178 fnof:192 circ:2c6 tilde:2dc Alpha:391 Beta:392 Gamma:393 Delta:394 Epsilon:395 Zeta:396 Eta:397 Theta:398 Iota:399 Kappa:39a Lambda:39b Mu:39c Nu:39d Xi:39e Omicron:39f Pi:3a0 Rho:3a1 Sigma:3a3 Tau:3a4 Upsilon:3a5 Phi:3a6 Chi:3a7 Psi:3a8 Omega:3a9 alpha:3b1 beta:3b2 gamma:3b3 delta:3b4 epsilon:3b5 zeta:3b6 eta:3b7 theta:3b8 iota:3b9 kappa:3ba lambda:3bb mu:3bc nu:3bd xi:3be omicron:3bf pi:3c0 rho:3c1 sigmaf:3c2 sigma:3c3 tau:3c4 upsilon:3c5 phi:3c6 chi:3c7 psi:3c8 omega:3c9 thetasym:3d1 upsih:3d2 piv:3d6 ensp:2002 emsp:2003 thinsp:2009 zwnj:200c zwj:200d lrm:200e rlm:200f ndash:2013 mdash:2014 lsquo:2018 rsquo:2019 sbquo:201a ldquo:201c rdquo:201d bdquo:201e dagger:2020 Dagger:2021 bull:2022 hellip:2026 permil:2030 prime:2032 Prime:2033 lsaquo:2039 rsaquo:203a oline:203e frasl:2044 euro:20ac image:2111 weierp:2118 real:211c trade:2122 alefsym:2135 larr:2190 uarr:2191 rarr:2192 darr:2193 harr:2194 crarr:21b5 lArr:21d0 uArr:21d1 rArr:21d2 dArr:21d3 hArr:21d4 forall:2200 part:2202 exist:2203 empty:2205 nabla:2207 isin:2208 notin:2209 ni:220b prod:220f sum:2211 minus:2212 lowast:2217 radic:221a prop:221d infin:221e ang:2220 and:2227 or:2228 cap:2229 cup:222a int:222b there4:2234 sim:223c cong:2245 asymp:2248 ne:2260 equiv:2261 le:2264 ge:2265 sub:2282 sup:2283 nsub:2284 sube:2286 supe:2287 oplus:2295 otimes:2297 perp:22a5 sdot:22c5 lceil:2308 rceil:2309 lfloor:230a rfloor:230b lang:2329 rang:232a loz:25ca spades:2660 clubs:2663 hearts:2665 diams:2666';

/** The table, built on first use (most pages never need it). */
let table: ReadonlyMap<string, number> | null = null;

/**
 * The code point libxml decodes `&name;` to, or `undefined` when it keeps
 * the reference as literal text. Names are case-sensitive (`&AMP;` stays).
 *
 * @param name The reference name, without `&` and `;`.
 */
export function libxmlEntityCodePoint(name: string): number | undefined {
  if (table === null) {
    const built = new Map<string, number>();
    LATIN1_NAMES.split(' ').forEach((entity, index) => built.set(entity, 0xa0 + index));
    for (const pair of OTHER_NAMES.split(' ')) {
      const [entity = '', hex = ''] = pair.split(':');
      built.set(entity, Number.parseInt(hex, 16));
    }
    table = built;
  }
  return table.get(name);
}
