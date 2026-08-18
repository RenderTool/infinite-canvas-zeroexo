// 过滤 antd 库内已知警告（无法升级的库级限制）
const _consoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = typeof args[0] === 'string' ? args[0] : '';
  // React 警告使用 %s 格式化参数，检查拼接后的完整内容
  const fullMsg = args.map((a) => String(a)).join(' ');
  if (msg.includes('findDOMNode is deprecated') ||
      msg.includes("Static function can not consume context like dynamic theme") ||
      // pro-components 3.x beta 内部将 ref 传递给函数组件 DensityIcon 的已知问题
      msg.includes('Function components cannot be given refs') ||
      // pro-components 3.x beta 内部将 ignoreRules prop 传递到 DOM 元素的已知问题
      fullMsg.includes('ignoreRules') ||
      // pro-components 3.x beta 内部 Space 组件仍使用废弃的 direction 属性
      msg.includes('[antd: Space] `direction` is deprecated') ||
      // pro-components 3.x beta 内部 Spin 组件仍使用废弃的 tip 属性
      msg.includes('[antd: Spin] `tip` is deprecated')) {
    return;
  }
  _consoleError.apply(console, args);
};

import { createRoot } from 'react-dom/client'
import App from './App'
import './index.less'

createRoot(document.getElementById('root')!).render(
  <App />
)