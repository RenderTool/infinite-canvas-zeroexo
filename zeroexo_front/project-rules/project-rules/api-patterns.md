# API 经验：response.json() 直接调用风险

## ❌ 错误写法
```js
const res = await fetch('/api/data');
const data = await res.json(); // 如果返回 500 + HTML 错误页，这里会抛 SyntaxError
```

## ✅ 正确写法
```js
const res = await fetch('/api/data');
if (!res.ok) {
  const errorText = await res.text();
  throw new Error(`API ${res.status}: ${errorText}`);
}
const data = await res.json();
```

## ⚠️ 边界情况
- 使用 axios 时不需要手动检查 status（它会自动 reject 非 2xx），但 fetch 不会
- 如果后端可能返回非 JSON 格式的错误（如 HTML），先 res.headers.get('content-type') 判断再决定用 .json() 还是 .text()
- 流式响应（ReadableStream）不能用 .json()，需要用 response.body.getReader()
- 在 TypeScript 中，建议给 .json() 的返回值做类型断言或运行时校验（如 zod），避免后端返回结构变化导致运行时错误
- 并发请求时用 Promise.allSettled() 而非 Promise.all()，避免一个失败导致全部 reject
