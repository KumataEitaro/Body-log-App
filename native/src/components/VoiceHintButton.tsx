// 音声入力ボタン（入力ドック）
//
// 1500人監査Later群「入力が遅い層への救済」。iOSのキーボードには標準でマイクが付いているが、
// **アプリの中に音声の入口が見えない**ため「話しかけるだけで記録できる」というこのアプリの
// コンセプトが伝わっていなかった（＝機能は既にあるのに、無いものとして扱われていた）。
//
// 【方式の判断】新しい依存は足していない。SDK 57 の Expo が公式に提供する音声モジュールは
// expo-speech（読み上げ＝TTS）だけで、音声認識（STT）は公式に無い。認識を入れるとしたら
// expo-speech-recognition のような第三者ネイティブモジュールで、dev client の作り直し・
// マイク/音声認識の権限文言・App Store 審査の追加項目まで連鎖する。
// 一方 iOS キーボードのディクテーションは端末の機能として既に完全に動く。
// そこで「認識をアプリに実装する」のではなく「既にある認識への道しるべを置く」に留めた。
// タップでキーボードのマイクの使い方を1回だけ案内し、以後は入力欄にフォーカスするだけ。
import { useCallback } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Mic } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import DockIconButton from '@/components/DockIconButton';
import { t } from '@/lib/i18n';

const SEEN_KEY = 'bl-voice-hint-seen';

export default function VoiceHintButton({ onFocusInput, mode = 'log' }: {
  /** 案内を閉じたあとに入力欄へフォーカスする（キーボード＝マイクの在り処を開く） */
  onFocusInput: () => void;
  mode?: 'log' | 'coach';
}) {
  const press = useCallback(async () => {
    Haptics.selectionAsync().catch(() => {});
    let seen = false;
    try { seen = (await AsyncStorage.getItem(SEEN_KEY)) === '1'; } catch { /* 読めなければ案内を出す */ }
    if (seen) { onFocusInput(); return; }
    AsyncStorage.setItem(SEEN_KEY, '1').catch(() => {});
    Alert.alert(
      t('声で記録する'),
      mode === 'coach'
        ? t('声でも相談できます。キーボードの🎤を押して「昨日食べすぎました」のように話してみてください。')
        : t('話しかけて記録できます。キーボードの🎤を押して「親子丼とみそ汁」のように話してみてください。'),
      [{ text: t('やってみる'), onPress: onFocusInput }],
    );
  }, [onFocusInput, mode]);

  return <DockIconButton Icon={Mic} onPress={() => { press().catch(() => {}); }} />;
}
