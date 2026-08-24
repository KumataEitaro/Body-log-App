// ダイエット目的のプリセット（サーバ側）。
// 値は native/src/lib/purpose.ts と同じにすること（keyはDBに保存され、両方が読む）。
export const PURPOSE_PRESETS: Record<string, { label: string; p: number; f: number }> = {
  cut_lean: { label: '筋肉を守りながらしっかり減量', p: 2.0, f: 0.8 },
  cut_std:  { label: 'バランスよく減量', p: 1.6, f: 0.9 },
  easy:     { label: 'ゆるく健康的に', p: 1.2, f: 1.0 },
  bulk:     { label: '筋肉をつける', p: 1.8, f: 1.0 },
};
