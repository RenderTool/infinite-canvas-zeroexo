/**
 * ZIP 工具(基于 fflate)
 *
 * createZip: 同步打包(level: 0 不压缩,避免阻塞主线程)
 * readZip: 同步解压,返回 Map<文件名, Blob>
 */

import { zipSync, unzipSync } from 'fflate';

interface ZipFile {
  name: string;
  data: BlobPart;
}

/** 打包多个文件为 ZIP Blob */
export async function createZip(files: ZipFile[]): Promise<Blob> {
  const entries = await Promise.all(
    files.map(async (file) => {
      const data = new Uint8Array(await new Blob([file.data]).arrayBuffer());
      return [file.name, data] as const;
    }),
  );
  return new Blob([zipSync(Object.fromEntries(entries), { level: 0 })], {
    type: 'application/zip',
  });
}

/** 解压 ZIP Blob,返回 文件名 → Blob 的映射 */
export async function readZip(file: Blob): Promise<Map<string, Blob>> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  return new Map(
    Object.entries(entries).map(([name, data]) => [name, new Blob([data])]),
  );
}
