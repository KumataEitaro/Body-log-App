/* eslint-disable no-undef */
// smoke test用のモック群: ネットワーク・ネイティブモジュールを全て遮断し、
// 「各画面がクラッシュせずマウントできること」だけを高速に検証する

// --- Supabase（チェーン可能・thenableなクエリビルダー） ---
jest.mock('@/lib/supabase', () => {
  const makeChain = () => {
    const chain = {};
    const ret = () => chain;
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'gte', 'lte', 'lt', 'gt', 'like', 'order', 'limit', 'insert', 'update', 'upsert', 'delete', 'maybeSingle', 'single']) {
      chain[m] = jest.fn(ret);
    }
    chain.then = (resolve) => Promise.resolve({ data: null, error: null }).then(resolve);
    return chain;
  };
  return {
    supabase: {
      from: jest.fn(() => makeChain()),
      auth: {
        getSession: jest.fn(async () => ({ data: { session: { user: { id: 'test-user', email: 'test@example.com' }, access_token: 'token' } } })),
        onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
        signOut: jest.fn(async () => ({ error: null })),
      },
    },
  };
});

// --- APIクライアント（fetch遮断） ---
jest.mock('@/lib/api', () => ({
  apiPost: jest.fn(async () => ({ ok: true, status: 200, json: { ok: true } })),
}));

// --- AsyncStorage 公式モック ---
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

// --- Reanimated（アニメーションを恒等関数に） ---
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: {
      View: RN.View,
      ScrollView: RN.ScrollView,
      Text: RN.Text,
      createAnimatedComponent: (c) => c,
    },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    useAnimatedScrollHandler: () => () => {},
    useAnimatedRef: () => ({ current: null }),
    useDerivedValue: (fn) => ({ value: typeof fn === 'function' ? undefined : fn }),
    useAnimatedReaction: () => {},
    useFrameCallback: () => ({ setActive: () => {} }),
    scrollTo: () => {},
    runOnJS: (fn) => fn,
    cancelAnimation: () => {},
    withSpring: (v) => v,
    withTiming: (v) => v,
    withRepeat: (v) => v,
    withSequence: (...args) => args[0],
    Easing: { linear: (t) => t },
    // entering/exiting用のビルダー（.duration().delay()…とチェーンできる形だけ再現）
    FadeIn: { duration: () => ({ delay: () => ({}) }) },
    FadeOut: { duration: () => ({ delay: () => ({}) }) },
    FadeInDown: { duration: () => ({ delay: () => ({}) }) },
    FadeInRight: { duration: () => ({ delay: () => ({}) }) },
    FadeInUp: { duration: () => ({ delay: () => ({}) }) },
    ZoomIn: { springify: () => ({ damping: () => ({}) }) },
    LinearTransition: { springify: () => ({}) },
  };
});

// --- Gesture Handler（ジェスチャーは無効・子はそのまま描画） ---
jest.mock('react-native-gesture-handler', () => {
  const RN = require('react-native');
  const gestureStub = () => {
    const p = new Proxy({}, { get: (_t, prop) => (prop === 'toGestureArray' ? () => [] : () => p) });
    return p;
  };
  return {
    GestureHandlerRootView: RN.View,
    GestureDetector: ({ children }) => children,
    Gesture: new Proxy({}, { get: () => gestureStub }),
  };
});

// --- SVG / アイコン（描画不要のためnull化） ---
jest.mock('react-native-svg', () => {
  const Null = () => null;
  return new Proxy({ __esModule: true, default: Null }, { get: (t, p) => (p in t ? t[p] : Null) });
});
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

// --- expo各種 ---
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DAILY: 'daily', WEEKLY: 'weekly', DATE: 'date', CALENDAR: 'calendar' },
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('notif-id')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn(() => Promise.resolve()),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: () => () => {}, isFocused: () => true }),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb) => { const React = require('react'); React.useEffect(() => cb(), []); },
  Redirect: () => null,
  Tabs: () => null,
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }) => children,
}));
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: false })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: false })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false, canAskAgain: true }, jest.fn(async () => ({ granted: false }))],
}));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async () => ({ uri: 'x', base64: 'x' })),
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-apple-authentication', () => ({
  isAvailableAsync: async () => true,
  signInAsync: async () => ({ identityToken: 'test-token' }),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('expo-crypto', () => ({
  getRandomBytesAsync: async (n) => new Uint8Array(n),
  digestStringAsync: async () => 'hashed',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: async () => ({ type: 'cancel' }),
  maybeCompleteAuthSession: () => {},
  openBrowserAsync: async () => {},
}));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0-test' }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: async () => {},
  readAsStringAsync: async () => 'base64data',
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => false, shareAsync: async () => {} }));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: 'l', Medium: 'm', Heavy: 'h' },
  NotificationFeedbackType: { Success: 's', Warning: 'w', Error: 'e' },
}));
jest.mock('expo-linear-gradient', () => {
  const RN = require('react-native');
  return { LinearGradient: RN.View };
});
// --- AdMob（バナーは描画しない・importだけ解決させる。gate非activeのテスト環境では
//     AdBanner自体がnullを返すため、実挙動には影響しない） ---
jest.mock('react-native-google-mobile-ads', () => ({
  __esModule: true,
  default: () => ({ initialize: jest.fn(async () => []) }),
  BannerAd: () => null,
  BannerAdSize: { ANCHORED_ADAPTIVE_BANNER: 'ANCHORED_ADAPTIVE_BANNER', ADAPTIVE_BANNER: 'ADAPTIVE_BANNER', BANNER: 'BANNER' },
  TestIds: { ADAPTIVE_BANNER: 'ca-app-pub-3940256099942544/9214589741', BANNER: 'ca-app-pub-3940256099942544/2934735716' },
}));

jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn(async () => 'file:///tmp/sticker.png') }));
jest.mock('expo-clipboard', () => ({ setImageAsync: jest.fn(async () => {}) }));
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  saveToLibraryAsync: jest.fn(async () => {}),
}));
