// ネイティブタブバー: iOS 26ではLiquid Glass、旧iOSは従来バー、AndroidはMaterial 3。
// OSに描画を委ねるため、JS側の tabBarStyle 等は使えない（色はtintColorのみ）。
// 注意（expo-routerのドキュメントより）:
//  ・タブは静的に定義する（動的な増減は状態を失う）
//  ・タブバーの高さは取得できない → 下端の余白は insets.bottom で取る
//  ・FlatListはscroll-to-top等が効かないことがある（このアプリはScrollView構成）
import { NativeTabs, NativeTabTrigger } from 'expo-router/unstable-native-tabs';
import { C } from '@/lib/ui';
import { GuideProvider } from '@/components/GuideTour';
import { t, useLocale } from '@/lib/i18n';

export default function TabsLayout() {
  useLocale(); // 言語を切り替えたらタブ名も即座に追従
  return (
    <GuideProvider>
      {/* 触覚はOSのタブバーが標準で返すため自前実装は不要 */}
      <NativeTabs tintColor={C.teal}>
        <NativeTabTrigger name="log">
          <NativeTabTrigger.Icon sf={{ default: 'fork.knife', selected: 'fork.knife' }} md="restaurant" />
          <NativeTabTrigger.Label>{t('食事')}</NativeTabTrigger.Label>
        </NativeTabTrigger>
        <NativeTabTrigger name="training">
          <NativeTabTrigger.Icon sf={{ default: 'figure.strengthtraining.traditional', selected: 'figure.strengthtraining.traditional' }} md="fitness_center" />
          <NativeTabTrigger.Label>{t('運動')}</NativeTabTrigger.Label>
        </NativeTabTrigger>
        <NativeTabTrigger name="coach">
          <NativeTabTrigger.Icon sf={{ default: 'bubble.left', selected: 'bubble.left.fill' }} md="chat" />
          <NativeTabTrigger.Label>{t('相談')}</NativeTabTrigger.Label>
        </NativeTabTrigger>
        <NativeTabTrigger name="changes">
          <NativeTabTrigger.Icon sf={{ default: 'chart.line.uptrend.xyaxis', selected: 'chart.line.uptrend.xyaxis' }} md="monitoring" />
          <NativeTabTrigger.Label>{t('概要')}</NativeTabTrigger.Label>
        </NativeTabTrigger>
        <NativeTabTrigger name="goal" hidden />
        <NativeTabTrigger name="settings" hidden />
      </NativeTabs>
    </GuideProvider>
  );
}
