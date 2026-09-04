// ルート: 食事タブへ（認証ゲートは_layoutが処理）
import { Redirect } from 'expo-router';
import { useThemeRefresh } from '@/lib/theme';

export default function Index() {
  useThemeRefresh(); // テーマ変更で再描画（再マウントはしない・lib/theme.ts）
  return <Redirect href="/(tabs)/log" />;
}
