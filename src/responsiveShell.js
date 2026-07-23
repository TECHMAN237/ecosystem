// Responsive Shell for Child Safety / SafeGuardian
// Ensures consistent Left Sidebar on Desktop (min-width: 768px) and Bottom Navigation on Mobile (max-width: 767px)

(function () {
    // 1. Inject Styles
    const styleId = 'responsive-shell-styles';
    if (!document.getElementById(styleId)) {
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = `
            /* Desktop Layout Offsets */
            @media (min-width: 768px) {
                body:not(.v2-preview-page) main,
                body:not(.v2-preview-page) .main-content-area {
                    margin-left: 16rem !important;
                    max-width: calc(100% - 16rem) !important;
                }
                body:not(.v2-preview-page) {
                    padding-bottom: 0 !important;
                }
                /* Offset fixed action bars on desktop to accommodate left sidebar */
                body:not(.v2-preview-page) nav.fixed.bottom-0:not(.mobile-bottom-nav),
                body:not(.v2-preview-page) footer.fixed.bottom-0:not(.mobile-bottom-nav),
                body:not(.v2-preview-page) div.fixed.bottom-0:not(.mobile-bottom-nav) {
                    left: 16rem !important;
                    width: calc(100% - 16rem) !important;
                }
            }
            
            /* Mobile Layout Padding */
            @media (max-width: 767px) {
                body {
                    padding-bottom: 80px !important;
                }
            }
            
            /* Custom Scrollbar for Sidebar */
            .sidebar-nav-container::-webkit-scrollbar {
                width: 4px;
            }
            .sidebar-nav-container::-webkit-scrollbar-thumb {
                background: rgba(108,77,255,0.1);
                border-radius: 4px;
            }
        `;
        document.head.appendChild(styleEl);
    }

    // 2. Global Logout Handler
    window.handleLogout = async function () {
        try {
            if (typeof supabase !== 'undefined' && supabase.auth) {
                await supabase.auth.signOut();
            } else if (window.supabase && window.supabase.auth) {
                await window.supabase.auth.signOut();
            }
        } catch (e) {
            console.error("Logout error:", e);
        }
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = './login_child_safety.html';
    };

    // 3. Remove hardcoded static bottom navs if present in static HTML
    function removeStaticBottomNavs() {
        document.querySelectorAll('nav, footer').forEach(el => {
            if (el.classList.contains('fixed') && el.classList.contains('bottom-0') && !el.getAttribute('data-shell-element')) {
                const text = el.textContent || '';
                if (text.includes('Accueil') || text.includes('Home') || text.includes('Disparu') || text.includes('Signalements') || text.includes('Reports') || text.includes('Alertes') || text.includes('Alerts') || text.includes('Profil') || text.includes('Profile')) {
                    if (el.querySelector('a[href*="home"], a[href*="report"], a[href*="alert"], a[href*="profile"]')) {
                        el.remove();
                    }
                }
            }
        });
    }

    // 4. Render Shell elements dynamically
    function renderShell() {
        // Remove existing shell elements & legacy static bottom navs
        document.querySelectorAll('[data-shell-element="true"], .mobile-bottom-nav, .desktop-sidebar').forEach(el => el.remove());
        removeStaticBottomNavs();

        const mainEl = document.querySelector('main');
        if (mainEl) {
            mainEl.classList.add('main-content-area');
        }

        // Determine active tab & special pages
        const path = window.location.pathname;
        const isV2Preview = path.includes('v2_smart_device_preview');

        if (isV2Preview) {
            document.body.classList.add('v2-preview-page');
        } else {
            document.body.classList.remove('v2-preview-page');
        }

        let activeTab = 'accueil';
        if (path.includes('home_child_safety_v1')) {
            activeTab = 'accueil';
        } else if (path.includes('reports_directory') || path.includes('found_reports_directory') || path.includes('signaler_un_disparu') || path.includes('signaler_un_enfant_trouv') || path.includes('report_details') || path.includes('found_report_details') || path.includes('report_under_review') || path.includes('my_case_dashboard')) {
            activeTab = 'signalements';
        } else if (path.includes('alert_center') || path.includes('smart_alerts') || path.includes('ai_smart_matching')) {
            activeTab = 'alerts';
        } else if (path.includes('guardian_profile')) {
            activeTab = 'profile';
        } else if (path.includes('preferences') || path.includes('settings')) {
            activeTab = 'settings';
        } else if (path.includes('help') || path.includes('about')) {
            activeTab = 'help';
        }

        const isDesktop = window.matchMedia('(min-width: 768px)').matches;

        if (isDesktop) {
            // DESKTOP: Render Left Sidebar ONLY if not on V2 Preview page. DO NOT render Bottom Navigation.
            if (!isV2Preview) {
                const sidebarHtml = `
                    <aside data-shell-element="true" class="desktop-sidebar flex flex-col fixed left-0 top-0 h-screen w-64 bg-surface-container-lowest shadow-[4px_0_24px_rgba(108,77,255,0.06)] z-40 pt-8 border-r border-outline-variant/15">
                        <div class="flex items-center gap-3 px-8 mb-8 text-primary font-headline-lg text-headline-lg font-bold tracking-tight">
                            <span class="material-symbols-outlined text-[32px]" style="font-variation-settings: 'FILL' 1;">security</span>
                            <span>Portail Gardien</span>
                        </div>
                        
                        <nav class="sidebar-nav-container flex flex-col gap-1.5 px-4 flex-1 overflow-y-auto">
                            <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'accueil' ? 'bg-primary-container text-on-primary-container font-bold' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./home_child_safety_v1.html">
                                <span class="material-symbols-outlined" style="${activeTab === 'accueil' ? 'font-variation-settings: \'FILL\' 1;' : ''}">home</span>
                                <span>Accueil</span>
                            </a>
                            
                            <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'signalements' ? 'bg-primary-container text-on-primary-container font-bold' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./reports_directory.html">
                                <span class="material-symbols-outlined" style="${activeTab === 'signalements' ? 'font-variation-settings: \'FILL\' 1;' : ''}">assignment</span>
                                <span>Signalements</span>
                            </a>
                            
                            <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'alerts' ? 'bg-primary-container text-on-primary-container font-bold' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./alert_center.html">
                                <span class="material-symbols-outlined" style="${activeTab === 'alerts' ? 'font-variation-settings: \'FILL\' 1;' : ''}">notifications_active</span>
                                <span>Alertes</span>
                            </a>
                            
                            <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'profile' ? 'bg-primary-container text-on-primary-container font-bold' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./guardian_profile_updated_my_reports.html">
                                <span class="material-symbols-outlined" style="${activeTab === 'profile' ? 'font-variation-settings: \'FILL\' 1;' : ''}">person</span>
                                <span>Profil</span>
                            </a>
                            
                            <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'settings' ? 'bg-primary-container text-on-primary-container font-bold' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./emergency_preferences.html">
                                <span class="material-symbols-outlined" style="${activeTab === 'settings' ? 'font-variation-settings: \'FILL\' 1;' : ''}">settings</span>
                                <span>Paramètres</span>
                            </a>
                            
                            <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'help' ? 'bg-primary-container text-on-primary-container font-bold' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./help_center.html">
                                <span class="material-symbols-outlined" style="${activeTab === 'help' ? 'font-variation-settings: \'FILL\' 1;' : ''}">help</span>
                                <span>Aide</span>
                            </a>
                        </nav>
                        
                        <div class="px-4 pb-8 mt-auto border-t border-outline-variant/10 pt-4">
                            <button class="w-full flex items-center gap-4 px-4 py-3 text-error hover:bg-error/5 rounded-xl transition-colors font-label-bold text-left" onclick="handleLogout()">
                                <span class="material-symbols-outlined">logout</span>
                                <span>Déconnexion</span>
                            </button>
                        </div>
                    </aside>
                `;
                const sidebarTemplate = document.createElement('div');
                sidebarTemplate.innerHTML = sidebarHtml.trim();
                document.body.insertBefore(sidebarTemplate.firstChild, document.body.firstChild);
            }
        } else {
            // MOBILE: Render ONLY Bottom Navigation. DO NOT render Left Sidebar.
            const bottomNavHtml = `
                <nav data-shell-element="true" class="mobile-bottom-nav fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-20 px-2 pb-safe bg-white/95 backdrop-blur-md border-t border-outline-variant/15 shadow-[0px_-8px_24px_rgba(0,0,0,0.04)] rounded-t-2xl">
                    <a class="flex flex-col items-center justify-center px-3 py-1.5 rounded-xl transition-all ${activeTab === 'accueil' ? 'bg-[#ECE8FF] text-[#532CE6] font-bold scale-95 shadow-sm' : 'text-on-surface-variant/70 hover:bg-surface-container-high'}" href="./home_child_safety_v1.html">
                        <span class="material-symbols-outlined text-[22px]" style="${activeTab === 'accueil' ? 'font-variation-settings: \'FILL\' 1;' : ''}">home</span>
                        <span class="font-label-sm text-label-sm mt-0.5">Accueil</span>
                    </a>
                    
                    <a class="flex flex-col items-center justify-center px-3 py-1.5 rounded-xl transition-all ${activeTab === 'signalements' ? 'bg-[#ECE8FF] text-[#532CE6] font-bold scale-95 shadow-sm' : 'text-on-surface-variant/70 hover:bg-surface-container-high'}" href="./reports_directory.html">
                        <span class="material-symbols-outlined text-[22px]" style="${activeTab === 'signalements' ? 'font-variation-settings: \'FILL\' 1;' : ''}">assignment</span>
                        <span class="font-label-sm text-label-sm mt-0.5">Signalements</span>
                    </a>
                    
                    <a class="flex flex-col items-center justify-center px-3 py-1.5 rounded-xl transition-all ${activeTab === 'alerts' ? 'bg-[#ECE8FF] text-[#532CE6] font-bold scale-95 shadow-sm' : 'text-on-surface-variant/70 hover:bg-surface-container-high'} relative" href="./alert_center.html">
                        <span class="material-symbols-outlined text-[22px]" style="${activeTab === 'alerts' ? 'font-variation-settings: \'FILL\' 1;' : ''}">notifications_active</span>
                        <span class="font-label-sm text-label-sm mt-0.5">Alertes</span>
                        <span class="absolute top-1 right-3 w-2 h-2 bg-error rounded-full"></span>
                    </a>
                    
                    <a class="flex flex-col items-center justify-center px-3 py-1.5 rounded-xl transition-all ${activeTab === 'profile' ? 'bg-[#ECE8FF] text-[#532CE6] font-bold scale-95 shadow-sm' : 'text-on-surface-variant/70 hover:bg-surface-container-high'}" href="./guardian_profile_updated_my_reports.html">
                        <span class="material-symbols-outlined text-[22px]" style="${activeTab === 'profile' ? 'font-variation-settings: \'FILL\' 1;' : ''}">person</span>
                        <span class="font-label-sm text-label-sm mt-0.5">Profil</span>
                    </a>
                </nav>
            `;
            const bottomNavTemplate = document.createElement('div');
            bottomNavTemplate.innerHTML = bottomNavHtml.trim();
            document.body.appendChild(bottomNavTemplate.firstChild);
        }
    }

    // Initial render
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            renderShell();
            if (window.reportService && typeof window.reportService.syncProfileWithSupabase === 'function') {
                window.reportService.syncProfileWithSupabase();
            }
        });
    } else {
        renderShell();
        if (window.reportService && typeof window.reportService.syncProfileWithSupabase === 'function') {
            window.reportService.syncProfileWithSupabase();
        }
    }

    // Handle viewport changes (Desktop <-> Mobile)
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', renderShell);
    } else {
        mediaQuery.addListener(renderShell);
    }
})();
