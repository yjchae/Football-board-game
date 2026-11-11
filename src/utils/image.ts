// ─────────────────────────────────────────────
// 카드 사진 처리: 브라우저 저장공간을 아끼기 위해 축소·압축한다.
// ─────────────────────────────────────────────

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => reject(new Error('사진을 열 수 없어요.'));
    img.src = url;
  });
}

/** 긴 변을 maxSize로 줄인 JPEG dataURL */
export async function resizeImage(file: Blob, maxSize: number, quality = 0.82): Promise<string> {
  const img = await loadImage(file);
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지 처리를 지원하지 않는 브라우저예요.');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function dataUrlToBase64(dataUrl: string): { mimeType: string; base64: string } {
  const [head, base64] = dataUrl.split(',');
  const mimeType = head.match(/data:(.*?);/)?.[1] ?? 'image/jpeg';
  return { mimeType, base64 };
}
