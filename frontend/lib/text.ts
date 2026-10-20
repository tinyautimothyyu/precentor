// Chinese/Japanese/Korean characters (SongSelect's search doesn't match these).
const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;

export function hasCjk(text: string): boolean {
  return CJK.test(text);
}
