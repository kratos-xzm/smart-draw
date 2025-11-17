'use client';

import { useState, useEffect } from 'react';
import ConfigManager from './ConfigManager';

/**
 * 组合设置弹窗：
 * - 左侧：展示当前模式（本地配置 / 访问密码）
 * - 访问密码模式：验证密码，从服务端获取远程 LLM 配置并写入 smart-diagram-remote-config
 * - "保存"按钮：持久化访问密码与模式开关 smart-diagram-use-password
 */
export default function CombinedSettingsModal({
  isOpen,
  onClose,
  usePassword: initialUsePassword,
  currentConfig,
  onConfigSelect,
}) {
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [isConfigManagerOpen, setIsConfigManagerOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (typeof window !== 'undefined') {
      const savedPassword =
        localStorage.getItem('smart-diagram-access-password') || '';
      const savedUsePassword =
        localStorage.getItem('smart-diagram-use-password') === 'true';
      setPassword(savedPassword);
      setUsePassword(
        savedUsePassword !== null
          ? savedUsePassword
          : !!initialUsePassword,
      );
    }
  }, [isOpen, initialUsePassword]);

  /**
   * 验证访问密码并从服务端获取远程 LLM 配置：
   * - 成功后写入 smart-diagram-remote-config
   * - 不直接切换模式，是否启用由下方“保存”按钮决定
   */
  const handleValidate = async () => {
    if (!password) {
      setMessage('请先输入访问密码');
      setMessageType('error');
      return;
    }

    setIsValidating(true);
    setMessage('');

    try {
      const response = await fetch('/api/llm/config', {
        method: 'POST',
        headers: { 'x-access-password': password },
      });

      const data = await response.json();

      if (data.success && data.config) {
        const remoteConfig = {
          name: '服务器配置（访问密码）',
          type: data.config.type,
          baseUrl: data.config.baseUrl,
          apiKey: data.config.apiKey,
          model: data.config.model,
        };

        if (typeof window !== 'undefined') {
          localStorage.setItem(
            'smart-diagram-remote-config',
            JSON.stringify(remoteConfig),
          );
        }

        setMessage('远程配置验证成功，可在访问密码模式下使用');
        setMessageType('success');

      } else {
        setMessage(data.error || '远程配置验证失败');
        setMessageType('error');
      }
    } catch (error) {
      setMessage('验证请求失败：' + error.message);
      setMessageType('error');
    } finally {
      setIsValidating(false);
    }
  };

  /**
   * 保存访问密码与模式开关：
   * - smart-diagram-access-password：访问密码
   * - smart-diagram-use-password：是否启用访问密码模式
   * - 同时发出 password-settings-changed 自定义事件，便于同标签页内同步
   */
  const handleSave = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'smart-diagram-access-password',
        password,
      );
      localStorage.setItem(
        'smart-diagram-use-password',
        usePassword.toString(),
      );
      window.dispatchEvent(
        new CustomEvent('password-settings-changed', {
          detail: { usePassword },
        }),
      );
    }
    setMessage('设置已保存');
    setMessageType('success');
    setTimeout(() => {
      onClose?.();
    }, 500);
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />

        {/* Modal */}
        <div className="relative bg-white rounded-lg border border-gray-200 w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900">
                配置与访问密码
              </h2>
              {/* 当前状态胶囊 */}
              {usePassword ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-green-50 border border-green-200 text-green-700 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />{' '}
                  服务器模式（访问密码）
                </span>
              ) : currentConfig ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  {(currentConfig.name || currentConfig.type)} -{' '}
                  {currentConfig.model}
                </span>
              ) : (
                <span className="text-xs text-gray-500">未配置</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsConfigManagerOpen(true)}
                className="text-sm text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-50"
                title="打开本地配置管理"
              >
                本地配置管理
              </button>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors duration-200"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* 提示文案 */}
            <p className="text-xs text-gray-500">
              访问密码模式的优先级高于本地 LLM
              配置；配置成功后，在"访问密码"模式下将使用服务器端配置。
            </p>

            {/* 密码输入 + 验证按钮 */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] items-center gap-2">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="访问密码"
                disabled={!usePassword}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-gray-900 ${
                  usePassword
                    ? 'border-gray-300 bg-white'
                    : 'border-gray-200 bg-gray-50 text-gray-400'
                }`}
              />
              <button
                onClick={handleValidate}
                disabled={isValidating || !usePassword}
                className="px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded hover:bg-gray-50 disabled:bg-gray-50 disabled:text-gray-400 transition-colors duration-200 text-sm whitespace-nowrap"
              >
                {isValidating ? '验证中...' : '验证'}
              </button>
            </div>

            {/* 模式切换：本地配置 <-> 访问密码 */}
            <div className="pt-1">
              <div className="inline-flex items-center text-sm">
                <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setUsePassword(false)}
                    className={`px-3 py-1.5 transition-colors duration-200 ${
                      !usePassword
                        ? 'bg-gray-900 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    本地配置
                  </button>
                  <button
                    type="button"
                    onClick={() => setUsePassword(true)}
                    className={`px-3 py-1.5 border-l border-gray-200 transition-colors duration-200 ${
                      usePassword
                        ? 'bg-gray-900 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    访问密码
                  </button>
                </div>
                <span className="ml-2 text-gray-500">
                  在本地配置和服务器配置之间切换。
                </span>
              </div>
            </div>

            {/* 内联反馈消息 */}
            {message && (
              <div
                className={`px-3 py-2 rounded border text-sm ${
                  messageType === 'success'
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {message}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100">
            <button
              onClick={onClose}
              className="px-3 py-2 text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors duration-200 text-sm"
            >
              关闭
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-2 text-white bg-gray-900 rounded hover:bg-gray-800 transition-colors duration-200 text-sm"
            >
              保存
            </button>
          </div>
        </div>
      </div>

      {/* ConfigManager as secondary modal (z-index higher than parent) */}
      {isConfigManagerOpen && (
        <ConfigManager
          isOpen={true}
          onClose={() => setIsConfigManagerOpen(false)}
          onConfigSelect={onConfigSelect}
        />
      )}
    </>
  );
}
