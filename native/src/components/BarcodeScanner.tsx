// JANバーコード（EAN-13/EAN-8）を読む全画面スキャナ。
// 1500人監査ペイン2位「バーコード・公式栄養DBが無い」への入口。
// 読み取り成功で触覚1回→即クローズ→onScanned(jan) を呼ぶ（照会は呼び出し側の責務）。
import { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ScanBarcode } from 'lucide-react-native';
import { C, rgba, sheetTopPad, themed } from '@/lib/ui';
import { t } from '@/lib/i18n';
import { OptionButton } from '@/components/ui/Selectable';

export default function BarcodeScanner({ visible, onClose, onScanned }: {
  visible: boolean;
  onClose: () => void;
  onScanned: (jan: string) => void;   // 読み取ったJAN（数字のみ）
}) {
  // 権限は既存の写真経路と同じ「開いた時に聞く」流儀（useCameraPermissionsフック）
  const [perm, requestPerm] = useCameraPermissions();
  const [asked, setAsked] = useState(false);
  // 二重発火ガード: CameraViewは同じコードを連続で通知してくるため、最初の1回だけ通す
  const firedRef = useRef(false);

  useEffect(() => {
    if (!visible) { firedRef.current = false; return; }
    setAsked(false);
    if (perm && !perm.granted && perm.canAskAgain) {
      requestPerm().finally(() => setAsked(true));
    } else {
      setAsked(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function handleScan(data: string) {
    if (firedRef.current) return;   // 連続読み取りしない
    const code = String(data).replace(/\D/g, '');
    if (!/^\d{8}$|^\d{13}$/.test(code)) return;
    firedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onClose();          // 即クローズ（結果待ちの表示は呼び出し側のトレイ/フォームで見せる）
    onScanned(code);
  }

  const denied = perm != null && !perm.granted && asked;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.wrap}>
        <View style={s.head}>
          <ScanBarcode size={18} color={C.teal} />
          <Text style={s.title}>{t('バーコードで探す')}</Text>
        </View>

        {denied ? (
          // 権限を断られたとき: 責めずに設定への道だけ示す
          <View style={s.deniedBox}>
            <Text style={s.deniedT}>{t('カメラの許可が必要です（設定アプリ→BodyLog）。バーコードはカメラでしか読めないため、許可をお願いします。')}</Text>
            <OptionButton style={{ marginTop: 16, alignSelf: 'stretch' }} variant="tonal" label={t('閉じる')} onPress={onClose} />
          </View>
        ) : (
          <View style={s.cameraBox}>
            {visible && perm?.granted && (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8'] }}
                onBarcodeScanned={(r) => handleScan(r.data)}
              />
            )}
            {/* 中央のスキャン枠ガイド（角丸フレーム・アクセント色） */}
            <View pointerEvents="none" style={s.overlay}>
              <View style={s.frame} />
              <Text style={s.guideT}>{t('パッケージのバーコードを枠に合わせてください')}</Text>
            </View>
          </View>
        )}

        {!denied && (
          <OptionButton style={{ marginTop: 14 }} variant="tonal" label={t('キャンセル')} onPress={onClose} />
        )}
      </View>
    </Modal>
  );
}

const s = themed(() => ({
  wrap: { flex: 1, backgroundColor: C.bg, paddingHorizontal: 18, paddingTop: sheetTopPad(18), paddingBottom: 24 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '800', color: C.ink },
  cameraBox: { flex: 1, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: '78%', aspectRatio: 1.55, borderRadius: 18,
    borderWidth: 3, borderColor: rgba('#ffffff', 0.9),
  },
  guideT: {
    marginTop: 14, fontSize: 13.5, fontWeight: '700', color: '#fff', textAlign: 'center',
    paddingHorizontal: 24, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6,
  },
  deniedBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  deniedT: { fontSize: 14, color: C.sub, lineHeight: 21, textAlign: 'center' },
}));
