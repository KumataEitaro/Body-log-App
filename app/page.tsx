import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/log'); // 起動時はまず入力画面（記録が主動線）
}
