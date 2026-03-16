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
