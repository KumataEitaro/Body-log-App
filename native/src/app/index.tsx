// ルート: 食事タブへ（認証ゲートは_layoutが処理）
import { Redirect } from 'expo-router';

export default function Index() {
  return <Redirect href="/(tabs)/log" />;
}
