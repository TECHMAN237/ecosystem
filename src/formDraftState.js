// Shared Form Draft State Management for Child Safety Reports
// Ensures state persistence across steps, refreshes, remounts, and file uploads

export const formDraftState = {
  // --- MISSING CHILD REPORT DRAFT ---
  getMissingDraft() {
    try {
      const raw = localStorage.getItem('draft_missing_report') || sessionStorage.getItem('pending_report_data');
      let data = raw ? JSON.parse(raw) : {};

      const photo = localStorage.getItem('draft_missing_photo') || sessionStorage.getItem('pending_report_photo');
      if (photo && !data.photo) {
        data.photo = photo;
      }

      const bc = localStorage.getItem('draft_missing_bc');
      if (bc && !data.birthCertificate) {
        try { data.birthCertificate = JSON.parse(bc); } catch(e) { data.birthCertificate = bc; }
      }

      const guard = localStorage.getItem('draft_missing_guard');
      if (guard && !data.guardianshipDoc) {
        try { data.guardianshipDoc = JSON.parse(guard); } catch(e) { data.guardianshipDoc = guard; }
      }

      return data;
    } catch (e) {
      console.error('Error reading missing draft:', e);
      return {};
    }
  },

  updateMissingDraft(fields) {
    try {
      const current = this.getMissingDraft();
      const updated = { ...current, ...fields };
      
      try {
        localStorage.setItem('draft_missing_report', JSON.stringify(updated));
      } catch (err) {
        console.warn('LocalStorage quota exceeded for missing report draft');
      }
      try {
        sessionStorage.setItem('pending_report_data', JSON.stringify(updated));
      } catch (err) {}

      if (fields.photo) {
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
      console.error('Error updating missing draft:', e);
    }
  },

  clearMissingDraft() {
    localStorage.removeItem('draft_missing_report');
    localStorage.removeItem('draft_missing_photo');
    localStorage.removeItem('draft_missing_bc');
    localStorage.removeItem('draft_missing_guard');
    sessionStorage.removeItem('pending_report_data');
    sessionStorage.removeItem('pending_report_photo');
  },

  // --- FOUND CHILD REPORT DRAFT ---
  getFoundDraft() {
    try {
      const raw = localStorage.getItem('draft_found_report') || sessionStorage.getItem('pending_found_data');
      let data = raw ? JSON.parse(raw) : {};

      const photo = localStorage.getItem('draft_found_photo') || sessionStorage.getItem('pending_found_photo');
      if (photo && !data.photo) {
        data.photo = photo;
      }

      const evidence = localStorage.getItem('draft_found_evidence');
      if (evidence && !data.evidencePhotos) {
        try { data.evidencePhotos = JSON.parse(evidence); } catch(e) {}
      }

      return data;
    } catch (e) {
      console.error('Error reading found draft:', e);
      return {};
    }
  },

  updateFoundDraft(fields) {
    try {
      const current = this.getFoundDraft();
      const updated = { ...current, ...fields };

      try {
        localStorage.setItem('draft_found_report', JSON.stringify(updated));
      } catch (err) {
        console.warn('LocalStorage quota exceeded for found report draft');
      }
      try {
        sessionStorage.setItem('pending_found_data', JSON.stringify(updated));
      } catch (err) {}

      if (fields.photo) {
        try { localStorage.setItem('draft_found_photo', fields.photo); } catch(e){}
        try { sessionStorage.setItem('pending_found_photo', fields.photo); } catch(e){}
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
      console.error('Error updating found draft:', e);
    }
  },

  clearFoundDraft() {
    localStorage.removeItem('draft_found_report');
    localStorage.removeItem('draft_found_photo');
    localStorage.removeItem('draft_found_evidence');
    sessionStorage.removeItem('pending_found_data');
    sessionStorage.removeItem('pending_found_photo');
  }
};

if (typeof window !== 'undefined') {
  window.formDraftState = formDraftState;
}
