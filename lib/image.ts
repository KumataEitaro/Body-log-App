'use client';

export type ResizedImage = { blob: Blob; dataUrl: string; base64: string; mime: string };

// 写真を長辺1024pxのJPEGに縮小（アップロード・AI送信用）
export async function resizeImage(file: File | Blob): Promise<ResizedImage> {
  const dataUrl: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img: HTMLImageElement = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const MAX = 1024;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const outUrl = canvas.toDataURL('image/jpeg', 0.82);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.82));
  return { blob, dataUrl: outUrl, base64: outUrl.split(',')[1], mime: 'image/jpeg' };
}
