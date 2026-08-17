// AIコーチのブランドロゴ: ティール→スカイのグラデーション円＋Sparkles線画
// （生脳絵文字🧠の後継。Apple Intelligence系の清潔なトーン）
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Sparkles } from 'lucide-react-native';
import { C } from '@/lib/ui';

export default function AiCoachLogo({ size = 64 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <LinearGradient
        colors={['rgba(13,148,136,0.10)', 'rgba(14,165,233,0.22)']}
        start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }}
        style={{
          width: size, height: size, borderRadius: size / 2,
          alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: 'rgba(13,148,136,0.18)',
        }}
      >
        <Sparkles color={C.teal} size={size * 0.46} strokeWidth={2} />
      </LinearGradient>
    </View>
  );
}
