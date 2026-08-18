/**
 * 运行时配置 — 部署时可修改此文件,无需重新打包
 *
 * 后端地址(API_BASE_URL): 指向 zeroexo-server 实例
 * 品牌配置(BRANDING_CONFIG): 门户视频/Logo 等品牌素材,可部署时替换
 *
 * 示例:
 *   BRANDING_CONFIG: {
 *     heroVideoUrl: "https://cdn.example.com/hero.mp4",
 *     heroFallbackImage: "/images/hero-fallback.webp"
 *   }
 */
window.env = {
  API_BASE_URL: '/api',

  // 品牌配置(可选)— 后端未提供接口时,使用此配置作为兜底
  BRANDING_CONFIG: {
    // heroVideoUrl: "https://your-cdn.com/portal-video.mp4",
    // heroFallbackImage: "/images/hero-fallback.webp",
    // siteTitle: "ZeroExo Canvas",
    // siteSubtitle: "",
    // logoUrl: null,
  },
};