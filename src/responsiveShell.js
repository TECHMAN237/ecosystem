// Responsive Shell for Child Safety / SafeGuardian
// Ensures consistent Left Sidebar on Desktop (min-width: 768px) and Bottom Navigation on Mobile (max-width: 767px)

(function () {
    // 1. Inject Styles
    const styleId = 'responsive-shell-styles';
    if (!document.getElementById(styleId)) {
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = `
            /* Desktop Layout Offsets: Full-Width Top Branding Navbar */
            @media (min-width: 768px) {
                body:not(.v2-preview-page) main,
                body:not(.v2-preview-page) .main-content-area {
                    margin-left: 0 !important;
                    max-width: 100% !important;
                    padding-top: 5rem !important;
                }
                body:not(.v2-preview-page) {
                    padding-bottom: 2rem !important;
                }
                /* Offset fixed action bars on desktop */
                body:not(.v2-preview-page) nav.fixed.bottom-0:not(.mobile-bottom-nav),
                body:not(.v2-preview-page) footer.fixed.bottom-0:not(.mobile-bottom-nav),
                body:not(.v2-preview-page) div.fixed.bottom-0:not(.mobile-bottom-nav) {
                    left: 0 !important;
                    width: 100% !important;
                }
                /* Offset page headers under top desktop bar */
                body:not(.v2-preview-page) header.sticky.top-0:not(.desktop-navbar),
                body:not(.v2-preview-page) header.fixed.top-0:not(.desktop-navbar) {
                    top: 4rem !important;
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
            // DESKTOP: Render Full-Width Solid Violet Branding Navigation Bar
            if (!isV2Preview) {
                const desktopNavbarHtml = `
                    <header data-shell-element="true" class="desktop-navbar fixed top-0 left-0 w-full z-50 h-16 bg-[#532CE6] border-b border-[#4321C4] shadow-[0_4px_24px_rgba(83,44,230,0.25)] flex items-center">
                        <div class="w-full max-w-7xl mx-auto px-6 flex items-center justify-between">
                            <!-- Left: RAYDAR Brand -->
                            <div class="flex items-center gap-6">
                                <a href="./home_child_safety_v1.html" class="flex items-center gap-3 text-white group">
                                    <div class="w-10 h-10 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center text-white shadow-sm group-hover:scale-105 transition-transform">
                                        <span class="material-symbols-outlined text-[24px] text-white" style="font-variation-settings: 'FILL' 1;">security</span>
                                    </div>
                                    <div class="flex flex-col">
                                        <span class="font-black text-xl tracking-tight text-white leading-none">RAYDAR</span>
                                        <span class="text-[10px] font-semibold text-white/80 uppercase tracking-widest leading-tight mt-0.5">Portail Sécurité</span>
                                    </div>
                                </a>
                            </div>

                            <!-- Center: Navigation Links with White text & icons -->
                            <nav class="flex items-center gap-2">
                                <a class="flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-sm font-medium ${activeTab === 'accueil' ? 'bg-white/20 text-white font-bold shadow-sm backdrop-blur-sm' : 'text-white/85 hover:text-white hover:bg-white/10'}" href="./home_child_safety_v1.html">
                                    <span class="material-symbols-outlined text-[20px] text-white" style="${activeTab === 'accueil' ? 'font-variation-settings: \'FILL\' 1;' : ''}">home</span>
                                    <span class="text-white">Accueil</span>
                                </a>
                                
                                <a class="flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-sm font-medium ${activeTab === 'signalements' ? 'bg-white/20 text-white font-bold shadow-sm backdrop-blur-sm' : 'text-white/85 hover:text-white hover:bg-white/10'}" href="./reports_directory.html">
                                    <span class="material-symbols-outlined text-[20px] text-white" style="${activeTab === 'signalements' ? 'font-variation-settings: \'FILL\' 1;' : ''}">assignment</span>
                                    <span class="text-white">Signalements</span>
                                </a>
                                
                                <a class="relative flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-sm font-medium ${activeTab === 'alerts' ? 'bg-white/20 text-white font-bold shadow-sm backdrop-blur-sm' : 'text-white/85 hover:text-white hover:bg-white/10'}" href="./alert_center.html">
                                    <div class="relative flex items-center justify-center">
                                        <span class="material-symbols-outlined text-[20px] text-white" style="${activeTab === 'alerts' ? 'font-variation-settings: \'FILL\' 1;' : ''}">notifications_active</span>
                                        <span class="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#EF4444] rounded-full ring-2 ring-[#532CE6]"></span>
                                    </div>
                                    <span class="text-white">Alertes</span>
                                </a>
                                
                                <a class="flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-sm font-medium ${activeTab === 'profile' ? 'bg-white/20 text-white font-bold shadow-sm backdrop-blur-sm' : 'text-white/85 hover:text-white hover:bg-white/10'}" href="./guardian_profile_updated_my_reports.html">
                                    <span class="material-symbols-outlined text-[20px] text-white" style="${activeTab === 'profile' ? 'font-variation-settings: \'FILL\' 1;' : ''}">person</span>
                                    <span class="text-white">Profil</span>
                                </a>
                                
                                <a class="flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-sm font-medium ${activeTab === 'settings' ? 'bg-white/20 text-white font-bold shadow-sm backdrop-blur-sm' : 'text-white/85 hover:text-white hover:bg-white/10'}" href="./emergency_preferences.html">
                                    <span class="material-symbols-outlined text-[20px] text-white" style="${activeTab === 'settings' ? 'font-variation-settings: \'FILL\' 1;' : ''}">settings</span>
                                    <span class="text-white">Paramètres</span>
                                </a>
                            </nav>

                            <!-- Right: Profile Info & Logout in White -->
                            <div class="flex items-center gap-3">
                                <a href="./guardian_profile_updated_my_reports.html" class="flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 transition-all text-white">
                                    <div class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center border border-white/30 text-white font-bold text-xs">
                                        <span class="material-symbols-outlined text-[18px] text-white">person</span>
                                    </div>
                                    <div class="flex flex-col text-left leading-tight hidden lg:flex">
                                        <span class="text-xs font-bold text-white">Gardien Actif</span>
                                        <span class="text-[10px] text-white/80">Connecté</span>
                                    </div>
                                </a>
                                <button onclick="handleLogout()" title="Déconnexion" class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-white/85 hover:text-white hover:bg-white/15 transition-all text-xs font-medium border border-transparent hover:border-white/20">
                                    <span class="material-symbols-outlined text-[18px] text-white">logout</span>
                                    <span class="text-white hidden xl:inline">Déconnexion</span>
                                </button>
                            </div>
                        </div>
                    </header>
                `;
                const navbarTemplate = document.createElement('div');
                navbarTemplate.innerHTML = desktopNavbarHtml.trim();
                document.body.insertBefore(navbarTemplate.firstChild, document.body.firstChild);
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
