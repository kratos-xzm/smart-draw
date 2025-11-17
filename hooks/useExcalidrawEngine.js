'use client';

import { useCallback } from 'react';
import { fixJSON } from '@/lib/fixUnclosed';
import { historyManager } from '@/lib/history-manager';
import { optimizeExcalidrawCode } from '@/lib/optimizeArrows';
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE } from '@/lib/prompts/excalidraw';
import { useEngineShared } from './useEngineShared';

/**
 * Excalidraw 引擎 Hook
 * 封装 Excalidraw 相关的业务逻辑：
 * - 代码后处理（JSON 提取 + 修复）
 * - LLM 消息收发与流式解析
 * - 历史记录读写
 */
export function useExcalidrawEngine() {
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
    processSSEStreamAlt,
    validateConfig,
    handleNewChat,
    restoreHistoryBase,
  } = useEngineShared();

  /**
   * 从 LLM 输出中稳健地提取 Excalidraw JSON 文本
   */
  const postProcessExcalidrawCode = useCallback((code) => {
    if (!code || typeof code !== 'string') return '';
    let text = code
      .replace(/\ufeff/g, '')
      .replace(/[\u200B-\u200D\u2060]/g, '')
      .trim();

    // 优先使用 ```json ``` 或任意 ``` ``` 代码块
    const fencedJson =
      text.match(/```\s*json\s*([\s\S]*?)```/i) ||
      text.match(/```\s*([\s\S]*?)```/);
    if (fencedJson && fencedJson[1]) text = fencedJson[1].trim();

    // 尝试提取主要 JSON 块
    const idxObjStart = text.indexOf('{');
    const idxObjEnd = text.lastIndexOf('}');
    const idxArrStart = text.indexOf('[');
    const idxArrEnd = text.lastIndexOf(']');

    if (
      idxArrStart !== -1 &&
      idxArrEnd !== -1 &&
      (idxObjStart === -1 || idxArrStart < idxObjStart)
    ) {
      text = text.slice(idxArrStart, idxArrEnd + 1);
    } else if (idxObjStart !== -1 && idxObjEnd !== -1) {
      text = text.slice(idxObjStart, idxObjEnd + 1);
    }

    return text.trim();
  }, []);

  /**
   * 将 JSON 文本解析为 Excalidraw elements 数组
   */
  const parseElements = useCallback((jsonText) => {
    try {
      const fixed = fixJSON(jsonText || '');
      const optimized = optimizeExcalidrawCode
        ? optimizeExcalidrawCode(fixed)
        : fixed;
      const data = JSON.parse(optimized);

      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.elements)) return data.elements;
      if (data && Array.isArray(data.items)) return data.items;

      return [];
    } catch (e) {
      console.error('Failed to parse Excalidraw JSON:', e);
      return [];
    }
  }, []);

  /**
   * 应用代码到画布：
   * - 解析 / 修复 / 优化 JSON
   * - 更新 usedCode
   * - 写入历史
   */
  const handleApplyCode = useCallback(
    async (code) => {
      try {
        const processed = postProcessExcalidrawCode(code || '');
        const fixed = fixJSON(processed);
        const optimized = optimizeExcalidrawCode
          ? optimizeExcalidrawCode(fixed)
          : fixed;

        setUsedCode(optimized);
        await historyManager.updateUsedCode(conversationId, optimized);
      } catch (error) {
        console.error('Apply code error:', error);
      }
    },
    [conversationId, postProcessExcalidrawCode, setUsedCode],
  );

  /**
   * 发送消息并调用 LLM：
   * - 支持文本 + 图片 multimodal
   * - 流式解析 SSE
   * - 自动应用生成的 JSON 到画布
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

        // 2. System Message
        const systemMessage = {
          role: 'system',
          content: SYSTEM_PROMPT,
        };

        // 3. User Message（应用模板）
        const userContent = USER_PROMPT_TEMPLATE(trimmed, chartType);
        const userMessage = await buildUserMessage(userContent, attachments);

        // 4. 组装完整 messages（包含历史）
        const fullMessages = buildFullMessages(systemMessage, userMessage, messages, 3);

        setMessages((prev) => [...prev, userMessage]);
        await historyManager.addMessage(conversationId, userMessage, 'excalidraw', llmConfig, chartType);

        // 5. 调用后端流式接口
        const response = await callLLMStream(llmConfig, fullMessages);

        // 6. 处理 SSE 流（使用备用解析方式）
        const accumulatedCode = await processSSEStreamAlt(response, (content) => {
          setStreamingContent(content);
        });

        // 7. 结束流式
        setStreamingContent('');

        // 8. 后处理 JSON 文本
        const finalJson = postProcessExcalidrawCode(accumulatedCode);

        const assistantMessage = {
          role: 'assistant',
          content: finalJson,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        await historyManager.addMessage(conversationId, assistantMessage, 'excalidraw', llmConfig, chartType);

        // 自动应用到画布
        await handleApplyCode(finalJson);
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
      postProcessExcalidrawCode,
      handleApplyCode,
      buildUserMessage,
      buildFullMessages,
      callLLMStream,
      processSSEStreamAlt,
      validateConfig,
      setIsGenerating,
      setStreamingContent,
      setMessages,
    ],
  );

  /**
   * 画布编辑回调：
   * - 将 elements 序列化为 JSON
   * - 更新 usedCode
   * - 写入历史
   */
  const handleCanvasChange = useCallback(
    async (elements) => {
      try {
        const code = JSON.stringify(elements);
        setUsedCode(code);
        await historyManager.updateUsedCode(conversationId, code);
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

    // 工具（给外部使用）
    parseElements,

    // 操作
    handleSendMessage,
    handleApplyCode,
    handleCanvasChange,
    handleNewChat,
    handleRestoreHistory,
  };
}
