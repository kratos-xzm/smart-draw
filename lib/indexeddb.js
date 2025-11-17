'use client';

// Lightweight IndexedDB helper focused on simple CRUD for conversations/messages/blobs

const DB_NAME = 'smart-diagram-db';
const DB_VERSION = 2; // Upgraded for v6.0 refactor

let dbPromise = null;

export function openDB() {
  if (typeof window === 'undefined') return Promise.reject(new Error('IndexedDB unavailable on server'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion || 0;
      const tx = event.target.transaction;

      // version 1 schema
      if (oldVersion < 1) {
        // Conversations store: one record per conversation
        const conv = db.createObjectStore('conversations', { keyPath: 'id' });
        conv.createIndex('updatedAt', 'updatedAt', { unique: false });

        // Messages store: individual messages linked to conversations
        const msg = db.createObjectStore('messages', { keyPath: 'id' });
        msg.createIndex('conversationId', 'conversationId', { unique: false });
        msg.createIndex('createdAt', 'createdAt', { unique: false });

        // Blobs/attachments store: binary payloads
        db.createObjectStore('blobs', { keyPath: 'id' });
      }

      // version 2 schema (v6.0 refactor)
      if (oldVersion < 2) {
        // Add usedCode field to conversations (no migration needed, default to '')
        // Add message field to messages (migrate existing data)

        const msgStore = tx.objectStore('messages');
        const convStore = tx.objectStore('conversations');

        // Migrate conversations: add usedCode field (initialize to empty string)
        const convReq = convStore.openCursor();
        convReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const conv = cursor.value;
            if (typeof conv.usedCode === 'undefined') {
              conv.usedCode = ''; // Initialize usedCode field
            }
            cursor.update(conv);
            cursor.continue();
          }
        };

        // Migrate messages: convert to LLM native format
        // Old format: { id, conversationId, role, content, type, attachments, createdAt }
        // New format: { id, conversationId, message: { role, content }, createdAt }
        const msgReq = msgStore.openCursor();
        msgReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const msg = cursor.value;
            // If message field doesn't exist, migrate
            if (typeof msg.message === 'undefined') {
              const newMsg = {
                id: msg.id,
                conversationId: msg.conversationId,
                message: {
                  role: msg.role || 'user',
                  content: msg.content || ''
                },
                createdAt: msg.createdAt || Date.now()
              };
              cursor.update(newMsg);
            }
            cursor.continue();
          }
        };
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function withTx(stores, mode, fn) {
  const db = await openDB();
  const tx = db.transaction(stores, mode);
  const storeMap = Object.fromEntries(stores.map((name) => [name, tx.objectStore(name)]));
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
  const res = await fn(storeMap, tx);
  await done;
  return res;
}

export function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function addConversationIfMissing({ id, title, chartType, config, editor }) {
  const now = Date.now();
  return withTx(['conversations'], 'readwrite', async ({ conversations }) => {
    const getReq = conversations.get(id);
    const existing = await reqAsPromise(getReq);
    const record = existing || { id, title: title || '对话', chartType: chartType || 'auto', config: config || null, usedCode: '', createdAt: now, updatedAt: now };
    if (existing) {
      record.updatedAt = now;
      if (title) record.title = title;
      if (chartType) record.chartType = chartType;
      if (config) record.config = config;
      if (editor) record.editor = editor;
    } else {
      if (editor) record.editor = editor;
      record.usedCode = ''; // Initialize usedCode for new conversations
    }
    await reqAsPromise(conversations.put(record));
    return record;
  });
}

export async function updateConversationUsedCode(conversationId, usedCode) {
  const now = Date.now();
  return withTx(['conversations'], 'readwrite', async ({ conversations }) => {
    const getReq = conversations.get(conversationId);
    const existing = await reqAsPromise(getReq);
    if (existing) {
      existing.usedCode = usedCode || '';
      existing.updatedAt = now;
      await reqAsPromise(conversations.put(existing));
    }
  });
}

export async function putMessage(message) {
  return withTx(['messages', 'conversations'], 'readwrite', async ({ messages, conversations }) => {
    await reqAsPromise(messages.put(message));
    // bump conversation updatedAt
    const conv = await reqAsPromise(conversations.get(message.conversationId));
    if (conv) {
      conv.updatedAt = Math.max(conv.updatedAt || 0, message.createdAt || Date.now());
      await reqAsPromise(conversations.put(conv));
    }
  });
}

export async function getConversationMessages(conversationId) {
  return withTx(['messages'], 'readonly', async ({ messages }) => {
    const idx = messages.index('conversationId');
    const range = IDBKeyRange.only(conversationId);
    const results = await getAllFromIndex(idx, range);
    results.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return results;
  });
}

export async function listConversations() {
  return withTx(['conversations'], 'readonly', async ({ conversations }) => {
    const all = await getAllStore(conversations);
    all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return all;
  });
}

export async function deleteConversation(conversationId) {
  // delete messages and collect blob ids, then delete conversation
  return withTx(['messages', 'conversations', 'blobs'], 'readwrite', async ({ messages, conversations, blobs }) => {
    // delete messages in conversation
    const idx = messages.index('conversationId');
    const range = IDBKeyRange.only(conversationId);
    const msgList = await getAllFromIndex(idx, range);
    const blobIds = new Set();
    for (const m of msgList) {
      if (Array.isArray(m.attachments)) {
        m.attachments.forEach((att) => { if (att && att.blobId) blobIds.add(att.blobId); });
      }
      await reqAsPromise(messages.delete(m.id));
    }
    for (const id of blobIds) {
      await reqAsPromise(blobs.delete(id));
    }
    await reqAsPromise(conversations.delete(conversationId));
  });
}

export async function clearAllStores() {
  return withTx(['messages', 'conversations', 'blobs'], 'readwrite', async ({ messages, conversations, blobs }) => {
    await reqAsPromise(messages.clear());
    await reqAsPromise(conversations.clear());
    await reqAsPromise(blobs.clear());
  });
}

export async function putBlob({ id, blob, name, type, size }) {
  return withTx(['blobs'], 'readwrite', async ({ blobs }) => {
    await reqAsPromise(blobs.put({ id, blob, name, type, size }));
  });
}

export async function getBlob(id) {
  return withTx(['blobs'], 'readonly', async ({ blobs }) => {
    return reqAsPromise(blobs.get(id));
  });
}

// Helpers
function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllStore(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function getAllFromIndex(index, range) {
  return new Promise((resolve, reject) => {
    const req = index.getAll(range);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
