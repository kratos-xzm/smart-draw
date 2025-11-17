'use client';

import { useState, useEffect } from 'react';
import { historyManager } from '../lib/history-manager.js';
import { CHART_TYPES } from '../lib/constants.js';
import ConfirmDialog from './ConfirmDialog';
import { X as XIcon, Trash2, RotateCcw, HardDrive, Clock as ClockIcon } from 'lucide-react';

export default function HistoryModal({ isOpen, onClose, onApply, editorType }) {
  const [histories, setHistories] = useState([]);
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: null
  });

  useEffect(() => {
    if (isOpen) {
      loadHistories();
    }
  }, [isOpen]);

  const loadHistories = async () => {
    try {
      const allHistories = await historyManager.getHistories();
      const filtered = Array.isArray(allHistories)
        ? allHistories.filter((h) => {
            if (!editorType) return true;
            const edt = (h.editor || 'drawio');
            return edt === editorType;
          })
        : [];
      setHistories(filtered);
    } catch (e) {
      console.error('Failed to load histories', e);
      setHistories([]);
    }
  };

  const handleApply = (history) => {
    onApply?.(history);
    onClose();
  };

  const handleDelete = (id) => {
    setConfirmDialog({
      isOpen: true,
      title: '确认删除',
      message: '确定要删除这条历史记录吗？',
      onConfirm: async () => {
        await historyManager.deleteHistory(id);
        await loadHistories();
      }
    });
  };

  const handleClearAll = () => {
    setConfirmDialog({
      isOpen: true,
      title: '确认清空',
      message: '确定要清空所有历史记录吗？此操作不可恢复。',
      onConfirm: async () => {
        await historyManager.clearAll();
        await loadHistories();
      }
    });
  };

  const truncateText = (text, maxLength = 100) => {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-white rounded border border-gray-300 w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <ClockIcon className="w-5 h-5 text-gray-700" />
            <h2 className="text-lg font-semibold text-gray-900">历史记录</h2>
          </div>
          <div className="flex items-center gap-2">
            {histories.length > 0 && (
              <button
                onClick={handleClearAll}
                className="p-2 rounded text-red-600 hover:bg-red-50 transition-colors duration-200"
                title="清空全部"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors duration-200"
              title="关闭"
            >
              <XIcon className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="mb-3 text-xs text-gray-600 flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-gray-500" />
            <span>所有历史记录都存放在本地</span>
          </div>

          <div className="space-y-3">
            {histories.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                暂无历史记录
              </div>
            ) : (
              histories.map((history) => (
                <div
                  key={history.id}
                  className="border border-gray-200 rounded-lg p-4 hover:border-gray-300"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded">
                          {CHART_TYPES[history.chartType] || history.chartType}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(history.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-gray-900 mb-2">
                        {truncateText(history.userInput)}
                      </p>
                      {history.config && history.config.name && history.config.model && (
                        <div className="text-xs text-gray-500">
                          模型: {history.config.name} - {history.config.model}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 ml-4">
                      <button
                        onClick={() => handleApply(history)}
                        className="p-2 rounded text-blue-600 hover:text-blue-700 hover:bg-blue-50 transition-colors duration-200"
                        title="应用"
                        aria-label="应用"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(history.id)}
                        className="p-2 rounded text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors duration-200"
                        title="删除"
                        aria-label="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        onConfirm={() => {
          confirmDialog.onConfirm?.();
          setConfirmDialog({ ...confirmDialog, isOpen: false });
        }}
        title={confirmDialog.title}
        message={confirmDialog.message}
        type="danger"
      />
    </div>
  );
}
