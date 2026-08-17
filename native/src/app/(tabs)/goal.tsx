// 目標は「変化」タブに統合済み（タブ5個化）。旧リンク互換のためリダイレクトのみ残す
import { Redirect } from 'expo-router';

export default function GoalRedirect() {
  return <Redirect href="/(tabs)/changes" />;
}
