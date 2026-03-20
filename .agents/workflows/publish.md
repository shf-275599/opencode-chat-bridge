---
description: 运行测试并发布新版本到 NPM
---

// turbo-all
1. 确保在主分支上且工作区干净
   `git status`
2. 安装依赖并运行 lint/测试
   `pnpm install && pnpm test:run`
3. 增加版本号（如果是常规更新，可以使用 patch）
   `npm version patch`
4. 编译项目
   `pnpm build`
5. 发布到 NPM
   `npm publish`
6. 推送代码和 Tag 到 GitHub
   `git push origin main --follow-tags`
7. 使用gh发布release到github