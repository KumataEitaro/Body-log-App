import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // クリックジャッキング防止（iframe埋め込み禁止。ネイティブアプリのWebViewはトップレベル読み込みのため影響なし）
          { key: "X-Frame-Options", value: "DENY" },
          // MIMEスニッフィング防止
          { key: "X-Content-Type-Options", value: "nosniff" },
          // リファラの送信を最小限に
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 使わないブラウザ機能を明示的に無効化（<input type=file>のカメラ起動には影響しない）
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
