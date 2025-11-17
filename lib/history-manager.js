import { addConversationIfMissing, putMessage, updateConversationUsedCode, listConversations, getConversationMessages, deleteConversation, clearAllStores, putBlob, generateId as idbGenerateId } from './indexeddb';

class HistoryManager {
  constructor() {
    this.ready = false;
  }

  async ensureReady() {
    if (typeof window === 'undefined') return;
    if (this.ready) return;
    this.ready = true;
  }

  generateId() {
    return idbGenerateId();
  }

  /**
   * Add a history entry as part of a conversation. If the conversation does not exist, creates it.
   * This stores two messages (user + assistant) and any binary attachments in IndexedDB.
   *
   * data = {
   *   conversationId, chartType, userInput, generatedCode, config,
   *   images: [{ file, name, type }],
   *   files: [{ file, name, type, size }]
   * }
   */
  async addHistory(data) {
    await this.ensureReady();
    const conversationId = data.conversationId || this.generateId();
    const now = Date.now();

    // Ensure conversation exists
    await addConversationIfMissing({
      id: conversationId,
      title: data.userInput?.slice?.(0, 30) || '对话',
      chartType: data.chartType,
      config: data.config || null,
      editor: data.editor || undefined,
    });

    // Save binary attachments (if any) as blobs and collect references
    const attachmentRefs = [];
    const saveBlob = async (fileObj) => {
      try {
        const blobId = this.generateId();
        const file = fileObj?.file; // File or Blob
        if (!file) return null;
        const name = fileObj?.name || file.name || 'file';
        const type = fileObj?.type || file.type || 'application/octet-stream';
        const size = fileObj?.size || file.size || 0;
        await putBlob({ id: blobId, blob: file, name, type, size });
        return { blobId, name, type, size };
      } catch {
        return null;
      }
    };

    // images
    if (Array.isArray(data.images) && data.images.length > 0) {
      for (const im of data.images) {
        const ref = await saveBlob(im);
        if (ref) attachmentRefs.push({ ...ref, kind: 'image' });
      }
    }
    // files
    if (Array.isArray(data.files) && data.files.length > 0) {
      for (const f of data.files) {
        const ref = await saveBlob(f);
        if (ref) attachmentRefs.push({ ...ref, kind: 'file' });
      }
    }

    // Create user message
    const userMsg = {
      id: this.generateId(),
      conversationId,
      role: 'user',
      content: data.userInput || '',
      type: 'text',
      attachments: attachmentRefs,
      createdAt: now,
    };
    await putMessage(userMsg);

    // Create assistant message (XML/JSON depends on editor)
    const assistantMsg = {
      id: this.generateId(),
      conversationId,
      role: 'assistant',
      content: data.generatedCode || '',
      type: (data.editor === 'excalidraw') ? 'json' : 'xml',
      attachments: [],
      createdAt: now + 1,
    };
    await putMessage(assistantMsg);

    return { conversationId, userMessageId: userMsg.id, assistantMessageId: assistantMsg.id };
  }

  /**
   * Return conversation previews compatible with HistoryModal UI.
   * Each item includes: { id, chartType, userInput, generatedCode, usedCode, config, timestamp, editor }
   */
  async getHistories() {
    await this.ensureReady();
    const convs = await listConversations();
    const results = [];
    for (const c of convs) {
      const msgs = await getConversationMessages(c.id);

      // v6.0: Messages are in format { id, conversationId, message: { role, content }, createdAt }
      const lastAssistant = [...msgs].reverse().find(m => m.message?.role === 'assistant');
      const lastUser = [...msgs].reverse().find(m => m.message?.role === 'user');

      // Extract user preview from message content
      let userPreview = '';
      if (lastUser?.message?.content) {
        if (typeof lastUser.message.content === 'string') {
          userPreview = lastUser.message.content.trim();
        } else if (Array.isArray(lastUser.message.content)) {
          // Multimodal message: extract text parts
          const textParts = lastUser.message.content
            .filter(part => part?.type === 'text')
            .map(part => part?.text || '');
          userPreview = textParts.join(' ').trim();

          // If no text but has images, show image hint
          if (!userPreview) {
            const imageCount = lastUser.message.content.filter(part =>
              part?.type === 'image' || part?.type === 'image_url'
            ).length;
            if (imageCount > 0) {
              userPreview = `来自图片 (${imageCount}张)`;
            }
          }
        }
      }

      // Extract assistant code from message content
      const assistantCode = typeof lastAssistant?.message?.content === 'string'
        ? lastAssistant.message.content
        : '';

      results.push({
        id: c.id,
        chartType: c.chartType || 'auto',
        userInput: userPreview || '(空消息)',
        generatedCode: assistantCode,
        usedCode: c.usedCode || '', // ✨ v6.0: 实际应用的代码
        config: c.config || null,
        timestamp: c.updatedAt || c.createdAt || Date.now(),
        editor: (() => {
          // Prefer stored editor type
          if (c.editor) return c.editor;
          // Heuristic detection based on assistant content
          try {
            const content = assistantCode.trim();
            if (/<(mxfile|mxGraphModel|diagram)([\s>])/i.test(content)) return 'drawio';
            // Check fenced code hints
            if (/```\s*xml/i.test(content)) return 'drawio';
            if (/```\s*json/i.test(content)) return 'excalidraw';
            // Simple JSON shape hint
            const firstChar = content[0];
            if (firstChar === '[' || firstChar === '{') return 'excalidraw';
          } catch {}
          // Default to drawio if unknown (back-compat)
          return 'drawio';
        })(),
      });
    }
    return results;
  }

  async deleteHistory(id) {
    await this.ensureReady();
    await deleteConversation(id);
  }

  async clearAll() {
    await this.ensureReady();
    await clearAllStores();
  }

  async getConversationMessages(id) {
    await this.ensureReady();
    const msgs = await getConversationMessages(id);
    // 返回LLM原生格式
    return msgs.map(m => m.message);
  }

  /**
   * Add a single message to a conversation (v6.0 refactor)
   * message should be in LLM native format: { role, content }
   * editor: 'drawio' | 'excalidraw' (optional, used for conversation initialization)
   * config: LLM config object (optional, saved to conversation)
   * chartType: diagram type (optional, saved to conversation)
   */
  async addMessage(conversationId, message, editor, config, chartType) {
    await this.ensureReady();
    const now = Date.now();

    // Ensure conversation exists with editor type, config, and chartType
    await addConversationIfMissing({
      id: conversationId,
      title: '对话',
      editor: editor,
      config: config,
      chartType: chartType,
    });

    // Create message record
    const msgRecord = {
      id: this.generateId(),
      conversationId,
      message: message, // LLM native format
      createdAt: now,
    };

    await putMessage(msgRecord);
    return msgRecord.id;
  }

  /**
   * Update usedCode field of a conversation (v6.0 refactor)
   */
  async updateUsedCode(conversationId, usedCode) {
    await this.ensureReady();
    await updateConversationUsedCode(conversationId, usedCode);
  }
}

export const historyManager = new HistoryManager();
