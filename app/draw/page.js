'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import AppHeader from '@/components/AppHeader';
import dynamic from 'next/dynamic';
import FloatingChat from '@/components/FloatingChat';
import ConfigManager from '@/components/ConfigManager';
import ContactModal from '@/components/ContactModal';
import HistoryModal from '@/components/HistoryModal';
import CombinedSettingsModal from '@/components/CombinedSettingsModal';
import Notification from '@/components/Notification';
import ConfirmDialog from '@/components/ConfirmDialog';
import { getConfig } from '@/lib/config';
import { useEngine } from '@/hooks/useEngine';

// Dynamically import Canvas components to avoid SSR issues
const DrawioCanvas = dynamic(() => import('@/components/DrawioCanvas'), {
  ssr: false,
});

const ExcalidrawCanvas = dynamic(() => import('@/components/ExcalidrawCanvas'), {
  ssr: false,
});

export default function DrawPage() {
  // 引擎类型状态（核心状态）
  const [engineType, setEngineType] = useState('drawio'); // 'drawio' | 'excalidraw'

  // 调用useEngine Hook获取引擎实例
  const engine = useEngine(engineType);

  // 配置状态
  const [config, setConfig] = useState(null);
  const [usePassword, setUsePassword] = useState(false);

  // 模态框状态
  const [isConfigManagerOpen, setIsConfigManagerOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isCombinedSettingsOpen, setIsCombinedSettingsOpen] = useState(false);

  // 确认对话框状态
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null,
    type: 'warning'
  });

  // 通知状态
  const [notification, setNotification] = useState({
    isOpen: false,
    title: '',
    message: '',
    type: 'info'
  });

  // Chat面板宽度（用于调整画布padding）
  const [chatPanelWidth, setChatPanelWidth] = useState(0);

  // Load config on mount and listen for config changes
  useEffect(() => {
    const savedConfig = getConfig();
    if (savedConfig) {
      setConfig(savedConfig);
    }

    // Load password access state
    const passwordEnabled =
      localStorage.getItem('smart-diagram-use-password') === 'true';
    setUsePassword(passwordEnabled);

    // Listen for storage changes to sync across tabs
    const handleStorageChange = (e) => {
      const key = e?.key;

      // 任意 LLM 配置相关 key 变化时，重新计算“最终生效配置”
      const configKeys = [
        'smart-diagram-local-configs',
        'smart-diagram-active-local-config',
        'smart-diagram-remote-config',
        // 兼容旧版 / 调试快照
        'smart-diagram-configs',
        'smart-diagram-active-config',
      ];

      if (!key || configKeys.includes(key)) {
        const newConfig = getConfig();
        setConfig(newConfig);
      }

      if (key === 'smart-diagram-use-password') {
        const enabled =
          localStorage.getItem('smart-diagram-use-password') === 'true';
        setUsePassword(enabled);
      }
    };

    // Listen for custom event from CombinedSettingsModal (same tab)
    const handlePasswordSettingsChanged = (e) => {
      const enabled = !!e.detail?.usePassword;
      setUsePassword(enabled);
      // 模式切换后重新计算当前生效配置
      const newConfig = getConfig();
      setConfig(newConfig);
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(
      'password-settings-changed',
      handlePasswordSettingsChanged,
    );

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(
        'password-settings-changed',
        handlePasswordSettingsChanged,
      );
    };
  }, []);

  // Listen for chat panel open/close and width to set right padding
  useEffect(() => {
    const onVisibility = (e) => {
      try {
        const open = !!e?.detail?.open;
        const width = Number(e?.detail?.width || 0);
        setChatPanelWidth(open ? width : 0);
      } catch {
        setChatPanelWidth(0);
      }
    };
    window.addEventListener('chatpanel-visibility-change', onVisibility);
    return () => window.removeEventListener('chatpanel-visibility-change', onVisibility);
  }, []);

  // Notification helpers
  const showNotification = useCallback((opts) => {
    setNotification({ isOpen: true, title: opts.title || '', message: opts.message || '', type: opts.type || 'info' });
  }, []);

  const closeNotification = useCallback(() => {
    setNotification(prev => ({ ...prev, isOpen: false }));
  }, []);

  /**
   * 引擎切换处理
   * 弹窗确认，切换后清空对话和画布
   */
  const handleEngineSwitch = useCallback((newEngine) => {
    if (newEngine === engineType) return;

    // 弹窗确认
    setConfirmDialog({
      isOpen: true,
      title: '切换绘图引擎',
      message: '切换绘图引擎将清空当前对话历史和画布内容，确定要切换吗？',
      type: 'warning',
      onConfirm: () => {
        setEngineType(newEngine);
        // 调用引擎的handleNewChat清空状态
        engine.handleNewChat();
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  }, [engineType, engine]);

  /**
   * 发送消息处理
   * 调用引擎的handleSendMessage
   */
  const handleSendMessage = useCallback(async (input, attachments, chartType) => {
    await engine.handleSendMessage(input, attachments, chartType, config, showNotification);
  }, [engine, config, showNotification]);

  /**
   * 应用代码处理（用户点击"应用"按钮）
   * 调用引擎的handleApplyCode
   */
  const handleApplyCode = useCallback(async (code) => {
    await engine.handleApplyCode(code);
    showNotification({ title: '已应用', message: '代码已应用到画布', type: 'success' });
  }, [engine, showNotification]);

  /**
   * 画布编辑处理
   * 调用引擎的handleCanvasChange
   */
  const handleCanvasChange = useCallback(async (code) => {
    await engine.handleCanvasChange(code);
  }, [engine]);

  /**
   * 新建对话处理
   * 调用引擎的handleNewChat
   */
  const handleNewChat = useCallback(() => {
    engine.handleNewChat();
  }, [engine]);

  /**
   * 恢复历史记录处理
   * 检查引擎类型是否匹配，不匹配时询问是否切换
   */
  const handleApplyHistory = useCallback(async (history) => {
    if (!history) return;
    console.log('history', history);

    // 检查引擎类型是否匹配
    if (history.editor && history.editor !== engineType) {
      setConfirmDialog({
        isOpen: true,
        title: '切换引擎',
        message: `该历史记录使用的是 ${history.editor === 'drawio' ? 'Draw.io' : 'Excalidraw'} 引擎，当前是 ${engineType === 'drawio' ? 'Draw.io' : 'Excalidraw'} 引擎。\n\n是否切换引擎？切换后将清空当前对话。`,
        type: 'warning',
        onConfirm: () => {
          setEngineType(history.editor);
          // 等待引擎切换完成后再恢复历史
          setTimeout(async () => {
            const newEngine = useEngine(history.editor);
            await newEngine.handleRestoreHistory(history);
          }, 100);
          setConfirmDialog(prev => ({ ...prev, isOpen: false }));
        }
      });
      return;
    }

    // 引擎类型匹配，直接恢复
    await engine.handleRestoreHistory(history);
    setIsHistoryModalOpen(false);
    showNotification({ title: '已恢复', message: '历史记录已恢复', type: 'success' });
  }, [engineType, engine, showNotification]);

  /**
   * 缓存 Excalidraw elements 解析结果
   * 只有当 usedCode 真正改变时才重新解析，避免流式更新时频繁重新渲染
   */
  const excalidrawElements = useMemo(() => {
    if (engineType !== 'excalidraw' || !engine.usedCode) return [];

    try {
      const parsed = JSON.parse(engine.usedCode);
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.elements)) return parsed.elements;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
      return [];
    } catch (e) {
      return [];
    }
  }, [engineType, engine.usedCode]);

  /**
   * 渲染画布组件
   * 根据engineType动态渲染DrawioCanvas或ExcalidrawCanvas
   */
  const renderCanvas = () => {
    if (engineType === 'excalidraw') {
      // Excalidraw需要解析JSON为elements
      return (
        <ExcalidrawCanvas
          elements={excalidrawElements}
          onChange={(newElements) => {
            // 用户编辑画布后，序列化elements并调用handleCanvasChange
            const code = JSON.stringify(newElements);
            handleCanvasChange(code);
          }}
        />
      );
    }

    // Draw.io直接使用XML
    return (
      <DrawioCanvas
        xml={engine.usedCode}
        onSave={(xmlOrData) => {
          // 提取XML并调用handleCanvasChange
          const xml = typeof xmlOrData === 'string' ? xmlOrData : (xmlOrData?.data || '');
          if (xml) {
            handleCanvasChange(xml);
          }
        }}
      />
    );
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50" style={{ paddingRight: chatPanelWidth || 0 }}>
      {/* Header */}
      <AppHeader />

      {/* Main Content - Full Screen Canvas */}
      <div className="flex-1 overflow-hidden">
        {renderCanvas()}
      </div>

      {/* Floating Chat */}
      <FloatingChat
        engineType={engineType}
        onEngineSwitch={handleEngineSwitch}
        onSendMessage={handleSendMessage}
        onApplyCode={handleApplyCode}
        isGenerating={engine.isGenerating}
        messages={engine.messages}
        streamingContent={engine.streamingContent} // ✨ 传递流式内容
        onNewChat={handleNewChat}
        conversationId={engine.conversationId}
        onOpenHistory={() => setIsHistoryModalOpen(true)}
        onOpenSettings={() => setIsCombinedSettingsOpen(true)}
      />

      {/* Config Manager Modal */}
      <ConfigManager
        isOpen={isConfigManagerOpen}
        onClose={() => setIsConfigManagerOpen(false)}
        onConfigSelect={(selectedConfig) => setConfig(selectedConfig)}
      />

      {/* History Modal */}
      <HistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        onApply={handleApplyHistory}
        editorType={engineType}
      />

      {/* Combined Settings Modal */}
      <CombinedSettingsModal
        isOpen={isCombinedSettingsOpen}
        onClose={() => setIsCombinedSettingsOpen(false)}
        usePassword={usePassword}
        currentConfig={config}
        onConfigSelect={(newConfig) => {
          setConfig(newConfig);
        }}
      />

      {/* Contact Modal */}
      <ContactModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
      />

      {/* Notification */}
      <Notification
        isOpen={notification.isOpen}
        onClose={closeNotification}
        title={notification.title}
        message={notification.message}
        type={notification.type}
      />

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
        type={confirmDialog.type}
      />
    </div>
  );
}
