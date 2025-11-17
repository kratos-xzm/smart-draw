'use client';

import { useCallback } from 'react';
import fixUnclosed from '@/lib/fixUnclosed';
import { historyManager } from '@/lib/history-manager';
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from '@/lib/prompts/drawio';
import { useEngineShared } from './useEngineShared';

/**
 * Draw.io 引擎 Hook
 * 封装 Draw.io 相关的业务逻辑
 *
 * - 统一从 getConfig() 读取"最终生效"的 LLM 配置
 * - 前端负责拼装 messages，后端 /api/llm/stream 做透明代理
 */
export function useDrawioEngine() {
  // 使用共享的引擎逻辑
  const {
    usedCode,
    setUsedCode,
    messages,
    setMessages,
    isGenerating,
    setIsGenerating,
    streamingContent,
    setStreamingContent,
    conversationId,
    lastError,
    setLastError,
    buildUserMessage,
    buildFullMessages,
    callLLMStream,
    processSSEStream,
    validateConfig,
    handleNewChat,
    restoreHistoryBase,
  } = useEngineShared();

  /**
   * 后处理 Draw.io XML 代码：提取 XML、处理转义与未闭合标签
   */
  const postProcessDrawioCode = useCallback((code) => {
    if (!code || typeof code !== 'string') return code;

    let processed = code;

    // 清理 BOM 与零宽字符
    processed = processed.replace(/\ufeff/g, '').replace(/[\u200B-\u200D\u2060]/g, '');

    // 1) 优先提取 ```xml ``` 包裹的代码块
    const fencedXmlMatch = processed.match(/```\s*xml\s*([\s\S]*?)```/i);
    if (fencedXmlMatch && fencedXmlMatch[1]) {
      processed = fencedXmlMatch[1];
    } else {
      // 回退：任意 ``` ``` 代码块
      const fencedAnyMatch = processed.match(/```\s*([\s\S]*?)```/);
      if (fencedAnyMatch && fencedAnyMatch[1]) {
        processed = fencedAnyMatch[1];
      }
    }

    processed = processed.trim();

    // 2) 如果是 HTML 转义后的 XML，做最小反转义
    if (!/[<][a-z!?]/i.test(processed) && /&lt;\s*[a-z!?]/i.test(processed)) {
      processed = processed
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }

    // 3) 提取第一个看起来像 XML 的块
    const xmlStart = processed.search(/<(mxfile|mxGraphModel|diagram)([\s>])/i);
    const xmlEnd = processed.lastIndexOf('>');
    if (xmlStart !== -1 && xmlEnd !== -1 && xmlEnd > xmlStart) {
      processed = processed.slice(xmlStart, xmlEnd + 1);
    }

    // 4) 修复常见未闭合标签问题
    processed = fixUnclosed(processed, { mode: 'xml' });

    return processed;
  }, []);

  /**
   * 应用代码到画布：
   * - 修复 XML
   * - 更新 usedCode
   * - 写入历史记录
   */
  const handleApplyCode = useCallback(
    async (code) => {
      try {
        const fixedCode = fixUnclosed(code || '', { mode: 'xml' });
        setUsedCode(fixedCode);
        await historyManager.updateUsedCode(conversationId, fixedCode);
      } catch (error) {
        console.error('Apply code error:', error);
      }
    },
    [conversationId, setUsedCode],
  );

  /**
   * 发送消息并调用 LLM：
   * - 拼装 system / user / history
   * - 通过 /api/llm/stream 做 SSE 流式转发
   * - 自动应用生成出来的 XML 代码
   */
  const handleSendMessage = useCallback(
    async (input, attachments = [], chartType = 'auto', _unusedConfig, showNotification) => {
      const trimmed = (input || '').trim();
      if (!trimmed && (!attachments || attachments.length === 0)) return;

      try {
        setIsGenerating(true);
        setStreamingContent('');
        setLastError(null);

        // 1. 验证 LLM 配置
        const llmConfig = validateConfig(showNotification);
        if (!llmConfig) return;

        // 2. 构造 System Message
        const systemMessage = {
          role: 'system',
          content: SYSTEM_PROMPT,
        };

        // 3. 构造 User Message（应用模板）
        const userContent = USER_PROMPT_TEMPLATE(trimmed, chartType);
        const userMessage = await buildUserMessage(userContent, attachments);

        // 4. 组装完整 messages（包含历史）
        const fullMessages = buildFullMessages(systemMessage, userMessage, messages, 3);

        // 追踪 user message
        setMessages((prev) => [...prev, userMessage]);
        await historyManager.addMessage(conversationId, userMessage, 'drawio', llmConfig, chartType);

        // 5. 调用后端流式接口
        const response = await callLLMStream(llmConfig, fullMessages);

        // 6. 处理 SSE 流
        const accumulatedCode = await processSSEStream(response, (content) => {
          setStreamingContent(content);
        });

        // 7. 结束流式，清空 streamingContent
        setStreamingContent('');

        // 8. 后处理 XML 代码
        const finalXml = postProcessDrawioCode(accumulatedCode);

        const assistantMessage = {
          role: 'assistant',
          content: finalXml,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        await historyManager.addMessage(conversationId, assistantMessage, 'drawio', llmConfig, chartType);

        // 自动应用到画布
        await handleApplyCode(finalXml);
      } catch (error) {
        console.error('Generate error:', error);
        setStreamingContent('');

        const errorMessage = error.message || '生成失败';
        setLastError(errorMessage);

        // Add error message to chat
        const errorChatMessage = {
          role: 'system',
          content: `❌ 错误: ${errorMessage}`,
        };
        setMessages((prev) => [...prev, errorChatMessage]);

        if (showNotification) {
          showNotification({
            title: '生成失败',
            message: errorMessage,
            type: 'error',
          });
        }
      } finally {
        setIsGenerating(false);
      }
    },
    [
      conversationId,
      messages,
      postProcessDrawioCode,
      handleApplyCode,
      buildUserMessage,
      buildFullMessages,
      callLLMStream,
      processSSEStream,
      validateConfig,
      setIsGenerating,
      setStreamingContent,
      setMessages,
    ],
  );

  /**
   * 画布内容变更回调：
   * - 修复 XML
   * - 更新 usedCode
   * - 写入历史记录
   */
  const handleCanvasChange = useCallback(
    async (code) => {
      try {
        const fixedCode = fixUnclosed(code || '', { mode: 'xml' });
        setUsedCode(fixedCode);
        await historyManager.updateUsedCode(conversationId, fixedCode);
      } catch (error) {
        console.error('Canvas change error:', error);
      }
    },
    [conversationId, setUsedCode],
  );

  /**
   * 恢复历史对话：
   * - 恢复 conversationId
   * - 恢复 messages
   * - 应用 usedCode 到画布
   */
  const handleRestoreHistory = useCallback(
    async (history) => {
      await restoreHistoryBase(history, handleApplyCode);
    },
    [restoreHistoryBase, handleApplyCode],
  );

  // 对外暴露引擎能力
  return {
    // 状态
    usedCode,
    messages,
    isGenerating,
    conversationId,
    streamingContent,
    lastError,

    // 操作
    handleSendMessage,
    handleApplyCode,
    handleCanvasChange,
    handleNewChat,
    handleRestoreHistory,
  };
}
