// Shared Form Draft State Management for Child Safety Reports
// Ensures state persistence across steps, refreshes, remounts, and file uploads

// In-memory cache to guarantee zero data loss across steps even if localStorage quota is reached
let inMemoryMissingDraft = {};
let inMemoryFoundDraft = {};

export const formDraftState = {
  // --- MISSING CHILD REPORT DRAFT ---
  getMissingDraft() {
    try {
      const raw = localStorage.getItem('draft_missing_report') || sessionStorage.getItem('pending_report_data');
      let data = raw ? JSON.parse(raw) : {};

      // Merge with in-memory draft (in-memory takes precedence for un-serializable or fresh data)
      data = { ...data, ...inMemoryMissingDraft };

      const photo = inMemoryMissingDraft.photo || localStorage.getItem('draft_missing_photo') || sessionStorage.getItem('pending_report_photo');
      if (photo && !data.photo) {
        data.photo = photo;
      }

      const bc = inMemoryMissingDraft.birthCertificate || localStorage.getItem('draft_missing_bc');
      if (bc && !data.birthCertificate) {
        try { data.birthCertificate = typeof bc === 'string' ? JSON.parse(bc) : bc; } catch(e) { data.birthCertificate = bc; }
      }

      const guard = inMemoryMissingDraft.guardianshipDoc || localStorage.getItem('draft_missing_guard');
      if (guard && !data.guardianshipDoc) {
        try { data.guardianshipDoc = typeof guard === 'string' ? JSON.parse(guard) : guard; } catch(e) { data.guardianshipDoc = guard; }
      }

      return data;
    } catch (e) {
      console.error('[REPORT TRACE] Error reading missing draft:', e);
      return inMemoryMissingDraft || {};
    }
  },

  updateMissingDraft(fields) {
    try {
      console.log('[REPORT TRACE] Updating missing draft with fields:', Object.keys(fields));
      const current = this.getMissingDraft();
      const updated = { ...current, ...fields };
      inMemoryMissingDraft = updated;

      // Safe persistence without crashing on quota
      try {
        localStorage.setItem('draft_missing_report', JSON.stringify(updated));
      } catch (err) {
        console.warn('[REPORT TRACE] LocalStorage quota warning for draft_missing_report, persisting in memory & sessionStorage');
        try {
          const lightUpdated = { ...updated };
          if (lightUpdated.photo && lightUpdated.photo.length > 500000) delete lightUpdated.photo;
          localStorage.setItem('draft_missing_report', JSON.stringify(lightUpdated));
        } catch (e2) {}
      }

      try {
        sessionStorage.setItem('pending_report_data', JSON.stringify(updated));
      } catch (err) {}

      if (fields.photo) {
        inMemoryMissingDraft.photo = fields.photo;
        try { localStorage.setItem('draft_missing_photo', fields.photo); } catch(e){}
        try { sessionStorage.setItem('pending_report_photo', fields.photo); } catch(e){}
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

      return updated;
    } catch (e) {
      console.error('[REPORT TRACE] Error updating missing draft:', e);
    }
  },

  clearMissingDraft() {
    console.log('[REPORT TRACE] Clearing missing draft cache');
    inMemoryMissingDraft = {};
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

      const photo = inMemoryFoundDraft.photo || localStorage.getItem('draft_found_photo') || sessionStorage.getItem('pending_found_photo') || sessionStorage.getItem('pending_found_child_photo');
      if (photo && !data.photo) {
        data.photo = photo;
      }
      const childPhoto = inMemoryFoundDraft.childPhoto || sessionStorage.getItem('pending_found_child_photo') || localStorage.getItem('draft_found_child_photo');
      if (childPhoto && !data.childPhoto) {
        data.childPhoto = childPhoto;
      }
      const envPhoto = inMemoryFoundDraft.envPhoto || sessionStorage.getItem('pending_found_env_photo') || localStorage.getItem('draft_found_env_photo');
      if (envPhoto && !data.envPhoto) {
        data.envPhoto = envPhoto;
      }
      const evidence = inMemoryFoundDraft.evidencePhotos || localStorage.getItem('draft_found_evidence');
      if (evidence && !data.evidencePhotos) {
        try { data.evidencePhotos = typeof evidence === 'string' ? JSON.parse(evidence) : evidence; } catch(e) {}
      }

      return data;
    } catch (e) {
      console.error('[REPORT TRACE] Error reading found draft:', e);
      return inMemoryFoundDraft || {};
    }
  },

  updateFoundDraft(fields) {
    try {
      console.log('[REPORT TRACE] Updating found draft with fields:', Object.keys(fields));
      const current = this.getFoundDraft();
      const updated = { ...current, ...fields };
      inMemoryFoundDraft = updated;

      try {
        localStorage.setItem('draft_found_report', JSON.stringify(updated));
      } catch (err) {
        try {
          const lightUpdated = { ...updated };
          if (lightUpdated.photo && lightUpdated.photo.length > 500000) delete lightUpdated.photo;
          if (lightUpdated.childPhoto && lightUpdated.childPhoto.length > 500000) delete lightUpdated.childPhoto;
          if (lightUpdated.envPhoto && lightUpdated.envPhoto.length > 500000) delete lightUpdated.envPhoto;
          localStorage.setItem('draft_found_report', JSON.stringify(lightUpdated));
        } catch (e2) {}
      }
      try {
        sessionStorage.setItem('pending_found_data', JSON.stringify(updated));
      } catch (err) {}

      if (fields.photo) {
        inMemoryFoundDraft.photo = fields.photo;
        try { localStorage.setItem('draft_found_photo', fields.photo); } catch(e){}
        try { sessionStorage.setItem('pending_found_photo', fields.photo); } catch(e){}
      }
      if (fields.childPhoto) {
        inMemoryFoundDraft.childPhoto = fields.childPhoto;
        try { localStorage.setItem('draft_found_child_photo', fields.childPhoto); } catch(e){}
        try { sessionStorage.setItem('pending_found_child_photo', fields.childPhoto); } catch(e){}
      }
      if (fields.envPhoto) {
        inMemoryFoundDraft.envPhoto = fields.envPhoto;
        try { localStorage.setItem('draft_found_env_photo', fields.envPhoto); } catch(e){}
        try { sessionStorage.setItem('pending_found_env_photo', fields.envPhoto); } catch(e){}
      }
      if (fields.evidencePhotos !== undefined) {
        if (fields.evidencePhotos) {
          try { localStorage.setItem('draft_found_evidence', JSON.stringify(fields.evidencePhotos)); } catch(e){}
        } else {
          localStorage.removeItem('draft_found_evidence');
        }
      }

      return updated;
    } catch (e) {
      console.error('[REPORT TRACE] Error updating found draft:', e);
    }
  },

  clearFoundDraft() {
    console.log('[REPORT TRACE] Clearing found draft cache');
    inMemoryFoundDraft = {};
    try {
      localStorage.removeItem('draft_found_report');
      localStorage.removeItem('draft_found_photo');
      localStorage.removeItem('draft_found_child_photo');
      localStorage.removeItem('draft_found_env_photo');
      localStorage.removeItem('draft_found_evidence');
      sessionStorage.removeItem('pending_found_data');
      sessionStorage.removeItem('pending_found_photo');
      sessionStorage.removeItem('pending_found_child_photo');
      sessionStorage.removeItem('pending_found_env_photo');
    } catch (e) {}
  }
};

if (typeof window !== 'undefined') {
  window.formDraftState = formDraftState;
}
