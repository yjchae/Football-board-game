// 한국어 조사 자동 선택: 받침 유무에 따라 "이/가", "을/를", "은/는"
function hasBatchim(word: string): boolean {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return false; // 한글이 아니면 받침 없음으로 처리
  return (last - 0xac00) % 28 !== 0;
}

/** josa('한별', '이/가') → '한별이' */
export function josa(word: string, pair: '이/가' | '을/를' | '은/는' | '와/과'): string {
  const [withB, withoutB] = pair.split('/');
  return word + (hasBatchim(word) ? withB : withoutB);
}
