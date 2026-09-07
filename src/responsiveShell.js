// Responsive Shell for Child Safety / SafeGuardian
// Ensures consistent Left Sidebar on Desktop (min-width: 768px) and Bottom Navigation on Mobile (max-width: 767px)

(function () {
    // 0. Deep Link & Shared Link Gatekeeper:
    // If opening a protected app route without an authenticated session or guest mode,
    // immediately prevent content leak and redirect to login while preserving returnUrl.
    const currentPath = window.location.pathname;
    const publicPages = [
        'login', 'login_child_safety', 
        'sign_up', 'sign_up_child_safety', 
        'forgot_password', 'reset_password', 
        'about_safeguardian', 'help_center', 
        'privacy_settings', 'index.html',
        'account_type_selection', 'basic_information',
        'onboarding_community_protection'
    ];
    const isPublicPage = publicPages.some(p => currentPath.includes(p)) || currentPath === '/' || currentPath === '';

    if (!isPublicPage && localStorage.getItem('is_guest') !== 'true') {
        let hasSessionToken = false;
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
                    const item = localStorage.getItem(k);
                    if (item && item.includes('access_token')) {
                        hasSessionToken = true;
                        break;
                    }
                }
            }
        } catch(e) {}

        if (!hasSessionToken) {
            console.log("[RAYDAR Shell Guard] Unauthenticated deep-link access detected. Redirecting to login...");
            const dest = window.location.pathname + window.location.search;
            sessionStorage.setItem('raydar_return_url', dest);
            window.location.replace('./login_child_safety.html?returnUrl=' + encodeURIComponent(dest));
            return;
        }
    }

    // 1. Inject Styles
    const styleId = 'responsive-shell-styles';
    if (!document.getElementById(styleId)) {
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = `
            /* Desktop Layout: Left Sidebar (min-width: 768px) */
            @media (min-width: 768px) {
                body:not(.v2-preview-page) main,
                body:not(.v2-preview-page) .main-content-area {
                    margin-left: 240px !important;
                    width: calc(100% - 240px) !important;
                    max-width: calc(100% - 240px) !important;
                    padding-top: 1.5rem !important;
                    padding-bottom: 3rem !important;
                }
                body:not(.v2-preview-page) header.sticky.top-0,
                body:not(.v2-preview-page) header.fixed.top-0 {
                    margin-left: 240px !important;
                    width: calc(100% - 240px) !important;
                    max-width: calc(100% - 240px) !important;
                }
                body:not(.v2-preview-page) {
                    background-color: #EDF0F5 !important;
                }
            }
            
            /* Mobile Layout Padding: Space for floating bottom pill */
            @media (max-width: 767px) {
                body:not(.v2-preview-page) {
                    padding-bottom: 7.5rem !important;
                }
                body:not(.v2-preview-page) main,
                body:not(.v2-preview-page) .main-content-area {
                    padding-bottom: 7.5rem !important;
                }
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
        window.location.replace('/login');
    };

    // 2b. Shell rendering is decoupled from routing guards (handled authoritatively by authService.js)

    // 3. Remove hardcoded static bottom navs if present in static HTML
    function removeStaticBottomNavs() {
        document.querySelectorAll('nav, footer').forEach(el => {
            if (el.classList.contains('fixed') && el.classList.contains('bottom-0') && !el.getAttribute('data-shell-element') && !el.closest('[data-shell-element="true"]')) {
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
        document.querySelectorAll('[data-shell-element="true"], .mobile-bottom-nav, .desktop-sidebar, .desktop-navbar, .mobile-nav-wrapper').forEach(el => el.remove());
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
        } else if (path.includes('reports_directory') || path.includes('found_reports_directory') || path.includes('signaler_un_disparu') || path.includes('signaler_un_enfant_trouv') || path.includes('create_missing_report') || path.includes('report_details') || path.includes('found_report_details') || path.includes('report_under_review') || path.includes('my_case_dashboard') || path.includes('v_rifier_le_lien_de_parent') || path.includes('v_rifier_le_signalement_tape_2_evidence')) {
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
            // DESKTOP: Render Left Sidebar matching user's reference image
            if (!isV2Preview) {
                const desktopSidebarHtml = `
                    <aside data-shell-element="true" class="desktop-sidebar fixed top-0 left-0 bottom-0 h-screen w-[240px] bg-white border-r border-[#E2E8F0] z-40 flex flex-col justify-between p-4 select-none">
                        <!-- Top: Brand & Menu Links -->
                        <div class="flex flex-col space-y-6">
                            <!-- Brand -->
                            <a href="./home_child_safety_v1.html" class="flex items-center gap-2.5 px-3 py-2 text-[#532CE6] hover:opacity-90 transition-opacity">
                                <div class="w-8 h-8 rounded-lg bg-[#532CE6]/10 flex items-center justify-center text-[#532CE6]">
                                    <span class="material-symbols-outlined text-[22px]" style="font-variation-settings: 'FILL' 1;">security</span>
                                </div>
                                <span class="font-bold text-xl tracking-tight text-[#532CE6]">Gardien</span>
                            </a>

                            <!-- Menu Navigation -->
                            <nav class="flex flex-col space-y-1.5">
                                <!-- Accueil -->
                                <a href="./home_child_safety_v1.html" class="flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all text-sm ${activeTab === 'accueil' ? 'bg-[#532CE6] text-white font-bold shadow-sm' : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-medium'}">
                                    <span class="material-symbols-outlined text-[22px] ${activeTab === 'accueil' ? 'text-white' : 'text-[#64748B]'}" style="${activeTab === 'accueil' ? 'font-variation-settings: \'FILL\' 1;' : ''}">home</span>
                                    <span>Accueil</span>
                                </a>

                                <!-- Signalements -->
                                <a href="./my_case_dashboard_refined_actions.html" class="flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all text-sm ${activeTab === 'signalements' ? 'bg-[#532CE6] text-white font-bold shadow-sm' : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-medium'}">
                                    <span class="material-symbols-outlined text-[22px] ${activeTab === 'signalements' ? 'text-white' : 'text-[#64748B]'}" style="${activeTab === 'signalements' ? 'font-variation-settings: \'FILL\' 1;' : ''}">assignment</span>
                                    <span>Signalements</span>
                                </a>

                                <!-- Alertes -->
                                <a href="./alert_center.html" class="relative flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all text-sm ${activeTab === 'alerts' ? 'bg-[#532CE6] text-white font-bold shadow-sm' : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-medium'}">
                                    <div class="relative flex items-center justify-center">
                                        <span class="material-symbols-outlined text-[22px] ${activeTab === 'alerts' ? 'text-white' : 'text-[#64748B]'}" style="${activeTab === 'alerts' ? 'font-variation-settings: \'FILL\' 1;' : ''}">notifications</span>
                                        <span class="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#EF4444] rounded-full ring-2 ring-white"></span>
                                    </div>
                                    <span>Alertes</span>
                                </a>

                                <!-- Profil -->
                                <a href="./guardian_profile_updated_my_reports.html" class="flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all text-sm ${activeTab === 'profile' ? 'bg-[#532CE6] text-white font-bold shadow-sm' : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-medium'}">
                                    <span class="material-symbols-outlined text-[22px] ${activeTab === 'profile' ? 'text-white' : 'text-[#64748B]'}" style="${activeTab === 'profile' ? 'font-variation-settings: \'FILL\' 1;' : ''}">person</span>
                                    <span>Profil</span>
                                </a>

                                <!-- Paramètres -->
                                <a href="./emergency_preferences.html" class="flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all text-sm ${activeTab === 'settings' ? 'bg-[#532CE6] text-white font-bold shadow-sm' : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-medium'}">
                                    <span class="material-symbols-outlined text-[22px] ${activeTab === 'settings' ? 'text-white' : 'text-[#64748B]'}" style="${activeTab === 'settings' ? 'font-variation-settings: \'FILL\' 1;' : ''}">settings</span>
                                    <span>Paramètres</span>
                                </a>

                                <!-- Aide -->
                                <a href="./help_center.html" class="flex items-center gap-3.5 px-4 py-3 rounded-xl transition-all text-sm ${activeTab === 'help' ? 'bg-[#532CE6] text-white font-bold shadow-sm' : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9] font-medium'}">
                                    <span class="material-symbols-outlined text-[22px] ${activeTab === 'help' ? 'text-white' : 'text-[#64748B]'}" style="${activeTab === 'help' ? 'font-variation-settings: \'FILL\' 1;' : ''}">help_outline</span>
                                    <span>Aide</span>
                                </a>
                            </nav>
                        </div>

                        <!-- Bottom: Logout Action -->
                        <div class="pt-4 border-t border-[#E2E8F0]">
                            <button onclick="handleLogout()" class="w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-[#64748B] hover:text-[#DC2626] hover:bg-red-50 text-sm font-medium transition-colors">
                                <span class="material-symbols-outlined text-[22px]">logout</span>
                                <span>Déconnexion</span>
                            </button>
                        </div>
                    </aside>
                `;
                const sidebarTemplate = document.createElement('div');
                sidebarTemplate.innerHTML = desktopSidebarHtml.trim();
                document.body.insertBefore(sidebarTemplate.firstChild, document.body.firstChild);
            }
        } else {
            // MOBILE: Render Floating Pill-Shaped Bottom Navigation
            const bottomNavHtml = `
                <div data-shell-element="true" class="mobile-nav-wrapper fixed bottom-5 left-0 w-full z-50 px-4 pointer-events-none flex justify-center">
                    <div class="relative w-full max-w-md pointer-events-auto">
                        <!-- Subtle ambient violet glow backing matching reference -->
                        <div class="absolute -inset-1 bg-[#532CE6]/15 rounded-[34px] blur-md -z-10 pointer-events-none"></div>
                        
                        <!-- Floating curved pill navigation surface -->
                        <nav class="mobile-bottom-nav relative w-full bg-white rounded-[28px] border border-[#E2E8F0] shadow-[0_12px_36px_rgba(83,44,230,0.18),0_4px_16px_rgba(15,23,42,0.08)] flex justify-between items-center h-[68px] px-2.5">
                            <!-- Accueil -->
                            <a class="flex-1 flex flex-col items-center justify-center py-1.5 px-1 rounded-[20px] transition-all ${activeTab === 'accueil' ? 'bg-[#F0EEFF] text-[#532CE6] font-bold' : 'text-[#64748B] hover:text-[#0F172A]'}" href="./home_child_safety_v1.html">
                                <span class="material-symbols-outlined text-[24px] ${activeTab === 'accueil' ? 'text-[#532CE6]' : 'text-[#64748B]'}" style="${activeTab === 'accueil' ? 'font-variation-settings: \'FILL\' 1;' : ''}">home</span>
                                <span class="text-[11px] ${activeTab === 'accueil' ? 'font-bold text-[#532CE6]' : 'font-medium text-[#64748B]'} mt-0.5 tracking-tight">Accueil</span>
                            </a>
                            
                            <!-- Signalements -->
                            <a class="flex-1 flex flex-col items-center justify-center py-1.5 px-1 rounded-[20px] transition-all ${activeTab === 'signalements' ? 'bg-[#F0EEFF] text-[#532CE6] font-bold' : 'text-[#64748B] hover:text-[#0F172A]'}" href="./reports_directory.html">
                                <span class="material-symbols-outlined text-[24px] ${activeTab === 'signalements' ? 'text-[#532CE6]' : 'text-[#64748B]'}" style="${activeTab === 'signalements' ? 'font-variation-settings: \'FILL\' 1;' : ''}">assignment</span>
                                <span class="text-[11px] ${activeTab === 'signalements' ? 'font-bold text-[#532CE6]' : 'font-medium text-[#64748B]'} mt-0.5 tracking-tight">Signalements</span>
                            </a>
                            
                            <!-- Alertes -->
                            <a class="flex-1 flex flex-col items-center justify-center py-1.5 px-1 rounded-[20px] transition-all ${activeTab === 'alerts' ? 'bg-[#F0EEFF] text-[#532CE6] font-bold' : 'text-[#64748B] hover:text-[#0F172A]'}" href="./alert_center.html">
                                <div class="relative flex items-center justify-center">
                                    <span class="material-symbols-outlined text-[24px] ${activeTab === 'alerts' ? 'text-[#532CE6]' : 'text-[#64748B]'}" style="${activeTab === 'alerts' ? 'font-variation-settings: \'FILL\' 1;' : ''}">notifications_active</span>
                                    <span class="absolute -top-1 -right-1.5 w-2.5 h-2.5 bg-[#DC2626] rounded-full ring-2 ring-white"></span>
                                </div>
                                <span class="text-[11px] ${activeTab === 'alerts' ? 'font-bold text-[#532CE6]' : 'font-medium text-[#64748B]'} mt-0.5 tracking-tight">Alertes</span>
                            </a>
                            
                            <!-- Profil -->
                            <a class="flex-1 flex flex-col items-center justify-center py-1.5 px-1 rounded-[20px] transition-all ${activeTab === 'profile' ? 'bg-[#F0EEFF] text-[#532CE6] font-bold' : 'text-[#64748B] hover:text-[#0F172A]'}" href="./guardian_profile_updated_my_reports.html">
                                <span class="material-symbols-outlined text-[24px] ${activeTab === 'profile' ? 'text-[#532CE6]' : 'text-[#64748B]'}" style="${activeTab === 'profile' ? 'font-variation-settings: \'FILL\' 1;' : ''}">person</span>
                                <span class="text-[11px] ${activeTab === 'profile' ? 'font-bold text-[#532CE6]' : 'font-medium text-[#64748B]'} mt-0.5 tracking-tight">Profil</span>
                            </a>
                        </nav>
                    </div>
                </div>
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
            if (window.reportService) {
                if (typeof window.reportService.syncProfileWithSupabase === 'function') {
                    window.reportService.syncProfileWithSupabase();
                }
                if (typeof window.reportService.syncReportsFromSupabase === 'function') {
                    window.reportService.syncReportsFromSupabase();
                }
            }
        });
    } else {
        renderShell();
        if (window.reportService) {
            if (typeof window.reportService.syncProfileWithSupabase === 'function') {
                window.reportService.syncProfileWithSupabase();
            }
            if (typeof window.reportService.syncReportsFromSupabase === 'function') {
                window.reportService.syncReportsFromSupabase();
            }
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
