// キーボードの表示状態を返すフック（しまうボタンの表示制御用）
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s1 = Keyboard.addListener(showEvt, () => setVisible(true));
    const s2 = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => { s1.remove(); s2.remove(); };
  }, []);
  return visible;
}
