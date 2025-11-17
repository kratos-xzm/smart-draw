/**
 * LLM 配置统一读取入口
 * - 封装多配置、本地配置 & 访问密码远程配置的选择逻辑
 * - 对旧版本单一配置做兼容迁移
 */

import { configManager } from './config-manager.js';

// 早期版本使用的单一配置 key
const LEGACY_CONFIG_KEY = 'smart-excalidraw-config';

// 新版多配置相关 key
// 通过访问密码从后端获取的远程配置
const REMOTE_CONFIG_KEY = 'smart-diagram-remote-config';
// 最终生效配置的快照（用于状态监听 / 调试）
const ACTIVE_CONFIG_SNAPSHOT_KEY = 'smart-diagram-active-config';
// 是否启用“访问密码模式”
const USE_PASSWORD_KEY = 'smart-diagram-use-password';

/**
 * 将旧版单一配置迁移到新的多配置管理器中
 */
function migrateLegacyConfig() {
  if (typeof window === 'undefined') return;

  try {
    const legacyConfig = localStorage.getItem(LEGACY_CONFIG_KEY);
    if (legacyConfig && configManager.getAllConfigs().length === 0) {
      const config = JSON.parse(legacyConfig);
      configManager.createConfig({
        name: config.name || '迁移的配置',
        type: config.type,
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        description: '从旧版本迁移的配置',
      });

      localStorage.removeItem(LEGACY_CONFIG_KEY);
    }
  } catch (error) {
    console.error('Failed to migrate legacy config:', error);
  }
}

/**
 * 从 localStorage 中读取远程配置
 */
function getRemoteConfigFromStorage() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(REMOTE_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.error('Failed to parse remote config:', error);
    return null;
  }
}

/**
 * 校验配置是否完整可用
 * @param {Object} config
 * @returns {boolean}
 */
export function isConfigValid(config) {
  if (!config) return false;

  return !!(
    config.type &&
    config.baseUrl &&
    config.apiKey &&
    config.model
  );
}

/**
 * 根据当前模式（访问密码 / 本地配置）选择最终生效的配置，
 * 并同步一份快照到 smart-diagram-active-config。
 */
function selectActiveConfig() {
  if (typeof window === 'undefined') return null;

  migrateLegacyConfig();

  const usePassword = localStorage.getItem(USE_PASSWORD_KEY) === 'true';

  const remoteConfig = getRemoteConfigFromStorage();
  const activeLocalConfig = configManager.getActiveConfig();

  let selected = null;
  let source = null;

  if (usePassword) {
    // 访问密码模式：使用远程配置
    if (isConfigValid(remoteConfig)) {
      selected = remoteConfig;
      source = 'remote';
    } else {
      selected = null;
      source = 'remote';
    }
  } else {
    // 本地配置模式：使用当前激活的本地配置
    if (isConfigValid(activeLocalConfig)) {
      selected = activeLocalConfig;
      source = 'local';
    } else {
      selected = null;
      source = 'local';
    }
  }

  // 同步快照到 localStorage，方便 UI 监听 & 调试
  try {
    if (selected) {
      const snapshot = {
        name: selected.name,
        type: selected.type,
        baseUrl: selected.baseUrl,
        apiKey: selected.apiKey,
        model: selected.model,
        description: selected.description || '',
        source,
      };
      localStorage.setItem(
        ACTIVE_CONFIG_SNAPSHOT_KEY,
        JSON.stringify(snapshot),
      );
    } else {
      localStorage.removeItem(ACTIVE_CONFIG_SNAPSHOT_KEY);
    }
  } catch {
    // ignore
  }

  return selected;
}

/**
 * 获取当前“最终生效”的 LLM 配置
 * @returns {Object|null}
 */
export function getConfig() {
  if (typeof window === 'undefined') return null;

  const activeConfig = selectActiveConfig();
  if (!activeConfig) return null;

  // 旧代码只关心以下字段
  return {
    name: activeConfig.name,
    type: activeConfig.type,
    baseUrl: activeConfig.baseUrl,
    apiKey: activeConfig.apiKey,
    model: activeConfig.model,
  };
}

/**
 * 保存“当前本地激活配置”的内容（仅作用于本地配置维度）
 * - 如果已经有激活配置，则更新该配置
 * - 如果没有，则创建新配置并设为激活
 * - 如果当前处于“本地配置模式”，会顺带刷新一次最终配置快照
 */
export function saveConfig(config) {
  if (typeof window === 'undefined') return;

  try {
    migrateLegacyConfig();

    const activeLocal = configManager.getActiveConfig();
    let updated;

    if (activeLocal) {
      updated = configManager.updateConfig(activeLocal.id, config);
    } else {
      const created = configManager.createConfig(config);
      updated = configManager.setActiveConfig(created.id);
    }

    if (typeof window !== 'undefined') {
      const usePassword = localStorage.getItem(USE_PASSWORD_KEY) === 'true';
      if (!usePassword && isConfigValid(updated)) {
        const snapshot = {
          name: updated.name,
          type: updated.type,
          baseUrl: updated.baseUrl,
          apiKey: updated.apiKey,
          model: updated.model,
          description: updated.description || '',
          source: 'local',
        };
        try {
          localStorage.setItem(
            ACTIVE_CONFIG_SNAPSHOT_KEY,
            JSON.stringify(snapshot),
          );
        } catch {
          // ignore
        }
      }
    }
  } catch (error) {
    console.error('Failed to save config:', error);
    throw error;
  }
}

// 导出 configManager 供配置管理界面直接使用
export { configManager };

