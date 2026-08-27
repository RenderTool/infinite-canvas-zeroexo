import type { Asset } from '../index.js';
import { getToken } from '@/services/api-client.js';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, filename);
}

function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function downloadRemoteUrl(url: string, filename: string): Promise<void> {
  // 私有资源依赖 JWT 鉴权,a.href 直接跳转无法携带 header,改为 fetch + blob 下载
  const token = getToken();
  const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    throw new Error(`下载失败: ${response.status}`);
  }
  const blob = await response.blob();
  downloadBlob(blob, filename);
}

export async function downloadAsset(asset: Asset): Promise<void> {
  const data = asset.data;
  const ext = (() => {
    if (data.kind === 'text') return 'txt';
    if (data.kind === 'script') return 'json'; // 剧本资产 content 为 episodes JSON
    if (data.kind === 'image') {
      if (asset.mimeType?.includes('png')) return 'png';
      if (asset.mimeType?.includes('jpeg') || asset.mimeType?.includes('jpg')) return 'jpg';
      if (asset.mimeType?.includes('gif')) return 'gif';
      return 'png';
    }
    if (data.kind === 'video') {
      if (asset.mimeType?.includes('mp4')) return 'mp4';
      if (asset.mimeType?.includes('webm')) return 'webm';
      return 'mp4';
    }
    if (data.kind === 'audio') {
      if (asset.mimeType?.includes('mp3')) return 'mp3';
      if (asset.mimeType?.includes('wav')) return 'wav';
      if (asset.mimeType?.includes('ogg')) return 'ogg';
      return 'mp3';
    }
    return 'bin';
  })();
  const filename = `${asset.title}.${ext}`;

  if (data.kind === 'text' || data.kind === 'script') {
    downloadText(data.content, filename);
  } else if (data.kind === 'image') {
    downloadDataUrl(data.dataUrl, filename);
  } else if (data.kind === 'video') {
    await downloadRemoteUrl(data.url, filename);
  } else if (data.kind === 'audio') {
    await downloadRemoteUrl(data.url, filename);
  }
}