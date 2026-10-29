/**
 * Synchronous SHA-512 and SHA-384 (FIPS 180-4) over a string's UTF-8
 * bytes, lowercase hex — for pure code that must digest without awaiting
 * (Web Crypto's digest is asynchronous). 64-bit words are carried as
 * high/low 32-bit halves in typed arrays and locals — no allocation per
 * operation, so a multi-megabyte input digests in tens of milliseconds.
 * Halves are added as unsigned numbers (exact below 2^53) and the low
 * sum's excess is carried into the high half; typed-array stores and `| 0`
 * wrap mod 2^32.
 */

/** The 80 round constants as high/low pairs (first 64 bits of the cube roots' fractional parts of the first 80 primes). */
const K = new Uint32Array([
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc,
  0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
  0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2,
  0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
  0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65,
  0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
  0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4,
  0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
  0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df,
  0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30,
  0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
  0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8,
  0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
  0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec,
  0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
  0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178,
  0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
  0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c,
  0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817
]);

/** SHA-512's initial hash value (square roots of the first 8 primes), high/low pairs. */
const H512 = [
  0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
  0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179
];

/** SHA-384's initial hash value (square roots of the 9th–16th primes), high/low pairs. */
const H384 = [
  0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
  0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4
];

/**
 * One 32-bit half of a fixed-size table. Every index used below is inside
 * its table by construction, so the read is total; the assertion only
 * narrows the unchecked-index type.
 */
function half(table: Uint32Array | Int32Array | readonly number[], index: number): number {
  return table[index] as number;
}

/**
 * The carry out of an unsigned sum of low halves.
 *
 * @param low The sum (non-negative, below 2^53).
 */
function carry(low: number): number {
  return Math.floor(low / 0x1_0000_0000);
}

/**
 * The message padded to whole 128-byte blocks: a 1 bit, zeros, then the
 * bit length as a 128-bit big-endian integer.
 *
 * @param bytes The message.
 */
function pad(bytes: Uint8Array): DataView {
  const blocks = Math.ceil((bytes.length + 17) / 128);
  const padded = new Uint8Array(blocks * 128);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  return view;
}

/**
 * Add a 64-bit word into the state, mod 2^64.
 *
 * @param state The state.
 * @param index The word's high-half index.
 * @param high The word's high half.
 * @param low The word's low half.
 */
function addInto(state: Int32Array, index: number, high: number, low: number): void {
  const sum = (half(state, index + 1) >>> 0) + (low >>> 0);
  state[index + 1] = sum;
  state[index] = half(state, index) + high + carry(sum);
}

/**
 * Expand one 128-byte block into the 80-word message schedule (σ0 =
 * rotr 1 ^ rotr 8 ^ shr 7, σ1 = rotr 19 ^ rotr 61 ^ shr 6).
 *
 * @param w The schedule (160 halves), overwritten.
 * @param view The padded message.
 * @param offset The block's byte offset.
 */
function schedule(w: Int32Array, view: DataView, offset: number): void {
  for (let t = 0; t < 32; t += 1) w[t] = view.getInt32(offset + t * 4);
  for (let t = 32; t < 160; t += 2) {
    let xh = half(w, t - 30);
    let xl = half(w, t - 29);
    const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
    const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
    xh = half(w, t - 4);
    xl = half(w, t - 3);
    // rotr 61 = rotr 29 of the swapped halves.
    const s1h = ((xh >>> 19) | (xl << 13)) ^ ((xl >>> 29) | (xh << 3)) ^ (xh >>> 6);
    const s1l = ((xl >>> 19) | (xh << 13)) ^ ((xh >>> 29) | (xl << 3)) ^ ((xl >>> 6) | (xh << 26));
    const low = (s0l >>> 0) + (s1l >>> 0) + (half(w, t - 13) >>> 0) + (half(w, t - 31) >>> 0);
    w[t + 1] = low;
    w[t] = s0h + s1h + half(w, t - 14) + half(w, t - 32) + carry(low);
  }
}

/**
 * The 80 rounds over one scheduled block, added into the state (Σ0 =
 * rotr 28 ^ rotr 34 ^ rotr 39, Σ1 = rotr 14 ^ rotr 18 ^ rotr 41; a
 * rotation past 32 is the rotation by its excess of the swapped halves).
 *
 * @param state The hash state (16 halves), updated.
 * @param w The block's schedule.
 */
function rounds(state: Int32Array, w: Int32Array): void {
  let ah = half(state, 0);
  let al = half(state, 1);
  let bh = half(state, 2);
  let bl = half(state, 3);
  let ch = half(state, 4);
  let cl = half(state, 5);
  let dh = half(state, 6);
  let dl = half(state, 7);
  let eh = half(state, 8);
  let el = half(state, 9);
  let fh = half(state, 10);
  let fl = half(state, 11);
  let gh = half(state, 12);
  let gl = half(state, 13);
  let hh = half(state, 14);
  let hl = half(state, 15);
  for (let t = 0; t < 160; t += 2) {
    const sum1h =
      ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
    const sum1l =
      ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
    const chooseH = (eh & fh) ^ (~eh & gh);
    const chooseL = (el & fl) ^ (~el & gl);
    const t1l =
      (hl >>> 0) + (sum1l >>> 0) + (chooseL >>> 0) + half(K, t + 1) + (half(w, t + 1) >>> 0);
    const t1h = hh + sum1h + chooseH + half(K, t) + half(w, t) + carry(t1l);
    const sum0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
    const sum0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
    const majorityH = (ah & bh) ^ (ah & ch) ^ (bh & ch);
    const majorityL = (al & bl) ^ (al & cl) ^ (bl & cl);
    const t2l = (sum0l >>> 0) + (majorityL >>> 0);
    const t2h = sum0h + majorityH + carry(t2l);
    hh = gh;
    hl = gl;
    gh = fh;
    gl = fl;
    fh = eh;
    fl = el;
    const newEl = (dl >>> 0) + (t1l >>> 0);
    eh = (dh + t1h + carry(newEl)) | 0;
    el = newEl | 0;
    dh = ch;
    dl = cl;
    ch = bh;
    cl = bl;
    bh = ah;
    bl = al;
    const newAl = (t1l >>> 0) + (t2l >>> 0);
    ah = (t1h + t2h + carry(newAl)) | 0;
    al = newAl | 0;
  }
  addInto(state, 0, ah, al);
  addInto(state, 2, bh, bl);
  addInto(state, 4, ch, cl);
  addInto(state, 6, dh, dl);
  addInto(state, 8, eh, el);
  addInto(state, 10, fh, fl);
  addInto(state, 12, gh, gl);
  addInto(state, 14, hh, hl);
}

/**
 * The SHA-512 compression over a whole message from an initial value.
 *
 * @param text The input (lone surrogates encode as U+FFFD, as `TextEncoder` does).
 * @param initial The initial hash value (high/low pairs).
 * @returns The final state as sixteen 32-bit halves.
 */
function digest(text: string, initial: readonly number[]): Int32Array {
  const view = pad(new TextEncoder().encode(text));
  const state = Int32Array.from(initial);
  const w = new Int32Array(160);
  for (let offset = 0; offset < view.byteLength; offset += 128) {
    schedule(w, view, offset);
    rounds(state, w);
  }
  return state;
}

/**
 * Lowercase hex of the first halves of a state.
 *
 * @param state The state.
 * @param halves How many halves to write.
 */
function hexOf(state: Int32Array, halves: number): string {
  let hex = '';
  for (let index = 0; index < halves; index += 1) {
    hex += (half(state, index) >>> 0).toString(16).padStart(8, '0');
  }
  return hex;
}

/**
 * SHA-512 of a string's UTF-8 encoding.
 *
 * @param text The input.
 * @returns The 128-character lowercase hex digest.
 */
export function sha512Hex(text: string): string {
  return hexOf(digest(text, H512), 16);
}

/**
 * SHA-384 of a string's UTF-8 encoding (SHA-512 from its own initial
 * value, truncated to six words).
 *
 * @param text The input.
 * @returns The 96-character lowercase hex digest.
 */
export function sha384Hex(text: string): string {
  return hexOf(digest(text, H384), 12);
}
