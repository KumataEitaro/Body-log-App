// 無料プラン向けバナー広告（AdMob・アンカー型アダプティブバナーのみ）。
//
// 方針:
// - 表示条件は useGate(): active（=RCキー設定済みの課金有効ビルド）かつ plan が null/'free' の
//   ときだけ描画する。現在の運用（RCキー未設定）では誰にも表示されない＝
//   「広告あり無料 ↔ 広告なしライトプラン」の差は課金列車と同時にしか点灯しない（仕組みで保証）
// - ATTダイアログは出さない。初回リリースは非パーソナライズ広告（NPA）固定
//   （requestNonPersonalizedAdsOnly: true）。パーソナライズ化は将来の改善
// - インタースティシャル・リワード等は使わない。広告は静かに（触覚・アニメなし）
// - 読み込み失敗時は onAdFailedToLoad で全体を高さ0に畳む（空白の枠を見せない）
//
// Expo Goにはネイティブモジュールが無いため、health.tsと同じ流儀の動的requireで
// 存在しない環境でもアプリ全体を落とさない。
import { useEffect, useState } from 'react';
import { View, Text, Pressable, Platform, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { C } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { useGate } from '@/lib/gate';

type AdsModule = typeof import('react-native-google-mobile-ads');

const ads: AdsModule | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-google-mobile-ads') as AdsModule;
  } catch {
    return null; // Expo Go等・モジュール未リンク
  }
})();

// SDK初期化は「実際に広告を出す端末」で1回だけ（無料プラン以外の端末では走らせない）
let initialized = false;
function ensureAdsInit(): void {
  if (!ads || initialized) return;
  initialized = true;
  try { ads.default().initialize().catch(() => {}); } catch { /* 初期化失敗でも落とさない */ }
}

// バナーユニットID: Codemagic環境変数の実IDを優先し、未設定ならGoogle公式テストID。
// 実IDの取得と設定手順は docs/ADS.md（熊田さん向け）を参照
function bannerUnitId(m: AdsModule): string {
  const real = Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_ADMOB_BANNER_IOS
    : process.env.EXPO_PUBLIC_ADMOB_BANNER_ANDROID;
  return real || m.TestIds.ADAPTIVE_BANNER;
}

export default function AdBanner() {
  const { active, plan } = useGate();
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // 表示条件（課金有効ビルド × 無料プラン × モジュールあり）
  const show = !!ads && active && (plan == null || plan === 'free') && !failed;
  useEffect(() => {
    if (show) ensureAdsInit();
  }, [show]);
  if (!show || !ads) return null;
  const { BannerAd, BannerAdSize } = ads;
  return (
    <View style={s.wrap}>
      {/* ラベルとペイウォール導線は広告の読み込み完了後だけ（枠だけの空白を見せない） */}
      {loaded && (
        <View style={s.head}>
          <Text style={s.label}>{t('広告')}</Text>
          <Pressable onPress={() => router.push('/paywall?src=ads' as never)} hitSlop={8}>
            <Text style={s.removeLink}>{t('ライトプランで広告を消せます')}</Text>
          </Pressable>
        </View>
      )}
      <BannerAd
        unitId={bannerUnitId(ads)}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  // カード群の間（card は marginBottom:12）に静かに挟まる余白
  wrap: { marginBottom: 12, borderRadius: 12, overflow: 'hidden' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, paddingHorizontal: 2 },
  label: { fontSize: 11, color: C.faint },
  removeLink: { fontSize: 11, color: C.faint, textDecorationLine: 'underline' },
});
