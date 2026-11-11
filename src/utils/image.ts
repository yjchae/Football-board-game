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

/**
 * 0~1000 비율 좌표(box)를 실제 픽셀 영역으로 바꾼다.
 * 카드 테두리가 잘리지 않게 약간의 여백(pad)을 더한다.
 */
export function boxToRect(
  box: [number, number, number, number],
  width: number,
  height: number,
  pad = 0.03,
): { x: number; y: number; w: number; h: number } {
  const [ymin, xmin, ymax, xmax] = box.map((v) => v / 1000);
  const px = (xmax - xmin) * pad;
  const py = (ymax - ymin) * pad;
  const x0 = Math.max(0, xmin - px) * width;
  const y0 = Math.max(0, ymin - py) * height;
  const x1 = Math.min(1, xmax + px) * width;
  const y1 = Math.min(1, ymax + py) * height;
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}

/** 단체 사진에서 카드 한 장 부분만 잘라 썸네일로 만든다 */
export async function cropImage(dataUrl: string, box: [number, number, number, number], maxSize = 320): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const img = await loadImage(blob);
  const r = boxToRect(box, img.width, img.height);
  const scale = Math.min(1, maxSize / Math.max(r.w, r.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(r.w * scale));
  canvas.height = Math.max(1, Math.round(r.h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지 처리를 지원하지 않는 브라우저예요.');
  ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}
