/**
 * AI 渠道适配器抽象接口 - P3.3
 * 每个渠道(OpenAI/Gemini/Stability/Volcengine/Custom)实现此接口,
 * 通过 generate 方法把生成请求转换为该渠道的 HTTP 调用并解析响应。
 */

/** 生成类型 */
export type GenerateKind = 'text' | 'image' | 'video' | 'audio';

/** 生成请求 */
export interface GenerateRequest {
  kind: GenerateKind;
  prompt: string;
  negativePrompt?: string;
  /** 模型名,由调用方决定(如 dall-e-3 / gemini-2.0-flash-exp / stable-diffusion-v3) */
  model: string;
  /** 生成参数:size/quality/steps/seed/seconds/voice 等 */
  params: Record<string, unknown>;
  /**
   * 匹配的模板信息,供适配器将前端参数映射为 API 参数。
   * 包含:
   *   - paramMapping / valueMapping: 参数名/值映射
   *   - bounds: 渠道约束(像素限制、宽高比限制等)
   *   - request / sync / task / auth: DSL v2 视频协议描述(可选)
   */
  template?: {
    paramMapping?: Record<string, string>;
    valueMapping?: Record<string, Record<string, string>>;
    /** 渠道数值约束(源自 channelConstraints.bounds) */
    bounds?: {
      maxEdgeLength?: number;
      minTotalPixels?: number;
      maxTotalPixels?: number;
      maxReferenceImages?: number;
      maxReferenceVideos?: number;
      maxReferenceAudios?: number;
      minDuration?: number;
      maxDuration?: number;
      supportsImageToImage?: boolean;
    };
    /** 请求体结构描述(DSL v2) */
    request?: {
      bodyStyle?: 'flat' | 'content';
      contentRoles?: {
        image?: string;
        firstFrame?: string;
        lastFrame?: string;
        video?: string;
        audio?: string;
        firstLastModes?: string[];
      };
      referenceFormat?: 'url' | 'base64';
    };
    /** 同步响应解析协议(DSL v2) */
    sync?: { resultPath: string; field?: string };
    /** 异步任务协议(DSL v2) */
    task?: {
      submitIdPath: string;
      pollUrlTemplate: string;
      statusPath: string;
      successValues: string[];
      failureValues: string[];
      resultPath: string;
      /** 尾帧提取路径(如 content.last_frame_url)。存在时下载尾帧并随结果返回 */
      lastFramePath?: string;
      pollIntervalMs?: number;
      maxPollMs?: number;
    };
    /** 认证方式(DSL v2) */
    auth?: {
      type: 'bearer' | 'header' | 'kling-hmac';
      apiKeyHeader?: string;
      alsoBearer?: boolean;
      signer?: { headerName: string; format: string; alg: 'hmac-sha256' };
    };
    /** 模板 endpoint(提交 URL 后缀,DSL v2) */
    endpoint?: string;
  };
}

/** 适配器调用上下文(由 service 解密后传入) */
export interface AdapterContext {
  apiKey: string;
  /** 密钥(加密存储于 credentials.secretKey, AK/SK 签名类渠道使用) */
  secretKey?: string;
  baseUrl: string;
  /** 单次请求超时(ms) */
  timeoutMs: number;
  /**
   * 外部取消信号（由 Service 层传入）。
   * 用户取消生成时，Service 调用 AbortController.abort()，
   * 适配器应中断正在进行的 HTTP 请求。
   */
  signal?: AbortSignal;
  /** 读取本地存储文件(供图生图参考图读取使用) */
  readFile?: (key: string) => Promise<Buffer | null>;
}

/** 生成结果 */
export interface GenerateResult {
  kind: GenerateKind;
  /** 文本结果(kind="text" 时使用) */
  text?: string;
  /** 二进制结果(kind="image|video|audio" 时使用) */
  buffer?: Buffer;
  /** 远程 URL 结果(部分渠道返回 url 而非 base64) */
  url?: string;
  /** 二进制 MIME 类型 */
  mimeType?: string;
  /** 二进制扩展名(不含点,如 png/mp4/mp3) */
  ext?: string;
  /** 尾帧图像(return_last_frame 能力:视频生成完成后额外返回的末帧 PNG,供连续视频工作流) */
  lastFrame?: {
    buffer: Buffer;
    mimeType: string;
    ext: string;
  };
  width?: number;
  height?: number;
  /** 时长(秒,音视频) */
  duration?: number;
  /** 消耗 token(估算),向后兼容 */
  costTokens?: number;
  /** 输入 token 数(API 返回的 prompt_tokens 或等效字段) */
  inputTokens?: number;
  /** 输出 token 数(API 返回的 completion_tokens 或等效字段) */
  outputTokens?: number;
}

/** 适配器接口 */
export interface AiProviderAdapter {
  /** 执行生成请求,返回结构化结果(包含 buffer 或 text) */
  generate(req: GenerateRequest, ctx: AdapterContext): Promise<GenerateResult>;
}
