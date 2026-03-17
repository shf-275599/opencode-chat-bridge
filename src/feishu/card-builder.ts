/**
 * Feishu interactive card builder.
 *
 * Card size limit: 28KB
 * Docs: https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-components/content-components/rich-text
 */


export function buildThinkingCard(): Record<string, unknown> {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: "plain_text",
        content: "🤔 思考中...",
      },
      template: "blue",
    },
    body: {
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: "正在处理你的消息，请稍候...",
          },
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "🔄 切换项目" },
          type: "default",
          value: { action: "command_execute", command: "/sessions" },
        },
      ],
    },
  }
}


export function buildResponseCard(text: string): Record<string, unknown> {
  // Feishu card limit is 28KB; truncate if needed
  const truncated =
    text.length > 4000
      ? text.slice(0, 4000) + "\n\n...(内容过长，已截断)"
      : text

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: "plain_text",
        content: "✅ 回复",
      },
      template: "green",
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: truncated,
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "🔄 切换项目" },
          type: "default",
          value: { action: "command_execute", command: "/sessions" },
        },
      ],
    },
  }
}

export function buildProjectSelectorCard(sessions: any[], currentSessionId?: string): Record<string, unknown> {
  const recentSessions = sessions.slice(0, 10)
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: "plain_text",
        content: "📋 选择项目会话",
      },
      template: "blue",
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: "**点击连接到对应项目：**",
        },
        ...recentSessions.map((s) => {
          const isCurrentSession = s.id === currentSessionId
          return {
            tag: "button",
            text: {
              tag: "plain_text",
              content: `${isCurrentSession ? "▶ " : ""}${s.title ? s.title + " — " : ""}${s.id}`,
            },
            type: isCurrentSession ? "primary" : "default",
            value: { action: "command_execute", command: `/connect ${s.id}` },
          }
        }),
      ],
    },
  }
}

export function buildHelpCard(): Record<string, unknown> {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: "plain_text",
        content: "⚡ 命令菜单",
      },
      template: "blue",
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: "**选择要执行的命令：**",
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "🆕 新建会话" },
          type: "primary",
          value: { action: "command_execute", command: "/new" },
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "🔌 连接会话" },
          value: { action: "command_execute", command: "/sessions" },
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "📦 压缩历史" },
          value: { action: "command_execute", command: "/compact" },
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "🔗 分享会话" },
          value: { action: "command_execute", command: "/share" },
        },
        {
          tag: "button",
          text: { tag: "plain_text", content: "🛑 中止任务" },
          type: "danger",
          value: { action: "command_execute", command: "/abort" },
        },
      ],
    },
  }
}


export function buildErrorCard(msg: string): Record<string, unknown> {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: "plain_text",
        content: "❌ 出错了",
      },
      template: "red",
    },
    body: {
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: msg || "处理请求时发生错误，请稍后重试。",
          },
        },
      ],
    },
  }
}
