'use client';

import { useDrawioEngine } from './useDrawioEngine';
import { useExcalidrawEngine } from './useExcalidrawEngine';

/**
 * 引擎管理器Hook
 * 根据engineType动态返回对应的引擎实例
 * 实现策略模式（Strategy Pattern）
 *
 * @param {'drawio' | 'excalidraw'} engineType - 引擎类型
 * @returns {Object} 引擎实例，符合IEngine接口
 */
export function useEngine(engineType) {
  const drawioEngine = useDrawioEngine();
  const excalidrawEngine = useExcalidrawEngine();

  // 根据引擎类型返回对应实例
  if (engineType === 'excalidraw') {
    return excalidrawEngine;
  }

  // 默认返回drawio引擎
  return drawioEngine;
}

/**
 * IEngine接口定义（TypeScript接口的JavaScript文档版本）
 *
 * @interface IEngine
 * @property {string} usedCode - 实际应用到画布的代码（XML或JSON）
 * @property {Array} messages - LLM原生格式的消息列表
 * @property {boolean} isGenerating - 生成中状态
 * @property {string} conversationId - 对话唯一标识
 * @property {Function} handleSendMessage - 发送消息，触发LLM生成
 * @property {Function} handleApplyCode - 应用代码到画布
 * @property {Function} handleCanvasChange - 画布编辑回调
 * @property {Function} handleNewChat - 新建对话
 * @property {Function} handleRestoreHistory - 恢复历史记录
 */
