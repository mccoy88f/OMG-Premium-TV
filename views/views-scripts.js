const { I18N } = require('./views-i18n');

/**
 * Restituisce tutto il codice JavaScript per i controlli della pagina di configurazione
 * @param {string} protocol - Il protocollo HTTP/HTTPS in uso
 * @param {string} host - L'hostname del server
 * @returns {string} - Codice JavaScript da inserire nel template
 */
const getViewScripts = (protocol, host) => {
    const i18nJson = JSON.stringify(I18N).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
    return `
        window.I18N = ${i18nJson};
        window.currentLang = localStorage.getItem('omg_tv_lang') || 'en';
        window.t = function(key) {
            var L = window.I18N[window.currentLang] || window.I18N.en;
            return (L && L[key]) || (window.I18N.en && window.I18N.en[key]) || key;
        };
        window.applyLanguage = function(lang) {
            window.currentLang = lang || 'en';
            document.querySelectorAll('[data-i18n]').forEach(function(el) {
                var key = el.getAttribute('data-i18n');
                var v = window.I18N[lang] && window.I18N[lang][key];
                if (v) {
                    if (el.getAttribute('data-i18n-value') && el.value !== undefined) el.value = v;
                    else if (el.placeholder === undefined) el.textContent = v;
                }
            });
            document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
                var v = window.I18N[lang] && window.I18N[lang][el.getAttribute('data-i18n-placeholder')];
                if (v) el.placeholder = v;
            });
            var enBtn = document.getElementById('langEn');
            var itBtn = document.getElementById('langIt');
            var esBtn = document.getElementById('langEs');
            var frBtn = document.getElementById('langFr');
            if (enBtn) { enBtn.style.fontWeight = lang === 'en' ? 'bold' : 'normal'; enBtn.style.textDecoration = lang === 'en' ? 'underline' : 'none'; }
            if (itBtn) { itBtn.style.fontWeight = lang === 'it' ? 'bold' : 'normal'; itBtn.style.textDecoration = lang === 'it' ? 'underline' : 'none'; }
            if (esBtn) { esBtn.style.fontWeight = lang === 'es' ? 'bold' : 'normal'; esBtn.style.textDecoration = lang === 'es' ? 'underline' : 'none'; }
            if (frBtn) { frBtn.style.fontWeight = lang === 'fr' ? 'bold' : 'normal'; frBtn.style.textDecoration = lang === 'fr' ? 'underline' : 'none'; }
        };
        window.setLanguage = function(lang) {
            localStorage.setItem('omg_tv_lang', lang);
            window.applyLanguage(lang);
        };

        // Funzioni per le sezioni espandibili
        function toggleAdvancedSettings() {
            const content = document.getElementById('advanced-settings-content');
            const toggle = document.getElementById('advanced-settings-toggle');
            content.classList.toggle('show');
            toggle.textContent = content.classList.contains('show') ? '▲' : '▼';
        }
        
        function togglePythonSection() {
            const content = document.getElementById('python-section-content');
            const toggle = document.getElementById('python-section-toggle');
            content.classList.toggle('show');
            toggle.textContent = content.classList.contains('show') ? '▲' : '▼';
        }
        
        function toggleResolverSection() {
            const content = document.getElementById('resolver-section-content');
            const toggle = document.getElementById('resolver-section-toggle');
            content.classList.toggle('show');
            toggle.textContent = content.classList.contains('show') ? '▲' : '▼';
        }

        function toggleSessionDetails() {
            const content = document.getElementById('session-details-content');
            const toggle = document.getElementById('session-details-toggle');
            if (content && toggle) {
                content.classList.toggle('show');
                toggle.textContent = content.classList.contains('show') ? '▲' : '▼';
            }
        }

        function toggleSecuritySection() {
            const content = document.getElementById('security-section-content');
            const toggle = document.getElementById('security-section-toggle');
            if (content && toggle) {
                content.classList.toggle('show');
                toggle.textContent = content.classList.contains('show') ? '▲' : '▼';
            }
        }

        // Proteggi accesso alla home
        (function initHomeAuth() {
            const cb = document.getElementById('homeAuthEnabled');
            const whenEnabled = document.getElementById('homeAuthWhenEnabled');
            const fields = document.getElementById('homeAuthFields');
            if (!cb || !whenEnabled || !fields) return;
            fetch('/api/home-auth/status').then(r => r.json()).then(function(data) {
                cb.checked = data.enabled;
                whenEnabled.style.display = data.enabled ? 'block' : 'none';
                fields.style.display = 'none';
            }).catch(function() {});
            cb.addEventListener('change', function() {
                if (cb.checked) {
                    whenEnabled.style.display = 'none';
                    fields.style.display = 'block';
                } else {
                    whenEnabled.style.display = 'none';
                    fields.style.display = 'none';
                }
            });
        })();
        function toggleEditHomeAuth() {
            document.getElementById('homeAuthFields').style.display = 'block';
            document.getElementById('homeAuthWhenEnabled').style.display = 'none';
            document.getElementById('homeAuthMessage').textContent = '';
        }
        function cancelEditHomeAuth() {
            document.getElementById('homeAuthFields').style.display = 'none';
            document.getElementById('homeAuthPassword').value = '';
            document.getElementById('homeAuthConfirm').value = '';
            document.getElementById('homeAuthMessage').textContent = '';
            if (document.getElementById('homeAuthEnabled').checked) {
                document.getElementById('homeAuthWhenEnabled').style.display = 'block';
            }
        }
        function saveHomeAuth() {
            const enabled = document.getElementById('homeAuthEnabled').checked;
            const password = document.getElementById('homeAuthPassword').value;
            const confirm = document.getElementById('homeAuthConfirm').value;
            const msg = document.getElementById('homeAuthMessage');
            if (enabled && password !== confirm) {
                msg.textContent = t('auth_pwd_mismatch');
                msg.style.color = '#f44336';
                return;
            }
            if (enabled && password.length < 1) {
                msg.textContent = t('auth_enter_pwd');
                msg.style.color = '#f44336';
                return;
            }
            fetch('/api/home-auth/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: enabled, password: password, confirm: confirm })
            }).then(function(r) { return r.json(); }).then(function(data) {
                if (data.success) {
                    msg.textContent = enabled ? t('auth_protection_on') : t('auth_protection_off');
                    msg.style.color = '#4CAF50';
                    document.getElementById('homeAuthPassword').value = '';
                    document.getElementById('homeAuthConfirm').value = '';
                    document.getElementById('homeAuthFields').style.display = 'none';
                    if (enabled) {
                        document.getElementById('homeAuthWhenEnabled').style.display = 'block';
                    } else {
                        document.getElementById('homeAuthWhenEnabled').style.display = 'none';
                    }
                } else {
                    msg.textContent = data.message || t('auth_error');
                    msg.style.color = '#f44336';
                }
            }).catch(function() {
                msg.textContent = t('auth_network_error');
                msg.style.color = '#f44336';
            });
        }

        // Sync resolver section fields (outside form) to hidden form inputs
        function syncResolverFieldsToForm() {
            const urlEl = document.getElementById('resolverScriptUrl');
            const enEl = document.getElementById('resolverEnabled');
            const hUrl = document.getElementById('hidden_resolver_script');
            const hEn = document.getElementById('hidden_resolver_enabled');
            if (urlEl && hUrl) hUrl.value = urlEl.value;
            if (enEl && hEn) hEn.value = enEl.checked ? 'true' : 'false';
        }
        function syncFormToResolverFields() {
            const hUrl = document.getElementById('hidden_resolver_script');
            const hEn = document.getElementById('hidden_resolver_enabled');
            const urlEl = document.getElementById('resolverScriptUrl');
            const enEl = document.getElementById('resolverEnabled');
            if (hUrl && urlEl) urlEl.value = hUrl.value;
            if (hEn && enEl) enEl.checked = hEn.value === 'true';
        }
        function getConfigQueryString() {
            syncResolverFieldsToForm();
            const form = document.getElementById('configForm');
            const formData = new FormData(form);
            const params = new URLSearchParams();
            
            formData.forEach((value, key) => {
                if (value || key === 'epg_enabled' || key === 'force_proxy' || key === 'resolver_enabled') {
                    if (key === 'epg_enabled' || key === 'force_proxy' || key === 'resolver_enabled') {
                        const el = form.elements[key];
                        params.append(key, el && el.type === 'checkbox' ? el.checked : value);
                    } else {
                        params.append(key, value);
                    }
                }
            });
            
            return params.toString();
        }

        function getConfigObject() {
            const qs = getConfigQueryString();
            return Object.fromEntries(new URLSearchParams(qs));
        }

        // Preset countries: iptv-org playlist + iptv-epg.org EPG (ISO 3166-1 alpha-2 lowercase). Names in English for default UI.
        var PRESET_COUNTRIES = [
            { name: 'Albania', code: 'al' }, { name: 'Argentina', code: 'ar' }, { name: 'Armenia', code: 'am' },
            { name: 'Australia', code: 'au' }, { name: 'Austria', code: 'at' }, { name: 'Belarus', code: 'by' },
            { name: 'Belgium', code: 'be' }, { name: 'Bolivia', code: 'bo' }, { name: 'Bosnia and Herzegovina', code: 'ba' },
            { name: 'Brazil', code: 'br' }, { name: 'Bulgaria', code: 'bg' }, { name: 'Canada', code: 'ca' },
            { name: 'Chile', code: 'cl' }, { name: 'Colombia', code: 'co' }, { name: 'Costa Rica', code: 'cr' },
            { name: 'Croatia', code: 'hr' }, { name: 'Czech Republic', code: 'cz' }, { name: 'Denmark', code: 'dk' },
            { name: 'Dominican Republic', code: 'do' }, { name: 'Ecuador', code: 'ec' }, { name: 'Egypt', code: 'eg' },
            { name: 'El Salvador', code: 'sv' }, { name: 'Finland', code: 'fi' }, { name: 'France', code: 'fr' },
            { name: 'Georgia', code: 'ge' }, { name: 'Germany', code: 'de' }, { name: 'Ghana', code: 'gh' },
            { name: 'Greece', code: 'gr' }, { name: 'Guatemala', code: 'gt' }, { name: 'Honduras', code: 'hn' },
            { name: 'Hong Kong', code: 'hk' }, { name: 'Hungary', code: 'hu' }, { name: 'Iceland', code: 'is' },
            { name: 'India', code: 'in' }, { name: 'Indonesia', code: 'id' }, { name: 'Israel', code: 'il' },
            { name: 'Italy', code: 'it' }, { name: 'Japan', code: 'jp' }, { name: 'Latvia', code: 'lv' },
            { name: 'Lebanon', code: 'lb' }, { name: 'Lithuania', code: 'lt' }, { name: 'Luxembourg', code: 'lu' },
            { name: 'North Macedonia', code: 'mk' }, { name: 'Malaysia', code: 'my' }, { name: 'Malta', code: 'mt' },
            { name: 'Mexico', code: 'mx' }, { name: 'Montenegro', code: 'me' }, { name: 'Netherlands', code: 'nl' },
            { name: 'New Zealand', code: 'nz' }, { name: 'Nicaragua', code: 'ni' }, { name: 'Nigeria', code: 'ng' },
            { name: 'Norway', code: 'no' }, { name: 'Panama', code: 'pa' }, { name: 'Paraguay', code: 'py' },
            { name: 'Peru', code: 'pe' }, { name: 'Philippines', code: 'ph' }, { name: 'Poland', code: 'pl' },
            { name: 'Portugal', code: 'pt' }, { name: 'Romania', code: 'ro' }, { name: 'Russia', code: 'ru' },
            { name: 'Saudi Arabia', code: 'sa' }, { name: 'Serbia', code: 'rs' }, { name: 'Singapore', code: 'sg' },
            { name: 'Slovenia', code: 'si' }, { name: 'South Africa', code: 'za' }, { name: 'South Korea', code: 'kr' },
            { name: 'Spain', code: 'es' }, { name: 'Sweden', code: 'se' }, { name: 'Switzerland', code: 'ch' },
            { name: 'Taiwan', code: 'tw' }, { name: 'Thailand', code: 'th' }, { name: 'Turkey', code: 'tr' },
            { name: 'Uganda', code: 'ug' }, { name: 'Ukraine', code: 'ua' }, { name: 'United Arab Emirates', code: 'ae' },
            { name: 'United Kingdom', code: 'gb' }, { name: 'United States', code: 'us' }, { name: 'Uruguay', code: 'uy' },
            { name: 'Venezuela', code: 've' }, { name: 'Vietnam', code: 'vn' }, { name: 'Zimbabwe', code: 'zw' }
        ];

        function applyPresetCountry() {
            var sel = document.getElementById('presetCountry');
            if (!sel || !sel.value) return;
            var code = sel.value.toLowerCase();
            var m3uInput = document.querySelector('input[name="m3u"]');
            var epgInput = document.querySelector('input[name="epg"]');
            var epgCheck = document.querySelector('input[name="epg_enabled"]');
            if (m3uInput && !m3uInput.readOnly) {
                m3uInput.value = 'https://iptv-org.github.io/iptv/countries/' + code + '.m3u';
            }
            if (epgInput) {
                epgInput.value = 'https://iptv-epg.org/files/epg-' + code + '.xml';
            }
            if (epgCheck) epgCheck.checked = true;
        }

        function flagFromCode(code) {
            if (!code || code.length !== 2) return '';
            return code.toUpperCase().split('').map(function(c) {
                return String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65);
            }).join('');
        }
        (function initPresetCountrySelect() {
            var sel = document.getElementById('presetCountry');
            if (!sel) return;
            PRESET_COUNTRIES.forEach(function(c) {
                var opt = document.createElement('option');
                opt.value = c.code;
                opt.textContent = flagFromCode(c.code) + ' ' + c.name;
                sel.appendChild(opt);
            });
        })();

        async function updateSessionIdDisplay() {
            const el = document.getElementById('sessionIdDisplay');
            if (!el) return;
            try {
                const r = await fetch('/api/session-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(getConfigObject())
                });
                const d = await r.json();
                el.textContent = d.sessionKey || '—';
            } catch (e) {
                el.textContent = '—';
            }
        }

        function showConfirmModal() {
            document.getElementById('confirmModal').style.display = 'flex';
        }

        function cancelInstallation() {
            document.getElementById('confirmModal').style.display = 'none';
        }

        function proceedInstallation() {
            const configQueryString = getConfigQueryString();
            const configBase64 = btoa(configQueryString);
            window.location.href = \`stremio://${host}/\${configBase64}/manifest.json\`;
            document.getElementById('confirmModal').style.display = 'none';
        }

        function installAddon() {
            showConfirmModal();
        }

        function updateConfig(e) {
            e.preventDefault();
            const configQueryString = getConfigQueryString();
            const configBase64 = btoa(configQueryString);
            window.location.href = \`${protocol}://${host}/\${configBase64}/configure?generated=1\`;
        }

        function copyManifestUrl() {
            const configQueryString = getConfigQueryString();
            const configBase64 = btoa(configQueryString);
            const manifestUrl = \`${protocol}://${host}/\${configBase64}/manifest.json\`;
            
            navigator.clipboard.writeText(manifestUrl).then(() => {
                const toast = document.getElementById('toast');
                toast.style.display = 'block';
                setTimeout(() => {
                    toast.style.display = 'none';
                }, 2000);
            });
        }

        async function backupConfig() {
            const queryString = getConfigQueryString();
            const params = Object.fromEntries(new URLSearchParams(queryString));
            
            params.epg_enabled = params.epg_enabled === 'true';
            params.force_proxy = params.force_proxy === 'true';
            params.resolver_enabled = params.resolver_enabled === 'true';
            params.resolver_update_interval = 
                document.getElementById('resolverUpdateInterval').value || 
                document.querySelector('input[name="resolver_update_interval"]')?.value || 
                '';
            try {
                const r = await fetch('/api/session-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(getConfigObject())
                });
                const d = await r.json();
                if (d.sessionKey) params.session_key = d.sessionKey;
            } catch (e) {}
                
            const configBlob = new Blob([JSON.stringify(params, null, 2)], {type: 'application/json'});
            const url = URL.createObjectURL(configBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'omg_tv_config.json';
            a.click();
            URL.revokeObjectURL(url);
        }

        async function restoreConfig(event) {
            const file = event.target.files[0];
            if (!file) return;
        
            showLoader(t('loader_restore'));
            
            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const config = JSON.parse(e.target.result);
        
                    const form = document.getElementById('configForm');
                    for (const [key, value] of Object.entries(config)) {
                        if (key === 'session_key') continue;
                        const input = form.elements[key];
                        if (input) {
                            if (input.type === 'checkbox') {
                                input.checked = value;
                            } else {
                                input.value = value;
                            }
                        }
                    }
                    syncFormToResolverFields();
                    updateSessionIdDisplay();

                    if (config.resolver_update_interval) {
                        document.getElementById('resolverUpdateInterval').value = config.resolver_update_interval;
                    
                        // Crea un campo nascosto nel form se non esiste già
                        let hiddenField = document.querySelector('input[name="resolver_update_interval"]');
                        if (!hiddenField) {
                            hiddenField = document.createElement('input');
                            hiddenField.type = 'hidden';
                            hiddenField.name = 'resolver_update_interval';
                            document.getElementById('configForm').appendChild(hiddenField);
                        }
                        
                        // Imposta il valore nel campo nascosto
                        hiddenField.value = config.resolver_update_interval;
                    
                        // Pianifica l'aggiornamento del resolver
                        await fetch('/api/resolver', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                ...getConfigObject(),
                                action: 'schedule',
                                interval: config.resolver_update_interval
                            })
                        });
                    }
                    
                    // Ripristina anche i campi Python negli input visibili dell'interfaccia
                    if (config.python_script_url) {
                        document.getElementById('pythonScriptUrl').value = config.python_script_url;
        
                        // Scarica lo script Python
                        const downloadResponse = await fetch('/api/python-script', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                ...config,
                                action: 'download',
                                url: config.python_script_url
                            })
                        });
        
                        const downloadData = await downloadResponse.json();
                        if (!downloadData.success) {
                            throw new Error(t('error_script_download'));
                        }
        
                        // Esegui lo script Python
                        const executeResponse = await fetch('/api/python-script', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                ...config,
                                action: 'execute'
                            })
                        });
        
                        const executeData = await executeResponse.json();
                        if (!executeData.success) {
                            throw new Error('Esecuzione dello script fallita');
                        }
        
                        alert(t('success_script_executed'));
                        showM3uUrl(executeData.m3uUrl);
                    }
        
                    // Gestisci l'intervallo di aggiornamento
                    if (config.python_update_interval) {
                        document.getElementById('updateInterval').value = config.python_update_interval;
        
                        // Pianifica l'aggiornamento se presente
                        await fetch('/api/python-script', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                ...config,
                                action: 'schedule',
                                interval: config.python_update_interval
                            })
                        });
                    }

                    // NUOVO: Avvia esplicitamente la ricostruzione della cache
                    if (config.m3u) {
                        try {
                            const rebuildResponse = await fetch('/api/rebuild-cache', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(config)
                            });
                            
                            const rebuildResult = await rebuildResponse.json();
                            if (rebuildResult.success) {
                                alert(t('success_config_restored'));
                            } else {
                                alert(t('success_config_restored_rebuild_fail') + rebuildResult.message);
                            }
                        } catch (rebuildError) {
                            console.error('Rebuild error:', rebuildError);
                            alert(t('success_config_restored_rebuild_error'));
                        }
                    }
        
                    hideLoader();
                    
                    // Aggiorna la pagina solo dopo che tutte le operazioni sono state completate
                    const configQueryString = getConfigQueryString();
                    const configBase64 = btoa(configQueryString);
                    window.location.href = \`${protocol}://${host}/\${configBase64}/configure\`;
        
                } catch (error) {
                    hideLoader();
                    console.error('Error:', error);
                    alert(t('error_load_config') + error.message);
                }
            };
            reader.readAsText(file);
        }

        // Funzioni per lo script Python
        function showPythonStatus(data) {
            const statusEl = document.getElementById('pythonStatus');
            const contentEl = document.getElementById('pythonStatusContent');
            
            statusEl.style.display = 'block';
            
            let html = '<table style="width: 100%; text-align: left;">';
            html += '<tr><td><strong>' + t('running') + ':</strong></td><td>' + (data.isRunning ? t('yes') : t('no')) + '</td></tr>';
            html += '<tr><td><strong>' + t('last_run') + ':</strong></td><td>' + data.lastExecution + '</td></tr>';
            html += '<tr><td><strong>' + t('script_exists') + ':</strong></td><td>' + (data.scriptExists ? t('yes') : t('no')) + '</td></tr>';
            html += '<tr><td><strong>' + t('m3u_exists') + ':</strong></td><td>' + (data.m3uExists ? t('yes') : t('no')) + '</td></tr>';
            
            // Aggiungi informazioni sull'aggiornamento pianificato
            if (data.scheduledUpdates) {
                html += '<tr><td><strong>' + t('auto_update') + ':</strong></td><td>' + t('auto_update_active') + ' ' + data.updateInterval + '</td></tr>';
            }
            
            if (data.scriptUrl) {
                html += '<tr><td><strong>' + t('script_url') + ':</strong></td><td>' + data.scriptUrl + '</td></tr>';
            }
            if (data.lastError) {
                html += '<tr><td><strong>' + t('last_error') + ':</strong></td><td style="color: #ff6666;">' + data.lastError + '</td></tr>';
            }
            html += '</table>';
            
            contentEl.innerHTML = html;
        }

        function showM3uUrl(url) {
            const urlEl = document.getElementById('generatedM3uUrl');
            const contentEl = document.getElementById('m3uUrlContent');
            
            urlEl.style.display = 'block';
            contentEl.innerHTML = '<code style="word-break: break-all;">' + url + '</code>';
        }

        async function downloadPythonScript() {
            const url = document.getElementById('pythonScriptUrl').value;
            if (!url) {
                alert(t('error_invalid_url'));
                return;
            }
            
            // Salva l'URL nel campo nascosto del form
            document.getElementById('hidden_python_script_url').value = url;
            
            try {
                showLoader(t('loader_download_script'));
                
                const response = await fetch('/api/python-script', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...getConfigObject(),
                        action: 'download',
                        url: url
                    })
                });
                
                const data = await response.json();
                hideLoader();
                
                if (data.success) {
                    alert(t('success_script_downloaded'));
                } else {
                    alert(t('error_generic') + data.message);
                }
                
                checkPythonStatus();
            } catch (error) {
                hideLoader();
                alert(t('error_request') + error.message);
            }
        }

        async function executePythonScript() {
            try {
                showLoader(t('loader_execute_script'));
                
                const response = await fetch('/api/python-script', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...getConfigObject(),
                        action: 'execute'
                    })
                });
                
                const data = await response.json();
                hideLoader();
                
                if (data.success) {
                    alert(t('success_script_executed'));
                    showM3uUrl(data.m3uUrl);
                } else {
                    alert(t('error_generic') + data.message);
                }
                
                checkPythonStatus();
            } catch (error) {
                hideLoader();
                alert(t('error_request') + error.message);
            }
        }

        async function checkPythonStatus() {
            try {
                const response = await fetch('/api/python-script', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...getConfigObject(),
                        action: 'status'
                    })
                });
                
                const data = await response.json();
                showPythonStatus(data);
                
                if (data.m3uExists && data.m3uUrl) {
                    showM3uUrl(data.m3uUrl);
                }
            } catch (error) {
                alert(t('error_request') + error.message);
            }
        }

        async function useGeneratedM3u() {
            let m3uUrl = window.location.origin + '/generated-m3u';
            try {
                const r = await fetch('/api/python-script', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...getConfigObject(), action: 'status' })
                });
                const d = await r.json();
                if (d.m3uUrl) m3uUrl = d.m3uUrl;
            } catch (e) {}
            document.querySelector('input[name="m3u"]').value = m3uUrl;
            
            // Ottieni i valori attuali dai campi
            const pythonScriptUrl = document.getElementById('pythonScriptUrl').value;
            const updateInterval = document.getElementById('updateInterval').value;
            
            // Se abbiamo i valori, assicuriamoci che siano salvati nei campi nascosti
            if (pythonScriptUrl) {
                document.getElementById('hidden_python_script_url').value = pythonScriptUrl;
            }
            
            if (updateInterval) {
                document.getElementById('hidden_python_update_interval').value = updateInterval;
            }
            
            alert(t('success_playlist_set'));
        }
        
        async function scheduleUpdates() {
            const interval = document.getElementById('updateInterval').value;
            if (!interval) {
                alert(t('error_invalid_interval'));
                return;
            }
            
            // Salva l'intervallo nel campo nascosto del form
            document.getElementById('hidden_python_update_interval').value = interval;
            
            try {
                const response = await fetch('/api/python-script', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...getConfigObject(),
                        action: 'schedule',
                        interval: interval
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    alert(data.message);
                } else {
                    alert(t('error_generic') + data.message);
                }
                
                checkPythonStatus();
            } catch (error) {
                alert(t('error_request') + error.message);
            }
        }

        async function stopScheduledUpdates() {
            try {
                const response = await fetch('/api/python-script', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...getConfigObject(),
                        action: 'stopSchedule'
                    })
                });
                
                const data = await response.json();
                alert(data.message);
                checkPythonStatus();
            } catch (error) {
                alert(t('error_request') + error.message);
            }
        }

        // Funzioni per il resolver Python
        function showResolverStatus(data) {
            const statusEl = document.getElementById('resolverStatus');
            const contentEl = document.getElementById('resolverStatusContent');
            
            statusEl.style.display = 'block';
            
            let html = '<table style="width: 100%; text-align: left;">';
            html += '<tr><td><strong>' + t('running') + ':</strong></td><td>' + (data.isRunning ? t('yes') : t('no')) + '</td></tr>';
            html += '<tr><td><strong>' + t('last_run') + ':</strong></td><td>' + data.lastExecution + '</td></tr>';
            html += '<tr><td><strong>' + t('script_exists') + ':</strong></td><td>' + (data.scriptExists ? t('yes') : t('no')) + '</td></tr>';
            
            if (data.resolverVersion) {
                html += '<tr><td><strong>' + t('version') + ':</strong></td><td>' + data.resolverVersion + '</td></tr>';
            }
            
            if (data.cacheItems !== undefined) {
                html += '<tr><td><strong>' + t('cache_items') + ':</strong></td><td>' + data.cacheItems + '</td></tr>';
            }
            
            if (data.scheduledUpdates) {
                html += '<tr><td><strong>' + t('auto_update') + ':</strong></td><td>' + t('auto_update_active') + ' ' + data.updateInterval + '</td></tr>';
            }
            
            if (data.scriptUrl) {
                html += '<tr><td><strong>' + t('script_url') + ':</strong></td><td>' + data.scriptUrl + '</td></tr>';
            }
            if (data.lastError) {
                html += '<tr><td><strong>' + t('last_error') + ':</strong></td><td style="color: #ff6666;">' + data.lastError + '</td></tr>';
            }
            html += '</table>';
            
            contentEl.innerHTML = html;
        }

        function initializeResolverFields() {
            syncFormToResolverFields();
            const urlParams = new URLSearchParams(window.location.search);
            const resolverUpdateInterval = urlParams.get('resolver_update_interval');
            const hiddenField = document.querySelector('input[name="resolver_update_interval"]');
            if (resolverUpdateInterval || (hiddenField && hiddenField.value)) {
                document.getElementById('resolverUpdateInterval').value = resolverUpdateInterval || hiddenField.value;
            }
            const urlEl = document.getElementById('resolverScriptUrl');
            const enEl = document.getElementById('resolverEnabled');
            if (urlEl) urlEl.addEventListener('change', syncResolverFieldsToForm);
            if (urlEl) urlEl.addEventListener('input', syncResolverFieldsToForm);
            if (enEl) enEl.addEventListener('change', syncResolverFieldsToForm);
            checkResolverStatus();
        }
        
        window.addEventListener('DOMContentLoaded', function() {
            window.applyLanguage(window.currentLang);
            initializePythonFields();
            initializeResolverFields();
        });

        async function downloadResolverScript() {
            syncResolverFieldsToForm();
            const url = document.getElementById('resolverScriptUrl').value;
            
            if (!url) {
                alert(t('error_resolver_url'));
                return;
            }
            
            try {
                showLoader(t('loader_download_resolver'));
                
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...getConfigObject(),
                        action: 'download',
                        url: url
                    })
                });
                
                const data = await response.json();
                hideLoader();
                
                if (data.success) {
                    alert(t('success_resolver_downloaded'));
                    // Non serve impostare nuovamente l'URL poiché lo leggiamo direttamente dal campo configurazione
                    document.getElementById('resolverEnabled').checked = true;
                    const he = document.getElementById('hidden_resolver_enabled');
                    if (he) he.value = 'true';
                } else {
                    alert(t('error_generic') + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                hideLoader();
                alert(t('error_request') + error.message);
            }
        }

        async function createResolverTemplate() {
            try {
                showLoader(t('loader_creating_template'));
                
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...getConfigObject(),
                        action: 'create-template'
                    })
                });
                
                const data = await response.json();
                hideLoader();
                
                if (data.success) {
                    alert(t('success_template_created'));
                    
                    // Avvia il download automatico
                    window.location.href = '/api/resolver/download-template';
                    
                    checkResolverStatus();
                } else {
                    alert(t('error_generic') + data.message);
                }
            } catch (error) {
                hideLoader();
                alert(t('error_request') + error.message);
            }
        }

        async function checkResolverHealth() {
            try {
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...getConfigObject(),
                        action: 'check-health'
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    alert('✅ ' + t('success_resolver_verified'));
                } else {
                    alert('❌ ' + t('error_generic') + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                alert(t('error_request') + error.message);
            }
        }

        async function checkResolverStatus() {
            try {
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...getConfigObject(),
                        action: 'status'
                    })
                });
                
                const data = await response.json();
                showResolverStatus(data);
            } catch (error) {
                alert(t('error_request') + error.message);
            }
        }

        async function clearResolverCache() {
            try {
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...getConfigObject(),
                        action: 'clear-cache'
                    })
                });
                
                const data = await response.json();
                if (data.success) {
                    alert(t('success_cache_cleared'));
                } else {
                    alert(t('error_generic') + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                alert(t('error_request') + error.message);
            }
        }

        async function scheduleResolverUpdates() {
            const interval = document.getElementById('resolverUpdateInterval').value;
            if (!interval) {
                alert(t('error_invalid_interval'));
                return;
            }
            
            try {
                showLoader(t('loader_scheduling'));
                
                // Crea un campo nascosto nel form se non esiste già
                let hiddenField = document.querySelector('input[name="resolver_update_interval"]');
                if (!hiddenField) {
                    hiddenField = document.createElement('input');
                    hiddenField.type = 'hidden';
                    hiddenField.name = 'resolver_update_interval';
                    document.getElementById('configForm').appendChild(hiddenField);
                }
                
                // Imposta il valore dell'intervallo nel campo nascosto
                hiddenField.value = interval;
                
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...getConfigObject(),
                        action: 'schedule',
                        interval: interval
                    })
                });
                
                const data = await response.json();
                hideLoader();
                
                if (data.success) {
                    alert(data.message);
                } else {
                    alert(t('error_generic') + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                hideLoader();
                alert(t('error_request') + error.message);
            }
        }
        
        // Funzione per inizializzare i campi Python con i valori dai campi nascosti
        function initializePythonFields() {
            // Copia i valori dai campi nascosti del form ai campi dell'interfaccia Python
            const pythonScriptUrl = document.getElementById('hidden_python_script_url').value;
            const pythonUpdateInterval = document.getElementById('hidden_python_update_interval').value;
            
            if (pythonScriptUrl) {
                document.getElementById('pythonScriptUrl').value = pythonScriptUrl;
            }
            
            if (pythonUpdateInterval) {
                document.getElementById('updateInterval').value = pythonUpdateInterval;
            }
            
            // Se abbiamo un URL, eseguiamo il controllo dello stato
            if (pythonScriptUrl) {
                checkPythonStatus();
            }
        }

        //funzioni per visualizzare la rotella di caricamento
        function showLoader(message) {
            document.getElementById('loaderMessage').textContent = message || t('loader_default');
            document.getElementById('loaderOverlay').style.display = 'flex';
        }
        
        function hideLoader() {
            document.getElementById('loaderOverlay').style.display = 'none';
        }

        async function stopResolverUpdates() {
            try {
                showLoader(t('loader_stopping'));
                
                const response = await fetch('/api/resolver', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        ...getConfigObject(),
                        action: 'stopSchedule'
                    })
                });
                
                const data = await response.json();
                hideLoader();
                
                if (data.success) {
                    alert(data.message);
                    
                    // Pulisci anche il campo dell'intervallo
                    document.getElementById('resolverUpdateInterval').value = '';
                    
                    // Aggiorna anche il valore nel campo nascosto
                    let hiddenField = document.querySelector('input[name="resolver_update_interval"]');
                    if (hiddenField) {
                        hiddenField.value = '';
                    }
                } else {
                    alert(t('error_generic') + data.message);
                }
                
                checkResolverStatus();
            } catch (error) {
                hideLoader();
                alert(t('error_request') + error.message);
            }
        }
        
        // Inizializza i campi Python all'avvio
        window.addEventListener('DOMContentLoaded', function() {
            initializePythonFields();
            initializeResolverFields();
        });
    `;
};

module.exports = {
    getViewScripts
};
