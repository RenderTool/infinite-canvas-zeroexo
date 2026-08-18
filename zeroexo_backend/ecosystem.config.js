// PM2 进程管理配置
// 用法: pm2 start ecosystem.config.js
// 安装: pnpm add -g pm2
module.exports = {
  apps: [
    {
      name: 'zeroexo-server',
      script: 'dist/main.js',
      cwd: __dirname,
      // 进程数: max 表示利用所有 CPU 核心
      instances: 1,
      exec_mode: 'fork',
      // 监听文件变化自动重启
      watch: false,
      // 内存超限自动重启 (512MB)
      max_memory_restart: '512M',
      // 日志
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      // 崩溃后自动重启
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      // 环境变量
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
