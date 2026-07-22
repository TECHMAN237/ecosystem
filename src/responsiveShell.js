// Responsive Shell for Child Safety / SafeGuardian
// Ensures consistent Left Sidebar on Desktop and Bottom Navigation on Mobile (completely in French)

(function () {
    // 1. Inject Styles
    const styleId = 'responsive-shell-styles';
    if (!document.getElementById(styleId)) {
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = `
            /* Desktop Styles */
            @media (min-width: 768px) {
                .desktop-sidebar {
                    display: flex !important;
                }
                .mobile-bottom-nav {
                    display: none !important;
                }
                main, .main-content-area {
                    margin-left: 16rem !important;
                    max-width: calc(100% - 16rem) !important;
                }
                body {
                    padding-bottom: 0 !important;
                }
            }
            
            /* Mobile Styles */
            @media (max-width: 767px) {
                .desktop-sidebar {
                    display: none !important;
                }
                .mobile-bottom-nav {
                    display: flex !important;
                }
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

    // 2. Define Logout Logic
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

    // 3. Render Shell elements on DOMContentLoaded
    function renderShell() {
        // Remove existing sidebars/bottom navs to avoid duplicates
        document.querySelectorAll('aside, nav').forEach(el => {
            if (el.classList.contains('md:flex') || el.classList.contains('md:hidden') || el.classList.contains('mobile-bottom-nav') || el.classList.contains('desktop-sidebar')) {
                el.remove();
            }
            // Also clean up any other generic bottom navigation elements
            if (el.tagName.toLowerCase() === 'nav' && (el.className.includes('fixed bottom-0') || el.className.includes('bottom-nav') || el.className.includes('pb-safe'))) {
                el.remove();
            }
            if (el.tagName.toLowerCase() === 'aside' && (el.className.includes('fixed left-0') || el.className.includes('w-64') || el.className.includes('h-screen'))) {
                el.remove();
            }
        });

        // Add class to main elements if found
        const mainEl = document.querySelector('main');
        if (mainEl) {
            mainEl.classList.add('main-content-area');
        }

        // Determine active page
        const path = window.location.pathname;
        let activeTab = 'accueil';
        if (path.includes('home_child_safety_v1')) {
            activeTab = 'accueil';
        } else if (path.includes('found_reports_directory') || path.includes('signaler_un_enfant_trouv_d_tails_de_la_d_couverte')) {
            activeTab = 'found';
        } else if (path.includes('reports_directory') || path.includes('signaler_un_disparu') || path.includes('report_details') || path.includes('found_report_details') || path.includes('report_under_review') || path.includes('my_case_dashboard')) {
            activeTab = 'missing';
        } else if (path.includes('alert_center') || path.includes('smart_alerts') || path.includes('ai_smart_matching')) {
            activeTab = 'alerts';
        } else if (path.includes('guardian_profile')) {
            activeTab = 'profile';
        } else if (path.includes('preferences') || path.includes('settings')) {
            activeTab = 'settings';
        } else if (path.includes('help') || path.includes('about')) {
            activeTab = 'help';
        }

        // Left Sidebar HTML (completely in French)
        const sidebarHtml = `
            <aside class="desktop-sidebar hidden md:flex flex-col fixed left-0 top-0 h-screen w-64 bg-surface-container-lowest shadow-[4px_0_24px_rgba(108,77,255,0.06)] z-40 pt-8 border-r border-outline-variant/15">
                <div class="flex items-center gap-3 px-8 mb-8 text-primary font-headline-lg text-headline-lg font-bold tracking-tight">
                    <span class="material-symbols-outlined text-[32px]" style="font-variation-settings: 'FILL' 1;">security</span>
                    <span>Portail Gardien</span>
                </div>
                
                <nav class="sidebar-nav-container flex flex-col gap-1.5 px-4 flex-1 overflow-y-auto">
                    <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'accueil' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./home_child_safety_v1.html">
                        <span class="material-symbols-outlined" style="${activeTab === 'accueil' ? 'font-variation-settings: \'FILL\' 1;' : ''}">home</span>
                        <span>Accueil</span>
                    </a>
                    
                    <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'missing' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./reports_directory.html">
                        <span class="material-symbols-outlined" style="${activeTab === 'missing' ? 'font-variation-settings: \'FILL\' 1;' : ''}">person_search</span>
                        <span>Enfants Disparus</span>
                    </a>
                    
                    <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'found' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./found_reports_directory.html">
                        <span class="material-symbols-outlined" style="${activeTab === 'found' ? 'font-variation-settings: \'FILL\' 1;' : ''}">child_care</span>
                        <span>Enfants Retrouvés</span>
                    </a>
                    
                    <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'alerts' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./alert_center.html">
                        <span class="material-symbols-outlined" style="${activeTab === 'alerts' ? 'font-variation-settings: \'FILL\' 1;' : ''}">notifications_active</span>
                        <span>Alertes</span>
                    </a>
                    
                    <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'profile' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./guardian_profile_updated_my_reports.html">
                        <span class="material-symbols-outlined" style="${activeTab === 'profile' ? 'font-variation-settings: \'FILL\' 1;' : ''}">person</span>
                        <span>Profil</span>
                    </a>
                    
                    <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'settings' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./emergency_preferences.html">
                        <span class="material-symbols-outlined" style="${activeTab === 'settings' ? 'font-variation-settings: \'FILL\' 1;' : ''}">settings</span>
                        <span>Paramètres</span>
                    </a>
                    
                    <a class="flex items-center gap-4 px-4 py-3 rounded-xl transition-all font-label-bold ${activeTab === 'help' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:bg-surface-container-high'}" href="./help_center.html">
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

        // Mobile Bottom Navigation HTML (completely in French)
        const bottomNavHtml = `
            <nav class="mobile-bottom-nav fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-20 px-4 pb-safe bg-surface-container-lowest shadow-[0px_-12px_32px_rgba(0,0,0,0.08)] rounded-t-lg md:hidden">
                <a class="flex flex-col items-center justify-center px-4 py-1.5 rounded-xl transition-all ${activeTab === 'accueil' ? 'bg-primary-container text-on-primary-container font-bold scale-95' : 'text-on-secondary-container hover:bg-surface-container-high'}" href="./home_child_safety_v1.html">
                    <span class="material-symbols-outlined" style="${activeTab === 'accueil' ? 'font-variation-settings: \'FILL\' 1;' : ''}">home</span>
                    <span class="font-label-sm text-label-sm mt-0.5">Accueil</span>
                </a>
                
                <a class="flex flex-col items-center justify-center px-4 py-1.5 rounded-xl transition-all ${activeTab === 'missing' ? 'bg-primary-container text-on-primary-container font-bold scale-95' : 'text-on-secondary-container hover:bg-surface-container-high'}" href="./reports_directory.html">
                    <span class="material-symbols-outlined mb-0.5" style="${activeTab === 'missing' ? 'font-variation-settings: \'FILL\' 1;' : ''}">person_search</span>
                    <span class="font-label-sm text-label-sm">Disparus</span>
                </a>
                
                <a class="flex flex-col items-center justify-center px-4 py-1.5 rounded-xl transition-all ${activeTab === 'alerts' ? 'bg-primary-container text-on-primary-container font-bold scale-95' : 'text-on-secondary-container hover:bg-surface-container-high'} relative" href="./alert_center.html">
                    <span class="material-symbols-outlined mb-0.5" style="${activeTab === 'alerts' ? 'font-variation-settings: \'FILL\' 1;' : ''}">notifications_active</span>
                    <span class="font-label-sm text-label-sm">Alertes</span>
                    <span class="absolute top-1 right-3 w-2 h-2 bg-error rounded-full"></span>
                </a>
                
                <a class="flex flex-col items-center justify-center px-4 py-1.5 rounded-xl transition-all ${activeTab === 'profile' ? 'bg-primary-container text-on-primary-container font-bold scale-95' : 'text-on-secondary-container hover:bg-surface-container-high'}" href="./guardian_profile_updated_my_reports.html">
                    <span class="material-symbols-outlined" style="${activeTab === 'profile' ? 'font-variation-settings: \'FILL\' 1;' : ''}">person</span>
                    <span class="font-label-sm text-label-sm mt-0.5">Profil</span>
                </a>
            </nav>
        `;

        // Inject Sidebar
        const sidebarTemplate = document.createElement('div');
        sidebarTemplate.innerHTML = sidebarHtml.trim();
        const sidebarNode = sidebarTemplate.firstChild;
        document.body.insertBefore(sidebarNode, document.body.firstChild);

        // Inject Bottom Nav
        const bottomNavTemplate = document.createElement('div');
        bottomNavTemplate.innerHTML = bottomNavHtml.trim();
        const bottomNavNode = bottomNavTemplate.firstChild;
        document.body.appendChild(bottomNavNode);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderShell);
    } else {
        renderShell();
    }
})();
