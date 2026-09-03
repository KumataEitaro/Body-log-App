// 起動シーケンスの安全化と、起動時エラーの端末内記録。
//
// ■ 何のために在るか
// Androidの初回リリースで「起動直後に落ちる」事故が出たが、内部テストではPlayの
// リリース前レポートが作られず、Android vitalsも反映待ちで、スタックトレースが
// 一切手に入らなかった。1箇所ずつ当て推量で直すのは非効率なので、方針を変えた:
//
//   「原因を当てる」のではなく「落ちない構造にして、原因を端末に記録させる」。
//
// 起動時の初期化（言語・単位・テーマ・通知・ヘルスケア…）はどれも
// 「失敗しても画面は出せる」性質のものばかりで、1つの失敗でレンダリングまで
// 止める理由が無い。safeBoot() で1つずつ独立に受け止め、失敗は AsyncStorage の
// 'bl-boot-errors' に積む。設定画面の最下部から中身が読めるので、次に落ちても
// 「どの初期化がコケたか」が本人の画面から見える。
//
// ■ 同期例外もPromiseの拒否も両方拾う
// `useEffect(() => { loadFoo(); }, [])` の loadFoo が async 関数でも、
// 「await より前の throw」は同期例外として飛ぶ（async関数なら拒否になるが、
// 非asyncのラッパーを噛ませていると同期に化ける）。safeBoot は
//   ・fn() 呼び出し自体の try/catch（同期例外）
//   ・戻り値が Promise なら then の rejection ハンドラ（非同期の失敗）
// の二重で受ける。どちらの経路でも記録に残る。
//
// ■ 純関数を分けてある理由
// AsyncStorageに触る部分（record/read/clear/flush）と、リストの合成・整形
// （appendBootError / parseBootErrors / formatBootErrors / describeBootError）を
// 分離してある。判断のある部分は全部純関数なのでjestで固定できる。
import AsyncStorage from '@react-native-async-storage/async-storage';

/** AsyncStorage: 起動時エラーの記録（新しいものが先頭・最大 BOOT_ERRORS_MAX 件） */
export const BOOT_ERRORS_KEY = 'bl-boot-errors';
/** 保持件数。端末を圧迫せず、かつ「毎回コケる複数箇所」を見落とさない程度 */
export const BOOT_ERRORS_MAX = 20;

/**
 * 起動時エラー1件。
 * count は「同じ name×message が何回起きたか」（起動ごとに毎回コケているのが分かる）。
 * sent は crash_reports へ送り終えたか（同じものを毎回送らないための印）。
 */
export type BootError = {
  name: string;
  message: string;
  at: string;        // ISO8601
  count?: number;
  sent?: boolean;
};

// ===== 純関数（jestで固定する） =====

/** 例外オブジェクトを1行のメッセージに畳む。何が飛んできても必ず文字列になる */
export function describeBootError(e: unknown): string {
  if (e == null) return 'unknown error';
  if (typeof e === 'string') return e.slice(0, 400);
  if (e instanceof Error) {
    const name = e.name || 'Error';
    return `${name}: ${e.message || '(no message)'}`.slice(0, 400);
  }
  // Errorではないもの（文字列以外のthrow・ネイティブ側のオブジェクト）も拾う
  const obj = e as { name?: unknown; message?: unknown };
  if (typeof obj.message === 'string') {
    const name = typeof obj.name === 'string' ? obj.name : 'Error';
    return `${name}: ${obj.message}`.slice(0, 400);
  }
  try { return String(e).slice(0, 400); } catch { return 'unstringifiable error'; }
}

/**
 * リストへ1件足す（新しいものが先頭・最大max件）。
 * 同じ name×message が既にあれば行を増やさず、回数を足して先頭へ繰り上げる。
 * こうしないと「毎回同じ1件が失敗する」だけで20件が埋まり、別の失敗が押し出される。
 */
export function appendBootError(
  list: readonly BootError[],
  entry: BootError,
  max: number = BOOT_ERRORS_MAX,
): BootError[] {
  const i = list.findIndex((x) => x.name === entry.name && x.message === entry.message);
  if (i >= 0) {
    const prev = list[i];
    // 再発したので sent は落とす（同じ内容でも「また起きた」ことは送る価値がある）
    const merged: BootError = { ...entry, count: (prev.count ?? 1) + 1 };
    const rest = list.filter((_, k) => k !== i);
    return [merged, ...rest].slice(0, max);
  }
  return [entry, ...list].slice(0, max);
}

/** 保存済みJSONの復元。壊れていても絶対に throw せず、読める行だけ返す */
export function parseBootErrors(raw: string | null | undefined): BootError[] {
  if (!raw) return [];
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(v)) return [];
  const out: BootError[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    if (typeof o.name !== 'string' || typeof o.message !== 'string') continue;
    out.push({
      name: o.name,
      message: o.message,
      at: typeof o.at === 'string' ? o.at : '',
      ...(typeof o.count === 'number' && o.count > 1 ? { count: o.count } : {}),
      ...(o.sent === true ? { sent: true as const } : {}),
    });
    if (out.length >= BOOT_ERRORS_MAX) break;
  }
  return out;
}

/** まだ送っていない行だけ（crash_reportsへの重複送信を避ける） */
export function unsentBootErrors(list: readonly BootError[]): BootError[] {
  return list.filter((x) => x.sent !== true);
}

/** 全行を「送信済み」にした新しいリスト（表示用には残す＝消さない） */
export function markBootErrorsSent(list: readonly BootError[]): BootError[] {
  return list.map((x) => ({ ...x, sent: true as const }));
}

/** 設定画面での表示・コピー用の整形（1件1行）。空なら空文字 */
export function formatBootErrors(list: readonly BootError[]): string {
  return list
    .map((x) => {
      const times = (x.count ?? 1) > 1 ? ` (x${x.count})` : '';
      return `${x.at || '-'}  [${x.name}] ${x.message}${times}`;
    })
    .join('\n');
}

// ===== 端末への記録（AsyncStorage・絶対に throw しない） =====

/**
 * 1件記録する。呼び出し元を待たせないので Promise は返さない
 * （記録の失敗で起動処理を止めるのは本末転倒）。
 */
export function recordBootError(name: string, e: unknown): void {
  const message = describeBootError(e);
  // 開発中・adb logcat で見えるように必ずコンソールにも出す
  try { console.warn(`[boot:${name}]`, message); } catch { /* 出せなくても続ける */ }
  void (async () => {
    try {
      const raw = await AsyncStorage.getItem(BOOT_ERRORS_KEY);
      const next = appendBootError(parseBootErrors(raw), {
        name, message, at: new Date().toISOString(), count: 1,
      });
      await AsyncStorage.setItem(BOOT_ERRORS_KEY, JSON.stringify(next));
    } catch { /* 記録できなくてもアプリは動く */ }
  })();
}

/**
 * 起動処理を1つ、独立に実行する。
 * 同期例外・Promiseの拒否のどちらでも記録して飲み込み、他の初期化と
 * レンダリングを止めない。戻り値はそのまま返すので、後始末関数を返す初期化
 * （attachNotificationTapRouting）も `useEffect(() => safeBoot(...))` で使える。
 */
export function safeBoot<T>(name: string, fn: () => T): T | undefined {
  try {
    const r = fn();
    // then を持つ戻り値（Promise・thenable）は非同期の失敗もここで受ける。
    // .catch ではなく then(undefined, handler) を使うのは、catch を持たない
    // thenable（自前実装のPromise風オブジェクト）でも動くようにするため
    const thenable = r as unknown as { then?: unknown };
    if (r != null && typeof thenable.then === 'function') {
      (thenable.then as (a: undefined, b: (e: unknown) => void) => unknown)(
        undefined,
        (e: unknown) => recordBootError(name, e),
      );
    }
    return r;
  } catch (e) {
    recordBootError(name, e);
    return undefined;
  }
}

/** 記録の読み出し（設定画面用）。読めなければ空配列 */
export async function readBootErrors(): Promise<BootError[]> {
  try {
    return parseBootErrors(await AsyncStorage.getItem(BOOT_ERRORS_KEY));
  } catch { return []; }
}

/** 記録を消す（設定画面の「記録を消す」） */
export async function clearBootErrors(): Promise<void> {
  try { await AsyncStorage.removeItem(BOOT_ERRORS_KEY); } catch { /* 消せなくても害はない */ }
}

/**
 * 未送信の起動時エラーを crash_reports へ送る（既存のlib/crash.tsの経路をそのまま使う）。
 * 失敗は完全に無視し、成功したら「送信済み」の印だけ付けて中身は残す
 * （設定画面から後で読めるようにしておく＝ユーザーが口頭で伝えられる）。
 *
 * crash.ts の reportCrash は「1分に1件」の連投ガードを持つので、呼び出し側は
 * 起動直後の本物のクラッシュ報告に枠を譲るため数秒遅らせて呼ぶ（_layout.tsx 参照）。
 */
export async function flushBootErrors(): Promise<void> {
  try {
    const list = await readBootErrors();
    const unsent = unsentBootErrors(list);
    if (unsent.length === 0) return;
    // 動的importにするのは、crash.ts→supabase→AsyncStorage の連鎖を
    // 「送るものがある時」だけに限るため（起動を1msでも軽くする）
    const { reportCrash } = await import('./crash');
    await reportCrash('boot-errors', `${unsent.length} boot error(s)`, formatBootErrors(unsent), false);
    await AsyncStorage.setItem(BOOT_ERRORS_KEY, JSON.stringify(markBootErrorsSent(list)));
  } catch { /* 送れなくても端末内の記録は残る */ }
}
