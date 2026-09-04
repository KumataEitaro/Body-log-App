// 目標は「変化」タブに統合済み（タブ5個化）。旧リンク互換のためリダイレクトのみ残す
import { Redirect } from 'expo-router';
import { useThemeRefresh } from '@/lib/theme';

export default function GoalRedirect() {
  useThemeRefresh(); // テーマ変更で再描画（再マウントはしない・lib/theme.ts）
  return <Redirect href="/(tabs)/changes" />;
}
