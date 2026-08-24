import { LogsService } from '../../logs/logs.service';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * 项目服务基类 - 画布等项目的共享逻辑。
 *
 * 子类需实现:
 * - storageModule: 存储子目录名 ('canvases')
 * - storageRoot: 存储根路径
 */
export abstract class BaseProjectService {
  protected abstract get storageModule(): string;
  protected abstract get storageRoot(): string;

  /**
   * 写文件系统快照
   */
  protected async writeSnapshot(
    ownerId: string,
    projectId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const dir = this.getProjectDir(ownerId, projectId);
    await fs.mkdir(dir, { recursive: true });
    const fileName = this.storageModule === 'canvases' ? 'scene.json' : 'project.json';
    const filePath = path.join(dir, fileName);
    const payload = {
      projectId,
      ...data,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  /**
   * 删除文件系统快照
   */
  protected async deleteSnapshot(ownerId: string, projectId: string): Promise<void> {
    const dir = this.getProjectDir(ownerId, projectId);
    const fileName = this.storageModule === 'canvases' ? 'scene.json' : 'project.json';
    const filePath = path.join(dir, fileName);
    await fs.unlink(filePath);
    await fs.rmdir(dir).catch(() => {});
  }

  /**
   * 记录操作日志
   */
  protected logOperation(
    logsService: LogsService,
    action: string,
    meta: Record<string, unknown>,
  ): void {
    logsService.log('project', action, meta);
  }

  /**
   * 生成项目目录路径
   */
  protected getProjectDir(ownerId: string, projectId: string): string {
    return path.join(this.storageRoot, 'resources', 'front', this.storageModule, ownerId, projectId);
  }
}
