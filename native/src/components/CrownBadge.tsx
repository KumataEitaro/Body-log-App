// 王冠バッジ（MFP式ゲーティングの目印）。有料機能を隠さず「👑つきで見せる」ための
// 小さなマーク。表示するかどうかの判定は useGate().gated(feature) が正本で、
// このコンポーネントは見た目だけを担当する（各画面が自分のレイアウトに置く）。
import { View } from 'react-native';
import { Crown } from 'lucide-react-native';
import { C, rgba } from '@/lib/ui';

export default function CrownBadge({ size = 16 }: { size?: number }) {
  // アンバーの淡い円座布団＋王冠。責め色にせず「開けるお楽しみ」のトーンにする
  const box = Math.round(size * 1.5);
  return (
    <View style={{
      width: box, height: box, borderRadius: 999,
      backgroundColor: rgba(C.amber, 0.14),
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Crown size={size} color={C.amber} fill={rgba(C.amber, 0.35)} strokeWidth={1.8} />
    </View>
  );
}
