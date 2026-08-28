// ホーム画面ウィジェットへのデータ受け渡し口（ローカルExpoモジュールのJS側）。
//
// 鉄則: native module が無い環境では静かに no-op（lib/widget.ts の呼び出し側は存在を気にしない）。
//  ・Expo Go / Web / Jest: requireNativeModule が throw → catch して null
//  ・Android: expo-module.config.json が platforms:["apple"] のため未登録 → 同上
//  ・ウィジェット未対応の旧iOSビルド: モジュールはあるが App Group が無い → Swift側で安全に no-op
import { requireNativeModule } from 'expo-modules-core';

type WidgetBridgeT = {
  setWidgetData(json: string): void;
};

let native: WidgetBridgeT | null = null;
try {
  native = requireNativeModule<WidgetBridgeT>('WidgetBridge');
} catch {
  native = null;
}

/** ウィジェット用の今日サマリーJSONを保存する（失敗してもアプリ本体に影響させない） */
export function setWidgetData(json: string): void {
  try {
    native?.setWidgetData(json);
  } catch {
    // 無視（ウィジェットはあくまで付随機能）
  }
}
