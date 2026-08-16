// （テンプレートの名残。ルート衝突を避けるためリダイレクトのみ）
import { Redirect } from 'expo-router';

export default function Explore() {
  return <Redirect href="/(tabs)/log" />;
}
