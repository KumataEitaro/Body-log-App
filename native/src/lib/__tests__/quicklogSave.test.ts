// 食事の保存が失敗したときの振る舞い（2026-09-14）。
//
// 事故の形: 実機で「保存に失敗しました。もう一度お試しください。」だけが出て、
// 4品ぶん書いた食事が保存できなかった。原因を示す手がかりがゼロで、
//   ・圏外なのか（もう一度押せば直る）
//   ・ログインが切れているのか（押しても直らない）
//   ・DBの列が足りないのか（開発者が直すしかない）
// のどれかすら分からなかった。体の写真で同じ問題を踏んだときと同じく、
// **DBのエラー本文を必ず添える**ようにした。あわせて圏外なら記録を捨てずにキューへ積む。
//
// ここで固定するのは3つ:
//   1. 圏外 → キューに積んで ok:true, queued:true（食事を失わない）
//   2. 書き換え中（queueOffline:false）の圏外 → 積まずに ok:false（古い行を消してから消える事故を防ぐ）
//   3. DBの拒否 → ok:false で、error に**理由の本文が含まれる**
import { saveErrorText } from '../quicklog';

describe('saveErrorText: 保存できなかった理由を本人の次の行動に翻訳する', () => {
  it('RLS・権限・JWT のエラーは「ログインし直す」を促し、本文も添える', () => {
    const msg = 'new row violates row-level security policy for table "logs"';
    const s = saveErrorText(msg);
    expect(s).toContain('ログイン');
    expect(s).toContain(msg);   // 本文を捨てない（1回の報告で切り分けが終わる）
  });

  it('列が無い・スキーマキャッシュのエラーは「開発者に伝えて」と本文を出す', () => {
    const msg = "Could not find the 'waist' column of 'logs' in the schema cache";
    const s = saveErrorText(msg);
    expect(s).toContain('データベース');
    expect(s).toContain(msg);
  });

  it('その他のエラーも必ず本文を添える（「もう一度お試しください」だけで終わらせない）', () => {
    const msg = 'invalid input syntax for type numeric: "NaN"';
    const s = saveErrorText(msg);
    expect(s).toContain(msg);
  });

  it('理由の本文が空でも文字列を返す（表示が空欄にならない）', () => {
    expect(saveErrorText('')).not.toBe('');
  });
});

describe('保存の呼び出し規約（ソースレベル）', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const SRC = path.resolve(__dirname, '..', '..');
  const quicklog = fs.readFileSync(path.join(SRC, 'lib', 'quicklog.ts'), 'utf8');
  const logTab = fs.readFileSync(path.join(SRC, 'app', '(tabs)', 'log.tsx'), 'utf8');

  it('saveParsed は失敗を握りつぶさず、DBのエラー本文を saveErrorText に通す', () => {
    expect(quicklog).toMatch(/saveErrorText\(error\.message\)/);
    // 旧実装（理由を捨てて固定文言を返す）が復活したら落とす
    expect(quicklog).not.toMatch(/error: t\('保存に失敗しました。もう一度お試しください。'\)/);
  });

  it('圏外は enqueue して queued を返す（食事を失わない）', () => {
    expect(quicklog).toMatch(/if \(isNetworkError\(error\)\)/);
    expect(quicklog).toMatch(/await enqueue\(row\)/);
    expect(quicklog).toMatch(/return \{ ok: true, queued: true \}/);
  });

  it('logs.ex は check 制約の値だけを送る（AIの範囲外の値で食事ごと弾かれない）', () => {
    expect(quicklog).toMatch(/EX_LEVELS as readonly string\[\]\)\.includes\(p\.ex\)/);
  });

  it('書き換え中は圏外キューに積まない（新しい行が届く前に古い行を消さない）', () => {
    expect(logTab).toMatch(/queueOffline: editingId == null/);
  });

  it('圏外で積んだときは、フィードに出ない理由を伝える', () => {
    expect(logTab).toMatch(/圏外のため端末に保存しました。電波が戻ったら自動で同期され、フィードに出ます。/);
  });

  it('圏外キューの送信はアプリ全体（_layout）から起こす（食事タブから積んだぶんも同期される）', () => {
    const layout = fs.readFileSync(path.join(SRC, 'app', '_layout.tsx'), 'utf8');
    expect(layout).toMatch(/flushOfflineQueue\(\)/);
    expect(layout).toMatch(/AppState\.addEventListener\('change'/);
  });
});
