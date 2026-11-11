// 한국어 조사 자동 선택: 받침 유무에 따라 "이/가", "을/를", "은/는", "과/와", "으로/로"

function lastHangul(word: string): number | null {
  const code = word.charCodeAt(word.length - 1);
  return code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : null;
}

function hasBatchim(word: string): boolean {
  const jong = lastHangul(word);
  return jong !== null && jong !== 0; // 한글이 아니면 받침 없음으로 처리
}

/** 앞쪽이 받침 있을 때, 뒤쪽이 받침 없을 때 */
export type JosaPair = '이/가' | '을/를' | '은/는' | '과/와' | '으로/로';

/** josa('한별', '이/가') → '한별이', josa('로운', '을/를') → '로운을' */
export function josa(word: string, pair: JosaPair): string {
  if (pair === '으로/로') {
    // ㄹ 받침(8)은 '로'
    const jong = lastHangul(word);
    return word + (jong && jong !== 8 ? '으로' : '로');
  }
  const [withB, withoutB] = pair.split('/');
  return word + (hasBatchim(word) ? withB : withoutB);
}
