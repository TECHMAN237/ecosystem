// Shared Form Draft State Management for Child Safety Reports
// Ensures state persistence across steps, refreshes, remounts, and file uploads
// Uses a robust multi-tiered cache: In-Memory + IndexedDB + SessionStorage + LocalStorage

const DB_NAME = 'raydar_drafts_db';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';

// IndexedDB Helper
function openIndexedDB() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

async function idbGet(key) {
  try {
    const db = await openIndexedDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function idbSet(key, value) {
  try {
    const db = await openIndexedDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (e) {
    return false;
  }
}

async function idbRemove(key) {
  try {
    const db = await openIndexedDB();
    if (!db) return false;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (e) {
    return false;
  }
}

// In-memory cache to guarantee zero data loss during page lifetime
let inMemoryMissingDraft = {};
let inMemoryFoundDraft = {};

// Asynchronously hydrate from IndexedDB on startup
if (typeof window !== 'undefined') {
  (async () => {
    try {
      const savedMissing = await idbGet('draft_missing_report');
      if (savedMissing && typeof savedMissing === 'object') {
        inMemoryMissingDraft = { ...savedMissing, ...inMemoryMissingDraft };
        console.log('[REPORT TRACE] Hydrated missing draft from IndexedDB. Photo present:', !!inMemoryMissingDraft.photo);
      }
      const savedFound = await idbGet('draft_found_report');
      if (savedFound && typeof savedFound === 'object') {
        inMemoryFoundDraft = { ...savedFound, ...inMemoryFoundDraft };
        console.log('[REPORT TRACE] Hydrated found draft from IndexedDB. Photo present:', !!inMemoryFoundDraft.photo);
      }
    } catch (e) {
      console.warn('[REPORT TRACE] IndexedDB hydration notice:', e);
    }
  })();
}

export const formDraftState = {
  // --- MISSING CHILD REPORT DRAFT ---
  getMissingDraft() {
    try {
      const raw = localStorage.getItem('draft_missing_report') || sessionStorage.getItem('pending_report_data');
      let data = raw ? JSON.parse(raw) : {};

      // Merge with in-memory draft (in-memory takes precedence)
      data = { ...data, ...inMemoryMissingDraft };

      // Ensure photo is never lost
      const photo = inMemoryMissingDraft.photo || 
                    data.photo || 
                    sessionStorage.getItem('pending_report_photo') || 
                    localStorage.getItem('draft_missing_photo');
      if (photo) {
        data.photo = photo;
        inMemoryMissingDraft.photo = photo;
      }

      const bc = inMemoryMissingDraft.birthCertificate || data.birthCertificate || localStorage.getItem('draft_missing_bc');
      if (bc) {
        try { data.birthCertificate = typeof bc === 'string' ? JSON.parse(bc) : bc; } catch(e) { data.birthCertificate = bc; }
      }

      const guard = inMemoryMissingDraft.guardianshipDoc || data.guardianshipDoc || localStorage.getItem('draft_missing_guard');
      if (guard) {
        try { data.guardianshipDoc = typeof guard === 'string' ? JSON.parse(guard) : guard; } catch(e) { data.guardianshipDoc = guard; }
      }

      console.log('[REPORT TRACE] getMissingDraft retrieved:', {
        name: data.name,
        hasPhoto: !!data.photo,
        photoLength: data.photo ? data.photo.length : 0,
        age: data.age,
        location: data.location
      });

      return data;
    } catch (e) {
      console.error('[REPORT TRACE] Error reading missing draft:', e);
      return inMemoryMissingDraft || {};
    }
  },

  async getMissingDraftAsync() {
    let draft = this.getMissingDraft();
    if (!draft.photo) {
      const idbData = await idbGet('draft_missing_report');
      if (idbData && idbData.photo) {
        draft.photo = idbData.photo;
        inMemoryMissingDraft.photo = idbData.photo;
        console.log('[REPORT TRACE] Recovered missing draft photo from IndexedDB');
      }
    }
    return draft;
  },

  updateMissingDraft(fields) {
    try {
      console.log('[REPORT TRACE] Updating missing draft with fields:', Object.keys(fields));
      const current = this.getMissingDraft();
      
      // CRITICAL: If new fields do NOT include photo, PRESERVE existing photo!
      const photoToPreserve = fields.photo || current.photo || inMemoryMissingDraft.photo;
      const updated = { ...current, ...fields };
      if (photoToPreserve) {
        updated.photo = photoToPreserve;
      }

      inMemoryMissingDraft = { ...inMemoryMissingDraft, ...updated };

      // Persist to IndexedDB (asynchronous, high capacity, no quota limit)
      idbSet('draft_missing_report', updated).catch(() => {});

      // Safe persistence to sessionStorage
      try {
        sessionStorage.setItem('pending_report_data', JSON.stringify(updated));
        if (updated.photo) {
          sessionStorage.setItem('pending_report_photo', updated.photo);
        }
      } catch (err) {
        console.warn('[REPORT TRACE] SessionStorage write warning:', err);
      }

      // Safe persistence to localStorage with quota protection
      try {
        localStorage.setItem('draft_missing_report', JSON.stringify(updated));
        if (updated.photo && updated.photo.length < 500000) {
          localStorage.setItem('draft_missing_photo', updated.photo);
        }
      } catch (err) {
        console.warn('[REPORT TRACE] LocalStorage quota reached for full draft, persisting light metadata');
        try {
          const lightUpdated = { ...updated };
          delete lightUpdated.photo; // Photo is preserved safely in inMemory and IndexedDB
          localStorage.setItem('draft_missing_report', JSON.stringify(lightUpdated));
        } catch (e2) {}
      }

      if (fields.birthCertificate !== undefined) {
        if (fields.birthCertificate) {
          const bcVal = typeof fields.birthCertificate === 'object' ? JSON.stringify(fields.birthCertificate) : fields.birthCertificate;
          try { localStorage.setItem('draft_missing_bc', bcVal); } catch(e){}
        } else {
          localStorage.removeItem('draft_missing_bc');
        }
      }

      if (fields.guardianshipDoc !== undefined) {
        if (fields.guardianshipDoc) {
          const guardVal = typeof fields.guardianshipDoc === 'object' ? JSON.stringify(fields.guardianshipDoc) : fields.guardianshipDoc;
          try { localStorage.setItem('draft_missing_guard', guardVal); } catch(e){}
        } else {
          localStorage.removeItem('draft_missing_guard');
        }
      }

      console.log('[REPORT TRACE] Missing draft updated. Current photo present:', !!updated.photo, 'Length:', updated.photo ? updated.photo.length : 0);
      return updated;
    } catch (e) {
      console.error('[REPORT TRACE] Error updating missing draft:', e);
      return inMemoryMissingDraft;
    }
  },

  clearMissingDraft() {
    console.log('[REPORT TRACE] Clearing missing draft cache');
    inMemoryMissingDraft = {};
    idbRemove('draft_missing_report').catch(() => {});
    try {
      localStorage.removeItem('draft_missing_report');
      localStorage.removeItem('draft_missing_photo');
      localStorage.removeItem('draft_missing_bc');
      localStorage.removeItem('draft_missing_guard');
      sessionStorage.removeItem('pending_report_data');
      sessionStorage.removeItem('pending_report_photo');
    } catch (e) {}
  },

  // --- FOUND CHILD REPORT DRAFT ---
  getFoundDraft() {
    try {
      const raw = localStorage.getItem('draft_found_report') || sessionStorage.getItem('pending_found_data');
      let data = raw ? JSON.parse(raw) : {};
      data = { ...data, ...inMemoryFoundDraft };

      const photo = inMemoryFoundDraft.photo || 
                    data.photo || 
                    sessionStorage.getItem('pending_found_photo') || 
                    sessionStorage.getItem('pending_found_child_photo') || 
                    localStorage.getItem('draft_found_photo');
      if (photo) {
        data.photo = photo;
        inMemoryFoundDraft.photo = photo;
      }

      const childPhoto = inMemoryFoundDraft.childPhoto || 
                         data.childPhoto || 
                         sessionStorage.getItem('pending_found_child_photo') || 
                         localStorage.getItem('draft_found_child_photo') || 
                         photo;
      if (childPhoto) {
        data.childPhoto = childPhoto;
        inMemoryFoundDraft.childPhoto = childPhoto;
      }

      const envPhoto = inMemoryFoundDraft.envPhoto || 
                       data.envPhoto || 
                       sessionStorage.getItem('pending_found_env_photo') || 
                       localStorage.getItem('draft_found_env_photo');
      if (envPhoto) {
        data.envPhoto = envPhoto;
        inMemoryFoundDraft.envPhoto = envPhoto;
      }

      console.log('[REPORT TRACE] getFoundDraft retrieved:', {
        hasPhoto: !!data.photo,
        hasChildPhoto: !!data.childPhoto,
        hasEnvPhoto: !!data.envPhoto,
        location: data.location
      });

      return data;
    } catch (e) {
      console.error('[REPORT TRACE] Error reading found draft:', e);
      return inMemoryFoundDraft || {};
    }
  },

  async getFoundDraftAsync() {
    let draft = this.getFoundDraft();
    if (!draft.photo && !draft.childPhoto) {
      const idbData = await idbGet('draft_found_report');
      if (idbData && (idbData.photo || idbData.childPhoto)) {
        draft.photo = idbData.photo || idbData.childPhoto;
        draft.childPhoto = idbData.childPhoto || idbData.photo;
        inMemoryFoundDraft.photo = draft.photo;
        inMemoryFoundDraft.childPhoto = draft.childPhoto;
        console.log('[REPORT TRACE] Recovered found draft photo from IndexedDB');
      }
    }
    return draft;
  },

  updateFoundDraft(fields) {
    try {
      console.log('[REPORT TRACE] Updating found draft with fields:', Object.keys(fields));
      const current = this.getFoundDraft();
      
      const photoToPreserve = fields.photo || fields.childPhoto || current.photo || current.childPhoto || inMemoryFoundDraft.photo;
      const updated = { ...current, ...fields };
      if (photoToPreserve) {
        updated.photo = photoToPreserve;
        if (!updated.childPhoto) updated.childPhoto = photoToPreserve;
      }

      inMemoryFoundDraft = { ...inMemoryFoundDraft, ...updated };

      idbSet('draft_found_report', updated).catch(() => {});

      try {
        sessionStorage.setItem('pending_found_data', JSON.stringify(updated));
        if (updated.photo) sessionStorage.setItem('pending_found_photo', updated.photo);
        if (updated.childPhoto) sessionStorage.setItem('pending_found_child_photo', updated.childPhoto);
        if (updated.envPhoto) sessionStorage.setItem('pending_found_env_photo', updated.envPhoto);
      } catch (err) {}

      try {
        localStorage.setItem('draft_found_report', JSON.stringify(updated));
      } catch (err) {
        try {
          const lightUpdated = { ...updated };
          delete lightUpdated.photo;
          delete lightUpdated.childPhoto;
          delete lightUpdated.envPhoto;
          localStorage.setItem('draft_found_report', JSON.stringify(lightUpdated));
        } catch (e2) {}
      }

      return updated;
    } catch (e) {
      console.error('[REPORT TRACE] Error updating found draft:', e);
      return inMemoryFoundDraft;
    }
  },

  clearFoundDraft() {
    console.log('[REPORT TRACE] Clearing found draft cache');
    inMemoryFoundDraft = {};
    idbRemove('draft_found_report').catch(() => {});
    try {
      localStorage.removeItem('draft_found_report');
      localStorage.removeItem('draft_found_photo');
      localStorage.removeItem('draft_found_child_photo');
      localStorage.removeItem('draft_found_env_photo');
      sessionStorage.removeItem('pending_found_data');
      sessionStorage.removeItem('pending_found_photo');
      sessionStorage.removeItem('pending_found_child_photo');
      sessionStorage.removeItem('pending_found_env_photo');
    } catch (e) {}
  }
};
