// （テンプレートの名残。ルート衝突を避けるためリダイレクトのみ）
import { Redirect } from 'expo-router';
import { useThemeRefresh } from '@/lib/theme';

export default function Explore() {
  useThemeRefresh(); // テーマ変更で再描画（再マウントはしない・lib/theme.ts）
  return <Redirect href="/(tabs)/log" />;
}
