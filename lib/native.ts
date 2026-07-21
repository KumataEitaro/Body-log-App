'use client';
// ネイティブアプリ（Capacitor）専用機能のヘルパー。
// すべて動的importで、ブラウザ実行時は静かに何もしない（Web版の挙動に影響ゼロ）。

export type NativePhoto = { blob: Blob; dataUrl: string; base64: string; mime: string };

type CapGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
};

function capGlobal(): CapGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
}

// タップハンドラ内で使う同期判定。
// awaitを挟んでからfileInput.click()を呼ぶと、ブラウザ（特にiOS Safari）が
// ユーザー操作由来と認めずクリックを無視するため、クリック分岐は必ずこちらを使う。
// ネイティブではCapacitorブリッジがページ読み込み前にwindow.Capacitorを注入している。
export function isNativeSync(): boolean {
  return !!capGlobal()?.isNativePlatform?.();
}

// ネイティブかつCameraプラグインが今のアプリバイナリに入っているか（同期）。
// 古いTestFlightビルドはプラグイン未搭載のことがあり、その場合はWebのファイル選択に落とす。
export function isNativeCameraAvailable(): boolean {
  const cap = capGlobal();
  return !!cap?.isNativePlatform?.() && cap.isPluginAvailable?.('Camera') === true;
}

export async function getIsNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// 起動時の見た目調整（ステータスバーをダーク面に合わせる）
export async function setupNativeChrome(): Promise<void> {
  if (!(await getIsNative())) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
  } catch { /* 非対応環境は無視 */ }
}

// 保存成功などの触覚フィードバック
export async function hapticSuccess(): Promise<void> {
  if (!(await getIsNative())) return;
  try {
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    await Haptics.notification({ type: NotificationType.Success });
  } catch { /* 無視 */ }
}

// 軽いタップ感（チップ追加・削除など）
export async function hapticTap(): Promise<void> {
  if (!(await getIsNative())) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch { /* 無視 */ }
}

// ネイティブのカメラ/フォトピッカーで1枚取得（1024px・JPEG圧縮済み）
export async function pickPhotoNative(): Promise<NativePhoto | null> {
  if (!(await getIsNative())) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt, // 撮影 or ライブラリを選ばせる
      quality: 80,
      width: 1024,
      correctOrientation: true,
    });
    const base64 = photo.base64String;
    if (!base64) return null;
    const mime = 'image/jpeg';
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return { blob: new Blob([arr], { type: mime }), dataUrl: `data:${mime};base64,${base64}`, base64, mime };
  } catch {
    return null; // キャンセル・権限拒否
  }
}

// 毎日のリマインド通知（端末内で完結・サーバー不要）
export async function setDailyReminder(enabled: boolean, hour = 20, minute = 0): Promise<boolean> {
  if (!(await getIsNative())) return false;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id: 1 }] }).catch(() => { /* 未登録なら無視 */ });
    if (!enabled) return true;
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') return false;
    await LocalNotifications.schedule({
      notifications: [{
        id: 1,
        title: 'BodyLog',
        body: '今日の記録はまだですか？📝 続けることが一番の近道です',
        schedule: { on: { hour, minute } }, // 毎日この時刻に繰り返し
      }],
    });
    return true;
  } catch {
    return false;
  }
}

// アプリアイコンのバッジ（今日未記録なら1、記録済みなら消す）
export async function setTodayRecordedBadge(recorded: boolean): Promise<void> {
  if (!(await getIsNative())) return;
  try {
    const { Badge } = await import('@capawesome/capacitor-badge');
    if (recorded) {
      await Badge.clear();
    } else {
      const perm = await Badge.checkPermissions();
      if (perm.display !== 'granted') {
        const req = await Badge.requestPermissions();
        if (req.display !== 'granted') return;
      }
      await Badge.set({ count: 1 });
    }
  } catch { /* 無視 */ }
}
